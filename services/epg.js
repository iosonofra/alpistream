const axios = require('axios');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { DATA_DIR, getConfig, getChannels, saveChannels } = require('./storage');

const EPG_CACHE_FILE = path.join(DATA_DIR, 'epg.xml');

// Mappatura automatica canali con supporto EPGShare (epgshare01.online) e IPTV-Org
const KNOWN_EPG_MAPPINGS = {
  // Sky Sport (EPGShare IDs con punti)
  'SPORT 24': 'Sky.Sport.24.it',
  'SPORT UNO': 'Sky.Sport.Uno.it',
  'SPORT CALCIO': 'Sky.Sport.Calcio.it',
  'SPORT TENNIS': 'Sky.Sport.Tennis.it',
  'SPORT ARENA': 'Sky.Sport.Arena.it',
  'SPORT BASKET': 'Sky.Sport.Basket.it',
  'SPORT MAX': 'Sky.Sport.Max.it',
  'SPORT F1': 'Sky.Sport.F1.it',
  'SPORT MOTOGP': 'Sky.Sport.MotoGP.it',
  'SPORT GOLF': 'Sky.Sport.Golf.it',
  'SPORT 251': 'Sky.Sport..251.it',
  'SPORT 252': 'Sky.Sport..252.it',
  'SPORT 253': 'Sky.Sport..253.it',
  'SPORT 254': 'Sky.Sport..254.it',
  'SPORT 255': 'Sky.Sport..255.it',
  'SPORT 256': 'Sky.Sport..256.it',
  'SPORT 257': 'Sky.Sport..257.it',
  'SPORT 258': 'Sky.Sport..258.it',
  'SPORT 259': 'Sky.Sport..259.it',
  'SPORT LEGEND': 'Sky.Sport.Legend.it',
  'SPORT MIX': 'Sky.Sport.Mix.it',
  'SPORT 4K': 'Sky.Sport.4K.it',

  // Sky Intrattenimento / Documentari / Serie
  'TG 24 FHD': 'Sky.TG24.it',
  'TG 24': 'Sky.TG24.it',
  'TG24': 'Sky.TG24.it',
  'SKY UNO FHD': 'Sky.Uno.it',
  'SKY UNO PLUS': 'Sky.Uno.it',
  'SKY UNO': 'Sky.Uno.it',
  'SKY ATLANTIC': 'Sky.Atlantic.it',
  'SKY SERIE': 'Sky.Serie.it',
  'SKY INVESTIGATION': 'Sky.Investigation.it',
  'SKY ADVENTURE': 'Sky.Adventure.it',
  'SKY CRIME': 'Sky.Crime.it',
  'SKY DOCUMENTARIES': 'Sky.Documentaries.it',
  'SKY NATURE': 'Sky.Nature.it',
  'SKY ARTE': 'Sky.Arte.it',
  'HISTORY': 'History.it',
  'COMEDY CENTRAL': 'Comedy.Central.it',
  'MTV': 'MTV.HD.it',
  'SKY COLLECTION': 'Sky.Cinema.Collection.it',

  // Sky Cinema
  'SKY CINEMA UNO': 'Sky.Cinema.Uno.it',
  'SKY CINEMA DUE': 'Sky.Cinema.Due.it',
  'SKY CINEMA ACTION': 'Sky.Cinema.Action.it',
  'SKY CINEMA COMEDY': 'Sky.Cinema.Comedy.it',
  'SKY CINEMA FAMILY': 'Sky.Cinema.Family.it',
  'SKY CINEMA DRAMA': 'Sky.Cinema.Drama.it',
  'SKY CINEMA ROMANCE': 'Sky.Cinema.Romance.it',
  'SKY CINEMA SUSPENSE': 'Sky.Cinema.Suspense.it',

  // DAZN & Eurosport
  'DAZN 1': 'DAZN.1.it.it',
  'DAZN 2': 'DAZN.2.it.it',
  'EUROSPORT 1': 'Eurosport.Italia.it',
  'EUROSPORT 2': 'Eurosport.2.Italia.it',

  // Nazionali DTT
  'RAI 1': 'Rai1.it',
  'RAI 2': 'Rai2.it',
  'RAI 3': 'Rai3.it',
  'RAI 4': 'Rai4.it',
  'RAI 5': 'Rai5.it',
  'RAI SPORT': 'RaiSport.it',
  'RAI MOVIE': 'RaiMovie.it',
  'RAI PREMIUM': 'RaiPremium.it',
  'RAI NEWS 24': 'RaiNews24.it',
  'RAI NEWS': 'RaiNews24.it',
  'RETE 4': 'Rete.4.it',
  'CANALE 5': 'Canale.5.it',
  'ITALIA 1': 'Italia.1.it',
  'ITALIA 2': 'Italia.2.it',
  '20 MEDIASET': '20.it',
  'LA 5': 'La.5.it',
  'CINE 34': 'Cine34.it',
  'FOCUS': 'Focus.it',
  'IRIS': 'Iris.it',
  'TOP CRIME': 'Top.Crime.it',
  'LA7': 'LA7.HD.it',
  'LA7D': 'LA7D.it',
  'TV8': 'TV8.HD.it',
  'NOVE': 'Nove.it',
  'DMAX': 'DMAX.it',
  'REAL TIME': 'Real.Time.it',
  'GIALLO': 'Giallo.TV.it',
  'MOTOR TREND': 'Motor.Trend.it',
  'FOOD NETWORK': 'Food.Network.it',
  'CIELO': 'cielo.it'
};

function parseXmltvDate(str) {
  if (!str) return 0;
  const clean = str.trim();
  const year = parseInt(clean.substring(0, 4), 10);
  const month = parseInt(clean.substring(4, 6), 10) - 1;
  const day = parseInt(clean.substring(6, 8), 10);
  const hour = parseInt(clean.substring(8, 10), 10);
  const min = parseInt(clean.substring(10, 12), 10);
  const sec = parseInt(clean.substring(12, 14), 10) || 0;

  const tzMatch = clean.match(/([+-])(\d{2})(\d{2})$/);
  if (tzMatch) {
    const sign = tzMatch[1] === '+' ? -1 : 1;
    const tzHours = parseInt(tzMatch[2], 10);
    const tzMins = parseInt(tzMatch[3], 10);
    const tzOffsetMs = (tzHours * 60 + tzMins) * 60 * 1000 * sign;
    return Date.UTC(year, month, day, hour, min, sec) + tzOffsetMs;
  }
  return new Date(year, month, day, hour, min, sec).getTime();
}

function formatTime(timestamp) {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

class EPGManager {
  constructor() {
    this.isUpdating = false;
    this.lastUpdated = null;
    this.indexedPrograms = new Map();
    this.lastIndexedMtime = 0;
    this.isIndexing = false;
    setTimeout(() => {
      this.loadAndIndexCache().catch(e => console.warn('[EPG] Errore indexing iniziale:', e.message));
    }, 500);
  }

  getAutoTvgId(channelTitle) {
    if (!channelTitle) return '';
    const cleanTitle = channelTitle.toUpperCase()
      .replace(/\[.*?\]/g, '')
      .replace(/\(.*?\)/g, '')
      .replace(/\b(FHD|HD|SD|4K|HEVC|H265|1080P|720P|ITA)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    // 1. Match esatto
    if (KNOWN_EPG_MAPPINGS[cleanTitle]) {
      return KNOWN_EPG_MAPPINGS[cleanTitle];
    }

    // 2. Match parziale
    for (const [name, tvgId] of Object.entries(KNOWN_EPG_MAPPINGS)) {
      if (cleanTitle === name || cleanTitle.startsWith(name) || cleanTitle.includes(name)) {
        return tvgId;
      }
    }
    return '';
  }

  remapExistingChannels() {
    const channels = getChannels();
    let updatedCount = 0;
    channels.forEach(ch => {
      const autoId = this.getAutoTvgId(ch.customTitle || ch.title);
      if (autoId && ch.tvgId !== autoId) {
        ch.tvgId = autoId;
        updatedCount++;
      }
    });
    if (updatedCount > 0) {
      saveChannels(channels);
      console.log(`[EPG] Aggiornati tvg-id EPG per ${updatedCount} canali esistenti`);
    }
    return updatedCount;
  }

  async updateEPG() {
    if (this.isUpdating) return false;
    this.isUpdating = true;
    console.log('[EPG] Inizio download e aggiornamento guida programmi (EPGShare)...');

    const config = getConfig();
    const epgSources = (config.epgSources || []).filter(s => s.enabled);

    if (epgSources.length === 0) {
      console.log('[EPG] Nessuna sorgente EPG abilitata.');
      this.isUpdating = false;
      return false;
    }

    const channelsMap = new Map(); // id -> xml
    const programmesList = [];
    let successCount = 0;

    for (const src of epgSources) {
      try {
        const isGz = src.url.endsWith('.gz');
        console.log(`[EPG] Download da: ${src.name} (${src.url}) [GZ: ${isGz}]`);

        const res = await axios.get(src.url, {
          timeout: 60000,
          responseType: isGz ? 'arraybuffer' : 'text',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        });

        let xmlData = '';
        if (isGz) {
          xmlData = zlib.gunzipSync(res.data).toString('utf-8');
        } else {
          xmlData = res.data;
        }

        if (xmlData && typeof xmlData === 'string' && xmlData.includes('<tv')) {
          // Estrai tutti i tag <channel ...>...</channel>
          const chanMatches = xmlData.match(/<channel\s+id="([^"]+)"[\s\S]*?<\/channel>/gi) || [];
          chanMatches.forEach(chXml => {
            const idMatch = chXml.match(/id="([^"]+)"/i);
            if (idMatch && !channelsMap.has(idMatch[1])) {
              channelsMap.set(idMatch[1], chXml);
            }
          });

          // Estrai tutti i tag <programme ...>...</programme>
          const progMatches = xmlData.match(/<programme\s+[\s\S]*?<\/programme>/gi) || [];
          programmesList.push(...progMatches);

          console.log(`[EPG] Estratti ${chanMatches.length} canali e ${progMatches.length} programmi da ${src.name}`);
          successCount++;
        }
      } catch (err) {
        console.error(`[EPG] Errore download da ${src.name}:`, err.message);
      }
    }

    if (successCount > 0 && channelsMap.size > 0) {
      const combinedXml = `<?xml version="1.0" encoding="UTF-8"?>\n<tv generator-info-name="iosonofratv EPG Server (EPGShare)">\n` +
        Array.from(channelsMap.values()).join('\n') + '\n' +
        programmesList.join('\n') + '\n' +
        `</tv>`;

      fs.writeFileSync(EPG_CACHE_FILE, combinedXml, 'utf-8');
      this.lastUpdated = new Date();
      console.log(`[EPG] Cache XMLTV completata e salvata: ${channelsMap.size} canali, ${programmesList.length} programmi`);

      // Riassegna in automatico i tvg-id corrispondenti ai canali iosonofratv
      this.remapExistingChannels();

      // Rigenera indice in memoria
      await this.loadAndIndexCache(true);
    } else {
      if (!fs.existsSync(EPG_CACHE_FILE)) {
        const emptyXml = `<?xml version="1.0" encoding="UTF-8"?>\n<tv generator-info-name="iosonofratv EPG Server">\n</tv>`;
        fs.writeFileSync(EPG_CACHE_FILE, emptyXml, 'utf-8');
      }
    }

    this.isUpdating = false;
    return successCount > 0;
  }

  async loadAndIndexCache(force = false) {
    if (this.isIndexing) return;
    if (!fs.existsSync(EPG_CACHE_FILE)) return;

    try {
      const stat = fs.statSync(EPG_CACHE_FILE);
      if (!force && stat.mtimeMs <= this.lastIndexedMtime && this.indexedPrograms.size > 0) {
        return;
      }

      this.isIndexing = true;
      const startT = Date.now();
      const readline = require('readline');
      const fileStream = fs.createReadStream(EPG_CACHE_FILE);
      const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

      const newMap = new Map();
      let currentProg = null;

      for await (const line of rl) {
        const trimmed = line.trim();
        if (trimmed.startsWith('<programme ')) {
          const startMatch = trimmed.match(/start="([^"]+)"/);
          const stopMatch = trimmed.match(/stop="([^"]+)"/);
          const chanMatch = trimmed.match(/channel="([^"]+)"/);
          if (startMatch && stopMatch && chanMatch) {
            currentProg = {
              start: parseXmltvDate(startMatch[1]),
              stop: parseXmltvDate(stopMatch[1]),
              channel: chanMatch[1].toLowerCase(),
              title: '',
              desc: '',
              category: '',
              icon: ''
            };
          }
        } else if (currentProg) {
          if (trimmed.startsWith('<title')) {
            const m = trimmed.match(/<title[^>]*>([\s\S]*?)<\/title>/);
            if (m) currentProg.title = m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
          } else if (trimmed.startsWith('<desc')) {
            const m = trimmed.match(/<desc[^>]*>([\s\S]*?)<\/desc>/);
            if (m) {
              currentProg.desc = m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
            }
          } else if (trimmed.startsWith('<category')) {
            const m = trimmed.match(/<category[^>]*>([\s\S]*?)<\/category>/);
            if (m && !currentProg.category) currentProg.category = m[1];
          } else if (trimmed.startsWith('<icon')) {
            const m = trimmed.match(/src="([^"]+)"/);
            if (m && !currentProg.icon) currentProg.icon = m[1];
          } else if (trimmed.startsWith('</programme>')) {
            if (!newMap.has(currentProg.channel)) {
              newMap.set(currentProg.channel, []);
            }
            newMap.get(currentProg.channel).push(currentProg);
            currentProg = null;
          }
        }
      }

      // Ordina gli eventi per ogni canale
      for (const [k, arr] of newMap.entries()) {
        arr.sort((a, b) => a.start - b.start);
      }

      this.indexedPrograms = newMap;
      this.lastIndexedMtime = stat.mtimeMs;
      console.log(`[EPG] Indicizzazione completata in ${Date.now() - startT}ms: ${newMap.size} canali EPG in memoria`);
    } catch (err) {
      console.error('[EPG] Errore indicizzazione cache:', err.message);
    } finally {
      this.isIndexing = false;
    }
  }

  getLiveEpg(channelsList = null) {
    if (this.indexedPrograms.size === 0) {
      this.loadAndIndexCache().catch(() => {});
    }

    const now = Date.now();
    const result = {};

    const targets = Array.isArray(channelsList) && channelsList.length > 0 ? channelsList : null;

    if (targets) {
      for (const ch of targets) {
        const tvgId = (ch.tvgId || this.getAutoTvgId(ch.customTitle || ch.title) || '').toLowerCase();
        let epgData = {
          nowTitle: 'Programmazione non disponibile',
          nowTime: '',
          nowDesc: '',
          progress: 0,
          nextTitle: '',
          nextTime: '',
          category: '',
          icon: ''
        };

        if (tvgId && this.indexedPrograms.has(tvgId)) {
          const progs = this.indexedPrograms.get(tvgId);
          for (let i = 0; i < progs.length; i++) {
            const p = progs[i];
            if (p.start <= now && now < p.stop) {
              const nextP = progs[i + 1] || null;
              const duration = p.stop - p.start;
              const progress = duration > 0 ? Math.min(100, Math.max(0, Math.round(((now - p.start) / duration) * 100))) : 0;
              epgData = {
                nowTitle: p.title || 'Evento in onda',
                nowTime: `${formatTime(p.start)} - ${formatTime(p.stop)}`,
                nowStart: p.start,
                nowStop: p.stop,
                nowDesc: p.desc || '',
                progress,
                nextTitle: nextP ? nextP.title : '',
                nextTime: nextP ? `${formatTime(nextP.start)} - ${formatTime(nextP.stop)}` : '',
                category: p.category || '',
                icon: p.icon || ''
              };
              break;
            }
          }
        }

        if (ch.id) result[ch.id] = epgData;
        if (tvgId) result[tvgId] = epgData;
      }
    } else {
      for (const [tvgId, progs] of this.indexedPrograms.entries()) {
        for (let i = 0; i < progs.length; i++) {
          const p = progs[i];
          if (p.start <= now && now < p.stop) {
            const nextP = progs[i + 1] || null;
            const duration = p.stop - p.start;
            const progress = duration > 0 ? Math.min(100, Math.max(0, Math.round(((now - p.start) / duration) * 100))) : 0;
            result[tvgId] = {
              nowTitle: p.title || 'Evento in onda',
              nowTime: `${formatTime(p.start)} - ${formatTime(p.stop)}`,
              nowStart: p.start,
              nowStop: p.stop,
              nowDesc: p.desc || '',
              progress,
              nextTitle: nextP ? nextP.title : '',
              nextTime: nextP ? `${formatTime(nextP.start)} - ${formatTime(nextP.stop)}` : '',
              category: p.category || '',
              icon: p.icon || ''
            };
            break;
          }
        }
      }
    }

    return result;
  }

  getTimelineEpg(channelsList, hours = 4) {
    if (this.indexedPrograms.size === 0) {
      this.loadAndIndexCache().catch(() => {});
    }

    const now = Date.now();
    const hoursNum = Math.max(1, Math.min(12, parseInt(hours, 10) || 4));

    const startDate = new Date(now);
    const startMins = startDate.getMinutes() >= 30 ? 30 : 0;
    startDate.setMinutes(startMins, 0, 0);
    const windowStart = startDate.getTime();
    const windowEnd = windowStart + (hoursNum * 3600 * 1000);

    const timeSlots = [];
    let slotTime = windowStart;
    while (slotTime < windowEnd) {
      timeSlots.push({
        time: slotTime,
        label: formatTime(slotTime)
      });
      slotTime += 30 * 60 * 1000;
    }

    const channelsData = [];
    const chList = Array.isArray(channelsList) ? channelsList : [];

    for (const ch of chList) {
      const tvgId = (ch.tvgId || this.getAutoTvgId(ch.customTitle || ch.title) || '').toLowerCase();
      const programmes = [];

      if (tvgId && this.indexedPrograms.has(tvgId)) {
        const allProgs = this.indexedPrograms.get(tvgId);
        for (const p of allProgs) {
          if (p.stop > windowStart && p.start < windowEnd) {
            const isLive = p.start <= now && now < p.stop;
            const durationMs = p.stop - p.start;
            const progress = isLive && durationMs > 0 ? Math.min(100, Math.max(0, Math.round(((now - p.start) / durationMs) * 100))) : 0;
            programmes.push({
              title: p.title,
              desc: p.desc,
              start: p.start,
              stop: p.stop,
              startTime: formatTime(p.start),
              stopTime: formatTime(p.stop),
              durationMinutes: Math.round(durationMs / 60000),
              isLive,
              progress,
              category: p.category,
              icon: p.icon
            });
          }
        }
      }

      if (programmes.length === 0) {
        programmes.push({
          title: 'Nessuna informazione EPG',
          desc: 'Informazioni sui programmi non disponibili per questa fascia oraria.',
          start: windowStart,
          stop: windowEnd,
          startTime: formatTime(windowStart),
          stopTime: formatTime(windowEnd),
          durationMinutes: hoursNum * 60,
          isLive: true,
          progress: 0,
          category: '',
          icon: ''
        });
      }

      channelsData.push({
        id: ch.id,
        lcn: ch.lcn,
        title: ch.customTitle || ch.title,
        logo: ch.customLogo || ch.logo,
        group: ch.customGroup || ch.group,
        programmes
      });
    }

    return {
      windowStart,
      windowEnd,
      timeSlots,
      channels: channelsData
    };
  }

  getEPGContent() {
    if (fs.existsSync(EPG_CACHE_FILE)) {
      return fs.readFileSync(EPG_CACHE_FILE, 'utf-8');
    }
    return `<?xml version="1.0" encoding="UTF-8"?>\n<tv generator-info-name="iosonofratv EPG Server">\n</tv>`;
  }

  getStatus() {
    const exists = fs.existsSync(EPG_CACHE_FILE);
    let sizeMb = 0;
    let modified = null;
    let channelCount = 0;
    let programmeCount = 0;

    if (exists) {
      const stats = fs.statSync(EPG_CACHE_FILE);
      sizeMb = (stats.size / (1024 * 1024)).toFixed(2);
      modified = stats.mtime;

      // Conteggio veloce canali e programmi
      const content = fs.readFileSync(EPG_CACHE_FILE, 'utf-8');
      const chanMatches = content.match(/<channel\s+/gi);
      const progMatches = content.match(/<programme\s+/gi);
      channelCount = chanMatches ? chanMatches.length : 0;
      programmeCount = progMatches ? progMatches.length : 0;
    }

    return {
      isUpdating: this.isUpdating,
      lastUpdated: this.lastUpdated || modified,
      exists,
      sizeMb,
      channelCount,
      programmeCount
    };
  }
}

module.exports = new EPGManager();

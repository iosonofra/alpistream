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

class EPGManager {
  constructor() {
    this.isUpdating = false;
    this.lastUpdated = null;
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
    } else {
      if (!fs.existsSync(EPG_CACHE_FILE)) {
        const emptyXml = `<?xml version="1.0" encoding="UTF-8"?>\n<tv generator-info-name="iosonofratv EPG Server">\n</tv>`;
        fs.writeFileSync(EPG_CACHE_FILE, emptyXml, 'utf-8');
      }
    }

    this.isUpdating = false;
    return successCount > 0;
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

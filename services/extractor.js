const axios = require('axios');
const http = require('http');
const https = require('https');

const DEFAULT_USER_AGENT = 'MandraKodi2@@2.2.1@@MandraKodi3@@MKD123';

// Client HTTP ottimizzato con Connection Pooling e Keep-Alive
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 50 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 50, rejectUnauthorized: false });

const apiClient = axios.create({
  httpAgent,
  httpsAgent,
  timeout: 8000,
  headers: {
    'User-Agent': DEFAULT_USER_AGENT,
    'Accept': '*/*'
  }
});

// Catalogo completo di tutte le sorgenti MandraKodi
const CATALOG_SECTIONS = [
  {
    id: "1",
    name: "Last Minute",
    desc: "Eventi live dell'ultimo minuto e canali diretti (DAZN, MPD, AceStream, Platin, Serie A)",
    url: "https://test34344.herokuapp.com/filter.php?numTest=A1A103",
    extraUrls: [
      "https://test34344.herokuapp.com/filter.php?numTest=A1A115",
      "https://test34344.herokuapp.com/filter.php?numTest=A1A134C"
    ],
    group: "SPORT - Last Minute"
  },
  {
    id: "2",
    name: "Liste EVENTI",
    desc: "Tutte le liste eventi (Daddy, Platin Ace, CDN, Live TV, Socceron, NBA, NFL, UFC)",
    url: "https://test34344.herokuapp.com/filter.php?numTest=A1A110",
    group: "SPORT - Liste Eventi"
  },
  {
    id: "3",
    name: "Mpd (Nazioni)",
    desc: "Canali MPD suddivisi per nazione (Italia, Spagna, UK, USA, ecc.)",
    url: "https://test34344.herokuapp.com/filter.php?numTest=A1A134A",
    group: "CANALI - MPD Nazioni"
  },
  {
    id: "4",
    name: "Mpd (all)",
    desc: "Elenco globale di tutti i canali MPD internazionali",
    url: "https://test34344.herokuapp.com/filter.php?numTest=A1A134F",
    group: "CANALI - MPD All"
  },
  {
    id: "5",
    name: "Sky Sport",
    desc: "Canali Sky Sport e Calcio (decodifica ClearKey DRM MPD)",
    url: "https://test34344.herokuapp.com/filter.php?numTest=A1A165",
    group: "CANALI - Sky Sport"
  },
  {
    id: "6",
    name: "Sky Intrattenimento",
    desc: "Canali Sky Uno, Atlantic, Serie, Crime, Documentaries, Arte, TG24 (ClearKey DRM MPD)",
    url: "https://test34344.herokuapp.com/filter.php?numTest=A1A260",
    group: "CANALI - Sky Intrattenimento"
  },
  {
    id: "7",
    name: "Sky 2",
    desc: "Canali Sky 2 e flussi alternativi (DAZN, Freeshot)",
    url: "https://test34344.herokuapp.com/filter.php?numTest=A1A165A",
    group: "CANALI - Sky 2"
  },
  {
    id: "8",
    name: "Mediahosting Channel",
    desc: "200+ canali sportivi MediaHosting con token",
    url: "https://test34344.herokuapp.com/filter.php?numTest=A1A129",
    group: "CANALI - Mediahosting"
  },
  {
    id: "9",
    name: "Lista 1",
    desc: "Canali sportivi GitHub / Sorgente 1",
    url: "https://test34344.herokuapp.com/filter.php?numTest=A1A121",
    group: "CANALI - Lista 1"
  },
  {
    id: "10",
    name: "Lista 2",
    desc: "Canali sportivi mondiali IPTV-Org (M3U)",
    url: "https://iptv-org.github.io/iptv/categories/sports.m3u",
    group: "CANALI - Lista 2 (Sports)"
  },
  {
    id: "11",
    name: "Lista 3",
    desc: "Sorgente Rocktalk / Canali 3",
    url: "https://test34344.herokuapp.com/filter.php?numTest=A1A900",
    group: "CANALI - Lista 3"
  },
  {
    id: "12",
    name: "Lista 4",
    desc: "Canali Partite & Sport Live",
    url: "https://test34344.herokuapp.com/filter.php?numTest=A1A122",
    group: "CANALI - Lista 4"
  },
  {
    id: "13",
    name: "Lista 5",
    desc: "Sorgente SportsOnline / Eurosport",
    url: "https://test34344.herokuapp.com/filter.php?numTest=A1A126",
    group: "CANALI - Lista 5"
  },
  {
    id: "14",
    name: "Lista 7",
    desc: "Sorgente Rustico TV",
    url: "https://test34344.herokuapp.com/filter.php?numTest=A1A134D",
    group: "CANALI - Lista 7"
  },
  {
    id: "15",
    name: "Lista 8",
    desc: "Canali Daddy Live TV (700+ canali con risoluzione automatica)",
    url: "https://test34344.herokuapp.com/filter.php?numTest=A1A124A",
    group: "CANALI - Lista 8 (Daddy)"
  },
  {
    id: "16",
    name: "HTSport Live",
    desc: "Canali sportivi live da HTSport (DAZN 1 HD 1080p, Sky Sport Uno, Calcio, F1, MotoGP, Max, Tennis, Eurosport)",
    url: "https://www.htsport.org/",
    group: "SPORT - HTSport"
  }
];

function stripKodiTags(text) {
  if (!text) return '';
  return text
    .replace(/\[\/?COLOR.*?\]/gi, '')
    .replace(/\[\/?B\]/gi, '')
    .replace(/\[\/?I\]/gi, '')
    .replace(/\[CR\]/gi, ' - ')
    .replace(/[\r\n]+/g, ' ')
    .trim();
}

function sanitizeGroupName(rawGroup) {
  if (!rawGroup) return 'Generale';
  let g = stripKodiTags(rawGroup).trim();

  // Rimuovi tag tipo (online), [online], (backup), (720p), (1080p), etc.
  g = g.replace(/[\(\[](online|offline|backup|hd|fhd|sd|4k|mpd|hls)[\)\]]/gi, '').trim();

  // Rimuovi trattini multipli o spazi duplicati
  g = g.replace(/\s*-\s*-\s*/g, ' - ').replace(/\s+/g, ' ').trim();

  // Rimuovi parti duplicate consecutive
  const parts = g.split(/\s*-\s*/).map(p => p.trim()).filter(Boolean);
  const uniqueParts = [];
  for (const p of parts) {
    if (uniqueParts.length === 0 || uniqueParts[uniqueParts.length - 1].toLowerCase() !== p.toLowerCase()) {
      uniqueParts.push(p);
    }
  }

  // Se ci sono più di 3 livelli (es. A - B - C - D - E), compattali
  if (uniqueParts.length > 3) {
    g = `${uniqueParts[0]} - ${uniqueParts[uniqueParts.length - 2]} - ${uniqueParts[uniqueParts.length - 1]}`;
  } else {
    g = uniqueParts.join(' - ');
  }

  return g || 'Generale';
}

function processWarpChannels(channelList) {
  if (!Array.isArray(channelList)) return [];
  const result = [];
  for (const ch of channelList) {
    if (!ch) continue;
    const title = (ch.customTitle || ch.title || '').trim();
    const isWarpInTitle = /WARP/i.test(title) || /WARP/i.test(ch.originalTitle || '');
    const hasClearKey = ch.clearkey && !['0000', '0:0', '0'].includes(String(ch.clearkey).trim());
    const isMpd = (ch.url && ch.url.includes('.mpd')) || (ch.kodi_props && ch.kodi_props['inputstream.adaptive.manifest_type'] === 'mpd');

    // I canali HTSport non devono mai essere toccati da WARP né duplicati
    if (ch.source === 'htsport' || (ch.group && ch.group.toLowerCase().includes('htsport')) || (ch.url && (ch.url.includes('htsport') || ch.url.includes('tvnow')))) {
      result.push(ch);
      continue;
    }

    // Se il canale ha già id terminante in _warp o _ffmpeg, non duplicare ulteriormente
    if (ch.id && (ch.id.endsWith('_warp') || ch.id.endsWith('_ffmpeg'))) {
      result.push(ch);
      continue;
    }

    // Se ha WARP nel titolo ed è un flusso MPD o ClearKey
    if (isWarpInTitle && (hasClearKey || isMpd)) {
      // Pulisci dal titolo eventuali tag precedenti
      const baseTitle = title
        .replace(/\s*\[WARP(?:\s*SOCKS5|\s*\+\s*Proxy MPD FFmpeg)?\]/gi, '')
        .replace(/\s*\((?:WARP\s*SOCKS5|WARP\s*\+\s*Proxy MPD FFmpeg)\)/gi, '')
        .trim();

      const baseId = ch.id ? ch.id.replace(/_(?:warp|ffmpeg|mpd)$/i, '') : `ch_${Buffer.from(baseTitle + (ch.url || '')).toString('base64').substring(0, 16)}`;

      // 1. Canale con Proxy Cloudflare WARP SOCKS5 (client-side DRM / no FFmpeg)
      const chWarp = {
        ...ch,
        id: `${baseId}_warp`,
        title: `${baseTitle} [WARP SOCKS5]`,
        originalTitle: ch.originalTitle || ch.title || baseTitle,
        useWarp: true,
        streamMode: 'warp_direct',
        mpdProxy: false
      };

      // 2. Canale con Proxy Cloudflare WARP SOCKS5 + Proxy MPD ClearKey Centralizzato (FFmpeg Stream Copy)
      const chFfmpeg = {
        ...ch,
        id: `${baseId}_ffmpeg`,
        title: `${baseTitle} [WARP + Proxy MPD FFmpeg]`,
        originalTitle: ch.originalTitle || ch.title || baseTitle,
        useWarp: true,
        streamMode: 'ffmpeg_copy',
        mpdProxy: true
      };

      result.push(chWarp, chFfmpeg);
    } else {
      result.push(ch);
    }
  }
  return result;
}

function xorDecrypt(dataB64, key = 'my_secret_key') {
  try {
    const data = Buffer.from(dataB64, 'base64');
    const keyBytes = Buffer.from(key, 'utf-8');
    const out = Buffer.alloc(data.length);
    for (let i = 0; i < data.length; i++) {
      out[i] = data[i] ^ keyBytes[i % keyBytes.length];
    }
    return out.toString('utf-8');
  } catch (e) {
    return null;
  }
}

class NativeResolver {
  static async resolveSky(channelId) {
    try {
      const apiUrl = `https://test34344.herokuapp.com/filter.php?numTest=A1A159&id=${encodeURIComponent(channelId)}`;
      const res = await apiClient.get(apiUrl, { timeout: 6000 });
      if (!res.data || !res.data.data) return [];

      const decrypted = xorDecrypt(res.data.data, 'my_secret_key');
      if (!decrypted) return [];

      const data = JSON.parse(decrypted);
      const manifest = data.manifest || '';
      const kid = data.kid || '';
      const key = data.key || '';
      const clearkey = (kid && key) ? `${kid}:${key}` : '';

      const headers = 'User-Agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36&Referer=https://www.nowtv.it/&Origin=https://www.nowtv.it';

      const kodiProps = {
        'inputstream': 'inputstream.adaptive',
        'inputstream.adaptive.manifest_type': 'mpd',
        'inputstream.adaptive.stream_headers': headers,
        'inputstream.adaptive.manifest_headers': headers
      };
      if (clearkey) {
        kodiProps['inputstream.adaptive.license_type'] = 'org.w3.clearkey';
        kodiProps['inputstream.adaptive.license_key'] = clearkey;
      }

      return [{
        url: manifest,
        kodi_props: kodiProps,
        clearkey,
        headers
      }];
    } catch (err) {
      return [];
    }
  }

  static async resolveDaddy(codeIn) {
    const codeClean = codeIn.replace('stream-', '').replace('.php', '').trim();
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36';

    try {
      const pUrl = `https://dlhd.st/stream/stream-${codeClean}.php`;
      const res1 = await apiClient.get(pUrl, {
        headers: { 'User-Agent': ua, 'Referer': 'https://dlhd.st/' },
        timeout: 3000
      });

      const iframeMatches = res1.data.match(/<iframe src="([^"]+)"/i);
      if (iframeMatches && iframeMatches[1]) {
        const dadUrl = iframeMatches[1];
        const res2 = await apiClient.get(dadUrl, {
          headers: { 'User-Agent': ua, 'Referer': 'https://dlhd.st/' },
          timeout: 3000
        });

        const atobMatches = res2.data.match(/window\.atob\('([^']+)'\)/i);
        if (atobMatches && atobMatches[1]) {
          const directStream = Buffer.from(atobMatches[1], 'base64').toString('utf-8');
          const arrU = dadUrl.split('/');
          const refe = `${arrU[0]}//${arrU[2]}/`;
          const origin = `${arrU[0]}//${arrU[2]}`;
          const finalUrl = `${directStream}|referer=${refe}&origin=${origin}&user-agent=${ua}`;

          return [{
            url: finalUrl,
            headers: `User-Agent=${ua}&Referer=${refe}&Origin=${origin}`,
            kodi_props: {
              'inputstream': 'inputstream.adaptive',
              'inputstream.adaptive.manifest_type': 'hls'
            }
          }];
        }
      }
    } catch (e) {}

    // Fallback HLS diretto
    const directHls = `https://webufffit.mizhls.ru/lb/prima${codeClean}/index.m3u8`;
    const headersStr = 'Referer=https://1qwebplay.xyz/&Origin=https://1qwebplay.xyz&User-Agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
    return [{
      url: `${directHls}|${headersStr}`,
      headers: headersStr,
      kodi_props: {
        'inputstream': 'inputstream.adaptive',
        'inputstream.adaptive.manifest_type': 'hls'
      }
    }];
  }

  static async resolveFreeshot(codeIn) {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36';
    try {
      const authUrl = `https://wideiptv.top/player/${encodeURIComponent(codeIn)}`;
      const res = await apiClient.get(authUrl, {
        headers: {
          'User-Agent': ua,
          'Referer': 'https://thisnot.business/'
        },
        timeout: 5000
      });
      const match = res.data && typeof res.data === 'string' && res.data.match(/currentToken:\s*"([^"]+)"/);
      if (match && match[1]) {
        const token = match[1];
        const streamUrl = `https://ds164.bluetier.top/${codeIn}/tracks-v1a1/mono.m3u8?token=${token}`;
        const headers = `User-Agent=${ua}&Referer=https://wideiptv.top/`;
        return [{
          url: streamUrl,
          headers,
          kodi_props: {
            'inputstream': 'inputstream.adaptive',
            'inputstream.adaptive.manifest_type': 'hls',
            'inputstream.adaptive.stream_headers': headers
          }
        }];
      }
    } catch (e) {}

    // Fallback HLS
    const fallbackUrl = `https://ds164.bluetier.top/${codeIn}/tracks-v1a1/mono.m3u8`;
    return [{
      url: fallbackUrl,
      headers: `User-Agent=${ua}`,
      kodi_props: {
        'inputstream': 'inputstream.adaptive',
        'inputstream.adaptive.manifest_type': 'hls'
      }
    }];
  }

  static resolveMediahosting(parIn) {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36 OPR/133.0.0.0';
    const streamUrl = `https://p5.streamhostingcdn.top/stream/${parIn}/index.m3u8?token=aN7QrmHIoz60HOhI`;
    const headers = `User-Agent=${ua}&Referer=https://hostingmediapro.top/&Origin=https://hostingmediapro.top`;
    return [{
      url: streamUrl,
      headers,
      kodi_props: {
        'inputstream': 'inputstream.adaptive',
        'inputstream.adaptive.manifest_type': 'hls',
        'inputstream.adaptive.stream_headers': headers
      }
    }];
  }

  static resolveVavoo(param) {
    const cleanUrl = param.split('|')[0];
    const targetUrl = cleanUrl.endsWith('.m3u8') ? cleanUrl : `${cleanUrl}/index.m3u8`;
    const headers = 'User-Agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36&Referer=https://vavoo.to/&Origin=https://vavoo.to';
    return [{
      url: targetUrl,
      headers,
      kodi_props: {
        'inputstream': 'inputstream.adaptive',
        'inputstream.adaptive.manifest_type': 'hls',
        'inputstream.adaptive.stream_headers': headers
      }
    }];
  }

  static resolveFfmpeg(param) {
    let streamUrl = param;
    let headers = 'User-Agent=Mozilla/5.0';
    if (param.includes('|')) {
      const parts = param.split('|');
      streamUrl = parts[0];
      headers = parts[1];
    }
    return [{
      url: streamUrl,
      headers,
      kodi_props: {
        'inputstream': 'inputstream.adaptive',
        'inputstream.adaptive.manifest_type': 'hls'
      }
    }];
  }

  static async resolve(method, param) {
    if (method === 'sky') {
      const res = await this.resolveSky(param);
      if (res && res.length) return res;
    }

    if (['daddyCode', 'daddy', 'daddyFind', 'daddyP'].includes(method)) {
      const res = await this.resolveDaddy(param);
      if (res && res.length) return res;
    }

    if (['freeshot'].includes(method)) {
      const res = await this.resolveFreeshot(param);
      if (res && res.length) return res;
    }

    if (['mediahosting'].includes(method)) {
      const res = this.resolveMediahosting(param);
      if (res && res.length) return res;
    }

    if (['vavooPlay', 'vavoo'].includes(method)) {
      const res = this.resolveVavoo(param);
      if (res && res.length) return res;
    }

    if (['ffmpeg', 'ffmpeg_noRef', 'ffmpeg_daily'].includes(method)) {
      const res = this.resolveFfmpeg(param);
      if (res && res.length) return res;
    }

    if (['amstaff', 'daznToken'].includes(method)) {
      try {
        let decodedStr = param;
        if (!param.startsWith('http')) {
          let pad = param.length % 4;
          if (pad > 0) param += '='.repeat(4 - pad);
          decodedStr = Buffer.from(param, 'base64').toString('utf-8');
        }

        const parts = decodedStr.split('|');
        const streamUrl = parts[0];
        let clearkey = parts.length > 1 ? parts[1].trim() : '';
        // 0000 o 0:0 indicano stream in chiaro / assenza di chiavi DRM
        if (['0000', '0:0', '0', 'none', 'null'].includes(clearkey.toLowerCase())) {
          clearkey = '';
        }

        // Il Referer DAZN è richiesto SOLO per stream effettivamente ospitati su DAZN
        const isDazn = streamUrl.toLowerCase().includes('dazn');
        let headers = '';
        if (isDazn) {
          headers = 'User-Agent=Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.41 (KHTML, like Gecko) Large Screen Safari/537.41 LG Browser/7.00.00(LGE; WEBOS1; 05.06.10; 1); webOS.TV-2014; LG NetCast.TV-2013 Compatible (LGE, WEBOS1, wireless)&Referer=https://www.dazn.com/&Origin=https://www.dazn.com';
        } else {
          headers = 'User-Agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
        }

        const kodiProps = {
          'inputstream': 'inputstream.adaptive',
          'inputstream.adaptive.manifest_type': 'mpd'
        };
        if (headers) {
          kodiProps['inputstream.adaptive.stream_headers'] = headers;
          kodiProps['inputstream.adaptive.manifest_headers'] = headers;
        }
        if (clearkey) {
          kodiProps['inputstream.adaptive.license_type'] = 'org.w3.clearkey';
          kodiProps['inputstream.adaptive.license_key'] = clearkey;
        }

        return [{
          url: streamUrl,
          kodi_props: kodiProps,
          clearkey,
          headers
        }];
      } catch (e) {}
    }

    if (method === 'antena') {
      return [{
        url: `https://antena.lat/live/${param}/playlist.m3u8`,
        headers: 'Referer=https://antena.lat/&User-Agent=Mozilla/5.0',
        kodi_props: { 'inputstream': 'inputstream.adaptive', 'inputstream.adaptive.manifest_type': 'hls' }
      }];
    }

    return [{
      url: param && param.startsWith('http') ? param : `#MYRESOLVE:${method}:${param}`,
      kodi_props: {}
    }];
  }
}


class ExtractorEngine {
  constructor(options = {}) {
    this.concurrency = options.concurrency || 25;
    this.visitedUrls = new Set();
    this.channels = [];
    this.logs = [];
  }

  log(msg) {
    const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
    console.log(line);
    this.logs.push(line);
    if (this.logs.length > 300) this.logs.shift();
  }

  parseM3U(m3uText, defaultGroup = 'M3U') {
    const entries = [];
    const regex = /#EXTINF:(.*?),(.*?)$[\r\n]+(http.*?:\/\/.*?)(?=$|[\r\n])/gm;
    let match;

    while ((match = regex.exec(m3uText)) !== null) {
      const infoTag = match[1];
      const titleRaw = match[2];
      const streamUrl = match[3].trim();

      const title = stripKodiTags(titleRaw);
      const logoMatch = infoTag.match(/tvg-logo="([^"]*)"/i);
      const logo = logoMatch ? logoMatch[1] : '';

      const groupMatch = infoTag.match(/group-title="([^"]*)"/i);
      const group = groupMatch ? stripKodiTags(groupMatch[1]) : defaultGroup;

      entries.push({
        id: `ch_${Buffer.from(title + streamUrl).toString('base64').substring(0, 16)}`,
        title,
        url: streamUrl,
        logo,
        group,
        enabled: true,
        source: 'm3u'
      });
    }

    return entries;
  }

  async crawlNode(data, currentGroup = 'Generale', depth = 0, maxDepth = 3) {
    if (depth > maxDepth || typeof data !== 'object' || !data) return;

    const promises = [];

    // 1. Channels
    if (Array.isArray(data.channels)) {
      for (const ch of data.channels) {
        if (!ch || ch.enabled === false) continue;
        const chName = stripKodiTags(ch.name || currentGroup);
        const groupLabel = (currentGroup !== chName) ? `${currentGroup} - ${chName}` : currentGroup;
        if (Array.isArray(ch.items)) {
          promises.push(this.crawlNode(ch, groupLabel, depth + 1, maxDepth));
        }
      }
    }

    // 2. Items
    if (Array.isArray(data.items)) {
      let currentSubGroup = '';
      for (const item of data.items) {
        if (!item || item.enabled === false) continue;

        const rawTitle = item.title || 'Senza Titolo';
        const title = stripKodiTags(rawTitle);
        const thumb = item.thumbnail || '';

        let linkVal = item.link || '';
        const hasExecutable = Boolean(
          (linkVal && linkVal !== 'ignoreme' && linkVal !== 'ignore') ||
          item.myresolve ||
          item.externallink ||
          item.externallink2 ||
          item.m3u ||
          item.acelocal ||
          item.acehls
        );

        if (!hasExecutable) {
          // Intestazione / categoria (es. "=== SERIE A ENILIVE ===" o "=== COPPA ITALIA ===")
          let headerName = title.replace(/^[\s=–—\-]+|[\s=–—\-]+$/g, '').trim();
          if (headerName && !headerName.toLowerCase().includes('server is up') && headerName.length > 1) {
            currentSubGroup = headerName;
          }
          continue;
        }

        if (linkVal === 'ignoreme' || linkVal === 'ignore') linkVal = '';

        let group = currentGroup;
        if (currentSubGroup) {
          group = `${currentGroup} - ${currentSubGroup}`;
        }

        if (linkVal && linkVal.startsWith('acestream://')) {
          const aceHash = linkVal.replace('acestream://', '').trim();
          const aceHttpUrl = `http://127.0.0.1:6878/ace/getstream?id=${aceHash}`;
          this.channels.push({
            id: `ch_${Buffer.from(title + linkVal).toString('base64').substring(0, 16)}`,
            title,
            url: aceHttpUrl,
            rawUrl: linkVal,
            logo: thumb,
            group,
            kodi_props: {
              'inputstream': 'inputstream.adaptive',
              'inputstream.adaptive.manifest_type': 'hls'
            },
            enabled: true,
            source: 'acestream'
          });
        } else if (linkVal && !linkVal.startsWith('plugin://')) {
          this.channels.push({
            id: `ch_${Buffer.from(title + linkVal).toString('base64').substring(0, 16)}`,
            title,
            url: linkVal,
            logo: thumb,
            group,
            enabled: true,
            source: 'direct'
          });
        } else if (item.acelocal) {
          const aceUrl = `http://127.0.0.1:6878/ace/getstream?id=${item.acelocal}`;
          this.channels.push({
            id: `ch_${Buffer.from(title + aceUrl).toString('base64').substring(0, 16)}`,
            title: `[ACE] ${title}`,
            url: aceUrl,
            logo: thumb,
            group: `${group} - AceStream`,
            enabled: true,
            source: 'acestream'
          });
        } else if (item.acehls) {
          const aceUrl = `http://127.0.0.1:6878/ace/manifest.m3u8?id=${item.acehls}`;
          this.channels.push({
            id: `ch_${Buffer.from(title + aceUrl).toString('base64').substring(0, 16)}`,
            title: `[ACE-HLS] ${title}`,
            url: aceUrl,
            logo: thumb,
            group: `${group} - AceStream`,
            enabled: true,
            source: 'acestream'
          });
        } else if (item.m3u) {
          const m3uUrl = item.m3u;
          if (!this.visitedUrls.has(m3uUrl)) {
            this.visitedUrls.add(m3uUrl);
            promises.push((async () => {
              try {
                const res = await apiClient.get(m3uUrl, { timeout: 8000 });
                if (res.data && typeof res.data === 'string') {
                  const parsed = this.parseM3U(res.data, `${group} - ${title}`);
                  this.channels.push(...parsed);
                }
              } catch (e) {
                this.channels.push({
                  id: `ch_${Buffer.from(title + m3uUrl).toString('base64').substring(0, 16)}`,
                  title: `[Playlist] ${title}`,
                  url: m3uUrl,
                  logo: thumb,
                  group: `${group} - Liste M3U`,
                  enabled: true,
                  source: 'm3u'
                });
              }
            })());
          }
        } else if (item.externallink || item.externallink2) {
          const extUrl = item.externallink || item.externallink2;
          if (!this.visitedUrls.has(extUrl)) {
            this.visitedUrls.add(extUrl);
            promises.push((async () => {
              try {
                const res = await apiClient.get(extUrl, { timeout: 8000 });
                if (res.data) {
                  await this.crawlNode(res.data, `${group} - ${title}`, depth + 1, maxDepth);
                }
              } catch (e) {}
            })());
          }
        } else if (item.myresolve) {
          const resolveStr = item.myresolve;
          let method = '';
          let param = '';
          if (resolveStr.includes('@@')) {
            const arr = resolveStr.split('@@');
            method = arr[0];
            param = arr[1];
          } else if (resolveStr.includes(':')) {
            const arr = resolveStr.split(':');
            method = arr[0];
            param = arr[1];
          } else {
            method = resolveStr;
          }

          promises.push((async () => {
            const resolved = await NativeResolver.resolve(method, param);
            for (const r of resolved) {
              const chTitle = title || r.title || '';
              const chUrl = r.url || '';
              const needsWarp = (chTitle.toUpperCase().includes('WARP') || chUrl.includes('asn%3A13335') || chUrl.includes('asn:13335') || chUrl.includes('13335'));
              this.channels.push({
                id: `ch_${Buffer.from(title + r.url).toString('base64').substring(0, 16)}`,
                title,
                url: r.url,
                logo: thumb,
                group,
                kodi_props: r.kodi_props || {},
                clearkey: r.clearkey || '',
                headers: r.headers || '',
                enabled: true,
                useWarp: needsWarp,
                source: 'resolver'
              });
            }
          })());
        }
      }
    }

    if (promises.length > 0) {
      await Promise.all(promises);
    }
  }

  async runExtraction(selectedSourceIds = []) {
    this.channels = [];
    this.visitedUrls.clear();

    const sources = CATALOG_SECTIONS.filter(s =>
      selectedSourceIds.length === 0 || selectedSourceIds.includes(s.id)
    );

    this.log(`Inizio estrazione da ${sources.length} sezioni selezionate in parallelo...`);

    await Promise.all(sources.map(async (sec) => {
      this.log(`[+] Scansione sezione: ${sec.name}`);
      try {
        if (sec.url && sec.url.includes('htsport.org')) {
          const HTSportService = require('./htsport');
          const htsportChannels = await HTSportService.scrapeChannels();
          this.channels.push(...htsportChannels);
          this.log(`  -> [${sec.name}] Estratti ${htsportChannels.length} canali live HTSport`);
        } else if (sec.url.endsWith('.m3u') || sec.url.endsWith('.m3u8')) {
          const res = await apiClient.get(sec.url, { timeout: 10000 });
          if (res.data && typeof res.data === 'string') {
            const parsed = this.parseM3U(res.data, sec.group);
            this.channels.push(...parsed);
            this.log(`  -> [${sec.name}] Estratti ${parsed.length} canali M3U`);
          }
        } else {
          const before = this.channels.length;
          const res = await apiClient.get(sec.url, { timeout: 10000 });
          if (res.data) {
            await this.crawlNode(res.data, sec.group, 0, 3);
          }

          // Scansione URL extra/correlati alla sezione (es. eventi live collegati)
          if (Array.isArray(sec.extraUrls)) {
            for (const extraUrl of sec.extraUrls) {
              try {
                this.log(`  -> [${sec.name}] Scansione lista live correlata: ${extraUrl}`);
                const extraRes = await apiClient.get(extraUrl, { timeout: 10000 });
                if (extraRes.data) {
                  await this.crawlNode(extraRes.data, sec.group, 0, 3);
                }
              } catch (e) {
                this.log(`  [!] Errore su lista extra ${extraUrl}: ${e.message}`);
              }
            }
          }

          const added = this.channels.length - before;
          this.log(`  -> [${sec.name}] Estratti ${added} canali/stream totali`);
        }
      } catch (err) {
        this.log(`  [!] Errore su ${sec.name}: ${err.message}`);
      }
    }));

    this.channels = processWarpChannels(this.channels);
    this.log(`Estrazione completata! Totale canali estratti: ${this.channels.length}`);
    return this.channels;
  }

  generateM3U(channels = [], customChannels = [], customGroupOrder = [], epgUrl = '/epg.xml', baseUrl = '', tokenParam = '') {
    let m3u = epgUrl ? `#EXTM3U url-tvg="${epgUrl}" x-tvg-url="${epgUrl}"\n` : '#EXTM3U\n';

    const allChannels = processWarpChannels([...customChannels, ...channels]).filter(ch => ch.enabled !== false);

    // 1. Raggruppa i canali per group-title normalizzato
    const groupsMap = new Map();
    for (const ch of allChannels) {
      const g = sanitizeGroupName(ch.customGroup || ch.group || 'Generale');
      if (!groupsMap.has(g)) {
        groupsMap.set(g, []);
      }
      groupsMap.get(g).push(ch);
    }

    // 2. Determina l'ordinamento dei gruppi:
    // Prima i gruppi presenti in customGroupOrder (nell'ordine specificato),
    // poi eventuali gruppi mancanti ordinati alfabeticamente.
    const sortedGroupNames = [];
    if (Array.isArray(customGroupOrder) && customGroupOrder.length > 0) {
      for (const g of customGroupOrder) {
        if (groupsMap.has(g) && !sortedGroupNames.includes(g)) {
          sortedGroupNames.push(g);
        }
      }
    }
    const remainingGroups = Array.from(groupsMap.keys())
      .filter(g => !sortedGroupNames.includes(g))
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    sortedGroupNames.push(...remainingGroups);

    // 3. Genera la playlist M3U con canali rigorosamente raggruppati e numerati con tvg-chno
    let channelNumber = 1;
    for (const groupName of sortedGroupNames) {
      const groupChannels = groupsMap.get(groupName) || [];
      for (const ch of groupChannels) {
        const title = (ch.customTitle || ch.title || 'Senza Titolo').trim();
        const logo = ch.customLogo || ch.logo || '';
        const tvgId = ch.tvgId || ch.tvg_id || '';
        const url = ch.url || '';
        const kodiProps = ch.kodi_props || {};
        const clearkey = ch.clearkey || '';
        const headers = ch.headers || '';

        // Riscrittura canali AceStream e MPD ClearKey tramite il proxy HTTP di MandraKodi
        let finalUrl = url;
        let isAce = false;
        let isMpdProxy = false;
        let proxyEnabled = true;
        let aceHost = '127.0.0.1:6878';
        let mpdProxyEnabled = true;
        let cfg = null;
        try {
          cfg = require('./storage').getConfig();
          if (cfg) {
            if (cfg.aceStreamProxyEnabled !== undefined) proxyEnabled = cfg.aceStreamProxyEnabled;
            if (cfg.aceStreamHost) aceHost = cfg.aceStreamHost;
            if (cfg.mpdProxyEnabled !== undefined) mpdProxyEnabled = cfg.mpdProxyEnabled;
          }
        } catch (e) {}

        let aceHash = '';
        if (url.startsWith('acestream://')) {
          aceHash = url.replace('acestream://', '').split(/[?#|]/)[0].trim();
        } else if (url.includes(':6878/ace/') || url.includes('/ace/getstream') || url.includes('/ace/manifest.m3u8')) {
          const match = url.match(/[?&]id=([a-f0-9]+)/i);
          if (match) aceHash = match[1];
        }

        // I canali HTSport non devono MAI passare attraverso proxy (né WARP né proxy segmenti in produzione)
        const isHtsport = (ch.source === 'htsport') ||
          (groupName && groupName.toLowerCase().includes('htsport')) ||
          (ch.group && ch.group.toLowerCase().includes('htsport')) ||
          (url && (url.includes('htsport') || url.includes('tvnow') || url.includes('chunk.tvnow247')));

        // Helper per verificare se un gruppo è incluso nella configurazione WARP (case-insensitive)
        const isGroupInWarp = (g) => {
          if (!g || !Array.isArray(cfg.warpGroups)) return false;
          const lower = g.trim().toLowerCase();
          if (lower.includes('htsport')) return false; // Esclusione tassativa HTSport da WARP
          return cfg.warpGroups.some(wg => wg && wg.trim().toLowerCase() === lower);
        };

        // Verifica se il canale deve usare il proxy Cloudflare WARP (per singolo canale, modalità stream o gruppo)
        const isWarpActive = !isHtsport && !!(
          ch.useWarp === true ||
          ch.streamMode === 'warp_direct' ||
          ch.streamMode === 'ffmpeg_copy' ||
          (title && title.toUpperCase().includes('WARP')) ||
          (url && (url.includes('asn%3A13335') || url.includes('asn:13335') || url.includes('13335'))) ||
          (cfg && cfg.warpEnabled && (
            isGroupInWarp(groupName) ||
            isGroupInWarp(ch.group) ||
            isGroupInWarp(ch.customGroup)
          ))
        );
        const warpQueryParam = isWarpActive ? 'warp=1' : '';

        const appendParam = (uri, q) => {
          if (!q) return uri;
          return uri.includes('?') ? `${uri}&${q}` : `${uri}?${q}`;
        };

        if (aceHash) {
          isAce = true;
          if (baseUrl && proxyEnabled) {
            finalUrl = `${baseUrl}/stream/ace/${aceHash}.ts${tokenParam || ''}`;
          } else {
            finalUrl = `http://${aceHost}/ace/getstream?id=${aceHash}`;
          }
        } else {
          const hasClearKey = clearkey && !['0000', '0:0', '0'].includes(String(clearkey).trim());
          const isFfmpegCopy = ch.mpdProxy === true || ch.streamMode === 'ffmpeg_copy';
          const isDirectWarp = ch.mpdProxy === false || ch.streamMode === 'warp_direct';

          if (!isDirectWarp && hasClearKey && baseUrl && (mpdProxyEnabled || isFfmpegCopy) && ch.id) {
            isMpdProxy = true;
            let streamPath = `${baseUrl}/stream/mpd/${ch.id}.ts`;
            if (warpQueryParam) streamPath = appendParam(streamPath, warpQueryParam);
            finalUrl = `${streamPath}${tokenParam ? (streamPath.includes('?') ? '&' + tokenParam.slice(1) : tokenParam) : ''}`;
          } else if (isWarpActive && baseUrl && !isHtsport && !url.includes('/stream/htsport/')) {
            // Se WARP è attivo su questo gruppo/canale (inclusa la variante WARP SOCKS5 diretta)
            const isM3u8 = url.includes('.m3u8') || (kodiProps && kodiProps['inputstream.adaptive.manifest_type'] === 'hls');
            const isMpd = url.includes('.mpd') || (kodiProps && kodiProps['inputstream.adaptive.manifest_type'] === 'mpd');
            let streamPath = isMpd ? `${baseUrl}/api/stream/proxy.mpd` : (isM3u8 ? `${baseUrl}/api/stream/proxy.m3u8` : `${baseUrl}/api/stream/proxy`);
            const qParams = new URLSearchParams({ id: ch.id, url, warp: '1' });
            if (headers) qParams.set('headers', headers);
            finalUrl = `${streamPath}?${qParams.toString()}${tokenParam ? '&' + tokenParam.slice(1) : ''}`;
          }
        }

        // Riscrittura canali HTSport legacy se necessario: MAI passare per WARP
        if (url.startsWith('/stream/htsport/') || url.includes('/stream/htsport/')) {
          if (baseUrl) {
            let relPath = url.includes('/stream/htsport/') ? '/stream/htsport/' + url.split('/stream/htsport/')[1] : url;
            // Rimuove tassativamente qualsiasi parametro warp residuo per i canali HTSport
            relPath = relPath.replace(/[?&]warp=[^&]+/g, '').replace(/\?&/, '?').replace(/\?$/, '');
            finalUrl = `${baseUrl}${relPath}${tokenParam ? (relPath.includes('?') ? '&' + tokenParam.slice(1) : tokenParam) : ''}`;
          }
        }

        m3u += `#EXTINF:-1 tvg-id="${tvgId}" tvg-name="${title}" tvg-logo="${logo}" group-title="${groupName}" tvg-chno="${channelNumber}",${title}\n`;
        channelNumber++;

        if (isAce || isMpdProxy) {
          // Stream MPEG-TS diretto fornito dal proxy MandraKodi per massima compatibilità
          m3u += `#KODIPROP:mimetype=video/mp2t\n`;
          m3u += `#EXTVLCOPT:network-caching=2000\n`;
        } else if (kodiProps && Object.keys(kodiProps).length > 0) {
          for (const [k, v] of Object.entries(kodiProps)) {
            // Salta chiavi fittizie (0000, 0:0, 0)
            if (k === 'inputstream.adaptive.license_key' && (!v || ['0000', '0:0', '0'].includes(String(v).trim()))) continue;
            if (k === 'inputstream.adaptive.license_type') {
              const lk = kodiProps['inputstream.adaptive.license_key'];
              if (!lk || ['0000', '0:0', '0'].includes(String(lk).trim())) continue;
            }

            // Rimuovi referer DAZN se il canale non è DAZN
            let cleanVal = v;
            if (typeof cleanVal === 'string' && cleanVal.includes('dazn.com') && !url.toLowerCase().includes('dazn')) {
              cleanVal = cleanVal
                .replace(/&Referer=https?:\/\/[^&]*dazn[^&]*/gi, '')
                .replace(/&Origin=https?:\/\/[^&]*dazn[^&]*/gi, '');
            }

            m3u += `#KODIPROP:${k}=${cleanVal}\n`;
          }
        } else if (clearkey && !['0000', '0:0', '0'].includes(String(clearkey).trim())) {
          m3u += `#KODIPROP:inputstream=inputstream.adaptive\n`;
          m3u += `#KODIPROP:inputstream.adaptive.manifest_type=mpd\n`;
          m3u += `#KODIPROP:inputstream.adaptive.license_type=org.w3.clearkey\n`;
          m3u += `#KODIPROP:inputstream.adaptive.license_key=${clearkey}\n`;
        }

        if (!isAce) {
          if (headers && headers.includes('Referer=')) {
            const isDaznRef = /Referer=https?:\/\/[^&]*dazn/i.test(headers);
            if (!isDaznRef || url.toLowerCase().includes('dazn')) {
              const refMatch = headers.match(/Referer=([^&]+)/i);
              if (refMatch) m3u += `#EXTVLCOPT:http-referrer=${decodeURIComponent(refMatch[1])}\n`;
            }
          }
          if (headers && headers.includes('User-Agent=')) {
            const uaMatch = headers.match(/User-Agent=([^&]+)/i);
            if (uaMatch) m3u += `#EXTVLCOPT:http-user-agent=${decodeURIComponent(uaMatch[1])}\n`;
          }
        }

        m3u += `${finalUrl}\n`;
      }
    }

    return m3u;
  }

  async checkStreamHealth(rawUrl, headersStr = '', timeoutMs = 3500) {
    if (!rawUrl || rawUrl.startsWith('#MYRESOLVE')) {
      return { status: 'offline', code: 0, error: 'Unresolved stream' };
    }

    // Estrai URL effettivo se contiene pipe con header
    let targetUrl = rawUrl;
    let customHeaders = { 'User-Agent': 'Mozilla/5.0' };

    if (rawUrl.includes('|')) {
      const parts = rawUrl.split('|');
      targetUrl = parts[0];
      const params = new URLSearchParams(parts[1]);
      if (params.get('Referer') || params.get('referer')) customHeaders['Referer'] = params.get('Referer') || params.get('referer');
      if (params.get('Origin') || params.get('origin')) customHeaders['Origin'] = params.get('Origin') || params.get('origin');
      if (params.get('User-Agent') || params.get('user-agent')) customHeaders['User-Agent'] = params.get('User-Agent') || params.get('user-agent');
    } else if (headersStr) {
      if (headersStr.includes('Referer=')) {
        const m = headersStr.match(/Referer=([^&]+)/i);
        if (m) customHeaders['Referer'] = decodeURIComponent(m[1]);
      }
      if (headersStr.includes('User-Agent=')) {
        const m = headersStr.match(/User-Agent=([^&]+)/i);
        if (m) customHeaders['User-Agent'] = decodeURIComponent(m[1]);
      }
    }

    try {
      const startTime = Date.now();
      const res = await apiClient.get(targetUrl, {
        headers: customHeaders,
        timeout: timeoutMs,
        responseType: 'stream',
        validateStatus: (s) => s >= 200 && s < 400
      });

      const responseTime = Date.now() - startTime;
      if (res.data && typeof res.data.destroy === 'function') res.data.destroy();

      return {
        status: 'online',
        code: res.status,
        latency: `${responseTime}ms`
      };
    } catch (err) {
      return {
        status: 'offline',
        code: err.response ? err.response.status : 0,
        error: err.message
      };
    }
  }
}

module.exports = {
  CATALOG_SECTIONS,
  NativeResolver,
  ExtractorEngine,
  sanitizeGroupName,
  processWarpChannels
};

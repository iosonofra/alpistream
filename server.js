const express = require('express');
const axios = require('axios');
const compression = require('compression');
const path = require('path');
const http = require('http');
const https = require('https');
const net = require('net');
const { spawn, exec } = require('child_process');
const crypto = require('crypto');

// Gestione globale eccezioni per prevenire crash del server su disconnessione client / socket EPIPE
process.on('uncaughtException', (err) => {
  console.error('[Process Exception]', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Process Rejection]', reason);
});

let SocksProxyAgent;
try {
  SocksProxyAgent = require('socks-proxy-agent').SocksProxyAgent;
} catch (e) {
  console.warn('[WARP Proxy] Modulo socks-proxy-agent non trovato. Esegui npm install sul server.');
}

const storage = require('./services/storage');
const { CATALOG_SECTIONS, ExtractorEngine, sanitizeGroupName } = require('./services/extractor');
const epgManager = require('./services/epg');
const eventsManager = require('./services/events');
const scheduler = require('./services/scheduler');
const HTSportService = require('./services/htsport');

// Persistent HTTP/HTTPS Keep-Alive Agents per abbattere la latenza di handshake sui segmenti video
const httpKeepAliveAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 64,
  maxFreeSockets: 16,
  timeout: 30000
});

const httpsKeepAliveAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 64,
  maxFreeSockets: 16,
  timeout: 30000
});

let cachedWarpAgent = null;
let cachedWarpUrl = null;

// Helper per ottenere l'agente proxy Cloudflare WARP SOCKS5 con connessione persistente Keep-Alive
function getWarpAgent() {
  if (!SocksProxyAgent) return null;
  const cfg = storage.getConfig();
  const rawHost = (cfg && cfg.warpHost) || '127.0.0.1:40000';
  const proxyUrl = rawHost.includes('://') ? rawHost : `socks5h://${rawHost}`;
  if (cachedWarpAgent && cachedWarpUrl === proxyUrl) {
    return cachedWarpAgent;
  }
  try {
    cachedWarpAgent = new SocksProxyAgent(proxyUrl, {
      keepAlive: true,
      maxSockets: 64,
      maxFreeSockets: 16,
      timeout: 30000
    });
    cachedWarpUrl = proxyUrl;
    return cachedWarpAgent;
  } catch (err) {
    console.error(`[WARP Proxy] Errore inizializzazione SocksProxyAgent: ${err.message}`);
    return null;
  }
}

const app = express();
app.set('trust proxy', true);
const config = storage.getConfig();
const PORT = process.env.PORT || config.port || 3000;

app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Route dedicata per l'interfaccia Smart TV a 10 piedi (LG webOS / TiviMate style)
app.get(['/tv', '/tv/'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'tv', 'index.html'));
});

// Middleware per verifica opzionale del token su link remoti
function verifyToken(req, res, next) {
  const cfg = storage.getConfig();
  if (!cfg.authToken) return next();
  const token = req.query.token || req.headers['x-auth-token'];
  if (token === cfg.authToken) return next();
  return res.status(401).send('#EXTM3U\n# Error: Accesso non autorizzato. Token mancante o errato.\n');
}

// -------------------------------------------------------------
// 1. ENDPOINTS REMOTI PER IPTV CLIENT (TiviMate, Kodi, VLC)
// -------------------------------------------------------------

// Playlist M3U Principale
app.get(['/playlist.m3u', '/playlist', '/live.m3u', '/iosonofratv.m3u', '/mandrakodi.m3u'], verifyToken, (req, res) => {
  const channels = storage.getChannels();
  const customChannels = storage.getCustomChannels();
  const groupOrder = storage.getGroupOrder();
  const extractor = new ExtractorEngine();
  const cfg = storage.getConfig();

  const host = req.get('host');
  const isRelative = req.query.relative === '1' || req.query.relative === 'true';
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const baseUrl = host && !isRelative ? `${protocol}://${host}` : '';
  const tokenParam = req.query.token ? `?token=${encodeURIComponent(req.query.token)}` : (cfg.authToken ? `?token=${encodeURIComponent(cfg.authToken)}` : '');

  // URL EPG: per i client remoti (TiviMate, Kodi Simple IPTV, VLC, ecc.)
  // costruiamo l'URL assoluto completo (es. http://192.168.1.100:3000/epg.xml) comprensivo
  // di eventuale token di autenticazione, in modo che la guida funzioni automaticamente in remoto.
  let epgUrl = req.query.epg_url || req.query.epg;
  if (!epgUrl) {
    if (baseUrl) {
      epgUrl = `${baseUrl}/epg.xml${tokenParam}`;
    } else {
      epgUrl = tokenParam ? `/epg.xml${tokenParam}` : '/epg.xml';
    }
  }

  const m3uContent = extractor.generateM3U(channels, customChannels, groupOrder, epgUrl, baseUrl, tokenParam);

  res.setHeader('Content-Type', 'application/x-mpegurl; charset=utf-8');
  res.setHeader('Content-Disposition', 'inline; filename="iosonofratv.m3u"');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.send(m3uContent);
});

// Guida Programmi EPG XMLTV
app.get(['/epg.xml', '/epg', '/epg.xmltv'], verifyToken, (req, res) => {
  const epgContent = epgManager.getEPGContent();
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Content-Disposition', 'inline; filename="epg.xml"');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.send(epgContent);
});

// -------------------------------------------------------------
// 2. API REST PER IL PANNELLO DI CONTROLLO WEB
// -------------------------------------------------------------

// Stato del Sistema
app.get('/api/status', (req, res) => {
  const cfg = storage.getConfig();
  const channels = storage.getChannels();
  const customChannels = storage.getCustomChannels();
  const status = scheduler.getStatus();

  const enabledCount = channels.filter(c => c.enabled !== false).length + customChannels.filter(c => c.enabled !== false).length;

  res.json({
    status: 'online',
    version: '1.0.0',
    port: PORT,
    totalChannels: channels.length + customChannels.length,
    enabledChannels: enabledCount,
    activeSources: cfg.activeSources || [],
    cronSchedule: cfg.cronSchedule,
    cronEnabled: cfg.cronEnabled,
    isExtracting: status.isExtracting,
    lastExtractionTime: status.lastExtractionTime,
    logs: status.logs,
    authTokenConfigured: Boolean(cfg.authToken)
  });
});

// Catalogo Sorgenti
app.get('/api/sources', (req, res) => {
  const cfg = storage.getConfig();
  res.json({
    catalog: CATALOG_SECTIONS,
    active: cfg.activeSources || []
  });
});

// Aggiornamento Sorgenti Attive
app.post('/api/sources', (req, res) => {
  const { activeSources } = req.body;
  if (!Array.isArray(activeSources)) {
    return res.status(400).json({ error: 'activeSources deve essere un array' });
  }
  const cfg = storage.getConfig();
  cfg.activeSources = activeSources;
  storage.saveConfig(cfg);
  res.json({ success: true, activeSources });
});

// Lista Canali con ricerca e filtri
app.get('/api/channels', (req, res) => {
  const { group, search, status, page = 1, limit = 50 } = req.query;
  const channels = storage.getChannels();
  const customChannels = storage.getCustomChannels();
  const rawAll = [...channels, ...customChannels];
  const groups = [...new Set(rawAll.map(c => sanitizeGroupName(c.customGroup || c.group || 'Generale')))].filter(Boolean).sort();

  let all = [...rawAll];

  // Filtro gruppo
  if (group && group !== 'ALL') {
    all = all.filter(ch => sanitizeGroupName(ch.customGroup || ch.group || 'Generale') === group || ch.group === group);
  }

  // Filtro stato
  if (status === 'enabled') {
    all = all.filter(ch => ch.enabled !== false);
  } else if (status === 'disabled') {
    all = all.filter(ch => ch.enabled === false);
  }

  // Filtro ricerca
  if (search) {
    const q = search.toLowerCase();
    all = all.filter(ch =>
      (ch.title && ch.title.toLowerCase().includes(q)) ||
      (ch.group && ch.group.toLowerCase().includes(q)) ||
      (ch.tvgId && ch.tvgId.toLowerCase().includes(q))
    );
  }

  // Paginazione
  const isAll = limit === 'all' || limit === '0' || req.query.all === '1' || req.query.all === 'true';
  const pageNum = parseInt(page, 10) || 1;
  const limitNum = isAll ? all.length : (parseInt(limit, 10) || 50);
  const total = all.length;
  const start = isAll ? 0 : (pageNum - 1) * limitNum;
  const items = isAll ? all : all.slice(start, start + limitNum);

  res.json({
    total,
    page: isAll ? 1 : pageNum,
    limit: limitNum,
    totalPages: isAll ? 1 : Math.ceil(total / limitNum),
    groups,
    channels: items
  });
});

// Modifica singolo canale
app.put('/api/channels/:id', (req, res) => {
  const { id } = req.params;
  const { title, group, logo, tvgId, enabled, useWarp, mpdProxy, streamMode } = req.body;

  const channels = storage.getChannels();
  let found = false;

  const updated = channels.map(ch => {
    if (ch.id === id) {
      found = true;
      return {
        ...ch,
        customTitle: title !== undefined ? title : ch.customTitle,
        title: title !== undefined ? title : ch.title,
        customGroup: group !== undefined ? group : ch.customGroup,
        group: group !== undefined ? group : ch.group,
        customLogo: logo !== undefined ? logo : ch.customLogo,
        logo: logo !== undefined ? logo : ch.logo,
        tvgId: tvgId !== undefined ? tvgId : ch.tvgId,
        enabled: enabled !== undefined ? enabled : ch.enabled,
        useWarp: useWarp !== undefined ? !!useWarp : ch.useWarp,
        mpdProxy: mpdProxy !== undefined ? !!mpdProxy : ch.mpdProxy,
        streamMode: streamMode !== undefined ? streamMode : ch.streamMode
      };
    }
    return ch;
  });

  if (found) {
    storage.saveChannels(updated);
    return res.json({ success: true });
  }

  // Prova nei canali custom
  const custom = storage.getCustomChannels();
  const updatedCustom = custom.map(ch => {
    if (ch.id === id) {
      found = true;
      return {
        ...ch,
        title: title !== undefined ? title : ch.title,
        group: group !== undefined ? group : ch.group,
        logo: logo !== undefined ? logo : ch.logo,
        tvgId: tvgId !== undefined ? tvgId : ch.tvgId,
        enabled: enabled !== undefined ? enabled : ch.enabled,
        useWarp: useWarp !== undefined ? !!useWarp : ch.useWarp,
        mpdProxy: mpdProxy !== undefined ? !!mpdProxy : ch.mpdProxy,
        streamMode: streamMode !== undefined ? streamMode : ch.streamMode
      };
    }
    return ch;
  });

  if (found) {
    storage.saveCustomChannels(updatedCustom);
    return res.json({ success: true });
  }

  res.status(404).json({ error: 'Canale non trovato' });
});

// Bulk Action (Abilita/Disabilita tutto o per gruppo)
app.post('/api/channels/bulk', (req, res) => {
  const { action, group } = req.body; // action: 'enable_all' | 'disable_all'
  const channels = storage.getChannels();

  const updated = channels.map(ch => {
    if (!group || group === 'ALL' || ch.group === group) {
      return { ...ch, enabled: action === 'enable_all' };
    }
    return ch;
  });

  storage.saveChannels(updated);
  res.json({ success: true, count: updated.length });
});

// Aggiunta Canale Personalizzato
app.post('/api/custom-channels', (req, res) => {
  const { title, url, group, logo, tvgId } = req.body;
  if (!title || !url) {
    return res.status(400).json({ error: 'Titolo e URL sono obbligatori' });
  }

  const custom = storage.getCustomChannels();
  const newChannel = {
    id: `custom_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    title,
    url,
    group: group || 'Personalizzati',
    logo: logo || '',
    tvgId: tvgId || epgManager.getAutoTvgId(title),
    enabled: true,
    isCustom: true
  };

  custom.push(newChannel);
  storage.saveCustomChannels(custom);
  res.json({ success: true, channel: newChannel });
});

// Trigger Estrazione Manuale
app.post('/api/extract', async (req, res) => {
  if (scheduler.isExtracting) {
    return res.status(409).json({ error: 'Estrazione già in corso' });
  }

  // Rispondi subito e avvia il task in background
  res.json({ success: true, message: 'Estrazione avviata in background' });
  await scheduler.triggerExtraction();
});

// Aggiornamento EPG Manuale
app.post('/api/epg/update', async (req, res) => {
  res.json({ success: true, message: 'Aggiornamento EPG avviato' });
  await epgManager.updateEPG();
});

// Stato EPG e Statistiche Cache
app.get('/api/epg/status', (req, res) => {
  const status = epgManager.getStatus();
  res.json({ success: true, ...status });
});

// Salvataggio Sorgenti EPG
app.post('/api/epg/sources', (req, res) => {
  const { sources } = req.body;
  if (!Array.isArray(sources)) {
    return res.status(400).json({ error: 'sources deve essere un array' });
  }
  const config = storage.getConfig();
  config.epgSources = sources;
  storage.saveConfig(config);
  res.json({ success: true, epgSources: config.epgSources });
});

// -------------------------------------------------------------
// 3. STREAMING PROXY PER WEB PLAYER (CORS & Referer Bypass)
// -------------------------------------------------------------
app.options(['/api/stream/proxy.mpd', '/api/stream/proxy.m3u8', '/api/stream/proxy'], (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.sendStatus(204);
});

app.get(['/api/stream/proxy.mpd', '/api/stream/proxy.m3u8', '/api/stream/proxy'], async (req, res) => {
  let { url, referer, origin, ua } = req.query;

  // Risoluzione canale tramite ID se url non è specificato
  if (!url && req.query.id) {
    const cleanId = req.query.id.replace(/\.(mpd|m3u8|ts)$/i, '');
    const channels = storage.getChannels();
    const custom = storage.getCustomChannels();
    const all = [...custom, ...channels];
    let ch = all.find(c => c.id === cleanId || c.id === `${cleanId}_warp` || (c.id && c.id.startsWith(cleanId)));
    if (ch) {
      url = ch.url;
      if (!referer && ch.headers && ch.headers.includes('Referer=')) {
        const m = ch.headers.match(/Referer=([^&]+)/i);
        if (m) referer = decodeURIComponent(m[1]);
      }
      if (!origin && ch.headers && ch.headers.includes('Origin=')) {
        const m = ch.headers.match(/Origin=([^&]+)/i);
        if (m) origin = decodeURIComponent(m[1]);
      }
      if (!ua && ch.headers && ch.headers.includes('User-Agent=')) {
        const m = ch.headers.match(/User-Agent=([^&]+)/i);
        if (m) ua = decodeURIComponent(m[1]);
      }
      if (ch.useWarp || (ch.title && /WARP/i.test(ch.title))) {
        req.query.warp = '1';
      }
    }
  }

  if (!url) return res.status(400).send('Missing stream URL');

  // Protezione anti-loop / unwrap: se url punta ricorsivamente al nostro stesso proxy, estrai il target effettivo
  while (url && (url.includes('/api/stream/proxy') || url.includes('%2Fapi%2Fstream%2Fproxy'))) {
    try {
      const decoded = decodeURIComponent(url);
      const m = decoded.match(/[?&]url=([^&]+)/);
      if (m && m[1]) {
        url = decodeURIComponent(m[1]);
      } else {
        break;
      }
    } catch (e) {
      break;
    }
  }

  const cfg = storage.getConfig();
  let useWarp = req.query.warp === '1' || req.query.warp === 'true';

  if (!useWarp && cfg && cfg.warpEnabled && Array.isArray(cfg.warpGroups) && cfg.warpGroups.length > 0) {
    const isGroupInWarp = (g) => {
      if (!g) return false;
      const lower = g.trim().toLowerCase();
      return cfg.warpGroups.some(wg => {
        if (!wg) return false;
        const wgl = wg.trim().toLowerCase();
        return wgl === lower || lower.includes(wgl) || wgl.includes(lower);
      });
    };
    const channels = storage.getChannels();
    const custom = storage.getCustomChannels();
    const all = [...custom, ...channels];
    const cleanU = url.split('?')[0];
    const ch = all.find(c => c.url && (c.url.split('?')[0] === cleanU || url.includes(c.url.split('?')[0])));
    if (ch) {
      const rawG = ch.customGroup || ch.group || '';
      const cleanG = sanitizeGroupName(rawG);
      if (ch.useWarp || isGroupInWarp(rawG) || isGroupInWarp(cleanG)) {
        useWarp = true;
      }
    }
  }

  try {
    const headers = {
      'User-Agent': ua || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
      'Accept': '*/*'
    };
    if (referer) headers['Referer'] = referer;
    if (origin) headers['Origin'] = origin;
    if (req.headers.range) headers['Range'] = req.headers.range;

    const axios = require('axios');
    const axiosOpts = {
      headers,
      responseType: 'stream',
      timeout: 15000,
      validateStatus: (s) => s >= 200 && s < 400,
      httpAgent: httpKeepAliveAgent,
      httpsAgent: httpsKeepAliveAgent
    };
    if (useWarp) {
      const agent = getWarpAgent();
      if (agent) {
        axiosOpts.httpAgent = agent;
        axiosOpts.httpsAgent = agent;
      }
    }

    const response = await axios.get(url, axiosOpts);

    req.on('close', () => {
      if (response && response.data && typeof response.data.destroy === 'function') {
        response.data.destroy();
      }
    });

    const isMpd = url.includes('.mpd') || (response.headers['content-type'] && response.headers['content-type'].includes('xml'));
    const isM3u8 = url.includes('.m3u8') || (response.headers['content-type'] && (response.headers['content-type'].includes('mpegurl') || response.headers['content-type'].includes('x-mpegURL')));

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
    res.setHeader('X-Accel-Buffering', 'no');

    if (isMpd) {
      const chunks = [];
      response.data.on('data', chunk => chunks.push(chunk));
      response.data.on('end', () => {
        let xml = Buffer.concat(chunks).toString('utf-8');

        // 1. Inietta tag W3C ClearKey UUID affinché tutti i browser (Chrome, Firefox, Safari, Edge) accettino la riproduzione EME
        const clearKeyTag = '<ContentProtection schemeIdUri="urn:uuid:1077efec-c0b2-4d02-ace3-3c1e52e2fb4b" value="ClearKey1.0"/>';
        if (!xml.includes('1077efec-c0b2-4d02-ace3-3c1e52e2fb4b')) {
          if (xml.includes('urn:mpeg:dash:mp4protection:2011')) {
            xml = xml.replace(/(<ContentProtection[^>]*schemeIdUri="urn:mpeg:dash:mp4protection:2011"[^>]*\/>|<\/ContentProtection>)/i, (m) => `${m}\n            ${clearKeyTag}`);
          } else if (/urn:uuid:(edef8ba9-79d6-4ace-a3c8-27dcd51d21ed|9a04f079-9840-4286-ab92-e65be0885f95)/i.test(xml)) {
            xml = xml.replace(/(<ContentProtection\b[^>]*\/>|<\/ContentProtection>)/i, (m) => `${m}\n            ${clearKeyTag}`);
          } else {
            xml = xml.replace(/(<AdaptationSet\b[^>]*>)/gi, `$1\n        ${clearKeyTag}`);
          }
        }

        // 2. Inietta o normalizza BaseURL per i segmenti:
        // Se useWarp è attivo, registra la sessione in dashSegmentSessions e inietta il BaseURL del proxy MandraKodi
        // per consentire a Kodi (inputstream.adaptive), OTT Navigator, TiviMate e Web Player di scaricare i segmenti via WARP
        if (useWarp) {
          const sessionId = crypto.createHash('md5').update(url).digest('hex').substring(0, 12);

          let cdnBase = url.substring(0, url.lastIndexOf('/') + 1);
          const periodMatches = [...xml.matchAll(/<BaseURL>([^<]+)<\/BaseURL>/gi)];
          if (periodMatches.length > 0) {
            const lastBase = periodMatches[periodMatches.length - 1][1].trim();
            try {
              cdnBase = new URL(lastBase, url).href;
            } catch (e) {
              cdnBase = lastBase;
            }
          }

          dashSegmentSessions.set(sessionId, {
            cdnBaseUrl: cdnBase,
            targetUrl: url,
            useWarp: true,
            headers: {
              ...headers,
              'User-Agent': ua || headers['User-Agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
              'Referer': referer || 'https://dazn.com/',
              'Origin': origin || 'https://dazn.com'
            },
            createdAt: Date.now(),
            lastAccess: Date.now()
          });

          // Determina il BaseURL del proxy visibile dal client
          const clientBaseUrl = `${req.protocol}://${req.get('host')}`;
          const proxyBaseUrl = `${clientBaseUrl}/internal/dash-seg/${sessionId}/`;

          // Rimuovi vecchi BaseURL e inietta proxyBaseUrl sia su MPD che Period
          xml = xml.replace(/<BaseURL>[^<]+<\/BaseURL>/gi, '');
          xml = xml.replace(/(<Period\b[^>]*>)/gi, `$1\n    <BaseURL>${proxyBaseUrl}</BaseURL>`);
          xml = xml.replace(/(<MPD\b[^>]*>)/i, `$1\n  <BaseURL>${proxyBaseUrl}</BaseURL>`);
        } else {
          // Comportamento standard non-WARP: inietta BaseURL assoluto se assente
          let remoteBaseDir = url;
          if (remoteBaseDir.includes('?')) remoteBaseDir = remoteBaseDir.split('?')[0];
          const lastSlash = remoteBaseDir.lastIndexOf('/');
          if (lastSlash !== -1) {
            remoteBaseDir = remoteBaseDir.substring(0, lastSlash + 1);
          }

          if (!xml.includes('<BaseURL')) {
            xml = xml.replace(/(<MPD[^>]*>)/i, `$1\n    <BaseURL>${remoteBaseDir}</BaseURL>`);
          } else {
            // Se BaseURL è presente ma relativo (non http:// né https://)
            xml = xml.replace(/<BaseURL\b[^>]*>(?!https?:\/\/)([\s\S]*?)<\/BaseURL>/gi, (m, inner) => {
              const cleanRel = (inner || '').trim().replace(/^\.\//, '');
              return `<BaseURL>${remoteBaseDir}${cleanRel}</BaseURL>`;
            });
          }
        }

        res.setHeader('Content-Type', 'application/dash+xml; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Content-Length', Buffer.byteLength(xml, 'utf-8'));
        res.status(200).send(xml);
      });
      return;
    }

    if (isM3u8 && useWarp) {
      const chunks = [];
      response.data.on('data', chunk => chunks.push(chunk));
      response.data.on('end', () => {
        let m3u8Str = Buffer.concat(chunks).toString('utf-8');
        const host = req.get('host');
        const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
        const baseUrl = `${protocol}://${host}`;
        let baseDir = url;
        if (baseDir.includes('?')) baseDir = baseDir.split('?')[0];
        const lastSlash = baseDir.lastIndexOf('/');
        baseDir = lastSlash !== -1 ? baseDir.substring(0, lastSlash + 1) : '';

        m3u8Str = m3u8Str.replace(/^(?!#)(.+)$/gm, (m) => {
          const absUrl = (m.startsWith('http://') || m.startsWith('https://')) ? m : `${baseDir}${m}`;
          const p = new URLSearchParams({ url: absUrl, warp: '1' });
          if (referer) p.set('referer', referer);
          if (origin) p.set('origin', origin);
          if (ua) p.set('ua', ua);
          const isSubM3u8 = absUrl.includes('.m3u8');
          const proxyEndpoint = isSubM3u8 ? '/api/stream/proxy.m3u8' : '/api/stream/proxy';
          return `${baseUrl}${proxyEndpoint}?${p.toString()}`;
        });

        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Content-Length', Buffer.byteLength(m3u8Str, 'utf-8'));
        res.status(200).send(m3u8Str);
      });
      return;
    }

    if (response.headers['content-type']) {
      res.setHeader('Content-Type', response.headers['content-type']);
    }
    if (response.headers['content-range']) {
      res.setHeader('Content-Range', response.headers['content-range']);
    }
    if (response.headers['accept-ranges']) {
      res.setHeader('Accept-Ranges', response.headers['accept-ranges']);
    }
    if (response.headers['content-length']) {
      res.setHeader('Content-Length', response.headers['content-length']);
    }

    // Segmenti video/audio: permetti caching locale nel browser per evitare re-fetch
    if (isM3u8) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=60');
    }

    res.status(response.status);
    response.data.pipe(res);
  } catch (err) {
    if (!res.headersSent) {
      res.status(502).send(`Proxy Error: ${err.message}`);
    }
  }
});

// -------------------------------------------------------------
// 3b. PROXY HTTP CENTRALIZZATO ACESTREAM (Zero Engine sui Client)
// -------------------------------------------------------------

// Funzione core di proxying continuo MPEG-TS
function streamAceEngine(hash, req, res) {
  const cleanHash = (hash || '').replace(/\.ts$/i, '').trim();
  if (!/^[a-f0-9]{40}$/i.test(cleanHash)) {
    return res.status(400).send('Hash AceStream non valido (deve contenere 40 caratteri esadecimali).');
  }

  const cfg = storage.getConfig();
  const aceHost = cfg.aceStreamHost || '127.0.0.1:6878';
  const parts = aceHost.split(':');
  const host = parts[0] || '127.0.0.1';
  const port = parseInt(parts[1], 10) || 6878;

  let activeClientReq = null;

  // Chiusura immediata della richiesta ad Ace Engine quando il client si disconnette
  req.on('close', () => {
    console.log(`[AceStream Proxy] Client disconnesso per hash ${cleanHash}. Interruzione stream.`);
    if (activeClientReq) {
      activeClientReq.destroy();
    }
  });

  function requestStream(requestPath, redirectCount = 0) {
    if (redirectCount > 5) {
      if (!res.headersSent) {
        res.status(508).send('Troppi redirect da Ace Stream Engine.');
      }
      return;
    }

    console.log(`[AceStream Proxy] Connessione ad Ace Engine (${host}:${port}${requestPath}) per hash ${cleanHash}...`);

    const clientReq = http.request({
      hostname: host,
      port: port,
      path: requestPath,
      method: 'GET',
      insecureHTTPParser: true,
      headers: {
        'User-Agent': 'MandraKodi-AceStreamProxy/2.0',
        'Accept': '*/*'
      },
      timeout: 45000 // 45 secondi per consentire l'aggancio dei peer P2P e pre-buffering
    }, (aceRes) => {
      // Segui automaticamente eventuali redirect 301, 302, 303, 307, 308 emessi da Ace Engine
      if (aceRes.statusCode >= 300 && aceRes.statusCode < 400 && aceRes.headers.location) {
        let redirectLocation = aceRes.headers.location;
        console.log(`[AceStream Proxy] Ricevuto redirect ${aceRes.statusCode} verso ${redirectLocation}`);
        
        try {
          if (redirectLocation.startsWith('http://') || redirectLocation.startsWith('https://')) {
            const parsedUrl = new URL(redirectLocation);
            redirectLocation = parsedUrl.pathname + parsedUrl.search;
          }
        } catch (e) {
          // fallback su stringa originale
        }

        aceRes.resume(); // consuma il body della risposta di redirect
        return requestStream(redirectLocation, redirectCount + 1);
      }

      if (aceRes.statusCode >= 400) {
        console.warn(`[AceStream Proxy] Risposta HTTP ${aceRes.statusCode} da Ace Engine per hash ${cleanHash}`);
        res.status(aceRes.statusCode);
        aceRes.pipe(res);
        return;
      }

      res.writeHead(200, {
        'Content-Type': aceRes.headers['content-type'] || 'video/mp2t',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
        'Connection': 'keep-alive'
      });

      aceRes.pipe(res);

      aceRes.on('error', (err) => {
        console.error(`[AceStream Proxy] Errore flusso dati: ${err.message}`);
        if (!res.headersSent) res.status(502).send('Errore streaming da Ace Engine');
        res.end();
      });
    });

    activeClientReq = clientReq;

    clientReq.on('timeout', () => {
      console.warn(`[AceStream Proxy] Timeout di connessione ad Ace Engine (${host}:${port}) per hash ${cleanHash}`);
      clientReq.destroy();
      if (!res.headersSent) {
        res.status(504).send('Timeout: Ace Stream Engine non ha risposto in tempo (buffer lento o assenza di peer)');
      }
    });

    clientReq.on('error', (err) => {
      console.error(`[AceStream Proxy] Impossibile contattare Ace Engine (${host}:${port}): ${err.message}`);
      if (!res.headersSent) {
        res.status(502).json({
          error: 'Ace Stream Engine non raggiungibile',
          host: aceHost,
          details: err.message,
          hint: 'Verifica che Ace Stream Engine sia attivo su questo host/porta (configurabile in Impostazioni).'
        });
      }
    });

    clientReq.end();
  }

  requestStream(`/ace/getstream?id=${encodeURIComponent(cleanHash)}`);
}

// 1. Endpoint standard REST per client IPTV / Kodi / VLC / Browser
app.get(['/stream/ace/:hash.ts', '/stream/ace/:hash', '/stream/ace'], verifyToken, (req, res) => {
  const rawHash = req.params.hash || req.query.id || req.query.hash;
  const hash = (rawHash || '').replace(/\.ts$/i, '');
  streamAceEngine(hash, req, res);
});

// 2. Endpoint HLS: /stream/ace/:hash/manifest.m3u8 e /ace/manifest.m3u8
app.get(['/stream/ace/:hash/manifest.m3u8', '/ace/manifest.m3u8'], verifyToken, async (req, res) => {
  const hash = req.params.hash || req.query.id || req.query.hash;
  const cleanHash = (hash || '').trim();
  if (!/^[a-f0-9]{40}$/i.test(cleanHash)) {
    return res.status(400).send('Hash AceStream non valido.');
  }

  const cfg = storage.getConfig();
  const aceHost = cfg.aceStreamHost || '127.0.0.1:6878';
  const targetUrl = `http://${aceHost}/ace/manifest.m3u8?id=${encodeURIComponent(cleanHash)}`;

  try {
    const axios = require('axios');
    const response = await axios.get(targetUrl, {
      timeout: 30000,
      headers: { 'Accept': '*/*' },
      responseType: 'text'
    });

    let manifest = response.data;
    // Riscrivi eventuali percorsi assoluti dell'engine con il proxy locale di MandraKodi
    manifest = manifest.replace(new RegExp(`http://${aceHost}/ace/`, 'gi'), '/ace/');

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(manifest);
  } catch (err) {
    if (!res.headersSent) {
      res.status(502).send(`Ace HLS Error: ${err.message}`);
    }
  }
});

// 3. Endpoint di compatibilità diretta Ace Engine (/ace/getstream e segmenti /ace/*)
app.all('/ace/*', (req, res) => {
  // Se è richiesta getstream via query param (?id=...)
  if (req.path === '/ace/getstream') {
    const hash = req.query.id || req.query.hash || req.query.infohash;
    return streamAceEngine(hash, req, res);
  }

  // Altrimenti, proxy trasparente per qualsiasi risorsa Ace Engine (segmenti chunk ts, ecc.)
  const cfg = storage.getConfig();
  const aceHost = cfg.aceStreamHost || '127.0.0.1:6878';
  const parts = aceHost.split(':');
  const host = parts[0] || '127.0.0.1';
  const port = parseInt(parts[1], 10) || 6878;

  const targetPath = req.url; // include query params

  const clientReq = http.request({
    hostname: host,
    port: port,
    path: targetPath,
    method: req.method,
    insecureHTTPParser: true,
    headers: {
      ...req.headers,
      host: aceHost
    },
    timeout: 30000
  }, (aceRes) => {
    res.writeHead(aceRes.statusCode, {
      ...aceRes.headers,
      'Access-Control-Allow-Origin': '*'
    });
    aceRes.pipe(res);
  });

  clientReq.on('error', (err) => {
    if (!res.headersSent) {
      res.status(502).send(`AceEngine Proxy Error: ${err.message}`);
    }
  });

  req.on('close', () => {
    clientReq.destroy();
  });

  req.pipe(clientReq);
});

// 4. API Diagnostica Stato Ace Stream Engine
app.get('/api/acestream/status', (req, res) => {
  const cfg = storage.getConfig();
  const aceHost = cfg.aceStreamHost || '127.0.0.1:6878';
  const parts = aceHost.split(':');
  const host = parts[0] || '127.0.0.1';
  const port = parseInt(parts[1], 10) || 6878;

  const start = Date.now();
  const socket = new net.Socket();
  let responded = false;
  socket.setTimeout(3000);

  socket.on('connect', () => {
    if (responded) return;
    responded = true;
    const pingMs = Date.now() - start;
    socket.destroy();
    res.json({
      success: true,
      online: true,
      host: aceHost,
      proxyEnabled: cfg.aceStreamProxyEnabled !== false,
      pingMs,
      message: `Ace Stream Engine attivo e raggiungibile (${pingMs} ms)`
    });
  });

  socket.on('timeout', () => {
    if (responded) return;
    responded = true;
    socket.destroy();
    res.json({
      success: false,
      online: false,
      host: aceHost,
      proxyEnabled: cfg.aceStreamProxyEnabled !== false,
      message: 'Timeout: Ace Stream Engine non risponde entro 3000ms'
    });
  });

  socket.on('error', (err) => {
    if (responded) return;
    responded = true;
    socket.destroy();
    res.json({
      success: false,
      online: false,
      host: aceHost,
      proxyEnabled: cfg.aceStreamProxyEnabled !== false,
      message: `Non raggiungibile: ${err.message}`
    });
  });

  socket.connect(port, host);
});

// 5. API Diagnostica Stato Cloudflare WARP SOCKS5
app.get('/api/warp/status', async (req, res) => {
  const cfg = storage.getConfig();
  const warpHost = (cfg && cfg.warpHost) || '127.0.0.1:40000';
  const start = Date.now();

  try {
    const agent = getWarpAgent();
    if (!agent) {
      return res.json({
        success: false,
        online: false,
        host: warpHost,
        error: !SocksProxyAgent ? 'Dipendenza npm socks-proxy-agent non ancora installata.' : 'Configurazione proxy WARP non valida.',
        hint: !SocksProxyAgent ? "Esegui './alpine/update.sh' sul container Alpine per installare le dipendenze npm e riavviare MandraKodi." : "Verifica l'indirizzo Host:Porta inserito."
      });
    }

    const resp = await axios.get('https://www.cloudflare.com/cdn-cgi/trace', {
      httpAgent: agent,
      httpsAgent: agent,
      timeout: 6000
    });

    const pingMs = Date.now() - start;
    const traceData = {};
    String(resp.data).split('\n').forEach(line => {
      const idx = line.indexOf('=');
      if (idx > 0) {
        const k = line.substring(0, idx).trim();
        const v = line.substring(idx + 1).trim();
        traceData[k] = v;
      }
    });

    const isWarp = traceData.warp === 'on' || traceData.warp === 'plus';

    res.json({
      success: true,
      online: true,
      isWarp,
      ip: traceData.ip || 'Sconosciuto',
      colo: traceData.colo || 'N/D',
      loc: traceData.loc || 'N/D',
      warpType: traceData.warp || 'off',
      pingMs,
      enabled: cfg.warpEnabled !== false,
      host: warpHost,
      message: isWarp
        ? `Cloudflare WARP attivo (IP: ${traceData.ip}, PoP: ${traceData.colo}, ${pingMs} ms)`
        : `Proxy SOCKS5 connesso, ma WARP non attivo su Cloudflare (${traceData.ip})`
    });
  } catch (err) {
    res.json({
      success: false,
      online: false,
      host: warpHost,
      error: `Proxy non raggiungibile su ${warpHost}: ${err.message}`,
      hint: "Verifica che il servizio warp-svc sia attivo sul container Alpine ('rc-service warp-svc status') o esegui './alpine/setup-warp.sh'."
    });
  }
});

// -------------------------------------------------------------
// 3c. PROXY HTTP CENTRALIZZATO MPD CLEARKEY (FFmpeg Stream Copy)
// -------------------------------------------------------------

// Funzione per selezionare la migliore rappresentazione video (risoluzione e bitrate massimi)
function getBestVideoRepresentation(reps) {
  let bestRep = reps[0];
  let maxBandwidth = -1;
  let maxHeight = -1;

  for (const rep of reps) {
    const bwMatch = rep.match(/bandwidth="(\d+)"/i);
    const heightMatch = rep.match(/height="(\d+)"/i);
    const bw = bwMatch ? parseInt(bwMatch[1], 10) : 0;
    const h = heightMatch ? parseInt(heightMatch[1], 10) : 0;

    // Seleziona la risoluzione più alta (es. 1080p > 720p > 216p)
    // e a parità di risoluzione il bandwidth più alto (es. 1080p50 10Mbps > 1080p25 5Mbps)
    if (h > maxHeight || (h === maxHeight && bw > maxBandwidth)) {
      maxHeight = h;
      maxBandwidth = bw;
      bestRep = rep;
    }
  }
  return bestRep;
}

// Risolutore robusto di URL per segmenti DASH relativi / assoluti
function resolveSegmentUrl(filename, cdnBase, targetUrl) {
  if (!filename) return '';
  if (filename.startsWith('http://') || filename.startsWith('https://')) {
    return filename;
  }
  let absoluteBase = '';
  if (cdnBase) {
    try {
      absoluteBase = new URL(cdnBase, targetUrl).href;
    } catch (e) {
      absoluteBase = '';
    }
  }
  if (!absoluteBase && targetUrl) {
    try {
      absoluteBase = new URL('./', targetUrl).href;
    } catch (e) {
      absoluteBase = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
    }
  }
  return new URL(filename, absoluteBase).href;
}

// Gestione sessioni segmenti DASH proxy (per canali WARP e bypass restrizioni CDN)
const dashSegmentSessions = new Map();

// Pulizia periodica sessioni DASH inattive (ogni 2 minuti)
setInterval(() => {
  const now = Date.now();
  for (const [sId, sess] of dashSegmentSessions.entries()) {
    if (now - sess.lastAccess > 120000) {
      dashSegmentSessions.delete(sId);
    }
  }
}, 120000);

// Funzione di ottimizzazione del manifest MPD per eliminare micro-buffering, stuttering e forzare 1080p full HD
function cleanAndBufferMpd(manifest, targetUrl, sessionId, port) {
  let cleaned = typeof manifest !== 'string' ? String(manifest) : manifest;

  // 1. Gestione BaseURL per i segmenti
  if (sessionId) {
    const session = dashSegmentSessions.get(sessionId);
    if (session) {
      // Estrai il BaseURL effettivo della CDN dal manifest originale
      const periodMatches = [...cleaned.matchAll(/<BaseURL>([^<]+)<\/BaseURL>/gi)];
      let rawBase = '';
      if (periodMatches.length > 1) {
        rawBase = periodMatches[periodMatches.length - 1][1].trim();
      } else if (periodMatches.length === 1) {
        rawBase = periodMatches[0][1].trim();
      }

      if (rawBase) {
        try {
          session.cdnBaseUrl = new URL(rawBase, targetUrl).href;
        } catch (e) {
          session.cdnBaseUrl = rawBase;
        }
      } else {
        try {
          session.cdnBaseUrl = new URL('./', targetUrl).href;
        } catch (e) {
          session.cdnBaseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
        }
      }

      // Rimuovi tutti i vecchi tag BaseURL
      cleaned = cleaned.replace(/<BaseURL>[^<]+<\/BaseURL>/gi, '');

      // Inietta il nuovo BaseURL puntato al proxy locale sia a livello MPD che Period
      const localBaseUrl = `http://127.0.0.1:${port || PORT}/internal/dash-seg/${sessionId}/`;
      cleaned = cleaned.replace(/<Period\b([^>]*)>/gi, `<Period$1>\n    <BaseURL>${localBaseUrl}</BaseURL>`);
      cleaned = cleaned.replace(/<MPD\b([^>]*)>/i, `<MPD$1>\n  <BaseURL>${localBaseUrl}</BaseURL>`);
    }
  } else {
    // Comportamento standard per non-WARP: inietta BaseURL assoluto se assente
    if (!cleaned.includes('<BaseURL>') && !cleaned.includes('<BaseURL ')) {
      const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
      cleaned = cleaned.replace(/<Period\b/i, `<BaseURL>${baseUrl}</BaseURL>\n  <Period`);
    }
  }

  // 2. In ogni AdaptationSet video (riconosciuto da contentType="video", mimeType="video/..." o attributo width/height),
  // isola e mantieni SOLO la Representation a massima risoluzione/bitrate (es. 1080p 50fps a 10 Mbps).
  // Questo elimina sia i tentativi di downgrade/ABR di FFmpeg sia il blocco a 216p/360p della prima traccia!
  cleaned = cleaned.replace(/<AdaptationSet\b([\s\S]*?)<\/AdaptationSet>/gi, (match) => {
    const isVideo = /contentType="video"/i.test(match) || /mimeType="video\//i.test(match) || /width="\d+"/i.test(match);
    if (!isVideo) return match;

    const openingTagMatch = match.match(/<AdaptationSet\b[^>]*>/i);
    const openingTag = openingTagMatch ? openingTagMatch[0] : '<AdaptationSet>';
    const content = match.replace(/<AdaptationSet\b[^>]*>/i, '').replace(/<\/AdaptationSet>/i, '');

    const reps = content.match(/<Representation[\s\S]*?<\/Representation>/gi) || [];
    if (reps.length > 1) {
      const bestRep = getBestVideoRepresentation(reps);
      const withoutReps = content.replace(/<Representation[\s\S]*?<\/Representation>/gi, '');
      return `${openingTag}${withoutReps}\n      ${bestRep}\n    </AdaptationSet>`;
    }
    return match;
  });

  // 3. Per l'audio, mantieni solo il primo AdaptationSet audio (evita download paralleli e conflitti di tracce)
  let keptAudio = false;
  cleaned = cleaned.replace(/<AdaptationSet\b([\s\S]*?)<\/AdaptationSet>/gi, (match) => {
    const isAudio = /contentType="audio"/i.test(match) || /mimeType="audio\//i.test(match);
    if (!isAudio) return match;

    if (!keptAudio) {
      keptAudio = true;
      return match;
    }
    return '';
  });

  // 4. Trimming di sicurezza del SegmentTimeline (1-2 segmenti di margine)
  // Garantisce che ogni segmento richiesto da FFmpeg sia già presente sulla CDN senza svuotare la sliding window
  cleaned = cleaned.replace(/<SegmentTimeline>([\s\S]*?)<\/SegmentTimeline>/gi, (m) => {
    const sTags = m.match(/<S\b[^>]*\/?>/g) || [];
    if (sTags.length <= 4) return m;
    const keep = sTags.slice(0, sTags.length - 2);
    return "<SegmentTimeline>\n              " + keep.join("\n              ") + "\n            </SegmentTimeline>";
  });

  return cleaned;
}

// Endpoint proxy segmenti DASH (.dash / .m4s / init segment)
app.get('/internal/dash-seg/:sessionId/*', async (req, res) => {
  res.on('error', () => {});
  req.on('error', () => {});
  try {
    const sessionId = req.params.sessionId;
    const filename = req.params[0];
    const session = dashSegmentSessions.get(sessionId);

    if (!session) {
      return res.status(404).send('Sessione DASH non trovata o scaduta');
    }
    session.lastAccess = Date.now();

    let targetSegmentUrl;
    try {
      targetSegmentUrl = resolveSegmentUrl(filename, session.cdnBaseUrl, session.targetUrl);
    } catch (e) {
      console.error(`[DASH Segment Proxy] Errore risoluzione URL segmento "${filename}": ${e.message}`);
      return res.status(400).send(`URL segmento non valido: ${e.message}`);
    }

    const axiosOpts = {
      responseType: 'arraybuffer',
      timeout: 15000,
      headers: session.headers || {}
    };
    if (session.useWarp) {
      const agent = getWarpAgent();
      if (agent) {
        axiosOpts.httpAgent = agent;
        axiosOpts.httpsAgent = agent;
      }
    } else {
      axiosOpts.httpAgent = httpKeepAliveAgent;
      axiosOpts.httpsAgent = httpsKeepAliveAgent;
    }

    const response = await axios.get(targetSegmentUrl, axiosOpts);
    if (!res.headersSent && !res.writableEnded) {
      res.writeHead(200, {
        'Content-Type': response.headers['content-type'] || 'video/mp4',
        'Content-Length': response.data.length,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=60'
      });
      res.end(response.data);
    }
  } catch (err) {
    console.error(`[DASH Segment Proxy] Errore fetch: ${err.message}`);
    if (!res.headersSent && !res.writableEnded) {
      res.status(502).send(err.message);
    }
  }
});

// Endpoint interno proxy manifest MPD con live buffer e selezione traccia
app.get('/internal/mpd', async (req, res) => {
  const targetUrl = req.query.url;
  const headersStr = req.query.headers;
  const sessionId = req.query.sessionId;
  const cfg = storage.getConfig();
  let useWarp = req.query.warp === '1' || req.query.warp === 'true';
  if (!useWarp && cfg && cfg.warpEnabled && targetUrl) {
    if (targetUrl.includes('asn%3A13335') || targetUrl.includes('asn:13335') || targetUrl.includes('13335')) {
      useWarp = true;
    }
  }
  if (!targetUrl) return res.status(400).send('URL mancante');

  try {
    const reqHeaders = {};
    if (headersStr) {
      const pairs = headersStr.split('&');
      for (const p of pairs) {
        const [k, ...v] = p.split('=');
        if (k && v.length) reqHeaders[k.trim()] = v.join('=').trim();
      }
    }
    const axiosOpts = {
      headers: reqHeaders,
      timeout: 10000,
      responseType: 'text',
      httpAgent: httpKeepAliveAgent,
      httpsAgent: httpsKeepAliveAgent
    };
    if (useWarp) {
      const agent = getWarpAgent();
      if (agent) {
        axiosOpts.httpAgent = agent;
        axiosOpts.httpsAgent = agent;
      }
    }
    const response = await axios.get(targetUrl, axiosOpts);

    let effectiveSessionId = sessionId;
    if (useWarp && !effectiveSessionId) {
      effectiveSessionId = crypto.createHash('md5').update(targetUrl).digest('hex').substring(0, 16);
      if (!dashSegmentSessions.has(effectiveSessionId)) {
        dashSegmentSessions.set(effectiveSessionId, {
          targetUrl,
          headers: reqHeaders,
          useWarp: true,
          cdnBaseUrl: '',
          createdAt: Date.now(),
          lastAccess: Date.now()
        });
      }
    }

    const processed = cleanAndBufferMpd(response.data, targetUrl, effectiveSessionId, PORT);
    res.setHeader('Content-Type', 'application/dash+xml; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(processed);
  } catch (e) {
    res.status(502).send(`Errore fetch MPD: ${e.message}`);
  }
});

// Mappa delle sessioni proxy MPD attive condivise (Anti-Buffering & Multi-Client)
const activeMpdStreams = new Map();

function streamMpdClearKey(channelIdOrUrl, queryKey, queryHeaders, req, res) {
  let targetUrl = '';
  let clearkey = '';
  let headersStr = '';
  let title = 'Live Stream';

  const cleanId = (channelIdOrUrl && !channelIdOrUrl.startsWith('http'))
    ? channelIdOrUrl.replace(/\.ts$/i, '')
    : channelIdOrUrl;

  // 1. Cerca canale per ID nel database se fornito
  let ch = null;
  if (cleanId && !cleanId.startsWith('http')) {
    const channels = storage.getChannels();
    const custom = storage.getCustomChannels();
    const all = [...custom, ...channels];
    ch = all.find(c =>
      c.id === cleanId ||
      c.id === channelIdOrUrl ||
      c.id === `${cleanId}_ffmpeg` ||
      c.id === `${cleanId}_warp` ||
      (c.id && c.id.startsWith(cleanId))
    );

    // Controlla anche negli eventi se non trovato nei canali standard
    if (!ch && eventsManager) {
      try {
        const evData = eventsManager.getEvents();
        if (evData && Array.isArray(evData.events)) {
          for (const ev of evData.events) {
            const matched = [...(ev.officialChannels || []), ...(ev.directStreams || [])].find(c =>
              c.id === cleanId ||
              c.id === channelIdOrUrl ||
              c.id === `${cleanId}_ffmpeg` ||
              c.id === `${cleanId}_warp` ||
              (c.id && c.id.startsWith(cleanId))
            );
            if (matched) {
              ch = matched;
              break;
            }
          }
        }
      } catch (e) {}
    }

    if (ch) {
      targetUrl = ch.url;
      clearkey = ch.clearkey || (ch.kodi_props ? ch.kodi_props['inputstream.adaptive.license_key'] : '');
      headersStr = ch.headers || '';
      title = ch.customTitle || ch.title || title;
      if (ch.useWarp || (ch.title && /WARP/i.test(ch.title))) {
        req.query.warp = '1';
      }
    }
  }

  // Fallback da parametri query
  if (!targetUrl && channelIdOrUrl && channelIdOrUrl.startsWith('http')) {
    targetUrl = channelIdOrUrl;
  }
  if (!clearkey && queryKey) {
    clearkey = queryKey;
  }
  if (!headersStr && queryHeaders) {
    headersStr = queryHeaders;
  }

  if (!targetUrl) {
    return res.status(400).send('URL MPD o Canale non valido.');
  }

  // Estrai la chiave a 16 byte (32 caratteri esadecimali)
  let keyHex = '';
  if (clearkey) {
    const cleanK = String(clearkey).trim();
    if (cleanK.includes(':')) {
      const parts = cleanK.split(':');
      keyHex = parts[1].trim();
    } else {
      keyHex = cleanK;
    }
    if (keyHex.includes(',')) {
      keyHex = keyHex.split(',')[0].trim();
      if (keyHex.includes(':')) keyHex = keyHex.split(':')[1].trim();
    }
  }

  if (!keyHex || !/^[a-f0-9]{32}$/i.test(keyHex)) {
    return res.status(400).send(`Chiave ClearKey non valida o mancante (richiesti 32 caratteri esadecimali). Trovata: ${keyHex || 'nessuna'}`);
  }

  // Rileva se il flusso deve essere instradato tramite Cloudflare WARP
  const cfg = storage.getConfig();
  let useWarp = req.query.warp === '1' || req.query.warp === 'true';
  if (!useWarp && cfg && cfg.warpEnabled) {
    const isWarpTitle = (title && title.toUpperCase().includes('WARP'));
    const isWarpUrl = (targetUrl && (targetUrl.includes('asn%3A13335') || targetUrl.includes('asn:13335') || targetUrl.includes('13335')));
    if (isWarpTitle || isWarpUrl) {
      useWarp = true;
    } else {
      const channels = storage.getChannels();
      const custom = storage.getCustomChannels();
      const all = [...custom, ...channels];
      const ch = all.find(c => (cleanId && (c.id === cleanId || c.id === channelIdOrUrl)) || (c.url && (c.url === targetUrl || targetUrl.includes(c.url))));
      if (ch) {
        const rawG = ch.customGroup || ch.group || '';
        const cleanG = sanitizeGroupName(rawG);
        const isGroupInWarp = (g) => {
          if (!g || !Array.isArray(cfg.warpGroups)) return false;
          const lower = g.trim().toLowerCase();
          return cfg.warpGroups.some(wg => wg && (wg.trim().toLowerCase() === lower || lower.includes(wg.trim().toLowerCase())));
        };
        if (ch.useWarp || isGroupInWarp(rawG) || isGroupInWarp(cleanG) || (ch.title && ch.title.toUpperCase().includes('WARP'))) {
          useWarp = true;
        }
      }
    }
  }

  // Chiave identificativa univoca per la sessione stream
  const baseKey = (cleanId && !cleanId.startsWith('http'))
    ? cleanId
    : `${targetUrl}#${keyHex}`;
  const streamKey = useWarp ? `${baseKey}#warp` : baseKey;

  // Formatta headers per FFmpeg (-headers "Key: Value\r\n...")
  let formattedHeaders = '';
  if (headersStr) {
    if (headersStr.includes('&')) {
      const pairs = headersStr.split('&');
      const formatted = [];
      for (const p of pairs) {
        const [k, ...v] = p.split('=');
        if (k && v.length) formatted.push(`${k.trim()}: ${v.join('=').trim()}`);
      }
      formattedHeaders = formatted.join('\r\n') + '\r\n';
    } else if (headersStr.includes(':')) {
      formattedHeaders = headersStr.endsWith('\r\n') ? headersStr : `${headersStr}\r\n`;
    }
  }

  req.on('error', () => {});
  res.on('error', () => {});

  const writeMpegTsHeaders = (r) => {
    if (!r.headersSent && !r.writableEnded) {
      r.on('error', () => {}); // Previene crash unhandled 'error' (EPIPE)
      try {
        r.writeHead(200, {
          'Content-Type': 'video/mp2t',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no'
        });
      } catch (e) {}
    }
  };

  // Rispondi immediatamente a richieste HEAD (usate da VLC/lettori multimediali per verificare lo stream)
  if (req.method === 'HEAD') {
    writeMpegTsHeaders(res);
    return res.end();
  }

  // Se esiste già uno stream attivo per questo canale, riutilizzalo
  if (activeMpdStreams.has(streamKey)) {
    const existing = activeMpdStreams.get(streamKey);
    if (existing.closeTimer) {
      clearTimeout(existing.closeTimer);
      existing.closeTimer = null;
      console.log(`[MPD ClearKey Proxy] Riattivato stream esistente per "${title}" (timer annullato).`);
    }

    writeMpegTsHeaders(res);

    // Invia il burst circolare recente (gli ultimi 512KB-768KB) allineato a 188 byte
    if (existing.recentBytes > 0 && existing.recentChunks.length > 0) {
      try {
        const fullBuf = Buffer.concat(existing.recentChunks, existing.recentBytes);
        const burstTarget = 768 * 1024;
        let slice = fullBuf.length > burstTarget ? fullBuf.subarray(fullBuf.length - burstTarget) : fullBuf;
        const remainder = slice.length % 188;
        if (remainder > 0) slice = slice.subarray(remainder);
        res.write(slice);
      } catch (e) {}
    }

    existing.listeners.add(res);
    console.log(`[MPD ClearKey Proxy] Client agganciato a "${title}" (Listener attivi: ${existing.listeners.size})`);

    req.on('close', () => {
      existing.listeners.delete(res);
      console.log(`[MPD ClearKey Proxy] Client disconnesso da "${title}" (Listener rimanenti: ${existing.listeners.size})`);
      if (existing.listeners.size === 0) {
        console.log(`[MPD ClearKey Proxy] Avvio timer grazia (10s) prima della chiusura per "${title}"`);
        existing.closeTimer = setTimeout(() => {
          console.log(`[MPD ClearKey Proxy] Timer scaduto: terminazione processo FFmpeg per "${title}"`);
          try { existing.proc.kill('SIGKILL'); } catch (e) {}
          activeMpdStreams.delete(streamKey);
        }, 10000);
      }
    });

    return;
  }

  // Genera sessionId univoco per il proxying dei segmenti DASH
  const sessionId = crypto.createHash('md5').update(streamKey).digest('hex').substring(0, 16);

  if (useWarp) {
    const reqHeaders = {};
    if (headersStr) {
      const pairs = headersStr.split('&');
      for (const p of pairs) {
        const [k, ...v] = p.split('=');
        if (k && v.length) reqHeaders[k.trim()] = v.join('=').trim();
      }
    }
    dashSegmentSessions.set(sessionId, {
      targetUrl,
      headers: reqHeaders,
      useWarp: true,
      cdnBaseUrl: '',
      createdAt: Date.now(),
      lastAccess: Date.now()
    });
    console.log(`[MPD ClearKey Proxy] Sessione segmenti DASH registrata (${sessionId}) con Cloudflare WARP`);
  }

  // Costruisci URL dell'endpoint interno MPD bufferizzato
  const internalMpdUrl = `http://127.0.0.1:${PORT}/internal/mpd?url=${encodeURIComponent(targetUrl)}${headersStr ? `&headers=${encodeURIComponent(headersStr)}` : ''}${useWarp ? `&warp=1&sessionId=${sessionId}` : ''}`;

  // Avvio nuovo processo FFmpeg con parametri anti-buffering e stabilizzazione A/V
  console.log(`[MPD ClearKey Proxy] Avvio nuovo processo FFmpeg per "${title}" (Key: ${keyHex.substring(0, 8)}...${useWarp ? ' | WARP: ON' : ''})...`);

  const ffmpegArgs = [
    '-loglevel', 'warning',

    // Ottimizzazioni di rete HTTP / DASH
    '-reconnect', '1',
    '-reconnect_streamed', '1',
    '-reconnect_on_network_error', '1',
    '-reconnect_delay_max', '2',
    '-rw_timeout', '15000000',
    '-tcp_nodelay', '1',
    '-fflags', '+genpts+discardcorrupt',
  ];

  if (formattedHeaders) {
    ffmpegArgs.push('-headers', formattedHeaders);
  }

  ffmpegArgs.push(
    '-cenc_decryption_key', keyHex,
    '-i', internalMpdUrl,

    // Mappatura flessibile sul primo flusso video e audio (? evita crash se manca uno dei due)
    '-map', '0:v:0?',
    '-map', '0:a:0?',

    // Video: stream copy con iniezione SPS/PPS su ogni keyframe (elimina macroblock/glitch)
    '-c:v', 'copy',
    '-bsf:v', 'h264_mp4toannexb',

    // Audio: normalizzazione timeline continua (elimina i blocchi di 1s sui cambi segmento DASH)
    '-c:a', 'aac',
    '-b:a', '128k',
    '-af', 'aresample=async=1',

    // Parametri di muxing MPEG-TS a bassa latenza e throughput costante
    '-max_muxing_queue_size', '4096',
    '-flush_packets', '1',
    '-muxdelay', '0.1',
    '-f', 'mpegts',
    '-mpegts_flags', '+resend_headers',
    '-pcr_period', '20',
    'pipe:1'
  );


  const ffmpegEnv = { ...process.env };
  // Rimuovi proxy dall'ambiente di FFmpeg: FFmpeg si connette solo a localhost (127.0.0.1)
  // Il fetch protetto via WARP verso la CDN viene gestito nativamente da Node.js
  delete ffmpegEnv.HTTP_PROXY;
  delete ffmpegEnv.http_proxy;
  delete ffmpegEnv.HTTPS_PROXY;
  delete ffmpegEnv.https_proxy;
  delete ffmpegEnv.ALL_PROXY;
  delete ffmpegEnv.all_proxy;

  let ffmpegProc;
  try {
    ffmpegProc = spawn('ffmpeg', ffmpegArgs, { env: ffmpegEnv });
  } catch (err) {
    console.error(`[MPD ClearKey Proxy] Impossibile avviare FFmpeg: ${err.message}`);
    if (!res.headersSent) {
      return res.status(500).send(`Errore avvio FFmpeg: ${err.message}`);
    } else {
      return res.end();
    }
  }

  const streamState = {
    key: streamKey,
    title,
    proc: ffmpegProc,
    listeners: new Set([res]),
    recentChunks: [],
    recentBytes: 0,
    maxRecentBytes: 1024 * 1024, // 1MB buffer circolare per client concorrenti
    closeTimer: null,
    startedAt: Date.now()
  };

  ffmpegProc.stdout.on('data', (chunk) => {
    // Aggiorna cache circolare per i client successivi
    streamState.recentChunks.push(chunk);
    streamState.recentBytes += chunk.length;
    while (streamState.recentBytes > streamState.maxRecentBytes && streamState.recentChunks.length > 1) {
      const rm = streamState.recentChunks.shift();
      streamState.recentBytes -= rm.length;
    }

    // Invia immediatamente lo stream a tutti i client attivi
    for (const r of streamState.listeners) {
      try {
        if (!r.writableEnded && !r.destroyed) {
          writeMpegTsHeaders(r);
          r.write(chunk);
        } else {
          streamState.listeners.delete(r);
        }
      } catch (err) {
        streamState.listeners.delete(r);
      }
    }
  });

  let errLog = '';
  ffmpegProc.stderr.on('data', (data) => {
    errLog += data.toString();
    if (errLog.length > 500) errLog = errLog.substring(errLog.length - 500);
  });

  ffmpegProc.on('error', (err) => {
    console.error(`[MPD ClearKey Proxy] Errore esecuzione FFmpeg: ${err.message}`);
    for (const r of streamState.listeners) {
      if (!r.headersSent) {
        r.status(500).send(`Errore FFmpeg: ${err.message}. Verifica che ffmpeg sia installato (apk add ffmpeg).`);
      }
    }
  });

  ffmpegProc.on('close', (code) => {
    if (code !== 0 && code !== 255 && code !== null) {
      console.warn(`[MPD ClearKey Proxy] FFmpeg terminato con codice ${code}: ${errLog.trim()}`);
    }
    if (streamState.closeTimer) clearTimeout(streamState.closeTimer);
    for (const r of streamState.listeners) {
      try {
        if (!r.headersSent) {
          r.status(503).send(`Flusso non disponibile o evento concluso (FFmpeg code ${code})`);
        } else if (!r.writableEnded) {
          r.end();
        }
      } catch (e) {}
    }
    activeMpdStreams.delete(streamKey);
    dashSegmentSessions.delete(sessionId);
  });

  req.on('close', () => {
    streamState.listeners.delete(res);
    console.log(`[MPD ClearKey Proxy] Client disconnesso da "${title}" (Listener rimanenti: ${streamState.listeners.size})`);
    if (streamState.listeners.size === 0) {
      console.log(`[MPD ClearKey Proxy] Avvio timer grazia (10s) prima di chiudere FFmpeg per "${title}"`);
      streamState.closeTimer = setTimeout(() => {
        console.log(`[MPD ClearKey Proxy] Timer scaduto. Terminazione processo FFmpeg per "${title}"`);
        try { streamState.proc.kill('SIGKILL'); } catch (e) {}
        activeMpdStreams.delete(streamKey);
        dashSegmentSessions.delete(sessionId);
      }, 10000);
    }
  });

  activeMpdStreams.set(streamKey, streamState);
}

// 1. Endpoint MPD Proxy per client IPTV / Kodi / VLC / Smart TV
app.get(['/stream/mpd/:id.ts', '/stream/mpd/:id', '/stream/mpd', '/stream/clearkey/:id.ts', '/stream/clearkey/:id', '/stream/clearkey'], (req, res) => {
  const rawId = req.params.id || req.query.id || req.query.url;
  const channelId = rawId ? rawId.replace(/\.ts$/i, '') : '';
  const key = req.query.key || req.query.clearkey;
  const headers = req.query.headers;
  streamMpdClearKey(channelId, key, headers, req, res);
});

// -------------------------------------------------------------
// 3d. PROXY STREAMING HTSPORT (EpiEmbeds WebP Stripper & TVNow)
// -------------------------------------------------------------

// 1. Endpoint M3U8 per canali EpiEmbeds (DAZN 1 HD, ecc.) - DIRETTO SENZA PROXY
app.get(['/stream/htsport/epiembeds/:slug/playlist.m3u8', '/stream/htsport/epiembeds/:slug'], verifyToken, async (req, res) => {
  const slug = req.params.slug;
  if (!slug) return res.status(400).send('Parametro slug mancante.');

  try {
    const directM3u8Url = await HTSportService.resolveEpiEmbeds(slug);

    const resp = await axios.get(directM3u8Url, {
      headers: {
        'Referer': 'https://epiembeds.online/',
        'Origin': 'https://epiembeds.online',
        'User-Agent': 'Mozilla/5.0'
      },
      timeout: 8000
    });

    let body = resp.data;
    const baseUri = directM3u8Url.substring(0, directM3u8Url.lastIndexOf('/') + 1);
    body = body.replace(/^(?!#)(.+)$/gm, (match) => {
      const line = match.trim();
      if (!line) return match;
      return (line.startsWith('http://') || line.startsWith('https://')) ? line : `${baseUri}${line}`;
    });

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(body);
  } catch (err) {
    console.error(`[HTSport Direct] Errore risoluzione/fetch manifest per slug ${slug}: ${err.message}`);
    if (!res.headersSent) res.status(502).send(`Errore HTSport EpiEmbeds: ${err.message}`);
  }
});

// 2. Endpoint Segmenti TS per EpiEmbeds (Rimuove il falso header WebP se richiesto - NO WARP)
app.get('/stream/htsport/segment', async (req, res) => {
  const segUrl = req.query.url;
  if (!segUrl) return res.status(400).send('Parametro URL mancante.');

  try {
    const axiosOpts = {
      responseType: 'arraybuffer',
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0'
      }
    };

    const resp = await axios.get(segUrl, axiosOpts);

    const raw = Buffer.from(resp.data);
    // Cerca il sync byte MPEG-TS 0x47 nei primi 500 byte per eliminare i 42 byte di intestazione RIFF/WEBP
    let offset = 0;
    while (offset < 500 && raw[offset] !== 0x47) {
      offset++;
    }

    const cleanTs = (offset < 500) ? raw.subarray(offset) : raw;
    res.writeHead(200, {
      'Content-Type': 'video/mp2t',
      'Content-Length': cleanTs.length,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=60'
    });
    res.end(cleanTs);
  } catch (err) {
    console.error(`[HTSport Direct] Errore recupero segmento: ${err.message}`);
    if (!res.headersSent) res.status(502).send(`Errore segmento HTSport: ${err.message}`);
  }
});

// 3. Endpoint M3U8 per canali TVNow (Sky Sport Uno, Calcio, F1, MotoGP, Max, ecc.) - DIRETTO SENZA PROXY
app.get(['/stream/htsport/tvnow/:id/playlist.m3u8', '/stream/htsport/tvnow/:id'], verifyToken, async (req, res) => {
  const channelId = req.params.id;
  if (!channelId) return res.status(400).send('Parametro channelId mancante.');

  try {
    const directM3u8Url = await HTSportService.resolveTvNow(channelId);

    // Emette direttamente il manifest HLS con segmenti CDN diretti (NO proxy segmenti, NO WARP per evitare saturazione server)
    const resp = await axios.get(directM3u8Url, {
      headers: {
        'Referer': 'https://tvnow247.top/',
        'Origin': 'https://tvnow247.top',
        'User-Agent': 'Mozilla/5.0'
      },
      timeout: 8000
    });

    let body = resp.data;
    const baseUri = directM3u8Url.substring(0, directM3u8Url.lastIndexOf('/') + 1);

    // Risolve eventuali segmenti relativi in URL assoluti diretti verso la CDN originaria (zero transito sul proxy)
    body = body.replace(/^(?!#)(.+)$/gm, (m) => {
      const line = m.trim();
      if (!line) return m;
      return (line.startsWith('http://') || line.startsWith('https://')) ? line : `${baseUri}${line}`;
    });

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(body);
  } catch (err) {
    console.error(`[HTSport Direct] Errore risoluzione/fetch TVNow per ID ${channelId}: ${err.message}`);
    if (!res.headersSent) res.status(502).send(`Errore HTSport TVNow: ${err.message}`);
  }
});

// 4. API per interrogare direttamente i canali HTSport disponibili
app.get('/api/htsport/channels', async (req, res) => {
  try {
    const host = req.get('host');
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const baseUrl = `${protocol}://${host}`;
    const cfg = storage.getConfig();
    const tokenParam = cfg.authToken ? `?token=${encodeURIComponent(cfg.authToken)}` : '';
    const channels = await HTSportService.scrapeChannels(baseUrl, tokenParam);
    res.json({ success: true, count: channels.length, channels });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Endpoint Diagnostica FFmpeg
app.get('/api/ffmpeg/status', (req, res) => {
  exec('ffmpeg -version', (err, stdout) => {
    if (err) {
      return res.json({
        success: false,
        installed: false,
        error: err.message,
        hint: "FFmpeg non è installato sul sistema. Esegui 'apk add --no-cache ffmpeg' sul container Alpine."
      });
    }
    const firstLine = stdout.split('\n')[0] || 'FFmpeg installato';
    const activeStreams = [];
    for (const [k, s] of activeMpdStreams.entries()) {
      activeStreams.push({
        id: k,
        title: s.title,
        listeners: s.listeners.size,
        uptimeSeconds: Math.round((Date.now() - s.startedAt) / 1000)
      });
    }
    res.json({
      success: true,
      installed: true,
      version: firstLine.trim(),
      message: firstLine.trim(),
      activeProxyStreams: activeStreams.length,
      streams: activeStreams
    });
  });
});

// Endpoint Controllo Salute Canali (Health Checker)
app.post('/api/channels/check', async (req, res) => {
  const { channels } = req.body;
  const extractor = new ExtractorEngine();
  const results = {};

  if (!Array.isArray(channels)) {
    return res.status(400).json({ error: 'channels deve essere un array' });
  }

  await Promise.all(channels.map(async (ch) => {
    const health = await extractor.checkStreamHealth(ch.url, ch.headers || '');
    results[ch.id] = health;
  }));

  res.json({ success: true, results });
});

// -------------------------------------------------------------
// 4. GUIDA EVENTI SPORTIVI LIVE (STILE LIVEONSAT)
// -------------------------------------------------------------
app.get('/api/events', (req, res) => {
  const { sport, status, search } = req.query;
  const result = eventsManager.getEvents({ sport, status, search });
  res.json({ success: true, ...result });
});

app.post('/api/events/refresh', (req, res) => {
  const events = eventsManager.refreshEvents();
  res.json({
    success: true,
    message: 'Palinsesto eventi aggiornato',
    total: events.length,
    events
  });
});

// -------------------------------------------------------------
// 5. GESTIONE GRUPPI E ORDINAMENTO PLAYLIST
// -------------------------------------------------------------
app.get('/api/groups', (req, res) => {
  const channels = storage.getChannels();
  const custom = storage.getCustomChannels();
  const all = [...custom, ...channels];
  const groupOrder = storage.getGroupOrder();

  const groupCounts = {};
  all.forEach(c => {
    const g = sanitizeGroupName(c.customGroup || c.group || 'Generale');
    groupCounts[g] = (groupCounts[g] || 0) + 1;
  });

  const allGroups = Object.keys(groupCounts);
  const ordered = [];
  groupOrder.forEach(g => {
    if (groupCounts[g] !== undefined && !ordered.includes(g)) {
      ordered.push(g);
    }
  });
  const remaining = allGroups
    .filter(g => !ordered.includes(g))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  const finalOrder = [...ordered, ...remaining];

  const groupsData = finalOrder.map((name, index) => ({
    index: index + 1,
    name,
    channelCount: groupCounts[name] || 0,
    isCustomOrdered: groupOrder.includes(name)
  }));

  res.json({
    success: true,
    totalGroups: groupsData.length,
    groups: groupsData,
    groupOrder
  });
});

app.post('/api/groups/order', (req, res) => {
  const { order } = req.body;
  if (!Array.isArray(order)) {
    return res.status(400).json({ error: 'order deve essere un array di stringhe' });
  }
  storage.saveGroupOrder(order);
  res.json({ success: true, message: 'Ordinamento gruppi salvato con successo', groupOrder: order });
});

app.post('/api/groups/rename', (req, res) => {
  const { oldName, newName } = req.body;
  if (!oldName || !newName) {
    return res.status(400).json({ error: 'oldName e newName sono obbligatori' });
  }
  const result = storage.renameGroup(oldName.trim(), newName.trim());
  if (!result) {
    return res.status(400).json({ error: 'Impossibile rinominare il gruppo' });
  }
  res.json({ success: true, message: `Gruppo rinominato con successo (${result.updatedCount} canali aggiornati)` });
});

// Configurazione Generale
app.get('/api/config', (req, res) => {
  res.json(storage.getConfig());
});

app.post('/api/config', (req, res) => {
  const newConfig = req.body;
  storage.saveConfig(newConfig);
  scheduler.init();
  res.json({ success: true, config: storage.getConfig() });
});

// -------------------------------------------------------------
// AVVIO SERVER E SCHEDULER
// -------------------------------------------------------------
app.listen(PORT, () => {
  console.log('='.repeat(65));
  console.log(`  iosonofratv Web Extractor & Channel Manager attivo su http://localhost:${PORT}`);
  console.log(`  Playlist M3U Remota: http://localhost:${PORT}/playlist.m3u`);
  console.log(`  Guida EPG Remota:    http://localhost:${PORT}/epg.xml`);
  console.log('='.repeat(65));

  scheduler.init();
});

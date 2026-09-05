const express = require('express');
const compression = require('compression');
const path = require('path');
const http = require('http');
const net = require('net');
const storage = require('./services/storage');
const { CATALOG_SECTIONS, ExtractorEngine, sanitizeGroupName } = require('./services/extractor');
const epgManager = require('./services/epg');
const eventsManager = require('./services/events');
const scheduler = require('./services/scheduler');

const app = express();
app.set('trust proxy', true);
const config = storage.getConfig();
const PORT = process.env.PORT || config.port || 3000;

app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

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
app.get(['/playlist.m3u', '/playlist', '/live.m3u'], verifyToken, (req, res) => {
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
  res.setHeader('Content-Disposition', 'inline; filename="mandrakodi.m3u"');
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
  const groups = [...new Set(rawAll.map(c => c.group || 'Generale'))].filter(Boolean).sort();

  let all = [...rawAll];

  // Filtro gruppo
  if (group && group !== 'ALL') {
    all = all.filter(ch => ch.group === group);
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
  const pageNum = parseInt(page, 10) || 1;
  const limitNum = parseInt(limit, 10) || 50;
  const total = all.length;
  const start = (pageNum - 1) * limitNum;
  const items = all.slice(start, start + limitNum);

  res.json({
    total,
    page: pageNum,
    limit: limitNum,
    totalPages: Math.ceil(total / limitNum),
    groups,
    channels: items
  });
});

// Modifica singolo canale
app.put('/api/channels/:id', (req, res) => {
  const { id } = req.params;
  const { title, group, logo, tvgId, enabled } = req.body;

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
        enabled: enabled !== undefined ? enabled : ch.enabled
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
      return { ...ch, title, group, logo, tvgId, enabled };
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
app.options('/api/stream/proxy', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.sendStatus(204);
});

app.get('/api/stream/proxy', async (req, res) => {
  const { url, referer, origin, ua } = req.query;
  if (!url) return res.status(400).send('Missing stream URL');

  try {
    const headers = {
      'User-Agent': ua || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
      'Accept': '*/*'
    };
    if (referer) headers['Referer'] = referer;
    if (origin) headers['Origin'] = origin;
    if (req.headers.range) headers['Range'] = req.headers.range;

    const axios = require('axios');
    const response = await axios.get(url, {
      headers,
      responseType: 'stream',
      timeout: 15000,
      validateStatus: (s) => s >= 200 && s < 400
    });

    const isMpd = url.includes('.mpd') || (response.headers['content-type'] && response.headers['content-type'].includes('xml'));

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');

    if (isMpd) {
      const chunks = [];
      response.data.on('data', chunk => chunks.push(chunk));
      response.data.on('end', () => {
        let xml = Buffer.concat(chunks).toString('utf-8');

        // 1. Inietta tag W3C ClearKey UUID affinché tutti i browser (Chrome, Firefox, Safari, Edge) accettino la riproduzione EME
        const clearKeyTag = '<ContentProtection schemeIdUri="urn:uuid:1077efec-c0b2-4d02-ace3-3c1e52e2fb4b" value="ClearKey1.0"/>';
        if (!xml.includes('1077efec-c0b2-4d02-ace3-3c1e52e2fb4b')) {
          xml = xml.replace(/(<ContentProtection schemeIdUri="urn:mpeg:dash:mp4protection:2011"[^>]*>[\s\S]*?<\/ContentProtection>)/gi, `$1\n            ${clearKeyTag}`);
        }

        // 2. Inietta BaseURL assoluto se assente
        if (!xml.includes('<BaseURL>')) {
          let baseUrl = url;
          if (baseUrl.includes('?')) baseUrl = baseUrl.split('?')[0];
          const lastSlash = baseUrl.lastIndexOf('/');
          if (lastSlash !== -1) {
            const baseDir = baseUrl.substring(0, lastSlash + 1);
            xml = xml.replace(/(<MPD[^>]*>)/i, `$1\n    <BaseURL>${baseDir}</BaseURL>`);
          }
        }

        res.setHeader('Content-Type', 'application/dash+xml; charset=utf-8');
        res.setHeader('Content-Length', Buffer.byteLength(xml, 'utf-8'));
        res.status(200).send(xml);
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
  const cleanHash = (hash || '').trim();
  if (!/^[a-f0-9]{40}$/i.test(cleanHash)) {
    return res.status(400).send('Hash AceStream non valido (deve contenere 40 caratteri esadecimali).');
  }

  const cfg = storage.getConfig();
  const aceHost = cfg.aceStreamHost || '127.0.0.1:6878';
  const parts = aceHost.split(':');
  const host = parts[0] || '127.0.0.1';
  const port = parseInt(parts[1], 10) || 6878;

  const targetPath = `/ace/getstream?id=${encodeURIComponent(cleanHash)}`;
  console.log(`[AceStream Proxy] Connessione ad Ace Engine (${host}:${port}) per hash ${cleanHash}...`);

  const clientReq = http.request({
    hostname: host,
    port: port,
    path: targetPath,
    method: 'GET',
    headers: {
      'User-Agent': 'MandraKodi-AceStreamProxy/2.0',
      'Accept': '*/*'
    },
    timeout: 35000 // 35 secondi per consentire l'aggancio dei peer P2P e pre-buffering
  }, (aceRes) => {
    if (aceRes.statusCode >= 400) {
      console.warn(`[AceStream Proxy] Risposta HTTP ${aceRes.statusCode} da Ace Engine per hash ${cleanHash}`);
      res.status(aceRes.statusCode);
      aceRes.pipe(res);
      return;
    }

    res.writeHead(aceRes.statusCode, {
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

  clientReq.on('timeout', () => {
    console.warn(`[AceStream Proxy] Timeout di connessione ad Ace Engine (${host}:${port}) per hash ${cleanHash}`);
    clientReq.destroy();
    if (!res.headersSent) {
      res.status(504).send('Timeout: Ace Stream Engine non ha risposto in tempo');
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

  // Chiusura immediata della richiesta ad Ace Engine quando il client si disconnette
  req.on('close', () => {
    console.log(`[AceStream Proxy] Client disconnesso per hash ${cleanHash}. Interruzione stream.`);
    clientReq.destroy();
  });

  clientReq.end();
}

// 1. Endpoint standard REST per client IPTV / Kodi / VLC / Browser
app.get(['/stream/ace/:hash', '/stream/ace'], verifyToken, (req, res) => {
  const hash = req.params.hash || req.query.id || req.query.hash;
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
  console.log(`  MandraKodi Web Extractor & Channel Manager attivo su http://localhost:${PORT}`);
  console.log(`  Playlist M3U Remota: http://localhost:${PORT}/playlist.m3u`);
  console.log(`  Guida EPG Remota:    http://localhost:${PORT}/epg.xml`);
  console.log('='.repeat(65));

  scheduler.init();
});

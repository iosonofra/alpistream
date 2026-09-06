// Web Player Engine (Shaka Player & Hls.js) con supporto ClearKey DRM e CORS Proxy

let shakaPlayerMain = null;
let shakaPlayerModal = null;
let currentPlayingChannel = null;
let currentLiveChannels = [];
let liveTvCurrentGroup = 'ALL';
let liveTvCurrentSearch = '';
let liveTvDebounceTimer = null;

// Inizializzazione Shaka Player Polyfill
if (window.shaka) {
  shaka.polyfill.installAll();
}

function parseHeaders(headersStr, rawUrl) {
  let referer = '';
  let origin = '';
  let ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

  // Solo se lo stream è Sky o NowTV impostiamo il referer NowTV di default se non specificato
  if (rawUrl && (rawUrl.includes('sky') || rawUrl.includes('nowtv') || rawUrl.includes('ott') || rawUrl.includes('skysports'))) {
    referer = 'https://www.nowtv.it/';
    origin = 'https://www.nowtv.it';
  }

  if (rawUrl && rawUrl.includes('|')) {
    const parts = rawUrl.split('|');
    const params = new URLSearchParams(parts[1]);
    if (params.get('Referer') || params.get('referer')) referer = params.get('Referer') || params.get('referer');
    if (params.get('Origin') || params.get('origin')) origin = params.get('Origin') || params.get('origin');
    if (params.get('User-Agent') || params.get('user-agent')) ua = params.get('User-Agent') || params.get('user-agent');
  } else if (headersStr) {
    if (headersStr.includes('Referer=')) {
      const m = headersStr.match(/Referer=([^&]+)/i);
      if (m) referer = decodeURIComponent(m[1]);
    }
    if (headersStr.includes('Origin=')) {
      const m = headersStr.match(/Origin=([^&]+)/i);
      if (m) origin = decodeURIComponent(m[1]);
    }
    if (headersStr.includes('User-Agent=')) {
      const m = headersStr.match(/User-Agent=([^&]+)/i);
      if (m) ua = decodeURIComponent(m[1]);
    }
  }
  return { referer, origin, ua };
}

function getCleanUrl(rawUrl) {
  if (!rawUrl) return '';
  if (rawUrl.includes('|')) {
    return rawUrl.split('|')[0].trim();
  }
  return rawUrl.trim();
}

function buildProxyUrl(rawUrl, headersObj, useWarp = false) {
  let cleanUrl = getCleanUrl(rawUrl);
  if (!cleanUrl) return '';

  // Se l'URL contiene già un proxy interno (/api/stream/proxy?url=...),
  // estrai l'URL target effettivo per evitare loop ricorsivi 502
  while (cleanUrl && (cleanUrl.includes('/api/stream/proxy') || cleanUrl.includes('%2Fapi%2Fstream%2Fproxy'))) {
    try {
      const decoded = decodeURIComponent(cleanUrl);
      const m = decoded.match(/[?&]url=([^&]+)/);
      if (m && m[1]) {
        cleanUrl = decodeURIComponent(m[1]);
      } else {
        break;
      }
    } catch (e) {
      break;
    }
  }

  // Non proxyare se punta a un endpoint nativo (/stream/...) o se appartiene a flussi diretti HTSport/TVNow
  if (cleanUrl.startsWith('/stream/') || (cleanUrl.includes(window.location.host) && cleanUrl.includes('/stream/')) || cleanUrl.includes('chunk.tvnow247.today') || cleanUrl.includes('wideiptv.top') || cleanUrl.includes('dlhd.st')) {
    return cleanUrl;
  }

  const params = new URLSearchParams({
    url: cleanUrl,
    ua: headersObj.ua || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  });
  if (headersObj.referer) {
    params.set('referer', headersObj.referer);
  }
  if (headersObj.origin) {
    params.set('origin', headersObj.origin);
  }
  if (useWarp) {
    params.set('warp', '1');
  }
  return `/api/stream/proxy?${params.toString()}`;
}

// Funzione universale di pulizia e rilascio player
async function cleanupPlayer(playerInstance) {
  if (!playerInstance) return;
  try {
    if (typeof playerInstance.destroy === 'function') {
      await playerInstance.destroy();
    } else if (typeof playerInstance.unload === 'function') {
      await playerInstance.unload().catch(() => {});
    }
  } catch (e) {}
}

// Riproduzione su un elemento Video con Shaka Player, Hls.js o mpegts.js
async function playOnVideoElement(videoEl, ch, playerInstance) {
  if (!videoEl || !ch) return null;
  const cleanUrl = getCleanUrl(ch.url);
  const headersObj = parseHeaders(ch.headers, ch.url);
  const clearkey = ch.clearkey || (ch.kodi_props ? ch.kodi_props['inputstream.adaptive.license_key'] : '');

  // I canali HTSport Live non devono passare attraverso proxy nè WARP
  const isHtsport = (ch.source === 'htsport') ||
    (ch.group && ch.group.toLowerCase().includes('htsport')) ||
    (cleanUrl && (cleanUrl.includes('chunk.tvnow247') || cleanUrl.includes('htsport') || cleanUrl.includes('tvnow')));

  const cfg = window.appConfig || {};
  const isGroupInWarp = (g) => {
    if (!g || !Array.isArray(cfg.warpGroups)) return false;
    const lower = g.trim().toLowerCase();
    if (lower.includes('htsport')) return false;
    return cfg.warpGroups.some(wg => {
      if (!wg) return false;
      const wgl = wg.trim().toLowerCase();
      if (wgl.includes('htsport')) return false;
      return wgl === lower;
    });
  };
  const useWarp = !isHtsport && !!(cfg.warpEnabled && (ch.useWarp === true || isGroupInWarp(ch.group) || isGroupInWarp(ch.customGroup)));

  // 1. Riconoscimento stream AceStream
  let aceHash = '';
  if (ch.aceHash && /^[a-f0-9]{40}$/i.test(ch.aceHash.trim())) {
    aceHash = ch.aceHash.trim();
  } else if (cleanUrl.startsWith('acestream://')) {
    aceHash = cleanUrl.replace('acestream://', '').split(/[?#|&/]/)[0].trim();
  } else if (cleanUrl.includes('/stream/ace/')) {
    const match = cleanUrl.match(/\/stream\/ace\/([a-f0-9]{40})/i);
    if (match) aceHash = match[1];
  } else if (cleanUrl.includes(':6878/ace/') || cleanUrl.includes('/ace/getstream') || cleanUrl.includes('/ace/manifest.m3u8')) {
    const match = cleanUrl.match(/[?&]id=([a-f0-9]{40})/i);
    if (match) aceHash = match[1];
  } else if (ch.source === 'acestream' && /^[a-f0-9]{40}$/i.test(cleanUrl)) {
    aceHash = cleanUrl;
  }

  // Se è un canale AceStream, riproduci tramite il proxy centralizzato
  if (aceHash) {
    if (playerInstance) {
      await cleanupPlayer(playerInstance);
      playerInstance = null;
    }

    const tokenParam = (window.appConfig && window.appConfig.authToken) ? `?token=${encodeURIComponent(window.appConfig.authToken)}` : '';
    const aceStreamPath = `/stream/ace/${aceHash}.ts${tokenParam}`;
    const aceStreamUrl = new URL(aceStreamPath, window.location.origin).href;
    const aceHlsUrl = new URL(`/stream/ace/${aceHash}/manifest.m3u8${tokenParam}`, window.location.origin).href;

    let fallbackDone = false;
    const triggerHlsFallback = () => {
      if (fallbackDone) return;
      fallbackDone = true;
      console.log('[Player] Passaggio a fallback HLS AceStream:', aceHlsUrl);
      if (window.Hls && Hls.isSupported()) {
        const hls = new Hls({ maxBufferLength: 10, enableWorker: false });
        hls.loadSource(aceHlsUrl);
        hls.attachMedia(videoEl);
        hls.on(Hls.Events.MANIFEST_PARSED, () => videoEl.play().catch(() => {}));
        if (window.showToast) showToast('🔄 Passato a modalità HLS AceStream');
        return hls;
      } else {
        videoEl.src = aceStreamUrl;
        videoEl.play().catch(() => {});
        return null;
      }
    };

    // A. Tentativo con mpegts.js (MPEG-TS live nativo tramite MSE con tipo mpegts forzato)
    if (window.mpegts && mpegts.isSupported()) {
      try {
        const mpegPlayer = mpegts.createPlayer({
          type: 'mpegts',
          isLive: true,
          url: aceStreamUrl
        }, {
          enableWorker: false,
          lazyLoad: false,
          seekType: 'param',
          liveBufferLatencyChasing: false,
          autoCleanupSourceBuffer: true,
          autoCleanupMaxBackwardDuration: 60,
          autoCleanupMinBackwardDuration: 15,
          fixAudioTimestampGap: false
        });

        mpegPlayer.on(mpegts.Events.ERROR, (t, d, i) => {
          console.warn('[AceStream mpegts Error]', t, d, i);
          triggerHlsFallback();
        });

        mpegPlayer.attachMediaElement(videoEl);
        mpegPlayer.load();
        mpegPlayer.play().catch(err => {
          console.warn('[Player] Autoplay mpegts bloccato:', err);
        });
        return mpegPlayer;
      } catch (e) {
        console.warn('[Player] mpegts.js non disponibile, passo a fallback Hls.js:', e);
      }
    }

    // B. Fallback con Hls.js su manifest HLS dell'engine
    return triggerHlsFallback();
  }

  // Parse tutte le chiavi ClearKey (anche multiple separate da virgola)
  const clearKeysMap = {};
  if (clearkey) {
    const keyPairs = clearkey.split(',');
    for (const pair of keyPairs) {
      if (pair.includes(':')) {
        const [kid, key] = pair.trim().split(':');
        if (kid && key) {
          clearKeysMap[kid.trim().toLowerCase()] = key.trim().toLowerCase();
        }
      }
    }
  }

  // Helper per avvio fallback FFmpeg MPD ClearKey via mpegts.js
  const tryMpdFfmpegFallback = async () => {
    const hasClearKey = clearkey && !['0000', '0:0', '0'].includes(String(clearkey).trim());
    if ((cleanUrl.includes('.mpd') || hasClearKey) && window.mpegts && mpegts.isSupported()) {
      try {
        const params = new URLSearchParams();
        if (cleanUrl) params.set('url', cleanUrl);
        if (clearkey) params.set('key', clearkey);
        if (ch.headers) params.set('headers', ch.headers);
        if (ch.id) params.set('id', ch.id);
        if (useWarp) params.set('warp', '1');

        const mpdPath = (ch.id && !ch.id.startsWith('http'))
          ? `/stream/mpd/${encodeURIComponent(ch.id)}?${params.toString()}`
          : `/stream/mpd?${params.toString()}`;

        const absoluteMpdUrl = new URL(mpdPath, window.location.origin).href;

        console.log('[Player] Avvio fallback FFmpeg MPD ClearKey via mpegts.js:', absoluteMpdUrl);
        const mpegPlayer = mpegts.createPlayer({
          type: 'mse',
          isLive: true,
          url: absoluteMpdUrl
        }, {
          enableWorker: false,
          lazyLoad: false,
          seekType: 'param',
          liveBufferLatencyChasing: false,
          autoCleanupSourceBuffer: true,
          autoCleanupMaxBackwardDuration: 60,
          autoCleanupMinBackwardDuration: 15,
          fixAudioTimestampGap: false
        });

        mpegPlayer.on(mpegts.Events.ERROR, (errType, errDetail, errInfo) => {
          console.warn('[Fallback mpegts.js Error]', errType, errDetail, errInfo);
        });

        mpegPlayer.attachMediaElement(videoEl);
        mpegPlayer.load();
        mpegPlayer.play().catch(() => {});
        if (window.showToast) showToast('🔄 Passato a motore FFmpeg (compatibilità stream)');
        return mpegPlayer;
      } catch (mErr) {
        console.warn('[Player] Fallback mpegts.js non riuscito:', mErr);
      }
    }
    return null;
  };

  // Se il canale richiede esplicitamente il motore FFmpeg Stream Copy (Canale duplicato WARP + Proxy MPD FFmpeg)
  if (ch.streamMode === 'ffmpeg_copy' || ch.mpdProxy === true || (ch.id && ch.id.endsWith('_ffmpeg'))) {
    console.log('[Player] Canale configurato per motore FFmpeg Stream Copy diretto:', ch.title);
    if (playerInstance) {
      await cleanupPlayer(playerInstance);
      playerInstance = null;
    }
    const mpegInstance = await tryMpdFfmpegFallback();
    if (mpegInstance) return mpegInstance;
  }

  if (window.shaka && shaka.Player.isBrowserSupported()) {
    try {
      const isShakaInstance = playerInstance && (playerInstance instanceof shaka.Player || (typeof playerInstance.getNetworkingEngine === 'function' && typeof playerInstance.configure === 'function'));
      if (!isShakaInstance) {
        if (playerInstance) await cleanupPlayer(playerInstance);
        playerInstance = new shaka.Player(videoEl);
      } else {
        await playerInstance.unload();
      }

      let fatalFallbackOccurred = false;
      const onFatalError = async (detail) => {
        if (fatalFallbackOccurred) return;
        fatalFallbackOccurred = true;
        console.warn('[Player Shaka Warning / Errore fatale]', detail);
        if (playerInstance) {
          await cleanupPlayer(playerInstance);
          playerInstance = null;
        }
        try {
          videoEl.removeAttribute('src');
          videoEl.load();
        } catch (e) {}

        const fb = await tryMpdFfmpegFallback();
        if (fb) {
          if (videoEl.id === 'livetv-video') shakaPlayerMain = fb;
          if (videoEl.id === 'modal-video') shakaPlayerModal = fb;
        } else {
          if (window.showToast) showToast('⚠️ Impossibile riprodurre il flusso');
        }
      };

      playerInstance.addEventListener('error', (e) => {
        if (e && e.detail) {
          e.detail.handled = true;
          if (e.detail.severity === 2 || e.detail.code === 4032 || e.detail.code === 1001) {
            onFatalError(e.detail);
          }
        }
      });

      // Configurazione ClearKey DRM EME e Ottimizzazioni Anti-Buffering Live Streaming
      playerInstance.configure({
        drm: {
          clearKeys: clearKeysMap
        },
        manifest: {
          dash: {
            ignoreMinBufferTime: false,
            defaultPresentationDelay: 12 // Mantiene 12s di margine sul live edge (segmenti sempre pronti e stabili sulla CDN)
          }
        },
        streaming: {
          bufferingGoal: 25, // Bufferizza fino a 25 secondi in avanti per assorbire fluttuazioni di rete
          rebufferingGoal: 4, // Attende 4 secondi prima di riprendere dopo un calo
          bufferBehind: 30, // Mantiene 30 secondi di buffer già riprodotto
          safeSeekOffset: 5,
          stallEnabled: true,
          stallThreshold: 1.5,
          stallSkip: 0.5,
          lowLatencyMode: false, // Disabilita low latency estremo che affama il buffer su stream proxy/WARP
          alwaysStreamRangeToBuffer: true,
          retryParameters: {
            maxAttempts: 4,
            baseDelay: 500,
            backoffFactor: 1.5,
            timeout: 10000
          }
        },
        abr: {
          enabled: true,
          defaultBandwidthEstimate: 5000000, // 5 Mbps: parte subito in alta qualità senza continui salti di risoluzione
          switchInterval: 8 // Limita il cambio traccia a intervalli di 8s per evitare micro-scatti
        }
      });

      if (Object.keys(clearKeysMap).length > 0) {
        console.log(`[Player] Applicate ${Object.keys(clearKeysMap).length} chiavi ClearKey DRM`);
      }

      // Calcola cartella base del flusso remoto per risolvere eventuali segmenti relativi
      let baseRemoteUrl = cleanUrl;
      if (baseRemoteUrl.includes('?')) {
        baseRemoteUrl = baseRemoteUrl.split('?')[0];
      }
      const lastSlash = baseRemoteUrl.lastIndexOf('/');
      const baseDir = lastSlash !== -1 ? baseRemoteUrl.substring(0, lastSlash + 1) : '';

      // Configura Request Filter per inoltrare i segmenti tramite proxy con CORS e Referer
      const netEngine = playerInstance.getNetworkingEngine();
      netEngine.clearAllRequestFilters();
      netEngine.registerRequestFilter((type, request) => {
        // NON proxyare le richieste interne di licenza DRM ClearKey o i dati data:/blob:
        if (type === shaka.net.NetworkingEngine.RequestType.LICENSE) return;

        let uri = request.uris[0];
        if (!uri || uri.startsWith('data:') || uri.startsWith('blob:')) return;

        const decodedUri = decodeURIComponent(uri);
        // Se punta già al proxy o ad un endpoint stream locale, non alterare
        if (decodedUri.includes('/api/stream/proxy') || decodedUri.includes('/stream/')) return;

        // Se Shaka ha risolto un segmento relativo sul nostro host, ricostruisci l'URL CDN reale
        if (decodedUri.includes('/api/stream/')) {
          const rel = decodedUri.substring(decodedUri.indexOf('/api/stream/') + '/api/stream/'.length);
          uri = baseDir + rel;
        } else if (uri.startsWith('http://localhost') || uri.startsWith('http://127.0.0.1') || uri.includes(window.location.host)) {
          try {
            const urlObj = new URL(uri);
            const rel = urlObj.pathname.replace(/^\//, '');
            uri = baseDir + rel;
          } catch (e) {}
        }

        request.uris = [buildProxyUrl(uri, headersObj, useWarp)];
      });

      const initialProxyUrl = buildProxyUrl(cleanUrl, headersObj, useWarp);
      await playerInstance.load(initialProxyUrl);
      videoEl.play().catch(() => {});
      return playerInstance;
    } catch (err) {
      console.warn('[Player] Shaka non avviato per questo stream, tentativo con fallback:', err.message);
      if (playerInstance) {
        await cleanupPlayer(playerInstance);
        playerInstance = null;
      }
      try {
        videoEl.removeAttribute('src');
        videoEl.load();
      } catch (e) {}
    }
  }

  // Fallback 1: Se Shaka non è supportato o ha fallito
  const fbPlayer = await tryMpdFfmpegFallback();
  if (fbPlayer) return fbPlayer;

  // Fallback 2: Hls.js se è flusso m3u8
  if (window.Hls && Hls.isSupported() && (cleanUrl.includes('.m3u8') || cleanUrl.includes('hls'))) {
    const hls = new Hls({ maxBufferLength: 10 });
    hls.loadSource(buildProxyUrl(cleanUrl, headersObj, useWarp));
    hls.attachMedia(videoEl);
    hls.on(Hls.Events.MANIFEST_PARSED, () => videoEl.play().catch(() => {}));
    return hls;
  }

  // Fallback 3: Tag HTML5 nativo
  videoEl.src = buildProxyUrl(cleanUrl, headersObj, useWarp);
  videoEl.play().catch(() => {});
  return null;
}

// -------------------------------------------------------------
// TAB DEDICATO: LIVE TV PLAYER
// -------------------------------------------------------------
async function initLiveTvTab() {
  const channelListEl = document.getElementById('livetv-channel-list');
  const countEl = document.getElementById('livetv-channel-count');
  if (!channelListEl) return;

  channelListEl.innerHTML = '<div class="text-muted" style="padding: 16px;">Caricamento canali in corso...</div>';

  try {
    const params = new URLSearchParams({
      limit: 1000,
      status: 'enabled',
      group: liveTvCurrentGroup,
      search: liveTvCurrentSearch
    });

    const res = await fetch(`/api/channels?${params.toString()}`);
    const data = await res.json();
    currentLiveChannels = data.channels || [];

    // Popola Dropdown Gruppi se non già popolato
    const groupSelect = document.getElementById('livetv-group-filter');
    if (groupSelect && data.groups && groupSelect.children.length <= 1) {
      const currentSelected = groupSelect.value || 'ALL';
      groupSelect.innerHTML = '<option value="ALL">📺 Tutti i Gruppi / Canali</option>';
      data.groups.forEach(g => {
        const opt = document.createElement('option');
        opt.value = g;
        opt.innerText = g;
        if (g === currentSelected) opt.selected = true;
        groupSelect.appendChild(opt);
      });
    }

    if (countEl) {
      countEl.innerText = `${data.total || currentLiveChannels.length} canali trovati`;
    }

    channelListEl.innerHTML = '';
    if (currentLiveChannels.length === 0) {
      channelListEl.innerHTML = '<div class="text-muted" style="padding: 16px;">Nessun canale trovato con questi filtri.</div>';
      return;
    }

    currentLiveChannels.forEach((ch) => {
      const div = document.createElement('div');
      const isSelected = currentPlayingChannel ? currentPlayingChannel.id === ch.id : false;
      div.className = `livetv-channel-item ${isSelected ? 'active' : ''}`;
      div.id = `livetv-item-${ch.id}`;

      const img = document.createElement('img');
      img.className = 'livetv-logo';
      img.src = ch.logo || '';
      img.onerror = () => {
        img.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="%238b949e" stroke-width="2"><rect x="2" y="7" width="20" height="15" rx="2" ry="2"></rect><polyline points="17 2 12 7 7 2"></polyline></svg>';
      };

      const infoDiv = document.createElement('div');
      infoDiv.className = 'livetv-info';
      const h4 = document.createElement('h4');
      h4.innerText = ch.title || 'Canale';
      const small = document.createElement('small');
      small.innerText = ch.group || 'Generale';
      infoDiv.appendChild(h4);
      infoDiv.appendChild(small);

      div.appendChild(img);
      div.appendChild(infoDiv);
      div.onclick = () => playLiveTvChannel(ch);
      channelListEl.appendChild(div);
    });
  } catch (e) {
    channelListEl.innerHTML = '<div class="text-muted" style="padding: 16px; color: var(--accent-red);">Errore caricamento canali dal server</div>';
  }
}

async function playLiveTvChannel(ch) {
  currentPlayingChannel = ch;
  document.querySelectorAll('.livetv-channel-item').forEach(el => el.classList.remove('active'));
  const activeItem = document.getElementById(`livetv-item-${ch.id}`);
  if (activeItem) activeItem.classList.add('active');

  const titleEl = document.getElementById('livetv-current-title');
  const groupEl = document.getElementById('livetv-current-group');
  const drmEl = document.getElementById('livetv-current-drm');

  if (titleEl) titleEl.innerText = ch.title;
  if (groupEl) groupEl.innerText = ch.group;
  if (drmEl) drmEl.innerText = ch.clearkey ? `ClearKey DRM: ${ch.clearkey.substring(0, 32)}...` : 'Stream Libero / HLS';

  const videoEl = document.getElementById('livetv-video');
  if (videoEl) {
    shakaPlayerMain = await playOnVideoElement(videoEl, ch, shakaPlayerMain);
  }
}

// -------------------------------------------------------------
// MODALE ANTEPRIMA RAPIDA (EDITOR CANALI)
// -------------------------------------------------------------
async function openModalPlayer(ch) {
  const modal = document.getElementById('player-modal');
  modal.classList.add('active');

  document.getElementById('modal-player-title').innerText = ch.title;
  document.getElementById('modal-player-group').innerText = ch.group;
  document.getElementById('modal-player-drm').innerText = ch.clearkey ? `ClearKey DRM: ${ch.clearkey.substring(0, 32)}...` : 'Stream Libero / HLS';

  const videoEl = document.getElementById('modal-video');
  shakaPlayerModal = await playOnVideoElement(videoEl, ch, shakaPlayerModal);
}

function closeModalPlayer() {
  const modal = document.getElementById('player-modal');
  modal.classList.remove('active');
  const videoEl = document.getElementById('modal-video');
  if (videoEl) {
    videoEl.pause();
    videoEl.src = '';
  }
  if (shakaPlayerModal) {
    cleanupPlayer(shakaPlayerModal);
    shakaPlayerModal = null;
  }
}

// Event Listeners per Ricerca e Filtro Gruppo Live TV
document.addEventListener('DOMContentLoaded', () => {
  const searchInput = document.getElementById('livetv-search');
  const groupSelect = document.getElementById('livetv-group-filter');

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      clearTimeout(liveTvDebounceTimer);
      liveTvDebounceTimer = setTimeout(() => {
        liveTvCurrentSearch = e.target.value.trim();
        initLiveTvTab();
      }, 300);
    });
  }

  if (groupSelect) {
    groupSelect.addEventListener('change', (e) => {
      liveTvCurrentGroup = e.target.value;
      initLiveTvTab();
    });
  }
});

window.initLiveTvTab = initLiveTvTab;
window.playLiveTvChannel = playLiveTvChannel;
window.openModalPlayer = openModalPlayer;
window.closeModalPlayer = closeModalPlayer;

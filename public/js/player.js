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
  let referer = 'https://www.nowtv.it/';
  let origin = 'https://www.nowtv.it';
  let ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

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

function buildProxyUrl(rawUrl, headersObj) {
  const cleanUrl = getCleanUrl(rawUrl);
  const params = new URLSearchParams({
    url: cleanUrl,
    referer: headersObj.referer || 'https://www.nowtv.it/',
    origin: headersObj.origin || 'https://www.nowtv.it',
    ua: headersObj.ua || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  });
  return `/api/stream/proxy?${params.toString()}`;
}

// Funzione universale di pulizia e rilascio player
async function cleanupPlayer(playerInstance) {
  if (!playerInstance) return;
  try {
    if (typeof playerInstance.destroy === 'function') {
      playerInstance.destroy();
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

  // 1. Riconoscimento stream AceStream
  let aceHash = '';
  if (cleanUrl.startsWith('acestream://')) {
    aceHash = cleanUrl.replace('acestream://', '').split(/[?#|]/)[0].trim();
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

    const aceStreamUrl = `/stream/ace/${aceHash}`;
    const aceHlsUrl = `/stream/ace/${aceHash}/manifest.m3u8`;

    // A. Tentativo con mpegts.js (MPEG-TS live nativo tramite MSE)
    if (window.mpegts && mpegts.isSupported()) {
      try {
        const mpegPlayer = mpegts.createPlayer({
          type: 'mse',
          isLive: true,
          url: aceStreamUrl
        }, {
          enableWorker: true,
          lazyLoadMaxDuration: 3 * 60,
          seekType: 'range',
          liveBufferLatencyChasing: true
        });
        mpegPlayer.attachMediaElement(videoEl);
        mpegPlayer.load();
        mpegPlayer.play().catch(() => {});
        return mpegPlayer;
      } catch (e) {
        console.warn('[Player] mpegts.js non disponibile, passo a fallback Hls.js:', e);
      }
    }

    // B. Fallback con Hls.js su manifest HLS dell'engine
    if (window.Hls && Hls.isSupported()) {
      const hls = new Hls({ maxBufferLength: 10 });
      hls.loadSource(aceHlsUrl);
      hls.attachMedia(videoEl);
      hls.on(Hls.Events.MANIFEST_PARSED, () => videoEl.play().catch(() => {}));
      return hls;
    }

    // C. Fallback tag standard HTML5
    videoEl.src = aceStreamUrl;
    videoEl.play().catch(() => {});
    return null;
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

  if (window.shaka && shaka.Player.isBrowserSupported()) {
    try {
      if (!playerInstance || typeof playerInstance.load !== 'function') {
        if (playerInstance) await cleanupPlayer(playerInstance);
        playerInstance = new shaka.Player(videoEl);
        playerInstance.addEventListener('error', (e) => {
          console.warn('[Player Shaka Warning]', e.detail);
          if (e.detail && e.detail.code === 3015) {
            if (window.showToast) showToast('⚠️ Flusso stream non raggiungibile o offline');
          }
        });
      } else {
        await playerInstance.unload();
      }

      // Configurazione ClearKey DRM EME
      playerInstance.configure({
        drm: {
          clearKeys: clearKeysMap
        },
        streaming: {
          bufferingGoal: 10,
          rebufferingGoal: 2,
          retryParameters: {
            maxAttempts: 2,
            baseDelay: 500,
            backoffFactor: 1.5,
            timeout: 6000
          }
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
        if (!uri || uri.startsWith('data:') || uri.startsWith('blob:') || uri.includes('/api/stream/proxy')) return;

        // Se Shaka ha risolto un segmento relativo su localhost, ricostruisci l'URL CDN
        if (uri.includes('/api/stream/')) {
          const rel = uri.substring(uri.indexOf('/api/stream/') + '/api/stream/'.length);
          uri = baseDir + rel;
        } else if (uri.startsWith('http://localhost') || uri.startsWith('http://127.0.0.1')) {
          try {
            const urlObj = new URL(uri);
            const rel = urlObj.pathname.replace(/^\//, '');
            uri = baseDir + rel;
          } catch (e) {}
        }

        request.uris = [buildProxyUrl(uri, headersObj)];
      });

      const initialProxyUrl = buildProxyUrl(cleanUrl, headersObj);
      await playerInstance.load(initialProxyUrl);
      videoEl.play().catch(() => {});
      return playerInstance;
    } catch (err) {
      console.warn('[Player] Shaka non avviato per questo stream, tentativo con fallback:', err.message);
    }
  }

  // Fallback Hls.js
  if (window.Hls && Hls.isSupported() && (cleanUrl.includes('.m3u8') || cleanUrl.includes('hls'))) {
    const hls = new Hls({ maxBufferLength: 10 });
    hls.loadSource(buildProxyUrl(cleanUrl, headersObj));
    hls.attachMedia(videoEl);
    hls.on(Hls.Events.MANIFEST_PARSED, () => videoEl.play().catch(() => {}));
  } else {
    videoEl.src = buildProxyUrl(cleanUrl, headersObj);
    videoEl.play().catch(() => {});
  }

  return playerInstance;
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

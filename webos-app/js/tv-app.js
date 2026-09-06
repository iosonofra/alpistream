/**
 * iosonofratv - Main Controller & Remote Control Navigation
 * TiviMate-style 10-foot UI, D-Pad Spatial Navigation, EPG Timeline & Direct Channel Dialing
 */

(function () {
  'use strict';

  // Configurazione Server & Storage
  const DEFAULT_SERVER = (window.location.protocol.startsWith('http') && !window.location.host.includes('localhost:5173'))
    ? window.location.origin
    : 'https://alpistream.iosonofra.click';

  const state = {
    serverUrl: localStorage.getItem('iosonofratv_server') || localStorage.getItem('mandrakodi_tv_server') || DEFAULT_SERVER,
    authToken: localStorage.getItem('iosonofratv_token') || localStorage.getItem('mandrakodi_tv_token') || '',
    playerMode: localStorage.getItem('iosonofratv_mode') || localStorage.getItem('mandrakodi_tv_mode') || 'auto',
    channels: [],
    groups: [],
    currentGroup: 'ALL',
    filteredChannels: [],
    currentPlayingChannel: null,
    liveEpgMap: {}, // channelId / tvgId -> { nowTitle, nowTime, nowStart, nowStop, nowDesc, progress, nextTitle, nextTime }
    timelineData: null,
    timelineChannelIdx: 0,
    timelineProgIdx: 0,
    focusZone: 'channels', // 'groups' | 'channels' | 'modal' | 'timeline' | 'event_detail'
    focusedGroupIdx: 0,
    focusedChannelIdx: 0,
    overlayVisible: true,
    osdTimer: null,
    numberBuffer: '',
    numberTimer: null,
    epgTimer: null
  };

  // Performance tracking variables (O(1) updates)
  let activePlayingChannelEl = null;
  let currentFocusedChannelEl = null;
  let currentFocusedGroupEl = null;
  let bufferingDebounceTimer = null;
  let loadingWatchdogTimer = null;
  let lastKeyNavTimestamp = 0;

  // Elementi DOM
  const el = {
    videoContainer: document.getElementById('video-container'),
    video: document.getElementById('tv-video'),
    spinner: document.getElementById('video-spinner'),
    spinnerText: document.getElementById('spinner-text'),
    overlay: document.getElementById('tv-overlay'),
    bottomOsd: document.getElementById('tv-bottom-osd'),
    numberOsd: document.getElementById('number-jump-osd'),
    jumpDigits: document.getElementById('jump-digits'),
    clock: document.getElementById('tv-clock'),
    activeServerBadge: document.getElementById('active-server-badge'),
    channelCounter: document.getElementById('active-channel-counter'),
    groupsList: document.getElementById('groups-list'),
    channelsList: document.getElementById('channels-list'),
    currentGroupTitle: document.getElementById('current-group-title'),
    channelsGroupCount: document.getElementById('channels-group-count'),
    // Scheda Dettagli Canale Evidenziato (Colonna 3)
    focusedCard: document.getElementById('focused-channel-card'),
    cardLogo: document.getElementById('card-channel-logo'),
    cardLcn: document.getElementById('card-channel-lcn'),
    cardGroup: document.getElementById('card-channel-group'),
    cardTitle: document.getElementById('card-channel-title'),
    cardEpgTime: document.getElementById('card-epg-time'),
    cardEpgTitle: document.getElementById('card-epg-title'),
    cardEpgGenre: document.getElementById('card-epg-genre'),
    cardEpgProgress: document.getElementById('card-epg-progress'),
    cardEpgDesc: document.getElementById('card-epg-desc'),
    cardNextTitle: document.getElementById('card-next-title'),
    cardNextTime: document.getElementById('card-next-time'),
    // Banner Flottante Zapping Rapido
    zappingBanner: document.getElementById('tv-zapping-banner'),
    zapLcn: document.getElementById('zap-channel-lcn'),
    zapLogo: document.getElementById('zap-channel-logo'),
    zapTitle: document.getElementById('zap-channel-title'),
    zapGroup: document.getElementById('zap-channel-group'),
    zapStatusPill: document.getElementById('zap-status-pill'),
    zapProgTitle: document.getElementById('zap-prog-title'),
    zapProgTime: document.getElementById('zap-prog-time'),
    zapProgProgress: document.getElementById('zap-prog-progress'),
    // OSD Bottom elements
    osdLogo: document.getElementById('osd-channel-logo'),
    osdChNo: document.getElementById('osd-channel-number'),
    osdTitle: document.getElementById('osd-channel-title'),
    osdStreamBadge: document.getElementById('osd-stream-badge'),
    osdEpgNowTitle: document.getElementById('osd-epg-now-title'),
    osdEpgNowTime: document.getElementById('osd-epg-now-time'),
    osdProgressBar: document.getElementById('osd-epg-progress-bar'),
    osdEpgNextTitle: document.getElementById('osd-epg-next-title'),
    // Guida TV Elements
    btnOpenGuide: document.getElementById('btn-open-guide'),
    guideModal: document.getElementById('tv-guide-modal'),
    guideGroupBadge: document.getElementById('guide-group-badge'),
    guideClock: document.getElementById('guide-clock'),
    guideTimeSlots: document.getElementById('guide-time-slots'),
    guideGridViewport: document.getElementById('guide-grid-viewport'),
    guideGridContent: document.getElementById('guide-grid-content'),
    previewProgTitle: document.getElementById('preview-prog-title'),
    previewProgMeta: document.getElementById('preview-prog-meta'),
    previewProgDesc: document.getElementById('preview-prog-desc'),
    eventDetailModal: document.getElementById('tv-event-detail-modal'),
    eventDetailChannel: document.getElementById('event-detail-channel'),
    eventDetailTime: document.getElementById('event-detail-time'),
    eventDetailTitle: document.getElementById('event-detail-title'),
    eventDetailCategory: document.getElementById('event-detail-category'),
    eventDetailDesc: document.getElementById('event-detail-desc'),
    btnCloseEventDetail: document.getElementById('btn-close-event-detail'),
    // Modal
    settingsModal: document.getElementById('tv-settings-modal'),
    cfgServerUrl: document.getElementById('cfg-server-url'),
    cfgAuthToken: document.getElementById('cfg-auth-token'),
    cfgPlayerMode: document.getElementById('cfg-player-mode'),
    btnSaveSettings: document.getElementById('btn-save-settings'),
    btnCancelSettings: document.getElementById('btn-cancel-settings'),
    toast: document.getElementById('tv-toast')
  };

  // Inizializzazione Applicazione
  async function initApp() {
    initClock();
    updateServerBadge();

    // Inizializza il player video
    window.tvPlayer.init(el.video, state.serverUrl, (status, data) => {
      handlePlayerStatus(status, data);
    });
    window.tvPlayer.setAuthToken(state.authToken);

    // Eventi di sicurezza sul tag video: nascondi SUBITO lo spinner quando il video riproduce
    if (el.video) {
      el.video.addEventListener('playing', () => hideSpinner());
      el.video.addEventListener('canplay', () => hideSpinner());
      el.video.addEventListener('loadeddata', () => hideSpinner());
      el.video.addEventListener('timeupdate', () => {
        if (el.video && !el.video.paused) hideSpinner();
      });
      el.video.addEventListener('progress', () => {
        if (el.video && !el.video.paused && el.video.readyState >= 2) hideSpinner();
      });
    }

    // Registra ascoltatori tasti telecomando & puntatore
    document.addEventListener('keydown', handleKeyDown);
    setupModalEvents();

    // Caricamento canali ed EPG dal backend
    await loadChannels();
    loadEpg();

    // Aggiornamento EPG periodico ogni 60s
    state.epgTimer = setInterval(() => {
      updateEpgDisplay();
    }, 60000);
  }

  function initClock() {
    const update = () => {
      const now = new Date();
      const h = String(now.getHours()).padStart(2, '0');
      const m = String(now.getMinutes()).padStart(2, '0');
      if (el.clock) el.clock.textContent = `${h}:${m}`;
      if (el.guideClock) el.guideClock.textContent = `${h}:${m}`;
    };
    update();
    setInterval(update, 1000);
  }

  function updateServerBadge() {
    if (!el.activeServerBadge) return;
    try {
      const url = new URL(state.serverUrl);
      el.activeServerBadge.textContent = url.hostname.includes('iosonofra.click') ? 'Cloud' : url.hostname;
    } catch (e) {
      el.activeServerBadge.textContent = 'Server';
    }
  }

  function showToast(msg, duration = 3000) {
    if (!el.toast) return;
    el.toast.textContent = msg;
    el.toast.classList.remove('hidden');
    clearTimeout(el.toast._timer);
    el.toast._timer = setTimeout(() => {
      el.toast.classList.add('hidden');
    }, duration);
  }

  // Caricamento Canali dal Server iosonofratv
  async function loadChannels() {
    showSpinner('Caricamento canali...');
    try {
      const headers = {};
      if (state.authToken) headers['x-auth-token'] = state.authToken;

      const res = await fetch(`${state.serverBaseClean()}/api/channels?limit=all&status=enabled`, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      const list = Array.isArray(data) ? data : (data.channels || []);
      state.channels = list.filter(c => c && c.enabled !== false);
      if (el.channelCounter) el.channelCounter.textContent = `${state.channels.length} canali`;

      // Estrai gruppi unici
      extractGroups();
      renderGroups();
      filterChannelsByGroup(state.currentGroup);

      hideSpinner();

      // Riproduci automaticamente il primo canale
      if (state.filteredChannels.length > 0 && !state.currentPlayingChannel) {
        playChannelByIndex(0);
      }
    } catch (err) {
      hideSpinner();
      console.error('[TvApp] Errore caricamento canali:', err);
      showToast(`⚠️ Connessione server fallita: ${err.message}`);
    }
  }

  state.serverBaseClean = function () {
    return (state.serverUrl || window.location.origin).replace(/\/$/, '');
  };

  // Caricamento EPG Live
  async function loadEpg() {
    try {
      const headers = {};
      if (state.authToken) headers['x-auth-token'] = state.authToken;
      const res = await fetch(`${state.serverBaseClean()}/api/epg/live`, { headers });
      if (!res.ok) return;
      const data = await res.json();

      if (data && data.epg && typeof data.epg === 'object') {
        state.liveEpgMap = data.epg;
      }
      updateEpgDisplay();
      updateChannelsMiniEpg();
    } catch (e) {
      console.warn('[TvApp] EPG non disponibile:', e.message);
    }
  }

  function updateChannelsMiniEpg() {
    if (!el.channelsList || !state.filteredChannels.length) return;
    // Aggiorna solo i canali visibili a schermo per eliminare centinaia di query DOM lente su webOS
    const scroll = el.channelsList.scrollTop || 0;
    const viewHeight = 620;
    const startIdx = Math.max(0, Math.floor((scroll - 100) / 94));
    const endIdx = Math.min(state.filteredChannels.length - 1, Math.ceil((scroll + viewHeight + 100) / 94));

    for (let idx = startIdx; idx <= endIdx; idx++) {
      const item = document.getElementById(`channel-item-${idx}`);
      if (!item) continue;
      const ch = state.filteredChannels[idx];
      if (!ch) continue;
      const epgInfo = getEpgForChannel(ch);
      const textEl = item.querySelector('.epg-now-text');
      const barEl = item.querySelector('.epg-mini-bar-fill');
      if (textEl && textEl.textContent !== epgInfo.nowTitle) textEl.textContent = epgInfo.nowTitle;
      if (barEl) barEl.style.width = `${epgInfo.progress}%`;
    }
  }

  function extractGroups() {
    const map = new Map();
    map.set('ALL', { id: 'ALL', name: 'TUTTI I CANALI', count: state.channels.length });

    for (const ch of state.channels) {
      const gName = ch.customGroup || ch.group || 'Altri Canali';
      if (!map.has(gName)) {
        map.set(gName, { id: gName, name: gName, count: 0 });
      }
      map.get(gName).count++;
    }

    state.groups = Array.from(map.values());
  }

  // Renderizzazione Gruppi
  function renderGroups() {
    if (!el.groupsList) return;
    el.groupsList.innerHTML = '';

    state.groups.forEach((g, idx) => {
      const item = document.createElement('div');
      item.className = `group-item ${g.id === state.currentGroup ? 'active' : ''} ${state.focusZone === 'groups' && idx === state.focusedGroupIdx ? 'focused' : ''}`;
      item.dataset.index = idx;
      item.dataset.groupId = g.id;

      item.innerHTML = `
        <span class="item-name">${escapeHtml(g.name)}</span>
        <span class="item-count">${g.count}</span>
      `;

      item.addEventListener('click', () => {
        selectGroup(idx);
        setFocusZone('channels');
      });

      el.groupsList.appendChild(item);
    });
  }

  function selectGroup(idx, loadChannels = true) {
    state.focusedGroupIdx = idx;
    const g = state.groups[idx];
    if (!g) return;
    if (loadChannels) {
      state.currentGroup = g.id;
      filterChannelsByGroup(g.id);
      renderGroups();
    }
  }

  function filterChannelsByGroup(groupId) {
    if (groupId === 'ALL') {
      state.filteredChannels = [...state.channels];
    } else {
      state.filteredChannels = state.channels.filter(c => (c.customGroup || c.group || 'Altri Canali') === groupId);
    }

    if (el.currentGroupTitle) {
      const current = state.groups.find(g => g.id === groupId);
      el.currentGroupTitle.textContent = current ? current.name : 'CANALI';
    }
    if (el.channelsGroupCount) {
      el.channelsGroupCount.textContent = `${state.filteredChannels.length}`;
    }

    state.focusedChannelIdx = 0;
    renderChannels();
  }

  // -------------------------------------------------------------
  // VIRTUAL CHANNEL POOL (DOM Windowing: soli 14 nodi DOM a 60 FPS)
  // -------------------------------------------------------------
  const VIRTUAL_POOL_SIZE = 14;
  const ROW_HEIGHT = 94; // 84px card height + 10px gap
  let virtualPoolElements = [];
  let currentWindowStart = -1;

  function initVirtualChannelPool() {
    if (!el.channelsList) return;
    el.channelsList.innerHTML = '';
    virtualPoolElements = [];
    currentWindowStart = -1;

    const totalHeight = state.filteredChannels.length * ROW_HEIGHT;
    const spacer = document.createElement('div');
    spacer.id = 'channels-virtual-spacer';
    spacer.style.cssText = `position: relative; width: 100%; height: ${totalHeight}px; min-height: 100%; pointer-events: none;`;

    const poolContainer = document.createElement('div');
    poolContainer.id = 'channels-virtual-pool';
    poolContainer.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; display: flex; flex-direction: column; gap: 10px; will-change: transform; pointer-events: auto;';

    const count = Math.min(VIRTUAL_POOL_SIZE, state.filteredChannels.length);
    for (let i = 0; i < count; i++) {
      const item = document.createElement('div');
      item.className = 'channel-item';
      item.dataset.poolIdx = i;

      item.innerHTML = `
        <span class="channel-num">-</span>
        <div class="channel-logo-wrapper">
          <img class="channel-logo-img" loading="lazy" decoding="async" src="" alt="" onerror="this.style.display='none'">
        </div>
        <div class="channel-text-info">
          <div class="channel-title-row">
            <span class="channel-name">-</span>
          </div>
          <div class="channel-epg-info">
            <span class="epg-now-text">Caricamento guida...</span>
            <div class="epg-mini-bar">
              <div class="epg-mini-bar-fill" style="width: 0%;"></div>
            </div>
          </div>
        </div>
      `;

      item.addEventListener('click', () => {
        const idx = parseInt(item.dataset.channelIndex, 10);
        if (!isNaN(idx)) {
          state.focusedChannelIdx = idx;
          playChannelByIndex(idx);
        }
      });

      poolContainer.appendChild(item);
      virtualPoolElements.push(item);
    }

    spacer.appendChild(poolContainer);
    el.channelsList.appendChild(spacer);
  }

  function updateVirtualChannels(forceRedraw = false) {
    if (!el.channelsList || !state.filteredChannels.length || !virtualPoolElements.length) return;

    const maxStart = Math.max(0, state.filteredChannels.length - VIRTUAL_POOL_SIZE);
    const targetStart = Math.max(0, Math.min(maxStart, state.focusedChannelIdx - 4));
    const poolContainer = document.getElementById('channels-virtual-pool');

    const windowChanged = (targetStart !== currentWindowStart) || forceRedraw;
    if (windowChanged) {
      currentWindowStart = targetStart;
      if (poolContainer) {
        poolContainer.style.transform = `translateY(${targetStart * ROW_HEIGHT}px)`;
      }

      for (let i = 0; i < virtualPoolElements.length; i++) {
        const item = virtualPoolElements[i];
        const chIdx = targetStart + i;
        const ch = state.filteredChannels[chIdx];
        if (!ch) {
          item.style.display = 'none';
          continue;
        }
        item.style.display = 'flex';
        item.dataset.channelIndex = chIdx;
        item.dataset.index = chIdx;
        item.id = `channel-item-${chIdx}`;

        const numEl = item.querySelector('.channel-num');
        const logoEl = item.querySelector('.channel-logo-img');
        const nameEl = item.querySelector('.channel-name');
        const epgTextEl = item.querySelector('.epg-now-text');
        const epgBarEl = item.querySelector('.epg-mini-bar-fill');

        if (numEl) numEl.textContent = ch.lcn || (chIdx + 1);
        if (nameEl) nameEl.textContent = ch.customTitle || ch.title || 'Canale';

        const logoSrc = ch.customLogo || ch.logo || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="50" height="40" viewBox="0 0 50 40"><rect width="50" height="40" fill="%231a2233"/><text x="25" y="24" fill="%2300e5ff" font-size="14" font-family="sans-serif" text-anchor="middle">TV</text></svg>';
        if (logoEl) {
          logoEl.style.display = '';
          if (logoEl.getAttribute('src') !== logoSrc) logoEl.src = logoSrc;
        }

        const epgInfo = getEpgForChannel(ch);
        if (epgTextEl) epgTextEl.textContent = epgInfo.nowTitle;
        if (epgBarEl) epgBarEl.style.width = `${epgInfo.progress}%`;
      }
    }

    // Aggiorna classi focused e playing sui nodi del pool
    activePlayingChannelEl = null;
    currentFocusedChannelEl = null;

    for (let i = 0; i < virtualPoolElements.length; i++) {
      const item = virtualPoolElements[i];
      const chIdx = parseInt(item.dataset.channelIndex, 10);
      if (isNaN(chIdx)) continue;
      const ch = state.filteredChannels[chIdx];
      const isPlaying = state.currentPlayingChannel && ch && state.currentPlayingChannel.id === ch.id;
      const isFocused = state.focusZone === 'channels' && chIdx === state.focusedChannelIdx;

      item.classList.toggle('active-playing', Boolean(isPlaying));
      item.classList.toggle('focused', Boolean(isFocused));

      if (isPlaying) activePlayingChannelEl = item;
      if (isFocused) currentFocusedChannelEl = item;
    }

    // Allinea scrollTop del contenitore con il canale attivo per centratura visiva perfetta
    const targetTop = state.focusedChannelIdx * ROW_HEIGHT;
    const currentScroll = el.channelsList.scrollTop || 0;
    const containerHeight = 620;

    if (targetTop < currentScroll + ROW_HEIGHT) {
      el.channelsList.scrollTop = Math.max(0, targetTop - ROW_HEIGHT);
    } else if (targetTop + ROW_HEIGHT > currentScroll + containerHeight - ROW_HEIGHT) {
      el.channelsList.scrollTop = targetTop + ROW_HEIGHT * 2 - containerHeight;
    }

    // Aggiorna scheda dettagli canale evidenziato (Colonna 3)
    if (state.filteredChannels.length && state.focusedChannelIdx >= 0) {
      updateFocusedChannelDetails(state.filteredChannels[state.focusedChannelIdx]);
    }
  }

  function renderChannels() {
    if (!el.channelsList) return;
    if (!state.filteredChannels.length) {
      el.channelsList.innerHTML = '<div style="padding: 40px; text-align: center; color: var(--text-muted); font-size: 18px;">Nessun canale disponibile in questa categoria.</div>';
      return;
    }
    initVirtualChannelPool();
    updateVirtualChannels(true);
    scrollFocusedIntoView();
  }

  function getEpgForChannel(ch) {
    if (!ch) {
      return { nowTitle: 'Diretta TV', nowTime: '', nextTitle: '', progress: 0 };
    }
    const byId = ch.id ? state.liveEpgMap[ch.id] : null;
    if (byId) return byId;
    const tvgId = (ch.tvgId || '').toLowerCase();
    if (tvgId && state.liveEpgMap[tvgId]) return state.liveEpgMap[tvgId];
    return {
      nowTitle: 'Diretta TV',
      nowTime: '',
      nextTitle: 'Nessuna informazione EPG',
      progress: 0
    };
  }

  function updateEpgDisplay() {
    // Aggiorna OSD inferiore se visibile
    if (state.currentPlayingChannel && el.bottomOsd && !el.bottomOsd.classList.contains('hidden')) {
      const epg = getEpgForChannel(state.currentPlayingChannel);
      if (el.osdEpgNowTitle) el.osdEpgNowTitle.textContent = epg.nowTitle;
      if (el.osdEpgNowTime) el.osdEpgNowTime.textContent = epg.nowTime;
      if (el.osdProgressBar) el.osdProgressBar.style.width = `${epg.progress}%`;
      if (el.osdEpgNextTitle) el.osdEpgNextTitle.textContent = epg.nextTitle || 'Nessuna informazione';
    }
  }

  // Riproduzione Canale
  function playChannelByIndex(idx) {
    if (idx < 0 || idx >= state.filteredChannels.length) return;
    const ch = state.filteredChannels[idx];
    state.currentPlayingChannel = ch;

    // Aggiornamento O(1) classe active-playing nel pool virtuale
    updateVirtualChannels(false);

    // Avvia riproduzione video
    window.tvPlayer.play(ch);

    // Mostra OSD a scomparsa se lo zapping banner non è attivo
    if (!isZappingActive) {
      showBottomOsd(ch);
    }
  }

  function showBottomOsd(ch) {
    if (!el.bottomOsd || !ch) return;
    const epg = getEpgForChannel(ch);

    if (el.osdLogo) el.osdLogo.src = ch.customLogo || ch.logo || '';
    if (el.osdChNo) el.osdChNo.textContent = `CH ${ch.lcn || (state.focusedChannelIdx + 1)}`;
    if (el.osdTitle) el.osdTitle.textContent = ch.customTitle || ch.title || 'Canale Live';

    let badge = 'HLS';
    if (ch.streamMode === 'ffmpeg_copy' || ch.mpdProxy || (ch.id && ch.id.endsWith('_ffmpeg'))) badge = 'FFMPEG';
    else if (ch.url && ch.url.includes('.mpd')) badge = 'MPD';
    else if (ch.source === 'acestream') badge = 'ACE';
    if (el.osdStreamBadge) el.osdStreamBadge.textContent = badge;

    if (el.osdEpgNowTitle) el.osdEpgNowTitle.textContent = epg.nowTitle;
    if (el.osdEpgNowTime) el.osdEpgNowTime.textContent = epg.nowTime;
    if (el.osdProgressBar) el.osdProgressBar.style.width = `${epg.progress}%`;
    if (el.osdEpgNextTitle) el.osdEpgNextTitle.textContent = epg.nextTitle;

    el.bottomOsd.classList.remove('hidden');

    clearTimeout(state.osdTimer);
    state.osdTimer = setTimeout(() => {
      el.bottomOsd.classList.add('hidden');
    }, 5000);
  }

  function hideBottomOsd() {
    clearTimeout(state.osdTimer);
    if (el.bottomOsd) el.bottomOsd.classList.add('hidden');
  }

  // Gestione Telecomando D-Pad (webOS Remote Keys)
  function handleKeyDown(e) {
    const key = e.key;
    const keyCode = e.keyCode;

    // Se il modal impostazioni è aperto
    if (state.focusZone === 'modal') {
      if (keyCode === 27 || keyCode === 461 || keyCode === 10009) { // Back
        closeSettingsModal();
        e.preventDefault();
      }
      return;
    }

    // Se il modal dettaglio evento è aperto
    if (state.focusZone === 'event_detail') {
      if (keyCode === 27 || keyCode === 461 || keyCode === 10009 || keyCode === 13 || key === 'Enter') {
        closeEventDetailModal();
        e.preventDefault();
      }
      return;
    }

    // Se la Guida TV Timeline è aperta
    if (state.focusZone === 'timeline') {
      if (keyCode === 27 || keyCode === 461 || keyCode === 10009 || keyCode === 405 || keyCode === 458 || key === 'Yellow' || key === 'Guide') {
        closeGuideModal();
        e.preventDefault();
        return;
      }
      if (keyCode === 38 || key === 'ArrowUp' || key === 'Up') {
        navigateTimeline(0, -1);
        e.preventDefault();
        return;
      }
      if (keyCode === 40 || key === 'ArrowDown' || key === 'Down') {
        navigateTimeline(0, 1);
        e.preventDefault();
        return;
      }
      if (keyCode === 37 || key === 'ArrowLeft' || key === 'Left') {
        navigateTimeline(-1, 0);
        e.preventDefault();
        return;
      }
      if (keyCode === 39 || key === 'ArrowRight' || key === 'Right') {
        navigateTimeline(1, 0);
        e.preventDefault();
        return;
      }
      if (keyCode === 13 || key === 'Enter') {
        handleTimelineSelect();
        e.preventDefault();
        return;
      }
      return;
    }

    // Tasto Giallo o Guide per aprire Guida TV Sky Glass
    if (keyCode === 405 || keyCode === 458 || key === 'Yellow' || key === 'Guide') {
      openGuideModal();
      e.preventDefault();
      return;
    }

    // Tasti Numerici (0-9) per salto canale
    if ((keyCode >= 48 && keyCode <= 57) || (keyCode >= 96 && keyCode <= 105)) {
      const digit = key.replace(/Numpad/i, '');
      handleNumberDial(digit);
      e.preventDefault();
      return;
    }

    // Throttle per scorrimento rapido D-Pad telecomando (evita accumulo eventi su webOS)
    if (keyCode >= 37 && keyCode <= 40) {
      const now = Date.now();
      if (now - lastKeyNavTimestamp < 45) {
        e.preventDefault();
        return;
      }
      lastKeyNavTimestamp = now;
    }

    // Tasti Channel Up / Channel Down (P+ / P-)
    if (keyCode === 33 || keyCode === 427) { // PageUp / ChannelUp
      if (state.overlayVisible && state.focusZone === 'channels') {
        moveFocusVertical(-5);
      } else {
        quickZap(-1);
      }
      e.preventDefault();
      return;
    }
    if (keyCode === 34 || keyCode === 428) { // PageDown / ChannelDown
      if (state.overlayVisible && state.focusZone === 'channels') {
        moveFocusVertical(5);
      } else {
        quickZap(1);
      }
      e.preventDefault();
      return;
    }

    // Tasto Blu (Settings) o tasto Menu
    if (keyCode === 406 || keyCode === 115 || key === 'F4') {
      openSettingsModal();
      e.preventDefault();
      return;
    }

    // Tasto Back / Return (webOS Key 461, 27, 10009)
    if (keyCode === 27 || keyCode === 461 || keyCode === 10009) {
      if (isZappingActive) {
        cancelZapping();
        e.preventDefault();
        return;
      }
      if (state.overlayVisible) {
        // Chiudi overlay e torna a schermo intero
        toggleOverlay(false);
      } else {
        // Mostra overlay se chiuso
        toggleOverlay(true);
      }
      e.preventDefault();
      return;
    }

    // Navigazione a schermo intero (overlay nascosto)
    if (!state.overlayVisible) {
      if (keyCode === 13 || key === 'Enter') { // Tasto OK
        // Se lo zapping rapido è attivo, conferma subito la sintonizzazione
        if (isZappingActive) {
          commitZapping();
          e.preventDefault();
          return;
        }
        // Se l'OSD inferiore è visibile, premi OK per aprire la lista canali completa
        if (el.bottomOsd && !el.bottomOsd.classList.contains('hidden')) {
          toggleOverlay(true);
        } else {
          // Altrimenti mostra OSD informativo
          if (state.currentPlayingChannel) showBottomOsd(state.currentPlayingChannel);
        }
        e.preventDefault();
        return;
      }
      if (keyCode === 38 || key === 'ArrowUp') { // Freccia SU: canale precedente
        quickZap(-1);
        e.preventDefault();
        return;
      }
      if (keyCode === 40 || key === 'ArrowDown') { // Freccia GIÙ: canale successivo
        quickZap(1);
        e.preventDefault();
        return;
      }
      if (keyCode === 37 || key === 'ArrowLeft') { // Freccia SINISTRA: apri lista canali
        if (isZappingActive) hideZappingBanner();
        toggleOverlay(true);
        e.preventDefault();
        return;
      }
      if (keyCode === 39 || key === 'ArrowRight') { // Freccia DESTRA: mostra OSD info
        if (isZappingActive) hideZappingBanner();
        if (state.currentPlayingChannel) showBottomOsd(state.currentPlayingChannel);
        e.preventDefault();
        return;
      }
      return;
    }

    // Navigazione D-Pad nell'Overlay Visibile
    if (keyCode === 38 || key === 'ArrowUp' || key === 'Up') {
      moveFocusVertical(-1);
      e.preventDefault();
    } else if (keyCode === 40 || key === 'ArrowDown' || key === 'Down') {
      moveFocusVertical(1);
      e.preventDefault();
    } else if (keyCode === 37 || key === 'ArrowLeft' || key === 'Left') {
      moveFocusHorizontal(-1);
      e.preventDefault();
    } else if (keyCode === 39 || key === 'ArrowRight' || key === 'Right') {
      moveFocusHorizontal(1);
      e.preventDefault();
    } else if (keyCode === 13 || key === 'Enter') {
      handleOkPress();
      e.preventDefault();
    }
  }

  function moveFocusVertical(delta) {
    if (state.focusZone === 'groups') {
      const next = Math.max(0, Math.min(state.groups.length - 1, state.focusedGroupIdx + delta));
      if (next !== state.focusedGroupIdx) {
        selectGroup(next, false);
        updateFocusVisuals();
      }
    } else if (state.focusZone === 'channels') {
      const next = Math.max(0, Math.min(state.filteredChannels.length - 1, state.focusedChannelIdx + delta));
      if (next !== state.focusedChannelIdx) {
        state.focusedChannelIdx = next;
        updateFocusVisuals();
      }
    }
  }

  function moveFocusHorizontal(delta) {
    if (delta > 0 && state.focusZone === 'groups') {
      // Passa a canali: se la categoria selezionata è cambiata, caricala ora
      const g = state.groups[state.focusedGroupIdx];
      if (g && state.currentGroup !== g.id) {
        state.currentGroup = g.id;
        filterChannelsByGroup(g.id);
        renderGroups();
      }
      setFocusZone('channels');
    } else if (delta < 0 && state.focusZone === 'channels') {
      // Passa a gruppi
      setFocusZone('groups');
    }
  }

  function setFocusZone(zone) {
    state.focusZone = zone;
    updateFocusVisuals();
  }

  function handleOkPress() {
    if (state.focusZone === 'channels') {
      playChannelByIndex(state.focusedChannelIdx);
      // Nascondi overlay per passare al video a tutto schermo
      toggleOverlay(false);
    } else if (state.focusZone === 'groups') {
      const g = state.groups[state.focusedGroupIdx];
      if (g && state.currentGroup !== g.id) {
        state.currentGroup = g.id;
        filterChannelsByGroup(g.id);
        renderGroups();
      }
      setFocusZone('channels');
    }
  }

  // Aggiornamento O(1) focus visivo e scroll matematico ultra-rapido (senza layout thrashing)
  function updateFocusVisuals() {
    if (state.focusZone === 'channels') {
      updateVirtualChannels(false);
    } else if (state.focusZone === 'groups') {
      const target = (el.groupsList && el.groupsList.children ? el.groupsList.children[state.focusedGroupIdx] : null);
      if (currentFocusedGroupEl && currentFocusedGroupEl !== target) {
        currentFocusedGroupEl.classList.remove('focused');
      }
      if (target) {
        target.classList.add('focused');
        currentFocusedGroupEl = target;

        const container = el.groupsList;
        if (container) {
          const totalHeight = 68; // 58px altezza + 10px gap
          const targetTop = state.focusedGroupIdx * totalHeight;
          const containerHeight = 620;
          const currentScroll = container.scrollTop || 0;

          if (targetTop < currentScroll + totalHeight) {
            container.scrollTop = Math.max(0, targetTop - totalHeight);
          } else if (targetTop + totalHeight > currentScroll + containerHeight - totalHeight) {
            container.scrollTop = targetTop + totalHeight * 2 - containerHeight;
          }
        }
      }
    }
  }

  function scrollFocusedIntoView() {
    updateFocusVisuals();
  }

  function toggleOverlay(visible) {
    state.overlayVisible = visible;
    if (visible) {
      hideZappingBanner();
      el.overlay.classList.remove('hidden');

      // Attiva Mini-Player PiP se un video è in riproduzione o pronto
      if (el.videoContainer && (state.currentPlayingChannel || (el.video && !el.video.paused))) {
        el.videoContainer.classList.add('pip-mode');
      }

      if (state.currentPlayingChannel) {
        const pIdx = state.filteredChannels.findIndex(c => c.id === state.currentPlayingChannel.id);
        if (pIdx >= 0) state.focusedChannelIdx = pIdx;
      }
      setFocusZone('channels');
      if (state.filteredChannels.length && state.focusedChannelIdx >= 0) {
        updateFocusedChannelDetails(state.filteredChannels[state.focusedChannelIdx]);
      }
    } else {
      el.overlay.classList.add('hidden');
      if (el.videoContainer) {
        el.videoContainer.classList.remove('pip-mode');
      }
    }
  }

  // -----------------------------------------------------------
  // SCHEDA DETTAGLI CANALE EVIDENZIATO (COLONNA PREVIEW)
  // -----------------------------------------------------------
  function updateFocusedChannelDetails(channel) {
    if (!el.focusedCard || !channel) return;

    if (el.cardLcn) el.cardLcn.textContent = `CH ${channel.lcn || (state.focusedChannelIdx + 1)}`;
    if (el.cardTitle) el.cardTitle.textContent = channel.customTitle || channel.title || 'Canale';
    if (el.cardGroup) el.cardGroup.textContent = channel.customGroup || channel.group || 'GENERALE';

    const logoSrc = channel.customLogo || channel.logo;
    if (el.cardLogo) {
      if (logoSrc) {
        el.cardLogo.src = logoSrc;
        el.cardLogo.style.display = 'block';
      } else {
        el.cardLogo.style.display = 'none';
      }
    }

    const epg = getEpgForChannel(channel);
    if (el.cardEpgTitle) el.cardEpgTitle.textContent = epg.nowTitle || 'Nessuna informazione guida TV';
    if (el.cardEpgTime) el.cardEpgTime.textContent = epg.nowTime || '--:-- - --:--';
    if (el.cardEpgProgress) el.cardEpgProgress.style.width = `${epg.progress || 0}%`;
    if (el.cardEpgDesc) el.cardEpgDesc.textContent = epg.nowDesc || 'Nessuna trama o descrizione disponibile per questo evento.';
    if (el.cardNextTitle) el.cardNextTitle.textContent = epg.nextTitle || 'Nessun evento successivo';
    if (el.cardNextTime) el.cardNextTime.textContent = epg.nextTime ? `(${epg.nextTime})` : '';
  }

  // -----------------------------------------------------------
  // GESTIONE ZAPPING RAPIDO SKY GLASS (DEBOUNCE 800MS)
  // -----------------------------------------------------------
  let zappingDebounceTimer = null;
  let zappingDismissTimer = null;
  let isZappingActive = false;

  function quickZap(delta) {
    if (!state.filteredChannels || state.filteredChannels.length === 0) return;

    hideBottomOsd();
    isZappingActive = true;
    clearTimeout(zappingDismissTimer);
    clearTimeout(zappingDebounceTimer);

    let nextIdx = state.focusedChannelIdx + delta;
    if (nextIdx < 0) nextIdx = state.filteredChannels.length - 1;
    if (nextIdx >= state.filteredChannels.length) nextIdx = 0;

    state.focusedChannelIdx = nextIdx;
    const targetChannel = state.filteredChannels[nextIdx];

    showZappingBanner(targetChannel, false);

    zappingDebounceTimer = setTimeout(() => {
      commitZapping();
    }, 800);
  }

  function commitZapping() {
    clearTimeout(zappingDebounceTimer);
    const targetChannel = state.filteredChannels[state.focusedChannelIdx];
    if (!targetChannel) return;

    if (el.zapStatusPill) {
      el.zapStatusPill.textContent = 'IN DIRETTA';
      el.zapStatusPill.classList.add('playing');
    }

    playChannelByIndex(state.focusedChannelIdx);

    clearTimeout(zappingDismissTimer);
    zappingDismissTimer = setTimeout(() => {
      hideZappingBanner();
    }, 3000);
  }

  function cancelZapping() {
    clearTimeout(zappingDebounceTimer);
    clearTimeout(zappingDismissTimer);
    isZappingActive = false;
    if (state.currentPlayingChannel) {
      const currIdx = state.filteredChannels.findIndex(c => c.id === state.currentPlayingChannel.id);
      if (currIdx >= 0) state.focusedChannelIdx = currIdx;
    }
    hideZappingBanner();
  }

  function showZappingBanner(channel, isPlaying) {
    if (!el.zappingBanner || !channel) return;

    if (el.zapLcn) el.zapLcn.textContent = `CH ${channel.lcn || (state.focusedChannelIdx + 1)}`;
    if (el.zapTitle) el.zapTitle.textContent = channel.customTitle || channel.title || 'Canale';
    if (el.zapGroup) el.zapGroup.textContent = channel.customGroup || channel.group || 'GENERALE';

    const logoSrc = channel.customLogo || channel.logo;
    if (el.zapLogo) {
      if (logoSrc) {
        el.zapLogo.src = logoSrc;
        el.zapLogo.style.display = 'block';
      } else {
        el.zapLogo.style.display = 'none';
      }
    }

    const epg = getEpgForChannel(channel);
    if (el.zapProgTitle) el.zapProgTitle.textContent = epg.nowTitle || 'Nessun programma in onda';
    if (el.zapProgTime) el.zapProgTime.textContent = epg.nowTime || '--:-- - --:--';
    if (el.zapProgProgress) el.zapProgProgress.style.width = `${epg.progress || 0}%`;

    if (el.zapStatusPill) {
      if (isPlaying) {
        el.zapStatusPill.textContent = 'IN DIRETTA';
        el.zapStatusPill.classList.add('playing');
      } else {
        el.zapStatusPill.textContent = 'SINTONIZZA...';
        el.zapStatusPill.classList.remove('playing');
      }
    }

    el.zappingBanner.classList.remove('hidden');
  }

  function hideZappingBanner() {
    clearTimeout(zappingDebounceTimer);
    clearTimeout(zappingDismissTimer);
    isZappingActive = false;
    if (el.zappingBanner) el.zappingBanner.classList.add('hidden');
  }

  function zapChannel(delta) {
    quickZap(delta);
  }

  function handleNumberDial(digit) {
    state.numberBuffer += digit;
    if (el.jumpDigits) el.jumpDigits.textContent = state.numberBuffer;
    if (el.numberOsd) el.numberOsd.classList.remove('hidden');

    clearTimeout(state.numberTimer);
    state.numberTimer = setTimeout(() => {
      const channelNum = parseInt(state.numberBuffer, 10);
      state.numberBuffer = '';
      if (el.numberOsd) el.numberOsd.classList.add('hidden');

      if (!isNaN(channelNum) && channelNum > 0) {
        // 1. Cerca canale corrispondente all'LCN nel gruppo corrente
        let foundIdx = state.filteredChannels.findIndex(c => c.lcn === channelNum);
        
        // 2. Se non presente nel gruppo corrente, cerca tra tutti i canali
        if (foundIdx === -1) {
          const globalIdx = state.channels.findIndex(c => c.lcn === channelNum);
          if (globalIdx !== -1) {
            selectGroup(0, false);
            state.currentGroup = 'ALL';
            filterChannelsByGroup('ALL');
            foundIdx = globalIdx;
          }
        }

        // 3. Fallback per indice progressivo 1..N
        if (foundIdx === -1 && channelNum <= state.filteredChannels.length) {
          foundIdx = channelNum - 1;
        }

        if (foundIdx !== -1) {
          state.focusedChannelIdx = foundIdx;
          playChannelByIndex(foundIdx);
          updateFocusVisuals();
        } else {
          showToast(`Canale ${channelNum} non trovato`);
        }
      }
    }, 1200);
  }

  let activePlayMonitorInterval = null;

  // Gestione Spinner e Stato Player con Polling Attivo e Auto-Dismiss
  function showSpinner(text) {
    if (el.spinnerText) el.spinnerText.textContent = text || 'Caricamento...';
    if (el.spinner) {
      el.spinner.classList.remove('hidden');
      el.spinner.style.display = 'flex';
      el.spinner.style.opacity = '1';
      el.spinner.style.visibility = 'visible';
    }
    startActivePlaybackMonitor();
  }

  function hideSpinner() {
    clearTimeout(bufferingDebounceTimer);
    clearTimeout(loadingWatchdogTimer);
    if (activePlayMonitorInterval) {
      clearInterval(activePlayMonitorInterval);
      activePlayMonitorInterval = null;
    }
    if (el.spinner) {
      el.spinner.classList.add('hidden');
      el.spinner.style.display = 'none';
      el.spinner.style.opacity = '0';
      el.spinner.style.visibility = 'hidden';
    }
  }

  // Monitor attivo continuo: non appena i frame o il playback sono avviati, nascondi SUBITO lo spinner!
  function startActivePlaybackMonitor() {
    if (activePlayMonitorInterval) clearInterval(activePlayMonitorInterval);
    let checks = 0;
    activePlayMonitorInterval = setInterval(() => {
      checks++;
      if (!el.video) return;

      // Se il video è avviato (non in pausa) ed ha dati pronti (readyState >= 1 o time che scorre o frame decodificati)
      const isVideoActive = !el.video.paused && (
        el.video.readyState >= 1 ||
        el.video.currentTime > 0 ||
        (el.video.webkitDecodedFrameCount && el.video.webkitDecodedFrameCount > 0)
      );

      if (isVideoActive) {
        hideSpinner();
        return;
      }

      // Timeout di sicurezza massimo: dopo 5 secondi nascondi comunque per evitare blocchi permanenti a video
      if (checks > 25) { // 25 * 200ms = 5s
        hideSpinner();
      }
    }, 200);
  }

  function handlePlayerStatus(status, data) {
    switch (status) {
      case 'loading':
        clearTimeout(bufferingDebounceTimer);
        showSpinner(data && data.fallback ? 'Attivazione fallback stream copy...' : 'Caricamento flusso...');
        break;
      case 'buffering':
        clearTimeout(bufferingDebounceTimer);
        // Debounce: mostra "Buffering..." solo se l'attesa persiste oltre 1500ms
        bufferingDebounceTimer = setTimeout(() => {
          if (el.video && (el.video.paused || el.video.readyState < 2)) {
            showSpinner('Buffering...');
            // Auto-hide entro 3.5s per evitare che resti sovrimpresso
            setTimeout(() => {
              if (el.video && !el.video.paused) hideSpinner();
            }, 3500);
          }
        }, 1500);
        break;
      case 'playing':
        hideSpinner();
        break;
      case 'error':
        hideSpinner();
        showToast(`⚠️ ${data && data.error ? data.error : 'Errore riproduzione'}`);
        break;
    }
  }

  // -----------------------------------------------------------
  // GESTIONE GUIDA TV SKY GLASS (TIMELINE GRID)
  // -----------------------------------------------------------
  async function openGuideModal() {
    state.focusZone = 'timeline';
    if (el.guideGroupBadge) {
      const current = state.groups.find(g => g.id === state.currentGroup);
      el.guideGroupBadge.textContent = current ? current.name : 'TUTTI I CANALI';
    }
    if (el.guideModal) el.guideModal.classList.remove('hidden');
    showToast('Caricamento Guida TV...', 1200);

    try {
      const headers = {};
      if (state.authToken) headers['x-auth-token'] = state.authToken;
      const groupParam = encodeURIComponent(state.currentGroup);
      const res = await fetch(`${state.serverBaseClean()}/api/epg/timeline?hours=4&group=${groupParam}`, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      state.timelineData = await res.json();
      renderTimelineGrid();
    } catch (e) {
      console.error('[TvApp] Errore caricamento timeline:', e);
      showToast('⚠️ Errore caricamento Guida TV');
    }
  }

  function closeGuideModal() {
    if (el.guideModal) el.guideModal.classList.add('hidden');
    if (state.focusZone === 'timeline') {
      state.focusZone = 'channels';
      updateFocusVisuals();
    }
  }

  function renderTimelineGrid() {
    if (!state.timelineData || !el.guideTimeSlots || !el.guideGridContent) return;

    // Renderizza slot orari
    el.guideTimeSlots.innerHTML = '';
    (state.timelineData.timeSlots || []).forEach(slot => {
      const cell = document.createElement('div');
      cell.className = 'time-slot-cell';
      cell.textContent = slot.label;
      el.guideTimeSlots.appendChild(cell);
    });

    // Renderizza righe canali
    el.guideGridContent.innerHTML = '';
    const channels = state.timelineData.channels || [];

    channels.forEach((ch, chIdx) => {
      const row = document.createElement('div');
      row.className = 'guide-channel-row';
      row.id = `guide-channel-row-${chIdx}`;

      const logoSrc = ch.logo || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="50" height="40" viewBox="0 0 50 40"><rect width="50" height="40" fill="%231a2233"/><text x="25" y="24" fill="%2300e5ff" font-size="14" font-family="sans-serif" text-anchor="middle">TV</text></svg>';

      const badge = document.createElement('div');
      badge.className = 'guide-channel-badge';
      badge.innerHTML = `
        <img src="${escapeHtml(logoSrc)}" class="guide-ch-logo" alt="" onerror="this.style.display='none'">
        <div class="guide-ch-meta">
          <span class="guide-ch-lcn">CH ${ch.lcn || (chIdx + 1)}</span>
          <span class="guide-ch-title">${escapeHtml(ch.title || 'Canale')}</span>
        </div>
      `;
      row.appendChild(badge);

      const track = document.createElement('div');
      track.className = 'guide-programmes-track';
      track.id = `guide-track-${chIdx}`;

      (ch.programmes || []).forEach((p, pIdx) => {
        const item = document.createElement('div');
        const duration = p.durationMinutes || 30;
        const widthPx = Math.max(130, Math.round((duration / 30) * 220));
        item.className = `guide-prog-item ${p.isLive ? 'live' : ''}`;
        item.style.width = `${widthPx}px`;
        item.dataset.chIdx = chIdx;
        item.dataset.progIdx = pIdx;
        item.id = `guide-prog-${chIdx}-${pIdx}`;

        item.innerHTML = `
          <div class="prog-item-title">${escapeHtml(p.title || 'Programma')}</div>
          <div class="prog-item-time">${escapeHtml(p.startTime || '')} - ${escapeHtml(p.stopTime || '')}</div>
          ${p.isLive ? `<div class="prog-item-progress-bar" style="width: ${p.progress || 0}%;"></div>` : ''}
        `;

        item.addEventListener('click', () => {
          state.timelineChannelIdx = chIdx;
          state.timelineProgIdx = pIdx;
          updateTimelineFocusVisuals();
          handleTimelineSelect();
        });

        track.appendChild(item);
      });

      row.appendChild(track);
      el.guideGridContent.appendChild(row);
    });

    // Seleziona il canale corrente o il primo
    let initialChIdx = 0;
    if (state.currentPlayingChannel) {
      const pIdx = channels.findIndex(c => c.id === state.currentPlayingChannel.id);
      if (pIdx >= 0) initialChIdx = pIdx;
    }
    state.timelineChannelIdx = initialChIdx;

    // Seleziona l'evento live
    const currCh = channels[initialChIdx];
    let initialProgIdx = 0;
    if (currCh && currCh.programmes) {
      const liveIdx = currCh.programmes.findIndex(p => p.isLive);
      if (liveIdx >= 0) initialProgIdx = liveIdx;
    }
    state.timelineProgIdx = initialProgIdx;

    updateTimelineFocusVisuals();
  }

  function navigateTimeline(dProg, dCh) {
    if (!state.timelineData || !state.timelineData.channels) return;
    const channels = state.timelineData.channels;
    if (channels.length === 0) return;

    if (dCh !== 0) {
      const nextCh = state.timelineChannelIdx + dCh;
      if (nextCh >= 0 && nextCh < channels.length) {
        state.timelineChannelIdx = nextCh;
        const maxProg = (channels[nextCh].programmes || []).length - 1;
        state.timelineProgIdx = Math.min(state.timelineProgIdx, Math.max(0, maxProg));
      }
    }

    if (dProg !== 0) {
      const currCh = channels[state.timelineChannelIdx];
      const progs = currCh ? currCh.programmes || [] : [];
      const nextProg = state.timelineProgIdx + dProg;
      if (nextProg >= 0 && nextProg < progs.length) {
        state.timelineProgIdx = nextProg;
      }
    }

    updateTimelineFocusVisuals();
  }

  function updateTimelineFocusVisuals() {
    if (!state.timelineData || !state.timelineData.channels) return;
    const channels = state.timelineData.channels;
    const ch = channels[state.timelineChannelIdx];
    if (!ch) return;
    const progs = ch.programmes || [];
    const prog = progs[state.timelineProgIdx];

    const prev = el.guideGridContent.querySelector('.guide-prog-item.focused');
    if (prev) prev.classList.remove('focused');

    const currEl = document.getElementById(`guide-prog-${state.timelineChannelIdx}-${state.timelineProgIdx}`);
    if (currEl) {
      currEl.classList.add('focused');
      const track = document.getElementById(`guide-track-${state.timelineChannelIdx}`);
      if (track) {
        const itemLeft = currEl.offsetLeft;
        const itemWidth = currEl.offsetWidth;
        const trackScroll = track.scrollLeft;
        const trackWidth = track.clientWidth;
        if (itemLeft < trackScroll) {
          track.scrollLeft = itemLeft;
        } else if (itemLeft + itemWidth > trackScroll + trackWidth) {
          track.scrollLeft = itemLeft + itemWidth - trackWidth + 40;
        }
      }
      const row = document.getElementById(`guide-channel-row-${state.timelineChannelIdx}`);
      if (row && el.guideGridViewport) {
        const rowTop = row.offsetTop;
        const rowHeight = row.offsetHeight;
        const vpScroll = el.guideGridViewport.scrollTop;
        const vpHeight = el.guideGridViewport.clientHeight;
        if (rowTop < vpScroll) {
          el.guideGridViewport.scrollTop = rowTop;
        } else if (rowTop + rowHeight > vpScroll + vpHeight) {
          el.guideGridViewport.scrollTop = rowTop + rowHeight - vpHeight + 20;
        }
      }
    }

    if (prog) {
      if (el.previewProgTitle) el.previewProgTitle.textContent = `${prog.title} (CH ${ch.lcn || (state.timelineChannelIdx + 1)} - ${ch.title})`;
      if (el.previewProgMeta) {
        const cat = prog.category ? ` • ${prog.category}` : '';
        const dur = prog.durationMinutes ? ` • ${prog.durationMinutes} min` : '';
        el.previewProgMeta.textContent = `${prog.startTime} - ${prog.stopTime}${dur}${cat}${prog.isLive ? ' • IN ONDA ORA' : ''}`;
      }
      if (el.previewProgDesc) el.previewProgDesc.textContent = prog.desc || 'Nessuna descrizione disponibile per questo evento.';
    }
  }

  function handleTimelineSelect() {
    if (!state.timelineData || !state.timelineData.channels) return;
    const ch = state.timelineData.channels[state.timelineChannelIdx];
    if (!ch) return;
    const prog = (ch.programmes || [])[state.timelineProgIdx];
    if (!prog) return;

    if (prog.isLive) {
      closeGuideModal();
      const chObj = state.channels.find(c => c.id === ch.id);
      if (chObj) {
        const idx = state.filteredChannels.findIndex(c => c.id === ch.id);
        if (idx >= 0) state.focusedChannelIdx = idx;
        window.tvPlayer.play(chObj);
        state.currentPlayingChannel = chObj;
        showBottomOsd(chObj);
        toggleOverlay(false);
      }
    } else {
      openEventDetailModal(prog, ch);
    }
  }

  function openEventDetailModal(prog, ch) {
    state.focusZone = 'event_detail';
    if (el.eventDetailChannel) el.eventDetailChannel.textContent = `CH ${ch.lcn || ''} - ${ch.title}`;
    if (el.eventDetailTime) el.eventDetailTime.textContent = `${prog.startTime} - ${prog.stopTime} (${prog.durationMinutes} min)`;
    if (el.eventDetailTitle) el.eventDetailTitle.textContent = prog.title;
    if (el.eventDetailCategory) el.eventDetailCategory.textContent = prog.category ? `Genere: ${prog.category}` : '';
    if (el.eventDetailDesc) el.eventDetailDesc.textContent = prog.desc || 'Nessuna trama o descrizione disponibile per questo evento.';
    if (el.eventDetailModal) el.eventDetailModal.classList.remove('hidden');
    if (el.btnCloseEventDetail) el.btnCloseEventDetail.focus();
  }

  function closeEventDetailModal() {
    if (el.eventDetailModal) el.eventDetailModal.classList.add('hidden');
    state.focusZone = 'timeline';
    updateTimelineFocusVisuals();
  }

  // Gestione Modal Impostazioni & Eventi
  function setupModalEvents() {
    if (el.btnOpenGuide) {
      el.btnOpenGuide.addEventListener('click', () => {
        openGuideModal();
      });
    }

    if (el.btnCloseEventDetail) {
      el.btnCloseEventDetail.addEventListener('click', () => {
        closeEventDetailModal();
      });
    }

    if (el.btnSaveSettings) {
      el.btnSaveSettings.addEventListener('click', () => {
        const url = el.cfgServerUrl.value.trim();
        const token = el.cfgAuthToken.value.trim();
        const mode = el.cfgPlayerMode.value;

        if (url) {
          state.serverUrl = url;
          localStorage.setItem('iosonofratv_server', url);
          localStorage.setItem('mandrakodi_tv_server', url);
        }
        state.authToken = token;
        localStorage.setItem('iosonofratv_token', token);
        localStorage.setItem('mandrakodi_tv_token', token);
        state.playerMode = mode;
        localStorage.setItem('iosonofratv_mode', mode);
        localStorage.setItem('mandrakodi_tv_mode', mode);

        window.tvPlayer.setServerBase(state.serverUrl);
        window.tvPlayer.setAuthToken(state.authToken);
        updateServerBadge();
        closeSettingsModal();
        loadChannels();
        showToast('✅ Impostazioni salvate');
      });
    }

    if (el.btnCancelSettings) {
      el.btnCancelSettings.addEventListener('click', () => {
        closeSettingsModal();
      });
    }
  }

  function openSettingsModal() {
    state.focusZone = 'modal';
    if (el.cfgServerUrl) el.cfgServerUrl.value = state.serverUrl;
    if (el.cfgAuthToken) el.cfgAuthToken.value = state.authToken;
    if (el.cfgPlayerMode) el.cfgPlayerMode.value = state.playerMode;
    if (el.settingsModal) el.settingsModal.classList.remove('hidden');
    if (el.cfgServerUrl) el.cfgServerUrl.focus();
  }

  function closeSettingsModal() {
    if (el.settingsModal) el.settingsModal.classList.add('hidden');
    state.focusZone = 'channels';
    updateFocusVisuals();
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Avvio all'evento DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }
})();

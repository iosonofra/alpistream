/**
 * MandraKodi TV - Main Controller & Remote Control Navigation
 * TiviMate-style 10-foot UI, D-Pad Spatial Navigation, EPG Timeline & Direct Channel Dialing
 */

(function () {
  'use strict';

  // Configurazione Server & Storage
  const DEFAULT_SERVER = (window.location.protocol.startsWith('http') && !window.location.host.includes('localhost:5173'))
    ? window.location.origin
    : 'https://alpistream.iosonofra.click';

  const state = {
    serverUrl: localStorage.getItem('mandrakodi_tv_server') || DEFAULT_SERVER,
    authToken: localStorage.getItem('mandrakodi_tv_token') || '',
    playerMode: localStorage.getItem('mandrakodi_tv_mode') || 'auto',
    channels: [],
    groups: [],
    currentGroup: 'ALL',
    filteredChannels: [],
    currentPlayingChannel: null,
    epgMap: new Map(), // tvgId -> [{ title, start, stop, desc }]
    focusZone: 'channels', // 'groups' | 'channels' | 'modal'
    focusedGroupIdx: 0,
    focusedChannelIdx: 0,
    overlayVisible: true,
    osdTimer: null,
    numberBuffer: '',
    numberTimer: null,
    epgTimer: null
  };

  // Elementi DOM
  const el = {
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
    // OSD Bottom elements
    osdLogo: document.getElementById('osd-channel-logo'),
    osdChNo: document.getElementById('osd-channel-number'),
    osdTitle: document.getElementById('osd-channel-title'),
    osdStreamBadge: document.getElementById('osd-stream-badge'),
    osdEpgNowTitle: document.getElementById('osd-epg-now-title'),
    osdEpgNowTime: document.getElementById('osd-epg-now-time'),
    osdProgressBar: document.getElementById('osd-epg-progress-bar'),
    osdEpgNextTitle: document.getElementById('osd-epg-next-title'),
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

  // Caricamento Canali dal Server MandraKodi
  async function loadChannels() {
    showSpinner('Caricamento canali...');
    try {
      const headers = {};
      if (state.authToken) headers['x-auth-token'] = state.authToken;

      const res = await fetch(`${state.serverBaseClean()}/api/channels`, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      state.channels = (Array.isArray(data) ? data : []).filter(c => c && c.enabled !== false);
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

  // Caricamento EPG
  async function loadEpg() {
    try {
      const res = await fetch(`${state.serverBaseClean()}/api/epg`);
      if (!res.ok) return;
      const data = await res.json();

      state.epgMap.clear();
      if (data && typeof data === 'object') {
        // Se è mappa tvgId -> canali
        for (const [key, val] of Object.entries(data)) {
          state.epgMap.set(key.toLowerCase(), val);
        }
      }
      updateEpgDisplay();
    } catch (e) {
      console.warn('[TvApp] EPG non disponibile:', e.message);
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

  function selectGroup(idx) {
    state.focusedGroupIdx = idx;
    const g = state.groups[idx];
    if (!g) return;
    state.currentGroup = g.id;
    filterChannelsByGroup(g.id);
    renderGroups();
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

  // Renderizzazione Canali
  function renderChannels() {
    if (!el.channelsList) return;
    el.channelsList.innerHTML = '';

    state.filteredChannels.forEach((ch, idx) => {
      const isPlaying = state.currentPlayingChannel && state.currentPlayingChannel.id === ch.id;
      const isFocused = state.focusZone === 'channels' && idx === state.focusedChannelIdx;

      const item = document.createElement('div');
      item.className = `channel-item ${isPlaying ? 'active-playing' : ''} ${isFocused ? 'focused' : ''}`;
      item.dataset.index = idx;
      item.id = `channel-item-${idx}`;

      const logoSrc = ch.customLogo || ch.logo || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="50" height="40" viewBox="0 0 50 40"><rect width="50" height="40" fill="%231a2233"/><text x="25" y="24" fill="%2300e5ff" font-size="14" font-family="sans-serif" text-anchor="middle">TV</text></svg>';
      const epgInfo = getEpgForChannel(ch);

      item.innerHTML = `
        <span class="channel-num">${idx + 1}</span>
        <div class="channel-logo-wrapper">
          <img class="channel-logo-img" src="${escapeHtml(logoSrc)}" alt="" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'50\\' height=\\'40\\'><rect width=\\'50\\' height=\\'40\\' fill=\\'%23222\\'/></svg>'">
        </div>
        <div class="channel-text-info">
          <div class="channel-title-row">
            <span class="channel-name">${escapeHtml(ch.customTitle || ch.title || 'Canale')}</span>
          </div>
          <div class="channel-epg-info">
            <span class="epg-now-text">${escapeHtml(epgInfo.nowTitle)}</span>
            <div class="epg-mini-bar">
              <div class="epg-mini-bar-fill" style="width: ${epgInfo.progress}%;"></div>
            </div>
          </div>
        </div>
      `;

      item.addEventListener('click', () => {
        state.focusedChannelIdx = idx;
        playChannelByIndex(idx);
      });

      el.channelsList.appendChild(item);
    });

    scrollFocusedIntoView();
  }

  function getEpgForChannel(ch) {
    const key = (ch.tvgId || ch.title || '').trim().toLowerCase();
    const events = state.epgMap.get(key) || [];
    const now = Date.now();

    let nowEvt = null;
    let nextEvt = null;

    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      const start = new Date(ev.start).getTime();
      const stop = new Date(ev.stop).getTime();
      if (now >= start && now <= stop) {
        nowEvt = ev;
        nextEvt = events[i + 1] || null;
        break;
      }
    }

    if (!nowEvt) {
      return {
        nowTitle: 'Diretta TV',
        nowTime: '',
        nextTitle: 'Nessuna informazione EPG',
        progress: 0
      };
    }

    const startMs = new Date(nowEvt.start).getTime();
    const stopMs = new Date(nowEvt.stop).getTime();
    const duration = stopMs - startMs;
    const elapsed = now - startMs;
    const progress = duration > 0 ? Math.min(100, Math.max(0, (elapsed / duration) * 100)) : 0;

    const formatTime = (iso) => {
      const d = new Date(iso);
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    };

    return {
      nowTitle: nowEvt.title,
      nowTime: `${formatTime(nowEvt.start)} - ${formatTime(nowEvt.stop)}`,
      nextTitle: nextEvt ? `${formatTime(nextEvt.start)} ${nextEvt.title}` : 'Nessuna informazione',
      progress: Math.round(progress)
    };
  }

  function updateEpgDisplay() {
    // Aggiorna OSD inferiore se visibile
    if (state.currentPlayingChannel && !el.bottomOsd.classList.contains('hidden')) {
      const epg = getEpgForChannel(state.currentPlayingChannel);
      if (el.osdEpgNowTitle) el.osdEpgNowTitle.textContent = epg.nowTitle;
      if (el.osdEpgNowTime) el.osdEpgNowTime.textContent = epg.nowTime;
      if (el.osdProgressBar) el.osdProgressBar.style.width = `${epg.progress}%`;
      if (el.osdEpgNextTitle) el.osdEpgNextTitle.textContent = epg.nextTitle;
    }
  }

  // Riproduzione Canale
  function playChannelByIndex(idx) {
    if (idx < 0 || idx >= state.filteredChannels.length) return;
    const ch = state.filteredChannels[idx];
    state.currentPlayingChannel = ch;

    // Aggiorna classe active-playing sugli elementi canali
    const items = el.channelsList.querySelectorAll('.channel-item');
    items.forEach((it, i) => {
      it.classList.toggle('active-playing', i === idx);
    });

    // Avvia riproduzione video
    window.tvPlayer.play(ch);

    // Mostra OSD a scomparsa
    showBottomOsd(ch);
  }

  function showBottomOsd(ch) {
    if (!el.bottomOsd) return;
    const epg = getEpgForChannel(ch);

    if (el.osdLogo) el.osdLogo.src = ch.customLogo || ch.logo || '';
    if (el.osdChNo) el.osdChNo.textContent = `CH ${state.focusedChannelIdx + 1}`;
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

    // Tasti Numerici (0-9) per salto canale
    if ((keyCode >= 48 && keyCode <= 57) || (keyCode >= 96 && keyCode <= 105)) {
      const digit = key.replace(/Numpad/i, '');
      handleNumberDial(digit);
      e.preventDefault();
      return;
    }

    // Tasti Channel Up / Channel Down (P+ / P-)
    if (keyCode === 33 || keyCode === 427) { // PageUp / ChannelUp
      zapChannel(1);
      e.preventDefault();
      return;
    }
    if (keyCode === 34 || keyCode === 428) { // PageDown / ChannelDown
      zapChannel(-1);
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
      if (keyCode === 13 || key === 'Enter') { // OK mostra overlay
        toggleOverlay(true);
        e.preventDefault();
        return;
      }
      if (keyCode === 38 || key === 'ArrowUp') {
        zapChannel(-1);
        e.preventDefault();
        return;
      }
      if (keyCode === 39 || key === 'ArrowRight') {
        zapChannel(1);
        e.preventDefault();
        return;
      }
      if (keyCode === 40 || key === 'ArrowDown') {
        zapChannel(1);
        e.preventDefault();
        return;
      }
      if (keyCode === 37 || key === 'ArrowLeft') {
        zapChannel(-1);
        e.preventDefault();
        return;
      }
      return;
    }

    // Navigazione D-Pad nell'Overlay Visibile
    switch (keyCode) {
      case 38: // ArrowUp
        moveFocusVertical(-1);
        e.preventDefault();
        break;
      case 40: // ArrowDown
        moveFocusVertical(1);
        e.preventDefault();
        break;
      case 37: // ArrowLeft
        moveFocusHorizontal(-1);
        e.preventDefault();
        break;
      case 39: // ArrowRight
        moveFocusHorizontal(1);
        e.preventDefault();
        break;
      case 13: // Enter / OK
        handleOkPress();
        e.preventDefault();
        break;
    }
  }

  function moveFocusVertical(delta) {
    if (state.focusZone === 'groups') {
      const next = state.focusedGroupIdx + delta;
      if (next >= 0 && next < state.groups.length) {
        selectGroup(next);
        updateFocusVisuals();
      }
    } else if (state.focusZone === 'channels') {
      const next = state.focusedChannelIdx + delta;
      if (next >= 0 && next < state.filteredChannels.length) {
        state.focusedChannelIdx = next;
        updateFocusVisuals();
      }
    }
  }

  function moveFocusHorizontal(delta) {
    if (delta > 0 && state.focusZone === 'groups') {
      // Passa a canali
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
      setFocusZone('channels');
    }
  }

  function updateFocusVisuals() {
    // Gruppi
    const groupItems = el.groupsList ? el.groupsList.querySelectorAll('.group-item') : [];
    groupItems.forEach((it, i) => {
      it.classList.toggle('focused', state.focusZone === 'groups' && i === state.focusedGroupIdx);
    });

    // Canali
    const chanItems = el.channelsList ? el.channelsList.querySelectorAll('.channel-item') : [];
    chanItems.forEach((it, i) => {
      it.classList.toggle('focused', state.focusZone === 'channels' && i === state.focusedChannelIdx);
    });

    scrollFocusedIntoView();
  }

  function scrollFocusedIntoView() {
    if (state.focusZone === 'channels') {
      const focusedItem = document.getElementById(`channel-item-${state.focusedChannelIdx}`);
      if (focusedItem && el.channelsList) {
        focusedItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    } else if (state.focusZone === 'groups') {
      const focusedGroup = el.groupsList ? el.groupsList.children[state.focusedGroupIdx] : null;
      if (focusedGroup) {
        focusedGroup.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }

  function toggleOverlay(visible) {
    state.overlayVisible = visible;
    if (visible) {
      el.overlay.classList.remove('hidden');
      updateFocusVisuals();
    } else {
      el.overlay.classList.add('hidden');
    }
  }

  function zapChannel(delta) {
    const next = state.focusedChannelIdx + delta;
    if (next >= 0 && next < state.filteredChannels.length) {
      state.focusedChannelIdx = next;
      playChannelByIndex(next);
      updateFocusVisuals();
    }
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

      if (!isNaN(channelNum) && channelNum >= 1 && channelNum <= state.filteredChannels.length) {
        state.focusedChannelIdx = channelNum - 1;
        playChannelByIndex(channelNum - 1);
        updateFocusVisuals();
      } else {
        showToast(`Canale ${channelNum} non trovato`);
      }
    }, 1200);
  }

  // Gestione Spinner e Stato Player
  function showSpinner(text) {
    if (el.spinnerText) el.spinnerText.textContent = text || 'Caricamento...';
    if (el.spinner) el.spinner.classList.remove('hidden');
  }

  function hideSpinner() {
    if (el.spinner) el.spinner.classList.add('hidden');
  }

  function handlePlayerStatus(status, data) {
    switch (status) {
      case 'loading':
        showSpinner(data.fallback ? 'Attivazione fallback stream copy...' : 'Caricamento flusso...');
        break;
      case 'buffering':
        showSpinner('Buffering...');
        break;
      case 'playing':
        hideSpinner();
        break;
      case 'error':
        hideSpinner();
        showToast(`⚠️ ${data.error || 'Errore riproduzione'}`);
        break;
    }
  }

  // Gestione Modal Impostazioni
  function setupModalEvents() {
    if (el.btnSaveSettings) {
      el.btnSaveSettings.addEventListener('click', () => {
        const url = el.cfgServerUrl.value.trim();
        const token = el.cfgAuthToken.value.trim();
        const mode = el.cfgPlayerMode.value;

        if (url) {
          state.serverUrl = url;
          localStorage.setItem('mandrakodi_tv_server', url);
        }
        state.authToken = token;
        localStorage.setItem('mandrakodi_tv_token', token);
        state.playerMode = mode;
        localStorage.setItem('mandrakodi_tv_mode', mode);

        window.tvPlayer.setServerBase(state.serverUrl);
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

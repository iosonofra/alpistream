// Gestione Palinsesto Eventi Sportivi Live (in stile LiveOnSat) con Link Diretti

let currentEventSport = 'all';
let currentEventStatus = 'all';
let currentEventSearch = '';
let eventSearchDebounce = null;
const eventChannelsCache = new Map();

async function loadEvents() {
  const container = document.getElementById('events-cards-grid');
  const countEl = document.getElementById('events-count-badge');
  const liveCountEl = document.getElementById('events-live-count');

  if (!container) return;
  container.innerHTML = '<div class="text-muted" style="padding: 24px; text-align: center; grid-column: 1 / -1;">Caricamento palinsesto eventi in corso...</div>';

  try {
    const params = new URLSearchParams({
      sport: currentEventSport,
      status: currentEventStatus,
      search: currentEventSearch
    });

    const res = await fetch(`/api/events?${params.toString()}`);
    const data = await res.json();
    const events = data.events || [];

    if (countEl) countEl.innerText = `${data.total || 0} Eventi Oggi`;
    if (liveCountEl) liveCountEl.innerText = `${data.liveCount || 0} in Diretta Ora`;

    container.innerHTML = '';
    if (events.length === 0) {
      container.innerHTML = '<div class="text-muted" style="padding: 32px; text-align: center; grid-column: 1 / -1;">Nessun evento trovato per i filtri selezionati. Prova a ricaricare o a selezionare "Tutti".</div>';
      return;
    }

    events.forEach(ev => {
      // Memorizza canali associati nella cache per click sicuro
      [...ev.officialChannels, ...ev.directStreams].forEach(ch => {
        eventChannelsCache.set(ch.id, ch);
      });

      const card = document.createElement('div');
      const isLive = ev.status === 'LIVE_NOW';
      card.className = `event-card ${isLive ? 'event-card-live' : ''}`;

      // Sport Icon
      let sportIcon = '⚽';
      if (ev.sport === 'motori') sportIcon = '🏎️';
      else if (ev.sport === 'tennis') sportIcon = '🎾';
      else if (ev.sport === 'basket') sportIcon = '🏀';
      else if (ev.sport === 'combattimento') sportIcon = '🥊';
      else if (ev.sport === 'golf') sportIcon = '⛳';

      // Status Badge
      let statusBadge = `<span class="event-time-badge">⏰ ${ev.time}</span>`;
      if (isLive) {
        statusBadge = `<span class="event-time-badge badge-live-pulse">🔴 IN DIRETTA (${ev.time})</span>`;
      } else if (ev.status === 'FINISHED') {
        statusBadge = `<span class="event-time-badge" style="background: rgba(255,255,255,0.05); color: var(--text-secondary);">Terminato (${ev.time})</span>`;
      }

      // Canali TV Ufficiali
      let officialHtml = '';
      if (ev.officialChannels && ev.officialChannels.length > 0) {
        officialHtml = `
          <div class="event-channels-section">
            <span class="channels-section-title">📺 Canali TV Ufficiali (Sky / DAZN / Eurosport):</span>
            <div class="channel-badges-wrap">
              ${ev.officialChannels.map(ch => `
                <button class="channel-stream-btn official" onclick="playEventChannel('${ch.id}')">
                  <span class="btn-play-icon">▶</span>
                  <span class="btn-ch-name">${escapeHtml(ch.title)}</span>
                </button>
              `).join('')}
            </div>
          </div>
        `;
      }

      // Stream Diretti & Alternative
      let directHtml = '';
      if (ev.directStreams && ev.directStreams.length > 0) {
        directHtml = `
          <div class="event-channels-section">
            <span class="channels-section-title">⚡ Stream Diretti & Alternative (Daddy / Last Minute):</span>
            <div class="channel-badges-wrap">
              ${ev.directStreams.slice(0, 8).map(ch => `
                <button class="channel-stream-btn direct" onclick="playEventChannel('${ch.id}')">
                  <span class="btn-play-icon">▶</span>
                  <span class="btn-ch-name">${escapeHtml(ch.title)}</span>
                </button>
              `).join('')}
            </div>
          </div>
        `;
      }

      card.innerHTML = `
        <div class="event-card-header">
          <div class="event-meta">
            <span class="event-sport-icon">${sportIcon}</span>
            <span class="event-tournament">${escapeHtml(ev.tournament)}</span>
          </div>
          ${statusBadge}
        </div>

        <div class="event-card-body">
          <h3 class="event-match-title">${escapeHtml(ev.title)}</h3>
        </div>

        <div class="event-card-footer">
          ${officialHtml}
          ${directHtml}
          ${(!officialHtml && !directHtml) ? '<small class="text-muted">Nessun flusso abbinato automaticamente</small>' : ''}
        </div>
      `;

      container.appendChild(card);
    });
  } catch (err) {
    container.innerHTML = '<div class="text-muted" style="padding: 24px; color: var(--accent-red); grid-column: 1 / -1;">Errore durante il caricamento del palinsesto eventi</div>';
  }
}

// Riproduzione immediata del canale cliccato dalla Guida Eventi
function playEventChannel(chId) {
  const ch = eventChannelsCache.get(chId);
  if (!ch) {
    if (window.showToast) showToast('Canale non trovato');
    return;
  }

  // Apri il modale rapido del player
  if (window.openModalPlayer) {
    window.openModalPlayer(ch);
  }
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.innerText = text;
  return div.innerHTML;
}

// Event Listeners per Filtri Sport e Stato
document.addEventListener('DOMContentLoaded', () => {
  // Filtri Sport Pills
  document.querySelectorAll('.sport-pill-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sport-pill-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentEventSport = btn.getAttribute('data-sport') || 'all';
      loadEvents();
    });
  });

  // Filtro Stato Dropdown
  const statusSelect = document.getElementById('events-status-filter');
  if (statusSelect) {
    statusSelect.addEventListener('change', (e) => {
      currentEventStatus = e.target.value;
      loadEvents();
    });
  }

  // Barra Ricerca Eventi
  const searchInput = document.getElementById('events-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      clearTimeout(eventSearchDebounce);
      eventSearchDebounce = setTimeout(() => {
        currentEventSearch = e.target.value.trim();
        loadEvents();
      }, 300);
    });
  }

  // Pulsante Refresh Manuale
  const refreshBtn = document.getElementById('btn-refresh-events-now');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      refreshBtn.disabled = true;
      refreshBtn.innerText = '⏳ Aggiornamento...';
      try {
        await fetch('/api/events/refresh', { method: 'POST' });
        if (window.showToast) showToast('Palinsesto eventi aggiornato!');
        await loadEvents();
      } catch (e) {
        if (window.showToast) showToast('Errore durante l\'aggiornamento del palinsesto');
      } finally {
        refreshBtn.disabled = false;
        refreshBtn.innerText = '🔄 Aggiorna Palinsesto Ora';
      }
    });
  }
});

window.loadEvents = loadEvents;
window.playEventChannel = playEventChannel;

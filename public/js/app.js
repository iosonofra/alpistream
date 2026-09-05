// App State
let currentTab = 'dashboard';
let appConfig = {};

// Toast
function showToast(msg) {
  const toast = document.getElementById('toast-notification');
  toast.innerText = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

// Copy to clipboard
function copyToClipboard(elementId) {
  const el = document.getElementById(elementId);
  if (!el) return;
  const text = el.innerText.trim();
  navigator.clipboard.writeText(text).then(() => {
    showToast('Link copiato negli appunti!');
  });
}

// Navigation Tabs
document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.getAttribute('data-tab');
    if (!target) return;

    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

    btn.classList.add('active');
    const pane = document.getElementById(`tab-${target}`);
    if (pane) pane.classList.add('active');

    currentTab = target;
    const pageTitles = {
      dashboard: ['Dashboard', 'Panoramica del server e link di streaming remoti'],
      events: ['Eventi Live (Guida TV)', 'Palinsesto sportivo giornaliero stile LiveOnSat con link ai canali diretti e ufficiali'],
      livetv: ['Web Player (Live TV)', 'Guarda in diretta e testa i canali con supporto ClearKey DRM in-browser'],
      sources: ['Sorgenti Liste', 'Configura le sezioni MandraKodi da includere nell\'estrazione'],
      editor: ['Editor Canali', 'Abilita, disabilita, rinomina e personalizza i canali della playlist'],
      groups: ['Ordine Gruppi', 'Personalizza l\'ordinamento delle categorie e la sequenza dei canali nella playlist M3U'],
      custom: ['Canali Custom', 'Aggiungi stream personalizzati (.m3u8, .mpd)'],
      epg: ['Guida EPG (XMLTV)', 'Gestione sorgenti della guida programmi e sincronizzazione'],
      settings: ['Impostazioni', 'Pianificazione cron, token di sicurezza e opzioni server']
    };

    if (pageTitles[target]) {
      document.getElementById('page-title').innerText = pageTitles[target][0];
      document.getElementById('page-subtitle').innerText = pageTitles[target][1];
    }

    if (target === 'events') {
      window.loadEvents();
    } else if (target === 'livetv') {
      window.initLiveTvTab();
    } else if (target === 'editor') {
      window.loadChannels();
    } else if (target === 'groups') {
      window.loadGroupsManager();
    } else if (target === 'sources') {
      loadSources();
    } else if (target === 'epg') {
      window.loadEpgSources();
    }
  });
});

// Update Remote Links with current Host IP
function updateRemoteLinks(authToken) {
  const origin = window.location.origin;
  const tokenParam = authToken ? `?token=${encodeURIComponent(authToken)}` : '';

  document.getElementById('link-m3u-url').innerText = `${origin}/playlist.m3u${tokenParam}`;
  document.getElementById('link-epg-url').innerText = `${origin}/epg.xml${tokenParam}`;
}

// Fetch System Status
async function fetchStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();

    document.getElementById('stat-enabled-channels').innerText = data.enabledChannels;
    document.getElementById('stat-total-channels').innerText = `su ${data.totalChannels} canali totali`;
    document.getElementById('stat-active-sources').innerText = data.activeSources.length;
    document.getElementById('stat-last-extraction').innerText = data.lastExtractionTime
      ? `Ultimo: ${new Date(data.lastExtractionTime).toLocaleString()}`
      : 'Ultimo: Mai';

    updateRemoteLinks(data.authTokenConfigured ? appConfig.authToken : '');

    const dot = document.getElementById('status-dot');
    const text = document.getElementById('status-text');

    if (data.isExtracting) {
      dot.className = 'dot busy';
      text.innerText = 'Estrazione in corso...';
      document.getElementById('btn-quick-extract').disabled = true;
      document.getElementById('btn-quick-extract').innerHTML = '⏳ Estrazione in corso...';
    } else {
      dot.className = 'dot online';
      text.innerText = 'Server Online';
      document.getElementById('btn-quick-extract').disabled = false;
      document.getElementById('btn-quick-extract').innerHTML = '<span class="btn-icon">🚀</span> Estrai Playlist Ora';
    }

    if (data.logs && data.logs.length > 0) {
      const consoleEl = document.getElementById('log-console');
      consoleEl.innerText = data.logs.join('\n');
      consoleEl.scrollTop = consoleEl.scrollHeight;
    }
  } catch (err) {
    document.getElementById('status-dot').className = 'dot';
    document.getElementById('status-text').innerText = 'Server Non Raggiungibile';
  }
}

// Quick Extract Button
document.getElementById('btn-quick-extract').addEventListener('click', async () => {
  showToast('Avvio estrazione playlist...');
  try {
    await fetch('/api/extract', { method: 'POST' });
    fetchStatus();
  } catch (e) {
    showToast('Errore durante l\'avvio dell\'estrazione');
  }
});

// Refresh Logs
document.getElementById('btn-refresh-logs').addEventListener('click', fetchStatus);

// Sources Manager
async function loadSources() {
  const container = document.getElementById('sources-container');
  container.innerHTML = '<div class="text-muted">Caricamento sorgenti...</div>';

  try {
    const res = await fetch('/api/sources');
    const data = await res.json();
    const activeSet = new Set(data.active);

    container.innerHTML = '';
    data.catalog.forEach(sec => {
      const isChecked = activeSet.has(sec.id);
      const div = document.createElement('div');
      div.className = 'source-item';
      div.innerHTML = `
        <input type="checkbox" id="src-${sec.id}" value="${sec.id}" ${isChecked ? 'checked' : ''}>
        <div class="source-text">
          <h4>${sec.name}</h4>
          <p>${sec.desc}</p>
        </div>
      `;
      div.addEventListener('click', (e) => {
        if (e.target.tagName !== 'INPUT') {
          const cb = div.querySelector('input');
          cb.checked = !cb.checked;
        }
      });
      container.appendChild(div);
    });
  } catch (e) {
    container.innerHTML = '<div class="text-muted">Errore nel caricamento delle sorgenti</div>';
  }
}

document.getElementById('btn-select-all-sources').addEventListener('click', () => {
  document.querySelectorAll('#sources-container input[type="checkbox"]').forEach(cb => cb.checked = true);
});

document.getElementById('btn-deselect-all-sources').addEventListener('click', () => {
  document.querySelectorAll('#sources-container input[type="checkbox"]').forEach(cb => cb.checked = false);
});

document.getElementById('btn-save-sources').addEventListener('click', async () => {
  const selected = [];
  document.querySelectorAll('#sources-container input[type="checkbox"]:checked').forEach(cb => {
    selected.push(cb.value);
  });

  try {
    const res = await fetch('/api/sources', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activeSources: selected })
    });
    if (res.ok) {
      showToast('Sorgenti salvate con successo!');
      fetchStatus();
    }
  } catch (e) {
    showToast('Errore durante il salvataggio');
  }
});

// Settings Form
async function loadSettings() {
  try {
    const res = await fetch('/api/config');
    appConfig = await res.json();

    if (appConfig.cronSchedule) {
      document.getElementById('setting-cron').value = appConfig.cronSchedule;
    }
    if (appConfig.authToken) {
      document.getElementById('setting-token').value = appConfig.authToken;
    }
    if (document.getElementById('setting-acestream-proxy')) {
      document.getElementById('setting-acestream-proxy').checked = appConfig.aceStreamProxyEnabled !== false;
    }
    if (document.getElementById('setting-acestream-host')) {
      document.getElementById('setting-acestream-host').value = appConfig.aceStreamHost || '127.0.0.1:6878';
    }
  } catch (e) {}
}

document.getElementById('form-settings').addEventListener('submit', async (e) => {
  e.preventDefault();
  const schedule = document.getElementById('setting-cron').value;
  const token = document.getElementById('setting-token').value.trim();
  const aceProxy = document.getElementById('setting-acestream-proxy') ? document.getElementById('setting-acestream-proxy').checked : true;
  const aceHost = document.getElementById('setting-acestream-host') ? document.getElementById('setting-acestream-host').value.trim() || '127.0.0.1:6878' : '127.0.0.1:6878';

  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...appConfig,
        cronSchedule: schedule,
        authToken: token,
        aceStreamProxyEnabled: aceProxy,
        aceStreamHost: aceHost
      })
    });
    if (res.ok) {
      showToast('Impostazioni aggiornate con successo!');
      loadSettings();
      fetchStatus();
    }
  } catch (e) {
    showToast('Errore nel salvataggio');
  }
});

// Test Connessione Ace Stream Engine
const btnTestAce = document.getElementById('btn-test-acestream');
if (btnTestAce) {
  btnTestAce.addEventListener('click', async () => {
    const badge = document.getElementById('acestream-status-badge');
    if (!badge) return;
    badge.innerHTML = '<span class="text-muted">⏳ Test di connessione in corso...</span>';
    btnTestAce.disabled = true;

    try {
      const res = await fetch('/api/acestream/status');
      const data = await res.json();
      if (data.online) {
        badge.innerHTML = `<span style="color: #4ade80; font-weight: 600;">✅ Ace Engine Online! (${data.message})</span>`;
      } else {
        badge.innerHTML = `<span style="color: #f87171; font-weight: 500;">❌ Ace Engine Non Raggiungibile: ${data.message}</span>`;
      }
    } catch (err) {
      badge.innerHTML = `<span style="color: #f87171; font-weight: 500;">❌ Errore test: ${err.message}</span>`;
    } finally {
      btnTestAce.disabled = false;
    }
  });
}

// Init
window.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  fetchStatus();
  setInterval(fetchStatus, 3000);
});

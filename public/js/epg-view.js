// Gestione Fonti EPG XMLTV con supporto EPGShare (epgshare01.online)

const EPGSHARE_PRESETS = [
  {
    name: '🇮🇹 EPGShare Italia (Sky, DAZN, Cinema, Sport, DTT)',
    url: 'https://epgshare01.online/epgshare01/epg_ripper_IT1.xml.gz'
  },
  {
    name: '🇬🇧 EPGShare United Kingdom (Sky UK, TNT Sports, BBC)',
    url: 'https://epgshare01.online/epgshare01/epg_ripper_UK1.xml.gz'
  },
  {
    name: '🇺🇸 EPGShare USA Sports & Networks (ESPN, CBS, Fox, NBC)',
    url: 'https://epgshare01.online/epgshare01/epg_ripper_US2.xml.gz'
  },
  {
    name: '🇪🇸 EPGShare Spagna (Movistar+, DAZN ES, LaLiga)',
    url: 'https://epgshare01.online/epgshare01/epg_ripper_ES1.xml.gz'
  },
  {
    name: '🇩🇪 EPGShare Germania (Sky DE, DAZN DE, Sport)',
    url: 'https://epgshare01.online/epgshare01/epg_ripper_DE1.xml.gz'
  },
  {
    name: '🇫🇷 EPGShare Francia (Canal+, RMC Sport, beIN)',
    url: 'https://epgshare01.online/epgshare01/epg_ripper_FR1.xml.gz'
  },
  {
    name: '🇨🇭 EPGShare Svizzera (SRF, RTS, RSI)',
    url: 'https://epgshare01.online/epgshare01/epg_ripper_CH1.xml.gz'
  }
];

let currentEpgSources = [];

async function loadEpgSources() {
  const container = document.getElementById('epg-sources-list');
  const statsContainer = document.getElementById('epg-stats-banner');
  if (!container) return;

  container.innerHTML = '<div class="text-muted" style="padding: 16px; text-align: center;">Caricamento stato ed EPG in corso...</div>';

  try {
    // 1. Carica configurazione sorgenti
    const resConfig = await fetch('/api/config');
    const config = await resConfig.json();
    currentEpgSources = config.epgSources || [];

    // 2. Carica statistiche EPG cache
    const resStatus = await fetch('/api/epg/status');
    const statusData = await resStatus.json();

    if (statsContainer) {
      const lastUpdateStr = statusData.lastUpdated ? new Date(statusData.lastUpdated).toLocaleString('it-IT') : 'Mai aggiornato';
      statsContainer.innerHTML = `
        <div class="stats-grid" style="margin-bottom: 20px;">
          <div class="stat-card">
            <div class="stat-value">${statusData.sizeMb || '0'} MB</div>
            <div class="stat-label">Dimensione Cache XMLTV</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${statusData.channelCount || '0'}</div>
            <div class="stat-label">Canali con Guida TV</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${(statusData.programmeCount || 0).toLocaleString()}</div>
            <div class="stat-label">Eventi Palinsesto EPG</div>
          </div>
          <div class="stat-card">
            <div class="stat-value" style="font-size: 1.1rem; padding-top: 6px;">${lastUpdateStr}</div>
            <div class="stat-label">Ultimo Aggiornamento</div>
          </div>
        </div>
      `;
    }

    container.innerHTML = '';
    if (currentEpgSources.length === 0) {
      container.innerHTML = '<div class="text-muted" style="padding: 16px; text-align: center;">Nessuna sorgente EPG configurata. Usa il menu sotto per aggiungere EPGShare.</div>';
    } else {
      currentEpgSources.forEach((src, idx) => {
        const isGz = src.url.endsWith('.gz');
        const isEpgShare = src.url.includes('epgshare01.online');
        const div = document.createElement('div');
        div.className = 'link-box';
        div.style.marginBottom = '12px';
        div.style.display = 'flex';
        div.style.justifyContent = 'space-between';
        div.style.alignItems = 'center';

        div.innerHTML = `
          <div class="link-info" style="flex: 1;">
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
              <strong>${escapeHtml(src.name)}</strong>
              ${isEpgShare ? '<span class="badge" style="background: rgba(138, 43, 226, 0.2); color: #c084fc;">EPGShare</span>' : ''}
              ${isGz ? '<span class="badge" style="background: rgba(88, 166, 255, 0.2); color: #58a6ff;">.xml.gz</span>' : ''}
            </div>
            <small class="text-muted" style="word-break: break-all;">${escapeHtml(src.url)}</small>
          </div>

          <div style="display: flex; align-items: center; gap: 14px;">
            <label class="switch" title="Abilita / Disabilita questa fonte EPG">
              <input type="checkbox" ${src.enabled ? 'checked' : ''} onchange="toggleEpgSource(${idx}, this.checked)">
              <span class="slider"></span>
            </label>
            <button class="btn btn-ghost btn-sm" onclick="removeEpgSource(${idx})" title="Rimuovi Fonte" style="color: var(--accent-red);">🗑️</button>
          </div>
        `;
        container.appendChild(div);
      });
    }

    renderPresetSelector();

  } catch (e) {
    container.innerHTML = `<div class="text-muted" style="color: var(--accent-red); padding: 16px;">Errore nel caricamento delle sorgenti EPG: ${e.message}</div>`;
  }
}

function renderPresetSelector() {
  const select = document.getElementById('epg-preset-select');
  if (!select) return;

  select.innerHTML = '<option value="">Seleziona un Paese da EPGShare...</option>';
  EPGSHARE_PRESETS.forEach(p => {
    const isAlreadyAdded = currentEpgSources.some(s => s.url === p.url);
    const opt = document.createElement('option');
    opt.value = p.url;
    opt.innerText = isAlreadyAdded ? `✅ ${p.name} (Già aggiunto)` : p.name;
    opt.dataset.name = p.name;
    if (isAlreadyAdded) opt.disabled = true;
    select.appendChild(opt);
  });
}

async function addEpgSharePreset() {
  const select = document.getElementById('epg-preset-select');
  if (!select || !select.value) return;

  const selectedOpt = select.selectedOptions[0];
  const url = select.value;
  const name = selectedOpt.dataset.name || 'EPGShare Source';

  currentEpgSources.push({
    id: `epg_${Date.now()}`,
    name,
    url,
    enabled: true
  });

  await saveSourcesToServer();
}

async function toggleEpgSource(index, enabled) {
  if (!currentEpgSources[index]) return;
  currentEpgSources[index].enabled = enabled;
  await saveSourcesToServer();
}

async function removeEpgSource(index) {
  if (!confirm('Vuoi rimuovere questa sorgente EPG?')) return;
  currentEpgSources.splice(index, 1);
  await saveSourcesToServer();
}

async function saveSourcesToServer() {
  try {
    const res = await fetch('/api/epg/sources', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sources: currentEpgSources })
    });
    const data = await res.json();
    if (data.success) {
      if (window.showToast) showToast('Sorgenti EPG aggiornate!');
      await loadEpgSources();
    }
  } catch (e) {
    if (window.showToast) showToast(`Errore salvataggio: ${e.message}`);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const updateBtn = document.getElementById('btn-update-epg-now');
  if (updateBtn) {
    updateBtn.addEventListener('click', async () => {
      updateBtn.disabled = true;
      updateBtn.innerText = '⏳ Scaricamento XMLTV...';
      if (window.showToast) showToast('Scaricamento guida EPG da EPGShare in corso...');
      try {
        const res = await fetch('/api/epg/update', { method: 'POST' });
        if (res.ok) {
          if (window.showToast) showToast('EPG scaricato ed elaborato con successo!');
          setTimeout(() => {
            loadEpgSources();
            updateBtn.disabled = false;
            updateBtn.innerText = '🔄 Aggiorna EPG Ora';
          }, 3000);
        }
      } catch (e) {
        if (window.showToast) showToast('Errore durante l\'aggiornamento EPG');
        updateBtn.disabled = false;
        updateBtn.innerText = '🔄 Aggiorna EPG Ora';
      }
    });
  }

  const addPresetBtn = document.getElementById('btn-add-epg-preset');
  if (addPresetBtn) {
    addPresetBtn.addEventListener('click', addEpgSharePreset);
  }
});

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.innerText = text;
  return div.innerHTML;
}

window.loadEpgSources = loadEpgSources;
window.toggleEpgSource = toggleEpgSource;
window.removeEpgSource = removeEpgSource;
window.addEpgSharePreset = addEpgSharePreset;

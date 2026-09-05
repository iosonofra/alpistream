let editorPage = 1;
const editorLimit = 50;
let currentSearch = '';
let currentGroup = 'ALL';
let currentStatus = 'all';
let editingChannelId = null;
const editorChannelsMap = new Map();

async function loadChannels(page = 1) {
  editorPage = page;
  const tbody = document.getElementById('channel-table-body');
  tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 24px;">Caricamento canali in corso...</td></tr>';

  const params = new URLSearchParams({
    page: editorPage,
    limit: editorLimit,
    group: currentGroup,
    status: currentStatus,
    search: currentSearch
  });

  try {
    const res = await fetch(`/api/channels?${params.toString()}`);
    const data = await res.json();
    const channels = data.channels || [];

    editorChannelsMap.clear();
    channels.forEach(ch => editorChannelsMap.set(ch.id, ch));

    // Aggiorna selettore gruppi
    const groupSelect = document.getElementById('editor-group-filter');
    const selectedGroup = groupSelect.value;
    groupSelect.innerHTML = '<option value="ALL">Tutti i Gruppi</option>';
    (data.groups || []).forEach(g => {
      const opt = document.createElement('option');
      opt.value = g;
      opt.innerText = g;
      if (g === selectedGroup) opt.selected = true;
      groupSelect.appendChild(opt);
    });

    // Renderizza Tabella Canali
    tbody.innerHTML = '';
    if (channels.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 24px;">Nessun canale trovato. Prova ad avviare un\'estrazione dalla Dashboard.</td></tr>';
      document.getElementById('editor-pagination-info').innerText = '0 canali';
      return;
    }

    channels.forEach(ch => {
      const tr = document.createElement('tr');
      const defaultSvg = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="%238b949e" stroke-width="2"><rect x="2" y="7" width="20" height="15" rx="2" ry="2"></rect></svg>';

      tr.innerHTML = `
        <td>
          <label class="switch">
            <input type="checkbox" ${ch.enabled !== false ? 'checked' : ''} onchange="toggleChannel('${ch.id}', this.checked)">
            <span class="slider"></span>
          </label>
        </td>
        <td>
          <button class="btn-play" onclick="openModalPlayerById('${ch.id}')">▶️ Play</button>
        </td>
        <td class="logo-cell"></td>
        <td>
          <strong class="ch-title"></strong>
          ${ch.isCustom ? ' <span class="badge" style="background: rgba(88, 166, 255, 0.2); color: #58a6ff;">Custom</span>' : ''}
          ${ch.clearkey ? ' <span class="badge" style="background: rgba(138, 43, 226, 0.15); color: #c084fc;">DRM</span>' : ''}
          ${ch.useWarp ? ' <span class="badge" style="background: rgba(249, 115, 22, 0.18); color: #fb923c; border: 1px solid rgba(249, 115, 22, 0.4);">🛡️ WARP</span>' : ''}
        </td>
        <td><span class="badge badge-group">${ch.group || 'Generale'}</span></td>
        <td>
          <span class="badge-health" id="health-${ch.id}" style="color: var(--text-secondary);">
            ⚪ Non verificato
          </span>
        </td>
        <td><code>${ch.tvgId || '<span style="color: #6e7681;">Non impostato</span>'}</code></td>
        <td>
          <button class="btn btn-secondary btn-sm" onclick="openEditModalById('${ch.id}')">✏️ Modifica</button>
        </td>
      `;

      const logoImg = document.createElement('img');
      logoImg.className = 'channel-logo-img';
      logoImg.src = ch.logo || defaultSvg;
      logoImg.onerror = () => { logoImg.src = defaultSvg; };
      tr.querySelector('.logo-cell').appendChild(logoImg);
      tr.querySelector('.ch-title').innerText = ch.title || 'Senza Titolo';

      tbody.appendChild(tr);
    });

    // Paginazione
    const startCount = (editorPage - 1) * editorLimit + 1;
    const endCount = Math.min(editorPage * editorLimit, data.total);
    document.getElementById('editor-pagination-info').innerText = `Mostrando ${startCount}-${endCount} di ${data.total} canali`;

    const btnContainer = document.getElementById('editor-pagination-btns');
    btnContainer.innerHTML = '';

    if (data.totalPages > 1) {
      if (editorPage > 1) {
        const prev = document.createElement('button');
        prev.className = 'btn btn-secondary btn-sm';
        prev.innerText = '◀ Precedente';
        prev.onclick = () => loadChannels(editorPage - 1);
        btnContainer.appendChild(prev);
      }
      if (editorPage < data.totalPages) {
        const next = document.createElement('button');
        next.className = 'btn btn-secondary btn-sm';
        next.innerText = 'Successiva ▶';
        next.onclick = () => loadChannels(editorPage + 1);
        btnContainer.appendChild(next);
      }
    }
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: var(--accent-red); padding: 24px;">Errore durante il caricamento dei canali</td></tr>';
  }
}

// Helpers per apertura sicura da ID
function openModalPlayerById(id) {
  const ch = editorChannelsMap.get(id);
  if (ch && window.openModalPlayer) {
    window.openModalPlayer(ch);
  }
}

function openEditModalById(id) {
  const ch = editorChannelsMap.get(id);
  if (ch) {
    openEditModal(ch);
  }
}

// Toggle Channel enabled
async function toggleChannel(id, enabled) {
  try {
    await fetch(`/api/channels/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled })
    });
    showToast(enabled ? 'Canale abilitato' : 'Canale disabilitato');
    fetchStatus();
  } catch (e) {
    showToast('Errore durante la modifica');
  }
}

// Batch Stream Health Check
document.getElementById('btn-health-check-visible')?.addEventListener('click', async () => {
  const channelsList = Array.from(editorChannelsMap.values());
  if (channelsList.length === 0) {
    showToast('Nessun canale visibile da testare');
    return;
  }

  showToast(`Test di connettività in corso su ${channelsList.length} canali...`);
  const btn = document.getElementById('btn-health-check-visible');
  btn.disabled = true;
  btn.innerText = '⏳ Verifica in corso...';

  // Imposta badge su "Testing"
  channelsList.forEach(ch => {
    const el = document.getElementById(`health-${ch.id}`);
    if (el) {
      el.className = 'badge-health badge-testing';
      el.innerText = '🟡 Verifica...';
    }
  });

  try {
    const res = await fetch('/api/channels/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channels: channelsList })
    });
    const data = await res.json();

    if (data.results) {
      let onlineCount = 0;
      Object.entries(data.results).forEach(([id, result]) => {
        const el = document.getElementById(`health-${id}`);
        if (el) {
          if (result.status === 'online') {
            onlineCount++;
            el.className = 'badge-health badge-online';
            el.innerText = `🟢 Online (${result.latency || 'OK'})`;
          } else {
            el.className = 'badge-health badge-offline';
            el.innerText = '🔴 Offline';
          }
        }
      });
      showToast(`Health Check completato: ${onlineCount}/${channelsList.length} canali online!`);
    }
  } catch (e) {
    showToast('Errore durante il test di salute stream');
  } finally {
    btn.disabled = false;
    btn.innerText = '🩺 Testa Canali Visibili';
  }
});

// Search & Filter Listeners
let searchDebounce = null;
document.getElementById('editor-search').addEventListener('input', (e) => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    currentSearch = e.target.value.trim();
    loadChannels(1);
  }, 300);
});

document.getElementById('editor-group-filter').addEventListener('change', (e) => {
  currentGroup = e.target.value;
  loadChannels(1);
});

document.getElementById('editor-status-filter').addEventListener('change', (e) => {
  currentStatus = e.target.value;
  loadChannels(1);
});

// Bulk actions
document.getElementById('btn-bulk-enable').addEventListener('click', async () => {
  await fetch('/api/channels/bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'enable_all', group: currentGroup })
  });
  showToast('Canali abilitati con successo');
  loadChannels(editorPage);
  fetchStatus();
});

document.getElementById('btn-bulk-disable').addEventListener('click', async () => {
  await fetch('/api/channels/bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'disable_all', group: currentGroup })
  });
  showToast('Canali disabilitati');
  loadChannels(editorPage);
  fetchStatus();
});

// Edit Modal
function openEditModal(ch) {
  editingChannelId = ch.id;
  document.getElementById('edit-channel-id').value = ch.id;
  document.getElementById('edit-channel-title').value = ch.title || '';
  document.getElementById('edit-channel-group').value = ch.group || '';
  document.getElementById('edit-channel-logo').value = ch.logo || '';
  document.getElementById('edit-channel-tvgid').value = ch.tvgId || '';
  if (document.getElementById('edit-channel-warp')) {
    document.getElementById('edit-channel-warp').checked = ch.useWarp === true;
  }

  document.getElementById('edit-modal').classList.add('active');
}

function closeEditModal() {
  document.getElementById('edit-modal').classList.remove('active');
}

document.getElementById('btn-save-channel-edit').addEventListener('click', async () => {
  const id = document.getElementById('edit-channel-id').value;
  const title = document.getElementById('edit-channel-title').value.trim();
  const group = document.getElementById('edit-channel-group').value.trim();
  const logo = document.getElementById('edit-channel-logo').value.trim();
  const tvgId = document.getElementById('edit-channel-tvgid').value.trim();
  const useWarp = document.getElementById('edit-channel-warp') ? document.getElementById('edit-channel-warp').checked : false;

  try {
    const res = await fetch(`/api/channels/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, group, logo, tvgId, useWarp })
    });
    if (res.ok) {
      showToast('Canale modificato!');
      closeEditModal();
      loadChannels(editorPage);
    }
  } catch (e) {
    showToast('Errore durante il salvataggio');
  }
});

// Add Custom Channel Form
document.getElementById('form-custom-channel').addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = document.getElementById('custom-title').value.trim();
  const group = document.getElementById('custom-group').value.trim();
  const url = document.getElementById('custom-url').value.trim();
  const logo = document.getElementById('custom-logo').value.trim();
  const tvgId = document.getElementById('custom-tvgid').value.trim();

  try {
    const res = await fetch('/api/custom-channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, group, url, logo, tvgId })
    });
    if (res.ok) {
      showToast('Canale custom aggiunto con successo!');
      document.getElementById('form-custom-channel').reset();
      fetchStatus();
    }
  } catch (e) {
    showToast('Errore durante l\'aggiunta del canale');
  }
});

window.loadChannels = loadChannels;
window.openModalPlayerById = openModalPlayerById;
window.openEditModalById = openEditModalById;

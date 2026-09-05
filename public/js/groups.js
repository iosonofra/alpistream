// Gestione e Ordinamento Gruppi Playlist MandraKodi

let currentGroupsList = [];
let dragSourceIndex = null;

async function loadGroupsManager() {
  const container = document.getElementById('groups-sortable-list');
  const countBadge = document.getElementById('groups-total-count');
  if (!container) return;

  container.innerHTML = '<div class="text-muted" style="padding: 24px; text-align: center;">Caricamento gruppi della playlist in corso...</div>';

  try {
    const res = await fetch('/api/groups');
    const data = await res.json();
    currentGroupsList = (data.groups || []).map(g => g.name);

    if (countBadge) {
      countBadge.innerText = `${data.totalGroups || 0} Gruppi Trovati`;
    }

    renderGroupsList(data.groups || []);
  } catch (err) {
    container.innerHTML = `<div class="text-muted" style="padding: 24px; color: var(--accent-red); text-align: center;">Errore durante il caricamento dei gruppi: ${err.message}</div>`;
  }
}

function getGroupIcon(groupName) {
  const g = groupName.toLowerCase();
  if (g.includes('sport') || g.includes('calcio') || g.includes('f1') || g.includes('motogp')) return '⚽';
  if (g.includes('sky')) return '📡';
  if (g.includes('italy') || g.includes('italia') || g.includes('dtt')) return '🇮🇹';
  if (g.includes('spain') || g.includes('spagna')) return '🇪🇸';
  if (g.includes('kindom') || g.includes('kingdom') || g.includes('uk')) return '🇬🇧';
  if (g.includes('germany') || g.includes('tedeschi')) return '🇩🇪';
  if (g.includes('france') || g.includes('francia')) return '🇫🇷';
  if (g.includes('usa') || g.includes('america')) return '🇺🇸';
  if (g.includes('daddy')) return '⚡';
  if (g.includes('last minute') || g.includes('eventi')) return '🔴';
  if (g.includes('cinema') || g.includes('film') || g.includes('serie')) return '🎬';
  if (g.includes('musica') || g.includes('music')) return '🎵';
  if (g.includes('bambini') || g.includes('kids')) return '🧸';
  if (g.includes('news') || g.includes('notizie')) return '📰';
  return '📁';
}

function renderGroupsList(groupsArray) {
  const container = document.getElementById('groups-sortable-list');
  if (!container) return;

  if (!groupsArray || groupsArray.length === 0) {
    container.innerHTML = '<div class="text-muted" style="padding: 24px; text-align: center;">Nessun gruppo trovato. Estrai prima i canali da MandraKodi.</div>';
    return;
  }

  container.innerHTML = '';

  groupsArray.forEach((groupItem, index) => {
    const groupName = typeof groupItem === 'string' ? groupItem : groupItem.name;
    const channelCount = typeof groupItem === 'object' ? groupItem.channelCount : 0;
    const icon = getGroupIcon(groupName);

    const item = document.createElement('div');
    item.className = 'group-sort-item';
    item.draggable = true;
    item.dataset.index = index;
    item.dataset.group = groupName;

    item.innerHTML = `
      <div class="group-sort-left">
        <span class="group-drag-handle" title="Trascina per riordinare">⠿</span>
        <span class="group-index-badge">#${index + 1}</span>
        <span class="group-icon">${icon}</span>
        <strong class="group-title-text">${escapeHtml(groupName)}</strong>
      </div>

      <div class="group-sort-right">
        ${channelCount ? `<span class="badge badge-group">${channelCount} canali</span>` : ''}
        <div class="group-action-buttons">
          <button class="btn-group-nav" onclick="moveGroupItem(${index}, -999)" title="Sposta in Cima">🔝</button>
          <button class="btn-group-nav" onclick="moveGroupItem(${index}, -1)" title="Sposta Su">⬆️</button>
          <button class="btn-group-nav" onclick="moveGroupItem(${index}, 1)" title="Sposta Giù">⬇️</button>
          <button class="btn-group-nav" onclick="moveGroupItem(${index}, 999)" title="Sposta in Fondo">🔻</button>
          <button class="btn-group-rename" onclick="openRenameGroupModal('${escapeHtml(groupName)}')">✏️ Rinomina</button>
        </div>
      </div>
    `;

    // Eventi Drag & Drop HTML5
    item.addEventListener('dragstart', (e) => {
      dragSourceIndex = index;
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', index);
    });

    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      item.classList.add('drag-over');
    });

    item.addEventListener('dragleave', () => {
      item.classList.remove('drag-over');
    });

    item.addEventListener('drop', (e) => {
      e.preventDefault();
      item.classList.remove('drag-over');
      const targetIndex = parseInt(item.dataset.index, 10);
      if (dragSourceIndex !== null && dragSourceIndex !== targetIndex) {
        reorderGroups(dragSourceIndex, targetIndex);
      }
    });

    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      document.querySelectorAll('.group-sort-item').forEach(el => el.classList.remove('drag-over'));
      dragSourceIndex = null;
    });

    container.appendChild(item);
  });
}

function moveGroupItem(fromIndex, delta) {
  let toIndex = fromIndex + delta;
  if (toIndex < 0) toIndex = 0;
  if (toIndex >= currentGroupsList.length) toIndex = currentGroupsList.length - 1;
  if (fromIndex === toIndex) return;

  reorderGroups(fromIndex, toIndex);
}

function reorderGroups(fromIndex, toIndex) {
  const item = currentGroupsList.splice(fromIndex, 1)[0];
  currentGroupsList.splice(toIndex, 0, item);

  // Ridisegna la lista mantenendo i conteggi se possibile
  const newArray = currentGroupsList.map((name, i) => ({
    name,
    index: i + 1
  }));
  renderGroupsList(newArray);
}

// Preset di Ordinamento Rapido
function applySmartPreset() {
  const priorityKeywords = [
    'sky sport',
    'sky intrattenimento',
    'italy',
    'italia',
    'last minute',
    'liste eventi',
    'daddy',
    'socceron',
    'mediahosting',
    'cinema',
    'intrattenimento',
    'serie',
    'documentari',
    'musica',
    'kids',
    'united kindom',
    'germany',
    'spain',
    'france',
    'usa'
  ];

  currentGroupsList.sort((a, b) => {
    const aLower = a.toLowerCase();
    const bLower = b.toLowerCase();

    let aPriority = 999;
    let bPriority = 999;

    priorityKeywords.forEach((kw, idx) => {
      if (aLower.includes(kw) && aPriority === 999) aPriority = idx;
      if (bLower.includes(kw) && bPriority === 999) bPriority = idx;
    });

    if (aPriority !== bPriority) {
      return aPriority - bPriority;
    }
    return a.localeCompare(b, undefined, { sensitivity: 'base' });
  });

  const newArray = currentGroupsList.map((name, i) => ({ name, index: i + 1 }));
  renderGroupsList(newArray);
  if (window.showToast) showToast('Applicato Ordinamento Smart Consigliato!');
}

function applyAlphabeticalPreset() {
  currentGroupsList.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  const newArray = currentGroupsList.map((name, i) => ({ name, index: i + 1 }));
  renderGroupsList(newArray);
  if (window.showToast) showToast('Ordinamento alfabetico (A-Z) applicato');
}

// Salvataggio Ordine sul Server
async function saveGroupsOrder() {
  const saveBtn = document.getElementById('btn-save-groups-order');
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.innerText = '⏳ Salvataggio...';
  }

  try {
    const res = await fetch('/api/groups/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: currentGroupsList })
    });
    const data = await res.json();

    if (data.success) {
      if (window.showToast) showToast('✅ Ordinamento gruppi salvato con successo!');
    } else {
      if (window.showToast) showToast('Errore nel salvataggio dell\'ordinamento');
    }
  } catch (e) {
    if (window.showToast) showToast(`Errore di rete: ${e.message}`);
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerText = '💾 Salva Ordinamento Gruppi';
    }
  }
}

// Rinomina Gruppo
let renamingOldGroup = '';

function openRenameGroupModal(groupName) {
  renamingOldGroup = groupName;
  const modal = document.getElementById('modal-rename-group');
  const inputOld = document.getElementById('rename-old-group');
  const inputNew = document.getElementById('rename-new-group');

  if (inputOld) inputOld.value = groupName;
  if (inputNew) inputNew.value = groupName;
  if (modal) modal.classList.add('show');
}

function closeRenameGroupModal() {
  const modal = document.getElementById('modal-rename-group');
  if (modal) modal.classList.remove('show');
}

async function confirmRenameGroup() {
  const inputNew = document.getElementById('rename-new-group');
  const newName = inputNew ? inputNew.value.trim() : '';
  if (!newName || newName === renamingOldGroup) {
    closeRenameGroupModal();
    return;
  }

  try {
    const res = await fetch('/api/groups/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldName: renamingOldGroup, newName })
    });
    const data = await res.json();

    if (data.success) {
      if (window.showToast) showToast(`Gruppo rinominato in "${newName}"!`);
      closeRenameGroupModal();
      await loadGroupsManager();
    } else {
      if (window.showToast) showToast(data.error || 'Errore durante la ridenominazione');
    }
  } catch (e) {
    if (window.showToast) showToast(`Errore di rete: ${e.message}`);
  }
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.innerText = text;
  return div.innerHTML;
}

// Inizializzazione Listener
document.addEventListener('DOMContentLoaded', () => {
  const saveBtn = document.getElementById('btn-save-groups-order');
  if (saveBtn) saveBtn.addEventListener('click', saveGroupsOrder);

  const smartBtn = document.getElementById('btn-preset-smart-order');
  if (smartBtn) smartBtn.addEventListener('click', applySmartPreset);

  const azBtn = document.getElementById('btn-preset-az-order');
  if (azBtn) azBtn.addEventListener('click', applyAlphabeticalPreset);

  const btnConfirmRename = document.getElementById('btn-confirm-rename-group');
  if (btnConfirmRename) btnConfirmRename.addEventListener('click', confirmRenameGroup);
});

window.loadGroupsManager = loadGroupsManager;
window.moveGroupItem = moveGroupItem;
window.openRenameGroupModal = openRenameGroupModal;
window.closeRenameGroupModal = closeRenameGroupModal;

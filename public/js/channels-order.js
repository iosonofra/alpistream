/**
 * Gestione Ordinamento Canali e Numerazione LCN (MandraKodi Web Manager)
 */

(function () {
  'use strict';

  let allChannels = [];
  let currentFilterGroup = 'ALL';
  let searchQuery = '';
  let draggedItemIdx = null;

  const el = {
    totalCount: document.getElementById('channels-order-total-count'),
    groupFilter: document.getElementById('order-group-filter'),
    searchInput: document.getElementById('order-search-input'),
    sortableList: document.getElementById('channels-sortable-list'),
    btnSave: document.getElementById('btn-save-channels-order'),
    btnAutoLcn: document.getElementById('btn-renumber-lcn-auto'),
    btnReload: document.getElementById('btn-reload-channels-order')
  };

  async function loadChannelsOrder() {
    if (!el.sortableList) return;
    el.sortableList.innerHTML = '<div class="text-center p-4 text-muted">Caricamento canali in corso...</div>';

    try {
      const res = await fetch('/api/channels/order');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      allChannels = data.channels || [];
      if (el.totalCount) el.totalCount.textContent = `${allChannels.length} Canali`;

      populateGroupFilter();
      renderList();
    } catch (err) {
      console.error('[ChannelsOrder] Errore:', err);
      el.sortableList.innerHTML = `<div class="text-center p-4 text-danger">⚠️ Errore caricamento: ${err.message}</div>`;
    }
  }

  function populateGroupFilter() {
    if (!el.groupFilter) return;
    const selected = el.groupFilter.value || 'ALL';
    const groups = [...new Set(allChannels.map(c => c.group || 'Generale'))].sort();

    el.groupFilter.innerHTML = '<option value="ALL">Tutti i Gruppi</option>';
    groups.forEach(g => {
      const opt = document.createElement('option');
      opt.value = g;
      opt.textContent = g;
      if (g === selected) opt.selected = true;
      el.groupFilter.appendChild(opt);
    });
  }

  function getFilteredChannels() {
    let list = [...allChannels];

    if (currentFilterGroup && currentFilterGroup !== 'ALL') {
      list = list.filter(c => (c.group || 'Generale') === currentFilterGroup);
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(c =>
        (c.title && c.title.toLowerCase().includes(q)) ||
        (c.group && c.group.toLowerCase().includes(q)) ||
        (String(c.lcn || '').includes(q))
      );
    }

    return list;
  }

  function renderList() {
    if (!el.sortableList) return;
    const filtered = getFilteredChannels();

    if (filtered.length === 0) {
      el.sortableList.innerHTML = '<div class="text-center p-4 text-muted">Nessun canale trovato con i filtri attuali.</div>';
      return;
    }

    el.sortableList.innerHTML = '';
    const fragment = document.createDocumentFragment();

    filtered.forEach((ch, idx) => {
      const item = document.createElement('div');
      item.className = 'sortable-channel-item';
      item.draggable = true;
      item.dataset.id = ch.id;
      item.dataset.idx = idx;

      const logoSrc = ch.logo || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30" viewBox="0 0 40 30"><rect width="40" height="30" fill="%23222"/><text x="20" y="18" fill="%23888" font-size="10" font-family="sans-serif" text-anchor="middle">TV</text></svg>';

      item.innerHTML = `
        <div class="drag-handle" title="Trascina per riordinare">☰</div>
        <div class="channel-order-logo">
          <img src="${escapeHtml(logoSrc)}" alt="" onerror="this.style.display='none'">
        </div>
        <div class="channel-order-details">
          <span class="channel-order-name">${escapeHtml(ch.title)}</span>
          <span class="badge badge-group" style="font-size: 0.75rem;">${escapeHtml(ch.group || 'Generale')}</span>
        </div>
        <div class="channel-order-actions">
          <button type="button" class="btn btn-sm btn-icon-only btn-move-up" title="Sposta su" data-id="${ch.id}">▲</button>
          <button type="button" class="btn btn-sm btn-icon-only btn-move-down" title="Sposta giù" data-id="${ch.id}">▼</button>
        </div>
        <div class="channel-order-lcn">
          <label>LCN:</label>
          <input type="number" class="form-control form-control-sm order-lcn-input" data-id="${ch.id}" value="${ch.lcn || (idx + 1)}" min="1" max="99999">
        </div>
      `;

      // Drag & Drop
      item.addEventListener('dragstart', (e) => {
        draggedItemIdx = idx;
        item.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
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
        if (draggedItemIdx === null || draggedItemIdx === idx) return;

        // Scambia o sposta nella lista visibile
        const itemToMove = filtered[draggedItemIdx];
        filtered.splice(draggedItemIdx, 1);
        filtered.splice(idx, 0, itemToMove);

        // Aggiorna posizioni in allChannels
        reorderAllChannelsFromFiltered(filtered);
        renderList();
      });

      item.addEventListener('dragend', () => {
        draggedItemIdx = null;
        item.classList.remove('dragging');
        document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
      });

      // Modifica manuale LCN input
      const lcnInput = item.querySelector('.order-lcn-input');
      if (lcnInput) {
        lcnInput.addEventListener('change', (e) => {
          const val = parseInt(e.target.value, 10);
          if (!isNaN(val) && val > 0) {
            ch.lcn = val;
            const target = allChannels.find(c => c.id === ch.id);
            if (target) target.lcn = val;
          }
        });
      }

      // Sposta su / giù
      const btnUp = item.querySelector('.btn-move-up');
      if (btnUp) {
        btnUp.addEventListener('click', () => {
          if (idx > 0) {
            const temp = filtered[idx];
            filtered[idx] = filtered[idx - 1];
            filtered[idx - 1] = temp;
            reorderAllChannelsFromFiltered(filtered);
            renderList();
          }
        });
      }

      const btnDown = item.querySelector('.btn-move-down');
      if (btnDown) {
        btnDown.addEventListener('click', () => {
          if (idx < filtered.length - 1) {
            const temp = filtered[idx];
            filtered[idx] = filtered[idx + 1];
            filtered[idx + 1] = temp;
            reorderAllChannelsFromFiltered(filtered);
            renderList();
          }
        });
      }

      fragment.appendChild(item);
    });

    el.sortableList.appendChild(fragment);
  }

  function reorderAllChannelsFromFiltered(filteredSublist) {
    // Sincronizza l'ordine della sottolista in allChannels
    const idsInSub = new Set(filteredSublist.map(c => c.id));
    const result = [];
    let subIdx = 0;

    for (let i = 0; i < allChannels.length; i++) {
      const c = allChannels[i];
      if (idsInSub.has(c.id)) {
        result.push(filteredSublist[subIdx++]);
      } else {
        result.push(c);
      }
    }

    allChannels = result;
  }

  // Compatta LCN automatico (1..N)
  function renumberLcnAuto() {
    const filtered = getFilteredChannels();
    filtered.forEach((ch, idx) => {
      ch.lcn = idx + 1;
      const target = allChannels.find(c => c.id === ch.id);
      if (target) target.lcn = idx + 1;
    });
    renderList();
    showOrderToast(`Numerazione LCN compatta (1..${filtered.length}) impostata. Premi Salva per confermare.`);
  }

  // Salva ordinamento su server
  async function saveChannelsOrder() {
    if (!el.btnSave) return;
    el.btnSave.disabled = true;
    el.btnSave.textContent = 'Salvataggio in corso...';

    // Raccogli mappa LCN da tutti i canali
    const lcnMap = {};
    allChannels.forEach((ch, idx) => {
      lcnMap[ch.id] = (ch.lcn !== undefined && ch.lcn !== null && !isNaN(ch.lcn)) ? ch.lcn : (idx + 1);
    });

    try {
      const res = await fetch('/api/channels/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lcnMap })
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      showOrderToast(`✅ ${data.message || 'Ordinamento salvato con successo!'}`);
      loadChannelsOrder();
    } catch (err) {
      console.error('[ChannelsOrder] Errore salvataggio:', err);
      showOrderToast(`⚠️ Errore salvataggio: ${err.message}`);
    } finally {
      el.btnSave.disabled = false;
      el.btnSave.textContent = '💾 Salva Ordinamento';
    }
  }

  function showOrderToast(msg) {
    const toast = document.getElementById('toast-notification');
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3500);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Setup eventi
  function setupEvents() {
    if (el.groupFilter) {
      el.groupFilter.addEventListener('change', (e) => {
        currentFilterGroup = e.target.value;
        renderList();
      });
    }

    if (el.searchInput) {
      el.searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value.trim();
        renderList();
      });
    }

    if (el.btnAutoLcn) {
      el.btnAutoLcn.addEventListener('click', renumberLcnAuto);
    }

    if (el.btnSave) {
      el.btnSave.addEventListener('click', saveChannelsOrder);
    }

    if (el.btnReload) {
      el.btnReload.addEventListener('click', loadChannelsOrder);
    }

    // Intercetta cambio tab nel web manager
    document.querySelectorAll('.nav-item[data-tab="channels-order"]').forEach(btn => {
      btn.addEventListener('click', () => {
        loadChannelsOrder();
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setupEvents();
    });
  } else {
    setupEvents();
  }
})();

/* ============================================================
   admin.js — AMI Florería · Panel de Administración
   Módulos: Config · API · ImgBB · UI · Categorías · Catálogo
   ============================================================ */

/* ══════════════════════════════════════════════════════════════
   1. CONFIGURACIÓN  — ajusta estas dos variables antes de subir
   ══════════════════════════════════════════════════════════════ */
const WORKER_BASE_URL  = 'https://dry-leaf-5fbf.ami-floreria-web.workers.dev'; // ← sin barra final

/* ── Presets de imagen — cambia ACTIVE_PRESET para ajustar la calidad de subida ── */
const IMAGE_PRESETS = {
  thumbnail: { maxWidth:  150, maxHeight:  150, quality: 0.80 },
  small:     { maxWidth:  400, maxHeight:  400, quality: 0.82 },
  medium:    { maxWidth:  800, maxHeight:  800, quality: 0.85 },
  large:     { maxWidth: 1200, maxHeight: 1200, quality: 0.88 },
  hd:        { maxWidth: 1920, maxHeight: 1920, quality: 0.90 },
};
const ACTIVE_PRESET = 'medium'; // thumbnail | small | medium | large | hd

/* ══════════════════════════════════════════════════════════════
   2. ESTADO GLOBAL
   ══════════════════════════════════════════════════════════════ */
let categories = [];   // [{nombre, orden}, ...]
let products   = [];   // [{id, nombre, descripcion, imagen_url, categorias: []}, ...]

let activeProdFilter = '__all__'; // nombre de categoría o '__all__'
let reorderMode      = false;     // true cuando el modo Re-ordenar está activo

// Datos temporales para el modal de producto
let _pendingImgFile  = null;  // File | null — imagen nueva seleccionada
let _currentImgUrl   = '';    // URL actual (edición sin cambio de img)
let _imgWasRemoved   = false; // si el usuario quitó la imagen en edición

/* ════════════════════════════════════════════════════════════
   3. AUTENTICACIÓN
   ════════════════════════════════════════════════════════════ */
const SESSION_KEY = 'ami_admin_token';

function getToken()   { return sessionStorage.getItem(SESSION_KEY) || ''; }
function setToken(t)  { sessionStorage.setItem(SESSION_KEY, t); }
function clearToken() { sessionStorage.removeItem(SESSION_KEY); }

function handleUnauthorized() {
  clearToken();
  const overlay = document.getElementById('login-overlay');
  if (overlay) {
    overlay.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }
}

/* ════════════════════════════════════════════════════════════
   4. API HELPERS
   ════════════════════════════════════════════════════════════ */
async function apiGet(path) {
  const res = await fetch(`${WORKER_BASE_URL}${path}`, {
    headers: { 'Authorization': `Bearer ${getToken()}` },
  });
  if (res.status === 401) { handleUnauthorized(); throw new Error('Sesión expirada. Inicia sesión nuevamente.'); }
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json();
}

async function apiPost(path, body) {
  const res = await fetch(`${WORKER_BASE_URL}${path}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
    body:    JSON.stringify(body),
  });
  if (res.status === 401) { handleUnauthorized(); throw new Error('Sesión expirada. Inicia sesión nuevamente.'); }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `POST ${path} → ${res.status}`);
  }
  return res.json();
}

async function apiPut(path, body) {
  const res = await fetch(`${WORKER_BASE_URL}${path}`, {
    method:  'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
    body:    JSON.stringify(body),
  });
  if (res.status === 401) { handleUnauthorized(); throw new Error('Sesión expirada. Inicia sesión nuevamente.'); }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `PUT ${path} → ${res.status}`);
  }
  return res.json();
}

async function apiDelete(path, body) {
  const res = await fetch(`${WORKER_BASE_URL}${path}`, {
    method:  'DELETE',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
    body:    JSON.stringify(body),
  });
  if (res.status === 401) { handleUnauthorized(); throw new Error('Sesión expirada. Inicia sesión nuevamente.'); }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `DELETE ${path} → ${res.status}`);
  }
  return res.json();
}

/* ══════════════════════════════════════════════════════════════
   4. IMAGEN — RESIZE + UPLOAD (vía Worker)
   ══════════════════════════════════════════════════════════════ */

/* ── Redimensiona la imagen con Canvas antes de subir ───── */
async function resizeImage(file) {
  const { maxWidth, maxHeight, quality } = IMAGE_PRESETS[ACTIVE_PRESET];
  return new Promise(resolve => {
    const img = new Image();
    const src = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(src);
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      // Si ya está dentro del límite, se devuelve tal cual
      if (w <= maxWidth && h <= maxHeight) { resolve(file); return; }
      // Calcula escala manteniendo aspect ratio
      const ratio  = Math.min(maxWidth / w, maxHeight / h);
      const canvas = document.createElement('canvas');
      canvas.width  = Math.round(w * ratio);
      canvas.height = Math.round(h * ratio);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        blob => resolve(new File([blob], file.name, { type: 'image/jpeg' })),
        'image/jpeg',
        quality
      );
    };
    img.onerror = () => resolve(file); // fallback: usar original
    img.src = src;
  });
}

/* ── Sube imagen vía Worker → ImgBB (álbum) ── */
async function uploadImagen(file) {
  const processed = await resizeImage(file);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    reader.onload  = async () => {
      try {
        const base64 = reader.result.split(',')[1];
        const res = await fetch(`${WORKER_BASE_URL}/upload-imagen`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
          body:    JSON.stringify({ imagen_base64: base64 }),
        });
        if (res.status === 401) throw new Error('Sesión expirada. Inicia sesión nuevamente.');
        if (!res.ok) throw new Error(`Worker upload → ${res.status}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        resolve({ url: data.url, publicId: data.public_id });
      } catch (e) {
        reject(e);
      }
    };
    reader.readAsDataURL(processed);
  });
}

/* ══════════════════════════════════════════════════════════════
   5. UI UTILITIES
   ══════════════════════════════════════════════════════════════ */

/* ── Toasts ─────────────────────────────────────────────── */
const toastContainer = document.getElementById('toast-container');

function showToast(msg, type = 'info', duration = 3500) {
  const icons = {
    success: '<svg class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>',
    error:   '<svg class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>',
    info:    '<svg class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4m0 4h.01"/></svg>',
  };
  const toast = document.createElement('div');
  toast.className = `admin-toast ${type}`;
  toast.innerHTML = `${icons[type] || icons.info}<span>${msg}</span>`;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
    toast.style.opacity    = '0';
    toast.style.transform  = 'translateX(1rem)';
    setTimeout(() => toast.remove(), 320);
  }, duration);
}

/* ── Modal open / close ──────────────────────────────────── */
function openModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('hidden');
  document.body.style.overflow = '';
}

// Close on backdrop or [data-close] buttons
document.querySelectorAll('[data-close]').forEach(btn => {
  btn.addEventListener('click', () => closeModal(btn.dataset.close));
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    ['modal-cat', 'modal-prod', 'modal-confirm'].forEach(closeModal);
  }
});

/* ── Confirmation modal ──────────────────────────────────── */
function confirm(message) {
  return new Promise(resolve => {
    document.getElementById('modal-confirm-msg').textContent = message;
    openModal('modal-confirm');

    const btnOk     = document.getElementById('btn-confirm-ok');
    const btnCancel = document.getElementById('btn-confirm-cancel');

    function cleanup(result) {
      closeModal('modal-confirm');
      btnOk.removeEventListener('click', onOk);
      btnCancel.removeEventListener('click', onCancel);
      resolve(result);
    }
    const onOk     = () => cleanup(true);
    const onCancel = () => cleanup(false);

    btnOk.addEventListener('click', onOk);
    btnCancel.addEventListener('click', onCancel);
  });
}

/* ── Button loading state ────────────────────────────────── */
function setBtnLoading(labelId, spinnerId, loading) {
  const label   = document.getElementById(labelId);
  const spinner = document.getElementById(spinnerId);
  if (!label || !spinner) return;
  label.classList.toggle('hidden', loading);
  spinner.classList.toggle('hidden', !loading);
}

/* ── Tab switching ───────────────────────────────────────── */
function switchTab(tabName) {
  // Panels
  document.querySelectorAll('.admin-tab-panel').forEach(p => {
    const isTarget = p.id === `tab-${tabName}`;
    p.classList.toggle('hidden', !isTarget);
    if (isTarget) p.classList.remove('hidden');
  });

  // Desktop tab buttons
  document.querySelectorAll('.admin-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });

  // Mobile tab buttons
  document.querySelectorAll('.admin-mobile-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
}

// Attach tab button listeners
document.querySelectorAll('.admin-tab-btn, .admin-mobile-tab').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

/* ══════════════════════════════════════════════════════════════
   6. MÓDULO CATEGORÍAS
   ══════════════════════════════════════════════════════════════ */
const catTableBody = document.getElementById('cat-table-body');

/* ── Render table ────────────────────────────────────────── */
function renderCatTable() {
  if (categories.length === 0) {
    catTableBody.innerHTML = `
      <tr><td colspan="4" class="py-12">
        <div class="admin-empty">
          <span class="admin-empty-icon">🌸</span>
          <p class="admin-empty-title">Sin categorías</p>
          <p class="admin-empty-desc">Agrega la primera categoría para comenzar.</p>
        </div>
      </td></tr>`;
    return;
  }

  catTableBody.innerHTML = categories.map((cat, i) => `
    <tr class="drag-row border-b border-[#EDEDED] last:border-0"
        data-nombre="${escapeAttr(cat.nombre)}">
      <td class="admin-td w-10 px-3">
        <span class="drag-handle" title="Arrastrar">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M8 9h.01M8 15h.01M16 9h.01M16 15h.01M12 9h.01M12 15h.01"/>
          </svg>
        </span>
      </td>
      <td class="admin-td text-[#AAAAAA] text-xs font-mono">${i + 1}</td>
      <td class="admin-td font-medium">${cat.nombre}</td>
      <td class="admin-td">
        <div class="flex items-center gap-2 justify-end">
          <button class="admin-btn-icon" title="Editar"
                  data-action="edit-cat" data-nombre="${escapeAttr(cat.nombre)}">
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 112.828 2.828L11.828 15.828a4 4 0 01-2.828 1.172H7v-2a4 4 0 011.172-2.828z"/>
            </svg>
          </button>
          <button class="admin-btn-icon danger" title="Eliminar"
                  data-action="delete-cat" data-nombre="${escapeAttr(cat.nombre)}">
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3M4 7h16"/>
            </svg>
          </button>
        </div>
      </td>
    </tr>`).join('');

  attachCatRowListeners();
  initSortable();
}

/* ── Row button listeners ────────────────────────────────── */
function attachCatRowListeners() {
  catTableBody.querySelectorAll('[data-action="edit-cat"]').forEach(btn => {
    btn.addEventListener('click', () => openCatModal(btn.dataset.nombre));
  });
  catTableBody.querySelectorAll('[data-action="delete-cat"]').forEach(btn => {
    btn.addEventListener('click', () => handleDeleteCat(btn.dataset.nombre));
  });
}

/* ── SortableJS ──────────────────────────────────────────── */
let sortableInstance = null;

function initSortable() {
  if (sortableInstance) sortableInstance.destroy();
  sortableInstance = Sortable.create(catTableBody, {
    animation:    180,
    handle:       '.drag-handle',
    ghostClass:   'sortable-ghost',
    chosenClass:  'sortable-chosen',
    onEnd() {
      // Recalculate order from DOM
      const rows = [...catTableBody.querySelectorAll('tr[data-nombre]')];
      const updated = rows.map((row, i) => {
        const nombre = row.dataset.nombre;
        return { nombre, orden: i + 1 };
      });
      // Update local state order
      const map = new Map(updated.map(u => [u.nombre, u.orden]));
      categories.sort((a, b) => (map.get(a.nombre) || 0) - (map.get(b.nombre) || 0));
      // Update index cells
      rows.forEach((row, i) => {
        const cell = row.querySelectorAll('td')[1];
        if (cell) cell.textContent = i + 1;
      });
      // Push to API
      sendReorder(updated);
    },
  });
}

async function sendReorder(updated) {
  try {
    await apiPut('/categoria/reorder', updated);
    showToast('Orden guardado', 'success');
  } catch (e) {
    showToast('Error al guardar el orden: ' + e.message, 'error');
  }
}

/* ── Modal categoría ─────────────────────────────────────── */
const formCat       = document.getElementById('form-cat');
const catNombreEl   = document.getElementById('cat-nombre');
const catOrdenEl    = document.getElementById('cat-orden');
const catEditOrig   = document.getElementById('cat-edit-original');
const catNombreErr  = document.getElementById('cat-nombre-err');
const modalCatTitle = document.getElementById('modal-cat-title');

function openCatModal(nombre = null) {
  formCat.reset();
  catNombreErr.classList.add('hidden');
  catNombreEl.classList.remove('error');

  if (nombre) {
    const cat = categories.find(c => c.nombre === nombre);
    if (!cat) return;
    modalCatTitle.textContent  = 'Editar categoría';
    catNombreEl.value          = cat.nombre;
    catEditOrig.value          = cat.nombre;
    catNombreEl.readOnly       = true; // nombre es PK, no editable
    catNombreEl.classList.add('opacity-60', 'cursor-not-allowed');
  } else {
    modalCatTitle.textContent  = 'Nueva categoría';
    catEditOrig.value          = '';
    catNombreEl.readOnly       = false;
    catNombreEl.classList.remove('opacity-60', 'cursor-not-allowed');
  }

  openModal('modal-cat');
  catNombreEl.focus();
}

document.getElementById('btn-add-cat').addEventListener('click', () => openCatModal());

formCat.addEventListener('submit', async e => {
  e.preventDefault();

  const nombre = catNombreEl.value.trim();
  const isEdit = !!catEditOrig.value;
  const orden  = isEdit
    ? (categories.find(c => c.nombre === nombre)?.orden ?? categories.length)
    : Math.max(0, ...categories.map(c => c.orden || 0)) + 1;

  // Validate
  let valid = true;
  if (!nombre) {
    catNombreErr.classList.remove('hidden');
    catNombreEl.classList.add('error');
    valid = false;
  }
  if (!valid) return;

  setBtnLoading('btn-cat-save-label', 'btn-cat-save-spinner', true);

  try {
    if (isEdit) {
      // Only orden can be changed (nombre is PK)
      await apiPut('/categoria', { nombre, orden });
      const idx = categories.findIndex(c => c.nombre === nombre);
      if (idx !== -1) categories[idx].orden = orden;
      showToast('Categoría actualizada', 'success');
    } else {
      // Check duplicate
      if (categories.find(c => c.nombre.toLowerCase() === nombre.toLowerCase())) {
        showToast('Ya existe una categoría con ese nombre', 'error');
        return;
      }
      await apiPost('/categoria', { nombre, orden });
      categories.push({ nombre, orden });
      categories.sort((a, b) => a.orden - b.orden);
      showToast('Categoría creada', 'success');
    }

    closeModal('modal-cat');
    renderCatTable();
    // Refresh product category dropdowns
    refreshCatSelects();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    setBtnLoading('btn-cat-save-label', 'btn-cat-save-spinner', false);
  }
});

async function handleDeleteCat(nombre) {
  const hasProducts = products.some(p => p.categoria_id === nombre);

  if (hasProducts) {
    showToast(`"${nombre}" tiene productos asociados. Elimínalos primero.`, 'error', 5000);
    return;
  }

  const ok = await confirm(`¿Eliminar la categoría "${nombre}"? Esta acción no se puede deshacer.`);
  if (!ok) return;

  const spinner = document.getElementById('btn-confirm-spinner');
  const label   = document.getElementById('btn-confirm-label');
  spinner.classList.remove('hidden');
  label.classList.add('hidden');

  try {
    await apiDelete('/categoria', { nombre });
    categories = categories.filter(c => c.nombre !== nombre);
    showToast('Categoría eliminada', 'success');
    closeModal('modal-confirm');
    renderCatTable();
    refreshCatSelects();
    renderProdFilter();
    renderProdGrid();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    spinner.classList.add('hidden');
    label.classList.remove('hidden');
  }
}

/* ══════════════════════════════════════════════════════════════
   7. MÓDULO CATÁLOGO (PRODUCTOS)
   ══════════════════════════════════════════════════════════════ */
const prodGrid   = document.getElementById('prod-grid');
const prodFilter = document.getElementById('prod-filter');

/* ── Filter chips ────────────────────────────────────────── */
function renderProdFilter() {
  const usedCats = new Set(products.flatMap(p => p.categorias ?? []));
  const chips = categories
    .filter(c => usedCats.has(c.nombre))
    .map(c => `
      <button class="prod-filter-chip${activeProdFilter === c.nombre ? ' active' : ''}"
              data-cat="${escapeAttr(c.nombre)}">
        ${c.nombre}
      </button>`).join('');

  prodFilter.innerHTML = `
    <button class="prod-filter-chip${activeProdFilter === '__all__' ? ' active' : ''}"
            data-cat="__all__">
      Todas
    </button>
    ${chips}`;

  prodFilter.querySelectorAll('.prod-filter-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      activeProdFilter = btn.dataset.cat;
      renderProdFilter();
      if (reorderMode) {
        renderReorderList();
      } else {
        renderProdGrid();
      }
    });
  });
}

/* ── Product grid ────────────────────────────────────────── */
function renderProdGrid() {
  const list = activeProdFilter === '__all__'
    ? products
    : products.filter(p => (p.categorias ?? []).includes(activeProdFilter));

  if (list.length === 0) {
    prodGrid.innerHTML = `
      <div class="col-span-full">
        <div class="admin-empty">
          <span class="admin-empty-icon">🌺</span>
          <p class="admin-empty-title">Sin productos</p>
          <p class="admin-empty-desc">Agrega el primer producto al catálogo.</p>
        </div>
      </div>`;
    return;
  }

  prodGrid.innerHTML = list.map(p => `
    <div class="admin-prod-card">
      <div class="admin-prod-card-img">
        <img src="${escapeAttr(p.imagen_url)}"
             alt="${escapeAttr(p.nombre)}"
             loading="lazy"
             onerror="this.src='https://images.unsplash.com/photo-1490750967868-88df5691bbad?q=60&w=600'" />
      </div>
      <div class="admin-prod-card-body">
        <span class="admin-prod-card-cat">${(p.categorias ?? []).join(', ')}</span>
        <p class="admin-prod-card-name">${escapeAttr(p.nombre)}</p>
        ${p.precio != null ? `<p class="font-display text-lg font-medium text-primary">$${Number(p.precio).toFixed(2)}</p>` : ''}
        ${p.descripcion
          ? `<p class="admin-prod-card-desc">${escapeAttr(p.descripcion)}</p>`
          : ''}
        <div class="admin-prod-card-actions">
          <button class="admin-btn-icon" title="Editar"
                  data-action="edit-prod" data-id="${p.id}">
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 112.828 2.828L11.828 15.828a4 4 0 01-2.828 1.172H7v-2a4 4 0 011.172-2.828z"/>
            </svg>
            Editar
          </button>
          <button class="admin-btn-icon danger" title="Eliminar"
                  data-action="delete-prod" data-id="${p.id}" data-nombre="${escapeAttr(p.nombre)}">
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3M4 7h16"/>
            </svg>
            Eliminar
          </button>
        </div>
      </div>
    </div>`).join('');

  prodGrid.querySelectorAll('[data-action="edit-prod"]').forEach(btn => {
    btn.addEventListener('click', () => openProdModal(+btn.dataset.id));
  });
  prodGrid.querySelectorAll('[data-action="delete-prod"]').forEach(btn => {
    btn.addEventListener('click', () => handleDeleteProd(+btn.dataset.id, btn.dataset.nombre));
  });
}

/* ── Reorder mode ────────────────────────────────────────── */
const prodReorderList   = document.getElementById('prod-reorder-list');
const prodReorderBanner = document.getElementById('prod-reorder-banner');
const btnReorderProd    = document.getElementById('btn-reorder-prod');
const btnExitReorder    = document.getElementById('btn-exit-reorder');
const btnAddProd        = document.getElementById('btn-add-prod');

let _reorderSortable = null;

function enterReorderMode() {
  reorderMode = true;
  prodGrid.classList.add('hidden');
  prodReorderBanner.classList.remove('hidden');
  prodReorderList.classList.remove('hidden');
  btnReorderProd.classList.add('hidden');
  btnAddProd.classList.add('hidden');
  renderReorderList();
}

function exitReorderMode() {
  reorderMode = false;
  if (_reorderSortable) { _reorderSortable.destroy(); _reorderSortable = null; }
  prodReorderList.classList.add('hidden');
  prodReorderBanner.classList.add('hidden');
  prodGrid.classList.remove('hidden');
  btnReorderProd.classList.remove('hidden');
  btnAddProd.classList.remove('hidden');
  renderProdGrid();
}

function renderReorderList() {
  if (_reorderSortable) { _reorderSortable.destroy(); _reorderSortable = null; }

  const list = activeProdFilter === '__all__'
    ? [...products]
    : products.filter(p => (p.categorias ?? []).includes(activeProdFilter));

  if (list.length === 0) {
    prodReorderList.innerHTML = `
      <li class="text-center py-10">
        <p class="font-body text-sm text-[#AAAAAA]">No hay productos en esta categoría.</p>
      </li>`;
    return;
  }

  prodReorderList.innerHTML = list.map(p => `
    <li class="prod-reorder-row" data-id="${p.id}">
      <span class="prod-reorder-handle" title="Arrastrar para reordenar">
        <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
          <path stroke-linecap="round" stroke-linejoin="round" d="M4 8h16M4 16h16"/>
        </svg>
      </span>
      <img class="prod-reorder-thumb"
           src="${escapeAttr(p.imagen_url)}"
           alt="${escapeAttr(p.nombre)}"
           onerror="this.src='https://images.unsplash.com/photo-1490750967868-88df5691bbad?q=60&w=200'" />
      <div class="prod-reorder-info">
        <p class="prod-reorder-name">${escapeAttr(p.nombre)}</p>
        <p class="prod-reorder-meta">${(p.categorias ?? []).join(' · ')}</p>
      </div>
      ${p.precio != null ? `<span class="prod-reorder-price">$${Number(p.precio).toFixed(2)}</span>` : ''}
      <span class="prod-reorder-saving" id="reorder-saving-${p.id}"></span>
    </li>`).join('');

  _reorderSortable = Sortable.create(prodReorderList, {
    handle:    '.prod-reorder-handle',
    animation: 150,
    ghostClass:  'sortable-ghost',
    chosenClass: 'sortable-chosen',
    onEnd: async () => {
      const items = [...prodReorderList.querySelectorAll('li[data-id]')].map((li, idx) => ({
        id:    +li.dataset.id,
        orden: idx + 1,
      }));

      // Optimistic local update
      items.forEach(({ id, orden }) => {
        const p = products.find(x => x.id === id);
        if (p) p.orden = orden;
      });

      // Show saving indicator on all rows
      items.forEach(({ id }) => {
        const el = document.getElementById(`reorder-saving-${id}`);
        if (el) el.innerHTML = `<span class="admin-spinner w-3 h-3 border-[2px]"></span>`;
      });

      try {
        await apiPut('/catalogo/reorder', items);
        items.forEach(({ id }) => {
          const el = document.getElementById(`reorder-saving-${id}`);
          if (el) el.innerHTML = `✓`;
          setTimeout(() => { if (el) el.innerHTML = ''; }, 1500);
        });
      } catch (err) {
        showToast(err.message, 'error');
        items.forEach(({ id }) => {
          const el = document.getElementById(`reorder-saving-${id}`);
          if (el) el.innerHTML = '';
        });
      }
    },
  });
}

btnReorderProd.addEventListener('click', enterReorderMode);
btnExitReorder.addEventListener('click', exitReorderMode);

/* ── Category <select> refresh ───────────────────────────── */
function refreshCatSelects() {
  renderCatPills([]);
}

/* ── Modal producto ──────────────────────────────────────── */
const formProd      = document.getElementById('form-prod');
const prodEditId    = document.getElementById('prod-edit-id');
const prodNombreEl  = document.getElementById('prod-nombre');
const prodCatWrap   = document.getElementById('prod-categorias-wrap');
const prodDescEl    = document.getElementById('prod-desc');
const imgPreview    = document.getElementById('img-preview');
const imgPlaceholder= document.getElementById('img-placeholder');
const imgDropZone   = document.getElementById('img-drop-zone');
const imgFileInput  = document.getElementById('prod-img-file');
const btnImgRemove  = document.getElementById('btn-img-remove');
const imgUploadOvly = document.getElementById('img-upload-overlay');
const modalProdTitle= document.getElementById('modal-prod-title');
const prodNombreErr = document.getElementById('prod-nombre-err');
const prodImgErr    = document.getElementById('prod-img-err');
const prodCatErr    = document.getElementById('prod-cat-err');
const prodPrecioEl  = document.getElementById('prod-precio');
const prodPrecioErr = document.getElementById('prod-precio-err');

function getSelectedCats() {
  return [...prodCatWrap.querySelectorAll('input[type=checkbox]:checked')].map(cb => cb.value);
}

function renderCatPills(selectedCats = []) {
  prodCatWrap.innerHTML = categories.map(c => {
    const checked = selectedCats.includes(c.nombre) ? 'checked' : '';
    const id = `cat-pill-${c.nombre.replace(/\s+/g, '-')}`;
    return `
      <label for="${id}" class="cat-pill-label inline-flex items-center gap-1.5 cursor-pointer
             px-3 py-1.5 rounded-full border text-xs font-body transition-colors duration-150
             ${checked ? 'bg-primary text-white border-primary' : 'border-[#EDEDED] text-[#555] hover:border-primary hover:text-primary'}">
        <input type="checkbox" id="${id}" value="${escapeAttr(c.nombre)}" ${checked}
               class="sr-only" onchange="_onCatPillChange(this)" />
        ${escapeAttr(c.nombre)}
      </label>`;
  }).join('');
}

window._onCatPillChange = function(cb) {
  const label = cb.closest('label');
  if (cb.checked) {
    label.classList.add('bg-primary', 'text-white', 'border-primary');
    label.classList.remove('border-[#EDEDED]', 'text-[#555]', 'hover:border-primary', 'hover:text-primary');
  } else {
    label.classList.remove('bg-primary', 'text-white', 'border-primary');
    label.classList.add('border-[#EDEDED]', 'text-[#555]', 'hover:border-primary', 'hover:text-primary');
  }
  prodCatErr.classList.add('hidden');
  prodCatWrap.classList.remove('error');
};

function resetImageUI() {
  _pendingImgFile  = null;
  _currentImgUrl   = '';
  _imgWasRemoved   = false;
  imgPreview.src   = '';
  imgPreview.classList.add('hidden');
  imgPlaceholder.classList.remove('hidden');
  btnImgRemove.classList.add('hidden');
  imgUploadOvly.classList.add('hidden');
}

function setImagePreview(url) {
  imgPreview.src = url;
  imgPreview.classList.remove('hidden');
  imgPlaceholder.classList.add('hidden');
  btnImgRemove.classList.remove('hidden');
}

function openProdModal(id = null) {
  formProd.reset();
  resetImageUI();
  [prodNombreErr, prodImgErr, prodCatErr, prodPrecioErr].forEach(el => el.classList.add('hidden'));
  [prodNombreEl, prodPrecioEl].forEach(el => el.classList.remove('error'));
  prodCatWrap.classList.remove('error');

  refreshCatSelects(); // renders pills

  if (id !== null) {
    const prod = products.find(p => p.id === id);
    if (!prod) return;
    modalProdTitle.textContent = 'Editar producto';
    prodEditId.value           = prod.id;
    prodNombreEl.value         = prod.nombre;
    renderCatPills(prod.categorias ?? []);
    prodPrecioEl.value         = prod.precio ?? '';
    prodDescEl.value           = prod.descripcion || '';
    _currentImgUrl             = prod.imagen_url;
    setImagePreview(prod.imagen_url);
  } else {
    modalProdTitle.textContent = 'Nuevo producto';
    prodEditId.value           = '';
  }

  openModal('modal-prod');
  prodNombreEl.focus();
}

document.getElementById('btn-add-prod').addEventListener('click', () => openProdModal());

// Image click → file picker
imgDropZone.addEventListener('click', () => {
  if (!imgPreview.classList.contains('hidden')) return; // already has image, click remove instead
  imgFileInput.click();
});

// Drag over / drop
imgDropZone.addEventListener('dragover', e => {
  e.preventDefault();
  imgDropZone.classList.add('drag-over');
});
imgDropZone.addEventListener('dragleave', () => imgDropZone.classList.remove('drag-over'));
imgDropZone.addEventListener('drop', e => {
  e.preventDefault();
  imgDropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) handleImageFile(file);
});

imgFileInput.addEventListener('change', () => {
  const file = imgFileInput.files[0];
  if (file) handleImageFile(file);
  imgFileInput.value = '';
});

function handleImageFile(file) {
  _pendingImgFile  = file;
  _imgWasRemoved   = false;
  const objectUrl  = URL.createObjectURL(file);
  setImagePreview(objectUrl);
  prodImgErr.classList.add('hidden');
}

btnImgRemove.addEventListener('click', e => {
  e.stopPropagation();
  _pendingImgFile  = null;
  _imgWasRemoved   = true;
  _currentImgUrl   = '';
  resetImageUI();
});

/* ── Form submit ─────────────────────────────────────────── */
formProd.addEventListener('submit', async e => {
  e.preventDefault();

  const isEdit   = !!prodEditId.value;
  const nombre   = prodNombreEl.value.trim();
  const categorias = getSelectedCats();
  const desc     = prodDescEl.value.trim();
  const precio   = parseFloat(prodPrecioEl.value);
  const hasImg   = !!_pendingImgFile || (!_imgWasRemoved && !!_currentImgUrl);

  // Validation
  let valid = true;
  if (!nombre) {
    prodNombreErr.classList.remove('hidden');
    prodNombreEl.classList.add('error');
    valid = false;
  }
  if (categorias.length === 0) {
    prodCatErr.classList.remove('hidden');
    prodCatWrap.classList.add('error');
    valid = false;
  }
  if (!hasImg) {
    prodImgErr.classList.remove('hidden');
    valid = false;
  }
  if (isNaN(precio) || precio < 0) {
    prodPrecioErr.classList.remove('hidden');
    prodPrecioEl.classList.add('error');
    valid = false;
  }
  if (!valid) return;

  setBtnLoading('btn-prod-save-label', 'btn-prod-save-spinner', true);

  try {
    let imagen_url        = _currentImgUrl;
    let imagen_public_id = '';

    // Subir nueva imagen vía Worker si se seleccionó un archivo
    if (_pendingImgFile) {
      imgUploadOvly.classList.remove('hidden');
      try {
        const uploaded    = await uploadImagen(_pendingImgFile);
        imagen_url        = uploaded.url;
        imagen_public_id = uploaded.publicId;
        // El Worker elimina la imagen anterior automáticamente al hacer PUT
      } finally {
        imgUploadOvly.classList.add('hidden');
      }
    } else {
      // Conservar el public_id existente si la imagen no cambió
      const existing    = products.find(p => p.id === +prodEditId.value);
      imagen_public_id = (!_imgWasRemoved && existing) ? (existing.imagen_public_id || '') : '';
    }

    const payload = { nombre, descripcion: desc, imagen_url, imagen_public_id, categorias, precio };

    if (isEdit) {
      payload.id = +prodEditId.value;
      await apiPut('/catalogo', payload);
      const idx = products.findIndex(p => p.id === payload.id);
      if (idx !== -1) products[idx] = { ...products[idx], ...payload };
      showToast('Producto actualizado', 'success');
    } else {
      const created = await apiPost('/catalogo', payload);
      // Worker should return the new record (with id)
      products.push(created.producto ?? { ...payload, id: Date.now() });
      showToast('Producto creado', 'success');
    }

    closeModal('modal-prod');
    renderProdFilter();
    renderProdGrid();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    setBtnLoading('btn-prod-save-label', 'btn-prod-save-spinner', false);
  }
});

async function handleDeleteProd(id, nombre) {
  const ok = await confirm(`¿Eliminar el producto "${nombre}"? Esta acción no se puede deshacer.`);
  if (!ok) return;

  const spinner = document.getElementById('btn-confirm-spinner');
  const label   = document.getElementById('btn-confirm-label');
  spinner.classList.remove('hidden');
  label.classList.add('hidden');

  try {
    await apiDelete('/catalogo', { id });
    products = products.filter(p => p.id !== id);
    if (activeProdFilter !== '__all__' && !products.some(p => (p.categorias ?? []).includes(activeProdFilter))) {
      activeProdFilter = '__all__';
    }
    showToast('Producto eliminado', 'success');
    closeModal('modal-confirm');
    renderProdFilter();
    renderProdGrid();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    spinner.classList.add('hidden');
    label.classList.remove('hidden');
  }
}

/* ══════════════════════════════════════════════════════════════
   8. HELPERS
   ══════════════════════════════════════════════════════════════ */
function escapeAttr(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/* ══════════════════════════════════════════════════════════════
   9. CARGA DE DATOS
   ══════════════════════════════════════════════════════════════ */
async function loadData() {
  try {
    const [catData, prodData] = await Promise.all([
      apiGet('/categoria'),
      apiGet('/catalogo'),
    ]);

    // Normalise — adapt to whatever shape the Worker returns
    categories = (catData.categoria ?? catData ?? []).sort((a, b) => a.orden - b.orden);
    products   = prodData.catalogo  ?? prodData  ?? [];

    renderCatTable();
    refreshCatSelects();
    renderProdFilter();
    renderProdGrid();
  } catch (err) {
    showToast('No se pudo conectar con la API: ' + err.message, 'error', 8000);

    catTableBody.innerHTML = `
      <tr><td colspan="4" class="py-10 text-center">
        <p class="font-body text-sm text-[#777777]">Error al cargar categorías.</p>
      </td></tr>`;

    prodGrid.innerHTML = `
      <div class="col-span-full admin-empty">
        <span class="admin-empty-icon">⚠️</span>
        <p class="admin-empty-title">Error de conexión</p>
        <p class="admin-empty-desc">${err.message}</p>
      </div>`;
  }
}

/* ════════════════════════════════════════════════════════════
   10. ARRANQUE — verifica sesión antes de cargar datos
   ════════════════════════════════════════════════════════════ */
(function initAuth() {
  const overlay    = document.getElementById('login-overlay');
  const loginForm  = document.getElementById('login-form');
  const loginError = document.getElementById('login-error');
  const logoutBtn  = document.getElementById('btn-logout');

  function showLoginError(msg) {
    loginError.textContent = msg;
    loginError.classList.remove('hidden');
  }

  function hideLoginError() {
    loginError.classList.add('hidden');
  }

  function showApp() {
    overlay.classList.add('hidden');
    document.body.style.overflow = '';
    if (logoutBtn) logoutBtn.classList.replace('hidden', 'flex');
  }

  // Login form submit
  loginForm.addEventListener('submit', async e => {
    e.preventDefault();
    hideLoginError();

    const usuario  = document.getElementById('login-user').value.trim();
    const password = document.getElementById('login-pass').value;

    if (!usuario || !password) {
      showLoginError('Ingresa tu usuario y contraseña.');
      return;
    }

    setBtnLoading('btn-login-label', 'btn-login-spinner', true);

    try {
      const res = await fetch(`${WORKER_BASE_URL}/auth/login`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ usuario, password }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        showLoginError(data.error || 'Usuario o contraseña incorrectos.');
        return;
      }

      setToken(data.token);
      showApp();
      loadData();
    } catch {
      showLoginError('No se pudo conectar. Verifica tu conexión e intenta de nuevo.');
    } finally {
      setBtnLoading('btn-login-label', 'btn-login-spinner', false);
    }
  });

  // Logout
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      clearToken();
      location.reload();
    });
  }

  // Ya hay sesión activa
  if (getToken()) {
    showApp();
    loadData();
  } else {
    document.body.style.overflow = 'hidden';
  }
})();

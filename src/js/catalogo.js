/* ── CONFIG ──────────────────────────────────────── */
const WA_NUMBER      = '526623157262'; 
const WORKER_BASE_URL = 'https://dry-leaf-5fbf.ami-floreria-web.workers.dev';

/* ── WA LINKS ────────────────────────────────────── */
const generalWa = `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent('Hola AMI, vi su cat\u00E1logo y me gustar\u00EDa hacer un pedido.')}`;
document.getElementById('nav-whatsapp').href   = generalWa;
document.getElementById('whatsapp-float').href = generalWa;

function buildWaUrl(nombre, categoria) {
  const msg = `Hola AMI, vi su cat\u00E1logo y me interesa el producto: *${nombre}* (${categoria}). \u00BFTienen disponibilidad?`;
  return `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(msg)}`;
}

/* ── NAVBAR SCROLL ───────────────────────────────── */
const navbar = document.getElementById('navbar');
window.addEventListener('scroll', () => {
  navbar.classList.toggle('scrolled', window.scrollY > 10);
}, { passive: true });

/* ── STATE ───────────────────────────────────────── */
const root     = document.getElementById('catalog-root');
const filterEl = document.getElementById('category-filter');

let rawProducts     = [];  // full list from API (catalog endpoint)
let categories      = [];  // ordered list from categories endpoint
let activeFilter = ''; // empty string = show all
let visibleProducts = [];  // products in current view (for modal navigation)

/* ── HELPERS ─────────────────────────────────────── */
function escapeAttr(str) {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

/* ── SKELETON ────────────────────────────────────── */
function renderSkeletons() {
  const card = `
    <div class="product-card">
      <div class="product-card-img skeleton" style="aspect-ratio:4/3"></div>
      <div class="product-card-body gap-3">
        <div class="skeleton h-4 rounded w-1/4 mb-1"></div>
        <div class="skeleton h-6 rounded w-3/4"></div>
        <div class="skeleton h-4 rounded w-full"></div>
        <div class="skeleton h-4 rounded w-2/3"></div>
        <div class="skeleton h-8 rounded-full w-36 mt-2"></div>
      </div>
    </div>`;
  root.innerHTML = `
    <div class="mb-16">
      <div class="skeleton h-8 rounded w-48 mb-10"></div>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">${card.repeat(3)}</div>
    </div>
    <div class="mb-16">
      <div class="skeleton h-8 rounded w-32 mb-10"></div>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">${card.repeat(3)}</div>
    </div>`;
}

/* ── FILTER CHIPS ────────────────────────────────── */
function renderFilterChips() {
  // Only show categories that actually have products
  const catNamesWithProducts = new Set(rawProducts.map(p => p.categoria_id));
  const visibleCats = categories.filter(cat => catNamesWithProducts.has(cat.nombre));

  const chips = visibleCats.map(cat => `
    <button class="filter-chip font-body text-sm px-4 py-2 rounded-full border transition-all duration-200
                   border-[#EDEDED] text-[#777777] hover:border-primary hover:text-primary"
            data-cat="${escapeAttr(cat.nombre)}">
      ${cat.nombre}
    </button>`).join('');

  filterEl.innerHTML = `
    <button id="filter-all"
            class="filter-chip font-body text-sm px-4 py-2 rounded-full border transition-all duration-200
                   bg-[#C04868] border-[#C04868] text-white"
            data-cat="__all__">
      Todas
    </button>
    ${chips}`;

  filterEl.querySelectorAll('.filter-chip').forEach(btn => {
    btn.addEventListener('click', () => handleFilterClick(btn));
  });
}

function handleFilterClick(btn) {
  const cat = btn.dataset.cat;
  activeFilter = cat === '__all__' ? '' : cat;
  updateFilterChipStyles();
  buildCatalog();
}

function updateFilterChipStyles() {
  const isAll  = activeFilter === '';
  const allBtn = document.getElementById('filter-all');

  if (allBtn) {
    allBtn.classList.toggle('bg-[#C04868]',     isAll);
    allBtn.classList.toggle('text-white',       isAll);
    allBtn.classList.toggle('border-[#C04868]', isAll);
    allBtn.classList.toggle('text-[#777777]',   !isAll);
    allBtn.classList.toggle('border-[#EDEDED]', !isAll);
  }

  filterEl.querySelectorAll('.filter-chip:not(#filter-all)').forEach(btn => {
    const active = activeFilter === btn.dataset.cat;
    btn.classList.toggle('bg-[#C04868]',         active);
    btn.classList.toggle('text-white',           active);
    btn.classList.toggle('border-[#C04868]',     active);
    btn.classList.toggle('text-[#777777]',       !active);
    btn.classList.toggle('border-[#EDEDED]',     !active);
    btn.classList.toggle('hover:border-primary', !active);
    btn.classList.toggle('hover:text-primary',   !active);
  });
}

/* ── CARD HTML ───────────────────────────────────── */
function cardHTML(p, idx) {
  return `
    <article class="product-card group cursor-pointer"
             data-pid="${idx}"
             tabindex="0"
             role="button"
             aria-label="Ver detalle: ${escapeAttr(p.nombre)}">
      <div class="product-card-img">
        <img src="${escapeAttr(p.imagen_url)}"
             alt="${escapeAttr(p.nombre)}"
             loading="lazy"
             class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
             onerror="this.src='https://images.unsplash.com/photo-1490750967868-88df5691bbad?q=60&w=600'" />
      </div>
      <div class="product-card-body">
        <span class="font-body text-[10px] uppercase tracking-[0.2em] text-primary/70 mb-1 block">${escapeAttr(p.categoria_id)}</span>
        <h3 class="font-display text-xl font-medium mb-1 capitalize">${escapeAttr(p.nombre)}</h3>
        <p class="text-sm text-[#777777] mb-3 leading-relaxed line-clamp-2">${p.descripcion || ''}</p>
        <button class="product-cta pointer-events-none" tabindex="-1">Ver detalle →</button>
      </div>
    </article>`;
}

/* ── CATALOG BUILD ───────────────────────────────── */
function buildCatalog() {
  // Group raw products by category name, newest first (desc by id)
  const groups = {};
  categories.forEach(cat => { groups[cat.nombre] = []; });
  rawProducts.forEach(p => {
    if (groups[p.categoria_id] !== undefined) {
      groups[p.categoria_id].push(p);
    }
  });
  Object.values(groups).forEach(arr => arr.sort((a, b) => b.id - a.id));

  // Determine active categories
  const activeCatSet = activeFilter === ''
    ? new Set(categories.map(c => c.nombre))
    : new Set([activeFilter]);

  // Build visibleProducts in category order (for modal navigation)
  visibleProducts = [];
  categories.forEach(cat => {
    if (activeCatSet.has(cat.nombre)) {
      visibleProducts.push(...(groups[cat.nombre] || []));
    }
  });

  // Map product id → visible index
  const vidxMap = new Map(visibleProducts.map((p, i) => [p.id, i]));

  // Build HTML
  let html = '';
  categories.forEach(cat => {
    if (!activeCatSet.has(cat.nombre)) return;
    const items = groups[cat.nombre] || [];
    if (items.length === 0) return;

    html += `
      <section class="mb-20">
        <div class="flex items-end gap-4 mb-10">
          <div>
            <span class="font-body text-xs uppercase tracking-[0.25em] text-primary mb-1 block">
              ${items.length} producto${items.length !== 1 ? 's' : ''}
            </span>
            <h2 class="font-display text-4xl sm:text-5xl font-normal text-[#1A1A1A] leading-tight">
              ${cat.nombre}
            </h2>
          </div>
          <div class="flex-1 h-px bg-[#EDEDED] mb-2"></div>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          ${items.map(p => cardHTML(p, vidxMap.get(p.id))).join('')}
        </div>
      </section>`;
  });

  if (!html) {
    html = `
      <div class="text-center py-20">
        <p class="font-display text-2xl text-[#1A1A1A] mb-3">No hay productos en esta categoría.</p>
      </div>`;
  }

  root.innerHTML = html;

  // Attach click handlers
  root.querySelectorAll('[data-pid]').forEach(el => {
    el.addEventListener('click', () => openModal(+el.dataset.pid));
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openModal(+el.dataset.pid);
      }
    });
  });
}

/* ── MODAL ───────────────────────────────────────── */
const modal      = document.getElementById('product-modal');
const modalImg   = document.getElementById('modal-img');
const modalName  = document.getElementById('modal-name');
const modalDesc  = document.getElementById('modal-desc');
const modalPrice = document.getElementById('modal-price');
const modalCat   = document.getElementById('modal-cat');
const modalWa    = document.getElementById('modal-wa');
const modalCount = document.getElementById('modal-counter');
const modalCard  = document.getElementById('modal-card');

let currentIdx = 0;

function openModal(idx) {
  currentIdx = idx;
  syncModal();
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  modal.classList.add('hidden');
  document.body.style.overflow = '';
}

function syncModal() {
  const p = visibleProducts[currentIdx];
  modalImg.src           = p.imagen_url;
  modalImg.alt           = p.nombre;
  modalName.textContent  = p.nombre;
  modalDesc.textContent  = p.descripcion || '';
  modalPrice.textContent = '';
  modalCat.textContent   = p.categoria_id.toUpperCase();
  modalWa.href           = buildWaUrl(p.nombre, p.categoria_id.toUpperCase());
  modalCount.textContent = `${currentIdx + 1} / ${visibleProducts.length}`;
  modalCard.scrollTop    = 0;
}

function goNext() { currentIdx = (currentIdx + 1) % visibleProducts.length; syncModal(); }
function goPrev() { currentIdx = (currentIdx - 1 + visibleProducts.length) % visibleProducts.length; syncModal(); }

document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('modal-backdrop').addEventListener('click', closeModal);
document.getElementById('modal-next').addEventListener('click', goNext);
document.getElementById('modal-prev').addEventListener('click', goPrev);

/* Keyboard */
document.addEventListener('keydown', e => {
  if (modal.classList.contains('hidden')) return;
  if (e.key === 'ArrowRight') goNext();
  else if (e.key === 'ArrowLeft') goPrev();
  else if (e.key === 'Escape') closeModal();
});

/* Touch swipe */
let touchX = 0;
modalCard.addEventListener('touchstart', e => {
  touchX = e.changedTouches[0].clientX;
}, { passive: true });
modalCard.addEventListener('touchend', e => {
  const dx = e.changedTouches[0].clientX - touchX;
  if (Math.abs(dx) > 45) dx < 0 ? goNext() : goPrev();
}, { passive: true });

/* ── FETCH ───────────────────────────────────────── */
renderSkeletons();

Promise.all([
  fetch(`${WORKER_BASE_URL}/categoria`).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }),
  fetch(`${WORKER_BASE_URL}/catalogo`).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }),
])
  .then(([catJson, catalogJson]) => {
    categories  = Array.isArray(catJson)     ? catJson     : (catJson.categoria  ?? []);
    rawProducts = Array.isArray(catalogJson) ? catalogJson : (catalogJson.catalogo ?? []);
    renderFilterChips();
    buildCatalog();
  })
  .catch(() => {
    root.innerHTML = `
      <div class="text-center py-24">
        <p class="font-display text-2xl text-[#1A1A1A] mb-3">No pudimos cargar el catálogo.</p>
        <p class="font-body text-sm text-[#777777] mb-8">Verifica tu conexión e intenta de nuevo.</p>
        <button onclick="location.reload()"
                class="inline-flex items-center gap-2 bg-primary hover:bg-[#C04868] text-white
                       font-body font-medium text-sm px-6 py-3 rounded-full transition-colors">
          Reintentar
        </button>
      </div>`;
  });

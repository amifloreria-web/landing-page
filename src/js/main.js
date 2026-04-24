/* ============================================================
   main.js — AMI Florería  (solo modo claro)
   ============================================================ */

/* ── CONFIGURACIÓN ─────────────────────────────────────────── */
// ⚠️  Reemplaza con el número real de WhatsApp de AMI (formato: 52XXXXXXXXXX)
const WA_NUMBER = '521234567890';

const WA_MESSAGES = {
  general:    'Hola AMI \uD83C\uDF38, vi su web y me gustar\u00EDa hacer un pedido.',
  ramos:      'Hola AMI \uD83C\uDF39, vi su web y me interesa un ramo de flores. \u00BFMe pueden ayudar?',
  funerario:  'Hola AMI, necesito informaci\u00F3n sobre arreglos f\u00FAnebres. Gracias.',
  especial:   'Hola AMI \uD83C\uDF89, me interesa un arreglo para una ocasi\u00F3n especial. \u00BFTienen disponibilidad?',
  eventos:    'Hola AMI, estoy planeando un evento y me interesa su servicio de decoraci\u00F3n floral.',
  suscripcion:'Hola AMI \uD83C\uDF3A, me interesa el servicio de suscripci\u00F3n floral. \u00BFMe dan m\u00E1s informaci\u00F3n?',
};

function buildWaUrl(msgKey) {
  const msg = WA_MESSAGES[msgKey] ?? WA_MESSAGES.general;
  return `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(msg)}`;
}

/* ── NAVBAR SCROLL EFFECT ──────────────────────────────────── */
function initNavbarScroll() {
  const navbar = document.getElementById('navbar');

  const observer = new IntersectionObserver(
    ([entry]) => {
      navbar.classList.toggle('scrolled', !entry.isIntersecting);
    },
    { threshold: 0, rootMargin: '-80px 0px 0px 0px' }
  );

  const hero = document.getElementById('hero');
  if (hero) observer.observe(hero);
}

/* ── MOBILE MENU ───────────────────────────────────────────── */
function initMobileMenu() {
  const toggle = document.getElementById('menu-toggle');
  const menu   = document.getElementById('mobile-menu');

  toggle.addEventListener('click', () => {
    const isOpen = !menu.classList.contains('hidden');
    menu.classList.toggle('hidden', isOpen);
    toggle.setAttribute('aria-expanded', String(!isOpen));
  });

  // Close on nav link click
  menu.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      menu.classList.add('hidden');
      toggle.setAttribute('aria-expanded', 'false');
    });
  });
}

/* ── WHATSAPP LINKS ────────────────────────────────────────── */
function initWhatsApp() {
  const generalUrl = buildWaUrl('general');

  // Floating button
  const floatBtn = document.getElementById('whatsapp-float');
  if (floatBtn) floatBtn.href = generalUrl;

  // Navbar CTA
  const navBtn = document.getElementById('nav-whatsapp');
  if (navBtn) navBtn.href = generalUrl;

  // Mobile menu link
  const mobileBtn = document.getElementById('mobile-whatsapp');
  if (mobileBtn) mobileBtn.href = generalUrl;

  // Dynamic: any element with data-wa="key" gets its WhatsApp URL assigned
  document.querySelectorAll('[data-wa]').forEach(el => {
    const key = el.dataset.wa;
    el.href = buildWaUrl(key);
  });
}

/* ── PRODUCTOS: TAB SWITCHER (Fase 2) ──────────────────────── */
function initProductTabs() {
  const buttons = document.querySelectorAll('.tab-btn');
  const panels  = document.querySelectorAll('.tab-panel');

  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;

      // Update buttons
      buttons.forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');

      // Update panels
      panels.forEach(panel => {
        const isTarget = panel.id === `tab-${target}`;
        panel.classList.toggle('hidden', !isTarget);
        // Re-trigger animation
        if (isTarget) {
          panel.style.animation = 'none';
          panel.offsetHeight; // reflow
          panel.style.animation = '';
        }
      });

      // Re-apply WhatsApp links to newly visible cards
      document.querySelectorAll('[data-wa]').forEach(el => {
        el.href = buildWaUrl(el.dataset.wa);
      });
    });
  });
}

/* ── TESTIMONIOS: CAROUSEL (Fase 4) ────────────────────────── */
function initCarousel() {
  const track   = document.getElementById('carousel-track');
  const dotsBox = document.getElementById('carousel-dots');
  const btnPrev = document.getElementById('carousel-prev');
  const btnNext = document.getElementById('carousel-next');
  if (!track) return;

  const cards      = Array.from(track.children);
  const total      = cards.length;
  let   current    = 0;
  let   autoTimer  = null;
  const AUTO_DELAY = 4500;

  /* Build dots */
  cards.forEach((_, i) => {
    const dot = document.createElement('button');
    dot.className = `carousel-dot${i === 0 ? ' active' : ''}`;
    dot.setAttribute('aria-label', `Ir al testimonio ${i + 1}`);
    dot.addEventListener('click', () => goTo(i));
    dotsBox.appendChild(dot);
  });

  function getCardWidth() {
    if (!cards[0]) return 0;
    const style = window.getComputedStyle(track);
    const gap   = parseFloat(style.gap) || 24;
    return cards[0].offsetWidth + gap;
  }

  function goTo(index) {
    current = (index + total) % total;
    track.style.transform = `translateX(-${current * getCardWidth()}px)`;
    dotsBox.querySelectorAll('.carousel-dot').forEach((d, i) => {
      d.classList.toggle('active', i === current);
    });
  }

  function next() { goTo(current + 1); }
  function prev() { goTo(current - 1); }

  function startAuto() {
    stopAuto();
    autoTimer = setInterval(next, AUTO_DELAY);
  }

  function stopAuto() {
    clearInterval(autoTimer);
  }

  btnNext.addEventListener('click', () => { next(); startAuto(); });
  btnPrev.addEventListener('click', () => { prev(); startAuto(); });

  /* Pause on hover */
  track.addEventListener('mouseenter', stopAuto);
  track.addEventListener('mouseleave', startAuto);

  /* Touch / swipe support */
  let touchStartX = 0;
  track.addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; }, { passive: true });
  track.addEventListener('touchend', e => {
    const diff = touchStartX - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 40) { diff > 0 ? next() : prev(); startAuto(); }
  }, { passive: true });

  /* Recalculate on resize */
  window.addEventListener('resize', () => goTo(current));

  startAuto();
}

/* ── FAQ: ACCORDION (Fase 5) ───────────────────────────────── */
function initFaq() {
  const accordion = document.getElementById('faq-accordion');
  if (!accordion) return;

  // First item is open by default (already set in HTML)

  accordion.querySelectorAll('.faq-trigger').forEach(trigger => {
    trigger.addEventListener('click', () => {
      const item   = trigger.closest('.faq-item');
      const isOpen = item.classList.contains('open');

      // Close all
      accordion.querySelectorAll('.faq-item').forEach(i => {
        i.classList.remove('open');
        i.querySelector('.faq-trigger').setAttribute('aria-expanded', 'false');
      });

      // Open clicked (unless it was already open)
      if (!isOpen) {
        item.classList.add('open');
        trigger.setAttribute('aria-expanded', 'true');
      }
    });
  });
}

/* ── INIT ──────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  initNavbarScroll();
  initMobileMenu();
  initWhatsApp();
  initProductTabs();
  initCarousel();
  initFaq();
});

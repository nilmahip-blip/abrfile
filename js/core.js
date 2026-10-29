/* ابزارهای مشترک: فرمت‌دهی، تم، Toast، دیالوگ، اعتبارسنجی فایل، کلیدهای مالکیت */
(function () {
  'use strict';
  const cfg = window.APP_CONFIG || {};
  const MAX_BYTES = (cfg.MAX_FILE_SIZE_MB || 50) * 1024 * 1024;
  const OWNED_KEY = 'abrfile:owned:v1';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const faNum = (n, opts) => Number(n || 0).toLocaleString('fa-IR', opts);

  function formatBytes(bytes) {
    const units = ['بایت', 'کیلوبایت', 'مگابایت', 'گیگابایت'];
    let i = 0, v = Number(bytes) || 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return `${faNum(v, { maximumFractionDigits: i === 0 ? 0 : 1 })} ${units[i]}`;
  }
  function formatDate(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('fa-IR', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch (e) { return String(iso); }
  }
  function timeLeft(iso) {
    const ms = new Date(iso).getTime() - Date.now();
    if (ms <= 0) return 'منقضی شده';
    const m = Math.floor(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
    if (d >= 1) return `${faNum(d)} روز${h % 24 ? ` و ${faNum(h % 24)} ساعت` : ''} دیگر`;
    if (h >= 1) return `${faNum(h)} ساعت${m % 60 ? ` و ${faNum(m % 60)} دقیقه` : ''} دیگر`;
    return `${faNum(Math.max(m, 1))} دقیقه دیگر`;
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  function getExt(name) {
    const m = /\.([a-z0-9]{1,10})$/i.exec(name || '');
    return m ? m[1].toLowerCase() : '';
  }

  /* ---------- آیکون و دسته‌بندی نوع فایل ---------- */
  const KINDS = [
    ['image', 'image', ['jpg', 'jpeg', 'png', 'gif', 'webp']],
    ['video', 'film', ['mp4', 'webm', 'mov']],
    ['audio', 'music', ['mp3', 'wav', 'ogg']],
    ['archive', 'archive', ['zip', 'rar', '7z']],
    ['sheet', 'sheet', ['xls', 'xlsx', 'csv']],
    ['slide', 'presentation', ['ppt', 'pptx']],
    ['code', 'braces', ['json']],
    ['pdf', 'file-text', ['pdf']],
    ['doc', 'file-text', ['doc', 'docx', 'txt', 'md']],
  ];
  const kindOf = ext => KINDS.find(k => k[2].includes(ext));
  const fileKind = ext => (kindOf(ext) || ['other'])[0];
  const fileIcon = ext => (kindOf(ext) || [null, 'file'])[1];

  /* ---------- بررسی امضای واقعی فایل (Magic Bytes) ---------- */
  const ascii = (h, a, b) => String.fromCharCode.apply(null, Array.from(h.slice(a, b)));
  const starts = (h, sig) => sig.every((v, i) => h[i] === v);
  const SIGNATURES = {
    jpg: h => starts(h, [0xFF, 0xD8, 0xFF]),
    png: h => starts(h, [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    gif: h => ascii(h, 0, 4) === 'GIF8',
    webp: h => ascii(h, 0, 4) === 'RIFF' && ascii(h, 8, 12) === 'WEBP',
    wav: h => ascii(h, 0, 4) === 'RIFF' && ascii(h, 8, 12) === 'WAVE',
    pdf: h => ascii(h, 0, 5) === '%PDF-',
    zip: h => h[0] === 0x50 && h[1] === 0x4B && [0x03, 0x05, 0x07].includes(h[2]),
    rar: h => ascii(h, 0, 4) === 'Rar!',
    '7z': h => starts(h, [0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C]),
    ole: h => starts(h, [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]),
    mp3: h => ascii(h, 0, 3) === 'ID3' || (h[0] === 0xFF && (h[1] & 0xE0) === 0xE0),
    ogg: h => ascii(h, 0, 4) === 'OggS',
    mp4: h => ascii(h, 4, 8) === 'ftyp',
    mov: h => ['ftyp', 'moov', 'mdat', 'wide', 'free', 'skip', 'pnot'].includes(ascii(h, 4, 8)),
    webm: h => starts(h, [0x1A, 0x45, 0xDF, 0xA3]),
  };
  const EXT_SIGNATURE = {
    jpg: 'jpg', jpeg: 'jpg', png: 'png', gif: 'gif', webp: 'webp', wav: 'wav', pdf: 'pdf',
    zip: 'zip', docx: 'zip', xlsx: 'zip', pptx: 'zip', rar: 'rar', '7z': '7z',
    doc: 'ole', xls: 'ole', ppt: 'ole', mp3: 'mp3', ogg: 'ogg', mp4: 'mp4', mov: 'mov', webm: 'webm',
  };
  // فایل‌های اجرایی که با پسوند متنی جا زده شده‌اند
  const EXECUTABLE = [
    h => ascii(h, 0, 2) === 'MZ',                       // Windows PE
    h => starts(h, [0x7F, 0x45, 0x4C, 0x46]),           // ELF
    h => starts(h, [0xCF, 0xFA, 0xED, 0xFE]) || starts(h, [0xCE, 0xFA, 0xED, 0xFE]), // Mach-O
  ];

  async function readHeader(file, n = 512) {
    return new Uint8Array(await file.slice(0, n).arrayBuffer());
  }

  /** اعتبارسنجی کامل یک فایل قبل از آپلود: حجم، پسوند، MIME و امضای محتوا */
  async function validateFile(file) {
    const fail = error => ({ ok: false, error });
    const allowed = cfg.ALLOWED_TYPES || {};
    const ext = getExt(file.name);
    if (!file.size) return fail('فایل خالی است.');
    if (file.size > MAX_BYTES) return fail(`حجم فایل (${formatBytes(file.size)}) بیشتر از سقف ${faNum(cfg.MAX_FILE_SIZE_MB)} مگابایت است.`);
    if (!ext) return fail('فایل بدون پسوند مجاز نیست.');
    if (!allowed[ext]) return fail(`فرمت ‎.${ext}‎ مجاز نیست.`);
    const mimes = allowed[ext];
    const reported = (file.type || '').toLowerCase();
    if (reported && reported !== 'application/octet-stream' && !mimes.includes(reported)) {
      return fail(`نوع MIME «${reported}» با پسوند ‎.${ext}‎ همخوانی ندارد.`);
    }
    let h;
    try { h = await readHeader(file); } catch (e) { return fail('خواندن فایل ممکن نشد.'); }
    const sig = EXT_SIGNATURE[ext];
    if (sig) {
      if (!SIGNATURES[sig](h)) return fail('محتوای فایل با پسوند آن همخوانی ندارد (امضای فایل نامعتبر است).');
    } else {
      const utf16 = starts(h, [0xFF, 0xFE]) || starts(h, [0xFE, 0xFF]);
      if (EXECUTABLE.some(fn => fn(h)) || (!utf16 && h.includes(0))) return fail('محتوای این فایل متنی نیست یا مشکوک است.');
    }
    return { ok: true, ext, mime: mimes[0], reported };
  }

  /* ---------- تم ---------- */
  function applyTheme(t) {
    const root = document.documentElement;
    root.classList.add('theme-anim');
    root.setAttribute('data-theme', t);
    try { localStorage.setItem('theme', t); } catch (e) { /* ignore */ }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'dark' ? '#0b1020' : '#f4f6fb');
    setTimeout(() => root.classList.remove('theme-anim'), 450);
  }
  const toggleTheme = () => applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');

  // Lucide به‌صورت async بارگذاری می‌شود تا کندی CDN جلوی اجرای برنامه را نگیرد؛
  // هر وقت رسید، آیکون‌های موجود در صفحه رندر می‌شوند.
  function refreshIcons() {
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      try { window.lucide.createIcons(); } catch (e) { /* offline / CDN issue: ignore */ }
    }
  }
  if (!window.lucide) {
    const tag = document.getElementById('lucide-cdn');
    if (tag) tag.addEventListener('load', refreshIcons, { once: true });
  }

  /* ---------- Toast ---------- */
  const TOAST_ICONS = { success: 'circle-check', error: 'circle-x', warning: 'triangle-alert', info: 'info' };
  function toast(message, type = 'info', timeout = 4200) {
    let box = $('#toasts');
    if (!box) {
      box = document.createElement('div');
      box.id = 'toasts'; box.className = 'toasts'; box.setAttribute('aria-live', 'polite');
      document.body.appendChild(box);
    }
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.innerHTML = `<span class="toast-icon"><i data-lucide="${TOAST_ICONS[type] || 'info'}"></i></span>
      <div class="toast-msg">${escapeHtml(message)}</div>
      <button class="toast-close" type="button" aria-label="بستن"><i data-lucide="x"></i></button>
      <span class="toast-timer" style="animation-duration:${timeout}ms"></span>`;
    box.appendChild(el);
    refreshIcons();
    while (box.children.length > 5) box.firstElementChild.remove();
    let timer;
    const close = () => {
      if (el.classList.contains('leaving')) return;
      clearTimeout(timer);
      el.classList.add('leaving');
      el.addEventListener('animationend', e => { if (e.target === el) el.remove(); });
      setTimeout(() => el.remove(), 600);
    };
    el.querySelector('.toast-close').addEventListener('click', close);
    timer = setTimeout(close, timeout);
    return close;
  }

  /* ---------- دیالوگ تأیید ---------- */
  function confirmDialog({ title, message, confirmText = 'تأیید', cancelText = 'انصراف', danger = false }) {
    return new Promise(resolve => {
      const wrap = document.createElement('div');
      wrap.className = 'modal-backdrop';
      wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
          <div class="modal-icon ${danger ? 'danger' : ''}"><i data-lucide="${danger ? 'trash-2' : 'info'}"></i></div>
          <h3 id="modalTitle">${escapeHtml(title)}</h3>
          <p>${escapeHtml(message)}</p>
          <div class="modal-actions">
            <button class="btn ghost" type="button" data-act="cancel">${escapeHtml(cancelText)}</button>
            <button class="btn ${danger ? 'danger' : 'primary'}" type="button" data-act="ok">${escapeHtml(confirmText)}</button>
          </div></div>`;
      document.body.appendChild(wrap);
      refreshIcons();
      const onKey = e => { if (e.key === 'Escape') done(false); };
      function done(v) {
        document.removeEventListener('keydown', onKey);
        wrap.classList.add('leaving');
        setTimeout(() => wrap.remove(), 220);
        resolve(v);
      }
      wrap.addEventListener('click', e => {
        if (e.target === wrap) return done(false);
        const a = e.target.closest('[data-act]');
        if (a) done(a.dataset.act === 'ok');
      });
      document.addEventListener('keydown', onKey);
      wrap.querySelector('[data-act="ok"]').focus();
    });
  }

  /* ---------- کلیپ‌بورد و لینک ---------- */
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;opacity:0;top:0';
      document.body.appendChild(ta); ta.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch (e2) { /* ignore */ }
      ta.remove(); return ok;
    }
  }
  function shareUrl(id) {
    const base = cfg.PUBLIC_BASE_URL ? cfg.PUBLIC_BASE_URL.replace(/\/+$/, '') + '/' : new URL('.', location.href).href;
    return `${base}file.html?id=${encodeURIComponent(id)}`;
  }

  /* ---------- کلیدهای مالکیت (برای داشبورد و حذف) ---------- */
  function getOwned() {
    try {
      const v = JSON.parse(localStorage.getItem(OWNED_KEY) || '[]');
      return Array.isArray(v) ? v.filter(x => x && typeof x.id === 'string' && typeof x.token === 'string') : [];
    } catch (e) { return []; }
  }
  function saveOwned(list) { try { localStorage.setItem(OWNED_KEY, JSON.stringify(list.slice(0, 200))); } catch (e) { /* ignore */ } }
  function addOwned(entry) { saveOwned([entry].concat(getOwned().filter(x => x.id !== entry.id))); }
  function removeOwned(id) { saveOwned(getOwned().filter(x => x.id !== id)); }

  /* ---------- هدر / فوتر / بنر دمو ---------- */
  function renderChrome() {
    const page = document.body.dataset.page;
    const header = $('#appHeader');
    if (header) {
      header.className = 'topbar';
      header.innerHTML = `
        <a class="brand" href="index.html"><span class="brand-logo"><i data-lucide="cloud-upload"></i></span><span class="brand-name">${escapeHtml(cfg.APP_NAME || 'ابرفایل')}</span></a>
        <nav class="nav" aria-label="منوی اصلی">
          <a href="index.html" class="nav-link ${page === 'upload' ? 'active' : ''}"><i data-lucide="upload"></i><span>آپلود</span></a>
          <a href="dashboard.html" class="nav-link ${page === 'dashboard' ? 'active' : ''}"><i data-lucide="layout-dashboard"></i><span>فایل‌های من</span></a>
          <button class="icon-btn theme-toggle" id="themeToggle" type="button" aria-label="تغییر حالت روشن/تاریک" title="حالت روشن/تاریک">
            <i data-lucide="moon" class="i-moon"></i><i data-lucide="sun" class="i-sun"></i>
          </button>
        </nav>`;
      $('#themeToggle').addEventListener('click', toggleTheme);
    }
    if (window.Api && window.Api.isDemo) {
      const b = document.createElement('div');
      b.className = 'demo-banner';
      b.innerHTML = `<i data-lucide="flask-conical"></i><span><b>حالت دمو:</b> هنوز به Supabase وصل نشده‌اید؛ فایل‌ها فقط در همین مرورگر ذخیره می‌شوند. برای اتصال به سرور ابری، <code>js/config.js</code> را تنظیم کنید.</span>`;
      if (header) header.after(b); else document.body.prepend(b);
    }
    const footer = $('#appFooter');
    if (footer) {
      footer.className = 'footer';
      footer.innerHTML = `<span><i data-lucide="shield-check"></i> ذخیره‌سازی امن روی ${window.Api && window.Api.isDemo ? 'مرورگر (حالت دمو)' : 'Supabase Storage'}</span>
        <span>حداکثر ${faNum(cfg.MAX_FILE_SIZE_MB)} مگابایت برای هر فایل</span>`;
    }
    refreshIcons();
  }
  document.addEventListener('DOMContentLoaded', renderChrome);

  window.App = {
    cfg, $, $$, faNum, formatBytes, formatDate, timeLeft, escapeHtml, uuid, getExt,
    fileKind, fileIcon, validateFile, applyTheme, toggleTheme, refreshIcons, toast, confirmDialog,
    copyText, shareUrl, getOwned, saveOwned, addOwned, removeOwned,
  };
})();

/* صفحه اختصاصی هر فایل: اطلاعات، رمز عبور، شمارش معکوس و دانلود */
(function () {
  'use strict';
  const cfg = window.APP_CONFIG;
  const { $, escapeHtml, formatBytes, formatDate, faNum, fileIcon, fileKind, getExt, toast, refreshIcons, timeLeft } = window.App;
  let info = null, shareId = null, counting = false;

  document.addEventListener('DOMContentLoaded', () => {
    shareId = new URLSearchParams(location.search).get('id');
    if (!shareId || !/^[A-Za-z0-9]{6,32}$/.test(shareId)) {
      renderError('لینک نامعتبر است', 'شناسه فایل در آدرس وجود ندارد یا اشتباه است.');
      return;
    }
    load();
  });

  async function load() {
    renderSkeleton();
    try { info = await window.Api.getInfo(shareId); } catch (err) {
      renderError('خطا در دریافت اطلاعات', window.Api.messageFor(err && err.code), true);
      return;
    }
    if (!info) { renderError('فایل پیدا نشد', 'این فایل وجود ندارد یا توسط صاحبش حذف شده است.'); return; }
    document.title = `${info.name} — ${cfg.APP_NAME}`;
    render();
  }

  function renderSkeleton() {
    $('#fileCard').innerHTML = `<div class="skeleton-wrap">
      <div class="sk sk-circle"></div><div class="sk sk-line w60"></div><div class="sk sk-line w40"></div>
      <div class="stats-grid">${'<div class="sk sk-box"></div>'.repeat(4)}</div><div class="sk sk-btn"></div></div>`;
  }

  function renderError(title, msg, retry) {
    $('#fileCard').innerHTML = `<div class="empty">
      <div class="empty-icon danger"><i data-lucide="circle-x"></i></div>
      <h2>${escapeHtml(title)}</h2><p class="muted">${escapeHtml(msg)}</p>
      <div class="row-center">${retry ? '<button class="btn ghost" id="retryBtn" type="button"><i data-lucide="refresh-cw"></i><span>تلاش دوباره</span></button>' : ''}
      <a class="btn primary" href="index.html"><i data-lucide="upload"></i><span>آپلود فایل جدید</span></a></div></div>`;
    const r = $('#retryBtn'); if (r) r.addEventListener('click', load);
    refreshIcons();
  }

  const stat = (icon, label, value) => `<div class="stat"><span class="stat-ico"><i data-lucide="${icon}"></i></span><div><small>${label}</small><b>${value}</b></div></div>`;

  function render() {
    const ext = getExt(info.name);
    const blocked = info.is_expired ? 'EXPIRED' : (info.limit_reached ? 'LIMIT_REACHED' : null);
    const expiryText = info.expires_at ? (info.is_expired ? 'منقضی شده' : timeLeft(info.expires_at)) : 'بدون انقضا';
    $('#fileCard').innerHTML = `
      <div class="file-hero">
        <div class="file-icon kind-${fileKind(ext)}"><i data-lucide="${fileIcon(ext)}"></i>${info.has_password ? '<span class="lock-badge" title="رمزدار"><i data-lucide="lock"></i></span>' : ''}</div>
        <h1 class="file-name" title="${escapeHtml(info.name)}">${escapeHtml(info.name)}</h1>
        <div class="chips"><span class="chip">${escapeHtml(ext ? ext.toUpperCase() : 'FILE')}</span><span class="chip mono" dir="ltr">${escapeHtml(info.mime)}</span></div>
      </div>
      <div class="stats-grid">
        ${stat('hard-drive', 'حجم', formatBytes(info.size))}
        ${stat('calendar', 'تاریخ آپلود', formatDate(info.created_at))}
        ${stat('download', 'تعداد دانلود', `<span id="dlCount">${faNum(info.download_count)}</span>${info.max_downloads ? ` از ${faNum(info.max_downloads)}` : ''}`)}
        ${stat('timer', 'انقضا', expiryText)}
      </div>
      ${blocked ? `<div class="alert alert-error"><i data-lucide="ban"></i><span>${window.Api.messageFor(blocked)}</span></div>` : `
        ${info.has_password ? `
          <label class="field pw-field">
            <span class="field-label"><i data-lucide="lock"></i> این فایل با رمز عبور محافظت شده است</span>
            <span class="input-wrap">
              <input type="password" id="dlPassword" placeholder="رمز عبور را وارد کنید" autocomplete="off" maxlength="128">
              <button type="button" class="icon-btn sm" id="dlTogglePw" aria-label="نمایش رمز"><i data-lucide="eye"></i></button>
            </span>
          </label>` : ''}
        <button class="btn primary xl download-btn" id="downloadBtn" type="button"><i data-lucide="download"></i><span class="label">دانلود فایل</span></button>
        <button class="btn link-btn" id="cancelCountdown" type="button" hidden>لغو</button>`}
      <div class="share-row">
        <button class="btn ghost sm" id="copyLinkBtn" type="button"><i data-lucide="copy"></i><span>کپی لینک این صفحه</span></button>
        ${navigator.share ? '<button class="btn ghost sm" id="nativeShareBtn" type="button"><i data-lucide="share-2"></i><span>اشتراک‌گذاری</span></button>' : ''}
      </div>`;
    refreshIcons();
    bind();
  }

  function bind() {
    const dl = $('#downloadBtn');
    if (dl) dl.addEventListener('click', onDownloadClick);
    const cancel = $('#cancelCountdown');
    if (cancel) cancel.addEventListener('click', stopCountdown);
    const pw = $('#dlPassword');
    if (pw) {
      pw.addEventListener('keydown', e => { if (e.key === 'Enter') onDownloadClick(); });
      $('#dlTogglePw').addEventListener('click', e => {
        const show = pw.type === 'password';
        pw.type = show ? 'text' : 'password';
        e.currentTarget.innerHTML = `<i data-lucide="${show ? 'eye-off' : 'eye'}"></i>`; refreshIcons();
      });
    }
    $('#copyLinkBtn').addEventListener('click', async () => {
      if (await window.App.copyText(location.href)) toast('لینک کپی شد.', 'success');
    });
    const ns = $('#nativeShareBtn');
    if (ns) ns.addEventListener('click', () => navigator.share({ title: info.name, url: location.href }).catch(() => {}));
  }

  function shake(el) {
    if (!el) return;
    el.closest('.input-wrap').classList.remove('shake'); void el.offsetWidth;
    el.closest('.input-wrap').classList.add('shake');
  }

  function setBtn(state, label) {
    const btn = $('#downloadBtn'); if (!btn) return;
    const icons = { idle: 'download', loading: 'loader-circle', success: 'circle-check', counting: 'timer' };
    btn.className = `btn primary xl download-btn ${state}`;
    btn.disabled = state === 'loading' || state === 'counting';
    btn.innerHTML = `<i data-lucide="${icons[state]}" class="${state === 'loading' ? 'spin' : ''}"></i><span class="label">${escapeHtml(label)}</span>`;
    refreshIcons();
  }

  function onDownloadClick() {
    if (counting) return;
    const btn = $('#downloadBtn'); if (!btn || btn.disabled) return;
    const pw = $('#dlPassword');
    if (pw && !pw.value) { shake(pw); pw.focus(); toast(window.Api.messageFor('PASSWORD_REQUIRED'), 'warning'); return; }
    const secs = Number(cfg.DOWNLOAD_COUNTDOWN_SECONDS) || 0;
    if (secs <= 0) { doDownload(); return; }
    startCountdown(secs);
  }

  let countdownTimer = null;
  function startCountdown(secs) {
    counting = true;
    const cancel = $('#cancelCountdown'); cancel.hidden = false;
    const total = secs * 1000, start = Date.now();
    let lastShown = -1;
    setBtn('counting', '');
    const btn = $('#downloadBtn');
    // setInterval (نه requestAnimationFrame) تا در تب پس‌زمینه هم شمارش ادامه یابد
    const tick = () => {
      if (!counting) return;
      const elapsed = Date.now() - start;
      const left = Math.max(0, total - elapsed);
      btn.style.setProperty('--p', `${Math.min(100, (elapsed / total) * 100)}%`);
      const s = Math.ceil(left / 1000);
      if (s !== lastShown) { lastShown = s; btn.querySelector('.label').textContent = `دانلود تا ${faNum(s)} ثانیه دیگر…`; }
      if (left <= 0) { clearInterval(countdownTimer); counting = false; cancel.hidden = true; doDownload(); }
    };
    tick();
    countdownTimer = setInterval(tick, 100);
  }

  function stopCountdown() {
    counting = false;
    clearInterval(countdownTimer);
    const c = $('#cancelCountdown'); if (c) c.hidden = true;
    const btn = $('#downloadBtn'); if (btn) btn.style.removeProperty('--p');
    setBtn('idle', 'دانلود فایل');
  }

  function triggerDownload(url, name) {
    const a = document.createElement('a');
    a.href = url; a.download = name || ''; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
  }

  async function doDownload() {
    const pw = $('#dlPassword');
    const btn = $('#downloadBtn'); if (btn) btn.style.removeProperty('--p');
    setBtn('loading', 'در حال آماده‌سازی لینک امن…');
    try {
      const res = await window.Api.download(shareId, pw ? pw.value : null);
      triggerDownload(res.url, res.name);
      if (res.objectUrl) setTimeout(() => URL.revokeObjectURL(res.url), 60000);
      info.download_count = typeof res.download_count === 'number' ? res.download_count : info.download_count + 1;
      const c = $('#dlCount');
      if (c) { c.textContent = faNum(info.download_count); c.classList.remove('bump'); void c.offsetWidth; c.classList.add('bump'); }
      setBtn('success', 'دانلود شروع شد');
      toast('دانلود شروع شد.', 'success');
      if (info.max_downloads && info.download_count >= info.max_downloads) { info.limit_reached = true; setTimeout(render, 2500); return; }
      setTimeout(() => setBtn('idle', 'دانلود دوباره'), 2500);
    } catch (err) {
      const code = err && err.code;
      toast(window.Api.messageFor(code), 'error');
      if (code === 'WRONG_PASSWORD' || code === 'PASSWORD_REQUIRED') { setBtn('idle', 'دانلود فایل'); shake(pw); if (pw) { pw.select(); pw.focus(); } return; }
      if (code === 'EXPIRED' || code === 'LIMIT_REACHED' || code === 'NOT_FOUND') { load(); return; }
      setBtn('idle', 'تلاش دوباره');
    }
  }
})();

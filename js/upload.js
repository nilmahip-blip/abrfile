/* صفحه آپلود: Drag & Drop، صف چندفایلی، اعتبارسنجی، Progress و لینک اشتراک */
(function () {
  'use strict';
  const cfg = window.APP_CONFIG;
  const { $, $$, escapeHtml, formatBytes, formatDate, faNum, fileIcon, fileKind, getExt, toast, refreshIcons } = window.App;
  const queue = [];
  let busy = false;
  let els = {};

  const STATUS = {
    checking: ['loader-circle', 'در حال بررسی…'],
    ready: ['circle-dot', 'آماده آپلود'],
    uploading: ['loader-circle', 'در حال آپلود…'],
    registering: ['loader-circle', 'در حال ثبت روی سرور…'],
    done: ['circle-check', 'آپلود شد'],
    error: ['circle-alert', 'خطا'],
    invalid: ['circle-alert', 'نامعتبر'],
    cancelled: ['ban', 'لغو شد'],
  };

  document.addEventListener('DOMContentLoaded', () => {
    els = {
      dz: $('#dropzone'), input: $('#fileInput'), list: $('#queueList'), section: $('#queueSection'),
      count: $('#queueCount'), uploadBtn: $('#uploadBtn'), clearBtn: $('#clearBtn'), copyAllBtn: $('#copyAllBtn'),
      total: $('#totalProgress'), totalText: $('#totalText'),
      pw: $('#optPassword'), expiry: $('#optExpiry'), maxDl: $('#optMaxDl'),
    };
    $$('[data-max-size]').forEach(e => { e.textContent = `${faNum(cfg.MAX_FILE_SIZE_MB)} مگابایت`; });
    const exts = Object.keys(cfg.ALLOWED_TYPES);
    $('#allowedHint').textContent = 'فرمت‌های مجاز: ' + exts.join('، ');
    els.input.accept = exts.map(e => '.' + e).join(',');

    bindDropzone();
    els.uploadBtn.addEventListener('click', startUpload);
    els.clearBtn.addEventListener('click', clearQueue);
    els.copyAllBtn.addEventListener('click', copyAll);
    els.list.addEventListener('click', onListClick);
    $('#togglePw').addEventListener('click', e => {
      const show = els.pw.type === 'password';
      els.pw.type = show ? 'text' : 'password';
      e.currentTarget.innerHTML = `<i data-lucide="${show ? 'eye-off' : 'eye'}"></i>`;
      refreshIcons();
    });
    syncUi();
  });

  /* ---------- Drag & Drop / انتخاب / Paste ---------- */
  const hasFiles = e => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  function bindDropzone() {
    const dz = els.dz;
    let depth = 0;
    const reset = () => { depth = 0; document.body.classList.remove('dragging'); dz.classList.remove('over'); };
    dz.addEventListener('click', () => els.input.click());
    dz.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); els.input.click(); } });
    els.input.addEventListener('change', () => { addFiles(els.input.files); els.input.value = ''; });
    window.addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); depth++; document.body.classList.add('dragging'); });
    window.addEventListener('dragover', e => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      dz.classList.toggle('over', dz.contains(e.target));
    });
    window.addEventListener('dragleave', e => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) reset(); });
    window.addEventListener('drop', e => { if (!hasFiles(e)) return; e.preventDefault(); reset(); addFiles(e.dataTransfer.files); });
    window.addEventListener('paste', e => {
      const files = Array.from((e.clipboardData && e.clipboardData.files) || []);
      if (files.length) { addFiles(files); toast(`${faNum(files.length)} فایل از کلیپ‌بورد اضافه شد.`, 'info'); }
    });
  }

  /* ---------- افزودن و اعتبارسنجی ---------- */
  async function addFiles(fileList) {
    let files = Array.from(fileList || []);
    if (!files.length) return;
    const active = queue.filter(q => ['checking', 'ready', 'uploading', 'registering'].includes(q.status)).length;
    const room = cfg.MAX_FILES_PER_BATCH - active;
    if (room <= 0) return toast(`حداکثر ${faNum(cfg.MAX_FILES_PER_BATCH)} فایل در هر نوبت قابل آپلود است.`, 'warning');
    if (files.length > room) {
      toast(`فقط ${faNum(room)} فایل اول اضافه شد (حداکثر ${faNum(cfg.MAX_FILES_PER_BATCH)} فایل در هر نوبت).`, 'warning');
      files = files.slice(0, room);
    }
    const added = [];
    for (const file of files) {
      const dup = queue.some(q => q.status !== 'done' && q.file.name === file.name && q.file.size === file.size && q.file.lastModified === file.lastModified);
      if (dup) { toast(`«${file.name}» قبلاً به صف اضافه شده است.`, 'info'); continue; }
      const item = { id: window.App.uuid(), file, status: 'checking', progress: 0, loaded: 0 };
      queue.push(item); added.push(item); mountItem(item);
    }
    syncUi();
    await Promise.all(added.map(async item => {
      const v = await window.App.validateFile(item.file);
      if (item.status === 'removed') return;
      if (v.ok) {
        item.meta = v; item.status = 'ready';
        if (/^(jpe?g|png|gif|webp)$/.test(v.ext)) item.preview = URL.createObjectURL(item.file);
      } else {
        item.status = 'invalid'; item.error = v.error;
        toast(`${item.file.name}: ${v.error}`, 'error', 6000);
      }
      renderItem(item);
    }));
    syncUi();
  }

  /* ---------- رندر آیتم‌های صف ---------- */
  function mountItem(item) {
    const li = document.createElement('li');
    li.className = 'q-item enter';
    li.dataset.id = item.id;
    item.el = li;
    els.list.appendChild(li);
    renderItem(item);
  }
  const actBtn = (act, icon, label, cls = '') => `<button class="icon-btn sm ${cls}" type="button" data-act="${act}" aria-label="${label}" title="${label}"><i data-lucide="${icon}"></i></button>`;

  function renderItem(item) {
    const li = item.el; if (!li) return;
    const f = item.file, ext = getExt(f.name);
    const st = STATUS[item.status] || STATUS.ready;
    li.dataset.status = item.status;
    const icon = item.preview ? `<img src="${item.preview}" alt="">` : `<i data-lucide="${fileIcon(ext)}"></i>`;
    const mime = item.meta ? item.meta.mime : (f.type || 'نامشخص');
    const statusText = (item.status === 'invalid' || item.status === 'error') ? item.error : st[1];

    let actions = '';
    if (item.status === 'uploading') actions = actBtn('cancel', 'square', 'لغو آپلود', 'danger');
    else if (item.status === 'done') actions = actBtn('dismiss', 'x', 'بستن');
    else if (['error', 'cancelled'].includes(item.status)) actions = actBtn('retry', 'rotate-ccw', 'تلاش دوباره') + actBtn('remove', 'x', 'حذف از صف');
    else if (['ready', 'invalid'].includes(item.status)) actions = actBtn('remove', 'x', 'حذف از صف');

    const showBar = ['uploading', 'registering', 'done'].includes(item.status);
    const link = item.status === 'done' ? window.App.shareUrl(item.result.share_id) : '';
    li.innerHTML = `
      <div class="q-icon kind-${fileKind(ext)}">${icon}</div>
      <div class="q-body">
        <div class="q-top">
          <span class="q-name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span>
          <span class="q-size">${formatBytes(f.size)}</span>
        </div>
        <div class="q-meta">
          <span class="chip">${escapeHtml((ext || '?').toUpperCase())}</span>
          <span class="chip mono" dir="ltr">${escapeHtml(mime)}</span>
          <span class="q-status"><i data-lucide="${st[0]}" class="${st[0] === 'loader-circle' ? 'spin' : ''}"></i><span>${escapeHtml(statusText)}</span></span>
        </div>
        ${showBar ? `<div class="progress ${item.status === 'done' ? 'complete' : ''}"><span style="width:${(item.progress * 100).toFixed(1)}%"></span></div>` : ''}
        ${item.status === 'uploading' ? `<div class="q-progress-info"><span class="q-pct">${faNum(Math.round(item.progress * 100))}٪</span><span class="q-speed"></span></div>` : ''}
        ${item.status === 'done' ? `
          <div class="q-result">
            <div class="link-box">
              <i data-lucide="link"></i>
              <input class="link-input" dir="ltr" readonly value="${escapeHtml(link)}" aria-label="لینک دانلود">
              <button class="btn sm primary" type="button" data-act="copy"><i data-lucide="copy"></i><span>کپی</span></button>
              <a class="btn sm ghost" href="${escapeHtml(link)}" target="_blank" rel="noopener"><i data-lucide="external-link"></i><span>باز کردن</span></a>
            </div>
            <div class="q-tags">
              ${item.result.expires_at ? `<span class="chip"><i data-lucide="timer"></i> انقضا: ${formatDate(item.result.expires_at)}</span>` : ''}
              ${item.opts && item.opts.password ? '<span class="chip"><i data-lucide="lock"></i> رمزدار</span>' : ''}
              ${item.opts && item.opts.maxDownloads ? `<span class="chip"><i data-lucide="download"></i> حداکثر ${faNum(item.opts.maxDownloads)} دانلود</span>` : ''}
            </div>
          </div>` : ''}
      </div>
      <div class="q-actions">${actions}</div>`;
    refreshIcons();
  }

  function updateProgress(item) {
    const li = item.el; if (!li) return;
    const bar = li.querySelector('.progress > span');
    if (bar) bar.style.width = `${(item.progress * 100).toFixed(1)}%`;
    const pct = li.querySelector('.q-pct');
    if (pct) pct.textContent = `${faNum(Math.round(item.progress * 100))}٪`;
    const sp = li.querySelector('.q-speed');
    if (sp && item.startedAt) {
      const secs = (performance.now() - item.startedAt) / 1000;
      if (secs > 0.3 && item.loaded > 0) {
        const speed = item.loaded / secs;
        const eta = Math.max(0, (item.file.size - item.loaded) / speed);
        sp.textContent = `${formatBytes(speed)}/ثانیه · ${faNum(Math.ceil(eta))} ثانیه مانده`;
      }
    }
  }

  function syncUi() {
    const visible = queue.filter(q => q.status !== 'removed');
    els.section.hidden = visible.length === 0;
    els.count.textContent = faNum(visible.length);
    const ready = queue.filter(q => q.status === 'ready').length;
    els.uploadBtn.disabled = busy || ready === 0;
    els.uploadBtn.querySelector('span').textContent = busy ? 'در حال آپلود…' : (ready ? `آپلود ${faNum(ready)} فایل` : 'آپلود');
    els.uploadBtn.classList.toggle('loading', busy);
    els.clearBtn.disabled = busy;
    els.copyAllBtn.hidden = queue.filter(q => q.status === 'done').length < 2;
  }

  function removeItem(item) {
    item.status = 'removed';
    if (item.preview) URL.revokeObjectURL(item.preview);
    const li = item.el;
    const idx = queue.indexOf(item);
    if (idx >= 0) queue.splice(idx, 1);
    if (li) { li.classList.add('leaving'); setTimeout(() => li.remove(), 260); }
    syncUi();
  }

  function clearQueue() {
    queue.filter(q => !['uploading', 'registering'].includes(q.status)).forEach(removeItem);
  }

  async function copyAll() {
    const links = queue.filter(q => q.status === 'done').map(q => `${q.file.name}: ${window.App.shareUrl(q.result.share_id)}`);
    if (await window.App.copyText(links.join('\n'))) toast(`${faNum(links.length)} لینک کپی شد.`, 'success');
  }

  async function onListClick(e) {
    if (e.target.classList.contains('link-input')) { e.target.select(); return; }
    const b = e.target.closest('[data-act]'); if (!b) return;
    const li = b.closest('.q-item');
    const item = queue.find(q => q.id === li.dataset.id); if (!item) return;
    switch (b.dataset.act) {
      case 'remove': case 'dismiss': removeItem(item); break;
      case 'cancel': if (item.controller) item.controller.abort(); break;
      case 'retry': item.status = 'ready'; item.error = null; item.progress = 0; renderItem(item); syncUi(); break;
      case 'copy':
        if (await window.App.copyText(window.App.shareUrl(item.result.share_id))) {
          toast('لینک دانلود کپی شد.', 'success');
          b.classList.add('copied');
          b.innerHTML = '<i data-lucide="check"></i><span>کپی شد</span>'; refreshIcons();
          setTimeout(() => { b.classList.remove('copied'); b.innerHTML = '<i data-lucide="copy"></i><span>کپی</span>'; refreshIcons(); }, 1800);
        } else toast('کپی خودکار ممکن نشد؛ لینک را دستی کپی کنید.', 'warning');
        break;
    }
  }

  /* ---------- آپلود ---------- */
  function readOptions() {
    const password = els.pw.value;
    if (password && (password.length < 4 || password.length > 128)) throw new Error('رمز عبور باید بین ۴ تا ۱۲۸ کاراکتر باشد.');
    const expiresInHours = parseInt(els.expiry.value, 10) || null;
    let maxDownloads = null;
    if (els.maxDl.value !== '') {
      maxDownloads = Number(els.maxDl.value);
      if (!Number.isInteger(maxDownloads) || maxDownloads < 1 || maxDownloads > 10000) throw new Error('حداکثر دانلود باید عددی صحیح بین ۱ تا ۱۰٬۰۰۰ باشد.');
    }
    return { password: password || null, expiresInHours, maxDownloads };
  }

  async function startUpload() {
    if (busy) return;
    let opts;
    try { opts = readOptions(); } catch (err) { $('#optionsPanel').open = true; toast(err.message, 'warning'); return; }
    const batch = queue.filter(q => q.status === 'ready');
    if (!batch.length) return;
    busy = true; syncUi();
    const totalBytes = batch.reduce((s, q) => s + q.file.size, 0) || 1;
    els.total.hidden = false;
    const updateTotal = () => {
      const loaded = batch.reduce((s, q) => s + (q.status === 'done' ? q.file.size : (q.loaded || 0)), 0);
      const p = Math.min(1, loaded / totalBytes);
      els.total.querySelector('.progress > span').style.width = `${(p * 100).toFixed(1)}%`;
      const done = batch.filter(q => q.status === 'done').length;
      els.totalText.textContent = `${faNum(Math.round(p * 100))}٪ — ${formatBytes(loaded)} از ${formatBytes(totalBytes)} · ${faNum(done)} از ${faNum(batch.length)} فایل`;
    };
    updateTotal();
    let next = 0;
    const worker = async () => {
      while (next < batch.length) {
        const item = batch[next++];
        if (item.status !== 'ready') continue;
        await uploadOne(item, opts, updateTotal);
        updateTotal();
      }
    };
    await Promise.all(Array.from({ length: Math.min(cfg.PARALLEL_UPLOADS || 3, batch.length) }, worker));
    busy = false;
    const ok = batch.filter(q => q.status === 'done').length;
    const failed = batch.filter(q => q.status === 'error').length;
    if (ok) toast(`${faNum(ok)} فایل با موفقیت آپلود شد 🎉`, 'success');
    if (failed) toast(`${faNum(failed)} فایل آپلود نشد.`, 'error');
    if (ok && opts.password) toast('یادتان باشد رمز عبور را جداگانه برای گیرنده بفرستید.', 'info', 6000);
    setTimeout(() => { if (!busy) els.total.hidden = true; }, 2000);
    syncUi();
  }

  async function uploadOne(item, opts, onTotal) {
    item.status = 'uploading'; item.progress = 0; item.loaded = 0; item.opts = opts;
    item.startedAt = performance.now();
    item.controller = new AbortController();
    renderItem(item);
    try {
      const res = await window.Api.upload(item.file, item.meta, opts, (p, loaded) => {
        item.progress = p; item.loaded = loaded;
        if (p >= 1 && item.status === 'uploading') { item.status = 'registering'; renderItem(item); }
        else updateProgress(item);
        onTotal();
      }, item.controller.signal);
      if (!res || !res.share_id) throw new window.Api.ApiError('SERVER_ERROR');
      item.status = 'done'; item.progress = 1; item.result = res;
      window.App.addOwned({ id: res.share_id, token: res.owner_token, name: item.file.name, created_at: new Date().toISOString() });
    } catch (err) {
      if (err && err.code === 'ABORTED') { item.status = 'cancelled'; item.loaded = 0; item.progress = 0; }
      else { item.status = 'error'; item.error = window.Api.messageFor(err && err.code); console.error(err); }
    } finally { item.controller = null; }
    renderItem(item);
    if (item.status === 'done') item.el.classList.add('success-pop');
    syncUi();
  }
})();

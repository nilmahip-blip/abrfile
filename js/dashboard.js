/* داشبورد: فهرست فایل‌های آپلودشده از این مرورگر، آمار دانلود و حذف */
(function () {
  'use strict';
  const { $, escapeHtml, formatBytes, formatDate, faNum, fileIcon, fileKind, getExt, toast, refreshIcons, timeLeft } = window.App;
  let files = [];
  const state = { q: '', sort: 'new' };

  document.addEventListener('DOMContentLoaded', () => {
    $('#search').addEventListener('input', e => { state.q = e.target.value.trim().toLowerCase(); renderList(); });
    $('#sort').addEventListener('change', e => { state.sort = e.target.value; renderList(); });
    $('#refreshBtn').addEventListener('click', load);
    $('#exportBtn').addEventListener('click', exportKeys);
    $('#importInput').addEventListener('change', importKeys);
    $('#fileList').addEventListener('click', onListClick);
    load();
  });

  async function load() {
    const owned = window.App.getOwned();
    if (!owned.length) { files = []; renderStats(); renderList(); return; }
    renderSkeleton();
    try {
      files = (await window.Api.listOwned(owned.map(o => ({ id: o.id, token: o.token })))) || [];
    } catch (err) {
      $('#fileList').innerHTML = `<div class="empty"><div class="empty-icon danger"><i data-lucide="circle-x"></i></div><h3>خطا در دریافت فهرست</h3><p class="muted">${escapeHtml(window.Api.messageFor(err && err.code))}</p></div>`;
      refreshIcons(); return;
    }
    const alive = new Set(files.map(f => f.share_id));
    const gone = owned.filter(o => !alive.has(o.id));
    if (gone.length) {
      window.App.saveOwned(owned.filter(o => alive.has(o.id)));
      toast(`${faNum(gone.length)} فایل حذف‌شده یا پاک‌شده از فهرست برداشته شد.`, 'info');
    }
    renderStats(); renderList();
  }

  function renderSkeleton() {
    $('#fileList').innerHTML = '<div class="sk sk-row"></div>'.repeat(3);
  }

  function renderStats() {
    const total = files.length;
    const size = files.reduce((s, f) => s + Number(f.size || 0), 0);
    const downloads = files.reduce((s, f) => s + Number(f.download_count || 0), 0);
    const active = files.filter(f => !f.is_expired && !f.limit_reached).length;
    const card = (icon, label, value, cls) => `<div class="stat-card ${cls}"><span class="stat-ico"><i data-lucide="${icon}"></i></span><div><small>${label}</small><b>${value}</b></div></div>`;
    $('#stats').innerHTML =
      card('files', 'تعداد فایل‌ها', faNum(total), 'c1') +
      card('hard-drive', 'حجم کل', formatBytes(size), 'c2') +
      card('download', 'مجموع دانلودها', faNum(downloads), 'c3') +
      card('link', 'لینک‌های فعال', faNum(active), 'c4');
    refreshIcons();
  }

  function statusOf(f) {
    if (f.is_expired) return ['expired', 'منقضی', 'clock'];
    if (f.limit_reached) return ['limit', 'سقف دانلود پر', 'ban'];
    return ['active', 'فعال', 'circle-check'];
  }

  function sorted() {
    let list = files.filter(f => !state.q || f.name.toLowerCase().includes(state.q));
    const by = {
      new: (a, b) => String(b.created_at).localeCompare(String(a.created_at)),
      downloads: (a, b) => b.download_count - a.download_count,
      size: (a, b) => b.size - a.size,
      name: (a, b) => a.name.localeCompare(b.name, 'fa'),
    }[state.sort];
    return list.sort(by);
  }

  function renderList() {
    const box = $('#fileList');
    if (!files.length) {
      box.innerHTML = `<div class="empty"><div class="empty-icon"><i data-lucide="inbox"></i></div>
        <h3>هنوز فایلی آپلود نکرده‌اید</h3><p class="muted">فایل‌هایی که از این مرورگر آپلود کنید اینجا نمایش داده می‌شوند.</p>
        <a class="btn primary" href="index.html"><i data-lucide="upload"></i><span>اولین فایل را آپلود کنید</span></a></div>`;
      refreshIcons(); return;
    }
    const list = sorted();
    if (!list.length) { box.innerHTML = '<div class="empty compact"><p class="muted">نتیجه‌ای پیدا نشد.</p></div>'; return; }
    const maxDl = Math.max(1, ...files.map(f => f.download_count));
    box.innerHTML = list.map(f => {
      const ext = getExt(f.name);
      const [cls, label, icon] = statusOf(f);
      const url = window.App.shareUrl(f.share_id);
      return `<article class="f-row" data-id="${escapeHtml(f.share_id)}">
        <div class="q-icon kind-${fileKind(ext)}"><i data-lucide="${fileIcon(ext)}"></i></div>
        <div class="f-main">
          <a class="f-name" href="${escapeHtml(url)}" target="_blank" rel="noopener" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</a>
          <div class="f-meta">
            <span><i data-lucide="hard-drive"></i>${formatBytes(f.size)}</span>
            <span><i data-lucide="calendar"></i>${formatDate(f.created_at)}</span>
            ${f.expires_at && !f.is_expired ? `<span><i data-lucide="timer"></i>${timeLeft(f.expires_at)}</span>` : ''}
            ${f.has_password ? '<span class="chip"><i data-lucide="lock"></i>رمزدار</span>' : ''}
          </div>
        </div>
        <div class="f-downloads" title="تعداد دانلود">
          <div class="mini-bar"><span style="width:${(f.download_count / maxDl) * 100}%"></span></div>
          <span><i data-lucide="download"></i>${faNum(f.download_count)}${f.max_downloads ? ` / ${faNum(f.max_downloads)}` : ''}</span>
        </div>
        <span class="status status-${cls}"><i data-lucide="${icon}"></i>${label}</span>
        <div class="f-actions">
          <button class="icon-btn sm" type="button" data-act="copy" title="کپی لینک" aria-label="کپی لینک"><i data-lucide="copy"></i></button>
          <a class="icon-btn sm" href="${escapeHtml(url)}" target="_blank" rel="noopener" title="باز کردن" aria-label="باز کردن"><i data-lucide="external-link"></i></a>
          <button class="icon-btn sm danger" type="button" data-act="delete" title="حذف" aria-label="حذف"><i data-lucide="trash-2"></i></button>
        </div>
      </article>`;
    }).join('');
    refreshIcons();
  }

  async function onListClick(e) {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const row = b.closest('.f-row');
    const id = row.dataset.id;
    const f = files.find(x => x.share_id === id); if (!f) return;
    if (b.dataset.act === 'copy') {
      if (await window.App.copyText(window.App.shareUrl(id))) toast('لینک کپی شد.', 'success');
      return;
    }
    if (b.dataset.act === 'delete') {
      const ok = await window.App.confirmDialog({
        title: 'حذف فایل', danger: true, confirmText: 'بله، حذف شود',
        message: `«${f.name}» برای همیشه از سرور حذف می‌شود و لینک آن از کار می‌افتد.`,
      });
      if (!ok) return;
      const owned = window.App.getOwned().find(o => o.id === id);
      if (!owned) { toast(window.Api.messageFor('FORBIDDEN'), 'error'); return; }
      row.classList.add('busy'); b.disabled = true;
      try {
        await window.Api.remove(id, owned.token);
        window.App.removeOwned(id);
        files = files.filter(x => x.share_id !== id);
        row.classList.add('leaving');
        setTimeout(() => { renderStats(); renderList(); }, 280);
        toast('فایل حذف شد.', 'success');
      } catch (err) {
        row.classList.remove('busy'); b.disabled = false;
        toast(window.Api.messageFor(err && err.code), 'error');
      }
    }
  }

  function exportKeys() {
    const owned = window.App.getOwned();
    if (!owned.length) { toast('کلیدی برای خروجی وجود ندارد.', 'info'); return; }
    const blob = new Blob([JSON.stringify({ app: 'abrfile', version: 1, exported_at: new Date().toISOString(), files: owned }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'abrfile-keys.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast('فایل کلیدها ذخیره شد؛ آن را جای امنی نگه دارید.', 'success', 6000);
  }

  async function importKeys(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const incoming = (Array.isArray(data) ? data : data.files || []).filter(x => x && typeof x.id === 'string' && typeof x.token === 'string');
      if (!incoming.length) throw new Error('empty');
      const map = new Map(window.App.getOwned().map(o => [o.id, o]));
      incoming.forEach(o => map.set(o.id, { id: o.id, token: o.token, name: o.name || '', created_at: o.created_at || '' }));
      window.App.saveOwned(Array.from(map.values()));
      toast(`${faNum(incoming.length)} کلید وارد شد.`, 'success');
      load();
    } catch (err) { toast('فایل کلیدها معتبر نیست.', 'error'); }
  }
})();

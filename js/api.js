/* لایه ارتباط با سرور: Supabase (Storage + Postgres RPC + Edge Function) یا حالت دمو (IndexedDB) */
(function () {
  'use strict';
  const cfg = window.APP_CONFIG || {};
  const isPlaceholder = v => !v || /YOUR-/i.test(v);
  const configured = /^https?:\/\//i.test(cfg.SUPABASE_URL || '') && !isPlaceholder(cfg.SUPABASE_URL) && !isPlaceholder(cfg.SUPABASE_ANON_KEY);
  const isDemo = !!cfg.FORCE_DEMO || !configured;

  class ApiError extends Error {
    constructor(code, detail, status) {
      super(detail || code);
      this.name = 'ApiError';
      this.code = code || 'SERVER_ERROR';
      this.status = status || 0;
    }
  }

  const MESSAGES = {
    NOT_FOUND: 'فایل پیدا نشد یا حذف شده است.',
    EXPIRED: 'مهلت این لینک به پایان رسیده است.',
    LIMIT_REACHED: 'سقف تعداد دانلود این فایل پر شده است.',
    WRONG_PASSWORD: 'رمز عبور اشتباه است.',
    PASSWORD_REQUIRED: 'این فایل رمزدار است؛ رمز عبور را وارد کنید.',
    FILE_TOO_LARGE: 'حجم فایل بیشتر از حد مجاز است.',
    MIME_NOT_ALLOWED: 'نوع این فایل روی سرور مجاز نیست.',
    INVALID_PASSWORD: 'رمز عبور باید بین ۴ تا ۱۲۸ کاراکتر باشد.',
    INVALID_EXPIRY: 'مدت انقضا نامعتبر است.',
    INVALID_MAX_DOWNLOADS: 'حداکثر تعداد دانلود نامعتبر است.',
    INVALID_PATH: 'مسیر فایل نامعتبر است.',
    OBJECT_NOT_FOUND: 'فایل آپلودشده روی سرور پیدا نشد.',
    ALREADY_REGISTERED: 'این فایل قبلاً ثبت شده است.',
    UPLOAD_FORBIDDEN: 'سرور اجازه آپلود نداد؛ سیاست‌های Storage را بررسی کنید.',
    FORBIDDEN: 'اجازه انجام این کار را ندارید.',
    SETUP_REQUIRED: 'دیتابیس یا Storage هنوز راه‌اندازی نشده؛ فایل supabase/schema.sql را اجرا کنید.',
    FUNCTION_MISSING: 'Edge Function «share-api» پیدا نشد؛ آن را deploy کنید.',
    NETWORK: 'ارتباط با سرور برقرار نشد. اتصال اینترنت را بررسی کنید.',
    ABORTED: 'آپلود لغو شد.',
    RATE_LIMITED: 'تعداد درخواست‌ها زیاد است؛ کمی بعد دوباره امتحان کنید.',
    SERVER_ERROR: 'خطای غیرمنتظره‌ای در سرور رخ داد.',
  };
  const messageFor = code => MESSAGES[code] || MESSAGES.SERVER_ERROR;
  const toCode = msg => (typeof msg === 'string' && /^[A-Z_]{3,40}$/.test(msg.trim())) ? msg.trim() : 'SERVER_ERROR';

  /* ======================= Supabase ======================= */
  const base = String(cfg.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = cfg.SUPABASE_ANON_KEY;
  const authHeaders = extra => Object.assign({ apikey: key, Authorization: 'Bearer ' + key }, extra || {});

  async function readJson(res) {
    const text = await res.text();
    try { return text ? JSON.parse(text) : null; } catch (e) { return null; }
  }

  async function rpc(fn, args) {
    let res;
    try {
      res = await fetch(`${base}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json', Accept: 'application/json' }),
        body: JSON.stringify(args || {}),
      });
    } catch (e) { throw new ApiError('NETWORK'); }
    const data = await readJson(res);
    if (!res.ok) {
      if (data && (data.code === 'PGRST202' || data.code === '42883' || data.code === '42P01')) throw new ApiError('SETUP_REQUIRED', data.message, res.status);
      if (res.status === 429) throw new ApiError('RATE_LIMITED');
      throw new ApiError(toCode(data && data.message), data && data.message, res.status);
    }
    return data;
  }

  async function callFunction(body) {
    let res;
    try {
      res = await fetch(`${base}/functions/v1/${cfg.FUNCTION_NAME || 'share-api'}`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
      });
    } catch (e) { throw new ApiError('NETWORK'); }
    const data = await readJson(res);
    if (!res.ok) {
      if (res.status === 404 && !(data && data.error)) throw new ApiError('FUNCTION_MISSING');
      throw new ApiError(toCode(data && data.error), data && (data.message || data.error), res.status);
    }
    return data;
  }

  /** آپلود مستقیم به Supabase Storage با XHR برای داشتن Progress واقعی */
  function xhrUpload(path, file, contentType, onProgress, signal) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const encodedPath = path.split('/').map(encodeURIComponent).join('/');
      xhr.open('POST', `${base}/storage/v1/object/${encodeURIComponent(cfg.BUCKET)}/${encodedPath}`);
      const h = authHeaders({ 'Content-Type': contentType, 'x-upsert': 'false', 'cache-control': 'max-age=3600' });
      Object.keys(h).forEach(k => xhr.setRequestHeader(k, h[k]));
      xhr.upload.onprogress = e => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total, e.loaded, e.total); };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) return resolve();
        let body = {};
        try { body = JSON.parse(xhr.responseText || '{}'); } catch (e) { /* ignore */ }
        const s = Number(body.statusCode) || xhr.status;
        const text = `${body.error || ''} ${body.message || ''}`.toLowerCase();
        let code = 'SERVER_ERROR';
        if (s === 413 || /exceeded the maximum|too large|payload/.test(text)) code = 'FILE_TOO_LARGE';
        else if (s === 415 || /mime/.test(text)) code = 'MIME_NOT_ALLOWED';
        else if (/bucket not found/.test(text)) code = 'SETUP_REQUIRED';
        else if (s === 401 || s === 403 || /policy|unauthorized|row-level/.test(text)) code = 'UPLOAD_FORBIDDEN';
        else if (s === 429) code = 'RATE_LIMITED';
        reject(new ApiError(code, body.message, xhr.status));
      };
      xhr.onerror = () => reject(new ApiError('NETWORK'));
      xhr.onabort = () => reject(new ApiError('ABORTED'));
      if (signal) {
        if (signal.aborted) return reject(new ApiError('ABORTED'));
        signal.addEventListener('abort', () => xhr.abort(), { once: true });
      }
      xhr.send(file);
    });
  }

  const SupabaseBackend = {
    async upload(file, meta, opts, onProgress, signal) {
      // نام یکتا (UUID) برای ذخیره؛ نام اصلی فقط در دیتابیس نگه داشته می‌شود
      const path = `uploads/${window.App.uuid()}${meta.ext ? '.' + meta.ext : ''}`;
      await xhrUpload(path, file, meta.mime, onProgress, signal);
      return rpc('register_file', {
        p_storage_path: path,
        p_original_name: file.name,
        p_password: opts.password || null,
        p_expires_in_hours: opts.expiresInHours || null,
        p_max_downloads: opts.maxDownloads || null,
      });
    },
    getInfo: id => rpc('get_file_info', { p_share_id: id }),
    download: (id, password) => callFunction({ action: 'download', id, password: password || null }),
    listOwned: items => rpc('get_owned_files', { p_items: items }).then(r => r || []),
    remove: (id, token) => callFunction({ action: 'delete', id, owner_token: token }),
  };

  /* ======================= حالت دمو (IndexedDB) ======================= */
  const DemoBackend = (function () {
    const DB = 'abrfile-demo', STORE = 'files';
    let dbp = null;
    const db = () => dbp || (dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'share_id' });
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }));
    const run = (mode, fn) => db().then(d => new Promise((res, rej) => {
      const t = d.transaction(STORE, mode);
      const r = fn(t.objectStore(STORE));
      t.oncomplete = () => res(r ? r.result : undefined);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    }));
    const get = id => run('readonly', s => s.get(id));
    const put = rec => run('readwrite', s => s.put(rec));
    const del = id => run('readwrite', s => s.delete(id));

    async function sha256(text) {
      if (window.crypto && crypto.subtle) {
        const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
        return Array.from(new Uint8Array(d), b => b.toString(16).padStart(2, '0')).join('');
      }
      let h = 0; for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
      return 'weak-' + h;
    }
    const ALPHA = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const randomId = (n = 10) => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => ALPHA[b % ALPHA.length]).join('');
    const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(24)), b => b.toString(16).padStart(2, '0')).join('');
    const publicInfo = r => ({
      share_id: r.share_id, name: r.name, size: r.size, mime: r.mime, created_at: r.created_at,
      download_count: r.download_count, max_downloads: r.max_downloads, expires_at: r.expires_at,
      has_password: !!r.password_hash,
      is_expired: !!(r.expires_at && new Date(r.expires_at) <= new Date()),
      limit_reached: !!(r.max_downloads && r.download_count >= r.max_downloads),
    });

    function simulateProgress(size, onProgress, signal) {
      const duration = Math.min(4000, Math.max(800, (size / (6 * 1024 * 1024)) * 1000));
      return new Promise((resolve, reject) => {
        const start = performance.now();
        const tick = () => {
          if (signal && signal.aborted) return reject(new ApiError('ABORTED'));
          const p = Math.min(1, (performance.now() - start) / duration);
          if (onProgress) onProgress(p, Math.round(size * p), size);
          if (p >= 1) resolve(); else setTimeout(tick, 60);
        };
        tick();
      });
    }

    return {
      async upload(file, meta, opts, onProgress, signal) {
        await simulateProgress(file.size, onProgress, signal);
        const token = randomToken();
        const rec = {
          share_id: randomId(), blob: file, name: file.name, size: file.size, mime: meta.mime,
          created_at: new Date().toISOString(),
          password_hash: opts.password ? await sha256(opts.password) : null,
          owner_token_hash: await sha256(token),
          expires_at: opts.expiresInHours ? new Date(Date.now() + opts.expiresInHours * 3600e3).toISOString() : null,
          max_downloads: opts.maxDownloads || null, download_count: 0, last_downloaded_at: null,
        };
        await put(rec);
        return { share_id: rec.share_id, owner_token: token, expires_at: rec.expires_at };
      },
      async getInfo(id) { const r = await get(id); return r ? publicInfo(r) : null; },
      async download(id, password) {
        const r = await get(id);
        if (!r) throw new ApiError('NOT_FOUND');
        const info = publicInfo(r);
        if (info.is_expired) throw new ApiError('EXPIRED');
        if (info.limit_reached) throw new ApiError('LIMIT_REACHED');
        if (r.password_hash) {
          if (!password) throw new ApiError('PASSWORD_REQUIRED');
          if (await sha256(password) !== r.password_hash) throw new ApiError('WRONG_PASSWORD');
        }
        r.download_count += 1; r.last_downloaded_at = new Date().toISOString();
        await put(r);
        return { url: URL.createObjectURL(r.blob), name: r.name, download_count: r.download_count, objectUrl: true };
      },
      async listOwned(items) {
        const out = [];
        for (const it of items) {
          const r = await get(it.id);
          if (r && r.owner_token_hash === await sha256(it.token)) out.push(Object.assign(publicInfo(r), { last_downloaded_at: r.last_downloaded_at }));
        }
        return out.sort((a, b) => b.created_at.localeCompare(a.created_at));
      },
      async remove(id, token) {
        const r = await get(id);
        if (!r || r.owner_token_hash !== await sha256(token)) throw new ApiError('FORBIDDEN');
        await del(id);
        return { ok: true };
      },
    };
  })();

  window.Api = Object.assign({ isDemo, ApiError, messageFor }, isDemo ? DemoBackend : SupabaseBackend);
})();

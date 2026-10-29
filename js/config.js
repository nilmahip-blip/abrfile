/**
 * ⚙️ تنظیمات برنامه — معمولاً فقط همین فایل را باید ویرایش کنید.
 *
 * اگر SUPABASE_URL و SUPABASE_ANON_KEY را پر نکنید، برنامه در «حالت دمو» اجرا می‌شود
 * و فایل‌ها فقط داخل همین مرورگر (IndexedDB) ذخیره می‌شوند — برای تست رابط کاربری.
 *
 * مقادیر را از Supabase Dashboard → Project Settings → API Keys بردارید.
 * کلید anon / publishable برای استفاده در مرورگر طراحی شده و عمومی بودنش مشکلی ندارد
 * (امنیت با RLS و توابع دیتابیس تأمین می‌شود). هرگز service_role / secret key را اینجا نگذارید.
 */
window.APP_CONFIG = {
  APP_NAME: 'ابرفایل',

  SUPABASE_URL: 'https://moucffbvpgldrxvtwfwv.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_8ixHJVFTUanRJIegF-vIBw_ZlSLguWC',

  BUCKET: 'shared-files',          // باید با supabase/schema.sql یکی باشد
  FUNCTION_NAME: 'share-api',      // نام Edge Function

  // آدرس عمومی سایت برای ساخت لینک‌ها (خالی = همان آدرس فعلی)
  PUBLIC_BASE_URL: '',

  MAX_FILE_SIZE_MB: 50,            // سقف سمت سرور هم در schema.sql = 50MB
  MAX_FILES_PER_BATCH: 10,
  PARALLEL_UPLOADS: 3,
  DOWNLOAD_COUNTDOWN_SECONDS: 5,   // 0 = بدون شمارش معکوس

  FORCE_DEMO: false,

  /**
   * فرمت‌های مجاز: پسوند → MIME typeهای قابل قبول.
   * اولین MIME هر پسوند، نوع «استاندارد» است که به سرور ارسال می‌شود
   * و باید در allowed_mime_types باکت (schema.sql) وجود داشته باشد.
   */
  ALLOWED_TYPES: {
    jpg:  ['image/jpeg', 'image/pjpeg'],
    jpeg: ['image/jpeg', 'image/pjpeg'],
    png:  ['image/png'],
    gif:  ['image/gif'],
    webp: ['image/webp'],
    pdf:  ['application/pdf'],
    txt:  ['text/plain'],
    csv:  ['text/csv', 'application/vnd.ms-excel', 'text/plain'],
    md:   ['text/markdown', 'text/x-markdown', 'text/plain'],
    json: ['application/json', 'text/json'],
    doc:  ['application/msword'],
    docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    xls:  ['application/vnd.ms-excel'],
    xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ppt:  ['application/vnd.ms-powerpoint'],
    pptx: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    zip:  ['application/zip', 'application/x-zip-compressed', 'multipart/x-zip'],
    rar:  ['application/vnd.rar', 'application/x-rar-compressed', 'application/x-rar'],
    '7z': ['application/x-7z-compressed'],
    mp3:  ['audio/mpeg', 'audio/mp3'],
    wav:  ['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave'],
    ogg:  ['audio/ogg', 'application/ogg'],
    mp4:  ['video/mp4'],
    webm: ['video/webm', 'audio/webm'],
    mov:  ['video/quicktime'],
  },
};

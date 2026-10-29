# ☁️ ابرفایل — اشتراک‌گذاری امن فایل روی Supabase

یک وب‌اپ کامل برای اشتراک‌گذاری فایل با HTML، CSS و JavaScript خالص. پروژه نیاز به build ندارد و بک‌اند آن **Supabase** است (Storage، Postgres و Edge Functions)، که پلن رایگان دارد.

---

## ✨ قابلیت‌ها

| بخش | امکانات |
|---|---|
| **آپلود** | کشیدن و رها کردن (Drag & Drop)، انتخاب از دستگاه، چند فایل همزمان (حداکثر ۱۰ فایل، ۳ آپلود موازی)، نوار پیشرفت واقعی برای هر فایل، پیش‌نمایش تصویر، نمایش نام، نوع و حجم قبل از آپلود، لینک قابل کپی و دکمهٔ «کپی همه» |
| **اعتبارسنجی** | سقف ۵۰ مگابایت، فهرست پسوندهای مجاز، بررسی MIME مرورگر، بررسی امضای باینری فایل (magic bytes) تا مثلاً فایل اجرایی با پسوند ‎.txt‎ رد شود؛ همهٔ این بررسی‌ها **دوباره در سرور هم انجام می‌شوند** |
| **دانلود** | صفحهٔ اختصاصی برای هر فایل با نام، حجم، تاریخ آپلود، تعداد دانلود و زمان انقضا؛ شمارش معکوس قابل لغو؛ لینک امضاشدهٔ ۶۰ثانیه‌ای |
| **امنیت** | نام UUID برای فایل‌ها در Storage، باکت خصوصی، رمز عبور اختیاری (bcrypt)، تاریخ انقضا (۱ ساعت تا ۳۰ روز)، سقف تعداد دانلود، دسترسی نداشتن مستقیم کلاینت به جدول |
| **داشبورد** | فهرست فایل‌های آپلودشده از همین مرورگر، آمار (تعداد، حجم، دانلودها، لینک‌های فعال)، جستجو و مرتب‌سازی، حذف، و خروجی یا ورودی کلیدهای مدیریت |
| **UI/UX** | فارسی و راست‌به‌چپ (فونت وزیرمتن)، ریسپانسیو، تم تاریک و روشن (ذخیره می‌شود)، انیمیشن، آیکون‌های Lucide، Toast، مودال تأیید، رعایت `prefers-reduced-motion` |
| **حالت دمو** | تا وقتی `js/config.js` تنظیم نشده باشد، برنامه با IndexedDB مرورگر کار می‌کند و همهٔ امکانات بدون سرور قابل امتحان هستند |

---

## 📁 ساختار پروژه

```
abrfile/
├── index.html                  # صفحهٔ آپلود
├── file.html                   # صفحهٔ دانلود هر فایل  (file.html?id=XXXXXXXXXX)
├── dashboard.html              # داشبورد «فایل‌های من»
├── _headers                    # هدرهای امنیتی و CSP (برای Netlify و Cloudflare Pages)
├── assets/
│   └── favicon.svg
├── css/
│   └── style.css               # کل استایل‌ها، تم تاریک و روشن، انیمیشن‌ها
├── js/
│   ├── config.js               # ⚙️ تنظیمات: آدرس و کلید Supabase، سقف حجم، فرمت‌ها
│   ├── theme-init.js           # اعمال تم پیش از رندر (جلوگیری از چشمک‌زدن صفحه)
│   ├── core.js                 # ابزارها: Toast، تم، فرمت اعداد و تاریخ فارسی، اعتبارسنجی فایل
│   ├── api.js                  # لایهٔ ارتباط با Supabase و بک‌اند دمو (IndexedDB)
│   ├── upload.js               # منطق صفحهٔ آپلود
│   ├── file.js                 # منطق صفحهٔ دانلود و شمارش معکوس
│   └── dashboard.js            # منطق داشبورد
└── supabase/
    ├── schema.sql              # جدول، باکت، سیاست‌های RLS و توابع RPC (چندبار اجراشدنی)
    ├── cron.sql                # (اختیاری) پاک‌سازی خودکار ساعتی فایل‌های منقضی
    └── functions/
        └── share-api/
            └── index.ts        # Edge Function: دانلود امن، حذف، پاک‌سازی
```

---

## 🏗️ معماری

```
 مرورگر                                    Supabase
 ───────                                   ─────────────────────────────────────────
 ① آپلود مستقیم (XHR + پیشرفت)  ───────▶  Storage: باکت خصوصی shared-files
    مسیر: uploads/<uuid>.<ext>              (فقط INSERT در همین الگو مجاز است)

 ② rpc('register_file')          ───────▶  Postgres: حجم و MIME واقعی را از
                                            storage.objects می‌خواند، اعتبارسنجی
                                            می‌کند و share_id و owner_token برمی‌گرداند

 ③ rpc('get_file_info')          ───────▶  اطلاعات عمومی فایل (بدون مسیر ذخیره)

 ④ functions/share-api           ───────▶  Edge Function (با service_role):
    action=download (+password)             رمز، انقضا و سقف دانلود را بررسی می‌کند،
                                            شمارنده را زیاد می‌کند و لینک امضاشدهٔ
                                            ۶۰ثانیه‌ای می‌سازد
    action=delete   (+owner_token)          حذف فایل و رکورد
    action=cleanup  (+x-cron-secret)        حذف فایل‌های منقضی و یتیم
```

**مدل امنیتی به‌طور خلاصه**

- جدول `shared_files` برای نقش‌های `anon` و `authenticated` کاملاً بسته است: RLS روشن است، هیچ policy ای ندارد و مجوزها revoke شده‌اند. کلاینت فقط سه تابع `register_file`، `get_file_info` و `get_owned_files` را صدا می‌زند.
- توابع حساس (`consume_download`، `delete_file_record`، `collect_garbage`) فقط برای `service_role`، یعنی Edge Function، مجازند.
- حجم و MIME از متادیتای خود Storage خوانده می‌شود، نه از ادعای کلاینت. باکت هم `file_size_limit` و `allowed_mime_types` دارد.
- رمز عبور با bcrypt (افزونهٔ pgcrypto) ذخیره می‌شود. تلاش اشتباه شمارندهٔ دانلود را زیاد نمی‌کند.
- `owner_token` (۴۸ کاراکتر هگز) فقط در `localStorage` مرورگر آپلودکننده نگه داشته می‌شود و در دیتابیس به‌صورت هش SHA-256 ذخیره می‌شود.
- شناسهٔ اشتراک ۱۰ کاراکتر تصادفی است (حدود ۵۸ بیت آنتروپی)، پس لینک‌ها قابل حدس نیستند.

---

## 🚀 راه‌اندازی (حدود ۱۰ دقیقه)

### ۱) ساخت پروژهٔ رایگان Supabase
به [supabase.com](https://supabase.com) بروید، **New project** را بزنید و منتظر بمانید تا پروژه آماده شود.

### ۲) ساخت دیتابیس و باکت
در Dashboard به **SQL Editor** بروید، کل محتوای `supabase/schema.sql` را paste کنید و **Run** را بزنید.
این کار جدول، باکت خصوصی `shared-files`، سیاست‌های Storage و توابع را می‌سازد. اجرای دوباره هم مشکلی ایجاد نمی‌کند.

### ۳) دیپلوی Edge Function

**روش الف — Supabase CLI (پیشنهادی):**
```bash
npm i -g supabase            # یا: brew install supabase/tap/supabase
cd abrfile
supabase login
supabase init                # اگر پوشهٔ supabase/config.toml ندارید
supabase link --project-ref <PROJECT_REF>
supabase functions deploy share-api --no-verify-jwt
```

**روش ب — از داشبورد:** به **Edge Functions → Deploy a new function → Via Editor** بروید، نام را `share-api` بگذارید، محتوای `supabase/functions/share-api/index.ts` را paste کنید و در تنظیمات تابع گزینهٔ **Verify JWT** را **خاموش** کنید.

> چرا `--no-verify-jwt`؟ کلیدهای جدید publishable (`sb_publishable_...`) توکن JWT نیستند. امنیت این تابع با شناسهٔ اشتراک، رمز و owner token تأمین می‌شود.

### ۴) متغیرهای Edge Function (اختیاری ولی توصیه‌شده)
```bash
# فقط دامنهٔ سایت شما بتواند API را صدا بزند (پیش‌فرض: *)
supabase secrets set ALLOWED_ORIGINS=https://your-site.netlify.app
# برای پاک‌سازی خودکار (مرحلهٔ ۷)
supabase secrets set CRON_SECRET=$(openssl rand -hex 32)
```
`SUPABASE_URL` و `SUPABASE_SERVICE_ROLE_KEY` را Supabase خودش به تابع می‌دهد. `SIGNED_URL_TTL` (پیش‌فرض ۶۰ ثانیه) و `BUCKET` هم قابل تغییرند.

### ۵) تنظیم فرانت‌اند
فایل `js/config.js` را باز کنید:
```js
SUPABASE_URL: 'https://<PROJECT_REF>.supabase.co',
SUPABASE_ANON_KEY: '<anon یا publishable key>',
```
این مقادیر در **Project Settings → API Keys** هستند.
⚠️ **هرگز** کلید `service_role` یا `secret` را در فرانت‌اند قرار ندهید.

### ۶) اجرای محلی و انتشار
```bash
# اجرای محلی (باز کردن مستقیم فایل با file:// کار نمی‌کند)
python -m http.server 8080      # یا: npx serve .
# سپس http://localhost:8080
```
برای انتشار رایگان، کل پوشه را روی یکی از این سرویس‌ها بگذارید: **Netlify** (drag & drop پوشه)، **Cloudflare Pages**، **Vercel** یا **GitHub Pages**.
فایل `_headers` روی Netlify و Cloudflare Pages به‌طور خودکار اعمال می‌شود (CSP و هدرهای امنیتی).

### ۷) پاک‌سازی خودکار (اختیاری)
در **Database → Extensions** افزونه‌های `pg_cron` و `pg_net` را فعال کنید. سپس در `supabase/cron.sql` مقادیر `<PROJECT_REF>` و `<CRON_SECRET>` را جایگزین کنید و آن را در SQL Editor اجرا کنید. از آن به بعد، هر ساعت فایل‌های منقضی و آپلودهای ناتمام پاک می‌شوند.

---

## ⚙️ تنظیمات قابل تغییر (`js/config.js`)

| کلید | پیش‌فرض | توضیح |
|---|---|---|
| `MAX_FILE_SIZE_MB` | `50` | سقف حجم در کلاینت. اگر تغییرش دادید، در `schema.sql` هم عدد `52428800` را (در `file_size_limit` باکت، قید جدول و تابع `register_file`) عوض کنید |
| `ALLOWED_TYPES` | تصویر، PDF، Office، متن، آرشیو، صوت و ویدیو | پسوند → MIMEهای قابل قبول. اولین MIME هر پسوند باید در `allowed_mime_types` باکت باشد |
| `MAX_FILES_PER_BATCH` | `10` | حداکثر فایل در هر نوبت آپلود |
| `PARALLEL_UPLOADS` | `3` | تعداد آپلود همزمان |
| `DOWNLOAD_COUNTDOWN_SECONDS` | `5` | شمارش معکوس قبل از دانلود (`0` = بدون شمارش) |
| `PUBLIC_BASE_URL` | خالی | آدرس عمومی سایت برای ساخت لینک‌ها |
| `FORCE_DEMO` | `false` | اجرای اجباری حالت دمو |

گزینه‌های هر نوبت آپلود در خود صفحه انتخاب می‌شوند: رمز عبور (۴ تا ۱۲۸ کاراکتر)، انقضا (۱ ساعت، ۱ روز، ۷ روز، ۳۰ روز یا بدون انقضا) و سقف تعداد دانلود.

---

## 🧪 حالت دمو
تا وقتی `config.js` مقادیر `YOUR-...` را داشته باشد، یک نوار زرد «حالت دمو» نمایش داده می‌شود و همه‌چیز (آپلود، رمز، انقضا، شمارنده، داشبورد و حذف) داخل IndexedDB همان مرورگر کار می‌کند. لینک‌های حالت دمو فقط در همان مرورگر باز می‌شوند.

---

## 📦 محدودیت‌های پلن رایگان Supabase (زمان نوشتن)
- حدود ۱ گیگابایت فضای Storage و ۵ گیگابایت ترافیک خروجی در ماه
- سقف حجم هر فایل در پلن رایگان **۵۰ مگابایت** است (به همین دلیل سقف برنامه هم ۵۰MB است)
- پروژه‌های رایگان بعد از حدود یک هفته بی‌استفاده بودن **pause** می‌شوند و باید از داشبورد دوباره فعالشان کنید

---

## ⚠️ محدودیت‌های شناخته‌شده
- **داشبورد به مرورگر وابسته است:** حساب کاربری وجود ندارد و کلید مدیریت هر فایل در `localStorage` همان مرورگر است. برای انتقال به دستگاه دیگر از دکمهٔ «خروجی کلیدها» و «ورود کلیدها» در داشبورد استفاده کنید.
- برای تلاش‌های رمز عبور **rate limit** پیاده نشده است. برای فایل‌های حساس رمز طولانی انتخاب کنید یا جلوی Edge Function از Cloudflare یا rate limit استفاده کنید.
- بررسی امضای باینری در کلاینت انجام می‌شود. سرور MIME متادیتای Storage را بررسی می‌کند ولی محتوای فایل را اسکن نمی‌کند (آنتی‌ویروس ندارد).
- آیکون‌ها و فونت از CDN (unpkg و Google Fonts) بارگذاری می‌شوند. اگر CDN در دسترس نباشد برنامه کار می‌کند ولی آیکون یا فونت ممکن است نمایش داده نشوند.

---

## 🔌 API خلاصه (برای توسعه)

| فراخوانی | ورودی | خروجی |
|---|---|---|
| `rpc/register_file` | `p_storage_path, p_original_name, p_password?, p_expires_in_hours?, p_max_downloads?` | `share_id, owner_token, expires_at` |
| `rpc/get_file_info` | `p_share_id` | نام، حجم، MIME، تاریخ، تعداد دانلود، انقضا، رمزدار بودن، … |
| `rpc/get_owned_files` | `p_items: [{id, token}]` | فهرست فایل‌های متعلق به کاربر |
| `functions/v1/share-api` | `{action:"download", id, password?}` | `{url, name, download_count}` |
| `functions/v1/share-api` | `{action:"delete", id, owner_token}` | `{ok:true}` |
| `functions/v1/share-api` | `{action:"cleanup"}` + هدر `x-cron-secret` | `{ok:true, removed}` |

-- (اختیاری) پاک‌سازی خودکار هر ساعت با pg_cron + pg_net
-- 1) در Dashboard → Database → Extensions افزونه‌های pg_cron و pg_net را فعال کنید.
-- 2) با دستور زیر یک CRON_SECRET برای Edge Function تنظیم کنید:
--      supabase secrets set CRON_SECRET=<یک رشته تصادفی طولانی>
-- 3) مقادیر <PROJECT_REF> و <CRON_SECRET> را جایگزین و این اسکریپت را اجرا کنید.
select cron.schedule(
  'abrfile-cleanup',
  '0 * * * *',
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/share-api',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
    body    := jsonb_build_object('action', 'cleanup')
  );
  $$
);
-- حذف زمان‌بندی:  select cron.unschedule('abrfile-cleanup');

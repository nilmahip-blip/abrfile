-- =====================================================================
--  ابرفایل — اسکیما Supabase (Storage + جدول متادیتا + توابع امن)
--  این فایل را یک‌بار در Supabase Dashboard → SQL Editor اجرا کنید.
--  اجرای دوباره‌ی آن بی‌خطر است (idempotent).
--
--  مدل امنیتی:
--   • باکت «shared-files» خصوصی است؛ هیچ‌کس نمی‌تواند فایل‌ها را لیست یا مستقیم بخواند.
--   • کاربر ناشناس فقط می‌تواند در مسیر uploads/<UUID>.<ext> آپلود کند.
--     سقف حجم (50MB) و MIMEهای مجاز در خود باکت و سمت سرور اعمال می‌شود.
--   • جدول shared_files برای anon کاملاً بسته است؛ دسترسی فقط از طریق توابع زیر است.
--   • دانلود فقط از طریق Edge Function با لینک امضاشده‌ی ۶۰ ثانیه‌ای انجام می‌شود
--     (بررسی رمز عبور، تاریخ انقضا و سقف دانلود سمت سرور).
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- 1) باکت Storage
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'shared-files', 'shared-files', false, 52428800,
  array[
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'application/pdf', 'text/plain', 'text/csv', 'text/markdown', 'application/json',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/zip', 'application/vnd.rar', 'application/x-7z-compressed',
    'audio/mpeg', 'audio/wav', 'audio/ogg',
    'video/mp4', 'video/webm', 'video/quicktime'
  ]
)
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- فقط آپلود (INSERT) مجاز است؛ SELECT/UPDATE/DELETE برای anon هیچ سیاستی ندارد.
drop policy if exists "shared_files_anon_upload" on storage.objects;
create policy "shared_files_anon_upload"
  on storage.objects for insert
  to anon, authenticated
  with check (
    bucket_id = 'shared-files'
    and name ~ '^uploads/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.[a-z0-9]{1,10})?$'
  );

-- ---------------------------------------------------------------------
-- 2) جدول متادیتا
-- ---------------------------------------------------------------------
create table if not exists public.shared_files (
  id                 uuid primary key default gen_random_uuid(),
  share_id           text not null unique,
  storage_path       text not null unique,
  original_name      text not null check (char_length(original_name) between 1 and 255),
  size_bytes         bigint not null check (size_bytes > 0 and size_bytes <= 52428800),
  mime_type          text not null,
  password_hash      text,
  owner_token_hash   text not null,
  expires_at         timestamptz,
  max_downloads      integer check (max_downloads is null or max_downloads between 1 and 10000),
  download_count     integer not null default 0,
  created_at         timestamptz not null default now(),
  last_downloaded_at timestamptz
);
create index if not exists shared_files_expires_at_idx on public.shared_files (expires_at) where expires_at is not null;

alter table public.shared_files enable row level security;
-- هیچ policy تعریف نمی‌شود ⇒ anon/authenticated هیچ دسترسی مستقیمی ندارند.
revoke all on table public.shared_files from anon, authenticated;

-- ---------------------------------------------------------------------
-- 3) توابع کمکی خصوصی
-- ---------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public;

create or replace function private.gen_share_id(len integer default 10)
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  bytes bytea := extensions.gen_random_bytes(len);
  result text := '';
begin
  for i in 0 .. len - 1 loop
    result := result || substr(alphabet, (get_byte(bytes, i) % length(alphabet)) + 1, 1);
  end loop;
  return result;
end;
$$;

-- ---------------------------------------------------------------------
-- 4) ثبت فایل پس از آپلود (anon)
--    حجم و MIME از متادیتای واقعی Storage خوانده می‌شود، نه از ورودی کاربر.
-- ---------------------------------------------------------------------
create or replace function public.register_file(
  p_storage_path     text,
  p_original_name    text,
  p_password         text    default null,
  p_expires_in_hours integer default null,
  p_max_downloads    integer default null
)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meta    jsonb;
  v_size    bigint;
  v_mime    text;
  v_name    text;
  v_share   text;
  v_token   text;
  v_expires timestamptz;
  v_pw_hash text;
begin
  if p_storage_path is null
     or p_storage_path !~ '^uploads/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.[a-z0-9]{1,10})?$' then
    raise exception 'INVALID_PATH';
  end if;

  select o.metadata into v_meta
    from storage.objects o
   where o.bucket_id = 'shared-files'
     and o.name = p_storage_path
     and o.created_at > now() - interval '1 hour';
  if not found then
    raise exception 'OBJECT_NOT_FOUND';
  end if;

  if exists (select 1 from public.shared_files f where f.storage_path = p_storage_path) then
    raise exception 'ALREADY_REGISTERED';
  end if;

  v_size := coalesce((v_meta ->> 'size')::bigint, 0);
  v_mime := lower(coalesce(v_meta ->> 'mimetype', ''));
  if v_size <= 0 or v_size > 52428800 then
    raise exception 'FILE_TOO_LARGE';
  end if;
  if v_mime = '' or not exists (
    select 1 from storage.buckets b
     where b.id = 'shared-files'
       and (b.allowed_mime_types is null or v_mime = any (b.allowed_mime_types))
  ) then
    raise exception 'MIME_NOT_ALLOWED';
  end if;

  -- پاک‌سازی نام فایل (حذف کاراکترهای خطرناک/کنترلی)
  v_name := left(btrim(regexp_replace(coalesce(p_original_name, ''), '[\\/:*?"<>|[:cntrl:]]+', '_', 'g')), 255);
  if v_name = '' then
    v_name := 'file';
  end if;

  if p_password is not null and p_password <> '' then
    if char_length(p_password) < 4 or char_length(p_password) > 128 then
      raise exception 'INVALID_PASSWORD';
    end if;
    v_pw_hash := extensions.crypt(p_password, extensions.gen_salt('bf', 10));
  end if;

  if p_expires_in_hours is not null then
    if p_expires_in_hours < 1 or p_expires_in_hours > 720 then
      raise exception 'INVALID_EXPIRY';
    end if;
    v_expires := now() + make_interval(hours => p_expires_in_hours);
  end if;

  if p_max_downloads is not null and (p_max_downloads < 1 or p_max_downloads > 10000) then
    raise exception 'INVALID_MAX_DOWNLOADS';
  end if;

  v_token := encode(extensions.gen_random_bytes(24), 'hex');
  loop
    v_share := private.gen_share_id(10);
    exit when not exists (select 1 from public.shared_files f where f.share_id = v_share);
  end loop;

  insert into public.shared_files
    (share_id, storage_path, original_name, size_bytes, mime_type,
     password_hash, owner_token_hash, expires_at, max_downloads)
  values
    (v_share, p_storage_path, v_name, v_size, v_mime,
     v_pw_hash, encode(extensions.digest(v_token, 'sha256'), 'hex'), v_expires, p_max_downloads);

  return json_build_object('share_id', v_share, 'owner_token', v_token, 'expires_at', v_expires);
end;
$$;

-- ---------------------------------------------------------------------
-- 5) اطلاعات عمومی فایل برای صفحه دانلود (anon) — بدون مسیر ذخیره‌سازی
-- ---------------------------------------------------------------------
create or replace function public.get_file_info(p_share_id text)
returns json
language sql
stable
security definer
set search_path = ''
as $$
  select json_build_object(
    'share_id',       f.share_id,
    'name',           f.original_name,
    'size',           f.size_bytes,
    'mime',           f.mime_type,
    'created_at',     f.created_at,
    'download_count', f.download_count,
    'max_downloads',  f.max_downloads,
    'expires_at',     f.expires_at,
    'has_password',   f.password_hash is not null,
    'is_expired',     coalesce(f.expires_at <= now(), false),
    'limit_reached',  coalesce(f.download_count >= f.max_downloads, false)
  )
  from public.shared_files f
  where f.share_id = p_share_id;
$$;

-- ---------------------------------------------------------------------
-- 6) مصرف یک دانلود (فقط service_role / Edge Function)
-- ---------------------------------------------------------------------
create or replace function public.consume_download(p_share_id text, p_password text default null)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec public.shared_files%rowtype;
begin
  select * into rec from public.shared_files s where s.share_id = p_share_id for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  if rec.expires_at is not null and rec.expires_at <= now() then
    raise exception 'EXPIRED';
  end if;
  if rec.max_downloads is not null and rec.download_count >= rec.max_downloads then
    raise exception 'LIMIT_REACHED';
  end if;
  if rec.password_hash is not null then
    if p_password is null or p_password = '' then
      raise exception 'PASSWORD_REQUIRED';
    end if;
    if extensions.crypt(p_password, rec.password_hash) <> rec.password_hash then
      raise exception 'WRONG_PASSWORD';
    end if;
  end if;

  update public.shared_files s
     set download_count = s.download_count + 1,
         last_downloaded_at = now()
   where s.id = rec.id;

  return json_build_object(
    'storage_path',   rec.storage_path,
    'name',           rec.original_name,
    'mime',           rec.mime_type,
    'download_count', rec.download_count + 1
  );
end;
$$;

-- ---------------------------------------------------------------------
-- 7) فهرست فایل‌های یک کاربر با کلیدهای مالکیت (anon)
--    p_items: [{"id": "<share_id>", "token": "<owner_token>"}, ...]
-- ---------------------------------------------------------------------
create or replace function public.get_owned_files(p_items jsonb)
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    return '[]'::json;
  end if;
  if jsonb_array_length(p_items) > 200 then
    raise exception 'TOO_MANY_ITEMS';
  end if;

  return coalesce((
    select json_agg(json_build_object(
             'share_id',           f.share_id,
             'name',               f.original_name,
             'size',               f.size_bytes,
             'mime',               f.mime_type,
             'created_at',         f.created_at,
             'download_count',     f.download_count,
             'max_downloads',      f.max_downloads,
             'expires_at',         f.expires_at,
             'last_downloaded_at', f.last_downloaded_at,
             'has_password',       f.password_hash is not null,
             'is_expired',         coalesce(f.expires_at <= now(), false),
             'limit_reached',      coalesce(f.download_count >= f.max_downloads, false)
           ) order by f.created_at desc)
      from public.shared_files f
      join (select distinct it ->> 'id' as sid, it ->> 'token' as tok
              from jsonb_array_elements(p_items) as it) x
        on f.share_id = x.sid
       and f.owner_token_hash = encode(extensions.digest(coalesce(x.tok, ''), 'sha256'), 'hex')
  ), '[]'::json);
end;
$$;

-- ---------------------------------------------------------------------
-- 8) حذف رکورد با کلید مالکیت (فقط service_role) — مسیر فایل را برمی‌گرداند
-- ---------------------------------------------------------------------
create or replace function public.delete_file_record(p_share_id text, p_owner_token text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_path text;
begin
  delete from public.shared_files f
   where f.share_id = p_share_id
     and f.owner_token_hash = encode(extensions.digest(coalesce(p_owner_token, ''), 'sha256'), 'hex')
  returning f.storage_path into v_path;
  if v_path is null then
    raise exception 'FORBIDDEN';
  end if;
  return v_path;
end;
$$;

-- ---------------------------------------------------------------------
-- 9) جمع‌آوری زباله (فقط service_role): فایل‌های منقضی + فایل‌های یتیم
-- ---------------------------------------------------------------------
create or replace function public.collect_garbage(p_limit integer default 500)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_orphans text[];
  v_expired text[];
begin
  -- فایل‌هایی که آپلود شده‌اند ولی بیش از ۱ روز است ثبت نشده‌اند
  select coalesce(array_agg(x.name), '{}') into v_orphans
    from (select o.name
            from storage.objects o
           where o.bucket_id = 'shared-files'
             and o.created_at < now() - interval '1 day'
             and not exists (select 1 from public.shared_files f where f.storage_path = o.name)
           limit p_limit) x;

  -- رکوردهایی که بیش از ۱ ساعت از انقضایشان گذشته
  with del as (
    delete from public.shared_files f
     where f.id in (select s.id from public.shared_files s
                     where s.expires_at is not null and s.expires_at < now() - interval '1 hour'
                     limit p_limit)
    returning f.storage_path
  )
  select coalesce(array_agg(del.storage_path), '{}') into v_expired from del;

  return v_orphans || v_expired;
end;
$$;

-- ---------------------------------------------------------------------
-- 10) دسترسی‌ها
-- ---------------------------------------------------------------------
revoke all on function private.gen_share_id(integer) from public, anon, authenticated;

revoke all on function public.register_file(text, text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.get_file_info(text)                               from public, anon, authenticated;
revoke all on function public.get_owned_files(jsonb)                            from public, anon, authenticated;
revoke all on function public.consume_download(text, text)                      from public, anon, authenticated;
revoke all on function public.delete_file_record(text, text)                    from public, anon, authenticated;
revoke all on function public.collect_garbage(integer)                          from public, anon, authenticated;

grant execute on function public.register_file(text, text, text, integer, integer) to anon, authenticated;
grant execute on function public.get_file_info(text)                               to anon, authenticated;
grant execute on function public.get_owned_files(jsonb)                            to anon, authenticated;
grant execute on function public.consume_download(text, text)                      to service_role;
grant execute on function public.delete_file_record(text, text)                    to service_role;
grant execute on function public.collect_garbage(integer)                          to service_role;

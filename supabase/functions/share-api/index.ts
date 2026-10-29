// =====================================================================
//  Supabase Edge Function: share-api
//  عملیات‌هایی که به کلید service_role نیاز دارند:
//    • download → بررسی رمز/انقضا/سقف دانلود + ساخت لینک امضاشده‌ی کوتاه‌مدت
//    • delete   → حذف فایل با کلید مالکیت (رکورد + خود فایل در Storage)
//    • cleanup  → پاک‌سازی فایل‌های منقضی و یتیم (برای Cron، با CRON_SECRET)
//
//  Deploy:  supabase functions deploy share-api --no-verify-jwt
//  متغیرهای اختیاری (supabase secrets set ...):
//    ALLOWED_ORIGINS=https://your-site.com   (پیش‌فرض: *)
//    CRON_SECRET=<یک رشته تصادفی طولانی>      (برای action=cleanup)
//    SIGNED_URL_TTL=60
// =====================================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const BUCKET = Deno.env.get("BUCKET") ?? "shared-files";
const SIGNED_URL_TTL = Number(Deno.env.get("SIGNED_URL_TTL") ?? "60");
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "*")
  .split(",").map((s) => s.trim()).filter(Boolean);

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const STATUS: Record<string, number> = {
  BAD_REQUEST: 400,
  PASSWORD_REQUIRED: 401,
  WRONG_PASSWORD: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  EXPIRED: 410,
  LIMIT_REACHED: 410,
};
const SHARE_ID_RE = /^[A-Za-z0-9]{6,32}$/;

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const allow = ALLOWED_ORIGINS.includes("*")
    ? "*"
    : (ALLOWED_ORIGINS.includes(origin) ? origin : (ALLOWED_ORIGINS[0] ?? ""));
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function reply(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json; charset=utf-8" },
  });
}

function dbCode(err: { message?: string } | null): string {
  const m = (err?.message ?? "").trim();
  return /^[A-Z_]{3,40}$/.test(m) ? m : "SERVER_ERROR";
}

function fail(req: Request, err: { message?: string } | null): Response {
  const code = dbCode(err);
  if (code === "SERVER_ERROR") console.error(err);
  return reply(req, { error: code }, STATUS[code] ?? 500);
}

function safeEqual(a: string, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function handleDownload(req: Request, body: Record<string, unknown>): Promise<Response> {
  const id = String(body.id ?? "");
  if (!SHARE_ID_RE.test(id)) return reply(req, { error: "NOT_FOUND" }, 404);
  const password = typeof body.password === "string" && body.password.length > 0 ? body.password : null;
  if (password && password.length > 128) return reply(req, { error: "WRONG_PASSWORD" }, 401);

  const { data, error } = await admin.rpc("consume_download", { p_share_id: id, p_password: password });
  if (error) return fail(req, error);

  const { data: signed, error: signErr } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(data.storage_path, SIGNED_URL_TTL, { download: data.name });
  if (signErr || !signed) {
    console.error(signErr);
    return reply(req, { error: "SERVER_ERROR" }, 500);
  }
  return reply(req, { url: signed.signedUrl, name: data.name, download_count: data.download_count });
}

async function handleDelete(req: Request, body: Record<string, unknown>): Promise<Response> {
  const id = String(body.id ?? "");
  const token = String(body.owner_token ?? "");
  if (!SHARE_ID_RE.test(id) || !/^[0-9a-f]{48}$/.test(token)) return reply(req, { error: "FORBIDDEN" }, 403);

  const { data: path, error } = await admin.rpc("delete_file_record", { p_share_id: id, p_owner_token: token });
  if (error) return fail(req, error);

  const { error: rmErr } = await admin.storage.from(BUCKET).remove([path as string]);
  if (rmErr) console.error("storage remove failed (cleanup will retry as orphan):", rmErr);
  return reply(req, { ok: true });
}

async function handleCleanup(req: Request): Promise<Response> {
  if (!CRON_SECRET || !safeEqual(req.headers.get("x-cron-secret") ?? "", CRON_SECRET)) {
    return reply(req, { error: "FORBIDDEN" }, 403);
  }
  const { data, error } = await admin.rpc("collect_garbage", { p_limit: 500 });
  if (error) return fail(req, error);
  const paths = Array.from(new Set((data ?? []) as string[]));
  let removed = 0;
  for (let i = 0; i < paths.length; i += 100) {
    const chunk = paths.slice(i, i + 100);
    const { error: rmErr } = await admin.storage.from(BUCKET).remove(chunk);
    if (rmErr) console.error(rmErr); else removed += chunk.length;
  }
  return reply(req, { ok: true, removed });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return reply(req, { error: "BAD_REQUEST" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return reply(req, { error: "BAD_REQUEST" }, 400);
  }

  try {
    switch (body?.action) {
      case "download": return await handleDownload(req, body);
      case "delete": return await handleDelete(req, body);
      case "cleanup": return await handleCleanup(req);
      default: return reply(req, { error: "BAD_REQUEST" }, 400);
    }
  } catch (e) {
    console.error(e);
    return reply(req, { error: "SERVER_ERROR" }, 500);
  }
});

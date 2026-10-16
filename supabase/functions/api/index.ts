/**
 * =====================================================================
 * CS PERSONAL TOOL — BACKEND trên Supabase Edge Function
 * Thay thế Apps Script Web App (/exec), GIỮ NGUYÊN 100% API cũ để frontend
 * (app.js / ui.js) không phải sửa — chỉ đổi API_URL trong config.js.
 *
 *   GET  ?token=...[&sheet=Database]        → { ok, email, sessionToken, profile, deals }
 *   GET  ?warm=1                            → làm ấm (trả invalid_token như cũ)
 *   POST { token, action:'register', hoTen, level, salary, avatar }
 *   POST { token, action:'submitFeedback', title, category, description, expectedDate, attachments }
 *   POST { token, action:'listFeedback' }
 *   POST { token, action:'saveRequest', dealId, reqType, glExtend, requestLink, remove }
 *   POST { token, action:'whoami' }                       → { isAdmin, profile }
 *   POST { token, action:'mcpCreateKey', label }           → { url } (link kết nối Claude, hiện 1 lần)
 *   POST { token, action:'mcpListKeys' } / { action:'mcpRevokeKey', id }
 *   POST { token, action:'adminListFeedback', status } / 'adminUpdateFeedback' {id,status,reply}
 *   POST { token, action:'adminListTodo' } / 'adminSaveTodo' {item} / 'adminDeleteTodo' {id}
 *   POST { token, action:'adminListCs' }                   (admin* chỉ email trong app_admins)
 *   POST { token, multiYearRows:[...] }
 *   POST { token, rows:[...] }
 *
 * Toàn bộ logic dữ liệu nằm trong SQL (supabase/02_api.sql, các hàm api_*).
 * File này chỉ lo: xác thực, gọi hàm SQL, upload file, gửi email.
 *
 * SECRETS (Dashboard → Edge Functions → Secrets):
 *   SESSION_SECRET   bắt buộc — chuỗi ngẫu nhiên dài để ký vé phiên CST1
 *   GOOGLE_CLIENT_ID tuỳ chọn — mặc định = CLIENT_ID trong config.js
 *   RESEND_API_KEY   tuỳ chọn — có thì gửi email báo admin khi có feedback mới
 *   PF_ADMIN_EMAIL   tuỳ chọn — mặc định truong.nguyen@base.vn
 *   MAIL_FROM        tuỳ chọn — địa chỉ gửi (domain đã xác minh trên Resend)
 * (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY Supabase tự cấp sẵn.)
 *
 * PHẢI tắt "Verify JWT" cho function này: frontend không gửi header
 * Authorization — xác thực do chính code dưới đây làm (Google id_token / CST1).
 * =====================================================================
 */
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const SB = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID") ||
  "621765385511-nn699q39euvcf2slmqbv9jp6oi70kpgb.apps.googleusercontent.com";
const ALLOWED_DOMAIN = "base.vn";
const SESSION_SECRET = Deno.env.get("SESSION_SECRET") || "";
const SESSION_TTL_DAYS = 30;
const PF_ADMIN_EMAIL = Deno.env.get("PF_ADMIN_EMAIL") || "truong.nguyen@base.vn";
const PF_BUCKET = "feedback";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json_(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
  });
}

// ---------------------------------------------------------------------
// AUTH — y hệt Apps Script: Google id_token (lần đầu) hoặc vé phiên CST1
// ---------------------------------------------------------------------
const enc = new TextEncoder();

// Giống Utilities.base64EncodeWebSafe (giữ dấu "=")
function b64WebSafe(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_");
}
function b64WebSafeDecode(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

let hmacKey: CryptoKey | null = null;
async function hmac_(text: string): Promise<string> {
  if (!SESSION_SECRET) throw new Error("Thiếu secret SESSION_SECRET");
  if (!hmacKey) {
    hmacKey = await crypto.subtle.importKey(
      "raw", enc.encode(SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
    );
  }
  const sig = await crypto.subtle.sign("HMAC", hmacKey, enc.encode(text));
  return b64WebSafe(new Uint8Array(sig));
}

async function mintSessionToken_(email: string): Promise<string> {
  const payload = JSON.stringify({ email, exp: Date.now() + SESSION_TTL_DAYS * 86400000 });
  const payloadB64 = b64WebSafe(enc.encode(payload));
  return "CST1." + payloadB64 + "." + (await hmac_(payloadB64));
}

function domainOk_(email: string): boolean {
  return !ALLOWED_DOMAIN || email.split("@")[1] === ALLOWED_DOMAIN;
}

async function verifySessionToken_(token: string): Promise<string | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3 || parts[0] !== "CST1") return null;
    if (parts[2] !== (await hmac_(parts[1]))) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64WebSafeDecode(parts[1])));
    if (!payload.exp || Date.now() > payload.exp) return null;
    const email = String(payload.email || "").toLowerCase();
    return domainOk_(email) ? email : null;
  } catch {
    return null;
  }
}

const googleCache = new Map<string, { email: string; until: number }>();
async function verifyGoogleIdToken_(token: string): Promise<string | null> {
  const hit = googleCache.get(token);
  if (hit && hit.until > Date.now()) return hit.email;
  try {
    const resp = await fetch(
      "https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(token),
    );
    if (resp.status !== 200) return null;
    const info = await resp.json();
    if (info.aud !== CLIENT_ID) return null;
    if (String(info.email_verified) !== "true") return null;
    const email = String(info.email || "").toLowerCase();
    if (!domainOk_(email)) return null;
    googleCache.set(token, { email, until: Date.now() + 300_000 });
    return email;
  } catch {
    return null;
  }
}

function verifyToken_(token: string): Promise<string | null> {
  if (!token) return Promise.resolve(null);
  if (token.indexOf("CST1.") === 0) return verifySessionToken_(token);
  return verifyGoogleIdToken_(token);
}

// ---------------------------------------------------------------------
// Gọi hàm SQL api_* — lỗi SQL (raise exception) trả về đúng message tiếng Việt
// ---------------------------------------------------------------------
async function rpc_<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await SB.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

// ---------------------------------------------------------------------
// PRODUCT FEEDBACK — upload file lên Storage, email admin qua Resend (nếu có)
// ---------------------------------------------------------------------
async function uploadFeedbackFiles_(
  attachments: Array<{ name?: string; mime?: string; data?: string }> | undefined,
  feedbackId: string,
): Promise<string[]> {
  const urls: string[] = [];
  if (!attachments || !attachments.length) return urls;
  for (let i = 0; i < attachments.length; i++) {
    const a = attachments[i];
    try {
      if (!a || !a.data) continue;
      const bytes = Uint8Array.from(atob(a.data), (c) => c.charCodeAt(0));
      const safe = String(a.name || "file" + (i + 1)).replace(/[^\w.\-]+/g, "_");
      const path = feedbackId + "/" + safe;
      const { error } = await SB.storage.from(PF_BUCKET).upload(path, bytes, {
        contentType: a.mime || "application/octet-stream",
        upsert: true,
      });
      if (error) continue; // bỏ qua file lỗi, không chặn cả feedback (như bản cũ)
      urls.push(SB.storage.from(PF_BUCKET).getPublicUrl(path).data.publicUrl);
    } catch { /* bỏ qua */ }
  }
  return urls;
}

async function sendMail_(to: string, subject: string, text: string): Promise<void> {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return; // chưa cấu hình email → bỏ qua, không chặn việc lưu
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: Deno.env.get("MAIL_FROM") || "CS Tool <onboarding@resend.dev>",
        to: [to],
        subject,
        text,
      }),
    });
  } catch { /* email lỗi không chặn việc lưu */ }
}

// ---------------------------------------------------------------------
// KẾT NỐI CLAUDE (MCP) + QUẢN TRỊ — logic + phân quyền nằm trong SQL (03_admin_mcp.sql)
// ---------------------------------------------------------------------
async function sha256Hex_(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// deno-lint-ignore no-explicit-any
async function extraAction_(body: any, email: string): Promise<Record<string, unknown>> {
  switch (body.action) {
    case "whoami": {
      const [isAdmin, profile] = await Promise.all([
        rpc_<boolean>("api_is_admin", { p_email: email }),
        rpc_("api_get_profile", { p_email: email }),
      ]);
      return { email, isAdmin: !!isAdmin, profile: profile ?? null };
    }
    case "mcpCreateKey": {
      // Khoá ngẫu nhiên 32 byte; DB chỉ giữ SHA-256 → link chỉ hiện đúng 1 lần
      const key = "csk_" + b64WebSafe(crypto.getRandomValues(new Uint8Array(32))).replace(/=+$/, "");
      const info = await rpc_<Record<string, unknown>>("api_mcp_create_key", {
        p_email: email, p_hash: await sha256Hex_(key), p_label: String(body.label || ""),
      });
      return { key: info, url: Deno.env.get("SUPABASE_URL") + "/functions/v1/mcp/" + key };
    }
    case "mcpListKeys":
      return { items: await rpc_("api_mcp_list_keys", { p_email: email }) };
    case "mcpRevokeKey":
      await rpc_("api_mcp_revoke_key", { p_email: email, p_id: String(body.id || "") });
      return {};
    case "adminListFeedback":
      return { items: await rpc_("api_admin_list_feedback", { p_email: email, p_status: body.status || null }) };
    case "adminUpdateFeedback": {
      const r = await rpc_<{ senderEmail?: string; title?: string; status?: string; response?: string }>(
        "api_admin_update_feedback",
        {
          p_email: email, p_id: String(body.id || ""),
          p_status: body.status == null ? null : String(body.status),
          p_reply: body.reply == null ? null : String(body.reply),
        },
      );
      if (r && r.senderEmail && body.notify !== false) {
        await sendMail_(
          r.senderEmail,
          "[CS Tool] Feedback của bạn đã được cập nhật: " + (r.title || ""),
          "Trạng thái: " + (r.status || "") + (r.response ? "\n\nPhản hồi từ team:\n" + r.response : "") +
            "\n\nXem chi tiết trong CS Console → Product Feedback.",
        );
      }
      return { item: r };
    }
    case "adminListTodo":
      return { items: await rpc_("api_admin_list_todo", { p_email: email }) };
    case "adminSaveTodo":
      return { item: await rpc_("api_admin_save_todo", { p_email: email, p_item: body.item || {} }) };
    case "adminDeleteTodo":
      await rpc_("api_admin_delete_todo", { p_email: email, p_id: Number(body.id) });
      return {};
    case "adminListCs":
      return { items: await rpc_("api_admin_list_cs", { p_email: email }) };
    default:
      throw new Error("action không hỗ trợ: " + body.action);
  }
}

// ---------------------------------------------------------------------
// ENTRYPOINT
// ---------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  try {
    // ------------------------------- GET -------------------------------
    if (req.method === "GET") {
      const url = new URL(req.url);
      const email = await verifyToken_(url.searchParams.get("token") || "");
      if (!email) return json_({ ok: false, error: "invalid_token" });
      const [profile, deals, isAdmin] = await Promise.all([
        rpc_("api_get_profile", { p_email: email }),
        rpc_("api_get_deals_json", { p_email: email }),
        rpc_<boolean>("api_is_admin", { p_email: email }),
      ]);
      return json_({
        ok: true,
        email,
        sessionToken: await mintSessionToken_(email),
        profile: profile ?? null, // null = chưa đăng ký → frontend hiện form
        deals: deals ?? [],
        isAdmin: !!isAdmin,
      });
    }

    // ------------------------------- POST ------------------------------
    // Frontend gửi Content-Type text/plain (tránh preflight CORS) → tự parse
    const raw = await req.text();
    const body = JSON.parse(raw || "{}");
    const email = await verifyToken_(body.token || "");
    if (!email) return json_({ ok: false, error: "invalid_token" });
    const sessionToken = await mintSessionToken_(email);

    if (body.action === "register") {
      const hoTen = String(body.hoTen || "").trim();
      const level = String(body.level || "").trim();
      if (!hoTen || !level) return json_({ ok: false, error: "missing_fields", sessionToken });
      const profile = await rpc_("api_register", {
        p_email: email,
        p_ho_ten: hoTen,
        p_level: level,
        p_salary: body.salary == null ? "" : String(body.salary),
        p_avatar: String(body.avatar || ""),
      });
      return json_({ ok: true, profile, sessionToken });
    }

    if (body.action === "submitFeedback") {
      const id = "PF" + Date.now().toString(36).toUpperCase();
      const urls = await uploadFeedbackFiles_(body.attachments, id);
      const profile = await rpc_<{ hoTen?: string } | null>("api_get_profile", { p_email: email });
      const name = (profile && profile.hoTen) || "";
      await rpc_("api_submit_feedback", {
        p_id: id,
        p_email: email,
        p_name: name,
        p_title: body.title || "",
        p_category: body.category || "",
        p_description: body.description || "",
        p_attachments: urls,
        p_expected: body.expectedDate || "",
      });
      const m = String(body.expectedDate || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
      const expStr = m ? m[3] + "/" + m[2] + "/" + m[1] : "";
      await sendMail_(
        PF_ADMIN_EMAIL,
        "[CS Tool] Feedback mới: " + (body.title || "(không tiêu đề)"),
        [
          "Có feedback mới từ: " + (name ? name + " (" + email + ")" : email),
          "Loại: " + (body.category || "—"),
          "Tiêu đề: " + (body.title || "—"),
          "",
          "Mô tả:",
          body.description || "—",
          "",
          "Ngày kỳ vọng: " + (expStr || "—"),
          "File đính kèm: " + (urls.length ? urls.join("  |  ") : "không có"),
          "",
          "Mã feedback: " + id + " — cập nhật trạng thái trong bảng product_feedback (Supabase).",
        ].join("\n"),
      );
      return json_({ ok: true, id, attachments: urls, sessionToken });
    }

    if (body.action === "saveRequest") {
      try {
        await rpc_("api_save_request", {
          p_email: email,
          p_deal_id: String(body.dealId ?? ""),
          p_type: String(body.reqType || ""),
          p_gl_extend: body.glExtend == null ? "" : String(body.glExtend),
          p_link: body.requestLink == null ? "" : String(body.requestLink),
          p_remove: !!body.remove,
        });
        return json_({ ok: true, sessionToken });
      } catch (reqErr) {
        return json_({ ok: false, error: String((reqErr as Error).message || reqErr), sessionToken });
      }
    }

    if (body.action === "listFeedback") {
      const items = await rpc_("api_list_feedback", { p_email: email });
      return json_({ ok: true, items: items ?? [], sessionToken });
    }

    // ---- Kết nối Claude (MCP) + Quản trị: lỗi trả { ok:false, error } như saveRequest ----
    if (typeof body.action === "string" && (body.action === "whoami" || /^(mcp|admin)[A-Z]/.test(body.action))) {
      try {
        return json_({ ok: true, ...(await extraAction_(body, email)), sessionToken });
      } catch (e) {
        return json_({ ok: false, error: String((e as Error).message || e), sessionToken });
      }
    }

    if (body.multiYearRows && body.multiYearRows.length) {
      const updated = await rpc_("api_save_multiyear", { p_email: email, p_rows: body.multiYearRows });
      return json_({ ok: true, updated, sessionToken });
    }

    const updated = await rpc_("api_save_rows", { p_email: email, p_rows: body.rows || [] });
    return json_({ ok: true, updated, sessionToken });
  } catch (err) {
    return json_({ ok: false, error: String((err as Error)?.message || err) });
  }
});

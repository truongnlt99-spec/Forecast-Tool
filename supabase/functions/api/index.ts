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
 *   POST { token, action:'careerGet', quarter? }           → commit + số thực tế quý + % loading
 *   POST { token, action:'careerSaveCommit', quarter, targetLevel, cr, s1, s4 }
 *   POST { token, action:'careerAchieve', quarter, newSalary? }   (Đạt → lên level ngay)
 *   POST { token, action:'careerDeleteCommit', quarter }    (xoá commit; đã Đạt lên level → trả level/lương cũ)
 *   POST { token, action:'phuocGet' } / { action:'phuocAdd', n }  → { mine, total } (nút "Cộng phước", cho vui)
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
 *   MCP_PUBLIC_BASE  tuỳ chọn — đầu link kết nối Claude, mặc định https://csconsole.vercel.app/mcp/
 *                    (vercel.json / netlify.toml chuyển tiếp /mcp/* sang Edge Function mcp)
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
// Link kết nối Claude đưa cho người dùng: domain CS Console (vercel.json chuyển tiếp /mcp/* sang
// Edge Function mcp) thay cho link supabase.co. Khoá cũ vẫn dùng được ở cả 2 link.
const MCP_PUBLIC_BASE = Deno.env.get("MCP_PUBLIC_BASE") || "https://csconsole.vercel.app/mcp/";

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

// ---------------------------------------------------------------------
// CAREER PATH THEO QUÝ — commit CR / SRR_1 / SRR_4, % loading, bấm Đạt (lên level)
// Số thực tế tính Ở ĐÂY (máy chủ) từ dữ liệu đã lưu, vì bấm Đạt đổi level + lương ngay:
// không tin số trình duyệt gửi lên. Bảng/ghi dữ liệu: supabase/04_career_path.sql.
// ---------------------------------------------------------------------
// Mốc KPI (CR/SRR_1/SRR_4) + khung lương — CHÉP TỪ bảng LEVELS trong app.js (policy 6.1/6.2).
// tests/career.test.mjs so khớp 2 nơi; policy đổi thì sửa cả 2.
const CAREER_LEVELS: Record<string, { lo: number; hi: number; kpi: { cr: number; s1: number; s4: number } }> = {
  "CS level 1": { lo: 10000000, hi: 13000000, kpi: { cr: 75, s1: 78, s4: 75 } },
  "CS level 2": { lo: 11000000, hi: 14000000, kpi: { cr: 75, s1: 78, s4: 76 } },
  "CS level 3": { lo: 12000000, hi: 15000000, kpi: { cr: 78, s1: 80, s4: 78 } },
  "CS level 4": { lo: 13000000, hi: 17000000, kpi: { cr: 78, s1: 80, s4: 79 } },
  "CS level 5": { lo: 15000000, hi: 20000000, kpi: { cr: 81, s1: 82, s4: 81 } },
  "CS level 6": { lo: 20000000, hi: 25000000, kpi: { cr: 85, s1: 85, s4: 83 } },
  "CS level 7": { lo: 25000000, hi: 35000000, kpi: { cr: 87, s1: 85, s4: 85 } },
};
const CAREER_ORDER = Object.keys(CAREER_LEVELS);
// TẠO BÙ: quý đã qua vẫn cho chốt commit tới hết tháng ghi ở đây (CS khai level đầu quý).
// Q3/2026: Career path ra mắt giữa Q4 → mở bù tới hết 10/2026 (= hạn bấm Đạt của Q3).
const CAREER_BACKFILL: Record<string, string> = { "Q3/2026": "10/2026" };
const CAREER_KEYS = ["cr", "s1", "s4"] as const;
const CAREER_NAME = { cr: "CR", s1: "SRR_1", s4: "SRR_4" };
type CareerKey = typeof CAREER_KEYS[number];
type Row = Record<string, string>;

// "4.375.000" / "92,5" / "50,00%" → số
function numVN(v: unknown): number {
  const n = Number(String(v ?? "").replace(/[%\s]/g, "").replace(/\./g, "").replace(",", "."));
  return isFinite(n) ? n : 0;
}
function monthOf(d: string): string { // "dd/mm/yyyy" → "MM/YYYY"
  const m = String(d || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? m[2].padStart(2, "0") + "/" + m[3] : "";
}
function mCmp(a: string, b: string): number {
  const p = a.split("/"), q = b.split("/");
  return (Number(p[1]) - Number(q[1])) || (Number(p[0]) - Number(q[0]));
}
function mShift(m: string, n: number): string {
  const [mm, yy] = m.split("/").map(Number);
  const t = yy * 12 + (mm - 1) + n;
  return String(t % 12 + 1).padStart(2, "0") + "/" + Math.floor(t / 12);
}
// Quy tắc CR — giống crIn() trong app.js và tool cr_summary của MCP (quyết định 15–16/10/2026)
function contractCounted(c: string): boolean {
  const s = String(c || "").toLowerCase().trim();
  if (!s || s === "renew" || s === "—") return false;
  return /(^|[^a-z])new|upsale|up-sell|cross|expansion|renew csm|renew triển khai lại/.test(s);
}
function crIn(d: Row, m: string): { dat: boolean; noDen?: boolean } | null {
  const crMonth = d["Tháng ghi nhận CR"];
  const stop = String(d["Dừng triển khai"] || "").trim().toLowerCase();
  if (!/^\d{2}\/\d{4}$/.test(crMonth || "") || !contractCounted(d["Loại hợp đồng"]) || (stop && stop !== "false")) return null;
  const g = monthOf(d["Ngày go-live thực tế"]);
  if (g) {
    if (mCmp(g, crMonth) < 0) return m === g ? { dat: true, noDen: true } : null;
    if (g === crMonth) return m === g ? { dat: true } : null;
    if (mCmp(m, crMonth) < 0 || mCmp(m, g) > 0) return null;
    return { dat: m === g };
  }
  if (mCmp(m, crMonth) < 0) return null;
  return { dat: false };
}
// SRR: giống countsForSrr() trong app.js — loại HĐ được tính + không phải PS/PaS
function countsForSrr(d: Row): boolean {
  const b = String(d["Bộ giải pháp"] || "").trim().toUpperCase();
  return contractCounted(d["Loại hợp đồng"]) && b !== "PS" && b !== "PAS";
}

function currentMonth(): string { // giờ Việt Nam
  const d = new Date(Date.now() + 7 * 3600_000);
  return String(d.getUTCMonth() + 1).padStart(2, "0") + "/" + d.getUTCFullYear();
}
function quarterOfMonth(m: string): string { // "11/2026" → "Q4/2026"
  const [mm, yy] = m.split("/");
  return "Q" + Math.ceil(Number(mm) / 3) + "/" + yy;
}
function quarterMonths(q: string): string[] {
  const [qq, yy] = q.slice(1).split("/");
  const first = String((Number(qq) - 1) * 3 + 1).padStart(2, "0") + "/" + yy;
  return [0, 1, 2].map((i) => mShift(first, i));
}
// Giai đoạn của quý so với tháng hiện tại:
//  future → chưa tới · commit → tháng 1–2 (chốt/sửa commit) · achieve → tháng 3 (vẫn sửa
//  commit được) + tháng đầu quý sau (chỉ bấm Đạt) · closed → quá hạn bấm Đạt
//  backfill → quý đã qua đang mở TẠO BÙ (CAREER_BACKFILL): vẫn chốt/sửa commit được
function careerPhase(q: string, now = currentMonth()) {
  const months = quarterMonths(q), deadline = mShift(months[2], 1);
  const backfill = !!CAREER_BACKFILL[q] && mCmp(now, months[2]) > 0 && mCmp(now, CAREER_BACKFILL[q]) <= 0;
  const canEdit = months.includes(now) || backfill;
  const canAchieveWindow = now === months[2] || now === deadline;
  let phase = "closed";
  if (mCmp(now, months[0]) < 0) phase = "future";
  else if (canAchieveWindow) phase = "achieve";
  else if (canEdit) phase = "commit";
  return { phase, canEdit, canAchieveWindow, deadline, months, backfill };
}

// Chỉ tính các tháng ĐÃ TỚI của quý (giữa quý không cộng sẵn mẫu số / kỳ đo của tháng sau)
function careerActuals(deals: Row[], q: string, now = currentMonth()) {
  const all = quarterMonths(q), months = all.filter((m) => mCmp(m, now) <= 0);
  // SRR theo policy: Σ DT phần mềm có CHS_CS ≥ 50 ÷ Σ DT phần mềm có kỳ đo trong các tháng
  const srr = (ky: "T1" | "T4", only: string[]) => {
    let n = 0, nOk = 0, sumAll = 0, sumOk = 0;
    for (const d of deals) {
      if (!only.includes(d["Tháng đo " + ky]) || !countsForSrr(d)) continue;
      const chs = String(d["CHS_CS " + ky] || "").trim();
      const v = numVN(d["Giá trị phần mềm bộ (VNĐ)"]);
      n++; sumAll += v;
      if (chs !== "" && numVN(chs) >= 50) { nOk++; sumOk += v; }
    }
    return { v: sumAll > 0 ? Math.round(sumOk / sumAll * 10000) / 100 : null, n, nOk, sumAll, sumOk };
  };
  // CR quý = cộng dồn tử/mẫu của từng tháng (deal trễ nằm trong mẫu số mọi tháng tới khi go-live)
  const cr = (only: string[]) => {
    let phai = 0, dat = 0, n = 0;
    for (const m of only) {
      for (const d of deals) {
        const x = crIn(d, m);
        if (!x) continue;
        const v = numVN(d["DT phải go-live"]);
        n++;
        if (!x.noDen) phai += v;
        if (x.dat) dat += v;
      }
    }
    return { v: phai > 0 ? Math.round(dat / phai * 10000) / 100 : null, n, phai, dat };
  };
  return {
    cr: cr(months), s1: srr("T1", months), s4: srr("T4", months),
    byMonth: all.map((m) => mCmp(m, now) > 0 ? { month: m, future: true }
      : { month: m, cr: cr([m]), s1: srr("T1", [m]), s4: srr("T4", [m]) }),
  };
}

// % loading = thực tế ÷ commit. Bỏ qua khi xét Đạt: chỉ số trống (quý không có deal tính) và
// chỉ số không commit (SRR_4 khi tạo bù được để trống).
function careerEvaluate(commit: Record<string, unknown> | null, act: ReturnType<typeof careerActuals>) {
  const items: Record<string, { actual: number | null; commit: number | null; loading: number | null; met: boolean | null }> = {};
  let present = 0, met = 0;
  for (const k of CAREER_KEYS) {
    const raw = commit ? commit[k] : null;
    const c = raw == null || raw === "" ? null : Number(raw);
    const a = act[k].v;
    const ok = a != null && c != null && a >= c;
    if (a != null && (c != null || !commit)) { present++; if (ok) met++; }
    items[k] = { actual: a, commit: c, loading: a == null || !c ? null : Math.round(a / c * 1000) / 10, met: a == null || (commit && c == null) ? null : ok };
  }
  return { items, present, met, allMet: !!commit && present > 0 && met === present };
}

// Biểu đồ thăng tiến: level CS giữ TRONG từng quý, từ quý commit đầu tiên tới quý hiện tại,
// cộng 1 điểm "kế hoạch" ở quý sau = level mục tiêu của commit quý hiện tại (nếu có).
//  quý đã qua có commit → level đầu quý (baseLevel); không commit → nối tiếp level cuối quý trước;
//  quý hiện tại → level trong hồ sơ; Đạt có lên level → quý sau bắt đầu ở level mục tiêu.
// deno-lint-ignore no-explicit-any
function careerTrack(commits: any[], level: string, now = currentMonth()) {
  const curQ = quarterOfMonth(now);
  const qStart = (q: string) => quarterMonths(q)[0];
  const byQ: Record<string, { quarter: string; baseLevel: string; targetLevel: string; status: string }> = {};
  for (const c of commits) byQ[c.quarter] = c;
  const past = Object.keys(byQ).filter((q) => mCmp(qStart(q), qStart(curQ)) < 0).sort((a, b) => mCmp(qStart(a), qStart(b)));
  const points: Array<{ quarter: string; level: string; kind: string; status: string; levelUp: boolean }> = [];
  let carry = "";
  if (past.length) {
    for (let q = past[0]; mCmp(qStart(q), qStart(curQ)) < 0; q = quarterOfMonth(mShift(qStart(q), 3))) {
      const c = byQ[q];
      const start = c ? c.baseLevel : carry;
      const status = c ? (c.status === "open" && careerPhase(q, now).phase === "closed" ? "missed" : c.status) : "none";
      const up = !!c && c.status === "achieved" && CAREER_ORDER.indexOf(c.targetLevel) > CAREER_ORDER.indexOf(start);
      if (start) points.push({ quarter: q, level: start, kind: "past", status, levelUp: up });
      carry = up ? c.targetLevel : start;
    }
  }
  const cur = byQ[curQ];
  points.push({ quarter: curQ, level, kind: "current", status: cur ? cur.status : "none", levelUp: false });
  if (cur && cur.status === "open") {
    points.push({ quarter: quarterOfMonth(mShift(qStart(curQ), 3)), level: cur.targetLevel, kind: "plan", status: "plan",
      levelUp: CAREER_ORDER.indexOf(cur.targetLevel) > CAREER_ORDER.indexOf(level) });
  }
  return points;
}

function trimKeys(rows: Row[]): Row[] {
  return (rows || []).map((r) => {
    const o: Row = {};
    for (const [k, v] of Object.entries(r)) o[k.trim()] = v == null ? "" : String(v);
    return o;
  });
}

// deno-lint-ignore no-explicit-any
type CareerList = { commits: any[]; levelHistory: any[] };
async function careerLoad_(email: string) {
  const [profile, list, deals] = await Promise.all([
    rpc_<{ level?: string; salary?: string } | null>("api_get_profile", { p_email: email }),
    rpc_<CareerList | null>("api_career_list", { p_email: email }),
    rpc_<Row[] | null>("api_get_deals_json", { p_email: email }),
  ]);
  return { profile, list: list || { commits: [], levelHistory: [] }, deals: trimKeys(deals || []) };
}

function careerView_(q: string, data: Awaited<ReturnType<typeof careerLoad_>>) {
  const level = String(data.profile?.level || "");
  const idx = CAREER_ORDER.indexOf(level);
  const now = currentMonth(), curQ = quarterOfMonth(now);
  const commit = data.list.commits.find((c) => c.quarter === q) || null;
  const ph = careerPhase(q, now);
  const actuals = careerActuals(data.deals, q, now);
  const evaluation = careerEvaluate(commit, actuals);
  const statusOf = (c: { status: string; quarter: string }) =>
    c.status === "open" && careerPhase(c.quarter, now).phase === "closed" ? "missed" : c.status;
  const status = commit ? statusOf(commit) : "none";
  // Quý chọn được: quý hiện tại, quý trước (tháng đầu quý mới vẫn còn hạn bấm Đạt), các quý đã commit
  const backfillOpen = Object.keys(CAREER_BACKFILL).filter((bq) => careerPhase(bq, now).backfill);
  const quarters = Array.from(new Set([curQ, quarterOfMonth(mShift(now, -1)), ...backfillOpen, ...data.list.commits.map((c) => c.quarter)]))
    .sort((a, b) => mCmp(quarterMonths(b)[0], quarterMonths(a)[0]));
  const levelUp = !!commit && CAREER_ORDER.indexOf(commit.targetLevel) > idx;
  return {
    quarter: q, currentQuarter: curQ, now, quarters,
    eligible: idx >= 0, level, salary: data.profile?.salary || "",
    levels: CAREER_LEVELS, order: CAREER_ORDER, nextLevels: idx >= 0 ? CAREER_ORDER.slice(idx + 1) : [],
    ...ph, status, commit, actuals, evaluation, levelUp,
    canAchieve: idx >= 0 && status === "open" && ph.canAchieveWindow && evaluation.allMet,
    // xoá được khi quý còn trong hạn sửa commit hoặc hạn bấm Đạt (kể cả đã Đạt — để làm lại)
    canDelete: !!commit && (ph.canEdit || ph.canAchieveWindow),
    commits: data.list.commits.map((c) => ({
      quarter: c.quarter, status: statusOf(c), baseLevel: c.baseLevel, targetLevel: c.targetLevel, achievedAt: c.achievedAt,
    })),
    levelHistory: data.list.levelHistory,
    track: careerTrack(data.list.commits, level, now),
    // quý đang mở tạo bù mà CS chưa commit → giao diện nhắc
    backfillPending: backfillOpen.filter((bq) => !data.list.commits.some((c) => c.quarter === bq)),
    backfillDeadline: CAREER_BACKFILL,
  };
}

// deno-lint-ignore no-explicit-any
async function careerAction_(body: any, email: string): Promise<Record<string, unknown>> {
  const isQ = (s: unknown): s is string => typeof s === "string" && /^Q[1-4]\/\d{4}$/.test(s);
  const data = await careerLoad_(email);
  const level = String(data.profile?.level || "");
  const idx = CAREER_ORDER.indexOf(level);
  switch (body.action) {
    case "careerGet":
      return careerView_(isQ(body.quarter) ? body.quarter : quarterOfMonth(currentMonth()), data);
    case "careerSaveCommit": {
      if (idx < 0) throw new Error("Career path hiện chỉ áp dụng cho CS level 1–7");
      const q = body.quarter;
      const ph = isQ(q) ? careerPhase(q) : null;
      if (!ph || !ph.canEdit) throw new Error("Chỉ chốt/sửa commit được trong quý đang chạy (hoặc quý đang mở tạo bù)");
      const old = data.list.commits.find((c) => c.quarter === q);
      if (old && old.status === "achieved") throw new Error("Quý " + q + " đã bấm Đạt — không sửa commit được nữa");
      // Tạo bù: CS khai level ĐẦU quý đó (có thể thấp hơn level hiện tại nếu đã lên level rồi)
      const base = ph.backfill ? String(body.baseLevel || level) : level;
      const bi = CAREER_ORDER.indexOf(base);
      if (bi < 0 || bi > idx) throw new Error("Level đầu quý không hợp lệ (không cao hơn level hiện tại)");
      const target = String(body.targetLevel || base);
      const ti = CAREER_ORDER.indexOf(target);
      if (ti < bi) throw new Error("Level mục tiêu không hợp lệ");
      const vals: Record<CareerKey, number | null> = { cr: 0, s1: 0, s4: 0 };
      for (const k of CAREER_KEYS) {
        // Tạo bù: SRR_4 không bắt buộc (quý đó có thể chưa có kỳ đo T4) → null = không xét SRR_4
        if (k === "s4" && ph.backfill && (body.s4 == null || String(body.s4).trim() === "")) { vals.s4 = null; continue; }
        const v = Number(body[k]);
        if (!isFinite(v) || v <= 0 || v > 100) throw new Error(CAREER_NAME[k] + " phải là số lớn hơn 0 và tối đa 100");
        const floor = CAREER_LEVELS[target].kpi[k];
        if (ti > bi && v < floor) throw new Error(CAREER_NAME[k] + " commit tối thiểu " + floor + "% (mốc KPI của " + target + ")");
        vals[k as CareerKey] = Math.round(v * 100) / 100;
      }
      await rpc_("api_career_save_commit", {
        p_email: email, p_quarter: q, p_base_level: base, p_target_level: target,
        p_cr: vals.cr, p_s1: vals.s1, p_s4: vals.s4,
      });
      return careerView_(q, await careerLoad_(email));
    }
    case "careerAchieve": {
      const q = body.quarter;
      if (!isQ(q)) throw new Error("Quý không hợp lệ");
      const v = careerView_(q, data);
      if (!v.eligible) throw new Error("Career path hiện chỉ áp dụng cho CS level 1–7");
      if (!v.commit) throw new Error("Chưa có commit cho quý " + q);
      if (v.status !== "open") throw new Error("Quý " + q + " không còn mở để bấm Đạt");
      if (!v.canAchieveWindow) throw new Error("Chỉ bấm Đạt được từ tháng cuối quý tới hết tháng đầu quý sau");
      if (!v.evaluation.allMet) throw new Error("Số thực tế chưa đạt commit — chưa bấm Đạt được");
      let newLevel: string | null = null, newSalary: number | null = null;
      if (v.levelUp) {
        const t = CAREER_LEVELS[v.commit.targetLevel];
        newSalary = Number(String(body.newSalary ?? "").replace(/[^\d]/g, "")) || null;
        if (!newSalary || newSalary < t.lo || newSalary > t.hi) {
          throw new Error("Lương mới phải trong khung " + t.lo.toLocaleString("vi-VN") + " – " + t.hi.toLocaleString("vi-VN") + " đ");
        }
        newLevel = v.commit.targetLevel;
      }
      const snapshot = { at: new Date().toISOString(), level, actuals: v.actuals, evaluation: v.evaluation };
      await rpc_("api_career_achieve", {
        p_email: email, p_quarter: q, p_new_level: newLevel, p_new_salary: newSalary, p_snapshot: snapshot,
      });
      return careerView_(q, await careerLoad_(email));
    }
    case "careerDeleteCommit": {
      const q = body.quarter;
      if (!isQ(q)) throw new Error("Quý không hợp lệ");
      const v = careerView_(q, data);
      if (!v.commit) throw new Error("Không có commit quý " + q + " để xoá");
      if (!v.canDelete) throw new Error("Quý " + q + " đã hết hạn — không xoá commit được nữa");
      await rpc_("api_career_delete_commit", { p_email: email, p_quarter: q });
      return careerView_(q, await careerLoad_(email));
    }
    default:
      throw new Error("action không hỗ trợ: " + body.action);
  }
}

// deno-lint-ignore no-explicit-any
async function extraAction_(body: any, email: string): Promise<Record<string, unknown>> {
  if (/^career[A-Z]/.test(String(body.action))) return careerAction_(body, email);
  switch (body.action) {
    case "phuocGet":
      return await rpc_<Record<string, unknown>>("api_phuoc_get", { p_email: email });
    case "phuocAdd": {
      const n = Math.floor(Number(body.n));
      if (!(n >= 1 && n <= 200)) throw new Error("Số lần cộng phước không hợp lệ");
      return await rpc_<Record<string, unknown>>("api_phuoc_add", { p_email: email, p_n: n });
    }
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
      return { key: info, url: MCP_PUBLIC_BASE + key };
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
    if (typeof body.action === "string" && (body.action === "whoami" || /^(mcp|admin|career|phuoc)[A-Z]/.test(body.action))) {
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

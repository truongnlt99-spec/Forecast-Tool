/**
 * =====================================================================
 * CS CONSOLE — MCP SERVER (kết nối Claude) trên Supabase Edge Function
 *
 *   URL: https://<project>.supabase.co/functions/v1/mcp/<khoá cá nhân>
 *
 * Mỗi người tự tạo link trong CS Console (mục "Kết nối Claude") rồi dán vào
 * claude.ai → Settings → Connectors → Add custom connector. Khoá gắn với đúng
 * 1 email: chỉ đọc/sửa dữ liệu & quyền của email đó (giống giao diện web).
 * Email nằm trong bảng app_admins thấy thêm tool quản trị (feedback, todo,
 * danh sách CS). DB chỉ lưu SHA-256 của khoá; thu hồi khoá → link chết ngay.
 *
 * Giao thức: MCP Streamable HTTP, chỉ trả JSON (không mở SSE). Mọi logic dữ
 * liệu + phân quyền nằm trong hàm SQL api_* (02_api.sql, 03_admin_mcp.sql).
 *
 * PHẢI tắt "Verify JWT" cho function này (Claude không gửi JWT Supabase).
 * =====================================================================
 */
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const SB = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);
const PF_ADMIN_EMAIL = Deno.env.get("PF_ADMIN_EMAIL") || "truong.nguyen@base.vn";
const SUPPORTED_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

// ---------------------------------------------------------------------
// Tiện ích
// ---------------------------------------------------------------------
async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await SB.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

class ToolError extends Error {}

// Số kiểu Việt Nam "4.375.000" / "86,19%" → number
function numVN(v: unknown): number {
  const s = String(v ?? "").replace(/[%\s]/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return isFinite(n) ? n : 0;
}
// "dd/mm/yyyy" → "MM/YYYY"
function monthOf(d: string): string {
  const m = String(d || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? m[2].padStart(2, "0") + "/" + m[3] : "";
}
function mCmp(a: string, b: string): number {
  const p = a.split("/"), q = b.split("/");
  return (Number(p[1]) - Number(q[1])) || (Number(p[0]) - Number(q[0]));
}
function isMonth(s: unknown): s is string {
  return typeof s === "string" && /^\d{2}\/\d{4}$/.test(s);
}
function isDateVN(s: unknown): s is string {
  return typeof s === "string" && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s.trim());
}
function thisMonth(): string {
  const d = new Date(Date.now() + 7 * 3600_000); // giờ Việt Nam
  return String(d.getUTCMonth() + 1).padStart(2, "0") + "/" + d.getUTCFullYear();
}

// ---------------------------------------------------------------------
// Deal: đọc từ api_get_deals_json (đúng bộ cột + đúng quyền của web)
// ---------------------------------------------------------------------
type Deal = Record<string, string>;

async function myDeals(email: string): Promise<Deal[]> {
  const rows = await rpc<Record<string, unknown>[]>("api_get_deals_json", { p_email: email });
  return (rows || []).map((r) => {
    const o: Deal = {};
    for (const [k, v] of Object.entries(r)) o[k.trim()] = v == null ? "" : String(v);
    return o;
  });
}

const COMPACT_KEYS = [
  "Deal ID", "Tên khách hàng", "Tên công ty", "Bộ giải pháp", "Loại hợp đồng", "Tier",
  "Giá trị phần mềm bộ (VNĐ)", "Ngày nhận deal", "Ngày go-live dự kiến", "Ngày go-live thực tế",
  "Nguồn go-live", "Ngày go-live gia hạn", "Dừng triển khai", "Trạng thái go-live",
  "Tháng ghi nhận CR", "DT phải go-live", "DT go-live đạt", "Tháng đo T1", "CHS_CS T1",
  "Tháng đo T4", "CHS_CS T4", "Thiếu U/O BigQuery", "Ngày đánh giá T1", "Ngày đánh giá T4", "Khoá U/O",
];
function compact(d: Deal): Deal {
  const o: Deal = {};
  for (const k of COMPACT_KEYS) if (d[k]) o[k] = d[k];
  return o;
}
function fullDeal(d: Deal): Deal {
  const o: Deal = {};
  for (const [k, v] of Object.entries(d)) if (v !== "" && !/Năm [2-5]/.test(k)) o[k] = v;
  const nam25: Deal = {};
  for (const [k, v] of Object.entries(d)) if (v !== "" && /Năm [2-5]/.test(k)) nam25[k] = v;
  if (Object.keys(nam25).length) (o as Record<string, unknown>)["Năm 2–5"] = nam25 as unknown as string;
  return o;
}
function isStopped(d: Deal): boolean {
  const s = (d["Dừng triển khai"] || "").trim().toLowerCase();
  return !!s && s !== "false";
}

// Quy tắc CR — giống crIn() trong app.js (quyết định 15–16/10/2026)
function contractCounted(c: string): boolean {
  const s = String(c || "").toLowerCase().trim();
  if (!s || s === "renew" || s === "—") return false;
  return /(^|[^a-z])new|upsale|up-sell|cross|expansion|renew csm|renew triển khai lại/.test(s);
}
function crIn(d: Deal, m: string): { dat: boolean; noDen?: boolean } | null {
  const crMonth = d["Tháng ghi nhận CR"];
  if (!isMonth(crMonth) || !contractCounted(d["Loại hợp đồng"]) || isStopped(d)) return null;
  const g = monthOf(d["Ngày go-live thực tế"]);
  if (g) {
    // go-live SỚM (tháng trước tháng hạn) → chỉ tử số ở tháng go-live, không vào mẫu số tháng nào
    if (mCmp(g, crMonth) < 0) return m === g ? { dat: true, noDen: true } : null;
    if (g === crMonth) return m === g ? { dat: true } : null;
    if (mCmp(m, crMonth) < 0 || mCmp(m, g) > 0) return null;
    return { dat: m === g };
  }
  if (mCmp(m, crMonth) < 0) return null;
  return { dat: false };
}

// ---------------------------------------------------------------------
// Định nghĩa tool
// ---------------------------------------------------------------------
type Ctx = { email: string; isAdmin: boolean };
type Tool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  admin?: boolean;
  readOnly?: boolean;
  run: (args: Record<string, unknown>, ctx: Ctx) => Promise<unknown>;
};

const S = (props: Record<string, unknown>, required: string[] = []) =>
  ({ type: "object", properties: props, required, additionalProperties: false });
const str = (description: string) => ({ type: "string", description });
const num = (description: string) => ({ type: ["number", "null"], description });
const pct = (description: string) => ({ type: ["number", "null"], minimum: 0, maximum: 100, description });

const TOOLS: Tool[] = [
  {
    name: "whoami",
    description: "Thông tin tài khoản đang kết nối: email, họ tên, level, có phải admin không, số deal đang phụ trách.",
    inputSchema: S({}),
    readOnly: true,
    run: async (_a, ctx) => {
      const [profile, deals] = await Promise.all([
        rpc("api_get_profile", { p_email: ctx.email }),
        myDeals(ctx.email),
      ]);
      return { email: ctx.email, isAdmin: ctx.isAdmin, profile, soDeal: deals.length, thangHienTai: thisMonth() };
    },
  },
  {
    name: "list_my_deals",
    description:
      "Danh sách deal mình phụ trách trên CS Console (chỉ deal Chính sách mới / chưa gắn cơ chế). " +
      "Lọc tuỳ chọn theo tháng ghi nhận CR, trạng thái go-live, từ khoá, chưa go-live, thiếu số liệu U/O.",
    inputSchema: S({
      thang_cr: str("Tháng ghi nhận CR dạng MM/YYYY, vd 10/2026"),
      trang_thai: str("Lọc theo 'Trạng thái go-live' (khớp một phần, vd 'trễ', 'đúng hạn')"),
      tu_khoa: str("Tìm trong tên khách hàng / tên công ty / Deal ID / System ID"),
      chua_golive: { type: "boolean", description: "Chỉ deal chưa có ngày go-live thực tế" },
      thieu_uo: { type: "boolean", description: "Chỉ deal đã kéo trên CRM nhưng BigQuery thiếu U/O" },
      gioi_han: { type: "integer", minimum: 1, maximum: 300, description: "Số deal tối đa (mặc định 100)" },
    }),
    readOnly: true,
    run: async (a, ctx) => {
      let ds = await myDeals(ctx.email);
      if (a.thang_cr) ds = ds.filter((d) => d["Tháng ghi nhận CR"] === String(a.thang_cr).trim());
      if (a.trang_thai) {
        const t = String(a.trang_thai).toLowerCase();
        ds = ds.filter((d) => (d["Trạng thái go-live"] || "").toLowerCase().includes(t));
      }
      if (a.tu_khoa) {
        const t = String(a.tu_khoa).toLowerCase();
        ds = ds.filter((d) =>
          [d["Tên khách hàng"], d["Tên công ty"], d["Deal ID"], d["System ID"]].join(" ").toLowerCase().includes(t)
        );
      }
      if (a.chua_golive) ds = ds.filter((d) => !d["Ngày go-live thực tế"]);
      if (a.thieu_uo) ds = ds.filter((d) => !!d["Thiếu U/O BigQuery"]);
      const lim = Number(a.gioi_han) || 100;
      return { tong: ds.length, hienThi: Math.min(ds.length, lim), deals: ds.slice(0, lim).map(compact) };
    },
  },
  {
    name: "get_deal",
    description: "Toàn bộ thông tin 1 deal mình phụ trách (Năm 1 + các năm 2–5 nếu có).",
    inputSchema: S({ deal_id: str("Deal ID") }, ["deal_id"]),
    readOnly: true,
    run: async (a, ctx) => {
      const d = (await myDeals(ctx.email)).find((x) => x["Deal ID"] === String(a.deal_id).trim());
      if (!d) throw new ToolError("Không thấy deal " + a.deal_id + " trong danh sách bạn phụ trách");
      return fullDeal(d);
    },
  },
  {
    name: "cr_summary",
    description:
      "Tính CR của tháng (tử số = DT go-live đạt, mẫu số = DT phải go-live) theo đúng quy tắc của console: " +
      "deal nằm trong mẫu số từ tháng hạn tới tháng go-live; go-live đúng tháng hạn tính cả tử + mẫu; " +
      "go-live SỚM (tháng trước tháng hạn) chỉ cộng tử số ở tháng go-live, không vào mẫu số tháng nào; " +
      "chỉ loại HĐ New/Upsale/Cross/Expansion/Renew CSM/Renew triển khai lại; bỏ deal dừng triển khai.",
    inputSchema: S({ thang: str("Tháng MM/YYYY (mặc định tháng hiện tại)") }),
    readOnly: true,
    run: async (a, ctx) => {
      const m = isMonth(a.thang) ? a.thang : thisMonth();
      const ds = await myDeals(ctx.email);
      let phai = 0, dat = 0;
      const tuSo: Deal[] = [], chuaDat: Deal[] = [];
      for (const d of ds) {
        const x = crIn(d, m);
        if (!x) continue;
        const v = numVN(d["DT phải go-live"]);
        if (!x.noDen) phai += v;
        if (x.dat) { dat += v; tuSo.push(compact(d)); } else chuaDat.push(compact(d));
      }
      return {
        thang: m,
        mauSo_DTPhaiGoLive: phai,
        tuSo_DTGoLiveDat: dat,
        CR: phai > 0 ? Math.round(dat / phai * 10000) / 100 + "%" : null,
        dealTrongTuSo: tuSo,
        dealChuaDat: chuaDat,
        ghiChu: "Số tính từ dữ liệu đã lưu; ô đang gõ dở trên web chưa lưu thì chưa tính.",
      };
    },
  },
  {
    name: "update_deal_inputs",
    description:
      "Sửa số liệu Năm 1 của 1 deal mình phụ trách. Chỉ ô được truyền mới đổi; truyền null để xoá ô. " +
      "go_live dạng dd/mm/yyyy; % nhập 0–100 (vd 85.5). Khoá giống trên web: go-live 'Đã kéo' trên CRM; " +
      "% Active/Output kỳ T1/T4 đã qua 'Ngày đánh giá T1/T4' (cột 'Khoá U/O'). Luôn xác nhận lại với người dùng trước khi ghi.",
    inputSchema: S({
      deal_id: str("Deal ID"),
      go_live: { type: ["string", "null"], description: "Ngày go-live thực tế dd/mm/yyyy (null = xoá)" },
      active_t1: pct("% Active T1 (0–100)"),
      output_t1: pct("% Output T1 (0–100)"),
      active_t4: pct("% Active T4 (0–100)"),
      output_t4: pct("% Output T4 (0–100)"),
    }, ["deal_id"]),
    run: async (a, ctx) => {
      const patch: Record<string, unknown> = {};
      if ("go_live" in a) {
        if (a.go_live != null && !isDateVN(a.go_live)) throw new ToolError("go_live phải dạng dd/mm/yyyy");
        patch.goLive = a.go_live == null ? "" : String(a.go_live).trim();
      }
      const map: Record<string, string> = { active_t1: "aT1", output_t1: "oT1", active_t4: "aT4", output_t4: "oT4" };
      for (const [k, f] of Object.entries(map)) if (k in a) patch[f] = a[k] == null ? null : Number(a[k]);
      if (!Object.keys(patch).length) throw new ToolError("Chưa truyền ô nào để sửa");
      const id = String(a.deal_id).trim();
      if (!/^\d+$/.test(id)) throw new ToolError("deal_id không hợp lệ");
      return await rpc("api_patch_deal_input", { p_email: ctx.email, p_deal_id: Number(id), p_patch: patch });
    },
  },
  {
    name: "update_multiyear_inputs",
    description:
      "Sửa % Active / % Output kỳ T1 hoặc T4 của Năm 2–5 cho 1 deal mình phụ trách. Ô không truyền giữ nguyên; null = xoá.",
    inputSchema: S({
      deal_id: str("Deal ID"),
      nam: { type: "integer", minimum: 2, maximum: 5, description: "Năm hợp đồng 2–5" },
      ky: { type: "string", enum: ["T1", "T4"], description: "Kỳ đo" },
      active: pct("% Active (0–100)"),
      output: pct("% Output (0–100)"),
    }, ["deal_id", "nam", "ky"]),
    run: async (a, ctx) => {
      const id = String(a.deal_id).trim();
      if (!/^\d+$/.test(id)) throw new ToolError("deal_id không hợp lệ");
      if (!("active" in a) && !("output" in a)) throw new ToolError("Chưa truyền active hoặc output");
      const { data: cur } = await SB.from("deal_multiyear_inputs").select("active, output")
        .eq("deal_id", Number(id)).eq("year", Number(a.nam)).eq("period", String(a.ky)).maybeSingle();
      const keep = (v: unknown) => v == null ? null : Math.round(Number(v) * 1e6) / 1e4; // 0.85 → 85
      const row = {
        dealId: id, year: Number(a.nam), period: String(a.ky),
        active: "active" in a ? a.active : keep(cur?.active),
        output: "output" in a ? a.output : keep(cur?.output),
      };
      // Khoá theo ngày đánh giá: Năm N kỳ T1/T4 = ngày đánh giá Năm 1 + (N−1) năm (giống trên web)
      const dg = await rpc<string | null>("deal_ngay_dg", { p_deal_id: Number(id), p_ky: String(a.ky) });
      if (typeof dg === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dg)) {
        const lock = new Date(dg + "T00:00:00Z");
        lock.setUTCFullYear(lock.getUTCFullYear() + Number(a.nam) - 1);
        const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);   // giờ Việt Nam
        const lockStr = lock.toISOString().slice(0, 10);
        if (lockStr < today) {
          throw new ToolError("Kỳ " + a.ky + " Năm " + a.nam + " của deal " + id + " đã qua ngày đánh giá (" +
            lockStr.split("-").reverse().join("/") + ") — khoá, không sửa được nữa");
        }
      }
      const n = await rpc<number>("api_save_multiyear", { p_email: ctx.email, p_rows: [row] });
      if (!n) throw new ToolError("Deal " + id + " không thuộc bạn phụ trách (hoặc không tồn tại)");
      return { ok: true, ...row };
    },
  },
  {
    name: "request_extend",
    description: "Gửi đề xuất GIA HẠN ngày go-live cho deal mình phụ trách (kèm link request đã được duyệt).",
    inputSchema: S({
      deal_id: str("Deal ID"),
      ngay_gia_han: str("Ngày go-live gia hạn dd/mm/yyyy"),
      link_request: str("Link request/phiếu đề xuất đã duyệt"),
    }, ["deal_id", "ngay_gia_han"]),
    run: async (a, ctx) => {
      if (!isDateVN(a.ngay_gia_han)) throw new ToolError("ngay_gia_han phải dạng dd/mm/yyyy");
      await rpc("api_save_request", {
        p_email: ctx.email, p_deal_id: String(a.deal_id), p_type: "extend",
        p_gl_extend: String(a.ngay_gia_han).trim(), p_link: String(a.link_request || ""), p_remove: false,
      });
      return { ok: true };
    },
  },
  {
    name: "request_stop",
    description: "Đánh dấu DỪNG TRIỂN KHAI cho deal mình phụ trách (deal bị loại khỏi CR).",
    inputSchema: S({ deal_id: str("Deal ID"), link_request: str("Link request/phiếu đề xuất") }, ["deal_id"]),
    run: async (a, ctx) => {
      await rpc("api_save_request", {
        p_email: ctx.email, p_deal_id: String(a.deal_id), p_type: "stop",
        p_gl_extend: "", p_link: String(a.link_request || ""), p_remove: false,
      });
      return { ok: true };
    },
  },
  {
    name: "cancel_request",
    description: "Huỷ đề xuất gia hạn hoặc dừng triển khai của deal mình phụ trách.",
    inputSchema: S({
      deal_id: str("Deal ID"),
      loai: { type: "string", enum: ["extend", "stop"], description: "extend = gia hạn, stop = dừng" },
    }, ["deal_id", "loai"]),
    run: async (a, ctx) => {
      await rpc("api_save_request", {
        p_email: ctx.email, p_deal_id: String(a.deal_id), p_type: String(a.loai),
        p_gl_extend: "", p_link: "", p_remove: true,
      });
      return { ok: true };
    },
  },
  {
    name: "submit_feedback",
    description: "Gửi Product Feedback (đề xuất / báo lỗi) cho team CS Console.",
    inputSchema: S({
      tieu_de: str("Tên ngắn gọn"),
      loai: { type: "string", enum: ["Tính năng mới", "Cải tiến", "Lỗi", "Khác"] },
      mo_ta: str("Mô tả chi tiết"),
      ngay_ky_vong: str("Ngày mong muốn có tính năng, dạng YYYY-MM-DD (tuỳ chọn)"),
    }, ["tieu_de", "mo_ta"]),
    run: async (a, ctx) => {
      const id = "PF" + Date.now().toString(36).toUpperCase();
      const profile = await rpc<{ hoTen?: string } | null>("api_get_profile", { p_email: ctx.email });
      const name = (profile && profile.hoTen) || "";
      await rpc("api_submit_feedback", {
        p_id: id, p_email: ctx.email, p_name: name, p_title: String(a.tieu_de || ""),
        p_category: String(a.loai || "Khác"), p_description: String(a.mo_ta || ""),
        p_attachments: [], p_expected: String(a.ngay_ky_vong || ""),
      });
      await sendMail(PF_ADMIN_EMAIL, "[CS Tool] Feedback mới: " + (a.tieu_de || ""),
        "Có feedback mới (gửi qua Claude) từ: " + (name ? name + " (" + ctx.email + ")" : ctx.email) +
        "\nLoại: " + (a.loai || "Khác") + "\nTiêu đề: " + a.tieu_de + "\n\nMô tả:\n" + a.mo_ta + "\n\nMã: " + id);
      return { ok: true, id };
    },
  },
  {
    name: "list_my_feedback",
    description: "Các feedback mình đã gửi, kèm trạng thái và phản hồi của team.",
    inputSchema: S({}),
    readOnly: true,
    run: async (_a, ctx) => await rpc("api_list_feedback", { p_email: ctx.email }),
  },

  // ----------------------------- ADMIN -----------------------------
  {
    name: "admin_list_feedback",
    description: "[Admin] Toàn bộ Product Feedback của mọi người. Lọc tuỳ chọn theo trạng thái.",
    inputSchema: S({
      trang_thai: { type: "string", enum: ["Received", "In Progress", "Won't Do", "Completed"] },
    }),
    admin: true,
    readOnly: true,
    run: async (a, ctx) => await rpc("api_admin_list_feedback", { p_email: ctx.email, p_status: a.trang_thai ?? null }),
  },
  {
    name: "admin_reply_feedback",
    description:
      "[Admin] Đổi trạng thái và/hoặc ghi phản hồi cho 1 feedback. Người gửi thấy phản hồi trong CS Console " +
      "(và nhận email nếu đã cấu hình). Xác nhận nội dung với admin trước khi gửi.",
    inputSchema: S({
      id: str("Mã feedback, vd PF..."),
      trang_thai: { type: "string", enum: ["Received", "In Progress", "Won't Do", "Completed"] },
      phan_hoi: str("Nội dung phản hồi cho người gửi"),
    }, ["id"]),
    admin: true,
    run: async (a, ctx) => {
      if (a.trang_thai == null && a.phan_hoi == null) throw new ToolError("Chưa truyền trang_thai hoặc phan_hoi");
      const r = await rpc<{ senderEmail: string; title: string; status: string; response: string }>(
        "api_admin_update_feedback",
        { p_email: ctx.email, p_id: String(a.id), p_status: a.trang_thai ?? null, p_reply: a.phan_hoi ?? null },
      );
      if (r?.senderEmail) {
        await sendMail(r.senderEmail, "[CS Tool] Feedback của bạn đã được cập nhật: " + r.title,
          "Trạng thái: " + r.status + (r.response ? "\n\nPhản hồi từ team:\n" + r.response : "") +
          "\n\nXem chi tiết trong CS Console → Product Feedback.");
      }
      return r;
    },
  },
  {
    name: "admin_list_todo",
    description: "[Admin] Danh sách việc cần làm (todo) của CS Console.",
    inputSchema: S({}),
    admin: true,
    readOnly: true,
    run: async (_a, ctx) => await rpc("api_admin_list_todo", { p_email: ctx.email }),
  },
  {
    name: "admin_add_todo",
    description: "[Admin] Thêm 1 việc vào todo.",
    inputSchema: S({
      noi_dung: str("Nội dung việc"), note: str("Ghi chú"), dau_moi: str("Đầu mối"),
      feedback_id: str("Mã feedback gốc (PF...) nếu việc sinh ra từ feedback — feedback đã có todo đang mở thì cập nhật todo đó, không tạo trùng"),
      pr_url: str("Link PR GitHub liên quan (nếu có)"),
      nguon: { type: "string", enum: ["claude", "manual"], description: "Ai tạo: claude (mặc định) / manual" },
    }, ["noi_dung"]),
    admin: true,
    run: async (a, ctx) => await rpc("api_admin_save_todo", {
      p_email: ctx.email,
      p_item: {
        noiDung: a.noi_dung, note: a.note ?? "", dauMoi: a.dau_moi ?? "",
        feedbackId: a.feedback_id ?? "", prUrl: a.pr_url ?? "", nguon: a.nguon ?? "claude",
      },
    }),
  },
  {
    name: "admin_update_todo",
    description: "[Admin] Sửa 1 việc: nội dung, ghi chú, đầu mối, đánh dấu xong/chưa xong. Ô không truyền giữ nguyên.",
    inputSchema: S({
      id: { type: "integer", description: "id của việc (lấy từ admin_list_todo)" },
      noi_dung: str("Nội dung"), note: str("Ghi chú"), dau_moi: str("Đầu mối"),
      done: { type: "boolean", description: "true = đã xong" },
      pr_url: str("Link PR GitHub liên quan"),
    }, ["id"]),
    admin: true,
    run: async (a, ctx) => {
      const item: Record<string, unknown> = { id: String(a.id) };
      if ("noi_dung" in a) item.noiDung = a.noi_dung;
      if ("note" in a) item.note = a.note;
      if ("dau_moi" in a) item.dauMoi = a.dau_moi;
      if ("done" in a) item.done = !!a.done;
      if ("pr_url" in a) item.prUrl = a.pr_url;
      return await rpc("api_admin_save_todo", { p_email: ctx.email, p_item: item });
    },
  },
  {
    name: "admin_delete_todo",
    description: "[Admin] Xoá 1 việc khỏi todo (xoá mềm, vẫn lưu lịch sử trong DB). Xác nhận với admin trước khi xoá.",
    inputSchema: S({ id: { type: "integer", description: "id của việc" } }, ["id"]),
    admin: true,
    run: async (a, ctx) => {
      await rpc("api_admin_delete_todo", { p_email: ctx.email, p_id: Number(a.id) });
      return { ok: true };
    },
  },
  {
    name: "admin_feedback_queue",
    description:
      "[Admin] Hàng chờ cho Claude: feedback còn mở (Received / In Progress) mà Claude CHƯA xử lý, cũ nhất trước. " +
      "Xử lý xong mỗi cái phải gọi admin_mark_feedback để không bị lặp lại ở lần chạy sau.",
    inputSchema: S({}),
    admin: true,
    readOnly: true,
    run: async (_a, ctx) => await rpc("api_admin_feedback_queue", { p_email: ctx.email }),
  },
  {
    name: "admin_get_feedback",
    description:
      "[Admin] Chi tiết 1 feedback, kèm ẢNH đính kèm (file upload trong console). Link Google Drive thì chỉ trả link — " +
      "đọc bằng connector Google Drive nếu có.",
    inputSchema: S({ id: str("Mã feedback PF...") }, ["id"]),
    admin: true,
    readOnly: true,
    run: async (a, ctx) => {
      const fb = await rpc<{ attachments?: string[] }>("api_admin_get_feedback", { p_email: ctx.email, p_id: String(a.id) });
      const content: Record<string, unknown>[] = [{ type: "text", text: JSON.stringify(fb, null, 1) }];
      const base = (Deno.env.get("SUPABASE_URL") || "") + "/storage/v1/object/public/feedback/";
      for (const url of (fb?.attachments || []).slice(0, 5)) {
        if (!String(url).startsWith(base)) continue;
        try {
          const r = await fetch(url);
          const mime = r.headers.get("content-type") || "";
          const buf = new Uint8Array(await r.arrayBuffer());
          if (!/^image\/(png|jpe?g|gif|webp)$/.test(mime) || buf.length > 4_000_000) {
            content.push({ type: "text", text: "File đính kèm không phải ảnh nhỏ (" + mime + ", " + buf.length + " byte): " + url });
            continue;
          }
          let bin = "";
          for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
          content.push({ type: "image", data: btoa(bin), mimeType: mime });
        } catch (e) {
          content.push({ type: "text", text: "Không tải được " + url + ": " + String((e as Error).message || e) });
        }
      }
      return { __content: content };
    },
  },
  {
    name: "admin_mark_feedback",
    description:
      "[Admin] Ghi KẾT QUẢ Claude xử lý 1 feedback (nội bộ, người gửi không thấy) để lần sau không xử lý lại. " +
      "ket_qua: da_tra_loi (đã trả lời/giải thích, không cần sửa), cho_duyet_pr (đã mở PR chờ admin duyệt), " +
      "da_tao_todo (đã tạo todo cho admin), bo_qua (trùng/không cần làm). null = đưa lại vào hàng chờ.",
    inputSchema: S({
      id: str("Mã feedback PF..."),
      ket_qua: { type: ["string", "null"], enum: ["da_tra_loi", "cho_duyet_pr", "da_tao_todo", "bo_qua", null] },
      ghi_chu: str("Tóm tắt Claude đã kiểm tra gì, kết luận gì (1–3 câu)"),
      todo_id: { type: "integer", description: "id todo đã tạo (nếu có)" },
      pr_url: str("Link PR (nếu có)"),
    }, ["id", "ket_qua", "ghi_chu"]),
    admin: true,
    run: async (a, ctx) => await rpc("api_admin_mark_feedback", {
      p_email: ctx.email, p_id: String(a.id), p_ai_status: a.ket_qua ?? null, p_note: String(a.ghi_chu || ""),
      p_todo_id: a.todo_id == null ? null : Number(a.todo_id), p_pr_url: a.pr_url == null ? null : String(a.pr_url),
    }),
  },
  {
    name: "admin_get_deal",
    description:
      "[Admin] Soi 1 deal BẤT KỲ (của mọi CS): dòng đang hiện trên console, số gốc từ BigQuery (deals_raw), số CS nhập " +
      "Năm 1 và Năm 2–5, 30 lần sửa gần nhất, và lý do nếu deal không hiện trên console. Dùng để kiểm tra feedback về dữ liệu.",
    inputSchema: S({ deal_id: str("Deal ID") }, ["deal_id"]),
    admin: true,
    readOnly: true,
    run: async (a, ctx) => {
      const id = String(a.deal_id).trim();
      if (!/^\d+$/.test(id)) throw new ToolError("deal_id không hợp lệ");
      return await rpc("api_admin_get_deal", { p_email: ctx.email, p_deal_id: Number(id) });
    },
  },
  {
    name: "admin_find_deals",
    description:
      "[Admin] Tìm deal trong toàn bộ dữ liệu (kể cả deal không hiện trên console) theo Deal ID, System ID, Job ID, " +
      "tên deal hoặc tên công ty. Tối đa 30 kết quả.",
    inputSchema: S({ tu_khoa: str("Từ khoá (≥ 2 ký tự)") }, ["tu_khoa"]),
    admin: true,
    readOnly: true,
    run: async (a, ctx) => await rpc("api_admin_find_deals", { p_email: ctx.email, p_query: String(a.tu_khoa || "") }),
  },
  {
    name: "admin_list_deals_of",
    description: "[Admin] Danh sách deal trên console của 1 CS bất kỳ (theo email), dạng rút gọn như list_my_deals.",
    inputSchema: S({
      email: str("Email CS, vd luan.pham@base.vn"),
      gioi_han: { type: "integer", minimum: 1, maximum: 300, description: "Số deal tối đa (mặc định 100)" },
    }, ["email"]),
    admin: true,
    readOnly: true,
    run: async (a) => {
      const ds = await myDeals(String(a.email || "").trim().toLowerCase());
      const lim = Number(a.gioi_han) || 100;
      return { tong: ds.length, deals: ds.slice(0, lim).map(compact) };
    },
  },
  {
    name: "admin_list_cs",
    description:
      "[Admin] Danh sách CS: username, email, họ tên, level, lương khai báo, đã đăng ký chưa, số deal đang phụ trách, " +
      "số deal chưa go-live, số deal thiếu U/O BigQuery, đã kết nối Claude chưa.",
    inputSchema: S({}),
    admin: true,
    readOnly: true,
    run: async (_a, ctx) => await rpc("api_admin_list_cs", { p_email: ctx.email }),
  },
];

const INSTRUCTIONS =
  "CS Console (Base.vn) — dữ liệu deal triển khai của CS. Mỗi kết nối gắn với 1 tài khoản: chỉ thấy và sửa deal " +
  "mình phụ trách. Ngày dạng dd/mm/yyyy, tháng dạng MM/YYYY, tiền VNĐ, % nhập 0–100. Ô go-live 'Đã kéo' bị khoá; " +
  "ô % Active/Output kỳ T1/T4 bị khoá khi đã qua ngày đánh giá kỳ đó (Năm 2–5: + số năm). Trước khi gọi tool ghi (update_*, request_*, cancel_request, submit_feedback, " +
  "admin_reply_feedback, admin_*_todo) hãy tóm tắt thay đổi và hỏi người dùng xác nhận — trừ khi đang chạy tác vụ tự động " +
  "đã được admin giao sẵn quy trình. Tool có tiền tố admin_ chỉ dành cho admin.";

// ---------------------------------------------------------------------
// Email (Resend) — giống function api; chưa cấu hình thì bỏ qua
// ---------------------------------------------------------------------
async function sendMail(to: string, subject: string, text: string): Promise<void> {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({ from: Deno.env.get("MAIL_FROM") || "CS Tool <onboarding@resend.dev>", to: [to], subject, text }),
    });
  } catch { /* email lỗi không chặn việc lưu */ }
}

// ---------------------------------------------------------------------
// JSON-RPC / MCP
// ---------------------------------------------------------------------
type RpcMsg = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

function toolsFor(ctx: Ctx): Tool[] {
  return TOOLS.filter((t) => !t.admin || ctx.isAdmin);
}

async function handle(msg: RpcMsg, ctx: Ctx): Promise<Record<string, unknown> | null> {
  const id = msg.id ?? null;
  const ok = (result: unknown) => ({ jsonrpc: "2.0", id, result });
  const err = (code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });
  if (msg.id === undefined || msg.id === null) return null; // notification → không trả lời

  switch (msg.method) {
    case "initialize": {
      const want = String(msg.params?.protocolVersion || "");
      return ok({
        protocolVersion: SUPPORTED_VERSIONS.includes(want) ? want : SUPPORTED_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "cs-console", title: "CS Console", version: "1.0.0" },
        instructions: INSTRUCTIONS + (ctx.isAdmin ? " Tài khoản này là ADMIN." : ""),
      });
    }
    case "ping":
      return ok({});
    case "tools/list":
      return ok({
        tools: toolsFor(ctx).map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: { readOnlyHint: !!t.readOnly, destructiveHint: t.name === "admin_delete_todo", openWorldHint: false },
        })),
      });
    case "tools/call": {
      const name = String(msg.params?.name || "");
      const tool = toolsFor(ctx).find((t) => t.name === name);
      if (!tool) return err(-32602, "Không có tool " + name + (TOOLS.some((t) => t.name === name) ? " (chỉ admin)" : ""));
      try {
        const out = await tool.run((msg.params?.arguments as Record<string, unknown>) || {}, ctx);
        if (out && typeof out === "object" && "__content" in (out as Record<string, unknown>)) {
          return ok({ content: (out as { __content: unknown[] }).__content });
        }
        return ok({ content: [{ type: "text", text: JSON.stringify(out, null, 1) }] });
      } catch (e) {
        return ok({ content: [{ type: "text", text: "Lỗi: " + String((e as Error)?.message || e) }], isError: true });
      }
    }
    case "resources/list":
      return ok({ resources: [] });
    case "prompts/list":
      return ok({ prompts: [] });
    default:
      return err(-32601, "Method không hỗ trợ: " + msg.method);
  }
}

function jsonResp(obj: unknown, status = 200): Response {
  return new Response(obj == null ? null : JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version",
      },
    });
  }
  if (req.method !== "POST") {
    return new Response("Chỉ hỗ trợ POST (MCP Streamable HTTP, không mở SSE).", { status: 405, headers: { Allow: "POST" } });
  }

  // Khoá nằm ở đoạn path ngay sau /mcp/
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  const key = parts[parts.indexOf("mcp") + 1] || "";
  const email = key.length >= 20 ? await rpc<string | null>("api_mcp_resolve", { p_hash: await sha256Hex(key) }) : null;
  if (!email) {
    return jsonResp({
      jsonrpc: "2.0", id: null,
      error: { code: -32001, message: "Link kết nối không hợp lệ hoặc đã bị thu hồi — tạo link mới trong CS Console → Kết nối Claude." },
    }, 403);
  }
  const ctx: Ctx = { email, isAdmin: !!(await rpc<boolean>("api_is_admin", { p_email: email })) };

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResp({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON không hợp lệ" } }, 400);
  }
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => handle(m as RpcMsg, ctx)))).filter(Boolean);
    return out.length ? jsonResp(out) : new Response(null, { status: 202 });
  }
  const res = await handle(body as RpcMsg, ctx);
  return res ? jsonResp(res) : new Response(null, { status: 202 });
});

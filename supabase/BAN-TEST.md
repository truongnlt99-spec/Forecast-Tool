# Bản test song song (Supabase)

Chỉ dùng để thử nghiệm và so số liệu. Bản thật (nhánh `main`, Apps Script, Google Sheet) **không đổi gì**.

| | Bản thật | Bản test |
|---|---|---|
| Nhánh | `main` | `supabase-test` |
| `API_URL` | Apps Script `/exec` | `https://lheaoklvumzapmwuhysr.supabase.co/functions/v1/api` |
| Dữ liệu | Google Sheet | Supabase (không ghi ngược về sheet) |
| Nhận biết | — | Banner đỏ "BẢN TEST – dữ liệu Supabase" + tiêu đề tab `[TEST]` |

Banner nằm trong `ui.js` và chỉ bật khi `API_URL` trỏ tới `supabase.co`, nên bản thật không bị ảnh hưởng.

## 1. Secret `SESSION_SECRET` (bắt buộc)

Supabase Dashboard → project **Forecast-Tool** → **Edge Functions** → **Secrets** → *Add new secret*:

- Name: `SESSION_SECRET`
- Value: chuỗi ngẫu nhiên dài ≥ 32 ký tự (tạo bằng trình quản lý mật khẩu, hoặc `openssl rand -base64 48` trên máy bạn)

Không cần deploy lại function. Thiếu secret này thì đăng nhập báo lỗi `Thiếu secret SESSION_SECRET`.

## 2. Link test trên Vercel (Preview của nhánh `supabase-test`)

Vercel đã nối Git sẽ tự build mỗi nhánh được push thành **Preview Deployment**. Production (nhánh `main`) không đổi.

1. Vercel → project CS Console → **Deployments** → lọc Branch = `supabase-test` → mở bản mới nhất.
2. Dùng link **Branch URL** cố định dạng `https://csconsole-test.vercel.app`
   (đừng dùng link có mã hash, link đó đổi mỗi lần push).
3. Nếu bật **Deployment Protection** (Vercel Authentication), người test phải đăng nhập Vercel hoặc dùng
   *Shareable Link*; hoặc tắt bảo vệ cho Preview ở Settings → Deployment Protection.

## 3. Cho phép đăng nhập Google từ link test

Google Cloud Console → **APIs & Services → Credentials** → OAuth 2.0 Client ID
`621765385511-nn699q39euvcf2slmqbv9jp6oi70kpgb` → **Authorized JavaScript origins** → *Add URI*:

```
https://csconsole-test.vercel.app
```

(không có `/` ở cuối, không có đường dẫn). Save, chờ vài phút tới vài giờ để Google cập nhật.
Chỉ *thêm* một origin, các origin của bản thật giữ nguyên.

## 4. Dữ liệu thử đã nạp (đọc từ sheet, chỉ đọc)

| Bảng | Nguồn | Số dòng |
|---|---|---|
| `deals_raw` | tab "Extract of Raw" (tab "Bigquery" là Connected Sheet, API không đọc được) | 1.153 |
| `cs_members` | tab "Danh sách CS" (chưa chép avatar base64) | 28 |
| `deal_inputs` | tab "Database" cột M→T | 31 |
| `deal_multiyear_inputs` | tab "Database" cột Năm 2–5 | 0 (sheet chưa có ai nhập) |
| `product_feedback` | tab "Product Feedback" | 13 |

`deals_raw` hiện chỉ nạp các cột mà view công thức dùng (Deal/Job ID, tên, CS, giá trị, loại HĐ,
bộ giải pháp, số user, ngày tạo, số năm, PS/PaS, TTGL, ngày go-live dự kiến). Đã kiểm tra checksum
từng dòng khớp 100% với sheet.

## 5. Kết quả so `v_database_display` với tab Database (15/10/2026)

688/1.153 deal khớp **cả 104 cột**. Phần lệch đều đã rõ nguyên nhân:

| Nhóm | Số deal | Nguyên nhân | Bên đúng |
|---|---|---|---|
| Sheet trống từ cột X trở đi | 154 | Công thức tab Database chỉ kéo tới dòng 1000, deal ở dòng 1001–1155 (deal 11/2025) không có công thức | Supabase |
| TTGL / Ngày go-live dự kiến / Tháng CR / Trạng thái | 177 | Rule 15/10: Supabase lấy TTGL & ngày go-live dự kiến từ BigQuery, sheet vẫn tự tính | Theo rule mới |
| ACR, Tháng CR trống ở Supabase | 94 | BigQuery không có TTGL/ngày go-live dự kiến → Supabase không có tháng CR nên không tính ACR (sheet tự tính TTGL mặc định 21 ngày) | **Cần chốt** |
| Tier: Business Ops, số user trống | 9 | Sheet coi trống = 0 → Tier 1; Supabase rơi vào Tier 3 | **Cần chốt** (nên theo sheet) |
| Tháng nhận Com Năm 3–5 | 80 | Sheet hiện `12/1901`… khi chưa có tháng đo T1 (lỗi định dạng ngày 0) | Supabase |
| Số users ≥ 1.000 | 7 | Sheet hiện `1.600`, Supabase hiện `1600` (chỉ khác định dạng) | Cần sửa định dạng |
| System ID / Tên công ty | 4 | Sheet `#N/A`, Supabase để trống | Supabase |

Khi các nhóm "Cần chốt" đã quyết, chỉ cần sửa view trong `supabase/01_tao_bang.sql` / `02_api.sql`,
không phải nạp lại dữ liệu.

## 6. Đồng bộ BigQuery → Supabase (tự chạy mỗi giờ)

Script `supabase/apps-script/DongBoSupabase.gs` chạy bằng tài khoản Google của bạn (đã có quyền
BigQuery `base-data-analyst`). Mỗi lượt: đọc query của tab "Bigquery" (Connected Sheets) → chạy thẳng
trên BigQuery → đẩy vào `deals_raw` qua hàm `sync_deals_raw` theo Deal ID. Chỉ ghi `deals_raw`;
số CS nhập (`deal_inputs`) không bị đụng. Deal rớt khỏi query → `is_active = false` (ẩn, không xoá).
Có chốt an toàn: lượt nào thấy < 50% số deal đang active thì dừng, không ẩn hàng loạt.

1. https://script.google.com → **Dự án mới** → đặt tên `Dong bo Supabase` → xoá code mẫu → dán toàn bộ file.
2. Cột trái **Services (+)** → **BigQuery API** → Add.
3. **Project Settings** (bánh răng) → **Script Properties** → Add: `SUPABASE_SERVICE_KEY` = key *secret*
   (Supabase → Project Settings → API Keys → Secret keys). Không dán key vào code hay chat.
4. Chọn hàm `dongBoDeals` → **Run** → Allow quyền → xem Execution log (`Xong: cập nhật N deal...`).
5. Ổn thì chọn `caiDatTrigger` → **Run** (cài lịch mỗi giờ). Lỗi sẽ được Google gửi email.

## 7. Kết nối Claude (MCP) + Quản trị

- **Edge Function `mcp`** (Verify JWT **tắt**): `https://lheaoklvumzapmwuhysr.supabase.co/functions/v1/mcp/<khoá>`.
  Mỗi người tự tạo link ở CS Console → **Kết nối Claude** (tối đa 5 link, thu hồi được). DB chỉ lưu SHA-256
  của khoá (`mcp_keys`), link chỉ hiện 1 lần. Dán link vào claude.ai → Settings → Connectors → Add custom connector.
- **Người dùng thường** (11 tool): `whoami`, `list_my_deals`, `get_deal`, `cr_summary`, `update_deal_inputs`,
  `update_multiyear_inputs`, `request_extend`, `request_stop`, `cancel_request`, `submit_feedback`, `list_my_feedback`.
  Chỉ thấy/sửa deal mình phụ trách; ô go-live "Đã kéo" và ô U/O BigQuery bị khoá như trên web.
- **Admin** (email trong bảng `app_admins`, hiện chỉ truong.nguyen@base.vn) thêm 7 tool: `admin_list_feedback`,
  `admin_reply_feedback`, `admin_list_todo`, `admin_add_todo`, `admin_update_todo`, `admin_delete_todo`, `admin_list_cs`.
  Trên web, admin thấy thêm nút **Quản trị** (3 tab Feedback / Todo / Danh sách CS).
- Thêm admin: `insert into app_admins values ('ten@base.vn');`. Todo xoá là xoá mềm (`deleted_at`).
- Phản hồi feedback gửi email cho người gửi nếu đã đặt secret `RESEND_API_KEY` (chưa đặt thì chỉ hiện trong app).
- SQL: `supabase/03_admin_mcp.sql`. Code: `supabase/functions/mcp/index.ts`, `supabase/functions/api/index.ts`.

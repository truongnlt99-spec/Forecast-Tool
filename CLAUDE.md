# CLAUDE.md

Hướng dẫn bắt buộc khi làm việc trong repo này.

## 1. Không được sửa `app.js`

- `app.js` là core logic gốc — **tuyệt đối không sửa** dưới bất kỳ hình thức nào (kể cả sửa nhỏ, đổi tên biến, format lại code).
- Nếu cần thay đổi hành vi hoặc giao diện, KHÔNG đụng vào `app.js`. Thay vào đó implement ở `ui.js` (xem mục 2).
- Nếu một thay đổi thực sự không thể làm được nếu không sửa `app.js`, phải dừng lại và hỏi người dùng trước, không tự ý sửa.

## 2. Mọi thay đổi UI đi qua `ui.js`

- `ui.js` là lớp override/patch chạy sau `app.js`, chịu trách nhiệm toàn bộ các thay đổi giao diện, hành vi bổ sung, vá lỗi hiển thị, v.v.
- Kỹ thuật chính được dùng trong `ui.js`:
  - **MutationObserver**: theo dõi DOM do `app.js` render ra (bảng, chip, card, dropdown...) để chèn thêm/chỉnh sửa mà không cần đụng vào code render gốc. Đây là pattern chủ đạo trong file — khi cần can thiệp vào một phần UI do `app.js` tạo ra động, hãy tìm khối `MutationObserver(...).observe(...)` tương tự đã có trong `ui.js` làm mẫu.
  - **Proxy-input**: khi cần chèn thêm logic vào một input/control mà `app.js` đang sở hữu và lắng nghe trực tiếp, không thay input gốc — tạo một input trung gian (proxy) để bắt sự kiện/hiển thị, rồi đồng bộ giá trị ngược lại input thật của `app.js` (qua `dispatchEvent`, set `.value`, v.v.) để `app.js` xử lý logic của nó như bình thường.
- Nguyên tắc chung: coi `app.js` như một "black box" chỉ được đọc (DOM, event), không được ghi (code). Mọi customization phải là lớp vá đắp thêm ở `ui.js`, không phải sửa trực tiếp nguồn.

## 3. Cache-busting: luôn bump `?v=N` khi đổi CSS/JS

`index.html` load các asset kèm query version để phá cache trình duyệt:

```html
<link rel="stylesheet" href="style.css?v=19">
...
<script src="ui.js?v=18"></script>
<script src="app.js?v=7"></script>
```

## 4. Test

```bash
cd tests && npm install && npm test   # quy tắc CR (app.js + ui.js + MCP), MCP server, UI smoke trên Chromium
```

Không đặt `package.json` ở gốc repo (Vercel đang deploy tĩnh). Sửa logic/giao diện thì thêm test vào `tests/`.

## 5. Claude tự xử lý feedback mỗi sáng

Quy trình bắt buộc: `docs/XU-LY-FEEDBACK.md`. Tóm tắt: chỉ mở PR (không push `main`), không sửa `app.js`/SQL
chính sách; không chắc → tạo todo cho admin qua MCP CS Console.

## 6. Career path

Thiết kế + các bước triển khai: `docs/CAREER-PATH.md`. Mốc KPI/khung lương chép ở 2 nơi (`LEVELS` trong `app.js`
và `CAREER_LEVELS` trong `supabase/functions/api/index.ts`) — `tests/career.test.mjs` so khớp, sửa một chỗ thì sửa cả hai.

## 7. Link kết nối Claude (MCP) & nút Cộng phước

- Link MCP đưa cho người dùng là `https://csconsole.vercel.app/mcp/<khoá>` (`MCP_PUBLIC_BASE` trong Edge Function `api`).
  `vercel.json` (và `netlify.toml`) chuyển tiếp `/mcp/*` sang Edge Function `mcp` trên Supabase — đổi project Supabase
  thì sửa cả hai file này cùng `config.js`. Link cũ dạng `supabase.co/functions/v1/mcp/<khoá>` vẫn chạy.
- Nút "Cộng phước" (cuối menu trái) chỉ đếm số lần bấm — bảng `cong_phuoc`, hàm `api_phuoc_*` trong
  `supabase/05_cong_phuoc.sql`, action `phuocGet` / `phuocAdd`. Không dính vào số liệu nào.

## 8. Khoá nhập %Active/%Output theo ngày đánh giá (16/10/2026)

- Kỳ T1/T4 khoá khi **ngày đánh giá < hôm nay** (giờ VN). Ngày đánh giá = cột CRM `ngay_danh_gia_1_thang` /
  `ngay_danh_gia_4_thang` nếu có, trống thì = go-live (ưu tiên ngày kéo đánh giá) + 1 / + 4 tháng (`ngay_dg`, `deal_ngay_dg`
  trong `01_tao_bang.sql`). Năm 2–5: + (N−1) năm. Thay đổi lần này gói trong `supabase/06_khoa_uo_theo_ngay.sql`.
- Trước ngày đánh giá số CS nhập ưu tiên hơn số CRM; qua ngày thì chốt số CRM (CRM trống giữ số CS).
- Chặn ở 3 nơi: view (`"Khoá U/O"`, `"Khoá Năm 2++"` → ui.js khoá ô), `api_save_rows` / `api_save_multiyear` (bỏ qua ô khoá),
  `api_patch_deal_input` + MCP `update_multiyear_inputs` (báo lỗi). Sửa quy tắc thì sửa đủ các nơi này.

## 9. Trợ lý CS: Vì sao? · Lịch đánh giá · Mô phỏng Career path (17/10/2026)

- Toàn bộ ở `ui.js` mục **TRỢ LÝ CS** (cuối file), chỉ đọc dữ liệu (nghe response API GET + `careerGet`), không ghi gì.
- Quy tắc CR có thêm bản thứ 4: `cxCrState()` (giữa `==CX PURE START==` / `==CX PURE END==`). Sửa quy tắc CR thì sửa cả
  `crIn()` app.js, `qCrCompute()` ui.js mục 11, `cr_summary` MCP và `cxCrState()` — `tests/tro-ly-cs.test.mjs` so khớp với `crIn()`.
- Lịch đánh giá dùng cùng quy tắc khoá ở mục 8 (ngày đánh giá < hôm nay giờ VN; Năm N = Năm 1 + (N−1) năm).
- Dòng "CRM cập nhật lúc …" cần chạy `supabase/07_gio_dong_bo.sql` + deploy lại Edge Function `api` (chưa chạy thì dòng đó tự ẩn).

## 10. Nguồn dữ liệu deal: tạm lấy từ sheet (17/10/2026)

- `supabase/apps-script/DongBoSupabase.gs` có `SYNC.NGUON`: `'sheet'` (đang dùng) đọc tab **Extract of Raw** chị Chi đồng bộ
  (sheet `SYNC.SHEET_ID`, cùng tên cột với query BigQuery); `'bigquery'` chạy query thẳng như cũ.
- Nguồn sheet: ngày dd/mm/yyyy → yyyy-mm-dd, ô lỗi công thức (#NAME?, #N/A…) → trống, tab < `MIN_ROWS` dòng thì dừng.
- Chống trùng (`locTrung_`): Deal ID chuẩn hoá về chữ số; lặp y hệt giữ 1; lặp mà nội dung khác → bỏ cả deal lượt đó
  (Supabase giữ số cũ), quá `MAX_DUP_RATE` thì dừng cả lượt. Deal ID khác nhau (kể cả cùng Job) luôn đồng bộ bình thường.
  `deals_raw` khoá chính `deal_id` nên DB không thể có 2 dòng cùng deal.
- Deal không còn trong tab bị đánh dấu ngừng (ẩn, không xoá) như nguồn BigQuery; SQL chặn nếu lượt thấy < 50% số deal
  active. Lượt có Deal ID xung đột thì không ẩn deal nào.
- Script chạy trong project Apps Script riêng: sửa file trong repo xong phải dán lại vào Apps Script. Test: `tests/dong-bo-sheet.test.mjs`.

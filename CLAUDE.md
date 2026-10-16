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

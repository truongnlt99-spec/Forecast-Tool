# Career path theo quý

Mục **Overview → Career path** (`#/overview/career-path`). Áp dụng cho **CS level 1–7**; nhóm CS_A chưa áp dụng.

## Luồng

1. **Trong quý (tháng 1–3):** CS chọn *giữ level* hoặc *lên level X*, nhập commit CR, SRR_1, SRR_4 (% của cả quý).
   Lên level thì mỗi số ≥ mốc KPI của level X (bảng `LEVELS` trong `app.js`, chép sang `CAREER_LEVELS` ở
   Edge Function `api`). Sửa được tới hết tháng 3; mọi lần chốt/sửa lưu ở `career_commit_history`.
2. **Bất kỳ lúc nào:** % loading = số thực tế quý ÷ commit.
   - CR quý = Σ tử ÷ Σ mẫu của **các tháng đã tới** trong quý, mỗi tháng theo đúng quy tắc `crIn` (giống
     Scorecard / `cr_summary`). Deal trễ nằm trong mẫu số mọi tháng tới khi go-live.
   - SRR_1 / SRR_4 quý = Σ giá trị phần mềm có CHS ≥ 50 ÷ Σ giá trị phần mềm có kỳ đo T1 / T4 trong các tháng đã tới.
3. **Bấm Đạt:** mở từ tháng 3 tới hết tháng đầu quý sau. Chỉ bấm được khi mọi chỉ số có số đều ≥ commit
   (chỉ số không có deal tính trong quý được bỏ qua). Commit có lên level thì CS nhập lương mới trong khung
   của level mới → `cs_members.level` + `salary` đổi ngay, ghi `level_history`. Quá hạn → *Không đạt*.
4. Level trong popup *Cập nhật thông tin* bị khoá (`api_register` từ chối đổi level khi đã có level).
   Muốn sửa level tay: admin sửa trực tiếp bảng `cs_members` trên Supabase.

Số thực tế và điều kiện bấm Đạt **tính ở máy chủ** (Edge Function `api`, action `careerGet` /
`careerSaveCommit` / `careerAchieve`) — trình duyệt chỉ hiển thị.

## Triển khai (theo thứ tự)

1. Supabase → SQL Editor: chạy `supabase/04_career_path.sql` (chạy lại nhiều lần vẫn an toàn).
2. Deploy lại Edge Function `api` (`supabase functions deploy api --no-verify-jwt`). Bản mới tương thích ngược.
3. Merge PR → Vercel deploy `index.html` / `ui.js` / `style.css`.

Làm (3) trước (1)(2) thì trang Career path báo lỗi "action không hỗ trợ" cho tới khi xong (1)(2).

## Test

`cd tests && npm install && npm test` — `career.test.mjs` (quy tắc, Supabase giả, giờ giả) và
`career-ui.test.mjs` (Chromium + Edge Function thật, đi hết luồng commit → Đạt lên level).

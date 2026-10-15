# Rà soát cách tính CS Console theo CS Policy Ver.01 (hiệu lực 01/07/2026)

Phạm vi: công thức Database (view `v_database` trên Supabase, giống tab Database của sheet), Forecast và
Scorecard (`app.js`), lớp vá Gia hạn/Dừng (`ui.js`). Dữ liệu kiểm tra: 1.153 deal nạp ngày 15/10/2026.

## A. Đã khớp chính sách

| Mục policy | Nội dung | Ở tool |
|---|---|---|
| CHS_CS (tr.24) | 70%U + 30%O; Tier 4 = 100% O | khớp (SQL `chs()`, `fcChs`, `mcChs`) |
| Bảng điểm U (tr.26) | Tier 1: >60/>30/>10 → 100/60/40/0; Tier 2: >50/>30/>10 → 100/80/50/0; Tier 3: >30/>15/>5 → 100/80/40/0 | khớp |
| Phân Tier theo số user (tr.25) | Work Ops ≤15 → T2, 16–500 → T1, >500 → T3; People Ops ≤1000 → T2, >1000 → T3; Business Ops ≤15 → T1, 16–200 → T2, >200 → T3; App lẻ/Finance/Hiring → T4 | khớp (T4 = Bộ giải pháp "Other") |
| Chu kỳ đo (tr.27) | Go-live ≤ ngày 10 → đo trong tháng go-live; > ngày 10 → tháng sau | khớp (Tháng đo T1); T4 = T1 + 3 tháng |
| Nhóm sức khỏe (tr.23) | 0–20 At Risk · 21–50 Weak · 51–70 Healthy · 71–100 Strong | khớp |
| Mốc Performance (6.2) | CR / SRR_1 / SRR_4 từng level, mốc OUT thêm doanh thu go-live; CSA xét doanh thu | khớp từng con số |
| Xét đồng thời + loại trừ chỉ số trống (6.2) | Cả 3 trống → không xếp loại | khớp |
| % Commission T1/T4 (6.3) | Bảng 9 level × UNDER/KPI/GOAL/OUT | khớp từng con số |
| Under KPI | T1 1%, T4 0,5% × ACR có CHS ≥ 50 | khớp |
| Com năm 2+ (6.4) | Cùng kỳ năm sau, % theo performance năm đó, cần CHS ≥ 50 | khớp |
| Gia hạn (tr.36) | Gia hạn lũy kế ≤ TTGL ban đầu → ngày tối đa = 200% TTGL | khớp (`ui.js` chặn quá 200%) |
| TTGL (tr.35) | Chuẩn theo tổng giá trị + cộng thêm cho mỗi bộ từ bộ thứ 2 + 15 ngày Non-SW | BigQuery khớp 828/890 deal; 62 deal lệch, xem C3 |

## B. Lỗi cần sửa (chắc chắn sai)

1. **Hợp đồng Renew bị tính là New** (Scorecard, "Doanh thu go-live (New/Up/Cross)" và mốc OUT):
   `app.js` lọc bằng `/new|upsale|cross/i`, chữ "Re**new**" khớp chữ "new" → Renew CSM, Renew,
   Renew triển khai lại đều bị cộng vào. Ngược lại "Up-sell trong vòng 270 ngày" (viết "Up-sell")
   không khớp "upsale" nên bị loại. Sửa được trong `ui.js` sau khi chốt danh sách loại HĐ (C1).
2. **ACR bị trống khi deal không có Tháng ghi nhận CR** (view Supabase, kế thừa từ sheet): ACR là
   giá trị 1 năm, không liên quan tháng CR. Deal thiếu ngày go-live dự kiến mà vẫn go-live và
   CHS ≥ 50 sẽ mất commission. Đề xuất: ACR chỉ cần có Job ID + giá trị.
3. **Lệch mốc ngày giữa "Ngày go-live dự kiến" và cảnh báo "Quá 200%"**: BigQuery tính ngày dự kiến
   = **Ngày xác thực** + TTGL (khớp 855/855 deal), còn kiểm tra quá 200% lại dùng **Ngày nhận deal**
   + 2×TTGL (cả SQL lẫn `app.js`/`ui.js`). 69 deal có hai ngày này khác nhau. Cần dùng chung một mốc (C2).
4. **Deal trùng trong cùng Job làm phồng Tổng giá trị HĐ / Phân khúc**: 10 Job có deal trùng hệt
   (vd Job 297194: hai deal People Ops 105tr + hai deal Other 0đ → tổng 210tr thay vì 105tr → nhảy KA).
   Là lỗi dữ liệu nguồn (CRM/BigQuery), cần chị Chi lọc trùng.
5. **Business Ops / Work Ops không có số user → rơi vào Tier 3** (SQL): sheet coi trống = 0.
   17 deal từ 07/2026 thiếu số user. Đề xuất theo sheet, hoặc để "?" cho CS bổ sung.
6. **Làm tròn CHS khác nhau**: `app.js` làm tròn 1 chữ số thập phân trước khi so ≥ 50, SQL không làm
   tròn → CHS 49,96 thì Forecast/Scorecard báo Đạt nhưng cột "Đạt T1?" báo Chưa. Nên thống nhất.

## C. Điểm chưa rõ — cần anh/chị xác nhận

1. **CR có lọc loại hợp đồng không?** Policy chỉ ghi "Doanh thu go-live chỉ ghi nhận với New,
   Upsale, Cross sale" (mục 6.2). Tool đang lọc cho chỉ số Doanh thu go-live, nhưng **CR, SRR_1,
   SRR_4 và Commission thì tính mọi loại HĐ** (gồm Expansion CSM, Renew CSM, Up/Cross-sell 270
   ngày…). Có áp bộ lọc này cho CR/SRR/Com không? Và "Expansion CSM", "Up-sell trong vòng 270 ngày",
   "Up & Cross-sell trong vòng 270 ngày", "Cross-sell sau 270 ngày", "CRM,New" xếp vào nhóm nào?
2. **"Ngày nhận dự án" là ngày nào?** Policy: TTGL = Ngày go-live − Ngày nhận dự án. BigQuery dùng
   Ngày xác thực, sheet dùng Ngày tạo deal. Chọn mốc nào cho cả ngày dự kiến lẫn mốc 200%?
3. **TTGL tính trên giá trị nào?** Policy: "Tổng giá trị hợp đồng bộ phần mềm". BigQuery dùng cột
   `Tong_gia_tri_sizing` (vd deal 1143361: tổng giá trị bộ 46tr nhưng sizing 76tr → 35 ngày thay vì
   30). Sizing hay tổng giá trị phần mềm? Bộ PS/PaS có tính là "bộ" để cộng ngày không?
4. **Ngưỡng 20tr / 200tr nằm ở nhóm nào?** Bảng TTGL: SA ≤ 20tr, MA ≤ 200tr, KA > 200tr. Bảng phân
   loại khách hàng: SA < 20tr, MA 20–200tr, KA ≥ 200tr (theo **ARR**). Tool đang dùng tổng giá trị
   HĐ (không quy về năm) với SA < 20tr, KA ≥ 200tr. Cột "Phân khúc" nên theo bảng nào?
5. **"Quá 200% → dồn CR1"** (tr.36): "ghi nhận vào CR1 (cả tử số và mẫu số) của kỳ kế tiếp, duy trì
   qua các kỳ tiếp theo đến khi go-live hoặc dừng". Tool hiện **chỉ gắn nhãn**, doanh thu vẫn nằm ở
   tháng CR gốc (chỉ mẫu số). CR1 là gì (CR của tháng kế tiếp?), và "cả tử lẫn mẫu" nghĩa là deal
   được tính như đã đạt, hay cộng vào mẫu số mỗi tháng đến khi go-live?
6. **Deal go-live trễ tính vào tháng nào?** CR tháng X đang lấy deal có Tháng ghi nhận CR = X và tính
   "đạt" nếu đã có ngày go-live, **bất kể go-live tháng nào** (go-live tháng 12 vẫn làm CR tháng 10
   tăng khi xem lại). Doanh thu go-live (mốc CSA/OUT) cũng theo tháng CR chứ không theo tháng go-live
   thực tế. Như vậy có đúng ý "doanh thu go-live trong kỳ" không?
7. **Deal chưa nhập % Active/Output tới kỳ đo**: đang tính vào mẫu số SRR như không đạt. Đúng không,
   hay loại khỏi mẫu số cho tới khi có số?
8. **Deal không xác định được Tier** (Bộ giải pháp trống: 30 deal từ 07/2026; PS/PaS: 5 deal): không
   tính được CHS → luôn "không đạt" trong SRR, không có com. PS/PaS có loại khỏi SRR/Com không? Deal
   thiếu bộ giải pháp xử lý thế nào?
9. **Tier 4 chỉ gán cho bộ "Other"**: Other có bao trọn Finance Ops / Hiring / App lẻ / Base Info không?
10. **Kiêm nhiệm CS_A** (6.2): "Vai trò phụ trách" đang cố định "CS_PM,CS_A" cho **mọi** deal → mọi CS
    đều được cộng thêm % com T1 của CS_A (1,5 / 2 / 2,3%). Có đúng là chưa deal nào có CS_A riêng? Và
    phần cộng thêm lấy theo xếp loại nào: xếp loại CS (CR/SRR, như tool đang làm) hay xếp loại CS_A
    (theo doanh thu go-live)? Khi CS bị Under KPI thì tool không cộng gì — đúng chưa?
11. **ACR khi Số năm HĐ = 0 hoặc trống**: đang lấy năm = 1 cho số 0 (ACR = toàn bộ giá trị), số năm trống
    thì ACR trống (6 deal từ 07/2026). Xác nhận cách xử lý.
12. **Thưởng Up/Cross sale (6.5)**: tool áp **một mức % cho toàn bộ** doanh thu tháng (không lũy tiến),
    đúng 150tr tính 5% (policy ghi "trên 150tr"), lấy tháng nhận deal làm "tháng nhận Phụ lục", và
    chỉ tính hợp đồng Upsale/Cross sale (không gồm Expansion CSM / Up-sell 270 ngày). Xác nhận cả 4 ý.
13. **Com 4 tháng CS level 7** trong policy ghi giống hệt level 6 (3% / 3,3% / 3,5%) — có phải lỗi văn bản?
14. **CHS = 50**: theo bảng nhóm sức khỏe là "Weak" (21–50) nhưng vẫn "Đạt" để nhận com (≥ 50). Giữ nguyên?

## D. Quyết định của chủ tool (15/10/2026)

| # | Câu hỏi | Quyết định | Cần làm |
|---|---|---|---|
| 1 | Loại HĐ tính chỉ số | Doanh thu go-live, CR, SRR_1, SRR_4 tính: New, Upsale, Cross sale, Expansion CSM, Renew CSM, Up/Cross-sell 270 ngày | Sửa bộ lọc (app.js + ui.js) |
| 2 | Mốc TTGL | Ngày xác thực (giữ như BigQuery) | Không |
| 3 | Giá trị tra TTGL | Hỏi chị Chi cách tính `Tong_gia_tri_sizing` | Gửi câu hỏi |
| 4 | Phân khúc | Theo ARR (giá trị/số năm): SA < 20tr, MA 20–200tr, KA ≥ 200tr | Sửa view |
| 5–6 | CR khi chưa go-live | Deal nằm trong MẪU số CR mọi tháng từ tháng hạn cho tới tháng go-live; tháng go-live tính cả tử + mẫu; tháng sau đó không tính nữa (trừ khi gia hạn/dừng) | Sửa cách gom CR (app.js + ui.js) |
| 7 | Chưa nhập % tới kỳ đo | Tính không đạt (giữ) | Không |
| 8 | Thiếu Tier | Loại PS/PaS khỏi SRR/Com; deal trống Bộ giải pháp đánh dấu thiếu dữ liệu để bổ sung | Sửa |
| 9 | Tier 4 | Other = Tier 4 | Không |
| 10 | Kiêm nhiệm CS_A | Giữ như hiện tại | Không |
| 11 | Số năm 0/trống | Đều = 1 năm | Sửa view |
| 12 | Thưởng Up/Cross | Một mức %, 150tr = 5%, theo tháng nhận deal; tính thêm Expansion CSM + Up/Cross-sell 270 ngày | Sửa bộ lọc thưởng |
| 13 | Com 4 tháng level 7 | Giữ theo văn bản | Không |
| 14 | CHS = 50 | Giữ nguyên | Không |

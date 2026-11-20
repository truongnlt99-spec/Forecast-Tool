# Lịch go-live ở màn Forecast — thiết kế ngắn (20/11/2026)

## Mục đích
CS biết **deal nào cần kéo đánh giá trên CRM trước hạn** và **thấy ngay deal đã trễ**. Theo quy tắc CR từ 11/2026
(CLAUDE.md mục 14), kéo sau ngày hạn thì deal không vào tử số, nên ngày hạn là thứ CS cần nhìn.

## Cách làm đã chọn
Lịch tháng dạng ô ngày, kèm khung cảnh báo quá hạn ở trên và banner nhắc ở đầu Forecast.
Đã cân nhắc thêm: danh sách theo tuần (gọn hơn trên điện thoại nhưng không phải dạng lịch) và chỉ thêm ô đếm/bộ lọc
(ít việc nhưng không thấy deal dồn vào ngày nào). Trường chọn lịch ô ngày.

## Thiết kế
- **Chỗ đặt:** nút "Lịch go-live" cạnh nút "Lịch đánh giá" ở Forecast; mở ra khối lịch giống khối Lịch đánh giá.
- **Tháng hiển thị:** theo tháng đang chọn ở Forecast (`fcFilterMonth`), có nút ‹ › đổi tháng.
- **Deal nằm ở ô nào:** ngày hạn = ngày gia hạn, không có thì ngày go-live dự kiến.
- **Deal nào hiện:** deal tính CR (loại HĐ được tính, không dừng triển khai) — cùng điều kiện với `cxCrState()`.
- **4 màu trạng thái:**
  - 🟢 đã kéo trên CRM, đúng/trước hạn
  - 🟠 đã kéo trên CRM nhưng sau hạn (chỉ tính mẫu số)
  - ⚪ chưa kéo, còn hạn (ghi "còn N ngày")
  - 🔴 chưa kéo, đã quá hạn
  - Ngày CS tự nhập không tính là "đã kéo" (quy tắc mục 14).
- **Khung cảnh báo trên cùng:** mọi deal 🔴 chưa kéo đã quá hạn — **kể cả hạn ở tháng trước** — xếp hạn cũ nhất trước.
- **Dòng tổng:** tổng deal trong tháng + số deal mỗi màu + DT phải go-live.
- **Bấm 1 deal:** nhảy tới đúng dòng deal trong bảng Forecast (như nút "Nhập →" của Lịch đánh giá).
- **Banner nhắc:** đầu Forecast, khi có deal còn ≤ 3 ngày tới hạn mà chưa kéo; bấm → mở lịch.
- **Điện thoại (màn hẹp):** hiện dạng danh sách theo ngày thay cho lưới 7 cột.
- Chỉ đọc, không ghi gì về máy chủ. Không đổi app.js, không đổi database.

## Để người làm tự quyết
- Mã nguồn ở ui.js, mục TRỢ LÝ CS, dùng dữ liệu `st.deals` sẵn có. Hàm thuần tính trạng thái/nhóm theo ngày đặt trong
  khối `==CX PURE START/END==` để test trên Node; thêm 1 test giao diện Chromium.
- Màu, khoảng cách theo style.css hiện có. Bump `?v=` ui.js (và style.css nếu đổi).
- Thêm 1 bước vào Product tour nếu hợp.

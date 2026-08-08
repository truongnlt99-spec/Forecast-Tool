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

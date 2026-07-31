# Cập nhật Apps Script cho tính năng Gia hạn & Dừng triển khai

Frontend (branch `feature/extend-stop-request`) gọi API mới `action=saveRequest`
để ghi đề xuất **Gia hạn Go-live** / **Dừng triển khai** về sheet `Database`.
Backend hiện tại chưa biết action này → cần làm 2 việc dưới đây. Khi chưa cập
nhật, mọi thao tác Xác nhận trên web sẽ báo lỗi rõ ràng (không lưu "giả").

## 1. Chuẩn bị sheet `Database`

Đảm bảo có các cột sau (theo spec: cột **O** và cột **T**):

| Cột | Header (dòng 1)          | Ghi chú                                            |
|-----|--------------------------|----------------------------------------------------|
| O   | `Ngày Go-live gia hạn`   | Frontend ghi dạng `dd/mm/yyyy`; xoá đề xuất → xoá ô |
| T   | `Dừng triển khai`        | Ghi `x` khi dừng; xoá đề xuất → xoá ô               |
| (tuỳ chọn) | `Link request`    | Cột bất kỳ; nếu có header này thì link được lưu     |

> Script bên dưới **tìm cột theo header trước**, chỉ khi không thấy header mới
> rơi về cột O/T cố định — nên nếu sheet đã có sẵn header đúng tên thì vị trí
> cột thực tế không quan trọng.

## 2. Thêm handler vào Code.gs

Trong `doPost(e)` hiện tại (chỗ đang xử lý `body.rows` để lưu forecast), thêm
nhánh xử lý mới **trước** phần xử lý `rows`:

```javascript
// ==== NEW: Gia hạn Go-live / Dừng triển khai (feature/extend-stop-request) ====
if (body.action === 'saveRequest') {
  return jsonOut_(handleSaveRequest_(body));   // dùng đúng hàm trả JSON sẵn có của bạn
}
```

Rồi dán thêm hàm này vào cuối file:

```javascript
function handleSaveRequest_(body) {
  // body: { token, action:'saveRequest', dealId, reqType:'extend'|'stop',
  //         glExtend:'dd/mm/yyyy'|'', requestLink:'', remove:true|false }
  // LƯU Ý: gọi đúng hàm verify token sẵn có của bạn ở đây (giống các action khác):
  // if (!verifyToken_(body.token)) return { ok:false, error:'Token không hợp lệ' };

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('Database');
  if (!sh) return { ok: false, error: 'Không thấy sheet Database' };

  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
                  .map(function (h) { return String(h).toLowerCase(); });
  function colByHeader(pattern, fallbackCol) {
    for (var i = 0; i < headers.length; i++) {
      if (headers[i].indexOf(pattern) !== -1) return i + 1;
    }
    return fallbackCol || 0;
  }
  var COL_ID     = colByHeader('deal id');
  var COL_EXTEND = colByHeader('gia hạn', 15);        // fallback: cột O
  var COL_STOP   = colByHeader('dừng triển khai', 20); // fallback: cột T
  var COL_LINK   = colByHeader('link request', 0);     // 0 = không có thì bỏ qua
  if (!COL_ID) return { ok: false, error: 'Không thấy cột Deal ID' };

  var ids = sh.getRange(2, COL_ID, Math.max(sh.getLastRow() - 1, 1), 1).getValues();
  var row = 0;
  for (var r = 0; r < ids.length; r++) {
    if (String(ids[r][0]).trim() === String(body.dealId).trim()) { row = r + 2; break; }
  }
  if (!row) return { ok: false, error: 'Không thấy deal ' + body.dealId + ' trong Database' };

  if (body.reqType === 'extend') {
    sh.getRange(row, COL_EXTEND).setValue(body.remove ? '' : body.glExtend);
  } else if (body.reqType === 'stop') {
    sh.getRange(row, COL_STOP).setValue(body.remove ? '' : 'x');
  } else {
    return { ok: false, error: 'reqType không hợp lệ' };
  }
  if (COL_LINK) sh.getRange(row, COL_LINK).setValue(body.remove ? '' : (body.requestLink || ''));

  return { ok: true };
}
```

> Nếu Code.gs của bạn không có hàm `jsonOut_` thì thay bằng cách trả JSON bạn
> đang dùng cho các action khác, ví dụ:
> `ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON)`

## 3. Deploy

**Deploy → Manage deployments → chọn deployment đang chạy → New version.**
Tuyệt đối không "New deployment" (sẽ đổi URL `/exec` và làm hỏng `config.js`).

## Frontend hoạt động thế nào sau khi backend sẵn sàng

- Nút 🕐 / ✕ trên từng dòng ở bảng Danh sách deal → mở popup 2 phần đúng spec
  (thông tin deal + form). Dừng triển khai có xác nhận 2 lần.
- Màn **Request** (nút thứ 3 trong sidebar, ngang Năm 1 / Năm 2++): danh sách
  đề xuất, bộ lọc đếm theo loại, Tạo mới (chọn loại → search deal → form),
  Sửa / Xoá từng đề xuất.
- Deal có đề xuất được gắn nhãn **Gia hạn** (vàng) / **Dừng triển khai** (đỏ)
  ngay trong bảng — bấm nhãn nhảy sang màn Request. Deal dừng bị làm mờ.
- Deal gia hạn hiện thêm 1 hàng (chỉ đọc, nền vàng nhạt) khi chọn đúng tháng
  của ngày Go-live gia hạn.
- 2 card **tử số / mẫu số CR** tự trừ deal Dừng (mọi tháng) và chuyển deal Gia
  hạn sang tháng gia hạn — có ghi chú "đã điều chỉnh" ngay trên card.

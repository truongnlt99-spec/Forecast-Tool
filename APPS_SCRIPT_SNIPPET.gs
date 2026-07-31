// ============================================================================
// GIA HẠN GO-LIVE / DỪNG TRIỂN KHAI — Handler mới cho action='saveRequest'
// ============================================================================
// CÁCH DÙNG:
// 1. Copy đoạn này vào Code.gs của bạn
// 2. Trong hàm doPost(e), TRƯỚC phần xử lý rows cũ, thêm dòng này:
//    if (body.action === 'saveRequest') { return jsonOut_(handleSaveRequest_(body)); }
// 3. Deploy: New version (KHÔNG New deployment!)
//
// Ví dụ doPost(e) sau khi thêm:
// function doPost(e) {
//   var body = JSON.parse(e.postData.contents);
//   if (!verifyToken_(body.token)) return jsonOut_({ ok: false, error: 'Token không hợp lệ' });
//
//   // NEW: Gia hạn & Dừng triển khai
//   if (body.action === 'saveRequest') { return jsonOut_(handleSaveRequest_(body)); }
//
//   // CŨ: Forecast, Scorecard, v.v.
//   if (body.rows) { ... existing code ... }
//   ...
// }
// ============================================================================

function handleSaveRequest_(body) {
  // Payload từ frontend:
  // { token, action:'saveRequest', dealId, reqType:'extend'|'stop',
  //   glExtend:'dd/mm/yyyy'|'', requestLink:'', remove:true|false }
  //
  // Ghi về sheet Database:
  //   - reqType='extend' → cột O: glExtend (hoặc xoá ô nếu remove=true)
  //   - reqType='stop' → cột T: 'x' (hoặc xoá ô nếu remove=true)
  //   - Cột Link request (nếu có): requestLink

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('Database');
  if (!sh) return { ok: false, error: 'Không thấy sheet Database' };

  // Tìm cột theo header (tránh phụ thuộc vào vị trí cố định)
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
                  .map(function (h) { return String(h).toLowerCase(); });

  function colByHeader(pattern, fallbackCol) {
    for (var i = 0; i < headers.length; i++) {
      if (headers[i].indexOf(pattern) !== -1) return i + 1;
    }
    return fallbackCol || 0;
  }

  var COL_ID     = colByHeader('deal id');
  var COL_EXTEND = colByHeader('gia hạn', 15);         // fallback: cột O (thứ 15)
  var COL_STOP   = colByHeader('dừng triển khai', 20); // fallback: cột T (thứ 20)
  var COL_LINK   = colByHeader('link request', 0);     // 0 = không tìm thấy → bỏ qua

  if (!COL_ID) return { ok: false, error: 'Không thấy cột Deal ID trong Database' };

  // Tìm dòng deal theo dealId
  var ids = sh.getRange(2, COL_ID, Math.max(sh.getLastRow() - 1, 1), 1).getValues();
  var row = 0;
  for (var r = 0; r < ids.length; r++) {
    if (String(ids[r][0]).trim() === String(body.dealId).trim()) {
      row = r + 2; // dòng 2 trở đi (dòng 1 là header)
      break;
    }
  }
  if (!row) {
    return { ok: false, error: 'Không thấy deal ' + body.dealId + ' trong Database' };
  }

  // Ghi dữ liệu theo reqType
  if (body.reqType === 'extend') {
    // Cột O: Ngày Go-live gia hạn
    sh.getRange(row, COL_EXTEND).setValue(body.remove ? '' : body.glExtend);
  } else if (body.reqType === 'stop') {
    // Cột T: Dừng triển khai (ghi 'x' hoặc xoá)
    sh.getRange(row, COL_STOP).setValue(body.remove ? '' : 'x');
  } else {
    return { ok: false, error: 'reqType phải là "extend" hoặc "stop"' };
  }

  // Cột Link request (nếu có)
  if (COL_LINK && COL_LINK > 0) {
    sh.getRange(row, COL_LINK).setValue(body.remove ? '' : (body.requestLink || ''));
  }

  return { ok: true };
}

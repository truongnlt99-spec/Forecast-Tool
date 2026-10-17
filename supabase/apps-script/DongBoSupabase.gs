/**
 * =====================================================================
 * ĐỒNG BỘ BIGQUERY → SUPABASE (bảng deals_raw) — bước 4 plan migration
 *
 * Chạy query THẲNG trên BigQuery (không đọc tab "Bigquery" của sheet),
 * gửi kết quả sang Supabase theo lô 500 dòng qua hàm sync_deals_raw.
 * Cập nhật theo Deal ID → không bao giờ lệch dòng. Deal rớt khỏi query
 * chỉ bị đánh dấu is_active = false, không xoá.
 *
 * CÀI ĐẶT (1 lần):
 *  1. Vào https://script.google.com → Dự án mới (project RIÊNG, không gắn
 *     sheet — sau này bỏ sheet thì đồng bộ vẫn chạy) → đặt tên
 *     "Dong bo Supabase" → xoá code mặc định → dán toàn bộ file này.
 *  2. Menu trái "Services" (+) → chọn "BigQuery API" → Add.
 *  3. Project Settings (bánh răng) → Script Properties → Add script property:
 *       SUPABASE_SERVICE_KEY = key "secret"/"service_role" ở Supabase
 *       (Project Settings → API Keys). KHÔNG dán key vào code hay chat.
 *  4. Không cần dán query: script tự đọc query + project BigQuery từ nguồn
 *     Connected Sheets của tab "Bigquery" (sheet SHEET_ID). Ai sửa query ở
 *     đó thì lượt đồng bộ sau tự theo. Muốn cố định query thì điền BQ_QUERY.
 *  5. Chạy dongBoDeals() 1 lần (lần đầu Google hỏi quyền → Allow), xem log.
 *     Ổn thì chạy caiDatTrigger() để tự đồng bộ mỗi giờ.
 *
 * NGUỒN DỮ LIỆU (SYNC.NGUON, từ 17/10/2026):
 *  - 'sheet'    (đang dùng, TẠM THỜI): đọc tab "Extract of Raw" mà chị Chi đồng bộ sẵn
 *               trong sheet SHEET_ID — cùng tên cột với query BigQuery. Script tự đổi ngày
 *               dd/mm/yyyy → yyyy-mm-dd, bỏ ô lỗi công thức (#NAME?, #N/A…). Ở chế độ này
 *               deal không có trong tab KHÔNG bị đánh dấu ngừng (tab chỉ giữ các deal gần
 *               đây; deal cũ vẫn cần cho Com Năm 2++), chỉ thêm / cập nhật.
 *  - 'bigquery' : chạy query thẳng trên BigQuery như trước. Đổi lại khi có quyền BigQuery ổn định.
 * =====================================================================
 */

var SYNC = {
  NGUON: 'sheet',      // 'sheet' | 'bigquery'
  SHEET_TAB: 'Extract of Raw',
  MIN_ROWS: 500,       // tab ít hơn số dòng này → coi là đang lỗi / đang cập nhật dở, dừng
  MAX_DUP_RATE: 0.05,  // > 5% Deal ID bị lặp với nội dung khác nhau → sheet nghi hỏng (dán chồng…), dừng
  SUPABASE_URL: 'https://lheaoklvumzapmwuhysr.supabase.co',
  BQ_PROJECT_ID: 'base-data-analyst',
  BQ_QUERY: '',        // để trống = đọc query từ tab "Bigquery" (Connected Sheets)
  TIMEZONE: 'Asia/Ho_Chi_Minh',
  BATCH_SIZE: 500,
  // Sheet chứa tab "Bigquery" (Connected Sheets) — nơi lấy query
  SHEET_ID: '1r_5F56Rs59205KTOG9HA49VUonlDwIKxlR3ld_MnVmA'
};

function dongBoDeals() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) { Logger.log('Lượt trước chưa chạy xong, bỏ qua.'); return; }
  try {
    var tuSheet = SYNC.NGUON === 'sheet';
    var rows;
    if (tuSheet) {
      var raw = docSheet_();
      Logger.log('Tab "%s" có %s dòng', SYNC.SHEET_TAB, raw.length);
      var dd = locTrung_(raw);
      rows = dd.rows;
      if (dd.idSai) Logger.log('Bỏ %s dòng Deal ID không hợp lệ', dd.idSai);
      if (dd.trungGiong) Logger.log('Bỏ %s dòng lặp y hệt (cùng Deal ID, cùng nội dung)', dd.trungGiong);
      if (dd.xungDot.length) Logger.log('KHÔNG cập nhật %s deal có nhiều dòng KHÁC nhau (giữ số cũ trên Supabase): %s',
        dd.xungDot.length, dd.xungDot.join(', '));
      if (dd.nghiTrungJob.length) Logger.log('Cảnh báo — deal khác ID nhưng giống hệt trong cùng Job (lỗi nguồn, báo chị Chi lọc): %s',
        dd.nghiTrungJob.join(' | '));
      if (rows.length < SYNC.MIN_ROWS) throw new Error('Tab "' + SYNC.SHEET_TAB + '" chỉ có ' + rows.length +
        ' deal hợp lệ (< ' + SYNC.MIN_ROWS + ') — có thể đang cập nhật dở, dừng, không đồng bộ.');
      if (dd.xungDot.length > rows.length * SYNC.MAX_DUP_RATE) throw new Error(dd.xungDot.length +
        ' Deal ID bị lặp với nội dung khác nhau — sheet nghi bị dán chồng / lỗi, dừng, không đồng bộ.');
    } else {
      var src = layQuery_();
      rows = queryBigQuery_(src.projectId, src.query);
      Logger.log('BigQuery trả về %s dòng', rows.length);
      if (!rows.length) throw new Error('BigQuery trả về 0 dòng — dừng, không đồng bộ.');
    }

    var runAt = new Date().toISOString();
    var total = { upserted: 0, bo_qua_thieu_id: 0, deactivated: 0, cot_khong_khop: {} };
    for (var i = 0; i < rows.length; i += SYNC.BATCH_SIZE) {
      var batch = rows.slice(i, i + SYNC.BATCH_SIZE);
      // nguồn sheet: không bao giờ gửi lô cuối (p_final) → không đánh dấu ngừng deal vắng mặt
      var res = callSync_(batch, runAt, !tuSheet && i + SYNC.BATCH_SIZE >= rows.length);
      total.upserted += res.upserted;
      total.bo_qua_thieu_id += res.bo_qua_thieu_id;
      total.deactivated += res.deactivated;
      (res.cot_khong_khop || []).forEach(function (c) { total.cot_khong_khop[c] = true; });
    }
    Logger.log('Xong: cập nhật %s deal, bỏ qua %s dòng thiếu Deal ID, ngừng %s deal.',
      total.upserted, total.bo_qua_thieu_id, total.deactivated);
    var lech = Object.keys(total.cot_khong_khop);
    if (lech.length) Logger.log('Cột BigQuery không khớp bảng deals_raw (bị bỏ qua): %s', lech.join(', '));
  } finally {
    lock.releaseLock();
  }
}

// Đọc tab Extract of Raw → mảng object {tên cột: giá trị} giống kết quả BigQuery.
function docSheet_() {
  var sh = SpreadsheetApp.openById(SYNC.SHEET_ID).getSheetByName(SYNC.SHEET_TAB);
  if (!sh) throw new Error('Không thấy tab "' + SYNC.SHEET_TAB + '" trong sheet ' + SYNC.SHEET_ID);
  return sheetToRows_(sh.getDataRange().getValues());
}

// values[0] = dòng tiêu đề. Ngày (Date hoặc chữ dd/mm/yyyy) → 'yyyy-MM-dd' giờ VN (Postgres
// hiểu dd/mm là mm/dd → 05/10 thành 10/05). Ô lỗi công thức / rỗng → null. Số → chuỗi.
function sheetToRows_(values) {
  var head = (values[0] || []).map(function (h) { return String(h).trim(); });
  var out = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r], o = {}, any = false;
    for (var c = 0; c < head.length; c++) {
      if (!head[c]) continue;
      o[head[c]] = oSheet_(row[c]);
      if (o[head[c]] != null) any = true;
    }
    if (any && o.Deal_ID != null) out.push(o);
  }
  return out;
}
function oSheet_(v) {
  if (v === null || v === undefined || v === '') return null;
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return isNaN(v.getTime()) ? null : Utilities.formatDate(v, SYNC.TIMEZONE, 'yyyy-MM-dd');
  }
  if (typeof v === 'number') return isFinite(v) ? String(v) : null;
  if (typeof v === 'boolean') return String(v);
  var s = String(v).trim();
  if (!s || /^#(NAME\?|N\/A|REF!|VALUE!|DIV\/0!|NUM!|NULL!|ERROR!)/.test(s)) return null;
  var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  return s;
}

// Chống trùng trước khi đẩy sang Supabase (deals_raw khoá theo deal_id nên DB không bao giờ có 2 dòng
// cùng deal; nhưng sheet có 2 dòng cùng Deal ID thì không biết dòng nào đúng):
//  - Deal ID chuẩn hoá về chữ số ("1,180,370" / "1180370.0" → "1180370"); không phải số → bỏ.
//  - Lặp y hệt → giữ 1. Lặp mà nội dung KHÁC nhau → bỏ cả deal lượt này (Supabase giữ số cũ) + ghi log.
//  - Deal khác ID nhưng trùng Job + tên + giá trị + bộ giải pháp + loại HĐ → chỉ cảnh báo (lỗi nguồn,
//    không tự xoá vì có thể là deal thật).
function locTrung_(rows) {
  var byId = {}, order = [], conflict = {}, idSai = 0, trungGiong = 0;
  rows.forEach(function (r) {
    var id = String(r.Deal_ID == null ? '' : r.Deal_ID).replace(/[,\s]/g, '').replace(/\.0+$/, '');
    if (!/^\d{1,15}$/.test(id)) { idSai++; return; }
    r.Deal_ID = id;
    var key = JSON.stringify(r);
    if (!byId[id]) { byId[id] = { row: r, key: key }; order.push(id); return; }
    if (byId[id].key === key) trungGiong++;
    else conflict[id] = true;
  });
  var out = order.filter(function (id) { return !conflict[id]; }).map(function (id) { return byId[id].row; });
  var job = {};
  out.forEach(function (r) {
    if (r.Job_ID == null) return;
    var k = [r.Job_ID, r.Deal_name, r.Deal_value, r.Bo_giai_phap, r.Loai_hop_dong].join('|');
    (job[k] = job[k] || []).push(r.Deal_ID);
  });
  var nghi = Object.keys(job).filter(function (k) { return job[k].length > 1; })
    .map(function (k) { return 'Job ' + k.split('|')[0] + ': ' + job[k].join(', '); });
  return { rows: out, idSai: idSai, trungGiong: trungGiong, xungDot: Object.keys(conflict), nghiTrungJob: nghi };
}

// Query + project: ưu tiên SYNC.BQ_QUERY, không có thì đọc từ nguồn Connected Sheets
function layQuery_() {
  if (SYNC.BQ_QUERY) return { projectId: SYNC.BQ_PROJECT_ID, query: SYNC.BQ_QUERY };
  var sources = SpreadsheetApp.openById(SYNC.SHEET_ID).getDataSources();
  for (var i = 0; i < sources.length; i++) {
    var bq = sources[i].getSpec().asBigQuery();
    var q = bq.getRawQuery();
    if (q && q.indexOf('Deal_ID') !== -1) return { projectId: bq.getProjectId() || SYNC.BQ_PROJECT_ID, query: q };
  }
  throw new Error('Không tìm thấy query BigQuery trong sheet ' + SYNC.SHEET_ID + ' — điền SYNC.BQ_QUERY.');
}

// Chạy query, trả về mảng object {tên cột: giá trị}
function queryBigQuery_(projectId, sql) {
  var resp = BigQuery.Jobs.query({ query: sql, useLegacySql: false, timeoutMs: 120000 }, projectId);
  var jobId = resp.jobReference.jobId;
  var location = resp.jobReference.location;
  var wait = 1000;
  while (!resp.jobComplete) {
    Utilities.sleep(wait);
    wait = Math.min(wait * 2, 10000);
    resp = BigQuery.Jobs.getQueryResults(projectId, jobId, { location: location });
  }
  var fields = resp.schema.fields;
  var out = [];
  var page = resp;
  while (true) {
    (page.rows || []).forEach(function (r) { out.push(rowToObj_(fields, r)); });
    if (!page.pageToken) break;
    page = BigQuery.Jobs.getQueryResults(projectId, jobId,
      { pageToken: page.pageToken, location: location });
  }
  return out;
}

function rowToObj_(fields, row) {
  var o = {};
  for (var i = 0; i < fields.length; i++) {
    var f = fields[i], v = row.f[i].v;
    if (v === null || v === undefined) { o[f.name] = null; continue; }
    // TIMESTAMP → giờ Việt Nam (để cột ngày không lùi 1 ngày do UTC)
    if (f.type === 'TIMESTAMP') v = Utilities.formatDate(new Date(Number(v) * 1000), SYNC.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssXXX");
    else if (typeof v === 'object') v = JSON.stringify(v);   // RECORD/REPEATED
    o[f.name] = v;   // số giữ dạng chuỗi để không mất chính xác; Supabase tự ép kiểu
  }
  return o;
}

function callSync_(rows, runAt, isFinal) {
  var key = PropertiesService.getScriptProperties().getProperty('SUPABASE_SERVICE_KEY');
  if (!key) throw new Error('Chưa đặt Script Property SUPABASE_SERVICE_KEY.');
  var headers = { apikey: key };
  // Key kiểu cũ (JWT eyJ...) cần thêm Authorization; key mới sb_secret_... thì không
  if (key.indexOf('sb_') !== 0) headers.Authorization = 'Bearer ' + key;

  var resp = UrlFetchApp.fetch(SYNC.SUPABASE_URL + '/rest/v1/rpc/sync_deals_raw', {
    method: 'post',
    contentType: 'application/json',
    headers: headers,
    payload: JSON.stringify({ p_rows: rows, p_run_at: runAt, p_final: isFinal }),
    muteHttpExceptions: true
  });
  var code = resp.getResponseCode();
  if (code !== 200) throw new Error('Supabase lỗi ' + code + ': ' + resp.getContentText());
  return JSON.parse(resp.getContentText());
}

// Tạo trigger chạy dongBoDeals mỗi giờ (chạy 1 lần; chạy lại không tạo trùng)
function caiDatTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'dongBoDeals') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('dongBoDeals').timeBased().everyHours(1).create();
  Logger.log('Đã cài trigger đồng bộ mỗi giờ.');
}

// In ra nguồn BigQuery của các tab Connected Sheets để copy vào SYNC
function xemNguonBigQuery() {
  var ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(SYNC.SHEET_ID);
  var sources = ss.getDataSources();
  if (!sources.length) {
    Logger.log('Sheet không có nguồn Connected Sheets. Lấy query ở nơi đang đổ dữ liệu vào tab "Bigquery".');
    return;
  }
  sources.forEach(function (ds, i) {
    var bq = ds.getSpec().asBigQuery();
    Logger.log('--- Nguồn %s ---\nProject: %s\nBảng: %s.%s.%s\nQuery:\n%s', i + 1,
      bq.getProjectId(), bq.getTableProjectId(), bq.getDatasetId(), bq.getTableId(),
      bq.getRawQuery());
  });
}

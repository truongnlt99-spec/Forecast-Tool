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
 *  4. Điền BQ_PROJECT_ID và BQ_QUERY bên dưới. Không nhớ query? Chạy hàm
 *     xemNguonBigQuery() → xem Execution log (nếu tab Bigquery là
 *     Connected Sheets thì log in sẵn project + query).
 *  5. Chạy dongBoDeals() 1 lần, xem log. Ổn thì chạy caiDatTrigger()
 *     để tự đồng bộ mỗi giờ.
 * =====================================================================
 */

var SYNC = {
  SUPABASE_URL: 'https://lheaoklvumzapmwuhysr.supabase.co',
  BQ_PROJECT_ID: '',   // vd 'base-data-123456'
  BQ_QUERY: '',        // dán nguyên query Standard SQL đang dùng cho tab Bigquery
  BATCH_SIZE: 500,
  // Chỉ dùng cho xemNguonBigQuery() khi script nằm ở project riêng (không gắn sheet)
  SHEET_ID: '1r_5F56Rs59205KTOG9HA49VUonlDwIKxlR3ld_MnVmA'
};

function dongBoDeals() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) { Logger.log('Lượt trước chưa chạy xong, bỏ qua.'); return; }
  try {
    if (!SYNC.BQ_PROJECT_ID || !SYNC.BQ_QUERY) {
      throw new Error('Chưa điền BQ_PROJECT_ID / BQ_QUERY trong SYNC.');
    }
    var rows = queryBigQuery_(SYNC.BQ_PROJECT_ID, SYNC.BQ_QUERY);
    Logger.log('BigQuery trả về %s dòng', rows.length);
    if (!rows.length) throw new Error('BigQuery trả về 0 dòng — dừng, không đồng bộ.');

    var runAt = new Date().toISOString();
    var total = { upserted: 0, bo_qua_thieu_id: 0, deactivated: 0, cot_khong_khop: {} };
    for (var i = 0; i < rows.length; i += SYNC.BATCH_SIZE) {
      var batch = rows.slice(i, i + SYNC.BATCH_SIZE);
      var res = callSync_(batch, runAt, i + SYNC.BATCH_SIZE >= rows.length);
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
    if (f.type === 'TIMESTAMP') v = new Date(Number(v) * 1000).toISOString();
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

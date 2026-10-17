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
 *               dd/mm/yyyy → yyyy-mm-dd, bỏ ô lỗi công thức (#NAME?, #N/A…). Deal không còn
 *               trong tab bị đánh dấu ngừng (ẩn khỏi console, không xoá) như nguồn BigQuery —
 *               trừ lượt có Deal ID xung đột (xem locTrung_) thì lượt đó không ẩn deal nào.
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

    // Lượt có Deal ID xung đột: các deal đó không được gửi → nếu bật ẩn deal vắng mặt thì chúng bị ẩn oan.
    var anDealVang = !tuSheet || !dd.xungDot.length;
    if (!anDealVang) Logger.log('Lượt này KHÔNG ẩn deal vắng mặt vì có Deal ID xung đột.');
    var runAt = new Date().toISOString();
    var total = { upserted: 0, bo_qua_thieu_id: 0, deactivated: 0, cot_khong_khop: {} };
    for (var i = 0; i < rows.length; i += SYNC.BATCH_SIZE) {
      var batch = rows.slice(i, i + SYNC.BATCH_SIZE);
      // lô cuối (p_final) → Supabase đánh dấu ngừng deal không có trong lượt này; chốt an toàn ở SQL:
      // lượt thấy < 50% số deal đang active thì báo lỗi, không ẩn hàng loạt
      var res = callSync_(batch, runAt, anDealVang && i + SYNC.BATCH_SIZE >= rows.length);
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
//  - Deal ID khác nhau thì luôn đồng bộ bình thường (1 Job có nhiều deal là chuyện thường).
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
  return { rows: out, idSai: idSai, trungGiong: trungGiong, xungDot: Object.keys(conflict) };
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
  return rpc_('sync_deals_raw', { p_rows: rows, p_run_at: runAt, p_final: isFinal });
}

// Gọi 1 hàm SQL trên Supabase bằng service key (Script Property SUPABASE_SERVICE_KEY)
function rpc_(fn, args) {
  var key = PropertiesService.getScriptProperties().getProperty('SUPABASE_SERVICE_KEY');
  if (!key) throw new Error('Chưa đặt Script Property SUPABASE_SERVICE_KEY.');
  var headers = { apikey: key };
  // Key kiểu cũ (JWT eyJ...) cần thêm Authorization; key mới sb_secret_... thì không
  if (key.indexOf('sb_') !== 0) headers.Authorization = 'Bearer ' + key;

  var resp = UrlFetchApp.fetch(SYNC.SUPABASE_URL + '/rest/v1/rpc/' + fn, {
    method: 'post',
    contentType: 'application/json',
    headers: headers,
    payload: JSON.stringify(args || {}),
    muteHttpExceptions: true
  });
  var code = resp.getResponseCode();
  if (code !== 200) throw new Error('Supabase lỗi ' + code + ': ' + resp.getContentText());
  return JSON.parse(resp.getContentText());
}

/* =====================================================================
 * MAIL BÁO NGƯỜI GỬI KHI FEEDBACK HOÀN THÀNH (cần chạy supabase/08_mail_feedback.sql)
 * Mỗi 5 phút: feedback vừa chuyển sang trạng thái trong MAIL_FB.TRANG_THAI mà chưa gửi mail →
 * gửi bằng Gmail của tài khoản chạy script → đánh dấu đã gửi (mỗi lần hoàn thành chỉ 1 mail;
 * mở lại rồi hoàn thành lần nữa thì gửi lại). Mail lỗi thì để lượt sau thử lại.
 * ===================================================================== */
var MAIL_FB = {
  TRANG_THAI: ['Completed'],          // thêm "Won't Do" nếu muốn báo cả feedback không thực hiện
  LINK: 'https://csconsole.vercel.app',
  TEN_NGUOI_GUI: 'CS Console',        // tên hiện ở ô "Từ" trong hộp thư

  // ---- NỘI DUNG — sửa thoải mái. Biến: {ten} {tieu_de} {trang_thai} {ngay_gui} ----
  TIEU_DE_MAIL: '[CS Console] Feedback "{tieu_de}" — {trang_thai}',
  LOI_CHAO: 'Chào {ten},',
  DOAN_MO_DAU: 'Feedback bạn gửi ngày {ngay_gui} đã được team cập nhật trạng thái. Cảm ơn bạn đã dành thời gian góp ý để CS Console tốt hơn mỗi ngày!',
  NHAN_PHAN_HOI: 'Phản hồi từ team',
  CHU_NUT: 'Mở CS Console',
  CHU_KY: 'Team CS Console',
  CHAN_TRANG: 'Bạn nhận được mail này vì đã gửi Product Feedback trên CS Console. Có thắc mắc thêm, cứ trả lời trực tiếp mail này.',

  // ---- GIAO DIỆN ----
  MAU_CHU_DAO: '#3D5CFF',             // màu đầu mail + nút
  MAU_TRANG_THAI: { 'Completed': '#16A34A', "Won't Do": '#64748B', 'In Progress': '#D97706', 'Received': '#3D5CFF' }
};
var MAIL_FB_NHAN = { 'Completed': 'Hoàn thành', "Won't Do": 'Không thực hiện', 'In Progress': 'Đang xử lý', 'Received': 'Đã nhận' };

function guiMailFeedback() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) { Logger.log('Đang có lượt chạy khác, để lượt sau.'); return; }
  try {
    var list = rpc_('mail_fb_pending', { p_statuses: MAIL_FB.TRANG_THAI }) || [];
    var sent = 0, loi = 0;
    for (var i = 0; i < list.length; i++) {
      if (MailApp.getRemainingDailyQuota() < 1) { Logger.log('Hết lượt gửi mail hôm nay, để mai gửi tiếp.'); break; }
      var f = list[i];
      try {
        guiMotMailFb_(f.email, f);
        rpc_('mail_fb_mark_sent', { p_id: f.id, p_status: f.status });
        sent++;
      } catch (e) {
        loi++;
        Logger.log('Không gửi được mail feedback %s tới %s: %s', f.id, f.email, e.message);
      }
    }
    if (sent || loi) Logger.log('Mail feedback: đã gửi %s, lỗi %s.', sent, loi);
  } finally {
    lock.releaseLock();
  }
}

// Gửi 1 mail MẪU tới chính bạn để xem giao diện (không đụng dữ liệu Supabase). Chạy tay từ editor.
function guiMailThu() {
  var me = Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail();
  guiMotMailFb_(me, {
    id: 'PFDEMO', name: 'Nguyễn Văn A', title: 'Màn Forecast: thêm cột Ngày nhận deal', status: 'Completed',
    submittedAt: '16/10/2026',
    reply: 'Chào bạn, team đã thêm cột "Ngày nhận deal" vào bảng Forecast (Năm 1).\nBạn tải lại trang (Ctrl+Shift+R) để thấy thay đổi nhé.'
  });
  Logger.log('Đã gửi mail mẫu tới %s', me);
}

function guiMotMailFb_(to, f) {
  var m = noiDungMailFb_(f);
  MailApp.sendEmail({ to: to, subject: m.subject, body: m.body, htmlBody: m.html, name: MAIL_FB.TEN_NGUOI_GUI });
}

function thayBien_(tpl, v) {
  return String(tpl).replace(/\{(ten|tieu_de|trang_thai|ngay_gui)\}/g, function (_, k) { return v[k] == null ? '' : v[k]; });
}
function escHtml_(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

// Trả về { subject, body (chữ thuần, cho máy không xem được HTML), html }
function noiDungMailFb_(f) {
  var C = MAIL_FB, nhan = MAIL_FB_NHAN[f.status] || f.status;
  var v = { ten: f.name || 'bạn', tieu_de: f.title, trang_thai: nhan, ngay_gui: f.submittedAt || '' };
  var vh = {};   // bản đã escape để chèn vào HTML
  for (var k in v) vh[k] = escHtml_(v[k]);
  var mauTT = (C.MAU_TRANG_THAI || {})[f.status] || C.MAU_CHU_DAO;

  var body = thayBien_(C.LOI_CHAO, v) + '\n\n' + thayBien_(C.DOAN_MO_DAU, v) + '\n\n' +
    'Feedback: ' + f.title + '\nTrạng thái: ' + nhan + '\n' +
    (f.reply ? '\n' + C.NHAN_PHAN_HOI + ':\n' + f.reply + '\n' : '') +
    '\n' + C.CHU_NUT + ': ' + C.LINK + '\n\n' + C.CHU_KY + '\n\n' + thayBien_(C.CHAN_TRANG, v);

  var F = "font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;";
  var html =
    '<!doctype html><html><body style="margin:0;padding:0;background:#F1F4F9;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F4F9;padding:28px 12px;"><tr><td align="center">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:14px;overflow:hidden;border:1px solid #E3E8F0;">' +
      // đầu mail
      '<tr><td style="background:' + C.MAU_CHU_DAO + ';padding:20px 28px;' + F + 'color:#FFFFFF;">' +
        '<div style="font-size:18px;font-weight:700;letter-spacing:.2px;">' + escHtml_(C.TEN_NGUOI_GUI) + '</div>' +
        '<div style="font-size:12.5px;opacity:.85;margin-top:2px;">Product Feedback</div>' +
      '</td></tr>' +
      // thân
      '<tr><td style="padding:26px 28px 8px;' + F + 'color:#1E2A45;font-size:14.5px;line-height:1.6;">' +
        '<p style="margin:0 0 12px;font-weight:600;">' + thayBien_(escHtml_(C.LOI_CHAO), vh) + '</p>' +
        '<p style="margin:0 0 18px;color:#475569;">' + thayBien_(escHtml_(C.DOAN_MO_DAU), vh) + '</p>' +
        // thẻ feedback
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E3E8F0;border-radius:10px;">' +
          '<tr><td style="padding:14px 16px;' + F + '">' +
            '<div style="font-size:12px;color:#94A3B8;text-transform:uppercase;letter-spacing:.5px;">Feedback</div>' +
            '<div style="font-size:15px;font-weight:600;color:#1E2A45;margin:4px 0 10px;">' + vh.tieu_de + '</div>' +
            '<span style="display:inline-block;background:' + mauTT + ';color:#FFFFFF;font-size:12px;font-weight:600;padding:3px 10px;border-radius:999px;">' + vh.trang_thai + '</span>' +
            (v.ngay_gui ? '<span style="font-size:12px;color:#94A3B8;margin-left:8px;">Gửi ngày ' + vh.ngay_gui + '</span>' : '') +
          '</td></tr>' +
        '</table>' +
        // phản hồi
        (f.reply
          ? '<div style="margin:18px 0 0;padding:14px 16px;background:#F5F7FF;border-left:4px solid ' + C.MAU_CHU_DAO + ';border-radius:6px;">' +
              '<div style="font-size:12px;font-weight:700;color:' + C.MAU_CHU_DAO + ';margin-bottom:6px;">' + escHtml_(C.NHAN_PHAN_HOI) + '</div>' +
              '<div style="color:#1E2A45;">' + escHtml_(f.reply).replace(/\n/g, '<br>') + '</div>' +
            '</div>'
          : '') +
        // nút
        '<div style="margin:24px 0 8px;">' +
          '<a href="' + escHtml_(C.LINK) + '" style="display:inline-block;background:' + C.MAU_CHU_DAO + ';color:#FFFFFF;text-decoration:none;font-weight:600;font-size:14px;padding:11px 22px;border-radius:8px;">' + escHtml_(C.CHU_NUT) + ' →</a>' +
        '</div>' +
        '<p style="margin:18px 0 0;color:#1E2A45;">' + escHtml_(C.CHU_KY) + '</p>' +
      '</td></tr>' +
      // chân trang
      '<tr><td style="padding:16px 28px 22px;' + F + 'font-size:12px;line-height:1.5;color:#94A3B8;border-top:1px solid #EEF1F6;">' +
        thayBien_(escHtml_(C.CHAN_TRANG), vh) +
      '</td></tr>' +
    '</table></td></tr></table></body></html>';

  return { subject: thayBien_(C.TIEU_DE_MAIL, v), body: body, html: html };
}

// Tạo trigger: dongBoDeals mỗi giờ + guiMailFeedback mỗi 5 phút (chạy lại không tạo trùng)
function caiDatTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var h = t.getHandlerFunction();
    if (h === 'dongBoDeals' || h === 'guiMailFeedback') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('dongBoDeals').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('guiMailFeedback').timeBased().everyMinutes(5).create();
  Logger.log('Đã cài trigger: đồng bộ deal mỗi giờ, gửi mail feedback mỗi 5 phút.');
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

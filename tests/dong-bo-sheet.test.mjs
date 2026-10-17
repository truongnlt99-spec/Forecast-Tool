// Đồng bộ Supabase từ tab "Extract of Raw" (supabase/apps-script/DongBoSupabase.gs, SYNC.NGUON = 'sheet').
// Chạy file .gs trên Node với SpreadsheetApp / UrlFetchApp / Utilities giả.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { read } from './helpers.mjs';

function load(values, opts = {}) {
  const calls = [];
  const ctx = {
    Logger: { log() {} },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'sb_secret_x' }) },
    Utilities: {
      // giả formatDate theo giờ VN (UTC+7)
      formatDate: (d) => new Date(d.getTime() + 7 * 3600e3).toISOString().slice(0, 10),
    },
    SpreadsheetApp: {
      openById: () => ({ getSheetByName: (n) => n === 'Extract of Raw' ? { getDataRange: () => ({ getValues: () => values }) } : null }),
    },
    UrlFetchApp: {
      fetch: (url, o) => {
        const p = JSON.parse(o.payload);
        calls.push(p);
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ upserted: p.p_rows.length, bo_qua_thieu_id: 0, deactivated: 0, cot_khong_khop: [] }) };
      },
    },
    BigQuery: { Jobs: { query: () => { throw new Error('không được gọi BigQuery ở chế độ sheet'); } } },
  };
  vm.createContext(ctx);
  vm.runInContext(read('supabase/apps-script/DongBoSupabase.gs'), ctx);
  if (opts.minRows != null) vm.runInContext('SYNC.MIN_ROWS = ' + opts.minRows, ctx);
  if (opts.batch) vm.runInContext('SYNC.BATCH_SIZE = ' + opts.batch, ctx);
  return { ctx, calls };
}

const HEAD = ['Deal_ID', 'CO_Owner', 'Ngay_tao_deal', 'Ngay_danh_gia_1_thang', 'Ty_le_su_dung_1_thang', 'CHS_CS_T1', 'Tier', 'O1'];

test('sheetToRows_: ngày dd/mm/yyyy và Date → yyyy-mm-dd, ô lỗi công thức → null, bỏ dòng trống', () => {
  const { ctx } = load([]);
  const rows = ctx.sheetToRows_([
    HEAD,
    [1180370, 'luanpham', new Date('2026-10-15T17:00:00Z'), '05/10/2026', 0.6279, '#NAME?', '#NAME?', ''],
    ['', '', '', '', '', '', '', ''],
    [1180369, 'luanpham', '16/10/2026', '1/2/2027', '', '#N/A', 'Tier 2 (Routine Check)', 100],
  ]);
  assert.equal(rows.length, 2);
  assert.deepEqual({ ...rows[0] }, { Deal_ID: '1180370', CO_Owner: 'luanpham', Ngay_tao_deal: '2026-10-16',
    Ngay_danh_gia_1_thang: '2026-10-05', Ty_le_su_dung_1_thang: '0.6279', CHS_CS_T1: null, Tier: null, O1: null });
  assert.equal(rows[1].Ngay_tao_deal, '2026-10-16');
  assert.equal(rows[1].Ngay_danh_gia_1_thang, '2027-02-01', 'ngày/tháng 1 chữ số');
  assert.equal(rows[1].CHS_CS_T1, null);
  assert.equal(rows[1].O1, '100');
});

test('dongBoDeals (nguồn sheet): gửi theo lô, KHÔNG lô nào p_final (không tắt deal vắng mặt), không gọi BigQuery', () => {
  const values = [HEAD];
  for (let i = 0; i < 7; i++) values.push([1000 + i, 'cs', '01/10/2026', '', '', '', '', '']);
  const { ctx, calls } = load(values, { minRows: 5, batch: 3 });
  ctx.dongBoDeals();
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map((c) => c.p_rows.length), [3, 3, 1]);
  assert.equal(calls.some((c) => c.p_final), false);
  assert.equal(new Set(calls.map((c) => c.p_run_at)).size, 1);
});

test('dongBoDeals (nguồn sheet): tab ít dòng bất thường → dừng, không gửi gì', () => {
  const { ctx, calls } = load([HEAD, [1, 'cs', '', '', '', '', '', '']]);
  assert.throws(() => ctx.dongBoDeals(), /chỉ có 1 deal hợp lệ/);
  assert.equal(calls.length, 0);
});

const H2 = ['Deal_ID', 'Job_ID', 'Deal_name', 'Deal_value', 'Bo_giai_phap', 'Loai_hop_dong', 'CO_Owner'];
const row = (id, o = {}) => [id, o.job ?? 1, o.name ?? 'Deal ' + id, o.val ?? 1000 + Number(String(id).replace(/\D/g, '')), 'HRM', 'New', o.cs ?? 'cs'];

test('locTrung_: chuẩn hoá Deal ID, lặp y hệt giữ 1, lặp khác nội dung bỏ cả deal, cảnh báo trùng cùng Job', () => {
  const { ctx } = load([]);
  const rows = ctx.sheetToRows_([H2,
    row(101), row(101),                         // lặp y hệt → giữ 1
    row(102, { cs: 'a' }), row(102, { cs: 'b' }), // khác CS → bỏ cả deal 102
    row('1,103'), row('104.0'), row('abc'),     // chuẩn hoá / không hợp lệ
    row(105, { job: 9, name: 'X', val: 5 }), row(106, { job: 9, name: 'X', val: 5 }), // khác ID, trùng Job
  ]);
  const r = ctx.locTrung_(rows);
  assert.deepEqual([...r.rows].map((x) => x.Deal_ID), ['101', '1103', '104', '105', '106']);
  assert.equal(r.trungGiong, 1);
  assert.deepEqual([...r.xungDot], ['102']);
  assert.equal(r.idSai, 1);
  assert.deepEqual([...r.nghiTrungJob], ['Job 9: 105, 106']);
});

test('dongBoDeals (nguồn sheet): gửi đúng 1 dòng mỗi deal; quá nhiều Deal ID xung đột → dừng, không gửi', () => {
  const ok = [H2];
  for (let i = 0; i < 6; i++) ok.push(row(2000 + i), row(2000 + i));   // mỗi deal lặp 2 lần y hệt
  let t = load(ok, { minRows: 5, batch: 4 });
  t.ctx.dongBoDeals();
  const ids = t.calls.flatMap((c) => c.p_rows.map((x) => x.Deal_ID));
  assert.equal(ids.length, 6);
  assert.equal(new Set(ids).size, 6);

  const bad = [H2];
  for (let i = 0; i < 10; i++) bad.push(row(3000 + i, { cs: 'a' }));
  bad.push(row(3000, { cs: 'b' }));              // 1/9 deal xung đột > 5%
  t = load(bad, { minRows: 5 });
  assert.throws(() => t.ctx.dongBoDeals(), /lặp với nội dung khác nhau/);
  assert.equal(t.calls.length, 0);
});

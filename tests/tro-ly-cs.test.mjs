// TRỢ LÝ CS (ui.js mục TRỢ LÝ CS): "Vì sao?" giải thích CR, giờ đồng bộ CRM, Lịch đánh giá + banner
// nhắc sắp khoá, Mô phỏng Career path. Phần thuần chạy trên Node; phần giao diện chạy Chromium với
// index.html thật + Edge Function api THẬT (Supabase giả trong bộ nhớ).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { ROOT, read, slice, mNorm, mCmp, loadEdgeFunction } from './helpers.mjs';

// ---------- phần thuần (đoạn ==CX PURE START== … ==CX PURE END== của ui.js) ----------
const PURE = slice(read('ui.js'), '/* ==CX PURE START==', '/* ==CX PURE END== */');
const cx = new Function(PURE + '\nreturn { cxCrState, cxCrSum, cxEvalEvents, cxMAdd };')();

function appCrIn() {
  const body = slice(read('app.js'), '  function crIn(', '  var RATING_LABEL');
  return new Function('mNorm', 'mCmp', 'contractCounted', body + '\nreturn crIn;')(mNorm, mCmp, () => true);
}

test('cxCrState — cùng kết quả với crIn() của app.js ở mọi tháng / mọi ngày go-live', () => {
  const crIn = appCrIn();
  const months = ['07/2026', '08/2026', '09/2026', '10/2026', '11/2026', '12/2026', '01/2027'];
  const gls = [null, '2026-08-20', '2026-09-30', '2026-10-05', '2026-12-01'];
  for (const gl of gls) {
    for (const m of months) {
      const want = crIn({ crMonth: '10/2026', contract: 'New' }, m, gl);
      const got = cx.cxCrState({ crMonth: '10/2026', contract: 'New', glActual: gl ? new Date(gl) : null }, m);
      const norm = want ? { den: !want.noDen, num: want.dat } : { den: false, num: false };
      assert.deepEqual({ den: got.den, num: got.num }, norm, `tháng ${m}, go-live ${gl}`);
    }
  }
});

test('cxCrState — mã lý do: sớm / đúng hạn / trễ / chưa go-live / loại HĐ / dừng / gia hạn', () => {
  const D = (o) => ({ crMonth: '10/2026', contract: 'Upsale', ...o });
  assert.equal(cx.cxCrState(D({ glActual: new Date(2026, 8, 30) }), '09/2026').code, 'early');
  assert.equal(cx.cxCrState(D({ glActual: new Date(2026, 8, 30) }), '10/2026').code, 'doneEarly');
  assert.equal(cx.cxCrState(D({ glActual: new Date(2026, 9, 5) }), '10/2026').code, 'onTime');
  assert.equal(cx.cxCrState(D({ glActual: new Date(2026, 11, 1) }), '11/2026').code, 'lateWaiting');
  assert.equal(cx.cxCrState(D({ glActual: new Date(2026, 11, 1) }), '12/2026').code, 'late');
  assert.equal(cx.cxCrState(D({}), '10/2026').code, 'dueNow');
  assert.equal(cx.cxCrState(D({}), '11/2026').code, 'overdue');
  assert.equal(cx.cxCrState(D({}), '09/2026').code, 'notYet');
  assert.equal(cx.cxCrState(D({ contract: 'Renew' }), '10/2026').code, 'contract');
  assert.equal(cx.cxCrState(D({ contract: 'Renew triển khai lại' }), '10/2026').code, 'dueNow');
  assert.equal(cx.cxCrState(D({ stopped: true }), '10/2026').code, 'stopped');
  assert.equal(cx.cxCrState(D({ crMonth: '' }), '10/2026').code, 'noMonth');
  // gia hạn: tháng hạn = tháng gia hạn (giống qCrCompute ở mục 11)
  const ext = D({ crMonth: '08/2026', glExtend: new Date(2026, 9, 20) });
  assert.equal(cx.cxCrState(ext, '09/2026').code, 'notYet');
  assert.equal(cx.cxCrState(ext, '10/2026').code, 'dueNow');
});

test('cxCrSum — giả sử go-live: deal trễ vào tử số, deal hạn sau trong quý chỉ cộng tử', () => {
  const deals = [
    { id: 'a', crMonth: '10/2026', contract: 'New', dtPhai: 10 },   // tới hạn tháng 10, chưa go-live
    { id: 'b', crMonth: '11/2026', contract: 'New', dtPhai: 5 },    // hạn tháng 11
    { id: 'c', crMonth: '10/2026', contract: 'New', dtPhai: 20, glActual: new Date(2026, 9, 3) },
  ];
  const months = ['10/2026'];
  assert.deepEqual(cx.cxCrSum(deals, months), { phai: 30, dat: 20 });
  const now = new Date(2026, 9, 17);
  assert.deepEqual(cx.cxCrSum(deals, months, { a: now }), { phai: 30, dat: 30 });
  assert.deepEqual(cx.cxCrSum(deals, months, { b: now }), { phai: 30, dat: 25 }, 'kéo sớm chỉ cộng tử số');
});

test('cxEvalEvents — ngày đánh giá, trạng thái khoá / sắp khoá, Năm 2++, Tier 4 chỉ cần %Output', () => {
  const today = new Date(2026, 9, 16);
  const Y = (o) => ({ 1: { T1: { a: '', o: '' }, T4: { a: '', o: '' } }, 2: { T1: { a: '', o: '', comMonth: '' }, T4: { a: '', o: '', comMonth: '' } }, ...o });
  const deals = [
    { id: '1', company: 'A', dg1: '18/10/2026', dg4: '18/01/2027', years: Y({}) },
    { id: '2', company: 'B', dg1: '10/10/2026', years: Y({ 1: { T1: { a: '80', o: '90' }, T4: {} } }) },
    { id: '3', company: 'C', dg1: '15/10/2026', years: Y({}) },
    { id: '4', company: 'D', dg1: '20/10/2025', tierNum: 4,
      years: Y({ 2: { T1: { a: '', o: '70', comMonth: '10/2026' }, T4: { a: '', o: '', comMonth: '' } } }) },
    { id: '5', company: 'E', dg1: '17/10/2026', stopped: true, years: Y({}) },
    { id: '6', company: 'F', dg1: '', years: Y({}) },
  ];
  const ev = cx.cxEvalEvents(deals, today);
  const pick = (id, n, ky) => ev.find((e) => e.id === id && e.year === n && e.ky === ky);
  assert.equal(pick('1', 1, 'T1').status, 'soon');
  assert.equal(pick('1', 1, 'T1').days, 2);
  assert.equal(pick('1', 1, 'T4').status, 'todo');
  assert.equal(pick('2', 1, 'T1').status, 'closed');
  assert.equal(pick('3', 1, 'T1').status, 'lockedMissing', 'ngày đánh giá < hôm nay → khoá');
  const y2 = pick('4', 2, 'T1');
  assert.equal(+y2.date, +new Date(2026, 9, 20), 'Năm 2 = Năm 1 + 1 năm');
  assert.equal(y2.status, 'ready', 'Tier 4 chỉ cần %Output');
  assert.equal(pick('4', 2, 'T4'), undefined, 'không có tháng nhận Com Năm 2 T4 → không có kỳ');
  assert.equal(ev.some((e) => e.id === '5' || e.id === '6'), false, 'deal dừng / chưa có ngày đánh giá → bỏ');
  assert.deepEqual(ev.map((e) => +e.date), ev.map((e) => +e.date).sort((a, b) => a - b), 'sắp theo ngày');
});

// ---------- Edge Function: GET trả syncedAt ----------
const EMAIL = 'cs@base.vn';
const SECRET = 'cx-secret-' + 'z'.repeat(30);
async function validToken() {
  const b64 = (u8) => Buffer.from(u8).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
  const payload = b64(new TextEncoder().encode(JSON.stringify({ email: EMAIL, exp: 4102444800000 })));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return 'CST1.' + payload + '.' + b64(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))));
}

test('api GET trả syncedAt; chưa chạy 07_gio_dong_bo.sql (hàm lỗi) thì syncedAt = null, vẫn trả deal', async () => {
  let synced = { data: '16/10/2026 08:05' };
  const fake = { rpc: async (fn) => fn === 'api_data_synced_at' ? synced
    : fn === 'api_get_deals_json' ? { data: [{ 'Deal ID': '1' }] } : { data: null } };
  const api = await loadEdgeFunction('api', fake, { SESSION_SECRET: SECRET });
  const get = async () => (await api(new Request('https://p.supabase.co/functions/v1/api?token=' + encodeURIComponent(await validToken())))).json();
  let r = await get();
  assert.equal(r.ok, true);
  assert.equal(r.syncedAt, '16/10/2026 08:05');
  synced = { data: null, error: { message: 'function api_data_synced_at() does not exist' } };
  r = await get();
  assert.equal(r.ok, true);
  assert.equal(r.syncedAt, null);
  assert.equal(r.deals.length, 1);
});

test('SQL 07_gio_dong_bo: không DELETE/DROP, hàm chỉ cho service_role', () => {
  const sql = read('supabase/07_gio_dong_bo.sql');
  assert.doesNotMatch(sql.replace(/--.*$/gm, ''), /\b(delete|drop)\b/i);
  assert.match(sql, /grant execute on function %s to service_role/);
});

// ---------- giao diện trên Chromium ----------
let chromium = null;
try {
  const require = createRequire(import.meta.url);
  try { ({ chromium } = require('playwright')); }
  catch { ({ chromium } = require(path.join(execSync('npm root -g').toString().trim(), 'playwright'))); }
} catch { /* không có playwright */ }

// Ngày theo giờ VN (giống trang)
const vn = new Date(Date.now() + 7 * 3600e3);
const today = new Date(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate());
const dd = (n) => { const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + n);
  return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear(); };
const mon = (n) => { const d = new Date(today.getFullYear(), today.getMonth() + n, 1); return String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear(); };
const CUR = mon(0), PREV = mon(-1), NEXT = mon(1);
const firstOfCur = '01/' + CUR, lastPrev = (() => { const d = new Date(today.getFullYear(), today.getMonth(), 0); return String(d.getDate()).padStart(2, '0') + '/' + PREV; })();
const QUARTER = 'Q' + Math.ceil((today.getMonth() + 1) / 3) + '/' + today.getFullYear();
// tháng sau còn trong quý không (để kiểm deal "kéo sớm" trong mô phỏng)
const nextInQuarter = today.getMonth() % 3 !== 2;

const base = (id, co, o = {}) => ({ 'Deal ID': id, 'System ID': '', 'Tên khách hàng': co, 'Tên công ty ': co, 'Loại hợp đồng': 'New',
  'Bộ giải pháp': 'HRM', 'Giá trị phần mềm bộ (VNĐ)': '10.000.000', 'Ngày nhận deal': '01/' + PREV, 'TTGL (ngày)': '30',
  'Ngày go-live dự kiến': '', 'Ngày go-live thực tế': '', 'Ngày go-live gia hạn ': '', 'Dừng triển khai ': '',
  'Tháng ghi nhận CR': '', 'DT phải go-live': '0', 'Tier': 'Tier 2', 'Tháng đo T1': '', 'Tháng đo T4': '',
  '% Active T1': '', '% Output T1': '', '% Active T4': '', '% Output T4': '', 'Ngày đánh giá T1': '', 'Ngày đánh giá T4': '', ...o });
const DEALS = [
  // CR tháng này: mẫu = 301 (10tr) + 302 (20tr) = 30tr; tử = 302 (20tr) + 303 (5tr, go-live sớm) = 25tr
  base('301', 'Tới hạn chưa GL', { 'Tháng ghi nhận CR': CUR, 'DT phải go-live': '10.000.000' }),
  base('302', 'Trễ đã GL', { 'Tháng ghi nhận CR': PREV, 'Ngày go-live thực tế': firstOfCur, 'DT phải go-live': '20.000.000' }),
  base('303', 'GL sớm', { 'Tháng ghi nhận CR': NEXT, 'Ngày go-live thực tế': firstOfCur, 'DT phải go-live': '5.000.000' }),
  base('304', 'Renew thuần', { 'Loại hợp đồng': 'Renew', 'Tháng ghi nhận CR': CUR, 'DT phải go-live': '99.000.000' }),
  // Lịch đánh giá
  base('401', 'Sắp khoá T1', { 'Ngày go-live thực tế': lastPrev, 'Ngày đánh giá T1': dd(3), 'Ngày đánh giá T4': dd(95) }),
  base('402', 'Đã chốt T1', { 'Ngày go-live thực tế': lastPrev, 'Ngày đánh giá T1': dd(-5), '% Active T1': '80', '% Output T1': '75' }),
  base('403', 'Năm 2 sắp khoá', { 'Ngày đánh giá T1': (() => { const s = dd(5).split('/'); return s[0] + '/' + s[1] + '/' + (+s[2] - 1); })(),
    'Tháng nhận Com T1 - Năm 2': CUR, '% Active T1': '50', '% Output T1': '50', '% Active T1 - Năm 2': '', '% Output T1 - Năm 2': '' }),
  // Mô phỏng: deal hạn tháng sau trong quý (kéo sớm)
  ...(nextInQuarter ? [base('501', 'Hạn tháng sau', { 'Tháng ghi nhận CR': NEXT, 'DT phải go-live': '7.000.000' })] : []),
];

let commits = [];
const fake = {
  rpc: async (fn) => {
    switch (fn) {
      case 'api_get_profile': return { data: { username: 'cs', email: EMAIL, hoTen: 'Chị CS', level: 'CS level 3', salary: '13000000', avatar: '' } };
      case 'api_get_deals_json': return { data: DEALS };
      case 'api_is_admin': return { data: false };
      case 'api_data_synced_at': return { data: dd(0) + ' 08:05' };
      case 'api_career_list': return { data: { commits, levelHistory: [] } };
      default: return { data: null };
    }
  },
};

async function withPage(hash, fn) {
  const api = await loadEdgeFunction('api', fake, { SESSION_SECRET: SECRET });
  const token = await validToken();
  const srv = http.createServer((q, r) => {
    const rel = decodeURIComponent(q.url.split('?')[0]);
    const p = path.join(ROOT, rel === '/' ? '/index.html' : rel);
    if (!p.startsWith(ROOT)) { r.writeHead(403); r.end(); return; }
    fs.readFile(p, (e, d) => {
      if (e) { r.writeHead(404); r.end(); return; }
      r.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : p.endsWith('.css') ? 'text/css' : 'text/html' }); r.end(d);
    });
  }).listen(0);
  let browser;
  try { browser = await chromium.launch(); }
  catch { browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }); }
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, locale: 'en-US' });
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('dialog', (d) => { errors.push('dialog: ' + d.message()); d.dismiss(); });
    await page.route(/supabase\.co|accounts\.google|script\.google/, async (route) => {
      const req = route.request();
      if (req.url().includes('accounts.google')) {
        return route.fulfill({ contentType: 'text/javascript',
          body: 'window.google={accounts:{id:{initialize(){},renderButton(){},prompt(){},disableAutoSelect(){},cancel(){}}}};' });
      }
      const url = new URL(req.url());
      if (req.method() === 'GET') {
        if (!url.searchParams.get('token')) return route.fulfill({ json: { ok: false, error: 'invalid_token' } });
        url.searchParams.set('token', token);
        const res = await api(new Request(url.toString()));
        return route.fulfill({ json: await res.json() });
      }
      const b = JSON.parse(req.postData() || '{}');
      if (!/^career/.test(b.action || '')) return route.fulfill({ json: { ok: true, sessionToken: 'CST1.x.y', items: [] } });
      const res = await api(new Request('https://p.supabase.co/functions/v1/api', {
        method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ ...b, token }),
      }));
      return route.fulfill({ json: await res.json() });
    });
    await page.addInitScript(() => localStorage.setItem('cs_tool_token', 'CST1.x.y'));
    await page.goto(`http://localhost:${srv.address().port}/${hash}`);
    await fn(page);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    srv.close();
  }
}

const skip = !chromium && 'chưa cài playwright';

test('UI: giờ đồng bộ CRM + nút "Vì sao?" giải thích CR từng deal và thẻ Tử / Mẫu số', { skip }, async () => {
  await withPage('#/forecast', async (page) => {
    await page.waitForSelector('.fc-chip[data-fck="all"]');
    await page.waitForFunction(() => !document.getElementById('dataFresh').hidden);
    assert.match(await page.textContent('#dataFresh'), /CRM cập nhật 08:05/);

    await page.click('.fc-chip[data-fck="all"]');
    await page.waitForSelector('#fc-row-303 .cx-why');
    await page.click('#fc-row-303 .cx-why');
    await page.waitForSelector('#cxModal.open');
    const body = await page.textContent('#cxModalBody');
    assert.match(body, /Chỉ tử số/);
    assert.match(body, /sớm hơn tháng hạn/);
    await page.click('#cxModalClose');

    // Bóc tách thẻ CR: cùng số với thẻ app.js tính
    await page.click('.cx-why-cr');
    await page.waitForSelector('#cxModal.open');
    const sum = await page.textContent('#cxModalBody .cx-sum');
    assert.match(sum, /Tử số25\.000\.000 đ/);
    assert.match(sum, /Mẫu số30\.000\.000 đ/);
    assert.equal(await page.textContent('#fcCrNum'), '25.000.000 đ');
    assert.equal(await page.textContent('#fcCrDen'), '30.000.000 đ');
    const grp = await page.textContent('#cxModalBody');
    assert.match(grp, /Renew thuần/);      // nhóm "không tính" có lý do
    assert.match(grp, /không thuộc nhóm tính CR/);

    // "Gửi feedback" điền sẵn deal + lý do vào form Product Feedback
    await page.click('#cxModalBody [data-cx-why="301"]');
    await page.click('#cxReport');
    await page.waitForSelector('#pfModal.open #pfTitle');
    assert.match(await page.inputValue('#pfTitle'), /CR deal 301/);
    assert.match(await page.inputValue('#pfDesc'), /mẫu số/);
  });
});

test('UI: Lịch đánh giá — banner nhắc sắp khoá, bộ lọc, nút Nhập lọc đúng deal', { skip }, async () => {
  await withPage('#/overview', async (page) => {
    await page.waitForSelector('#panel-overview .cx-remind');
    const txt = await page.textContent('#panel-overview .cx-remind');
    assert.match(txt, /2 kỳ đánh giá sắp khoá/);
    assert.equal(await page.textContent('.nav-sub .cx-cal-count'), '2');

    await page.click('#panel-overview .cx-remind-go');
    await page.waitForSelector('#cxCalBlock .cx-cal-table');
    assert.equal(await page.isVisible('#fcYear1Block'), false);
    await page.waitForTimeout(100);
    assert.equal(await page.isVisible('.fc-kpis-10'), false, 'ẩn dải KPI khi xem lịch');
    const rows = await page.$$eval('#cxCalBlock .cx-cal-row', (rs) => rs.map((r) => r.textContent));
    assert.equal(rows.length, 2);
    assert.match(rows[0], /Sắp khoá T1.*Năm 1 · T1.*còn 3 ngày/);
    assert.match(rows[1], /Năm 2 sắp khoá.*Năm 2 · T1.*còn 5 ngày/);

    await page.click('#cxCalBlock [data-cxf="all"]');
    const all = await page.textContent('#cxCalBlock');
    assert.match(all, /Đã chốt T1/);
    assert.match(all, /Đã chốt/);

    // Nhập → về Năm 1, ô tìm kiếm lọc đúng Deal ID
    await page.click('#cxCalBlock [data-cxf="soon"]');
    await page.click('#cxCalBlock .cx-go[data-id="401"]');
    await page.waitForFunction(() => document.getElementById('fcSearch').value === '401');
    assert.equal(await page.isVisible('#cxCalBlock'), false);
    await page.waitForSelector('#fc-row-401');
    assert.equal(await page.$$eval('#fcTbody tr[id^="fc-row-"]', (r) => r.length), 1);

    // Ẩn banner tới mai
    await page.click('.tab[data-tab="overview"]');
    await page.click('#panel-overview .cx-remind-x');
    assert.equal(await page.$('#panel-overview .cx-remind'), null);
  });
});

test('UI: Mô phỏng Career path — tick deal → CR quý mới so với commit, nút Chọn gợi ý', { skip }, async () => {
  commits = [{ quarter: QUARTER, status: 'open', baseLevel: 'CS level 3', targetLevel: 'CS level 3', cr: 95, s1: 80, s4: 80, history: [], achievedAt: '' }];
  try {
    await withPage('#/overview', async (page) => {
      await page.waitForSelector('#panel-overview .tab-panel-body');
      await page.evaluate(() => { location.hash = '#/overview/career-path'; });
      await page.waitForSelector('#cxSim');
      const top = () => page.textContent('#cxSim .cx-sim-top');
      // Thực tế quý (máy chủ): tháng này tử 25 / mẫu 30; nếu tháng trước cùng quý thì deal 302 (trễ) thêm 20 vào mẫu
      const prevInQ = today.getMonth() % 3 !== 0, phai = 30 + (prevInQ ? 20 : 0);
      const p = (dat) => (Math.round(dat / phai * 10000) / 100).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + '%';
      assert.equal(await page.textContent('#cxSim .cx-sim-top > div:first-child b'), p(25));
      await page.check('#cxSim [data-sim="301"]');   // deal tới hạn 10tr go-live → tử +10
      assert.match(await top(), new RegExp('Nếu go-live 1 deal đã chọn' + p(35).replace('.', '\\.')));
      await page.click('#cxSimClear');
      assert.match(await top(), new RegExp('Nếu go-live 0 deal đã chọn' + p(25).replace('.', '\\.')));
      assert.match(await top(), /Commit CR95%/);
      await page.click('#cxSimAuto');
      assert.equal(await page.isChecked('#cxSim [data-sim="301"]'), true);
      if (nextInQuarter) assert.match(await page.textContent('#cxSim'), /Hạn tháng sau/);
    });
  } finally { commits = []; }
});

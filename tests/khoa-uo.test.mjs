// Khoá ô %Active/%Output theo NGÀY ĐÁNH GIÁ (cột "Khoá U/O" / "Khoá Năm 2++" do máy chủ tính),
// không còn khoá chỉ vì CRM/BigQuery đã có số. Chromium + backend giả.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { ROOT } from './helpers.mjs';

let chromium = null;
try {
  const require = createRequire(import.meta.url);
  try { ({ chromium } = require('playwright')); }
  catch { ({ chromium } = require(path.join(execSync('npm root -g').toString().trim(), 'playwright'))); }
} catch { /* không có playwright */ }



const now = new Date();
const mk = (n) => { const d = new Date(now.getFullYear(), now.getMonth() + n, 1); return String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear(); };
const cur = mk(0);
const base = (id, co, o) => ({ 'Deal ID': id, 'System ID': '', 'Tên khách hàng': co, 'Tên công ty': co, 'Loại hợp đồng': 'New',
  'Bộ giải pháp': 'HRM', 'Giá trị phần mềm bộ (VNĐ)': '10.000.000', 'Ngày nhận deal': '01/01/2025', 'Go-live dự kiến': '01/' + cur,
  'Go-live thực tế': '05/09/2025', 'Tháng ghi nhận CR': cur, 'Tháng đo T1': cur, 'Tháng đo T4': mk(3), 'Tier': 'Tier 2',
  '% Active T1': '', '% Output T1': '', '% Active T4': '', '% Output T4': '', 'DT phải go-live': '10.000.000', 'ACR (VNĐ)': '5.000.000',
  'Nguồn go-live': 'Đã kéo', 'U/O từ BigQuery': '', 'Thiếu U/O BigQuery': '', 'Khoá U/O': '', 'Khoá Năm 2++': '',
  'Ngày đánh giá T1': '', 'Ngày đánh giá T4': '', 'Số năm nhận com': '3',
  'Tháng nhận Com T1 - Năm 2': cur, 'Tháng nhận Com T4 - Năm 2': cur, ...o });
const DEALS = [
  // Qua ngày đánh giá T1 → khoá T1; T4 chưa tới, CRM đã có số %Active T4 → vẫn sửa được (nhãn CRM)
  base('201', 'Đã qua ĐG T1', { '% Active T1': '40', 'Khoá U/O': 'aT1,oT1', 'U/O từ BigQuery': 'aT1,aT4', '% Active T4': '55',
    'Ngày đánh giá T1': '10/10/2026', 'Ngày đánh giá T4': '10/01/2027', 'Khoá Năm 2++': '2|T1' }),
  // Chưa tới ngày đánh giá nào → mở hết dù CRM có số (trước đây bị khoá)
  base('202', 'Chưa tới ĐG', { 'U/O từ BigQuery': 'aT1,oT1', '% Active T1': '30', '% Output T1': '60',
    'Ngày đánh giá T1': '20/12/2026', 'Ngày đánh giá T4': '20/03/2027' }),
];

test('Khoá U/O theo ngày đánh giá: Năm 1 + Năm 2++', { skip: !chromium && 'chưa cài playwright' }, async () => {
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
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('dialog', (d) => { errors.push('dialog: ' + d.message()); d.dismiss(); });
    await page.route(/supabase\.co|accounts\.google|script\.google/, async (route) => {
      const req = route.request();
      if (req.url().includes('accounts.google')) {
        return route.fulfill({ contentType: 'text/javascript',
          body: 'window.google={accounts:{id:{initialize(){},renderButton(){},prompt(){},disableAutoSelect(){},cancel(){}}}};' });
      }
      if (req.method() === 'GET') {
        return route.fulfill({ json: { ok: true, email: 'cs@base.vn', sessionToken: 'CST1.x.y', isAdmin: false, deals: DEALS,
          profile: { username: 'cs', email: 'cs@base.vn', hoTen: 'CS', level: 'CS level 3', salary: '', avatar: '' } } });
      }
      return route.fulfill({ json: { ok: true, sessionToken: 'CST1.x.y', items: [] } });
    });
    await page.addInitScript(() => localStorage.setItem('cs_tool_token', 'CST1.x.y'));
    await page.goto(`http://localhost:${srv.address().port}/#/forecast`);
    await page.waitForSelector('#fc-row-201');
    await page.click('.fc-chip[data-fck="all"]');
    const st = (id, f) => page.$eval(`#fc-row-${id} [data-f="${f}"]`, (el) => ({ dis: el.disabled, title: el.title,
      crm: !!(el.parentElement.querySelector('.fc-uo-bq-badge')) }));
    await page.waitForFunction(() => document.querySelector('#fc-row-201 [data-f="aT1"]').disabled);

    let s = await st(201, 'aT1');
    assert.equal(s.dis, true);
    assert.match(s.title, /Đã qua ngày đánh giá T1 \(10\/10\/2026\)/);
    assert.equal((await st(201, 'oT1')).dis, true);
    s = await st(201, 'aT4');
    assert.equal(s.dis, false, 'T4 chưa tới ngày đánh giá → sửa được dù CRM có số');
    assert.equal(s.crm, true, 'vẫn gắn nhãn CRM');
    assert.match(s.title, /tới hết ngày đánh giá 10\/01\/2027/);
    for (const f of ['aT1', 'oT1', 'aT4', 'oT4']) assert.equal((await st(202, f)).dis, false, '202 ' + f);
    assert.equal((await st(202, 'aT1')).crm, true);

    // Năm 2++: kỳ T1 Năm 2 của deal 201 khoá, T4 Năm 2 mở; deal 202 mở hết
    await page.evaluate(() => { location.hash = '#/forecast/multi-year'; });
    const dis = (rid) => page.evaluate((id) => [...document.getElementById(id).querySelectorAll('.mc-in')].map((e) => e.disabled), rid);
    await page.waitForFunction(() => { const r = document.getElementById('mc-row-201|2|T1'); return r && r.querySelector('.mc-in').disabled; });
    assert.deepEqual(await dis('mc-row-201|2|T1'), [true, true]);
    assert.deepEqual(await dis('mc-row-201|2|T4'), [false, false]);
    assert.deepEqual(await dis('mc-row-202|2|T1'), [false, false]);

    // Năm 2++: sửa 1 ô → nút Lưu đếm 1
    const inp = page.locator('#mcTbody tr').filter({ hasText: 'Chưa tới ĐG' }).filter({ hasText: 'T1 · Năm 2' }).locator('.mc-in[data-field="a"]');
    await inp.fill('70');
    await inp.press('Tab');
    await page.waitForFunction(() => document.querySelector('#mcSaveBtn .fc-save-n').textContent === '1');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    srv.close();
  }
});

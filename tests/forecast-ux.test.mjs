// Tối ưu màn Forecast (ui.js mục FORECAST UX): ô cần nhập, ngày dd/mm/yyyy, nút Lưu đếm ô chưa lưu,
// thẻ KPI gộp ACR, chip bỏ lọc CHS. Chromium + backend giả.
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
const cur = mk(0), prev = mk(-1);
const deal = (id, o) => ({ 'Deal ID': id, 'System ID': '', 'Tên khách hàng': o.co, 'Tên công ty': o.co, 'Loại hợp đồng': 'New',
  'Bộ giải pháp': 'HRM', 'Giá trị phần mềm bộ (VNĐ)': '10.000.000', 'Ngày nhận': '01/' + cur, 'Go-live dự kiến': '28/' + cur,
  'Go-live thực tế': o.gl || '', 'Tháng ghi nhận CR': cur, 'Tháng đo T1': o.t1 || '', 'Tháng đo T4': o.t4 || '', 'Tier': 'Tier ' + (o.tier || 2),
  '% Active T1': o.a1 || '', '% Output T1': '', '% Active T4': '', '% Output T4': '', 'DT phải go-live': '10.000.000', 'ACR (VNĐ)': '5.000.000' });
const DEALS = [
  deal('101', { co: 'Cần nhập T1', gl: '05/' + prev, t1: cur }),
  deal('102', { co: 'Thiếu kỳ trước', gl: '05/' + prev, t1: prev, a1: '70' }),
  deal('103', { co: 'Tier 4 kỳ T4', gl: '05/' + prev, t4: cur, tier: 4 }),
  deal('104', { co: 'Chưa go-live' }),
];

test('Forecast UX: ô cần nhập, ngày dd/mm/yyyy, đếm ô chưa lưu, KPI gộp ACR, chip bỏ lọc CHS', { skip: !chromium && 'chưa cài playwright' }, async () => {
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
  const errors = [], saved = [];
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
      if (req.method() === 'GET') {
        return route.fulfill({ json: { ok: true, email: 'cs@base.vn', sessionToken: 'CST1.x.y', isAdmin: false, deals: DEALS,
          profile: { username: 'cs', email: 'cs@base.vn', hoTen: 'CS', level: 'CS level 3', salary: '', avatar: '' } } });
      }
      const b = JSON.parse(req.postData() || '{}');
      if (b.rows) saved.push(...b.rows);
      return route.fulfill({ json: { ok: true, sessionToken: 'CST1.x.y', items: [], updated: (b.rows || []).length } });
    });
    await page.addInitScript(() => localStorage.setItem('cs_tool_token', 'CST1.x.y'));
    await page.goto(`http://localhost:${srv.address().port}/#/forecast`);
    await page.waitForSelector('#fc-row-101');
    await page.click('.fc-chip[data-fck="all"]');
    await page.waitForSelector('#fc-row-104 .fc-date-proxy');

    // 1. Ô cần nhập: kỳ đo tháng này trống → vàng; kỳ đã qua trống → đỏ; Tier 4 chỉ cần %Output
    const cls = (id, f) => page.getAttribute(`#fc-row-${id} .fc-in[data-f="${f}"]`, 'class');
    await page.waitForFunction(() => document.querySelector('#fc-row-101 [data-f="aT1"]').classList.contains('fc-need'));
    assert.match(await cls(101, 'oT1'), /fc-need\b/);
    assert.doesNotMatch(await cls(101, 'aT4'), /fc-need/);
    assert.doesNotMatch(await cls(102, 'aT1'), /fc-need/, 'đã có số thì thôi');
    assert.match(await cls(102, 'oT1'), /fc-need-past/);
    assert.doesNotMatch(await cls(103, 'aT4'), /fc-need/, 'Tier 4 không cần %Active');
    assert.match(await cls(103, 'oT4'), /fc-need\b/);
    assert.equal(await page.getAttribute('#fc-row-101 [data-f="aT1"]', 'placeholder'), '%');
    await page.fill('#fc-row-101 [data-f="aT1"]', '80');
    await page.waitForFunction(() => !document.querySelector('#fc-row-101 [data-f="aT1"]').classList.contains('fc-need'));

    // 4. Ngày dd/mm/yyyy cố định (máy en-US): hiển thị đúng, nhập sai bị chặn, nhập đúng ghi về ô gốc
    assert.equal(await page.inputValue('#fc-row-101 .fc-date-proxy'), '05/' + prev);
    await page.fill('#fc-row-104 .fc-date-proxy', '31/02/2026');
    await page.press('#fc-row-104 .fc-date-proxy', 'Tab');
    assert.match(await page.getAttribute('#fc-row-104 .fc-date-proxy', 'class'), /fc-bad/);
    assert.equal(await page.inputValue('#fc-row-104 .fc-date-orig'), '');
    const [mm, yy] = cur.split('/');
    await page.fill('#fc-row-104 .fc-date-proxy', '3/' + mm + '/' + yy);
    await page.press('#fc-row-104 .fc-date-proxy', 'Tab');
    assert.equal(await page.inputValue('#fc-row-104 .fc-date-orig'), `${yy}-${mm}-03`);
    assert.equal(await page.inputValue('#fc-row-104 .fc-date-proxy'), `03/${mm}/${yy}`);

    // 2. Nút Lưu đếm ô chưa lưu (aT1 deal 101 đã nhập ở trên + ngày go-live deal 104) + hỏi trước khi rời trang
    await page.waitForFunction(() => document.querySelector('#fcSaveBtn .fc-save-n').textContent === '2');
    assert.equal(await page.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; }), true);
    await page.click('#fcSaveBtn');
    await page.waitForFunction(() => /đã lưu/.test(document.getElementById('fcFlag').textContent));
    assert.equal(await page.isVisible('#fcSaveBtn .fc-save-n'), false);
    assert.equal(await page.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; }), false);
    assert.equal(saved.find((r) => r.dealId === '104').goLive, `03/${mm}/${yy}`, 'ngày gửi lên máy chủ đúng dd/mm/yyyy');
    assert.equal(saved.find((r) => r.dealId === '101').aT1, 80);

    // 5. KPI: 4 thẻ ACR ẩn, ACR thành dòng phụ của thẻ CHS
    assert.equal(await page.isVisible('#fcT1OkAcr'), false);
    assert.equal(await page.locator('.fc-acr-line').count(), 4);
    assert.match(await page.textContent('.fc-acr-line'), /^ACR /);

    // 6. Droplist CHS ẩn; bấm ⤵ trên thẻ CHS → chip bỏ lọc; bấm chip → hết lọc
    assert.equal(await page.isVisible('#fcChsFilter'), false);
    await page.click('#fcT1LowDetail');
    await page.waitForSelector('.fc-chs-pill:not([hidden])');
    assert.match(await page.textContent('.fc-chs-pill'), /CHS_T1 < 50/);
    await page.click('.fc-chs-pill');
    await page.waitForSelector('.fc-chs-pill[hidden]', { state: 'attached' });
    assert.equal(await page.inputValue('#fcChsFilter'), '');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    srv.close();
  }
});

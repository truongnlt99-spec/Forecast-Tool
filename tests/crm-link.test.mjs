// Nút / link mở deal trên Base CRM (https://basevn.base.vn/sales/deal/<Deal ID>) ở Overview + Forecast,
// và tiêu đề trang đúng tab khi F5 thẳng vào #/forecast. Chromium + backend giả.
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

const now = new Date(), mm = String(now.getMonth() + 1).padStart(2, '0') + '/' + now.getFullYear();
const deal = (id, co) => ({ 'Deal ID': id, 'System ID': 'S1', 'Tên khách hàng': co, 'Tên công ty': co, 'Loại hợp đồng': 'New',
  'Bộ giải pháp': 'HRM', 'Giá trị phần mềm bộ (VNĐ)': '10.000.000', 'Ngày nhận': '01/' + mm, 'Go-live dự kiến': '01/' + mm,
  'Go-live thực tế': '', 'Tháng ghi nhận CR': mm, 'Tháng đo T1': mm, 'DT phải go-live': '10.000.000' });
const DEALS = [deal('1064640', 'Công ty An Phát'), deal('abc"><img src=x onerror=alert(1)>', 'Công ty ID lạ')];

test('Link + nút mở deal trên Base CRM; F5 ở #/forecast hiện đúng tiêu đề', { skip: !chromium && 'chưa cài playwright' }, async () => {
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

    // F5 thẳng vào Forecast: tiêu đề + ô tìm kiếm phải là của Forecast (trước đây kẹt "Overview")
    await page.waitForSelector('#fc-row-1064640 .fc-crm-btn', { timeout: 15000 });
    await page.waitForFunction(() => document.getElementById('pageTitle').textContent === 'Forecast');
    assert.equal(await page.isVisible('#fcSearch'), true);
    assert.equal(await page.isVisible('#ovSearch'), false);

    const URL1 = 'https://basevn.base.vn/sales/deal/1064640';
    const btn = page.locator('#fc-row-1064640 .fc-crm-btn');
    assert.equal(await btn.getAttribute('href'), URL1);
    assert.equal(await btn.getAttribute('target'), '_blank');
    assert.match(await btn.getAttribute('rel'), /noopener/);
    await page.waitForSelector('#fc-row-1064640 .deal-id .crm-link');
    assert.equal(await page.getAttribute('#fc-row-1064640 .deal-id .crm-link', 'href'), URL1);
    assert.match(await page.textContent('#fc-row-1064640 .deal-id'), /Sys S1 · Deal 1064640/);

    // Deal ID không phải số → không tạo link (không ghép chuỗi lạ vào URL)
    const odd = await page.$$eval('#fcTbody tr', (trs) => trs.filter((t) => /ID lạ/.test(t.textContent))
      .map((t) => t.querySelectorAll('.fc-crm-btn, .crm-link').length));
    assert.deepEqual(odd, [0]);

    // Overview: link ở dòng phụ + ô Deal ID trong chi tiết; bấm link không bật/tắt dòng chi tiết
    await page.evaluate(() => { location.hash = '#/overview'; });
    await page.waitForFunction(() => document.getElementById('pageTitle').textContent === 'Overview');
    await page.waitForSelector('tr.deal-row[data-id="1064640"] .crm-link');
    assert.equal(await page.getAttribute('tr.deal-row[data-id="1064640"] .crm-link', 'href'), URL1);
    const [popup] = await Promise.all([
      page.context().waitForEvent('page'),
      page.click('tr.deal-row[data-id="1064640"] .crm-link'),
    ]);
    assert.ok(popup, 'mở tab mới');   // tab mới tự đi tới basevn.base.vn (mạng test bị chặn nên không kiểm URL đích)
    await popup.close().catch(() => {});
    assert.equal(await page.locator('tr.detail-row').count(), 0, 'bấm link không mở dòng chi tiết');
    await page.click('tr.deal-row[data-id="1064640"] .deal-name');
    await page.waitForSelector('tr.detail-row .crm-link');
    assert.equal(await page.getAttribute('tr.detail-row .crm-link', 'href'), URL1);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    srv.close();
  }
});

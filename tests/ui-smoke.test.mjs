// Mở index.html thật trên Chromium ngầm với backend giả: không lỗi JS, modal Kết nối Claude
// và Quản trị chạy đủ luồng, nội dung người dùng được escape (chống XSS).
// Cần Playwright (có sẵn global trong môi trường Claude Code); thiếu thì test tự bỏ qua.
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

test('UI smoke: tải trang + modal Kết nối Claude + Quản trị', { skip: !chromium && 'chưa cài playwright' }, async () => {
  const srv = http.createServer((q, r) => {
    const rel = decodeURIComponent(q.url.split('?')[0]);
    const p = path.join(ROOT, rel === '/' ? '/index.html' : rel);
    if (!p.startsWith(ROOT)) { r.writeHead(403); r.end(); return; }
    fs.readFile(p, (e, d) => {
      if (e) { r.writeHead(404); r.end(); return; }
      const type = p.endsWith('.js') ? 'text/javascript' : p.endsWith('.css') ? 'text/css' : 'text/html';
      r.writeHead(200, { 'Content-Type': type }); r.end(d);
    });
  }).listen(0);
  const port = srv.address().port;
  const state = {
    todo: [{ id: 1, stt: 1, noiDung: 'Việc <b>1</b>', note: '', dauMoi: '', done: false, updatedAt: '', feedbackId: 'PF1', nguon: 'claude', prUrl: '' }],
    keys: [], phuoc: 5, phuocCalls: [],
    fb: [{ id: 'PF1', senderEmail: 'a@base.vn', senderName: 'An', title: 'Lỗi <img src=x onerror=alert(1)>',
      category: 'Lỗi', description: '', attachments: [], status: 'Received', response: '', aiStatus: 'da_tao_todo', aiNote: 'đã kiểm tra', aiTodoId: 1 }],
  };
  const errors = [];
  let browser;
  try {
    browser = await chromium.launch(fs.existsSync('/opt/pw-browsers/chromium') ? {} : {});
  } catch {
    const exe = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((x) => fs.existsSync(x));
    browser = await chromium.launch(exe ? { executablePath: exe } : {});
  }
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('dialog', (d) => { errors.push('dialog: ' + d.message()); d.dismiss(); });
    await page.route(/supabase\.co|accounts\.google|script\.google/, async (route) => {
      const req = route.request();
      if (req.url().includes('accounts.google')) {
        return route.fulfill({ contentType: 'text/javascript',
          body: 'window.google={accounts:{id:{initialize(){},renderButton(){},prompt(){},disableAutoSelect(){},cancel(){}}}};' });
      }
      if (req.method() === 'GET') {
        return route.fulfill({ json: { ok: true, email: 'admin@base.vn', sessionToken: 'CST1.x.y', isAdmin: true, deals: [],
          profile: { username: 'admin', email: 'admin@base.vn', hoTen: 'Admin', level: 'CS level 3', salary: '', avatar: '' } } });
      }
      const b = JSON.parse(req.postData() || '{}');
      const ok = (o) => route.fulfill({ json: { ok: true, sessionToken: 'CST1.x.y', ...o } });
      switch (b.action) {
        case 'whoami': return ok({ isAdmin: true });
        case 'phuocGet': return ok({ mine: state.phuoc, total: state.phuoc + 100 });
        case 'phuocAdd': state.phuocCalls.push(b.n); state.phuoc += b.n; return ok({ mine: state.phuoc, total: state.phuoc + 100 });
        case 'mcpCreateKey': state.keys.push({ id: 'k1', label: b.label, createdAt: 'now', lastUsedAt: '' });
          return ok({ url: 'https://p.supabase.co/functions/v1/mcp/csk_abc' });
        case 'mcpListKeys': return ok({ items: state.keys });
        case 'mcpRevokeKey': state.keys = []; return ok({});
        case 'adminListFeedback': return ok({ items: state.fb });
        case 'adminUpdateFeedback': Object.assign(state.fb[0], { status: b.status, response: b.reply }); return ok({ item: {} });
        case 'adminListTodo': return ok({ items: state.todo });
        case 'adminSaveTodo': state.todo.push({ id: 2, stt: 2, noiDung: b.item.noiDung, note: '', dauMoi: '', done: false, updatedAt: '' }); return ok({ item: {} });
        case 'adminListCs': return ok({ items: [{ username: 'a', email: 'a@base.vn', hoTen: 'A', level: 'x', soDeal: 1, daDangKy: true }] });
        default: return ok({ items: [] });
      }
    });
    await page.addInitScript(() => localStorage.setItem('cs_tool_token', 'CST1.x.y'));
    await page.goto(`http://localhost:${port}/`);
    await page.waitForFunction(() => !document.getElementById('adminBtn').hidden, null, { timeout: 15000 });

    // Menu gọn: sidebar chỉ còn "Theo dõi", mục con luôn mở; nút hệ thống nằm trong menu hồ sơ
    await page.waitForSelector('#profileStrip', { state: 'visible' });
    assert.equal(await page.$$eval('aside .nav-item', (els) => els.filter((e) => e.offsetParent).length), 0);
    for (const id of ['refreshBtn', 'donationBtn', 'playbookBtn']) assert.equal(await page.isVisible('#' + id), false, id);
    await page.mouse.move(900, 600);
    assert.ok(await page.isVisible('#navForecastGroup .nav-sub [data-view=multi]'), 'mục con Forecast mở sẵn');
    assert.ok(await page.isVisible('#navOverviewGroup .nav-sub .cp-nav-btn .new-tag'), 'Career path có tag New');
    assert.ok(await page.isVisible('#profileStrip .ps-new'), 'nút hồ sơ có chữ New');
    // Cộng phước: bấm liên tục 3 lần → gom thành 1 lần gửi n=3, số hiện ngay
    await page.waitForSelector('#phuocBox:not([hidden])');
    assert.equal(await page.textContent('#phuocMine'), '5');
    for (let i = 0; i < 3; i++) await page.click('#phuocBtn');
    assert.equal(await page.textContent('#phuocMine'), '8');
    await page.waitForFunction(() => /108/.test(document.getElementById('phuocSub').textContent));
    await page.waitForTimeout(900);
    assert.deepEqual(state.phuocCalls, [3]);
    assert.equal(await page.textContent('#phuocMine'), '8');

    await page.click('#profileStrip');
    await page.waitForSelector('#changelogBtn .new-tag', { state: 'visible', timeout: 3000 });
    assert.ok(await page.isVisible('#claudeBtn .new-tag'));
    assert.ok(await page.isVisible('#adminBtn'));
    await page.click('#changelogBtn');
    await page.waitForSelector('#changelogModal.open');
    assert.ok((await page.textContent('#changelogModal')).includes('Câu hỏi mẫu'));
    assert.equal(await page.evaluate(() => document.getElementById('accMenu').classList.contains('open')), false, 'bấm mục thì đóng menu');
    await page.click('#changelogClose');
    assert.ok(await page.isVisible('#profileStrip .ps-new'), 'còn Kết nối Claude chưa xem');
    await page.click('#profileStrip');
    await page.waitForSelector('#claudeBtn', { state: 'visible' });
    assert.equal(await page.$('#changelogBtn .new-tag'), null);
    await page.click('#claudeBtn');
    assert.equal(await page.isVisible('#profileStrip .ps-new'), false, 'xem hết thì tắt chữ New');
    await page.waitForSelector('#claudeModal.open');


    await page.fill('#mcLabel', 'Laptop');
    await page.click('#mcCreate');
    await page.waitForSelector('#mcUrl');
    assert.match(await page.textContent('#mcUrl'), /\/functions\/v1\/mcp\/csk_/);
    await page.evaluate(() => document.getElementById('claudeClose').click());

    await page.evaluate(() => document.getElementById('adminBtn').click());
    await page.waitForSelector('[data-fb] .pf-item-title');
    assert.ok((await page.innerHTML('[data-fb] .pf-item-title')).includes('&lt;img'), 'tiêu đề feedback phải được escape');
    assert.ok((await page.textContent('[data-fb]')).includes('Claude'), 'hiện kết quả Claude xử lý');
    await page.selectOption('[data-fb] [data-status]', 'Completed');
    await page.click('[data-fb] [data-save]');
    await page.waitForFunction(() => document.querySelector('.toast.show'));
    assert.equal(state.fb[0].status, 'Completed');

    await page.click('[data-tab-ad=todo]');
    await page.waitForSelector('#tdNew');
    await page.fill('#tdNew', 'Việc mới');
    await page.click('#tdAdd');
    await page.waitForFunction(() => document.querySelectorAll('[data-td]').length === 2);
    assert.ok((await page.innerHTML('[data-td="1"] .pf-item-title')).includes('&lt;b&gt;'));

    await page.click('[data-tab-ad=cs]');
    await page.waitForSelector('.ad-table tbody tr');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    srv.close();
  }
});

test('ui.js & app.js không lỗi cú pháp', () => {
  for (const f of ['app.js', 'ui.js', 'config.js']) execSync(`node --check ${path.join(ROOT, f)}`);
});

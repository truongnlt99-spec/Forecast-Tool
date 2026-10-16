// Career path trên Chromium ngầm: index.html thật + Edge Function api THẬT (Supabase giả trong bộ nhớ).
// Đi hết luồng: mở #/overview/career-path → chốt commit lên level (bị chặn dưới mốc KPI) → bấm Đạt
// → level + lương đổi; nội dung từ DB được escape; popup hồ sơ khoá ô Level.
// Cần Playwright (có sẵn global trong môi trường Claude Code); thiếu thì test tự bỏ qua.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { ROOT, loadEdgeFunction } from './helpers.mjs';

let chromium = null;
try {
  const require = createRequire(import.meta.url);
  try { ({ chromium } = require('playwright')); }
  catch { ({ chromium } = require(path.join(execSync('npm root -g').toString().trim(), 'playwright'))); }
} catch { /* không có playwright */ }

const EMAIL = 'cs@base.vn';
const SECRET = 'ui-secret-' + 'y'.repeat(30);

// "DB" giả — mô phỏng đúng hành vi các hàm SQL api_career_* (04_career_path.sql)
let db;
function freshDb(profile, deals) {
  db = { profile: { username: 'cs', email: EMAIL, hoTen: 'Chị CS', avatar: '', ...profile }, commits: [], levelHistory: [], deals };
}
const list = () => ({ commits: db.commits, levelHistory: db.levelHistory });
const fake = {
  rpc: async (fn, a) => {
    switch (fn) {
      case 'api_get_profile': return { data: db.profile };
      case 'api_get_deals_json': return { data: db.deals };
      case 'api_career_list': return { data: list() };
      case 'api_career_save_commit': {
        let c = db.commits.find((x) => x.quarter === a.p_quarter);
        if (!c) { c = { quarter: a.p_quarter, status: 'open', history: [], achievedAt: '' }; db.commits.push(c); }
        Object.assign(c, { baseLevel: a.p_base_level, targetLevel: a.p_target_level, cr: a.p_cr, s1: a.p_s1, s4: a.p_s4 });
        c.history.push({ baseLevel: a.p_base_level, targetLevel: a.p_target_level, cr: a.p_cr, s1: a.p_s1, s4: a.p_s4, at: '20/12/2026 10:0' + c.history.length });
        return { data: list() };
      }
      case 'api_career_achieve': {
        const c = db.commits.find((x) => x.quarter === a.p_quarter);
        Object.assign(c, { status: 'achieved', achievedAt: '20/12/2026 11:00', newSalary: a.p_new_salary });
        if (a.p_new_level) {
          db.levelHistory.unshift({ oldLevel: db.profile.level, newLevel: a.p_new_level, oldSalary: +db.profile.salary,
            newSalary: a.p_new_salary, reason: 'Career path ' + a.p_quarter, quarter: a.p_quarter, at: '20/12/2026 11:00' });
          db.profile = { ...db.profile, level: a.p_new_level, salary: String(a.p_new_salary) };
        }
        return { data: list() };
      }
      default: return { data: null };
    }
  },
};

async function validToken() {
  const b64 = (u8) => Buffer.from(u8).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
  const payload = b64(new TextEncoder().encode(JSON.stringify({ email: EMAIL, exp: 4102444800000 })));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return 'CST1.' + payload + '.' + b64(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))));
}

// Dựng trang thật + Edge Function thật trên Chromium; `now` = giờ giả của máy chủ
async function withPage(now, fn) {
  const NOW = new Date(now + 'T03:00:00Z').getTime();
  const api = await loadEdgeFunction('api', fake, { SESSION_SECRET: SECRET });
  const token = await validToken();
  const realNow = Date.now;
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
  const errors = [], careerCalls = [];
  let browser;
  try {
    browser = await chromium.launch();
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
      // Google Sign-In giả: đủ để app.js chạy tiếp với token đã lưu (loadDeals)
      if (req.url().includes('accounts.google')) {
        return route.fulfill({ contentType: 'text/javascript',
          body: 'window.google={accounts:{id:{initialize(){},renderButton(){},prompt(){},disableAutoSelect(){},cancel(){}}}};' });
      }
      if (req.method() === 'GET') {
        return route.fulfill({ json: { ok: true, email: EMAIL, sessionToken: 'CST1.x.y', isAdmin: false, deals: [], profile: db.profile } });
      }
      const b = JSON.parse(req.postData() || '{}');
      if (!/^career/.test(b.action || '')) return route.fulfill({ json: { ok: true, sessionToken: 'CST1.x.y', items: [] } });
      careerCalls.push(b.action);
      Date.now = () => NOW;   // giờ giả chỉ cho Edge Function (toàn bộ bằng microtask, không chen việc khác)
      try {
        const res = await api(new Request('https://p.supabase.co/functions/v1/api', {
          method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ ...b, token }),
        }));
        return route.fulfill({ json: await res.json() });
      } finally { Date.now = realNow; }
    });
    await page.addInitScript(() => localStorage.setItem('cs_tool_token', 'CST1.x.y'));
    await page.goto(`http://localhost:${port}/#/overview/career-path`);
    await fn(page, careerCalls);
    assert.deepEqual(errors, []);
  } finally {
    Date.now = realNow;
    await browser.close();
    srv.close();
  }
}

// Tháng 12/2026 = tháng cuối Q4: vừa sửa commit được vừa bấm Đạt được
test('UI Career path: commit → % loading → Đạt lên level', { skip: !chromium && 'chưa cài playwright' }, async () => {
  freshDb({ level: 'CS level 3', salary: '13000000' }, [{ 'Deal ID': '1', 'Loại hợp đồng': 'New', 'Tháng ghi nhận CR': '10/2026',
    'Ngày go-live thực tế': '15/10/2026', 'DT phải go-live': '10.000.000', 'Giá trị phần mềm bộ (VNĐ)': '10.000.000',
    'Tháng đo T1': '11/2026', 'CHS_CS T1': '90,0' }]);
  db.levelHistory = [{ oldLevel: 'CS level 2', newLevel: 'CS level 3', oldSalary: 12000000, newSalary: 13000000,
    reason: '<img src=x onerror=alert(1)>', quarter: 'Q1/2026', at: '01/04/2026 09:00' }];
  await withPage('2026-12-20', async (page, careerCalls) => {
      // Chưa có commit → hiện form; khối Overview gốc bị ẩn; tiêu đề đổi
      await page.waitForSelector('#cpTarget', { timeout: 15000 });
      assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#panel-overview .tab-panel-body:not(.cp-view)')).display), 'none');
      assert.equal(await page.textContent('#pageTitle'), 'Career path');
      assert.ok(await page.evaluate(() => document.querySelector('.cp-nav-btn').classList.contains('active')));
      assert.ok((await page.innerHTML('.cp-lv-hist')).includes('&lt;img'), 'lý do trong lịch sử level phải được escape');

      // Lên CS level 4 với CR 77% < mốc KPI 78% → bị chặn
      await page.selectOption('#cpTarget', 'CS level 4');
      assert.match(await page.textContent('#cpFloor_cr'), /Tối thiểu 78%/);
      await page.fill('#cpIn_cr', '77'); await page.fill('#cpIn_s1', '80'); await page.fill('#cpIn_s4', '79');
      await page.click('#cpSave');
      await page.waitForFunction(() => /tối thiểu 78%/.test(document.getElementById('cpFormErr').textContent));
      assert.equal(db.commits.length, 0);

      await page.fill('#cpIn_cr', '78');
      await page.click('#cpSave');
      await page.waitForSelector('.cp-commit-vals');
      assert.match(await page.textContent('.cp-target'), /lên CS level 4/);
      // CR quý 100% (deal go-live đúng hạn), SRR_1 100%, SRR_4 chưa có kỳ đo → bỏ qua
      const kpis = await page.$$eval('.cp-kpis .kpi-value', (els) => els.map((e) => e.textContent));
      assert.deepEqual(kpis, ['128,2%', '125%', '—']);
      // Biểu đồ thăng tiến ở đầu trang: hiện tại CS level 3 → mục tiêu CS level 4 (quý sau, nét đứt)
      assert.ok(await page.evaluate(() => document.querySelector('#cpView > .cp-chart-card') === document.querySelector('#cpView .table-card')));
      assert.deepEqual(await page.$$eval('#cpChart .cp-dlabel', (els) => els.map((e) => e.textContent)),
        ['Hiện tại · CS level 3', 'Mục tiêu · CS level 4']);
      assert.equal(await page.locator('#cpChart .cp-line-plan').count(), 1);
      await page.hover('#cpChart .cp-hit >> nth=1');
      assert.match(await page.textContent('#cpTip'), /Q1\/2027 · CS level 4 · Mục tiêu/);

      // Sửa commit → lưu lịch sử, hiện bản chốt đầu quý
      await page.click('#cpEdit');
      await page.fill('#cpIn_s1', '85');
      await page.click('#cpSave');
      await page.waitForSelector('.cp-hist');
      assert.match(await page.textContent('.cp-hist summary'), /đã sửa 1 lần/);

      // Đạt: lương ngoài khung bị chặn, trong khung thì lên level ngay
      await page.fill('#cpSalary', '20000000');
      await page.click('#cpAchieve'); await page.click('#cpAchieve');
      await page.waitForFunction(() => /Lương mới phải trong khung/.test(document.getElementById('cpAchErr').textContent));
      await page.fill('#cpSalary', '14500000');
      await page.click('#cpAchieve'); await page.click('#cpAchieve');
      await page.waitForSelector('.cp-done');
      assert.equal(db.profile.level, 'CS level 4');
      assert.equal(db.profile.salary, '14500000');
      assert.equal(db.commits[0].status, 'achieved');
      assert.ok(careerCalls.includes('careerAchieve'));

      // Sau khi Đạt, trang tự nạp lại → hồ sơ mới; popup Cập nhật thông tin khoá ô Level
      await page.waitForFunction(() => document.querySelector('.ps-chip.lvl') && /CS level 4/.test(document.querySelector('.ps-chip.lvl').textContent), null, { timeout: 15000 });
      await page.evaluate(() => document.getElementById('accEdit').click());
      assert.equal(await page.evaluate(() => document.getElementById('pmLevel').disabled), true);
      await page.evaluate(() => document.getElementById('pmClose').click());

      // Rời sang Overview → khối Overview hiện lại, trang Career path ẩn
      await page.evaluate(() => document.querySelector('.tab[data-tab="overview"]').click());
      await page.waitForFunction(() => document.getElementById('cpView').style.display === 'none');
      assert.notEqual(await page.evaluate(() => getComputedStyle(document.querySelector('#panel-overview .tab-panel-body:not(.cp-view)')).display), 'none');
  });
});

// Tháng 10/2026: Q3 đang mở tạo bù. CS đã lên CS level 4 trong Q3 (hồ sơ đã là level 4)
test('UI tạo bù Q3: khai level đầu quý, Đạt chỉ ghi nhận, biểu đồ hiện bước lên level', { skip: !chromium && 'chưa cài playwright' }, async () => {
  freshDb({ level: 'CS level 4', salary: '14000000' }, [{ 'Deal ID': '9', 'Loại hợp đồng': 'Upsale', 'Tháng ghi nhận CR': '08/2026',
    'Ngày go-live thực tế': '20/08/2026', 'DT phải go-live': '30.000.000', 'Giá trị phần mềm bộ (VNĐ)': '30.000.000' }]);
  await withPage('2026-10-20', async (page) => {
    // Đang ở Q4 (chưa commit): biểu đồ 1 điểm, banner mời tạo bù Q3
    await page.waitForSelector('[data-cp-goto="Q3/2026"]', { timeout: 15000 });
    assert.match(await page.textContent('.cp-banner'), /Quý 3\/2026 đang mở tạo bù tới hết tháng 10\/2026/);
    assert.equal(await page.locator('#cpChart .cp-dot').count(), 1);

    await page.click('[data-cp-goto="Q3/2026"]');
    await page.waitForSelector('#cpBase');
    assert.equal(await page.locator('.cp-banner').count(), 0);
    // Level đầu quý chỉ chọn được tới level hiện tại; mục tiêu tính từ level đầu quý
    assert.deepEqual(await page.$$eval('#cpBase option', (o) => o.map((x) => x.value)),
      ['CS level 1', 'CS level 2', 'CS level 3', 'CS level 4']);
    await page.selectOption('#cpBase', 'CS level 3');
    assert.deepEqual(await page.$$eval('#cpTarget option', (o) => o.map((x) => x.textContent)).then((t) => t.slice(0, 2)),
      ['Giữ CS level 3', 'Lên CS level 4']);
    await page.selectOption('#cpTarget', 'CS level 4');
    assert.match(await page.textContent('#cpFloor_s4'), /Tối thiểu 79%/);
    await page.fill('#cpIn_cr', '80'); await page.fill('#cpIn_s1', '80'); await page.fill('#cpIn_s4', '79');
    await page.click('#cpSave');
    await page.waitForSelector('.cp-commit-vals');
    assert.equal(db.commits[0].baseLevel, 'CS level 3');
    assert.match(await page.textContent('.cp-target'), /lên CS level 4.*từ CS level 3/);

    // Hồ sơ đã ở level 4 → không hỏi lương, Đạt chỉ ghi nhận
    assert.equal(await page.locator('#cpSalary').count(), 0);
    assert.match(await page.textContent('.cp-achieve'), /chỉ ghi nhận/);
    await page.click('#cpAchieve'); await page.click('#cpAchieve');
    await page.waitForSelector('.cp-done');
    assert.match(await page.textContent('.cp-done'), /Ghi nhận lên CS level 4/);
    assert.equal(db.profile.level, 'CS level 4');
    assert.equal(db.profile.salary, '14000000');
    assert.equal(db.levelHistory.length, 0);

    // Biểu đồ: Q3 ở CS level 3 (đã Đạt, lên level) → Q4 hiện tại CS level 4
    assert.equal(await page.locator('#cpChart .cp-dot').count(), 2);
    assert.deepEqual(await page.$$eval('#cpChart .cp-axis-now', (e) => e.map((x) => x.textContent)), ['Q4/26']);
    await page.hover('#cpChart .cp-hit >> nth=0');
    assert.match(await page.textContent('#cpTip'), /Q3\/2026 · CS level 3 · Đạt — lên level/);
  });
});

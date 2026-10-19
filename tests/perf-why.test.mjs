// Scorecard → Performance tháng: nút ? giải thích vì sao KPI / GOAL / OUT (ui.js mục 9b).
// Phần thuần chạy trên Node, so khớp với dashRating() của app.js; phần giao diện chạy Chromium với
// đúng dashRenderPerf() của app.js vẽ #perfGrid / #perfRating.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { read, slice } from './helpers.mjs';

const APP = read('app.js'), UI = read('ui.js');
const pw = new Function(slice(UI, '/* ==PW PURE START==', '/* ==PW PURE END== */') +
  '\nreturn { pwExplain, pwHtml, pwMoney, pwFmtMoney };')();
const app = new Function(
  slice(APP, '  var LEVELS = {', '  var LEVEL_ORDER') +
  slice(APP, '  function fmtMoneyShort(', '  function fmtDate(') +
  slice(APP, '  function dashRating(', '  function ratingBadge(') +
  '\nreturn { LEVELS, fmtMoneyShort, dashRating };')();

// Số ngẫu nhiên có seed để lần nào chạy cũng như nhau
let seed = 20261019;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const r2 = (v) => Math.round(v * 100) / 100;

function P({ cr = null, s1 = null, s4 = null, rev = 0, n = 2 }) {
  return { m: '10/2026', crDeals: new Array(n).fill({}), t1Deals: [{}], t4Deals: [{}], cr, sumPhai: 1e9, sumDat: rev,
    s1: { v: s1, nOk: 1, n: 1 }, s4: { v: s4, nOk: 1, n: 1 }, rev };
}
// Model như ui.js đọc lại từ màn hình: tiền đã qua fmtMoneyShort (làm tròn tới triệu)
function screenModel(def, p, rating) {
  const back = (v) => pw.pwMoney(app.fmtMoneyShort(v));
  if (def.group === 'CSA') return { group: 'CSA', rating, month: p.m, rev: back(p.rev),
    revTh: { kpi: back(def.rev.kpi), goal: back(def.rev.goal), out: back(def.rev.out) } };
  const th = (k) => ({ kpi: def.perf.kpi[k], goal: def.perf.goal[k], out: def.perf.out[k] });
  return { group: 'CS', rating, month: p.m, rev: back(p.rev), revOut: back(def.perf.out.rev), metrics: [
    { label: 'CR', val: p.cr, th: th('cr') }, { label: 'SRR_1', val: p.s1.v, th: th('s1') }, { label: 'SRR_4', val: p.s4.v, th: th('s4') }] };
}
// Mức cao nhất mà cả cột không có ô ✗
function tierFromTable(e) {
  let tier = 'under';
  e.cols.forEach((c, i) => { if (e.rows.every((r) => r.cells[i].st !== 'bad') && (i === 0 || tier === e.cols[i - 1].key)) tier = c.key; });
  return tier;
}

test('pwMoney đọc lại đúng số fmtMoneyShort của app.js', () => {
  for (const v of [0, 500000, 1e6, 220e6, 299.6e6, 1e9, 1.25e9, 12.3456e9]) {
    assert.equal(app.fmtMoneyShort(pw.pwMoney(app.fmtMoneyShort(v))), app.fmtMoneyShort(v), String(v));
  }
  assert.equal(pw.pwMoney('220tr'), 220e6);
  assert.equal(pw.pwMoney('1,25 tỷ'), 1.25e9);
  assert.equal(pw.pwMoney('0 đ'), 0);
});

test('bảng ✓/✗ khớp dashRating() app.js — mọi level, 4000 trường hợp (kể cả DT sát mốc bị làm tròn)', () => {
  let n = 0;
  for (const lv of Object.keys(app.LEVELS)) {
    const def = app.LEVELS[lv];
    for (let i = 0; i < 500; i++) {
      let p;
      if (def.group === 'CSA') {
        const o = def.rev.out;
        p = P({ rev: pick([0, def.rev.kpi - 4e5, def.rev.kpi, def.rev.goal - 1, def.rev.goal, o - 4e5, o, o * 1.3, rnd() * o * 1.4]), n: rnd() < 0.1 ? 0 : 2 });
      } else {
        const val = (k) => rnd() < 0.2 ? null : pick([def.perf.kpi[k], def.perf.goal[k], def.perf.out[k], r2(def.perf.out[k] - 0.01), r2(50 + rnd() * 50)]);
        const o = def.perf.out.rev;
        p = P({ cr: val('cr'), s1: val('s1'), s4: val('s4'), rev: pick([0, o - 4e5, o - 1, o, o + 4e5, rnd() * o * 1.5]) });
      }
      const rating = app.dashRating(def, p);
      if (rating === 'none') continue;
      const e = pw.pwExplain(screenModel(def, p, rating));
      assert.equal(tierFromTable(e), rating, `${lv} ${JSON.stringify({ cr: p.cr, s1: p.s1.v, s4: p.s4.v, rev: p.rev })}`);
      assert.equal(e.cols.filter((c) => c.cur).length, rating === 'under' ? 0 : 1);
      n++;
    }
  }
  assert.ok(n > 3000);
});

test('câu tóm tắt: GOAL vì thiếu DT go-live · UNDER liệt kê chỉ số thiếu · OUT · không xếp loại', () => {
  const def = app.LEVELS['CS level 3'];
  const goal = pw.pwExplain(screenModel(def, P({ cr: 85, s1: 86, rev: 220e6 }), 'goal'));
  assert.equal(goal.head, 'Bạn đang <b>GOAL</b>. Để lên <b>OUT</b> còn thiếu: DT go-live <b>220tr</b> (cần ≥ 300tr).');
  assert.deepEqual(goal.rows[2].cells.map((c) => c.st), ['skip', 'skip', 'skip'], 'SRR_4 trống → bỏ qua');

  const under = pw.pwExplain(screenModel(def, P({ cr: 0, s1: 62.86, rev: 0 }), 'under'));
  assert.match(under.head, /^Bạn đang <b>UNDER KPI<\/b>\. Để đạt <b>KPI<\/b> còn thiếu: CR <b>0,00%<\/b> \(cần ≥ 78%\) · SRR_1 <b>62,86%<\/b> \(cần ≥ 80%\)\.$/);
  assert.ok(!under.head.includes('DT go-live'), 'DT go-live không phải điều kiện của KPI');

  assert.match(pw.pwExplain(screenModel(def, P({ cr: 90, s1: 90, rev: 350e6 }), 'out')).head, /^Bạn đạt <b>OUT<\/b>/);
  assert.match(pw.pwExplain(screenModel(def, P({ rev: 0 }), 'none')).head, /không xếp loại/);

  const csa = pw.pwExplain(screenModel(app.LEVELS['CS_A level 1'], P({ rev: 120e6 }), 'kpi'));
  assert.equal(csa.rows.length, 1);
  assert.equal(csa.head, 'Bạn đang <b>KPI</b>. Để lên <b>GOAL</b> còn thiếu: DT go-live <b>120tr</b> (cần ≥ 150tr).');
});

// ---------- giao diện: dashRenderPerf() thật của app.js + mục 9b ui.js ----------
const require = createRequire(import.meta.url);
let chromium = null;
try { ({ chromium } = require('playwright')); }
catch { try { ({ chromium } = require(path.join(execSync('npm root -g').toString().trim(), 'playwright'))); } catch { /* không có */ } }

test('UI: nút ? cạnh huy hiệu + thanh DT go-live + popup bảng', { skip: !chromium && 'chưa cài playwright' }, async () => {
  const exe = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((x) => fs.existsSync(x));
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setContent('<div id="perfGrid"></div><div id="perfRating"></div>' +
      '<div id="cxModal"><h3 id="cxModalTitle"></h3><button id="cxModalClose"></button><div id="cxModalBody"></div></div>');
    await page.addScriptTag({ content: '(function(){' + slice(UI, '  /* ==PERF WHY START==', '  /* ==PERF WHY END== */') + '})();' });
    await page.addScriptTag({ content: '(function(){var $=function(id){return document.getElementById(id)};' +
      slice(APP, '  var LEVELS = {', '  var LEVEL_ORDER') +
      slice(APP, '  function fmtMoneyShort(', '  function fmtDate(') +
      slice(APP, '  function esc(v)', '  // Tìm kiếm') +
      slice(APP, '  var RATING_LABEL', '  var CHART_COLORS') +
      slice(APP, '  function dashRating(', '  function dashRenderCommission(') +
      'window.__render=function(lv,p){var d=LEVELS[lv],r=dashRating(d,p);dashRenderPerf(d,p,r);return r;};})();' });
    const render = (lv, o) => page.evaluate(([lv, p]) => window.__render(lv, p), [lv, P(o)]);
    const tick = () => page.evaluate(() => new Promise((r) => setTimeout(r, 0)));

    assert.equal(await render('CS level 3', { cr: 85, s1: 86, rev: 220e6 }), 'goal');
    await tick();
    assert.equal(await page.locator('#perfRating .pw-why').count(), 1);
    assert.equal(await page.locator('.pw-rev-track .pf-tick.t-out').count(), 1);
    assert.match(await page.textContent('#perfGrid'), /OUT ≥ 300tr · chỉ xét cho mốc OUT/);
    await page.click('#perfRating .pw-why');
    assert.ok(await page.evaluate(() => document.getElementById('cxModal').classList.contains('open')));
    assert.equal(await page.textContent('#cxModalTitle'), 'Vì sao xếp loại tháng 10/2026 là GOAL?');
    assert.ok((await page.innerHTML('#cxModalBody')).includes('DT go-live <b>220tr</b> (cần ≥ 300tr)'));
    assert.deepEqual(await page.$$eval('.pw-table tbody tr:last-child td', (t) => t.map((x) => x.className.trim())),
      ['', 'pw-na', 'pw-na pw-cur', 'pw-bad']);
    await page.click('#cxModalClose');
    assert.ok(!(await page.evaluate(() => document.getElementById('cxModal').classList.contains('open'))));

    // app.js vẽ lại (đổi tháng) → không nhân đôi nút / thanh
    assert.equal(await render('CS level 3', { cr: 85, s1: 86, rev: 320e6 }), 'out');
    await tick();
    assert.equal(await page.locator('#perfRating .pw-why').count(), 1);
    assert.equal(await page.locator('.pw-rev-track').count(), 1);
    assert.equal(await page.locator('.pw-rev-track .pf-fill.f-out').count(), 1);

    assert.equal(await render('CS level 3', { cr: 0, s1: 62.86, rev: 0 }), 'under');
    await tick();
    await page.click('#perfRating .pw-why');
    assert.ok((await page.innerHTML('#cxModalBody')).includes('SRR_1 <b>62,86%</b> (cần ≥ 80%)'));
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

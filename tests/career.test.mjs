// Career path theo quý (Edge Function api: careerGet / careerSaveCommit / careerAchieve).
// Supabase giả, giờ giả (Date.now) — không gọi mạng.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadEdgeFunction, read, slice } from './helpers.mjs';

// 10 deal mẫu cho Q4/2026. Đơn vị triệu cho dễ đọc.
const tr = (n) => (n * 1e6).toLocaleString('vi-VN');
const DEALS = [
  // CR — tháng 10: tử = D1 10 + D3 30 + D5 6 (go-live sớm, chỉ tử số) = 46; mẫu = D1 10 + D2 20 + D3 30 = 60
  { 'Deal ID': 'D1', 'Loại hợp đồng': 'New', 'Tháng ghi nhận CR': '10/2026', 'Ngày go-live thực tế': '15/10/2026',
    'DT phải go-live': tr(10), 'Giá trị phần mềm bộ (VNĐ)': tr(10), 'Tháng đo T1': '10/2026', 'CHS_CS T1': '60,0' },
  { 'Deal ID': 'D2', 'Loại hợp đồng': 'Upsale', 'Tháng ghi nhận CR': '10/2026', 'Ngày go-live thực tế': '', 'DT phải go-live': tr(20) },
  { 'Deal ID': 'D3', 'Loại hợp đồng': 'Cross sale', 'Tháng ghi nhận CR': '09/2026', 'Ngày go-live thực tế': '05/10/2026', 'DT phải go-live': tr(30) },
  { 'Deal ID': 'D4', 'Loại hợp đồng': 'Renew', 'Tháng ghi nhận CR': '10/2026', 'Ngày go-live thực tế': '', 'DT phải go-live': tr(99) },
  { 'Deal ID': 'D5', 'Loại hợp đồng': 'New', 'Tháng ghi nhận CR': '11/2026', 'Ngày go-live thực tế': '20/10/2026', 'DT phải go-live': tr(6) },
  { 'Deal ID': 'D6', 'Loại hợp đồng': 'New', 'Tháng ghi nhận CR': '10/2026', 'Ngày go-live thực tế': '', 'DT phải go-live': tr(50), 'Dừng triển khai ': 'X' },
  // SRR — PS bị loại; D8 CHS 45,5 < 50; D9 kỳ T4
  { 'Deal ID': 'D7', 'Loại hợp đồng': 'New', 'Bộ giải pháp': 'PS', 'Giá trị phần mềm bộ (VNĐ)': tr(40), 'Tháng đo T1': '10/2026', 'CHS_CS T1': '10,0' },
  { 'Deal ID': 'D8', 'Loại hợp đồng': 'New', 'Giá trị phần mềm bộ (VNĐ)': tr(5), 'Tháng đo T1': '10/2026', 'CHS_CS T1': '45,5' },
  { 'Deal ID': 'D9', 'Loại hợp đồng': 'New', 'Giá trị phần mềm bộ (VNĐ)': tr(8), 'Tháng đo T4': '10/2026', 'CHS_CS T4': '70,0' },
  // Kỳ đo tháng 12 chưa có CHS — giữa quý KHÔNG được tính (tháng chưa tới)
  { 'Deal ID': 'D10', 'Loại hợp đồng': 'New', 'Giá trị phần mềm bộ (VNĐ)': tr(100), 'Tháng đo T1': '12/2026', 'CHS_CS T1': '' },
  // Q3 — CR quý 3 = 100 / (100 + 30 của D3 trễ ở tháng 9) = 76,92%
  { 'Deal ID': 'D11', 'Loại hợp đồng': 'New', 'Tháng ghi nhận CR': '08/2026', 'Ngày go-live thực tế': '10/08/2026', 'DT phải go-live': tr(100) },
];

const state = { profile: { level: 'CS level 3', salary: '13000000' }, list: { commits: [], levelHistory: [] }, deals: DEALS };
const calls = [];
const fake = {
  rpc: async (fn, args) => {
    calls.push([fn, args]);
    if (fn === 'api_get_profile') return { data: state.profile };
    if (fn === 'api_career_list') return { data: state.list };
    if (fn === 'api_get_deals_json') return { data: state.deals };
    if (fn === 'api_is_admin') return { data: false };
    if (fn === 'api_mcp_resolve') return { data: 'cs@base.vn' };
    return { data: null };
  },
};
const SECRET = 'test-secret-' + 'x'.repeat(30);
const api = await loadEdgeFunction('api', fake, { SESSION_SECRET: SECRET });

// Vé phiên CST1 hợp lệ (giống mintSessionToken_)
async function token(email = 'cs@base.vn') {
  const b64 = (u8) => Buffer.from(u8).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
  const payload = b64(new TextEncoder().encode(JSON.stringify({ email, exp: 4102444800000 })));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = b64(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))));
  return 'CST1.' + payload + '.' + sig;
}
const realNow = Date.now;
function at(iso) { const t = new Date(iso + 'T03:00:00Z').getTime(); Date.now = () => t; }
async function post(body) {
  const r = await api(new Request('https://p.supabase.co/functions/v1/api', {
    method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ token: await token(), ...body }),
  }));
  return r.json();
}
const commit = (o) => ({ quarter: 'Q4/2026', baseLevel: 'CS level 3', targetLevel: 'CS level 3', cr: 70, s1: 60, s4: 50,
  status: 'open', history: [], ...o });

test('careerGet giữa quý: chỉ tính tháng đã tới, cộng dồn đúng tử/mẫu', async () => {
  at('2026-10-16');
  state.list = { commits: [], levelHistory: [] };
  const r = await post({ action: 'careerGet' });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.quarter, 'Q4/2026');
  assert.equal(r.phase, 'commit');
  assert.equal(r.canEdit, true);
  assert.equal(r.canAchieveWindow, false);
  assert.equal(r.status, 'none');
  assert.deepEqual(r.quarters, ['Q4/2026', 'Q3/2026']);
  assert.equal(r.actuals.cr.phai, 60e6);
  assert.equal(r.actuals.cr.dat, 46e6);
  assert.equal(r.actuals.cr.v, 76.67);
  assert.equal(r.actuals.s1.v, 66.67);   // 10 / (10 + 5), PS và kỳ đo tháng 12 không tính
  assert.equal(r.actuals.s1.n, 2);
  assert.equal(r.actuals.s4.v, 100);
  assert.deepEqual(r.actuals.byMonth.map((x) => !!x.future), [false, true, true]);
  assert.deepEqual(r.nextLevels, ['CS level 4', 'CS level 5', 'CS level 6', 'CS level 7']);
  Date.now = realNow;
});

test('CR quý = tổng tử/mẫu từng tháng của tool cr_summary (MCP)', async () => {
  at('2026-12-20');
  const view = await post({ action: 'careerGet', quarter: 'Q4/2026' });
  const mcp = await loadEdgeFunction('mcp', fake);
  const key = 'csk_' + 'k'.repeat(40);   // fake.rpc: api_mcp_resolve → cs@base.vn
  let phai = 0, dat = 0;
  for (const m of ['10/2026', '11/2026', '12/2026']) {
    const r = await mcp(new Request('https://p.supabase.co/functions/v1/mcp/' + key, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'cr_summary', arguments: { thang: m } } }),
    }));
    const t = JSON.parse((await r.json()).result.content[0].text);
    phai += t.mauSo_DTPhaiGoLive; dat += t.tuSo_DTGoLiveDat;
  }
  assert.equal(view.actuals.cr.phai, phai);   // deal D2 chưa go-live nằm trong mẫu số cả 3 tháng
  assert.equal(view.actuals.cr.dat, dat);
  assert.equal(phai, 100e6);
  Date.now = realNow;
});

test('mốc KPI + khung lương ở Edge Function khớp bảng LEVELS của app.js', async () => {
  at('2026-10-16');
  const LEVELS = new Function(slice(read('app.js'), '  var LEVELS = {', '  var LEVEL_ORDER') + '\nreturn LEVELS;')();
  const r = await post({ action: 'careerGet' });
  const csLevels = Object.keys(LEVELS).filter((k) => LEVELS[k].group === 'CS');
  assert.deepEqual(r.order, csLevels);
  for (const k of csLevels) {
    assert.deepEqual(r.levels[k].kpi, LEVELS[k].perf.kpi, k);
    assert.deepEqual([r.levels[k].lo, r.levels[k].hi], LEVELS[k].salary, k);
  }
  Date.now = realNow;
});

test('careerSaveCommit: mốc sàn khi lên level, giữ level thì không có sàn, chặn sai quý / CS_A', async () => {
  at('2026-11-05');
  state.list = { commits: [], levelHistory: [] };
  let r = await post({ action: 'careerSaveCommit', quarter: 'Q4/2026', targetLevel: 'CS level 4', cr: 77, s1: 80, s4: 79 });
  assert.equal(r.ok, false);
  assert.match(r.error, /CR commit tối thiểu 78% \(mốc KPI của CS level 4\)/);

  calls.length = 0;
  r = await post({ action: 'careerSaveCommit', quarter: 'Q4/2026', targetLevel: 'CS level 5', cr: 81, s1: 82.555, s4: 81 });
  assert.equal(r.ok, true, r.error);
  const save = calls.find((c) => c[0] === 'api_career_save_commit')[1];
  assert.deepEqual(save, { p_email: 'cs@base.vn', p_quarter: 'Q4/2026', p_base_level: 'CS level 3',
    p_target_level: 'CS level 5', p_cr: 81, p_s1: 82.56, p_s4: 81 });

  r = await post({ action: 'careerSaveCommit', quarter: 'Q4/2026', targetLevel: 'CS level 3', cr: 50, s1: 40, s4: 30 });
  assert.equal(r.ok, true, r.error);

  for (const bad of [
    { quarter: 'Q3/2026', targetLevel: 'CS level 3', cr: 50, s1: 50, s4: 50 },   // quý đã qua
    { quarter: 'Q1/2027', targetLevel: 'CS level 3', cr: 50, s1: 50, s4: 50 },   // quý chưa tới
    { quarter: 'Q4/2026', targetLevel: 'CS level 2', cr: 90, s1: 90, s4: 90 },   // level thấp hơn
    { quarter: 'Q4/2026', targetLevel: 'CS level 3', cr: 0, s1: 50, s4: 50 },
    { quarter: 'Q4/2026', targetLevel: 'CS level 3', cr: 101, s1: 50, s4: 50 },
    { quarter: 'Q4/2026', targetLevel: 'CS level 3', cr: 'abc', s1: 50, s4: 50 },
  ]) assert.equal((await post({ action: 'careerSaveCommit', ...bad })).ok, false, JSON.stringify(bad));

  state.list = { commits: [commit({ status: 'achieved' })], levelHistory: [] };
  assert.match((await post({ action: 'careerSaveCommit', quarter: 'Q4/2026', cr: 50, s1: 50, s4: 50 })).error, /đã bấm Đạt/);

  state.profile = { level: 'CS_A level 2', salary: '11000000' };
  r = await post({ action: 'careerGet' });
  assert.equal(r.eligible, false);
  assert.match((await post({ action: 'careerSaveCommit', quarter: 'Q4/2026', cr: 50, s1: 50, s4: 50 })).error, /CS level 1–7/);
  state.profile = { level: 'CS level 3', salary: '13000000' };
  Date.now = realNow;
});

test('careerAchieve: chỉ trong cửa sổ, phải đạt đủ, lên level thì cần lương trong khung', async () => {
  // tháng 12 — số quý: CR 46%, SRR_1 8,7% (D10 kỳ đo tháng 12 đã tới, chưa có CHS), SRR_4 100%
  at('2026-12-20');
  state.list = { commits: [commit({ targetLevel: 'CS level 4', cr: 40, s1: 8, s4: 90 })], levelHistory: [] };
  let r = await post({ action: 'careerGet', quarter: 'Q4/2026' });
  assert.equal(r.phase, 'achieve');
  assert.equal(r.canEdit, true);
  assert.equal(r.levelUp, true);
  assert.equal(r.canAchieve, true);
  assert.equal(r.evaluation.items.cr.loading, 115);   // 46 / 40
  assert.equal(r.actuals.s1.v, 8.7);
  assert.equal(r.evaluation.items.s1.loading, 108.8);

  assert.match((await post({ action: 'careerAchieve', quarter: 'Q4/2026' })).error, /Lương mới phải trong khung 13\.000\.000 – 17\.000\.000/);
  assert.match((await post({ action: 'careerAchieve', quarter: 'Q4/2026', newSalary: 18000000 })).error, /khung/);
  calls.length = 0;
  r = await post({ action: 'careerAchieve', quarter: 'Q4/2026', newSalary: '14.500.000' });
  assert.equal(r.ok, true, r.error);
  const a = calls.find((c) => c[0] === 'api_career_achieve')[1];
  assert.equal(a.p_new_level, 'CS level 4');
  assert.equal(a.p_new_salary, 14500000);
  assert.equal(a.p_snapshot.evaluation.allMet, true);

  // giữ level: không đổi level/lương
  state.list = { commits: [commit({ cr: 40, s1: 8, s4: 90 })], levelHistory: [] };
  calls.length = 0;
  assert.equal((await post({ action: 'careerAchieve', quarter: 'Q4/2026', newSalary: 99 })).ok, true);
  const k = calls.find((c) => c[0] === 'api_career_achieve')[1];
  assert.equal(k.p_new_level, null);
  assert.equal(k.p_new_salary, null);

  // chưa đạt (CR thực tế 46% < commit 50%)
  state.list = { commits: [commit({ cr: 50, s1: 8, s4: 90 })], levelHistory: [] };
  assert.equal((await post({ action: 'careerGet', quarter: 'Q4/2026' })).canAchieve, false);
  assert.match((await post({ action: 'careerAchieve', quarter: 'Q4/2026' })).error, /chưa đạt/);

  // tháng đầu quý: quá sớm
  at('2026-10-20');
  state.list = { commits: [commit({ cr: 40, s1: 8, s4: 90 })], levelHistory: [] };
  assert.match((await post({ action: 'careerAchieve', quarter: 'Q4/2026' })).error, /tháng cuối quý/);

  // tháng đầu quý sau: còn hạn bấm Đạt nhưng không sửa commit được
  at('2027-01-25');
  r = await post({ action: 'careerGet', quarter: 'Q4/2026' });
  assert.equal(r.canAchieve, true);
  assert.equal(r.canEdit, false);
  assert.deepEqual(r.quarters, ['Q1/2027', 'Q4/2026']);
  assert.equal((await post({ action: 'careerSaveCommit', quarter: 'Q4/2026', cr: 40, s1: 8, s4: 90 })).ok, false);

  // quá hạn → Không đạt
  at('2027-02-02');
  r = await post({ action: 'careerGet', quarter: 'Q4/2026' });
  assert.equal(r.status, 'missed');
  assert.equal(r.commits[0].status, 'missed');
  assert.equal(r.canAchieve, false);
  assert.match((await post({ action: 'careerAchieve', quarter: 'Q4/2026' })).error, /không còn mở/);
  Date.now = realNow;
});

test('tạo bù Q3/2026: mở tới hết 10/2026, CS khai level đầu quý, mốc sàn theo level đầu quý', async () => {
  at('2026-10-16');
  state.profile = { level: 'CS level 3', salary: '13000000' };
  state.list = { commits: [], levelHistory: [] };
  let r = await post({ action: 'careerGet', quarter: 'Q3/2026' });
  assert.equal(r.backfill, true);
  assert.equal(r.canEdit, true);
  assert.deepEqual(r.backfillPending, ['Q3/2026']);
  assert.equal(r.actuals.cr.v, 76.92);

  // đã lên CS level 3 trong Q3 → khai đầu quý là CS level 2, mục tiêu CS level 3 (sàn KPI level 3: 78/80/78)
  assert.match((await post({ action: 'careerSaveCommit', quarter: 'Q3/2026', baseLevel: 'CS level 2', targetLevel: 'CS level 3', cr: 70, s1: 80, s4: 78 })).error, /CR commit tối thiểu 78%/);
  calls.length = 0;
  r = await post({ action: 'careerSaveCommit', quarter: 'Q3/2026', baseLevel: 'CS level 2', targetLevel: 'CS level 3', cr: 78, s1: 80, s4: 78 });
  assert.equal(r.ok, true, r.error);
  const save = calls.find((c) => c[0] === 'api_career_save_commit')[1];
  assert.equal(save.p_base_level, 'CS level 2');
  assert.equal(save.p_target_level, 'CS level 3');
  // level đầu quý không được cao hơn level hiện tại
  assert.match((await post({ action: 'careerSaveCommit', quarter: 'Q3/2026', baseLevel: 'CS level 4', targetLevel: 'CS level 4', cr: 90, s1: 90, s4: 90 })).error, /Level đầu quý/);
  // quý thường: baseLevel gửi lên bị bỏ qua, luôn lấy level hiện tại
  calls.length = 0;
  await post({ action: 'careerSaveCommit', quarter: 'Q4/2026', baseLevel: 'CS level 1', targetLevel: 'CS level 3', cr: 50, s1: 50, s4: 50 });
  assert.equal(calls.find((c) => c[0] === 'api_career_save_commit')[1].p_base_level, 'CS level 3');

  // hết hạn tạo bù
  at('2026-11-01');
  assert.equal((await post({ action: 'careerSaveCommit', quarter: 'Q3/2026', baseLevel: 'CS level 2', targetLevel: 'CS level 3', cr: 78, s1: 80, s4: 78 })).ok, false);
  r = await post({ action: 'careerGet' });
  assert.deepEqual(r.backfillPending, []);
  Date.now = realNow;
});

test('Đạt bù Q3: hồ sơ đã ở level mục tiêu → chỉ ghi nhận; hồ sơ còn thấp → đổi level + lương', async () => {
  at('2026-10-20');
  state.profile = { level: 'CS level 3', salary: '13000000' };
  state.list = { commits: [commit({ quarter: 'Q3/2026', baseLevel: 'CS level 2', targetLevel: 'CS level 3', cr: 75, s1: 80, s4: 78 })], levelHistory: [] };
  let r = await post({ action: 'careerGet', quarter: 'Q3/2026' });
  assert.equal(r.levelUp, false);   // hồ sơ đã là CS level 3
  assert.equal(r.canAchieve, true); // CR 76,92% ≥ 75%; SRR Q3 không có kỳ đo → bỏ qua
  calls.length = 0;
  assert.equal((await post({ action: 'careerAchieve', quarter: 'Q3/2026' })).ok, true);
  assert.equal(calls.find((c) => c[0] === 'api_career_achieve')[1].p_new_level, null);

  state.profile = { level: 'CS level 2', salary: '12000000' };
  r = await post({ action: 'careerGet', quarter: 'Q3/2026' });
  assert.equal(r.levelUp, true);
  calls.length = 0;
  assert.equal((await post({ action: 'careerAchieve', quarter: 'Q3/2026', newSalary: 13500000 })).ok, true);
  const a = calls.find((c) => c[0] === 'api_career_achieve')[1];
  assert.equal(a.p_new_level, 'CS level 3');
  assert.equal(a.p_new_salary, 13500000);
  state.profile = { level: 'CS level 3', salary: '13000000' };
  Date.now = realNow;
});

test('track biểu đồ thăng tiến: level theo quý + điểm kế hoạch quý sau', async () => {
  at('2026-10-20');
  state.list = { commits: [], levelHistory: [] };
  let r = await post({ action: 'careerGet' });
  assert.deepEqual(r.track.map((p) => [p.quarter, p.level, p.kind]), [['Q4/2026', 'CS level 3', 'current']]);

  state.list = { commits: [
    commit({ quarter: 'Q4/2026', baseLevel: 'CS level 3', targetLevel: 'CS level 4' }),
    commit({ quarter: 'Q2/2026', baseLevel: 'CS level 1', targetLevel: 'CS level 2', status: 'achieved' }),
  ], levelHistory: [] };
  r = await post({ action: 'careerGet' });
  assert.deepEqual(r.track.map((p) => [p.quarter, p.level, p.kind, p.levelUp]), [
    ['Q2/2026', 'CS level 1', 'past', true],
    ['Q3/2026', 'CS level 2', 'past', false],     // quý không commit → nối tiếp level cuối Q2
    ['Q4/2026', 'CS level 3', 'current', false],  // hồ sơ hiện tại
    ['Q1/2027', 'CS level 4', 'plan', true],
  ]);
  assert.equal(r.track[0].status, 'achieved');
  assert.equal(r.track[1].status, 'none');
  Date.now = realNow;
});

test('tạo bù Q3: SRR_4 không bắt buộc — để trống thì không xét SRR_4; quý thường vẫn bắt buộc', async () => {
  at('2026-10-16');
  state.profile = { level: 'CS level 3', salary: '13000000' };
  state.list = { commits: [], levelHistory: [] };
  for (const s4 of [undefined, null, '']) {
    calls.length = 0;
    const r = await post({ action: 'careerSaveCommit', quarter: 'Q3/2026', baseLevel: 'CS level 2', targetLevel: 'CS level 3', cr: 78, s1: 80, s4 });
    assert.equal(r.ok, true, r.error);
    assert.equal(calls.find((c) => c[0] === 'api_career_save_commit')[1].p_s4, null);
  }
  // nhập SRR_4 thì vẫn kiểm mốc sàn như thường
  assert.match((await post({ action: 'careerSaveCommit', quarter: 'Q3/2026', baseLevel: 'CS level 2', targetLevel: 'CS level 3', cr: 78, s1: 80, s4: 50 })).error, /SRR_4 commit tối thiểu 78%/);
  // quý thường: SRR_4 vẫn bắt buộc
  assert.match((await post({ action: 'careerSaveCommit', quarter: 'Q4/2026', cr: 50, s1: 50 })).error, /SRR_4 phải là số/);

  // Q3 có kỳ đo T4 rớt (SRR_4 thực tế 0%) nhưng không commit SRR_4 → vẫn bấm Đạt được
  const keep = state.deals;
  state.deals = keep.concat([{ 'Deal ID': 'D12', 'Loại hợp đồng': 'New', 'Giá trị phần mềm bộ (VNĐ)': tr(9), 'Tháng đo T4': '09/2026', 'CHS_CS T4': '30,0' }]);
  at('2026-10-20');
  state.list = { commits: [commit({ quarter: 'Q3/2026', baseLevel: 'CS level 2', targetLevel: 'CS level 3', cr: 75, s1: 80, s4: null })], levelHistory: [] };
  let r = await post({ action: 'careerGet', quarter: 'Q3/2026' });
  assert.equal(r.actuals.s4.v, 0);
  assert.deepEqual(r.evaluation.items.s4, { actual: 0, commit: null, loading: null, met: null });
  assert.equal(r.evaluation.present, 1);
  assert.equal(r.canAchieve, true);
  // còn nếu có commit SRR_4 thì SRR_4 thực tế 0% làm trượt
  state.list = { commits: [commit({ quarter: 'Q3/2026', baseLevel: 'CS level 2', targetLevel: 'CS level 3', cr: 75, s1: 80, s4: 78 })], levelHistory: [] };
  r = await post({ action: 'careerGet', quarter: 'Q3/2026' });
  assert.equal(r.canAchieve, false);
  state.deals = keep;
  Date.now = realNow;
});

test('careerDeleteCommit: xoá được khi quý còn hạn (kể cả đã Đạt), hết hạn thì chặn', async () => {
  at('2026-10-20');
  state.profile = { level: 'CS level 3', salary: '13000000' };
  // Q3 đã Đạt (giữ level) — đang tháng đầu Q4 nên còn hạn
  state.list = { commits: [commit({ quarter: 'Q3/2026', status: 'achieved', cr: 80, s1: 82, s4: null })], levelHistory: [] };
  let r = await post({ action: 'careerGet', quarter: 'Q3/2026' });
  assert.equal(r.canDelete, true);
  calls.length = 0;
  r = await post({ action: 'careerDeleteCommit', quarter: 'Q3/2026' });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(calls.find((c) => c[0] === 'api_career_delete_commit')[1], { p_email: 'cs@base.vn', p_quarter: 'Q3/2026' });
  // Q4 đang chạy, chưa Đạt
  state.list = { commits: [commit({ quarter: 'Q4/2026' })], levelHistory: [] };
  assert.equal((await post({ action: 'careerGet', quarter: 'Q4/2026' })).canDelete, true);
  // không có commit
  assert.match((await post({ action: 'careerDeleteCommit', quarter: 'Q2/2026' })).error, /Không có commit/);
  assert.match((await post({ action: 'careerDeleteCommit', quarter: 'xx' })).error, /Quý không hợp lệ/);
  // hết hạn: Q3 sang tháng 11
  at('2026-11-02');
  state.list = { commits: [commit({ quarter: 'Q3/2026', status: 'achieved' })], levelHistory: [] };
  r = await post({ action: 'careerGet', quarter: 'Q3/2026' });
  assert.equal(r.canDelete, false);
  assert.match((await post({ action: 'careerDeleteCommit', quarter: 'Q3/2026' })).error, /hết hạn/);
  Date.now = realNow;
});

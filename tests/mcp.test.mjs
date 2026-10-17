// Edge Function mcp: giao thức MCP, phân quyền admin, các tool chính (Supabase giả, không gọi mạng)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadEdgeFunction, sha256Hex } from './helpers.mjs';

const KEY = 'csk_' + 'k'.repeat(40);
const calls = [];
let currentEmail = 'cs@base.vn';
const DEALS = [
  { 'Deal ID': '1', 'Tên khách hàng': 'A', 'Loại hợp đồng': 'Upsale', 'Tháng ghi nhận CR': '10/2026',
    'Ngày go-live thực tế': '30/09/2026', 'DT phải go-live': '4.375.000', 'Dừng triển khai ': '' },
  { 'Deal ID': '2', 'Tên khách hàng': 'B', 'Loại hợp đồng': 'New', 'Tháng ghi nhận CR': '09/2026',
    'Ngày go-live thực tế': '', 'DT phải go-live': '10.000.000', 'Dừng triển khai ': '' },
  { 'Deal ID': '3', 'Tên khách hàng': 'C', 'Loại hợp đồng': 'Renew', 'Tháng ghi nhận CR': '09/2026',
    'Ngày go-live thực tế': '', 'DT phải go-live': '5.000.000', 'Dừng triển khai ': '' },
];
let ngayDg = null;   // deal_ngay_dg giả: ngày đánh giá Năm 1 (yyyy-mm-dd)
const fake = {
  rpc: async (fn, args) => {
    calls.push([fn, args]);
    if (fn === 'deal_ngay_dg') return { data: ngayDg };
    if (fn === 'api_mcp_resolve') return { data: args.p_hash === (await sha256Hex(KEY)) ? currentEmail : null };
    if (fn === 'api_is_admin') return { data: args.p_email === 'admin@base.vn' };
    if (fn === 'api_get_deals_json') return { data: DEALS };
    if (fn === 'api_admin_get_feedback') return { data: { id: args.p_id, attachments: ['https://drive.google.com/x'] } };
    return { data: { fn, args } };
  },
  from: () => ({ select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: { active: 0.85, output: null } }) }),
};
const handler = await loadEdgeFunction('mcp', fake);

async function call(email, body, key = KEY) {
  currentEmail = email;
  const r = await handler(new Request('https://p.supabase.co/functions/v1/mcp/' + key, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }));
  const t = await r.text();
  return { status: r.status, body: t ? JSON.parse(t) : null };
}
const tool = async (email, name, args = {}) =>
  (await call(email, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })).body;
const textOf = (res) => JSON.parse(res.result.content[0].text);

test('initialize + notification', async () => {
  const r = await call('cs@base.vn', { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.result.protocolVersion, '2025-06-18');
  assert.equal((await call('cs@base.vn', { jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202);
});

test('khoá sai → 403, GET → 405', async () => {
  assert.equal((await call('cs@base.vn', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, 'sai'.repeat(10))).status, 403);
  const r = await handler(new Request('https://p.supabase.co/functions/v1/mcp/' + KEY, { method: 'GET' }));
  assert.equal(r.status, 405);
});

test('CS thường không thấy & không gọi được tool admin', async () => {
  const user = (await call('cs@base.vn', { jsonrpc: '2.0', id: 1, method: 'tools/list' })).body.result.tools;
  const admin = (await call('admin@base.vn', { jsonrpc: '2.0', id: 1, method: 'tools/list' })).body.result.tools;
  assert.ok(!user.some((t) => t.name.startsWith('admin_')));
  assert.ok(admin.length > user.length);
  for (const n of ['admin_feedback_queue', 'admin_mark_feedback', 'admin_get_deal', 'admin_find_deals', 'admin_get_feedback']) {
    assert.ok(admin.some((t) => t.name === n), n);
  }
  const r = await tool('cs@base.vn', 'admin_list_cs');
  assert.equal(r.error.code, -32602);
});

test('cr_summary — deal kéo sớm vào tử + mẫu tháng kéo (không vào mẫu tháng hạn), Renew bị loại', async () => {
  const o9 = textOf(await tool('cs@base.vn', 'cr_summary', { thang: '09/2026' }));
  assert.equal(o9.mauSo_DTPhaiGoLive, 14375000);
  assert.equal(o9.tuSo_DTGoLiveDat, 4375000);
  const o10 = textOf(await tool('cs@base.vn', 'cr_summary', { thang: '10/2026' }));
  assert.equal(o10.mauSo_DTPhaiGoLive, 10000000);
  assert.equal(o10.tuSo_DTGoLiveDat, 0);
});

test('update_deal_inputs chỉ gửi ô được truyền; ngày sai định dạng bị chặn', async () => {
  await tool('cs@base.vn', 'update_deal_inputs', { deal_id: '1', active_t1: 80, go_live: null });
  const [fn, args] = calls.at(-1);
  assert.equal(fn, 'api_patch_deal_input');
  assert.deepEqual(args.p_patch, { goLive: '', aT1: 80 });
  assert.equal((await tool('cs@base.vn', 'update_deal_inputs', { deal_id: '1', go_live: '2026-10-01' })).result.isError, true);
});

test('update_multiyear_inputs giữ ô không truyền', async () => {
  await tool('cs@base.vn', 'update_multiyear_inputs', { deal_id: '1', nam: 2, ky: 'T1', output: 50 });
  const row = calls.at(-1)[1].p_rows[0];
  assert.equal(row.active, 85);
  assert.equal(row.output, 50);
});

test('update_multiyear_inputs: kỳ Năm N đã qua ngày đánh giá (Năm 1 + N−1 năm) thì khoá', async () => {
  const d = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const yearAgo = (s, y) => (Number(s.slice(0, 4)) - y) + s.slice(4);
  ngayDg = yearAgo(d(-2), 1);              // Năm 2 = hôm kia → đã qua → khoá
  let r = await tool('cs@base.vn', 'update_multiyear_inputs', { deal_id: '1', nam: 2, ky: 'T4', output: 50 });
  assert.equal(r.result.isError, true);
  assert.match(r.result.content[0].text, /đã qua ngày đánh giá/);
  assert.equal(calls.at(-1)[0], 'deal_ngay_dg', 'không gọi ghi');
  ngayDg = yearAgo(d(2), 1);               // Năm 2 = ngày kia → còn mở
  r = await tool('cs@base.vn', 'update_multiyear_inputs', { deal_id: '1', nam: 2, ky: 'T4', output: 50 });
  assert.notEqual(r.result.isError, true);
  assert.equal(calls.at(-1)[0], 'api_save_multiyear');
  ngayDg = null;
});

test('admin_add_todo gắn feedback + nguồn claude', async () => {
  await tool('admin@base.vn', 'admin_add_todo', { noi_dung: 'x', feedback_id: 'PF1' });
  const item = calls.at(-1)[1].p_item;
  assert.equal(item.feedbackId, 'PF1');
  assert.equal(item.nguon, 'claude');
});

test('admin_get_feedback trả nội dung dạng MCP content (không nhét lồng JSON)', async () => {
  const r = await tool('admin@base.vn', 'admin_get_feedback', { id: 'PF1' });
  assert.equal(r.result.content[0].type, 'text');
  assert.equal(JSON.parse(r.result.content[0].text).id, 'PF1');
});

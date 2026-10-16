// Nút "Cộng phước" (phuocGet / phuocAdd) + link kết nối Claude dùng domain CS Console.
// Supabase giả — không gọi mạng.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadEdgeFunction, read } from './helpers.mjs';

const calls = [];
const counts = new Map();
const fake = {
  rpc: async (fn, args) => {
    calls.push([fn, args]);
    const total = () => [...counts.values()].reduce((a, b) => a + b, 0);
    if (fn === 'api_phuoc_get') return { data: { mine: counts.get(args.p_email) || 0, total: total() } };
    if (fn === 'api_phuoc_add') {
      counts.set(args.p_email, (counts.get(args.p_email) || 0) + args.p_n);
      return { data: { mine: counts.get(args.p_email), total: total() } };
    }
    if (fn === 'api_mcp_create_key') return { data: { id: 'k1', label: args.p_label } };
    return { data: null };
  },
};
const SECRET = 'test-secret-' + 'x'.repeat(30);

async function token(email = 'cs@base.vn') {
  const b64 = (u8) => Buffer.from(u8).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
  const payload = b64(new TextEncoder().encode(JSON.stringify({ email, exp: 4102444800000 })));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = b64(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))));
  return 'CST1.' + payload + '.' + sig;
}
async function post(api, body, email) {
  const r = await api(new Request('https://p.supabase.co/functions/v1/api', {
    method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ token: await token(email), ...body }),
  }));
  return r.json();
}

test('phuocAdd cộng dồn theo người, phuocGet trả số của mình + tổng team; n bất thường bị chặn', async () => {
  const api = await loadEdgeFunction('api', fake, { SESSION_SECRET: SECRET });
  assert.deepEqual((await post(api, { action: 'phuocGet' })).mine, 0);
  let r = await post(api, { action: 'phuocAdd', n: 3 });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual([r.mine, r.total], [3, 3]);
  r = await post(api, { action: 'phuocAdd', n: 2 }, 'b@base.vn');
  assert.deepEqual([r.mine, r.total], [2, 5]);
  r = await post(api, { action: 'phuocGet' });
  assert.deepEqual([r.mine, r.total], [3, 5]);
  for (const n of [0, -1, 201, 'abc', null]) {
    const bad = await post(api, { action: 'phuocAdd', n });
    assert.equal(bad.ok, false, 'n=' + n);
  }
  assert.equal(counts.get('cs@base.vn'), 3);
});

test('SQL cộng phước không có DELETE/DROP, hàm chỉ cho service_role', () => {
  const sql = read('supabase/05_cong_phuoc.sql');
  assert.doesNotMatch(sql.replace(/--.*$/gm, ''), /\b(delete|drop|truncate)\b/i);
  assert.match(sql, /revoke all on function %s from public, anon, authenticated/);
  assert.match(sql, /enable row level security/);
});

test('mcpCreateKey trả link trên domain CS Console; đổi được qua MCP_PUBLIC_BASE', async () => {
  let api = await loadEdgeFunction('api', fake, { SESSION_SECRET: SECRET });
  let r = await post(api, { action: 'mcpCreateKey', label: 'Laptop' });
  assert.equal(r.ok, true, r.error);
  assert.match(r.url, /^https:\/\/csconsole\.vercel\.app\/mcp\/csk_[\w-]{40,}$/);
  api = await loadEdgeFunction('api', fake, { SESSION_SECRET: SECRET, MCP_PUBLIC_BASE: 'https://x.example/mcp/' });
  r = await post(api, { action: 'mcpCreateKey', label: '' });
  assert.match(r.url, /^https:\/\/x\.example\/mcp\/csk_/);
});

test('vercel.json & netlify.toml chuyển tiếp /mcp/<khoá> sang Edge Function mcp', async () => {
  const v = JSON.parse(read('vercel.json'));
  const rw = v.rewrites.find((x) => x.source === '/mcp/:key');
  assert.equal(rw.destination, 'https://lheaoklvumzapmwuhysr.supabase.co/functions/v1/mcp/:key');
  assert.match(read('config.js'), /lheaoklvumzapmwuhysr\.supabase\.co/, 'cùng project với config.js');
  assert.match(read('netlify.toml'), /from = "\/mcp\/\*"\s+to = "https:\/\/lheaoklvumzapmwuhysr\.supabase\.co\/functions\/v1\/mcp\/:splat"\s+status = 200/);
  // Edge Function mcp lấy khoá ở đoạn ngay sau /mcp/ → đường dẫn sau khi chuyển tiếp vẫn đọc đúng
  const parts = new URL('https://lheaoklvumzapmwuhysr.supabase.co/functions/v1/mcp/csk_abc').pathname.split('/').filter(Boolean);
  assert.equal(parts[parts.indexOf('mcp') + 1], 'csk_abc');
});

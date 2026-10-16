// Tiện ích dùng chung cho test: đọc file trong repo, trích hàm từ app.js / ui.js,
// nạp Edge Function TypeScript với Supabase giả (không gọi mạng).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// Lấy đoạn code từ `startMarker` tới ngay trước `endMarker`
export function slice(src, startMarker, endMarker) {
  const a = src.indexOf(startMarker), b = src.indexOf(endMarker, a + 1);
  if (a < 0 || b < 0) throw new Error('Không tìm thấy đoạn code: ' + startMarker);
  return src.slice(a, b);
}

export function mNorm(d) {
  if (typeof d === 'string' && /^\d{2}\/\d{4}$/.test(d)) return d;
  d = new Date(d);
  return String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
}
export function mCmp(a, b) {
  const p = a.split('/'), q = b.split('/');
  return (p[1] - q[1]) || (p[0] - q[0]);
}

// Nạp supabase/functions/<name>/index.ts: thay createClient bằng `fake`, bắt handler của Deno.serve
export async function loadEdgeFunction(name, fake, env = {}) {
  const require = createRequire(import.meta.url);
  const ts = require('typescript');
  const src = read(`supabase/functions/${name}/index.ts`)
    .replace(/import \{ createClient \} from "npm:@supabase\/supabase-js@[^"]+";/, 'const createClient = globalThis.__fakeCreate;');
  const js = ts.transpileModule(src, { compilerOptions: { target: 'ES2022', module: 'ESNext' } }).outputText;
  let handler;
  globalThis.__fakeCreate = () => fake;
  globalThis.Deno = {
    env: { get: (k) => ({ SUPABASE_URL: 'https://p.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'x', ...env })[k] },
    serve: (h) => { handler = h; },
  };
  await import('data:text/javascript;base64,' + Buffer.from(js + '\n// ' + Math.random()).toString('base64'));
  return handler;
}

export async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

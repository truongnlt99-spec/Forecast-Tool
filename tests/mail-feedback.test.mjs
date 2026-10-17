// Mail báo người gửi khi feedback hoàn thành: guiMailFeedback() trong supabase/apps-script/DongBoSupabase.gs
// (Apps Script, Gmail) + supabase/08_mail_feedback.sql. Chạy file .gs trên Node với MailApp / Supabase giả.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { read } from './helpers.mjs';

function load(pending, opts = {}) {
  const rpc = [], mails = [];
  const ctx = {
    Logger: { log() {} },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'sb_secret_x' }) },
    MailApp: {
      getRemainingDailyQuota: () => opts.quota ?? 100,
      sendEmail: (m) => { if (opts.failTo === m.to) throw new Error('Invalid email'); mails.push(m); },
    },
    UrlFetchApp: {
      fetch: (url, o) => {
        const fn = url.split('/rpc/')[1], args = JSON.parse(o.payload);
        rpc.push([fn, args]);
        const data = fn === 'mail_fb_pending' ? pending : fn === 'mail_fb_mark_sent' ? true : null;
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify(data) };
      },
    },
  };
  vm.createContext(ctx);
  vm.runInContext(read('supabase/apps-script/DongBoSupabase.gs'), ctx);
  return { ctx, rpc, mails };
}

const FB = (id, o = {}) => ({ id, email: id + '@base.vn', name: 'CS ' + id, title: 'Tiêu đề ' + id,
  status: 'Completed', reply: '', submittedAt: '16/10/2026', ...o });

test('guiMailFeedback: chỉ hỏi trạng thái Completed, gửi mail rồi đánh dấu đã gửi đúng trạng thái', () => {
  const { ctx, rpc, mails } = load([FB('a', { reply: 'Đã sửa xong nhé' }), FB('b')]);
  ctx.guiMailFeedback();
  assert.deepEqual(rpc[0], ['mail_fb_pending', { p_statuses: ['Completed'] }]);
  assert.equal(mails.length, 2);
  assert.equal(mails[0].to, 'a@base.vn');
  assert.match(mails[0].subject, /Feedback "Tiêu đề a" — Hoàn thành/);
  assert.match(mails[0].body, /Chào CS a/);
  assert.match(mails[0].body, /Phản hồi từ team:\nĐã sửa xong nhé/);
  assert.doesNotMatch(mails[1].body, /Phản hồi từ team/, 'không có phản hồi thì không in mục đó');
  assert.deepEqual(rpc.filter((r) => r[0] === 'mail_fb_mark_sent').map((r) => r[1]),
    [{ p_id: 'a', p_status: 'Completed' }, { p_id: 'b', p_status: 'Completed' }]);
});

test('guiMailFeedback: mail lỗi thì KHÔNG đánh dấu (lượt sau thử lại), các mail khác vẫn gửi', () => {
  const { ctx, rpc, mails } = load([FB('x'), FB('y')], { failTo: 'x@base.vn' });
  ctx.guiMailFeedback();
  assert.deepEqual(mails.map((m) => m.to), ['y@base.vn']);
  assert.deepEqual(rpc.filter((r) => r[0] === 'mail_fb_mark_sent').map((r) => r[1].p_id), ['y']);
});

test('guiMailFeedback: hết quota mail trong ngày → dừng, không đánh dấu gì', () => {
  const { ctx, rpc, mails } = load([FB('a')], { quota: 0 });
  ctx.guiMailFeedback();
  assert.equal(mails.length, 0);
  assert.equal(rpc.some((r) => r[0] === 'mail_fb_mark_sent'), false);
});

test('SQL 08_mail_feedback: không DELETE/DROP, hàm chỉ cho service_role, đổi trạng thái thì xoá mốc đã gửi', () => {
  const sql = read('supabase/08_mail_feedback.sql');
  assert.doesNotMatch(sql.replace(/--.*$/gm, ''), /\b(delete|drop)\b/i);
  assert.match(sql, /grant execute on function %s to service_role/);
  assert.match(sql, /if new\.status is distinct from old\.status then new\.mail_sent_at := null/);
  assert.match(sql, /update product_feedback set mail_sent_at = now\(\) where status in \('Completed'/,
    'feedback đã hoàn thành trước đó không bị gửi bù mail');
});

test('Mail HTML: có htmlBody, chèn biến cấu hình, escape nội dung người dùng, xuống dòng phản hồi thành <br>', () => {
  const { ctx, mails } = load([FB('h', { name: '<b>An</b>', title: 'A & B <script>', reply: 'Dòng 1\nDòng 2' })]);
  ctx.guiMailFeedback();
  const m = mails[0];
  assert.match(m.htmlBody, /Chào &lt;b&gt;An&lt;\/b&gt;,/);
  assert.match(m.htmlBody, /A &amp; B &lt;script&gt;/);
  assert.doesNotMatch(m.htmlBody, /<script>/);
  assert.match(m.htmlBody, /Dòng 1<br>Dòng 2/);
  assert.match(m.htmlBody, /Hoàn thành/);
  assert.match(m.htmlBody, /href="https:\/\/csconsole\.vercel\.app"/);
  assert.match(m.body, /Chào <b>An<\/b>,/, 'bản chữ thuần giữ nguyên');
});

test('guiMailThu: gửi 1 mail mẫu tới chính người chạy, không gọi Supabase', () => {
  const { ctx, rpc, mails } = load([]);
  ctx.Session = { getActiveUser: () => ({ getEmail: () => 'toi@base.vn' }), getEffectiveUser: () => ({ getEmail: () => '' }) };
  ctx.guiMailThu();
  assert.equal(mails.length, 1);
  assert.equal(mails[0].to, 'toi@base.vn');
  assert.equal(rpc.length, 0);
});

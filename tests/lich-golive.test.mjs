// Lịch go-live: hàm thuần cxGoLiveCal (ui.js, khối ==CX PURE==)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { read, slice } from './helpers.mjs';

const PURE = slice(read('ui.js'), '/* ==CX PURE START==', '/* ==CX PURE END== */');
const cx = new Function(PURE + '\nreturn { cxGoLiveCal };')();

test('cxGoLiveCal: trạng thái, ngày, quá hạn, sắp tới', () => {
  // today = 20/11/2026; tháng xem 11/2026
  const D = (id, o) => ({ id, company: 'Cty ' + id, contract: 'New', dtPhai: o.v || 1, glPlan: o.plan, glExtend: o.ext || null,
    glActual: o.gl || null, glFromCrm: !!o.crm, stopped: !!o.stop });
  const d = (s) => { const [dd, mm, yy] = s.split('/'); return new Date(+yy, +mm - 1, +dd); };
  const deals = [
    D('A', { plan: d('15/11/2026'), gl: d('10/11/2026'), crm: 1 }),           // ontime
    D('B', { plan: d('15/11/2026'), gl: d('18/11/2026'), crm: 1 }),           // late
    D('C', { plan: d('20/11/2026') }),                                         // todo, còn 0 ngày → soon
    D('E', { plan: d('23/11/2026'), v: 5 }),                                   // todo, còn 3 ngày → soon
    D('F', { plan: d('30/11/2026'), gl: d('10/11/2026') }),                    // chỉ ngày CS nhập → todo
    D('G', { plan: d('05/11/2026') }),                                         // overdue
    D('H', { plan: d('25/10/2026') }),                                         // overdue tháng trước
    D('I', { plan: d('02/11/2026'), ext: d('28/11/2026') }),                   // gia hạn → ngày 28, todo
    D('J', { plan: d('10/11/2026'), stop: 1 }),                                // dừng → bỏ
    { ...D('K', { plan: d('10/11/2026') }), contract: 'Renew' },              // không tính CR → bỏ
    D('L', { plan: null }),                                                    // không có hạn → bỏ
  ];
  const r = cx.cxGoLiveCal(deals, '11/2026', d('20/11/2026'));
  assert.deepEqual({ ...r.counts }, { total: 7, ontime: 1, late: 1, todo: 4, overdue: 1 });
  assert.deepEqual(r.days[15].map((x) => x.status), ['ontime', 'late']);
  assert.equal(r.days[28][0].id, 'I');
  assert.equal(r.days[2], undefined);
  assert.deepEqual(r.overdue.map((x) => x.id), ['H', 'G']);
  assert.deepEqual(r.soon.map((x) => [x.id, x.daysLeft]), [['C', 0], ['E', 3]]);
  assert.equal(r.days[30][0].status, 'todo');
  assert.equal(r.dtPhai, 11);
  // tháng trống
  const e = cx.cxGoLiveCal(deals, '02/2027', d('20/11/2026'));
  assert.deepEqual({ ...e.counts }, { total: 0, ontime: 0, late: 0, todo: 0, overdue: 0 });
  assert.deepEqual(Object.keys(e.days), []);
});

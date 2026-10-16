// Quy tắc CR (quyết định 15–16/10/2026) — phải giống nhau ở 3 nơi:
// app.js crIn(), ui.js qCrCompute() và tool cr_summary của MCP.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { read, slice, mNorm, mCmp } from './helpers.mjs';

function loadCrIn() {
  const body = slice(read('app.js'), '  function crIn(', '  var RATING_LABEL');
  const contractCounted = () => true;
  return new Function('mNorm', 'mCmp', 'contractCounted', body + '\nreturn crIn;')(mNorm, mCmp, contractCounted);
}

const D = { crMonth: '10/2026', contract: 'Upsale' };   // tháng hạn = 10/2026
const CASES = [
  // [tháng xem, go-live thực tế, kết quả]
  ['09/2026', '2026-09-30', { dat: true, noDen: true }], // kéo SỚM: chỉ tử số tháng kéo
  ['10/2026', '2026-09-30', null],                       // không vào mẫu số tháng hạn
  ['11/2026', '2026-09-30', null],
  ['08/2026', '2026-09-30', null],
  ['10/2026', '2026-10-05', { dat: true }],              // đúng tháng hạn: tử + mẫu
  ['09/2026', '2026-10-05', null],
  ['08/2026', '2026-12-01', null],                       // trễ: mẫu số dồn tới tháng go-live
  ['10/2026', '2026-12-01', { dat: false }],
  ['11/2026', '2026-12-01', { dat: false }],
  ['12/2026', '2026-12-01', { dat: true }],
  ['01/2027', '2026-12-01', null],
  ['09/2026', null, null],                               // chưa go-live: mẫu số từ tháng hạn
  ['10/2026', null, { dat: false }],
  ['11/2026', null, { dat: false }],
];

test('app.js crIn — đủ các trường hợp sớm / đúng hạn / trễ / chưa go-live', () => {
  const crIn = loadCrIn();
  for (const [m, gl, exp] of CASES) assert.deepEqual(crIn(D, m, gl), exp, `tháng ${m}, go-live ${gl}`);
});

test('app.js crIn — loại HĐ không tính CR thì luôn null', () => {
  const body = slice(read('app.js'), '  function crIn(', '  var RATING_LABEL');
  const crIn = new Function('mNorm', 'mCmp', 'contractCounted', body + '\nreturn crIn;')(mNorm, mCmp, () => false);
  assert.equal(crIn(D, '10/2026', null), null);
});

test('app.js contractCounted — Renew thuần không tính, Renew triển khai lại có tính', () => {
  const src = read('app.js');
  const body = slice(src, '  function contractCounted(', '  function contractBonus(');
  const f = new Function(body + '\nreturn contractCounted;')();
  for (const c of ['New', 'Upsale', 'Cross sale', 'Expansion CSM', 'Renew CSM', 'Renew triển khai lại']) assert.equal(f(c), true, c);
  for (const c of ['Renew', '', '—']) assert.equal(f(c), false, c);
});

test('ui.js qCrCompute — cùng quy tắc với app.js (kể cả deal gia hạn)', () => {
  const body = slice(read('ui.js'), '    function qContractCounted(', '    function qCrAdjust(');
  const qList = [
    { id: 1, contract: 'Upsale', crMonth: '10/2026', glActual: new Date('2026-09-30'), dtPhai: 4375000 }, // kéo sớm
    { id: 2, contract: 'New', crMonth: '09/2026', glActual: null, dtPhai: 10000000 },                    // chưa go-live
    { id: 3, contract: 'New', crMonth: '10/2026', glActual: new Date('2026-10-05'), dtPhai: 2000000 },    // đúng hạn
    { id: 4, contract: 'New', crMonth: '08/2026', glExtend: new Date('2026-10-20'),
      glActual: new Date('2026-09-15'), dtPhai: 1000000 },                                                // gia hạn, kéo sớm
    { id: 5, contract: 'Renew', crMonth: '09/2026', glActual: null, dtPhai: 9e9 },                       // không tính
  ];
  const fn = new Function('qList', 'qMNorm', 'document', body + '\nreturn qCrCompute;')(
    qList, mNorm, { getElementById: () => null });
  assert.deepEqual(fn('09/2026'), { phai: 10000000, dat: 5375000, touched: true });
  assert.deepEqual(fn('10/2026'), { phai: 12000000, dat: 2000000, touched: true });
});

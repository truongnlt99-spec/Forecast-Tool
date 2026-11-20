# Lịch go-live (Forecast) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Màn "Lịch go-live" ở Forecast: lịch tháng đặt deal vào ngày hạn, tô màu đã kéo / kéo muộn / chưa kéo / quá hạn, khung cảnh báo quá hạn, banner nhắc ≤ 3 ngày.

**Architecture:** Toàn bộ ở `ui.js` mục TRỢ LÝ CS, dùng `st.deals` sẵn có. Một hàm thuần `cxGoLiveCal()` trong khối `==CX PURE START/END==` tính mọi số liệu (test trên Node); phần giao diện chỉ vẽ kết quả. Màn mới mở/đóng theo đúng cơ chế màn "Lịch đánh giá" (`showCal`/`hideCal`), tổng quát hoá thành 2 màn.

**Tech Stack:** JS thuần (ES5 như ui.js), CSS trong style.css, test `node:test` + Playwright (đã có trong tests/).

**Spec:** `docs/superpowers/specs/2026-11-20-lich-golive-design.md`

## Global Constraints

- Không sửa `app.js`, không đổi database / Edge Function. Chỉ đọc, không ghi gì về máy chủ.
- Ngày hạn = ngày gia hạn (`glExtend`), không có thì ngày go-live dự kiến (`glPlan`) — dùng `cxDeadline(d)` có sẵn.
- "Đã kéo" chỉ khi `glFromCrm` (Nguồn go-live = "Đã kéo"); ngày CS tự nhập không tính. So theo ngày bằng `cxDay()`.
- Chỉ deal tính CR: `!d.stopped && cxContractCounted(d.contract)` và có ngày hạn.
- "Hôm nay" = `vnToday()` (giờ VN). Ngày hiển thị dd/mm/yyyy (`fmtDate`).
- Chữ hiển thị tiếng Việt, đúng nhãn: "Lịch go-live"; 🟢 "Kéo đúng hạn", 🟠 "Kéo muộn", ⚪ "Chưa kéo · còn N ngày", 🔴 "Quá hạn chưa kéo".
- Bump `?v=` của `ui.js` và `style.css` trong `index.html`.

## Review Focus

- Deal không có cả ngày dự kiến lẫn gia hạn → không hiện, không làm lỗi lưới.
- Deal chỉ có ngày CS nhập (không "Đã kéo") → ⚪/🔴, không phải 🟢.
- Deal có gia hạn → nằm ở ngày gia hạn, không ở ngày dự kiến.
- Hạn đúng hôm nay chưa kéo → ⚪ "còn 0 ngày" (chưa quá hạn), có trong banner.
- Tháng không có deal → lưới vẫn vẽ đủ ngày + dòng "Không có deal nào có hạn trong tháng này."

---

### Task 1: Hàm thuần `cxGoLiveCal`

**Files:**
- Modify: `ui.js` — khối `==CX PURE START== … ==CX PURE END==` (sau `cxCrSum`)
- Test: `tests/lich-golive.test.mjs` (mới; nạp khối PURE như `tests/tro-ly-cs.test.mjs` dòng 14–15)

**Interfaces:**
- Consumes: `cxDeadline(d)`, `cxDay(dt)`, `cxMNorm(v)`, `cxContractCounted(c)` (đã có trong khối PURE).
- Produces: `cxGoLiveCal(deals, month, today)` →
  `{ days: { [ngày 1–31]: Item[] }, overdue: Item[], soon: Item[], counts: { total, ontime, late, todo, overdue }, dtPhai: number }`
  với `Item = { id, company, sysId, dtPhai, deadline: Date, keo: Date|null, status: 'ontime'|'late'|'todo'|'overdue', daysLeft: number }`.
  - `days`, `counts`, `dtPhai`: chỉ deal có hạn trong `month` ("MM/YYYY"); mỗi ngày xếp theo `dtPhai` giảm dần.
  - `overdue`: MỌI deal `status === 'overdue'` (mọi tháng), hạn cũ nhất trước.
  - `soon`: MỌI deal `status === 'todo'` có `daysLeft <= 3`, hạn gần nhất trước.
  - `daysLeft = (cxDay-ngày hạn − hôm nay) tính bằng ngày`, âm khi quá hạn.

- [ ] **Step 1: Viết test `tests/lich-golive.test.mjs`**

```js
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
```

- [ ] **Step 2: Chạy, xác nhận FAIL**

Run: `cd tests && node --test lich-golive.test.mjs`
Expected: FAIL — `cx.cxGoLiveCal is not a function`

- [ ] **Step 3: Viết `cxGoLiveCal(deals, month, today)` trong khối PURE ui.js** (đúng Interfaces ở trên).

- [ ] **Step 4: Chạy lại, xác nhận PASS**

Run: `cd tests && node --test lich-golive.test.mjs tro-ly-cs.test.mjs`
Expected: PASS, không test cũ nào hỏng.

- [ ] **Step 5: Commit** — `feat(lich-golive): hàm tính lịch go-live theo hạn kéo`

---

### Task 2: Màn "Lịch go-live" (nút, lưới tháng, khung quá hạn, bấm tới deal)

**Files:**
- Modify: `index.html` — thêm `<button type="button" class="cx-gl-btn">Lịch go-live<span class="cx-gl-count" hidden></span></button>` ngay sau mỗi nút `.cx-cal-btn` (2 chỗ, dòng ~202 và ~210); thêm `<div id="cxGlBlock" style="display:none;"></div>` ngay sau `#cxCalBlock` (dòng ~641).
- Modify: `ui.js` mục TRỢ LÝ CS (khoảng `calBlock` … `goToDeal`, dòng ~4337–4460)
- Modify: `style.css` — class `.cx-gl-*` (nút dùng chung style `.cx-cal-btn`: thêm `.cx-gl-btn` vào cùng selector)
- Test: `tests/tro-ly-cs.test.mjs` — 1 test UI mới cạnh test "UI: Lịch đánh giá" (dòng ~326), dùng cùng harness

**Interfaces:**
- Consumes: `cxGoLiveCal` (Task 1), `goToDeal(id, 1)`, `st.deals`, `fmtDate`, `tr`, `esc`, `vnToday`, `curMonth`.
- Produces: `showGl()` / `hideGl()`; `st.glMonth` (tháng đang xem); nút `.cx-gl-btn` có class `active` khi mở; badge `.cx-gl-count` = số deal quá hạn chưa kéo (`r.overdue.length`, ẩn khi 0).

- [ ] **Step 1: Viết test UI** `UI: Lịch go-live — lưới tháng, màu trạng thái, khung quá hạn, bấm deal tới dòng Forecast` (skip khi chưa cài Playwright, như các test UI khác). Dữ liệu mẫu thêm vào DEALS của harness: 1 deal hạn tháng hiện tại đã kéo đúng hạn, 1 deal quá hạn tháng trước chưa kéo. Assert:
  - bấm `.cx-gl-btn` → `#cxGlBlock` hiện, `.cx-gl-btn.active`, `#cxCalBlock` ẩn;
  - `#cxGlBlock .cx-gl-day .cx-gl-deal.cx-gl-ontime` có tên deal đã kéo;
  - `#cxGlBlock .cx-gl-overdue` chứa tên deal quá hạn;
  - `.cx-gl-count` hiện số `1`;
  - bấm deal quá hạn → `#cxGlBlock` ẩn và `#fc-row-<id>` có class `fc-flash`.
- [ ] **Step 2: Chạy, xác nhận FAIL** — `cd tests && node --test tro-ly-cs.test.mjs` (máy có Playwright; không có thì test bị skip — ghi rõ khi báo cáo).
- [ ] **Step 3: Tổng quát hoá cơ chế mở/đóng:** `calLayout/showCal/hideCal` thành dùng chung cho 2 màn (`cal`, `gl`): mở một màn thì ẩn màn kia + các block Forecast + dải KPI, đặt `active` đúng nút; nút Năm 1 / Năm 2++ / Request / `hashchange` đóng cả hai. Hành vi màn Lịch đánh giá giữ nguyên.
- [ ] **Step 4: `renderGl()`** vẽ vào `#cxGlBlock` (`.fc-block-body > .table-card` như Lịch đánh giá):
  - tiêu đề "Lịch go-live · tháng MM/YYYY", nút ‹ › đổi `st.glMonth` (mặc định = tháng đang chọn ở `#fcFilterMonth`, không có thì `curMonth()`);
  - khung `.cx-gl-overdue` (chỉ khi `overdue.length`): "⚠ Quá hạn chưa kéo (N)" + từng deal "Tên · hạn dd/mm/yyyy · trễ N ngày", bấm được;
  - dòng tổng `.cx-gl-sum`: "Tổng N deal · DT x tr · 🟢 … · 🟠 … · ⚪ … · 🔴 …";
  - lưới `.cx-gl-grid` 7 cột T2→CN, ô `.cx-gl-day` có số ngày; ô hôm nay thêm `.cx-gl-today`; mỗi deal là `button.cx-gl-deal.cx-gl-<status>` `data-id`, chữ = tên công ty, `title` = "Tên · hạn … · trạng thái"; ô > 3 deal hiện 3 + "+N";
  - màn hẹp (`matchMedia('(max-width: 640px)')`): thay lưới bằng danh sách theo ngày (chỉ ngày có deal);
  - tháng trống: "Không có deal nào có hạn trong tháng này.";
  - bấm deal (lưới, danh sách, khung quá hạn) → `goToDeal(id, 1)`.
- [ ] **Step 5: Gọi `renderGl()` khi đang mở trong `refreshAll()`; cập nhật badge `.cx-gl-count` mỗi lần `refreshAll()`.**
- [ ] **Step 6: CSS** cho `.cx-gl-*` (màu theo 4 trạng thái, ô ngày, ô hôm nay, khung quá hạn) theo biến màu sẵn có trong style.css.
- [ ] **Step 7: Chạy** `cd tests && npm test` — Expected: PASS (UI test skip nếu thiếu Playwright).
- [ ] **Step 8: Commit** — `feat(lich-golive): màn lịch go-live ở Forecast`

---

### Task 3: Banner nhắc ≤ 3 ngày + tài liệu + phiên bản

**Files:**
- Modify: `ui.js` (cạnh `renderReminders`), `index.html` (`?v=`), `CLAUDE.md` mục 9
- Test: `tests/tro-ly-cs.test.mjs` (mở rộng test UI của Task 2)

**Interfaces:**
- Consumes: `cxGoLiveCal(...).soon`, `showGl()`.
- Produces: banner `.cx-remind.cx-remind-gl` ở đầu `#panel-forecast > .tab-panel-body`.

- [ ] **Step 1: Thêm assert vào test UI Task 2:** dữ liệu có 1 deal hạn hôm nay chưa kéo → `#panel-forecast .cx-remind-gl` hiện chữ "1 deal sắp tới hạn kéo"; bấm "Xem lịch" → `#cxGlBlock` hiện; bấm ✕ → banner biến mất.
- [ ] **Step 2: Chạy, xác nhận FAIL.**
- [ ] **Step 3: `renderGlReminder()`** gọi trong `refreshAll()`: khi `soon.length > 0` hiện banner "⏰ **N deal sắp tới hạn kéo** đánh giá trong 3 ngày tới — gần nhất: Tên (hạn dd/mm/yyyy, còn N ngày)." + nút "Xem lịch" (mở `showGl()` ở tháng của deal gần nhất) + ✕ ẩn tới mai (localStorage `cs_tool_cx_gl_hide` = `dd/mm/yyyy|N`, bọc try/catch như `LS_REMIND`). Chỉ ở Forecast.
- [ ] **Step 4: Chạy** `cd tests && npm test` — Expected: PASS.
- [ ] **Step 5:** `index.html` bump `ui.js?v=` và `style.css?v=` (+1). CLAUDE.md mục 9 thêm 1 dòng: "Lịch go-live (Forecast): deal theo ngày hạn, màu theo quy tắc CR mục 14, hàm `cxGoLiveCal()` (khối CX PURE), banner nhắc ≤ 3 ngày."
- [ ] **Step 6: Commit** — `feat(lich-golive): banner nhắc deal sắp tới hạn kéo`

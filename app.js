(function () {
  'use strict';

  var CFG = window.CS_TOOL_CONFIG;
  var SESSION_KEY = 'cs_tool_session';

  // ---------- DOM ----------
  var $ = function (id) { return document.getElementById(id); };
  var tabNav = $('tabNav');
  var userEmail = $('userEmail');
  var logoutBtn = $('logoutBtn');
  var refreshBtn = $('refreshBtn');

  var panels = {
    overview: $('panel-overview'),
    forecast: $('panel-forecast'),
    dashboard: $('panel-dashboard'),
  };

  // ---------- State ----------
  var allDeals = [];   // normalized deals
  var openDealId = null;
  var sortDesc = true;
  var profile = null;        // {username, email, hoTen, level, salary} từ sheet "Danh sách CS"
  var profileKnown = false;  // backend đã trả về field profile hay chưa (tương thích backend cũ)
  var currentEmail = '';

  // =========================================================
  // POLICY ENGINE — trích từ "[CS MEMBERS VERSION] CS POLICY Ver.01 (01/07/2026)"
  // Mục 6.1/6.2: mốc Performance | Mục 6.3: % Commission T1/T4 | Mục 6.5: thưởng Upsale/Cross
  // =========================================================
  var LEVELS = {
    'CS_A level 1': { group: 'CSA', title: 'Solution Associate', salary: [9000000, 9000000],
      rev: { kpi: 100e6, goal: 150e6, out: 180e6 },
      comT1: { under: null, kpi: 1.5, goal: 2,   out: 2.3 }, comT4: null },
    'CS_A level 2': { group: 'CSA', title: 'Solution Associate', salary: [11000000, 11000000],
      rev: { kpi: 150e6, goal: 180e6, out: 220e6 },
      comT1: { under: null, kpi: 1.5, goal: 2,   out: 2.3 }, comT4: null },
    'CS level 1': { group: 'CS', title: 'Solution Representative', salary: [10000000, 13000000],
      perf: { kpi: { cr: 75, s1: 78, s4: 75 }, goal: { cr: 77, s1: 80, s4: 77 }, out: { cr: 80, s1: 83, s4: 80, rev: 150e6 } },
      comT1: { under: 1, kpi: 1.5, goal: 2,   out: 2.3 }, comT4: { under: 0.5, kpi: 1.5, goal: 1.8, out: 2 } },
    'CS level 2': { group: 'CS', title: 'Solution Representative', salary: [11000000, 14000000],
      perf: { kpi: { cr: 75, s1: 78, s4: 76 }, goal: { cr: 77, s1: 80, s4: 78 }, out: { cr: 80, s1: 83, s4: 81, rev: 200e6 } },
      comT1: { under: 1, kpi: 1.8, goal: 2.3, out: 2.6 }, comT4: { under: 0.5, kpi: 1.8, goal: 2.1, out: 2.3 } },
    'CS level 3': { group: 'CS', title: 'Solution Representative', salary: [12000000, 15000000],
      perf: { kpi: { cr: 78, s1: 80, s4: 78 }, goal: { cr: 80, s1: 82, s4: 80 }, out: { cr: 83, s1: 85, s4: 83, rev: 300e6 } },
      comT1: { under: 1, kpi: 2.1, goal: 2.6, out: 2.9 }, comT4: { under: 0.5, kpi: 2.1, goal: 2.4, out: 2.6 } },
    'CS level 4': { group: 'CS', title: 'Solution Representative', salary: [13000000, 17000000],
      perf: { kpi: { cr: 78, s1: 80, s4: 79 }, goal: { cr: 80, s1: 82, s4: 81 }, out: { cr: 83, s1: 85, s4: 84, rev: 350e6 } },
      comT1: { under: 1, kpi: 2.4, goal: 2.9, out: 3.2 }, comT4: { under: 0.5, kpi: 2.4, goal: 2.7, out: 2.9 } },
    'CS level 5': { group: 'CS', title: 'Solution Specialist', salary: [15000000, 20000000],
      perf: { kpi: { cr: 81, s1: 82, s4: 81 }, goal: { cr: 83, s1: 84, s4: 83 }, out: { cr: 86, s1: 87, s4: 86, rev: 400e6 } },
      comT1: { under: 1, kpi: 2.7, goal: 3.2, out: 3.5 }, comT4: { under: 0.5, kpi: 2.7, goal: 3,   out: 3.2 } },
    'CS level 6': { group: 'CS', title: 'Solution Specialist', salary: [20000000, 25000000],
      perf: { kpi: { cr: 85, s1: 85, s4: 83 }, goal: { cr: 87, s1: 87, s4: 85 }, out: { cr: 90, s1: 90, s4: 88, rev: 500e6 } },
      comT1: { under: 1, kpi: 3,   goal: 3.5, out: 3.8 }, comT4: { under: 0.5, kpi: 3,   goal: 3.3, out: 3.5 } },
    // Lưu ý: bảng com 4 tháng của CS level 7 trong policy đang ghi giống hệt level 6
    // (3% / 3.3% / 3.5%) — tool giữ ĐÚNG theo văn bản; nếu công ty đính chính thì sửa dòng dưới.
    'CS level 7': { group: 'CS', title: 'Solution Specialist', salary: [25000000, 35000000],
      perf: { kpi: { cr: 87, s1: 85, s4: 85 }, goal: { cr: 89, s1: 87, s4: 87 }, out: { cr: 92, s1: 90, s4: 90, rev: 600e6 } },
      comT1: { under: 1, kpi: 3.3, goal: 3.8, out: 4.1 }, comT4: { under: 0.5, kpi: 3,   goal: 3.3, out: 3.5 } },
  };
  var LEVEL_ORDER = ['CS_A level 1', 'CS_A level 2', 'CS level 1', 'CS level 2', 'CS level 3', 'CS level 4', 'CS level 5', 'CS level 6', 'CS level 7'];
  // Mục 6.5 — thưởng Upsale/Cross sale theo tổng DT phần mềm ghi nhận trong tháng
  function upsaleBonusPct(base) {
    if (!base || base <= 0) return 0;
    if (base < 50e6) return 2;
    if (base < 100e6) return 3;
    if (base < 150e6) return 4;
    return 5;
  }
  var RATING_LABEL = { out: 'OUT — Xuất sắc', goal: 'GOAL — Giỏi', kpi: 'KPI — Đạt', under: 'UNDER KPI', none: 'Không xếp loại' };
  var CHART_COLORS = ['#4C6FFF', '#7C5CFC', '#22A06B', '#E39230', '#D93B3B', '#147D6F', '#4C8C2B', '#C97A0E'];

  // Staleness tracking — quyết định khi nào tự âm thầm tải lại dữ liệu khi chuyển tab
  var STALE_MS = 5 * 60 * 1000; // 5 phút
  var lastFetchOverview = 0;
  var lastFetchForecast = 0;

  // =========================================================
  // TOAST — thay cho alert() bị chặn/khó nhìn thấy, và để mọi
  // lỗi (kể cả lỗi JS không lường trước) đều hiện ra cho người dùng thấy
  // thay vì im lặng biến mất.
  // =========================================================
  var toastTimer = null;
  function showToast(msg, type, ms) {
    var el = $('toast');
    if (!el) { console.warn('[toast]', msg); return; }
    el.textContent = msg;
    el.className = 'toast show' + (type ? ' ' + type : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = 'toast'; }, ms || 5000);
  }

  // Bắt mọi lỗi JS / promise rejection không lường trước — đảm bảo
  // không có trường hợp nào "tải im lặng, hỏng im lặng, không báo gì" nữa.
  window.addEventListener('error', function (e) {
    var msg = (e.error && e.error.message) ? e.error.message : e.message;
    console.error('Uncaught error:', e.error || e.message);
    showToast('Có lỗi xảy ra: ' + msg, 'err', 7000);
  });
  window.addEventListener('unhandledrejection', function (e) {
    var msg = (e.reason && e.reason.message) ? e.reason.message : String(e.reason);
    console.error('Unhandled promise rejection:', e.reason);
    showToast('Có lỗi xảy ra: ' + msg, 'err', 7000);
  });

  // =========================================================
  // ROUTER — điều hướng bằng hash (#/overview, #/forecast…).
  //
  // Vì tool host trên GitHub Pages (hosting tĩnh, không có server định tuyến),
  // BẮT BUỘC phải dùng hash chứ không dùng path thật: nếu để URL kiểu
  // /Forecast-Tool/forecast thì bấm F5 GitHub sẽ trả lỗi 404 vì trên server
  // làm gì có thư mục tên "forecast" — hỏng đúng cái việc F5 mà ta đang muốn sửa.
  // Hash (#/forecast) nằm sau dấu #, trình duyệt không gửi lên server nên F5
  // luôn nạp đúng index.html rồi tự khôi phục tab — chạy ngon trên GitHub Pages.
  // =========================================================
  var ROUTE_OF_TAB = { overview: 'overview', forecast: 'forecast', dashboard: 'scorecard' };
  var TAB_OF_ROUTE = { overview: 'overview', forecast: 'forecast', scorecard: 'dashboard' };
  var currentTab = 'overview';

  function parseHash() {
    var h = String(location.hash || '').replace(/^#\/?/, '').replace(/\/+$/, '');
    var parts = h.split('/').filter(Boolean);
    return { root: (parts[0] || '').toLowerCase(), sub: (parts[1] || '').toLowerCase() };
  }

  // replace=true → thay URL tại chỗ, KHÔNG tạo thêm 1 bước trong lịch sử trình duyệt
  // (dùng cho các chuyển màn hình tự động như login/register, để nút Back không bị kẹt).
  function setRoute(path, replace) {
    var target = '#/' + path;
    if (location.hash === target) return; // đã đúng rồi thì thôi, tránh lặp vô hạn
    if (replace && history.replaceState) history.replaceState(null, '', target);
    else location.hash = target;
  }

  function routeForTab(tab) {
    if (tab === 'forecast') return (fcView === 'multi') ? 'forecast/multi-year' : 'forecast';
    return ROUTE_OF_TAB[tab] || 'overview';
  }

  // Áp URL hiện tại lên giao diện (dùng khi mới vào app & khi bấm Back/Forward)
  function applyRoute() {
    if (document.body.className !== 'app-mode') return; // chưa vào app thì chưa điều hướng tab
    var r = parseHash();
    var tab = TAB_OF_ROUTE[r.root];
    if (!tab) { switchTab('overview'); return; }
    if (currentTab !== tab) switchTab(tab, true);
    if (tab === 'forecast') {
      var wantView = (r.sub === 'multi-year') ? 'multi' : 'y1';
      if (fcView !== wantView) fcSetView(wantView, true);
    }
  }

  window.addEventListener('hashchange', applyRoute);

  // =========================================================
  // UI MODE (boot / login / reg / app)
  // =========================================================
  function setUiMode(mode) {
    // mode: 'boot' | 'login' | 'reg' | 'app'
    document.body.className = mode + '-mode';
    if (mode === 'login') setRoute('login', true);
    if (mode === 'reg') setRoute('register', true);
  }

  function showApp(email) {
    userEmail.textContent = email;
    // Chỉ chuyển màn hình ở lần vào app thực sự đầu tiên. Nếu đây là một lần tải
    // nền (silent refresh khi token hết hạn, hoặc auto-refresh khi dữ liệu cũ)
    // thì user đang ở tab nào cứ để yên tab đó, đừng nhảy tab.
    if (document.body.className !== 'app-mode') {
      setUiMode('app');
      // Khôi phục đúng tab theo URL — đây là thứ khiến F5 không còn "mất chỗ":
      // đang ở #/forecast thì F5 xong vẫn ở Forecast, không bị quăng về Overview.
      var r = parseHash();
      if (TAB_OF_ROUTE[r.root]) applyRoute();
      else switchTab('overview');
    }
  }

  function logout() {
    try { google.accounts.id.disableAutoSelect(); } catch (e) {}
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem('cs_tool_token');
    silentReauthInProgress = false;
    lastFetchOverview = 0; lastFetchForecast = 0;
    profile = null; profileKnown = false; currentEmail = '';
    setUiMode('login');
  }

  // Ngay khi trang vừa nạp: nếu đã có phiên đăng nhập lưu sẵn thì hiện màn
  // "đang khôi phục phiên" thay vì màn đăng nhập.
  //
  // ĐÂY MỚI LÀ NGUYÊN NHÂN THẬT của việc "F5 là ra lại màn đăng nhập": file
  // index.html mở đầu bằng <body class="login-mode">, nên mỗi lần F5 màn đăng
  // nhập hiện ra NGAY LẬP TỨC và đứng đó suốt thời gian chờ Apps Script trả dữ
  // liệu (Apps Script "ngủ" lâu không dùng có thể mất vài giây mới tỉnh) — dù
  // token vẫn còn hạn và chỉ vài giây sau là vào thẳng app.
  if (localStorage.getItem('cs_tool_token')) setUiMode('boot');

  function showBootError(msg) {
    if (document.body.className !== 'boot-mode') return;
    var box = $('bootErr');
    if (box) { box.style.display = 'block'; box.textContent = msg; }
    var btn = $('bootRetry');
    if (btn) btn.style.display = 'inline-block';
  }

  // =========================================================
  // REGISTRATION — lần đầu đăng nhập phải khai Họ tên / Level / Salary,
  // lưu về sheet "Danh sách CS" để tính lương & performance các tháng sau.
  // =========================================================
  function profileComplete(p) {
    return !!(p && String(p.hoTen || '').trim() && String(p.level || '').trim());
  }

  var regBuilt = false;
  function buildRegForm() {
    if (regBuilt) return;
    regBuilt = true;
    var sel = $('regLevel');
    LEVEL_ORDER.forEach(function (lv) {
      var o = document.createElement('option');
      o.value = lv;
      o.textContent = lv + ' — ' + LEVELS[lv].title;
      sel.appendChild(o);
    });
    sel.addEventListener('change', regOnLevelChange);
    $('regSubmit').addEventListener('click', regSubmit);
  }

  function regOnLevelChange() {
    var lv = $('regLevel').value;
    var sal = $('regSalary'), hint = $('regSalaryHint'), lvHint = $('regLevelHint');
    if (!lv) {
      sal.value = ''; sal.disabled = true; sal.placeholder = 'Chọn level trước';
      hint.textContent = ''; lvHint.textContent = '';
      return;
    }
    var def = LEVELS[lv], lo = def.salary[0], hi = def.salary[1];
    lvHint.textContent = def.title + (def.group === 'CSA' ? ' · vai trò CS_A' : ' · vai trò CS_PM/CS_A theo sizing');
    if (lo === hi) {
      sal.value = lo; sal.disabled = true;
      hint.textContent = 'Mức cố định theo policy: ' + fmtMoney(lo);
    } else {
      sal.disabled = false;
      sal.min = lo; sal.max = hi;
      if (!sal.value || +sal.value < lo || +sal.value > hi) sal.value = lo;
      sal.placeholder = lo + ' – ' + hi;
      hint.textContent = 'Khung theo policy: ' + fmtMoney(lo) + ' – ' + fmtMoney(hi) + ' (nhập đúng mức của bạn)';
    }
    $('regErr').textContent = '';
  }

  function showRegistration(email) {
    buildRegForm();
    $('regEmail').textContent = email || '';
    if (profile && profile.hoTen) $('regName').value = profile.hoTen;
    setUiMode('reg');
  }

  function regSubmit() {
    var hoTen = $('regName').value.trim();
    var level = $('regLevel').value;
    var salary = parseMoney($('regSalary').value);
    var err = $('regErr');
    if (!hoTen) { err.textContent = 'Vui lòng nhập Họ và tên.'; return; }
    if (!level) { err.textContent = 'Vui lòng chọn Level.'; return; }
    var def = LEVELS[level];
    if (salary == null || salary < def.salary[0] || salary > def.salary[1]) {
      err.textContent = 'Salary phải nằm trong khung ' + fmtMoney(def.salary[0]) + ' – ' + fmtMoney(def.salary[1]) + '.';
      return;
    }
    err.textContent = '';
    var btn = $('regSubmit'), sp = $('regSpinner'), tx = $('regBtnText');
    btn.setAttribute('disabled', ''); sp.classList.remove('hidden'); tx.textContent = 'Đang lưu…';

    var token = localStorage.getItem('cs_tool_token');
    fetch(CFG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ token: token, action: 'register', hoTen: hoTen, level: level, salary: salary }),
    })
      .then(function (r) { return r.text(); })
      .then(function (text) { return JSON.parse(text); })
      .then(function (d) {
        saveSessionToken_(d);
        btn.removeAttribute('disabled'); sp.classList.add('hidden'); tx.textContent = 'Lưu & vào hệ thống';
        if (!d.ok) { err.textContent = 'Lưu không thành công: ' + (d.error || 'lỗi không rõ'); return; }
        profile = d.profile || { email: currentEmail, hoTen: hoTen, level: level, salary: salary };
        showToast('Đã lưu thông tin vào sheet Danh sách CS ✓', 'ok');
        showApp(currentEmail);
        setDefaultDateRange();
        renderOverview();
      })
      .catch(function (e2) {
        btn.removeAttribute('disabled'); sp.classList.add('hidden'); tx.textContent = 'Lưu & vào hệ thống';
        err.textContent = 'Không kết nối được: ' + e2.message;
      });
  }

  // =========================================================
  // CROSS-TAB NAVIGATION — bấm 1 deal ở Overview/Scorecard →
  // nhảy sang Forecast, tự lọc đúng deal đó để sửa ngay.
  // =========================================================
  function goToForecastDeal(id, name) {
    fcFocusId = id; fcFocusName = name || '';
    // Bảng deal chi tiết nằm ở sub-tab "Năm 1"; nếu đang mở "ACR nhiều năm" thì
    // phải chuyển về, không thì bấm vào deal xong chẳng thấy dòng nào cả.
    if (fcView !== 'y1') fcSetView('y1', true);
    switchTab('forecast');
    var afterReady = function () {
      fcInitFilterMonth(); fcRenderChips(); fcRenderKpis(); fcRenderTable();
      var row = $('fc-row-' + id);
      if (row) {
        if (typeof row.scrollIntoView === 'function') row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        row.classList.add('fc-flash');
        setTimeout(function () { row.classList.remove('fc-flash'); }, 2200);
      }
    };
    if (!fcLoaded) fcLoad(false, afterReady);
    else afterReady();
  }
// =========================================================
// SESSION TOKEN — backend v4 cấp kèm 1 "vé" riêng (CST1...) sống 30 ngày mỗi
// lần gọi API thành công, KHÔNG phụ thuộc id_token của Google (chỉ sống ~1h).
// Cứ nhận được là ghi đè localStorage ngay để lần sau dùng vé mới nhất.
// =========================================================
function saveSessionToken_(data) {
  if (data && data.sessionToken) localStorage.setItem('cs_tool_token', data.sessionToken);
}

function loadDeals(token, silentRetryOnFail, isBackgroundRefresh) {
    fetch(CFG.API_URL + '?token=' + encodeURIComponent(token))
      .then(function (r) { return r.text(); })
      .then(function (text) { return JSON.parse(text); })
      .then(function (data) {
        saveSessionToken_(data);
        if (!data.ok) {
          // QUAN TRỌNG: trước đây hễ thấy {ok:false} là xoá token đang hợp lệ + bắt
          // đăng nhập lại — dù lỗi có thể chỉ là Apps Script tạm trục trặc (cold
          // start, sheet đang khoá, quota…), chẳng liên quan gì đến việc đã đăng
          // nhập hay chưa. Đây là nguyên nhân gây bug "cứ reload/hard-refresh là bị
          // bắt đăng nhập lại" dù token còn hạn: chỉ MỘT lần backend trục trặc thoáng
          // qua cũng đủ làm mất phiên đang hợp lệ. Nay chỉ xoá token & bắt đăng nhập
          // lại khi backend xác nhận rõ ràng token không hợp lệ/hết hạn
          // (error === 'invalid_token'); các lỗi khác chỉ báo lỗi, giữ nguyên phiên.
          if (data.error !== 'invalid_token') {
            showToast('Không tải được dữ liệu: ' + (data.error || 'lỗi không rõ') + ' — thử bấm "Làm mới".', 'err', 8000);
            showBootError('Không tải được dữ liệu: ' + (data.error || 'lỗi không rõ'));
            if (!isBackgroundRefresh) resetGoogleButton();
            return;
          }
          localStorage.removeItem('cs_tool_token');
          localStorage.removeItem(SESSION_KEY);
          if (silentRetryOnFail) {
            // Token cũ hết hạn — thử âm thầm lấy token mới từ Google trước,
            // chỉ bắt bấm nút "Continue with Google" nếu việc này cũng không được
            // (tránh tình trạng "treo im", không tải được gì mà cũng không báo gì).
            silentReauthInProgress = true;
            trySilentSignIn(function () {
              silentReauthInProgress = false;
              showToast('Phiên đăng nhập đã hết hạn, mời đăng nhập lại.', 'err');
              resetGoogleButton();
              setUiMode('login');
            });
            return;
          }
          showToast('Phiên đăng nhập đã hết hạn, mời đăng nhập lại.', 'err');
          resetGoogleButton();
          setUiMode('login');
          return;
        }
        allDeals = (data.deals || []).map(normalizeDeal);
        lastFetchOverview = Date.now();
        currentEmail = data.email || '';
        // Backend mới trả về profile (từ sheet "Danh sách CS"). Nếu chưa đăng ký
        // (thiếu Họ tên / Level) → bắt buộc đăng ký trước khi vào app.
        if (data.profile !== undefined) {
          profileKnown = true;
          profile = data.profile || null;
          if (!profileComplete(profile)) {
            showRegistration(currentEmail);
            return;
          }
        }
        showApp(data.email);
        if (!isBackgroundRefresh) setDefaultDateRange();
        renderOverview();
      })
      .catch(function (err) {
        showToast('Không kết nối được tới dữ liệu: ' + err.message, 'err');
        showBootError('Không kết nối được tới dữ liệu: ' + err.message);
        if (!isBackgroundRefresh) resetGoogleButton();
      });
  }

  // =========================================================
  // NORMALIZE DATA
  // =========================================================
  function findKey(keys, patterns) {
    for (var i = 0; i < patterns.length; i++) {
      var p = patterns[i].toLowerCase();
      for (var j = 0; j < keys.length; j++) {
        if (keys[j].toLowerCase().indexOf(p) !== -1) return keys[j];
      }
    }
    return null;
  }

  var KEYMAP = null;
  function buildKeymap(sample) {
    var keys = Object.keys(sample);
    KEYMAP = {
      id:        findKey(keys, ['deal id']),
      name:      findKey(keys, ['tên khách hàng', 'khách hàng', 'company']),
      // NEW — ưu tiên hiển thị Tên công ty; Sys ID để tra cứu trong thẻ chi tiết.
      // Dò theo TÊN cột (không phải vị trí cột) nên sheet có chèn/xoá cột vẫn chạy đúng.
      companyName: findKey(keys, ['tên công ty', 'ten cong ty']),
      sysId:     findKey(keys, ['system id', 'sys id', 'sysid']),
      role:      findKey(keys, ['vai trò']),
      segment:   findKey(keys, ['phân khúc']),
      solution:  findKey(keys, ['bộ giải pháp']),
      arr:       findKey(keys, ['arr', 'acr (']),
      tier:      findKey(keys, ['tier']),
      users:     findKey(keys, ['số user', 'user được phân quyền']),
      contract:  findKey(keys, ['loại hợp đồng']),
      received:  findKey(keys, ['ngày nhận']),
      ttgl:      findKey(keys, ['ttgl']),
      glPlan:    findKey(keys, ['go-live dự kiến', 'golive dự kiến']),
      glActual:  findKey(keys, ['go-live thực tế', 'golive thực tế']),
      glStatus:  findKey(keys, ['trạng thái go-live', 'trạng thái golive']),
      crMonth:   findKey(keys, ['tháng ghi nhận']),
      pctActive: findKey(keys, ['%active', 'active user']),
      pctOutput: findKey(keys, ['%output', 'output hoàn thành']),
      uPoint:    findKey(keys, ['điểm u']),
      uPointT1:  findKey(keys, ['điểm u (t1)', 'điểm u t1']),
      uPointT4:  findKey(keys, ['điểm u (t4)', 'điểm u t4']),
      chs:       findKey(keys, ['chs_cs', 'chs']),
      chsT1:     findKey(keys, ['chs_cs t1']),
      chsT4:     findKey(keys, ['chs_cs t4']),
      pctActiveT1: findKey(keys, ['% active t1', 'active t1']),
      pctActiveT4: findKey(keys, ['% active t4', 'active t4']),
      pctOutputT1: findKey(keys, ['% output t1', 'output t1']),
      pctOutputT4: findKey(keys, ['% output t4', 'output t4']),
      health:    findKey(keys, ['xếp loại']),
    };
  }

  function parseDate(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date) return isNaN(v) ? null : v;
    var s = String(v).trim();
    var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
    var d = new Date(s);
    return isNaN(d) ? null : d;
  }

  function parseMoney(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return v;
    var digits = String(v).replace(/[^\d]/g, '');
    return digits ? Number(digits) : null;
  }

  function parseDays(v) {
    // "50 ngày" / "50" / 50 → 50
    if (v == null || v === '') return null;
    if (typeof v === 'number') return v;
    var m = String(v).match(/\d+/);
    return m ? +m[0] : null;
  }

  function parseNum(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return v;
    var n = Number(String(v).replace(/%/g, '').replace(/\./g, '').replace(',', '.').trim());
    if (!isNaN(n)) return n;
    n = Number(String(v).replace(/%/g, '').replace(',', '.').trim());
    return isNaN(n) ? null : n;
  }

  function parsePct(v) {
    var n;
    if (typeof v === 'number') { n = v; }
    else {
      if (v == null || String(v).trim() === '') return null;
      n = Number(String(v).replace('%', '').replace(',', '.').trim());
      if (isNaN(n)) return null;
    }
    if (n > 0 && n <= 1) n = n * 100;
    return Math.round(n * 10) / 10;
  }

  function parseChs(v) {
    if (v == null || String(v).trim() === '') return null;
    if (typeof v === 'number') return v;
    var n = Number(String(v).replace(',', '.').trim());
    return isNaN(n) ? null : n;
  }

  function healthBand(chs, label) {
    if (chs != null) {
      if (chs <= 20) return 'risk';
      if (chs <= 50) return 'weak';
      if (chs <= 70) return 'healthy';
      return 'strong';
    }
    var s = String(label || '').toLowerCase();
    if (s.indexOf('risk') !== -1) return 'risk';
    if (s.indexOf('weak') !== -1) return 'weak';
    if (s.indexOf('strong') !== -1) return 'strong';
    if (s.indexOf('healthy') !== -1) return 'healthy';
    return 'none';
  }

  function normalizeDeal(raw) {
    if (!KEYMAP) buildKeymap(raw);
    var K = KEYMAP;
    var get = function (k) { return k ? raw[k] : null; };
    var ok = function (x) { return x != null && !(typeof x === 'number' && isNaN(x)); };
    var pick = function (a, b, c) { return ok(a) ? a : ok(b) ? b : (ok(c) ? c : null); };
    // Sheet Database có 2 mốc T1/T4 -> lấy mốc gần nhất (T4, không có thì T1);
    // vẫn tương thích sheet cũ 1 cột CHS qua nhánh 'single'.
    var chs = pick(parseChs(get(K.chsT4)), parseChs(get(K.chsT1)), parseChs(get(K.chs)));
    return {
      raw: raw,
      id: String(get(K.id) || ''),
      name: String(get(K.name) || '—'),
      // company = thứ hiển thị chính ở mọi bảng. Nếu sheet chưa có cột "Tên công ty"
      // thì tự lùi về tên deal để không bị trống trơn.
      company: String(get(K.companyName) || get(K.name) || '—'),
      sysId: String(get(K.sysId) || ''),
      role: String(get(K.role) || ''),
      segment: String(get(K.segment) || ''),
      solution: String(get(K.solution) || 'Khác'),
      arr: parseMoney(get(K.arr)),
      tier: get(K.tier),
      users: parseNum(get(K.users)),
      contract: String(get(K.contract) || 'Khác'),
      received: parseDate(get(K.received)),
      ttgl: parseDays(get(K.ttgl)),
      glPlan: parseDate(get(K.glPlan)),
      glActual: parseDate(get(K.glActual)),
      glStatus: String(get(K.glStatus) || ''),
      crMonth: String(get(K.crMonth) || ''),
      pctActive: pick(parsePct(get(K.pctActiveT4)), parsePct(get(K.pctActiveT1)), parsePct(get(K.pctActive))),
      pctOutput: pick(parsePct(get(K.pctOutputT4)), parsePct(get(K.pctOutputT1)), parsePct(get(K.pctOutput))),
      uPoint: pick(parseNum(get(K.uPointT4)), parseNum(get(K.uPointT1)), parseNum(get(K.uPoint))),
      chs: chs,
      band: healthBand(chs, get(K.health)),
    };
  }

  // =========================================================
  // FORMAT HELPERS
  // =========================================================
  function fmtMoney(n) {
    if (n == null) return '—';
    return n.toLocaleString('vi-VN') + ' đ';
  }
  function fmtMoneyShort(n) {
    if (n == null) return '—';
    if (n >= 1e9) return (Math.round(n / 1e7) / 100).toLocaleString('vi-VN') + ' tỷ';
    if (n >= 1e6) return Math.round(n / 1e6).toLocaleString('vi-VN') + 'tr';
    return n.toLocaleString('vi-VN') + ' đ';
  }
  function fmtDate(d) {
    if (!d) return '—';
    return String(d.getDate()).padStart(2, '0') + '/' +
           String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
  }
  function toInputDate(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // Tìm kiếm: quét cả tên công ty, tên deal, Sys ID và Deal ID — gõ gì cũng ra.
  function dealMatchesQuery(d, q) {
    if (!q) return true;
    var hay = [d.company, d.name, d.sysId, d.id].join(' ').toLowerCase();
    return hay.indexOf(q) !== -1;
  }

  var BAND_LABEL = { strong: 'Strong', healthy: 'Healthy', weak: 'Weak', risk: 'At Risk', none: 'Chưa có CHS' };

  // Dòng phụ nhỏ dưới tên công ty trong các bảng: ưu tiên Sys ID (dễ tra cứu
  // chéo với hệ thống), kèm Deal ID. Sheet chưa có cột System ID thì chỉ hiện Deal ID.
  function dealSubLine(d) {
    var sys = String((d && d.sysId) || '').trim();
    return (sys ? 'Sys ' + sys + ' · ' : '') + 'Deal ' + ((d && d.id) || '—');
  }

  // =========================================================
  // FILTER — Overview có 3 bộ lọc chính, bấm tới đâu dữ liệu đổi tới đó:
  //   1) Thời gian (droplist: tháng này / quý này / năm nay / tất cả / khoảng tuỳ chọn)
  //   2) Loại hợp đồng   3) Bộ giải pháp
  // Hai bộ lọc sau tự sinh danh sách từ chính dữ liệu deal của user.
  // =========================================================
  var searchQuery = '';
  var ovPeriod = 'month';      // month | quarter | year | all | custom — mặc định tháng này
  var ovContract = '';          // '' = tất cả
  var ovSolution = '';          // '' = tất cả

  function setDefaultDateRange() {
    ovPeriod = 'month';
    var sel = $('ovPeriod'); if (sel) sel.value = 'month';
    applyPeriodToDates();
    toggleCustomRange();
  }

  // Quy đổi lựa chọn thời gian → 2 ô ngày (ô ngày chỉ hiện khi chọn "Khoảng thời gian")
  function applyPeriodToDates() {
    if (ovPeriod === 'custom') return;   // giữ nguyên ngày user tự chọn
    var now = new Date();
    var from = null, to = now;
    if (ovPeriod === 'month') from = new Date(now.getFullYear(), now.getMonth(), 1);
    else if (ovPeriod === 'quarter') from = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
    else if (ovPeriod === 'year') from = new Date(now.getFullYear(), 0, 1);
    else if (ovPeriod === 'all') { from = null; to = null; }
    if ($('dateFrom')) $('dateFrom').value = from ? toInputDate(from) : '';
    if ($('dateTo')) $('dateTo').value = to ? toInputDate(to) : '';
  }

  function toggleCustomRange() {
    var box = $('ovCustomRange');
    if (box) box.style.display = (ovPeriod === 'custom') ? 'flex' : 'none';
  }

  // Đổ danh sách Loại hợp đồng / Bộ giải pháp từ dữ liệu thật, giữ nguyên lựa chọn đang chọn
  function buildOverviewFilters() {
    var fill = function (id, field, current, allLabel) {
      var sel = $(id); if (!sel) return;
      var vals = {};
      allDeals.forEach(function (d) { var v = String(d[field] || '').trim(); if (v) vals[v] = 1; });
      var list = Object.keys(vals).sort();
      sel.innerHTML = '<option value="">' + allLabel + '</option>' +
        list.map(function (v) { return '<option value="' + esc(v) + '">' + esc(v) + '</option>'; }).join('');
      sel.value = (current && list.indexOf(current) !== -1) ? current : '';
    };
    fill('ovContract', 'contract', ovContract, 'Tất cả loại HĐ');
    fill('ovSolution', 'solution', ovSolution, 'Tất cả bộ giải pháp');
    ovContract = $('ovContract') ? $('ovContract').value : '';
    ovSolution = $('ovSolution') ? $('ovSolution').value : '';
  }

  function getFilteredDeals() {
    var fromV = $('dateFrom') ? $('dateFrom').value : '';
    var toV = $('dateTo') ? $('dateTo').value : '';
    var from = fromV ? new Date(fromV + 'T00:00:00') : null;
    var to = toV ? new Date(toV + 'T23:59:59') : null;
    return allDeals.filter(function (d) {
      if (!d.received) { if (from || to) return false; }
      else { if (from && d.received < from) return false; if (to && d.received > to) return false; }
      if (ovContract && String(d.contract || '').trim() !== ovContract) return false;
      if (ovSolution && String(d.solution || '').trim() !== ovSolution) return false;
      if (!dealMatchesQuery(d, searchQuery)) return false;
      return true;
    });
  }

  // =========================================================
  // RENDER: TỔNG QUAN
  // =========================================================
  function renderProfileStrip() {
    var strip = $('profileStrip');
    if (!strip) return;
    if (!profileKnown || !profileComplete(profile)) { strip.style.display = 'none'; return; }
    strip.style.display = 'flex';
    var name = profile.hoTen || currentEmail;
    var initials = name.trim().split(/\s+/).slice(-2).map(function (w) { return w.charAt(0).toUpperCase(); }).join('');
    $('psAvatar').textContent = initials || 'CS';
    $('psName').textContent = name;
    var def = LEVELS[profile.level];
    $('psSub').textContent = (def ? def.title + ' · ' : '') + (currentEmail || '');
    $('psChips').innerHTML =
      '<span class="ps-chip lvl">' + esc(profile.level || '—') + '</span>' +
      (profile.salary ? '<span class="ps-chip sal" title="Lương cứng đã đăng ký">₫ ' + fmtMoneyShort(parseMoney(profile.salary)) + '/tháng</span>' : '');
  }

  function renderOverview() {
    buildOverviewFilters();
    var deals = getFilteredDeals();
    openDealId = null;
    renderProfileStrip();
    $('filterCount').innerHTML = '<strong>' + deals.length + '</strong> / ' + allDeals.length + ' deal';
    renderKpis(deals);
    renderHealthStrip(deals);
    renderDonut('donutSolution', groupBy(deals, 'solution'));
    renderDonut('donutContract', groupBy(deals, 'contract'));
    renderTable(deals);
  }

  function renderKpis(deals) {
    var totalArr = 0, glArr = 0, glCount = 0;
    deals.forEach(function (d) {
      if (d.arr) totalArr += d.arr;
      if (d.glActual) { glCount++; if (d.arr) glArr += d.arr; }
    });
    if ($('kpiDeals')) {
      $('kpiDeals').textContent = deals.length;
      var nSol = Object.keys(deals.reduce(function (m, d) { m[d.solution || 'Khác'] = 1; return m; }, {})).length;
      $('kpiDealsSub').textContent = deals.length ? nSol + ' bộ giải pháp · ' + glCount + ' đã go-live' : '';
    }
    $('kpiRevenue').textContent = fmtMoney(totalArr);
    $('kpiRevenueSub').textContent = deals.length
      ? 'Đã Go-live: ' + fmtMoneyShort(glArr) + ' (' + glCount + '/' + deals.length + ' deal)'
      : '';

    var scored = deals.filter(function (d) { return d.chs != null; });
    if (scored.length) {
      var avg = scored.reduce(function (s, d) { return s + d.chs; }, 0) / scored.length;
      avg = Math.round(avg * 10) / 10;
      $('kpiChs').textContent = String(avg).replace('.', ',');
      $('kpiChs').style.color = 'var(--' + healthBand(avg) + ')';
      $('kpiChsSub').textContent = 'Trên ' + scored.length + ' deal · nguồn CHS_CS T4 (chưa có thì lấy T1)';
    } else {
      $('kpiChs').textContent = '—';
      $('kpiChs').style.color = '';
      $('kpiChsSub').textContent = 'Chưa có deal nào được chấm CHS_CS T1/T4';
    }

    var counts = countBands(deals);
    var order = ['strong', 'healthy', 'weak', 'risk', 'none'];
    var cls = { strong: 'hp-strong', healthy: 'hp-healthy', weak: 'hp-weak', risk: 'hp-risk', none: 'hp-none' };
    $('healthCounts').innerHTML = order.map(function (b) {
      return '<span class="health-pill ' + cls[b] + '"><span class="n">' + counts[b] + '</span> ' + BAND_LABEL[b] + '</span>';
    }).join('');
  }

  function countBands(deals) {
    var c = { strong: 0, healthy: 0, weak: 0, risk: 0, none: 0 };
    deals.forEach(function (d) { c[d.band] = (c[d.band] || 0) + 1; });
    return c;
  }

  function renderHealthStrip(deals) {
    var c = countBands(deals);
    var total = deals.length || 1;
    var order = ['strong', 'healthy', 'weak', 'risk', 'none'];
    $('healthStrip').innerHTML = order.map(function (b) {
      var pct = (c[b] / total) * 100;
      if (!pct) return '';
      return '<div class="seg seg-' + b + '" style="flex-basis:' + pct + '%" title="' +
        BAND_LABEL[b] + ': ' + c[b] + ' deal"></div>';
    }).join('');
  }

  function groupBy(deals, field) {
    var map = {};
    deals.forEach(function (d) {
      var k = d[field] || 'Khác';
      if (!map[k]) map[k] = { name: k, arr: 0, count: 0 };
      map[k].arr += d.arr || 0;
      map[k].count += 1;
    });
    return Object.values(map).sort(function (a, b) { return b.arr - a.arr; });
  }

  function renderDonut(containerId, groups) {
    var el = $(containerId);
    var total = groups.reduce(function (s, g) { return s + g.arr; }, 0);
    var count = groups.reduce(function (s, g) { return s + g.count; }, 0);

    if (!groups.length || !total) {
      el.innerHTML = '<div class="empty" style="padding:20px;width:100%;">Không có dữ liệu trong bộ lọc.</div>';
      return;
    }

    var size = 130, r = 50, cx = size / 2, cy = size / 2, stroke = 18;
    var circ = 2 * Math.PI * r;
    var offset = 0;
    var segs = groups.map(function (g, i) {
      var frac = g.arr / total;
      var len = frac * circ;
      var s = '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none"' +
        ' stroke="' + CHART_COLORS[i % CHART_COLORS.length] + '" stroke-width="' + stroke + '"' +
        ' stroke-dasharray="' + len + ' ' + (circ - len) + '"' +
        ' stroke-dashoffset="' + (-offset) + '" transform="rotate(-90 ' + cx + ' ' + cy + ')"></circle>';
      offset += len;
      return s;
    }).join('');

    var svg = '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" role="img" aria-label="Biểu đồ cơ cấu">' +
      segs +
      '<text x="' + cx + '" y="' + (cy - 2) + '" text-anchor="middle" class="donut-center-num">' + fmtMoneyShort(total) + '</text>' +
      '<text x="' + cx + '" y="' + (cy + 13) + '" text-anchor="middle" class="donut-center-lbl">' + count + ' deal</text>' +
      '</svg>';

    var legend = '<div class="legend">' + groups.map(function (g, i) {
      var pct = Math.round((g.arr / total) * 100);
      return '<div class="legend-item">' +
        '<span class="legend-dot" style="background:' + CHART_COLORS[i % CHART_COLORS.length] + '"></span>' +
        '<span class="legend-name">' + esc(g.name) + '</span>' +
        '<span class="legend-val">' + pct + '% · ' + fmtMoneyShort(g.arr) + ' · ' + g.count + ' deal</span>' +
        '</div>';
    }).join('') + '</div>';

    el.innerHTML = svg + legend;
  }

  function glBadge(status) {
    var s = String(status || '');
    if (/đúng hạn|đã go/i.test(s)) return '<span class="badge gl-done">' + esc(s) + '</span>';
    if (/quá|trễ/i.test(s))        return '<span class="badge gl-overdue">' + esc(s) + '</span>';
    if (s) return '<span class="badge gl-doing">' + esc(s) + '</span>';
    return '—';
  }

  function chsBadge(deal) {
    if (deal.chs == null) return '<span class="badge chs-none">—</span>';
    var v = String(Math.round(deal.chs * 10) / 10).replace('.', ',');
    return '<span class="badge chs-' + deal.band + '">' + v + '</span>';
  }

  function renderTable(deals) {
    var tbody = $('dealTbody');
    var empty = $('tableEmpty');
    var sorted = deals.slice().sort(function (a, b) {
      var ta = a.received ? a.received.getTime() : 0;
      var tb = b.received ? b.received.getTime() : 0;
      return sortDesc ? tb - ta : ta - tb;
    });
    $('sortDate').textContent = 'Ngày nhận ' + (sortDesc ? '▾' : '▴');

    if (!sorted.length) {
      tbody.innerHTML = '';
      empty.style.display = 'block';
      return;
    }
    empty.style.display = 'none';

    tbody.innerHTML = sorted.map(function (d) {
      return '<tr class="deal-row band-' + d.band + '" data-id="' + esc(d.id) + '">' +
        '<td><div class="deal-name">' + esc(d.company) + '</div><div class="deal-id">' + esc(dealSubLine(d)) + '</div></td>' +
        '<td><span class="badge role">' + esc(d.role || '—') + '</span></td>' +
        '<td>' + fmtDate(d.received) + '</td>' +
        '<td class="num">' + fmtMoney(d.arr) + '</td>' +
        '<td>' + glBadge(d.glStatus) + '</td>' +
        '<td class="num">' + chsBadge(d) + '</td>' +
        '</tr>';
    }).join('');

    tbody.querySelectorAll('tr.deal-row').forEach(function (tr) {
      tr.addEventListener('click', function () { toggleDetail(tr, sorted); });
    });
  }

  function toggleDetail(tr, deals) {
    var id = tr.getAttribute('data-id');
    var existing = document.querySelector('tr.detail-row');
    var wasOpen = openDealId === id;

    if (existing) existing.remove();
    document.querySelectorAll('tr.deal-row.open').forEach(function (r) { r.classList.remove('open'); });
    openDealId = null;
    if (wasOpen) return;

    var deal = deals.find(function (d) { return d.id === id; });
    if (!deal) return;

    openDealId = id;
    tr.classList.add('open');

    var items = [
      ['Sys ID', deal.sysId || '—'],
      ['Deal ID', deal.id || '—'],
      ['Tên deal', deal.name || '—'],
      ['Phân khúc', deal.segment || '—'],
      ['Bộ giải pháp', deal.solution || '—'],
      ['Tier', deal.tier != null && String(deal.tier) !== '' ? (/tier/i.test(String(deal.tier)) ? String(deal.tier) : 'Tier ' + deal.tier) : '—'],
      ['Số user phân quyền', deal.users != null ? deal.users.toLocaleString('vi-VN') : '—'],
      ['Loại hợp đồng', deal.contract || '—'],
      ['TTGL quy định', deal.ttgl != null ? deal.ttgl + ' ngày' : '—'],
      ['Go-live dự kiến', fmtDate(deal.glPlan)],
      ['Go-live thực tế', fmtDate(deal.glActual)],
      ['Tháng ghi nhận CR', deal.crMonth || '—'],
      ['Điểm U quy đổi', deal.uPoint != null ? deal.uPoint : '—'],
      ['CHS_CS', deal.chs != null ? String(deal.chs).replace('.', ',') + ' điểm' : 'Chưa chấm'],
      ['Xếp loại', BAND_LABEL[deal.band]],
    ];

    var grid = '<div class="detail-grid">' + items.map(function (it) {
      return '<div class="detail-item"><span class="k">' + esc(it[0]) + '</span><span class="v">' + esc(it[1]) + '</span></div>';
    }).join('') + '</div>';

    var bars = '';
    if (deal.pctActive != null || deal.pctOutput != null) {
      bars = '<div class="mini-bars">' +
        miniBar('%Active User (tháng hiện tại)', deal.pctActive) +
        miniBar('%Output hoàn thành (tháng hiện tại)', deal.pctOutput) +
        '</div>';
    }

    var detail = document.createElement('tr');
    detail.className = 'detail-row';
    detail.innerHTML = '<td colspan="6">' + grid + bars +
      '<div class="detail-actions"><button class="btn detail-goto-fc" id="detailGoto">→ Mở trong Forecast để sửa số liệu</button></div>' +
      '</td>';
    tr.parentNode.insertBefore(detail, tr.nextSibling);
    var gotoBtn = $('detailGoto');
    if (gotoBtn) gotoBtn.addEventListener('click', function () { goToForecastDeal(deal.id, deal.company); });
  }

  function miniBar(label, pct) {
    if (pct == null) return '';
    var v = Math.max(0, Math.min(100, pct));
    return '<div class="mini-bar">' +
      '<div class="mb-head"><span>' + esc(label) + '</span><b>' + String(pct).replace('.', ',') + '%</b></div>' +
      '<div class="mini-track"><div class="mini-fill" style="width:' + v + '%"></div></div>' +
      '</div>';
  }

  // =========================================================
  // TABS
  // =========================================================
  function switchTab(name, fromRoute) {
    currentTab = name;
    document.querySelectorAll('.tab').forEach(function (t) {
      t.classList.toggle('active', t.getAttribute('data-tab') === name);
    });
    Object.keys(panels).forEach(function (k) {
      panels[k].style.display = k === name ? 'block' : 'none';
    });
    // Đồng bộ URL — trừ khi chính URL vừa gọi hàm này (fromRoute), tránh lặp.
    if (!fromRoute) setRoute(routeForTab(name));
    if (name === 'forecast') renderForecast();
    if (name === 'dashboard') renderDashboard();
    if (name === 'overview' && Date.now() - lastFetchOverview > STALE_MS) {
      var token = localStorage.getItem('cs_tool_token');
      if (token) loadDeals(token, true, true); // background refresh, giữ nguyên bộ lọc đang chọn, thử silent reauth nếu token hết hạn
    }
  }

  function manualRefresh() {
    var token = localStorage.getItem('cs_tool_token');
    if (!token) return;
    var activeTab = document.querySelector('.tab.active');
    var name = activeTab ? activeTab.getAttribute('data-tab') : 'overview';
    if (name === 'forecast') {
      if (Object.keys(fcState).length > 0 &&
          !confirm('Bạn đang có ô sửa chưa lưu ở Forecast. Làm mới sẽ mất các thay đổi này. Tiếp tục?')) return;
      fcState = {};
      fcLoad();
    } else if (name === 'dashboard') {
      fcLoad(false, renderDashboard);
    } else {
      loadDeals(token, true, true);
    }
    showToast('Đang làm mới dữ liệu…', 'ok', 2000);
  }

  // =========================================================
  // EVENTS
  // =========================================================
  logoutBtn.addEventListener('click', logout);
  if (refreshBtn) refreshBtn.addEventListener('click', manualRefresh);

  var bootRetryBtn = $('bootRetry');
  if (bootRetryBtn) bootRetryBtn.addEventListener('click', function () { location.reload(); });

  // NEW — search box Overview + Forecast
  var ovSearchEl = $('ovSearch');
  if (ovSearchEl) ovSearchEl.addEventListener('input', function () {
    searchQuery = this.value.trim().toLowerCase();
    renderOverview();
  });
  var fcSearchEl = $('fcSearch');
  if (fcSearchEl) fcSearchEl.addEventListener('input', function () {
    fcSearchQuery = this.value.trim().toLowerCase();
    fcRenderTable();
    if (fcView === 'multi') mcRenderTable();
  });
  document.querySelectorAll('.fc-view-btn').forEach(function (b) {
    b.addEventListener('click', function () { fcSetView(b.getAttribute('data-view')); });
  });
  var mcSaveBtnEl = $('mcSaveBtn');
  if (mcSaveBtnEl) mcSaveBtnEl.addEventListener('click', mcSave);

  // Nút ẩn/hiện các cột phụ ở Forecast — mặc định ẩn để bảng chỉ còn tên khách
  // hàng + 5 ô cần nhập + CHS, đỡ rối mắt khi nhập liệu.
  var fcColsBtn = $('fcColsToggle');
  if (fcColsBtn) fcColsBtn.addEventListener('click', function () {
    var tb = $('fcTable'); if (!tb) return;
    var compact = tb.classList.toggle('fc-compact');
    this.textContent = compact ? '⊞ Hiện đầy đủ' : '⊟ Ẩn bớt';
  });

  document.querySelectorAll('.tab').forEach(function (t) {
    t.addEventListener('click', function () { switchTab(t.getAttribute('data-tab')); });
  });

  // Bộ lọc Overview: 3 droplist, đổi cái nào là dữ liệu cập nhật ngay cái đó
  var ovPeriodEl = $('ovPeriod');
  if (ovPeriodEl) ovPeriodEl.addEventListener('change', function () {
    ovPeriod = this.value;
    toggleCustomRange();
    applyPeriodToDates();
    renderOverview();
  });
  var ovContractEl = $('ovContract');
  if (ovContractEl) ovContractEl.addEventListener('change', function () {
    ovContract = this.value; renderOverview();
  });
  var ovSolutionEl = $('ovSolution');
  if (ovSolutionEl) ovSolutionEl.addEventListener('change', function () {
    ovSolution = this.value; renderOverview();
  });

  ['dateFrom', 'dateTo'].forEach(function (id) {
    var el = $(id);
    if (el) el.addEventListener('change', function () { renderOverview(); });
  });

  $('sortDate').addEventListener('click', function () {
    sortDesc = !sortDesc;
    renderTable(getFilteredDeals());
  });

  // =========================================================
  // BOOT: Check token & load app
  // =========================================================
  var silentReauthInProgress = false; // để biết khi callback bắn về là do reload âm thầm hay do user tự bấm

  window.addEventListener('load', function () {
    if (!CFG.CLIENT_ID || CFG.CLIENT_ID.indexOf('DIEN_') === 0) {
      alert('Error: CLIENT_ID not configured in config.js');
      return;
    }

    // Luôn initialize() ngay, bất kể đã có token lưu sẵn hay chưa —
    // để nếu token hết hạn và cần đăng nhập lại, nút Google hoạt động được ngay
    // (không cần reload trang để tránh lỗi "missing client_id").
    var check = setInterval(function () {
      if (window.google && google.accounts && google.accounts.id) {
        clearInterval(check);
        google.accounts.id.initialize({
          client_id: CFG.CLIENT_ID,
          hd: CFG.ALLOWED_DOMAIN,
          callback: handleCredential,
          auto_select: true,          // tự chọn tài khoản nếu chỉ có 1 tài khoản @base.vn đang đăng nhập trên trình duyệt
          cancel_on_tap_outside: false,
        });
        // Dựng sẵn nút Google THẬT (renderButton chính chủ) nhưng ẩn đi —
        // dùng làm phương án dự phòng khi One Tap/FedCM thất bại (bị chặn,
        // bị trình duyệt tắt third-party sign-in, timeout...). Nút thật này
        // mở popup OAuth chuẩn, không phụ thuộc cơ chế "silent prompt" của
        // One Tap đang bị Google khai tử dần dưới FedCM nên gần như luôn bấm được.
        var realBtnEl = document.getElementById('gRealButton');
        if (realBtnEl) {
          try {
            google.accounts.id.renderButton(realBtnEl, {
              type: 'standard', theme: 'outline', size: 'large',
              text: 'continue_with', shape: 'rectangular', width: 280,
            });
          } catch (e) { console.error('renderButton lỗi:', e); }
        }
        var savedToken = localStorage.getItem('cs_tool_token');
        if (savedToken) {
          // Token Google id_token chỉ sống ~1h theo thiết kế của Google (không phải bug của tool này).
          // Khi hết hạn, thử âm thầm lấy token mới trước khi bắt user bấm nút lại.
          loadDeals(savedToken, /* silentRetryOnFail */ true);
        } else {
          // Chưa từng đăng nhập / đã logout — thử âm thầm một lần; nếu thất bại
          // (bị chặn FedCM/third-party sign-in...) thì hiện luôn nút Google thật
          // để user không cần bấm hụt nút custom rồi mới thấy phương án dự phòng.
          trySilentSignIn(showGoogleFallback);
        }
      }
    }, 100);
  });

  // =========================================================
  // GOOGLE SIGN-IN: 1 hàm prompt() dùng chung, có khoá để tránh gọi
  // chồng nhiều lần — đây là nguyên nhân của lỗi "AbortError: signal is
  // aborted without reason" thấy trong console (gọi prompt() lần 2 khi
  // lần 1 chưa xong sẽ tự abort lần 1).
  //
  // QUAN TRỌNG: khoá này PHẢI có timeout cứng. Nếu không, khi lần gọi
  // prompt() đầu tiên (tự động lúc load trang) bị "treo" — callback của
  // Google không bao giờ bắn về (trình duyệt chặn FedCM/cookie bên thứ 3,
  // tiện ích chặn quảng cáo chặn iframe accounts.google.com, quirk của
  // thư viện GSI...) — thì promptInFlight kẹt ở true vĩnh viễn, và mọi
  // lần bấm nút "Continue with Google" sau đó sẽ bị trySilentSignIn()
  // return ngay lập tức trong im lặng: spinner quay mãi, không lỗi,
  // không phản hồi. Đây chính là bug "bấm vào cứ load, không phản hồi".
  // =========================================================
  var promptInFlight = false;
  var PROMPT_TIMEOUT_MS = 6000;
  // Nếu có lệnh gọi tới trong lúc đang có 1 lần prompt() khác chạy dở (VD: lần tự
  // động lúc load trang còn đang chờ, rồi user bấm nút) — KHÔNG được âm thầm bỏ qua
  // lệnh gọi đó, vì nếu vậy callback (đóng spinner, hiện lỗi...) của lệnh gọi này
  // sẽ không bao giờ chạy, dù cơ chế timeout ở trên có tự giải phóng khoá đi nữa
  // (nó chỉ giải phóng khoá, không đụng tới UI của lệnh gọi bị bỏ qua). Nên xếp
  // hàng chờ (queue) và khi lần đang chạy dở đó kết thúc (dù thành công hay hết giờ),
  // gọi luôn onFail cho tất cả các lệnh gọi đang xếp hàng.
  var pendingWaiters = [];

  function trySilentSignIn(onFail) {
    if (promptInFlight) {
      if (onFail) pendingWaiters.push(onFail);
      return;
    }
    if (!(window.google && google.accounts && google.accounts.id)) { if (onFail) onFail(); return; }

    promptInFlight = true;
    var settled = false;
    var finish = function () {
      if (settled) return;
      settled = true;
      promptInFlight = false;
      var waiters = pendingWaiters; pendingWaiters = [];
      waiters.forEach(function (fn) { try { fn(); } catch (e) {} });
    };
    var timeoutId = setTimeout(function () {
      if (settled) return;
      console.warn('Google prompt() không phản hồi sau ' + (PROMPT_TIMEOUT_MS / 1000) + 's — có thể do trình duyệt chặn FedCM/cookie bên thứ 3, hoặc tiện ích chặn quảng cáo. Đã tự reset để thử lại được.');
      finish();
      if (onFail) onFail();
    }, PROMPT_TIMEOUT_MS);

    try {
      google.accounts.id.prompt(function (notification) {
        if (settled) return; // timeout đã xử lý rồi, bỏ qua callback bắn về trễ
        clearTimeout(timeoutId);
        var reason = notification.getNotDisplayedReason ? notification.getNotDisplayedReason() : null;
        var isFail = notification.isNotDisplayed() || notification.isSkippedMoment();
        finish();
        if (isFail) {
          console.log('Silent sign-in không khả dụng:', reason || (notification.getSkippedReason && notification.getSkippedReason()));
          if (onFail) onFail();
        }
      });
    } catch (err) {
      clearTimeout(timeoutId);
      console.error('Google sign-in error:', err);
      finish();
      if (onFail) onFail();
    }
  }

  // =========================================================
  // GLOBAL FUNCTION for HTML button click
  // =========================================================
  function handleCredential(response) {
    var token = response.credential;
    localStorage.setItem('cs_tool_token', token);
    localStorage.setItem(SESSION_KEY, JSON.stringify({ ts: Date.now() }));
    var wasBackground = silentReauthInProgress; // true nếu đây là refresh âm thầm, không phải user vừa bấm nút
    silentReauthInProgress = false;
    loadDeals(token, false, wasBackground);
  }

  function resetGoogleButton() {
    var logo = document.getElementById('glogo');
    var spinner = document.getElementById('spinner');
    var text = document.getElementById('gtext');
    var btn = document.getElementById('gbtn');
    if (logo) logo.classList.remove('hidden');
    if (spinner) spinner.classList.add('hidden');
    if (text) text.textContent = 'Continue with Google';
    if (btn) btn.removeAttribute('disabled');
  }

  function showGoogleFallback() {
    var fb = $('gbtnFallback');
    if (fb) fb.classList.remove('hidden');
  }
  function hideGoogleFallback() {
    var fb = $('gbtnFallback');
    if (fb) fb.classList.add('hidden');
  }

  window.signInWithGoogle = function () {
    var logo = document.getElementById('glogo');
    var spinner = document.getElementById('spinner');
    var text = document.getElementById('gtext');
    var btn = document.getElementById('gbtn');

    if (logo) logo.classList.add('hidden');
    if (spinner) spinner.classList.remove('hidden');
    if (text) text.textContent = 'Opening Google...';
    if (btn) btn.setAttribute('disabled', '');

    setTimeout(function () {
      trySilentSignIn(function () {
        // One Tap / FedCM không hiện được, hoặc prompt() bị treo quá PROMPT_TIMEOUT_MS
        // (chặn FedCM/cookie bên thứ 3, third-party sign-in bị Chrome tắt, tiện ích
        // chặn quảng cáo...) → reset nút custom, báo rõ cho user, và LUÔN LUÔN
        // hiện nút Google THẬT (renderButton) làm phương án dự phòng — nút này mở
        // popup OAuth chuẩn, không phụ thuộc cơ chế "silent prompt" của One Tap.
        console.warn('One Tap not available, showing real Google button fallback');
        resetGoogleButton();
        showGoogleFallback();
        showToast('One Tap không mở được. Dùng nút Google chính thức bên dưới để đăng nhập.', 'err', 6000);
      });
    }, 300);
  };

  (function () {
    var retryBtn = $('gbtnRetry');
    if (retryBtn) retryBtn.addEventListener('click', function () {
      hideGoogleFallback();
      window.signInWithGoogle();
    });
  })();


  // =========================================================
  // FORECAST TAB  (nguồn: sheet "Database", model T1/T4)
  // Chỉ tính lại client-side các field phụ thuộc ô vàng;
  // các cột raw-derived (Tier, TTGL, GL dự kiến, Tháng CR, ACR)
  // đọc thẳng từ sheet (đã là công thức) để luôn khớp.
  // =========================================================
  var fcDeals = null, fcState = {}, fcLoaded = false, FKEY = null;

  function fcBuildKeymap(sample) {
    var keys = Object.keys(sample);
    FKEY = {
      id:       findKey(keys, ['deal id']),
      name:     findKey(keys, ['tên khách hàng', 'khách hàng']),
      companyName: findKey(keys, ['tên công ty', 'ten cong ty']),   // NEW — hiển thị chính
      sysId:    findKey(keys, ['system id', 'sys id', 'sysid']),    // NEW
      role:     findKey(keys, ['vai trò']),                    // NEW — combo CS_PM+CS_A
      contract: findKey(keys, ['loại hợp đồng']),
      val:      findKey(keys, ['giá trị phần mềm bộ', 'giá trị phần mềm']),
      segment:  findKey(keys, ['phân khúc']),
      tier:     findKey(keys, ['tier']),
      received: findKey(keys, ['ngày nhận']),
      ttgl:     findKey(keys, ['ttgl']),
      glPlan:   findKey(keys, ['go-live dự kiến', 'golive dự kiến']),
      glActual: findKey(keys, ['go-live thực tế', 'golive thực tế']),
      crMonth:  findKey(keys, ['tháng ghi nhận']),
      acr:      findKey(keys, ['acr (vnđ', 'acr (']),
      aT1:      findKey(keys, ['% active t1', 'active t1']),
      oT1:      findKey(keys, ['% output t1', 'output t1']),
      aT4:      findKey(keys, ['% active t4', 'active t4']),
      oT4:      findKey(keys, ['% output t4', 'output t4']),
      dtPhai:   findKey(keys, ['dt phải go-live', 'dt phải golive', 'phải go-live']),
      dtDat:    findKey(keys, ['dt go-live đạt', 'dt golive đạt', 'go-live đạt']),
      monthT1:  findKey(keys, ['tháng đo t1']),
      monthT4:  findKey(keys, ['tháng đo t4']),
    };
    // NEW — cột ACR nhiều năm (Năm 2 → Năm 5). Pattern có "- năm N" nên KHÔNG
    // đụng cột năm 1 gốc ở trên (findKey trả về cột đầu tiên khớp theo thứ tự
    // cột trong sheet, mà cột năm 1 luôn đứng trước cột năm 2-5).
    for (var n = 2; n <= 5; n++) {
      FKEY['comMT1_y' + n] = findKey(keys, ['tháng nhận com t1 - năm ' + n]);
      FKEY['comMT4_y' + n] = findKey(keys, ['tháng nhận com t4 - năm ' + n]);
      FKEY['aT1_y' + n]    = findKey(keys, ['% active t1 - năm ' + n]);
      FKEY['oT1_y' + n]    = findKey(keys, ['% output t1 - năm ' + n]);
      FKEY['aT4_y' + n]    = findKey(keys, ['% active t4 - năm ' + n]);
      FKEY['oT4_y' + n]    = findKey(keys, ['% output t4 - năm ' + n]);
    }
  }

  // ---- Month key helpers ("MM/YYYY") ----
  function mNorm(v) {
    if (v == null) return '';
    if (v instanceof Date && !isNaN(v)) return String(v.getMonth() + 1).padStart(2, '0') + '/' + v.getFullYear();
    var s = String(v).trim();
    var m = s.match(/(\d{1,2})\s*\/\s*(\d{4})/);           // "03/2026", "3/2026"
    if (m) return String(+m[1]).padStart(2, '0') + '/' + m[2];
    var d = parseDate(s);                                   // fallback: cả chuỗi ngày/ISO
    return d ? mNorm(d) : '';
  }
  function mKeyNow() { return mNorm(new Date()); }
  function mCmp(a, b) {
    // so sánh 2 key MM/YYYY; key rỗng đẩy về sau
    if (!a && !b) return 0; if (!a) return 1; if (!b) return -1;
    var p = a.split('/'), q = b.split('/');
    return (p[1] - q[1]) || (p[0] - q[0]);
  }
  function mAdd(key, n) {
    var p = key.split('/');
    var d = new Date(+p[1], +p[0] - 1 + n, 1);
    return mNorm(d);
  }

  function fcNormalize(raw) {
    if (!FKEY) fcBuildKeymap(raw);
    var K = FKEY, g = function (k) { return k ? raw[k] : null; };
    var tm = String(g(K.tier) || '').match(/\d+/);
    var out = {
      id: String(g(K.id) || ''),
      name: String(g(K.name) || '—'),
      company: String(g(K.companyName) || g(K.name) || '—'),   // NEW — hiển thị chính
      sysId: String(g(K.sysId) || ''),                          // NEW
      role: String(g(K.role) || ''),                 // NEW — dùng để combo CS_PM+CS_A
      contract: String(g(K.contract) || '—'),
      val: parseMoney(g(K.val)),
      segment: String(g(K.segment) || ''),
      tierNum: tm ? +tm[0] : null,
      received: parseDate(g(K.received)),
      ttgl: parseDays(g(K.ttgl)),
      glPlan: parseDate(g(K.glPlan)),
      crMonth: mNorm(g(K.crMonth)),
      monthT1: mNorm(g(K.monthT1)),
      monthT4: mNorm(g(K.monthT4)),
      acr: parseMoney(g(K.acr)),
      dtPhai: parseMoney(g(K.dtPhai)),
      dtDat0: parseMoney(g(K.dtDat)),
      glActual0: parseDate(g(K.glActual)),
      aT1_0: parsePct(g(K.aT1)), oT1_0: parsePct(g(K.oT1)),
      aT4_0: parsePct(g(K.aT4)), oT4_0: parsePct(g(K.oT4)),
    };
    // NEW — dữ liệu ACR nhiều năm (Năm 2-5), gom theo từng năm cho gọn
    out.years = {};
    for (var n = 2; n <= 5; n++) {
      out.years[n] = {
        mT1: mNorm(g(K['comMT1_y' + n])), mT4: mNorm(g(K['comMT4_y' + n])),
        aT1_0: parsePct(g(K['aT1_y' + n])), oT1_0: parsePct(g(K['oT1_y' + n])),
        aT4_0: parsePct(g(K['aT4_y' + n])), oT4_0: parsePct(g(K['oT4_y' + n])),
      };
    }
    return out;
  }

  function fcSeed() {
    fcState = {};  // leave empty, only populate when user edits
  }

  function fcUPoint(t, a) {
    if (a == null || a === '') return null; a = +a;
    if (t === 1) return a > 60 ? 100 : a > 30 ? 60 : a > 10 ? 40 : 0;
    if (t === 2) return a > 50 ? 100 : a > 30 ? 80 : a > 10 ? 50 : 0;
    if (t === 3) return a > 30 ? 100 : a > 15 ? 80 : a > 5 ? 40 : 0;
    return null; // Tier 4 dùng Output
  }
  function fcChs(t, a, o) {
    if (o == null || o === '') return null; o = +o;
    if (t === 4) return o;                       // Tier 4: CHS = 100% Output
    var u = fcUPoint(t, a); if (u == null) return null;
    return Math.round((0.7 * u + 0.3 * o) * 10) / 10;
  }

  // Giá trị "hiệu lực" của 1 deal = ô đang sửa (chưa lưu) ?? giá trị đã lưu trên sheet.
  // Trước đây fcCompute chỉ nhìn ô đang sửa → deal đã có số trên sheet vẫn hiện "—";
  // bản này sửa lại để CHS/KPI phản ánh đúng dữ liệu đã lưu.
  function fcEff(d) {
    var e = fcState[d.id] || {};
    var glStr = (e.goLive !== undefined) ? e.goLive : (d.glActual0 ? fmtDate(d.glActual0) : '');
    return {
      gl: glStr ? parseDate(String(glStr)) : null,
      aT1: (e.aT1 !== undefined) ? e.aT1 : d.aT1_0,
      oT1: (e.oT1 !== undefined) ? e.oT1 : d.oT1_0,
      aT4: (e.aT4 !== undefined) ? e.aT4 : d.aT4_0,
      oT4: (e.oT4 !== undefined) ? e.oT4 : d.oT4_0,
    };
  }

  function fcCompute(d) {
    var v = fcEff(d);
    var gl = v.gl;
    var t = d.tierNum;
    var status;
    if (gl) {
      status = (d.glPlan && gl <= d.glPlan) ? 'Đúng hạn' : 'Go-live trễ';
    } else if (d.received && d.ttgl != null &&
               Date.now() > d.received.getTime() + 2 * d.ttgl * 86400000) {
      status = 'Quá 200% → dồn CR1';
    } else if (d.glPlan && new Date() > d.glPlan) {
      status = 'Trễ - chưa go-live';
    } else {
      status = 'Đang triển khai';
    }
    var cT1 = fcChs(t, v.aT1, v.oT1), cT4 = fcChs(t, v.aT4, v.oT4);
    var late = (status === 'Quá 200% → dồn CR1' || status === 'Trễ - chưa go-live' || status === 'Go-live trễ');
    return {
      gl: gl, aT1: v.aT1, oT1: v.oT1, aT4: v.aT4, oT4: v.oT4,
      status: status, cT1: cT1, cT4: cT4,
      acrT1: (cT1 != null && cT1 >= 50) ? (d.acr || 0) : 0,
      acrT4: (cT4 != null && cT4 >= 50) ? (d.acr || 0) : 0,
      dtDat: gl ? (d.dtPhai || 0) : 0, late: late,
    };
  }

  // =========================================================
  // FORECAST — BỘ LỌC NHẬP LIỆU THEO THÁNG (yêu cầu Big Update III)
  // =========================================================
  var fcFilterKey = 'needNow';      // chip đang chọn
  var fcFilterMonthKey = mKeyNow(); // tháng làm việc
  var fcFocusId = null;             // set khi nhảy từ Overview/Scorecard sang xem đúng 1 deal
  var fcFocusName = '';

  // Phân loại 1 deal theo các "việc cần làm" trong tháng làm việc
  function fcTags(d) {
    var cur = fcFilterMonthKey;
    var tags = {};
    var v = fcEff(d);
    var t = d.tierNum;
    var missT = function (a, o) { return (t === 4) ? (o == null) : (a == null || o == null); };

    // 1) Kỳ đo T1/T4 rơi vào tháng làm việc → cần nhập 4 chỉ số %
    if (d.monthT1 === cur || d.monthT4 === cur) tags.needNow = true;

    // 2) Kỳ đo ĐÃ QUA nhưng còn thiếu số → nhập bù gấp (CHS trống = mất SRR & commission)
    if ((d.monthT1 && mCmp(d.monthT1, cur) < 0 && missT(v.aT1, v.oT1)) ||
        (d.monthT4 && mCmp(d.monthT4, cur) < 0 && missT(v.aT4, v.oT4))) tags.missPast = true;

    // 3) Chưa có ngày go-live thực tế → theo dõi tiến độ
    if (!v.gl) {
      var today = new Date(); today.setHours(0, 0, 0, 0);
      var planKey = d.glPlan ? mNorm(d.glPlan) : '';
      if (d.glPlan && d.glPlan < today) tags.overdue = true;                     // đã trễ hạn
      else if (planKey && planKey === cur) tags.dueSoon = true;                  // sắp trễ hạn (dự kiến tháng này)
      else tags.notYet = true;                                                   // chưa tới hạn
      // 4) Quá 200% định mức TTGL → dồn CR1 (chính sách mục 5)
      if (d.received && d.ttgl != null &&
          today.getTime() > d.received.getTime() + 2 * d.ttgl * 86400000) tags.over200 = true;
    }
    return tags;
  }

  var FC_CHIPS = [
    { key: 'all',      label: 'Tất cả' },
    { key: 'needNow',  label: 'Kỳ đo T1/T4 tháng này' },
    { key: 'missPast', label: 'Thiếu số kỳ đã qua' },
    { key: 'notYet',   label: 'Chưa GL · chưa tới hạn' },
    { key: 'dueSoon',  label: 'Chưa GL · sắp trễ hạn' },
    { key: 'overdue',  label: 'Chưa GL · đã trễ hạn' },
    { key: 'over200',  label: 'Quá 200% TTGL' },
  ];

  function fcFilteredDeals() {
    if (!fcDeals) return [];
    var base;
    if (fcFocusId) base = fcDeals.filter(function (d) { return d.id === fcFocusId; });
    else if (fcFilterKey === 'all') base = fcDeals;
    else base = fcDeals.filter(function (d) { return !!fcTags(d)[fcFilterKey]; });
    if (fcSearchQuery) base = base.filter(function (d) { return dealMatchesQuery(d, fcSearchQuery); });  // NEW
    return base;
  }

  function fcClearFocus() {
    fcFocusId = null; fcFocusName = '';
    fcFilterKey = 'all'; // nút ghi "xem tất cả" thì phải thật sự về view Tất cả, không giữ lại chip trước đó
    fcRenderChips(); fcRenderTable();
  }

  function fcInitFilterMonth() {
    var sel = $('fcFilterMonth');
    if (!sel || sel.options.length) return;
    // dải tháng: từ -6 → +6 quanh tháng hiện tại, mặc định tháng hiện tại
    for (var i = -6; i <= 6; i++) {
      var k = mAdd(mKeyNow(), i);
      var o = document.createElement('option');
      o.value = k; o.textContent = k + (i === 0 ? ' · hiện tại' : '');
      sel.appendChild(o);
    }
    sel.value = mKeyNow();
    sel.addEventListener('change', function () {
      fcFilterMonthKey = sel.value;
      fcRenderChips(); fcRenderKpis(); fcRenderTable();
    });
  }

  function fcRenderChips() {
    var box = $('fcChips');
    if (!box || !fcDeals) return;

    if (fcFocusId) {
      box.innerHTML =
        '<span class="fc-focus-banner">🔗 Đang xem 1 deal: <b>' + esc(fcFocusName || fcFocusId) + '</b></span>' +
        '<button class="chip-btn fc-focus-clear" id="fcClearFocusBtn">✕ Bỏ lọc, xem tất cả</button>';
      var clearBtn = $('fcClearFocusBtn');
      if (clearBtn) clearBtn.addEventListener('click', fcClearFocus);
      var noteEl = $('fcFilterNote');
      if (noteEl) noteEl.textContent = '· đang lọc theo deal được chọn';
      return;
    }

    var counts = { all: fcDeals.length, needNow: 0, missPast: 0, notYet: 0, dueSoon: 0, overdue: 0, over200: 0 };
    fcDeals.forEach(function (d) {
      var t = fcTags(d);
      Object.keys(t).forEach(function (k) { counts[k]++; });
    });
    box.innerHTML = FC_CHIPS.map(function (c) {
      var n = counts[c.key] || 0;
      var warn = (c.key === 'missPast' || c.key === 'overdue' || c.key === 'over200') && n > 0;
      return '<button class="chip-btn fc-chip' + (fcFilterKey === c.key ? ' active' : '') + (warn ? ' warn' : '') +
        '" data-fck="' + c.key + '">' + esc(c.label) + ' <b>' + n + '</b></button>';
    }).join('');
    box.querySelectorAll('.fc-chip').forEach(function (b) {
      b.addEventListener('click', function () {
        fcFilterKey = b.getAttribute('data-fck');
        fcRenderChips(); fcRenderTable();
      });
    });
    var note = $('fcFilterNote');
    if (note) {
      var cur = FC_CHIPS.find(function (c) { return c.key === fcFilterKey; });
      note.textContent = fcFilterKey === 'all' ? '' : '· lọc: ' + cur.label + ' — tháng ' + fcFilterMonthKey;
    }
  }

  function fcStatusBadge(s) {
    var cls = s === 'Đúng hạn' ? 'st-ok'
            : s === 'Đang triển khai' ? 'st-wip'
            : s === 'Quá 200% → dồn CR1' ? 'st-over' : 'st-late';
    return '<span class="badge ' + cls + '">' + esc(s) + '</span>';
  }
  function fcChsBadge(v) {
    if (v == null) return '<span class="badge chs-none">—</span>';
    return '<span class="badge chs-' + healthBand(v) + '">' + String(v).replace('.', ',') + '</span>';
  }
  // (fcMonthCmp cũ đã gộp vào mCmp ở trên — dùng chung 1 hàm so sánh tháng MM/YYYY)
  function fcFlag(t) { var el = $('fcFlag'); if (el) el.textContent = t; }

  function fcSetKpi(id, val, cnt) {
    var el = $(id), sub = $(id + 'Sub');
    if (val == null) { el.textContent = '—'; el.style.color = ''; if (sub) sub.textContent = 'chưa có deal nào đo'; return; }
    el.textContent = String(val).replace('.', ',');
    el.style.color = 'var(--' + healthBand(val) + ')';
    if (sub) sub.textContent = cnt + ' deal đã đo · ' + BAND_LABEL[healthBand(val)];
  }

  function renderForecast() {
    if (!fcLoaded) { fcLoad(); return; }
    try {
      fcInitFilterMonth(); fcRenderChips(); fcRenderKpis(); fcRenderTable();
      if (fcView === 'multi') { mcRenderFilterMonth(); mcRenderTable(); }   // NEW
    } catch (err) {
      console.error('renderForecast error:', err);
      showToast('Lỗi hiển thị Forecast: ' + err.message, 'err');
    }
    // Dữ liệu đã cũ (> 5 phút) và không có ô nào đang sửa dở chưa lưu
    // -> âm thầm tải lại bản mới nhất từ sheet, không làm gián đoạn màn hình.
    if (Date.now() - lastFetchForecast > STALE_MS && Object.keys(fcState).length === 0) {
      fcLoad(true);
    }
  }

  function fcLoad(isBackgroundRefresh, onDone) {
    var token = localStorage.getItem('cs_tool_token');
    var empty = $('fcEmpty');
    if (empty && !isBackgroundRefresh) { empty.style.display = 'block'; empty.textContent = 'Đang tải dữ liệu từ sheet Database…'; }
    fetch(CFG.API_URL + '?token=' + encodeURIComponent(token) + '&sheet=Database')
      .then(function (r) { return r.text(); })
      .then(function (text) { return JSON.parse(text); })
      .then(function (data) {
        saveSessionToken_(data);
        if (!data.ok) {
          if (data.error !== 'invalid_token') {
            if (empty) { empty.style.display = 'block'; empty.textContent = 'Không tải được dữ liệu: ' + (data.error || 'lỗi không rõ') + ' — thử bấm "Làm mới".'; }
            showToast('Forecast: ' + (data.error || 'lỗi không rõ') + ' — thử lại sau.', 'err');
            return;
          }
          if (empty) { empty.style.display = 'block'; empty.textContent = 'Phiên đăng nhập đã hết hạn — vui lòng đăng nhập lại.'; }
          localStorage.removeItem('cs_tool_token');
          localStorage.removeItem(SESSION_KEY);
          resetGoogleButton();
          setUiMode('login');
          return;
        }
        fcDeals = (data.deals || []).map(fcNormalize).filter(function (d) { return d.id; });
        fcSeed(); fcLoaded = true; lastFetchForecast = Date.now();
        if (empty) empty.style.display = fcDeals.length ? 'none' : 'block';
        if (empty && !fcDeals.length) empty.textContent = 'Sheet Database chưa có deal nào.';
        fcInitFilterMonth();
        fcRenderChips();
        fcRenderKpis(); fcRenderTable();
        if (fcView === 'multi') mcRenderTable();   // NEW
        if (typeof onDone === 'function') onDone();
      })
      .catch(function (err) {
        console.error('fcLoad error:', err);
        // Quan trọng: luôn hiện lại khối empty khi có lỗi, kể cả khi trước đó
        // đã bị ẩn đi (display:none) — nếu không, lỗi sẽ không hiển thị gì cả
        // dù textContent đã được set (đây chính là nguyên nhân bug "im lặng").
        if (empty) { empty.style.display = 'block'; empty.textContent = 'Không tải được dữ liệu forecast: ' + err.message; }
        showToast('Forecast: không tải được dữ liệu — ' + err.message, 'err');
      });
  }

  function fcRenderKpis() {
    if (!fcDeals) return;
    var rows = fcDeals.map(fcCompute);
    var t1 = rows.filter(function (r) { return r.cT1 != null; });
    var t4 = rows.filter(function (r) { return r.cT4 != null; });
    var a1 = t1.length ? Math.round(t1.reduce(function (s, r) { return s + r.cT1; }, 0) / t1.length * 10) / 10 : null;
    var a4 = t4.length ? Math.round(t4.reduce(function (s, r) { return s + r.cT4; }, 0) / t4.length * 10) / 10 : null;
    fcSetKpi('fcAvgT1', a1, t1.length);
    fcSetKpi('fcAvgT4', a4, t4.length);

    // NEW — điểm U & O trung bình (2 cấu phần tạo nên CHS_CS: 70% U + 30% O).
    // Tier 4 không có điểm U (CHS = 100% Output) nên bị loại khỏi phần trung bình U.
    var avgUO = function (ky) {
      var us = [], os = [];
      fcDeals.forEach(function (d) {
        var v = fcEff(d);
        var a = (ky === 'T1') ? v.aT1 : v.aT4;
        var o = (ky === 'T1') ? v.oT1 : v.oT4;
        var u = fcUPoint(d.tierNum, a);
        if (u != null) us.push(u);
        if (o != null && o !== '') os.push(+o);
      });
      var mean = function (arr) { return arr.length ? Math.round(arr.reduce(function (s, x) { return s + x; }, 0) / arr.length * 10) / 10 : null; };
      return { u: mean(us), o: mean(os) };
    };
    var fmtUO = function (id, x) {
      var el = $(id); if (!el) return;
      var t = function (v) { return v == null ? '—' : String(v).replace('.', ','); };
      el.innerHTML = '<span class="uo-pill uo-u">U ' + t(x.u) + '</span><span class="uo-pill uo-o">O ' + t(x.o) + '</span>';
    };
    fmtUO('fcUoT1', avgUO('T1'));
    fmtUO('fcUoT4', avgUO('T4'));

    // NEW — "Tổng ACR" = ΣACR toàn bộ deal; phần đủ điều kiện COM đưa xuống dòng phụ
    var totalAcr = fcDeals.reduce(function (s, d) { return s + (d.acr || 0); }, 0);
    var eligible = rows.reduce(function (s, r) { return s + r.acrT1 + r.acrT4; }, 0);
    $('fcElig').textContent = fmtMoney(totalAcr);
    var eligSub = $('fcEligSub');
    if (eligSub) eligSub.textContent = 'Đủ điều kiện COM (CHS ≥ 50): ' + fmtMoneyShort(eligible);

    var byM = {};
    fcDeals.forEach(function (d, i) {
      var r = rows[i], m = d.crMonth || '—';
      if (!byM[m]) byM[m] = { phai: 0, sach: 0, dat: 0 };
      byM[m].phai += d.dtPhai || 0;
      if (!r.late) byM[m].sach += d.dtPhai || 0;
      byM[m].dat += r.dtDat;
    });
    // Dùng chung 1 bộ chọn tháng duy nhất (fcFilterMonthKey) cho cả bộ lọc chip
    // lẫn ô KPI "DT cần go-live".
    var cur = fcFilterMonthKey || mKeyNow();
    var cd = byM[cur] || { phai: 0, sach: 0, dat: 0 };
    $('fcPress').textContent = fmtMoney(cd.sach);
    $('fcPressSub').textContent = 'gồm cả muộn: ' + fmtMoneyShort(cd.phai) + ' · đã go-live: ' + fmtMoneyShort(cd.dat);
    var lbl = $('fcPressMonthLabel'); if (lbl) lbl.textContent = 'tháng ' + cur;
  }

  function fcRenderTable() {
    if (!fcDeals) return;
    var tb = $('fcTbody');
    var list = fcFilteredDeals();
    var empty = $('fcEmpty');
    if (empty) {
      empty.style.display = list.length ? 'none' : 'block';
      if (!list.length) empty.textContent = fcFocusId
        ? 'Không tìm thấy deal này trong danh sách của bạn (có thể đã đổi người phụ trách).'
        : fcDeals.length
          ? 'Không có deal nào thuộc nhóm này trong tháng ' + fcFilterMonthKey + ' — thử chip khác hoặc "Tất cả".'
          : 'Sheet Database chưa có deal nào.';
    }
    tb.innerHTML = list.map(function (d) {
      var r = fcCompute(d);
      var inp = function (f, cls) {
        var type = (f === 'goLive') ? 'date' : 'number';
        var placeholder = (f === 'goLive') ? '' : (cls.indexOf('pct') > -1 ? '0-100' : '');
        // Giá trị gốc lấy từ sheet Database (khi user chưa sửa gì)
        var orig = (f === 'goLive') ? (d.glActual0 ? fmtDate(d.glActual0) : '')
                 : (f === 'aT1') ? d.aT1_0
                 : (f === 'oT1') ? d.oT1_0
                 : (f === 'aT4') ? d.aT4_0
                 : (f === 'oT4') ? d.oT4_0 : null;
        // Nếu user đã sửa ô này (còn trong fcState, chưa lưu) thì ưu tiên giá trị đã sửa
        var edited = !!(fcState[d.id] && fcState[d.id][f] !== undefined);
        var current = edited ? fcState[d.id][f] : orig;
        var displayVal;
        if (type === 'date') {
          displayVal = '';
          if (current) {
            var s = String(current);
            var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
            if (m) displayVal = m[3] + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[1]).padStart(2, '0');
            else if (/^\d{4}-\d{2}-\d{2}$/.test(s)) displayVal = s; // đã ở định dạng input date
          }
        } else {
          displayVal = (current == null ? '' : current);
        }
        return '<input class="fc-in ' + cls + (edited ? ' fc-edited' : '') + '" type="' + type + '" data-id="' + esc(d.id) + '" data-f="' + f + '" value="' + esc(displayVal) + '"'
             + (placeholder ? ' placeholder="' + placeholder + '"' : '') + (type === 'number' && cls.indexOf('pct') > -1 ? ' min="0" max="100"' : '') + '>';
      };
      return '<tr id="fc-row-' + esc(d.id) + '">' +
        '<td><div class="deal-name">' + esc(d.company) + '</div><div class="deal-id">' + esc(dealSubLine(d)) + '</div></td>' +
        '<td class="fc-extra"><span class="badge role">' + esc(d.contract) + '</span></td>' +
        '<td class="num fc-extra">' + fmtMoneyShort(d.val) + '</td>' +
        '<td class="fc-y fc-yL">' + inp('goLive', 'fc-date') + '</td>' +
        '<td class="fc-y num">' + inp('aT1', 'fc-pct') + '</td>' +
        '<td class="fc-y num">' + inp('oT1', 'fc-pct') + '</td>' +
        '<td class="fc-y num">' + inp('aT4', 'fc-pct') + '</td>' +
        '<td class="fc-y num fc-yR">' + inp('oT4', 'fc-pct') + '</td>' +
        '<td class="num" data-c="cT1">' + fcChsBadge(r.cT1) + '</td>' +
        '<td class="num" data-c="cT4">' + fcChsBadge(r.cT4) + '</td>' +
        '<td class="fc-extra">' + (d.tierNum ? 'Tier ' + d.tierNum : '—') + '</td>' +
        '<td class="fc-extra" data-c="status">' + fcStatusBadge(r.status) + '</td>' +
        '<td class="fc-extra">' + esc(d.crMonth || '—') + '</td>' +
        '<td class="num fc-extra">' + fmtMoneyShort(d.acr) + '</td>' +
        '</tr>';
    }).join('');

    tb.querySelectorAll('.fc-in').forEach(function (el) {
      el.addEventListener('change', function () {
        fcEdit(el.getAttribute('data-id'), el.getAttribute('data-f'), el.value);
      });
    });
  }

  function fcEdit(id, field, val) {
    if (field !== 'goLive') { val = (val === '' ? null : (isNaN(+val) ? null : +val)); }
    var d = fcDeals.find(function (x) { return x.id === id; });
    if (!d) return;
    // Compare with original value
    var origVal = null;
    if (field === 'goLive') origVal = d.glActual0 ? fmtDate(d.glActual0) : '';
    else if (field === 'aT1') origVal = d.aT1_0;
    else if (field === 'oT1') origVal = d.oT1_0;
    else if (field === 'aT4') origVal = d.aT4_0;
    else if (field === 'oT4') origVal = d.oT4_0;
    if (val === origVal) { if (fcState[id]) delete fcState[id][field]; return; } // remove from edit if reset to original
    if (!fcState[id]) fcState[id] = {};
    fcState[id][field] = val;
    var el = document.querySelector('[data-id="' + id + '"][data-f="' + field + '"]');
    if (el) el.classList.add('fc-edited');
    fcUpdateRow(id);
    fcRenderKpis();
    fcRenderChips();
    fcFlag('• chưa lưu về sheet');
  }

  function fcUpdateRow(id) {
    var d = fcDeals.find(function (x) { return x.id === id; }); if (!d) return;
    var r = fcCompute(d), row = document.getElementById('fc-row-' + id); if (!row) return;
    row.querySelector('[data-c="status"]').innerHTML = fcStatusBadge(r.status);
    row.querySelector('[data-c="cT1"]').innerHTML = fcChsBadge(r.cT1);
    row.querySelector('[data-c="cT4"]').innerHTML = fcChsBadge(r.cT4);
  }

  function fcSave() {
    if (!fcDeals) return;
    var token = localStorage.getItem('cs_tool_token');
    var edited = [];
    fcDeals.forEach(function (d) {
      if (fcState[d.id]) {
        var e = fcState[d.id];
        // QUAN TRỌNG: nếu user không đụng vào ô Go-live thì giữ nguyên giá trị đã lưu
        // trên sheet (trước đây gửi chuỗi rỗng → backend xóa mất ngày go-live).
        var gl = (e.goLive !== undefined)
          ? (e.goLive || '')
          : (d.glActual0 ? fmtDate(d.glActual0) : '');
        // convert HTML5 date (yyyy-mm-dd) back to dd/mm/yyyy
        if (gl.match(/^\d{4}-\d{2}-\d{2}$/)) {
          var p = gl.split('-');
          gl = p[2] + '/' + p[1] + '/' + p[0];
        }
        edited.push({ 
          dealId: d.id, goLive: gl,
          aT1: (e.aT1 !== undefined) ? e.aT1 : d.aT1_0,
          oT1: (e.oT1 !== undefined) ? e.oT1 : d.oT1_0,
          aT4: (e.aT4 !== undefined) ? e.aT4 : d.aT4_0,
          oT4: (e.oT4 !== undefined) ? e.oT4 : d.oT4_0,
        });
      }
    });
    if (edited.length === 0) { fcFlag('không có gì để lưu'); return; }
    fcFlag('đang lưu ' + edited.length + ' deal…');
    fetch(CFG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ token: token, rows: edited }),
    })
      .then(function (r) { return r.text(); })
      .then(function (text) {
        var d; try { d = JSON.parse(text); } catch (e) { d = { ok: true }; }
        saveSessionToken_(d);
        if (d.ok) {
          document.querySelectorAll('.fc-in.fc-edited').forEach(function(el) { el.classList.remove('fc-edited'); });
          fcFlag('✓ đã lưu ' + edited.length + ' deal · ' + new Date().toLocaleTimeString('vi-VN'));
        } else {
          fcFlag('⚠ lưu lỗi');
        }
      })
      .catch(function (err) { fcFlag('⚠ lưu lỗi: ' + err.message); });
  }

  // =========================================================
  // ACR NHIỀU NĂM (Năm 2 → Năm 5) — mở rộng của Forecast
  // =========================================================
  var mcState = {};              // key = dealId + '|' + year + '|' + ky  ->  { a, o }
  var mcFilterMonthKey = mKeyNow();
  var fcView = 'y1';             // 'y1' | 'multi' — sub-tab đang xem trong Forecast
  var fcSearchQuery = '';        // search box Forecast (dùng chung cho cả 2 sub-tab)

  function mcEff(d, n, ky) {
    var key = d.id + '|' + n + '|' + ky;
    var e = mcState[key] || {};
    var y = (d.years && d.years[n]) || {};
    var a0 = (ky === 'T1') ? y.aT1_0 : y.aT4_0;
    var o0 = (ky === 'T1') ? y.oT1_0 : y.oT4_0;
    return { a: (e.a !== undefined) ? e.a : a0, o: (e.o !== undefined) ? e.o : o0 };
  }

  // %Output của kỳ liền trước (năm N-1 cùng kỳ T1/T4) — dùng làm gợi ý
  function mcPrevOutput(d, n, ky) {
    if (n <= 2) return (ky === 'T1') ? d.oT1_0 : d.oT4_0;      // năm 2 → gợi ý theo năm 1
    return mcEff(d, n - 1, ky).o;
  }

  // CHS_CS của 1 (deal, năm, kỳ) — TÁI DÙNG đúng công thức năm 1 (fcUPoint, tier 4 = 100% Output)
  function mcChs(d, n, ky) {
    var v = mcEff(d, n, ky);
    if (v.o == null || v.o === '') return null;
    var t = d.tierNum;
    if (t === 4) return +v.o;
    var u = fcUPoint(t, v.a); if (u == null) return null;
    return Math.round((0.7 * u + 0.3 * v.o) * 10) / 10;
  }

  // Các (năm, kỳ) của 1 deal có "Tháng nhận Com" khớp đúng tháng đang lọc
  function mcMatches(d, monthKey) {
    var out = [];
    for (var n = 2; n <= 5; n++) {
      var y = d.years && d.years[n]; if (!y) continue;
      if (y.mT1 && y.mT1 === monthKey) out.push({ n: n, ky: 'T1', month: y.mT1 });
      if (y.mT4 && y.mT4 === monthKey) out.push({ n: n, ky: 'T4', month: y.mT4 });
    }
    return out;
  }

  // Gộp toàn bộ deal khớp 1 tháng — dùng cho cả bảng nhập liệu lẫn Scorecard
  function mcAllMatches(monthKey) {
    var rows = [];
    (fcDeals || []).forEach(function (d) {
      mcMatches(d, monthKey).forEach(function (m) { rows.push({ d: d, n: m.n, ky: m.ky, month: m.month }); });
    });
    return rows;
  }

  function mcRenderFilterMonth() {
    var sel = $('mcFilterMonth');
    if (!sel || sel.options.length) return;
    for (var i = -6; i <= 24; i++) {                     // ACR nhiều năm cần nhìn xa hơn tháng thường
      var k = mAdd(mKeyNow(), i);
      var o = document.createElement('option');
      o.value = k; o.textContent = k + (i === 0 ? ' · hiện tại' : '');
      sel.appendChild(o);
    }
    sel.value = mKeyNow();
    sel.addEventListener('change', function () { mcFilterMonthKey = sel.value; mcRenderTable(); });
  }

  function mcRenderTable() {
    var tb = $('mcTbody'), empty = $('mcEmpty');
    if (!tb || !fcDeals) return;
    var rows = mcAllMatches(mcFilterMonthKey);
    if (fcSearchQuery) rows = rows.filter(function (r) { return dealMatchesQuery(r.d, fcSearchQuery); });

    if (empty) {
      empty.style.display = rows.length ? 'none' : 'block';
      if (!rows.length) empty.textContent = 'Không có deal nào có kỳ nhận Com (Năm 2-5) rơi vào tháng ' + mcFilterMonthKey + '.';
    }

    tb.innerHTML = rows.map(function (row) {
      var d = row.d, n = row.n, ky = row.ky, key = d.id + '|' + n + '|' + ky;
      var eff = mcEff(d, n, ky);
      var chs = mcChs(d, n, ky);
      var prevOut = mcPrevOutput(d, n, ky);
      var inp = function (field, val) {
        var edited = !!(mcState[key] && mcState[key][field] !== undefined);
        return '<input class="fc-in mc-in fc-pct' + (edited ? ' fc-edited' : '') + '" type="number" min="0" max="100" placeholder="0-100" ' +
          'data-key="' + esc(key) + '" data-field="' + field + '" value="' + esc(val == null ? '' : val) + '">';
      };
      return '<tr id="mc-row-' + esc(key) + '">' +
        '<td><div class="deal-name">' + esc(d.company) + '</div><div class="deal-id">' + esc(dealSubLine(d)) + '</div></td>' +
        '<td><span class="badge ' + (ky === 'T1' ? 'ky-t1' : 'ky-t4') + '">' + ky + ' · Năm ' + n + '</span></td>' +
        '<td class="fc-extra">' + esc(row.month) + '</td>' +
        '<td class="fc-y num">' + inp('a', eff.a) + '</td>' +
        '<td class="fc-y num">' + inp('o', eff.o) +
          (prevOut != null
            ? '<div class="mc-hint">gợi ý năm trước: <b>' + String(prevOut).replace('.', ',') + '%</b> ' +
              '<button type="button" class="mc-use-hint" data-key="' + esc(key) + '" data-val="' + prevOut + '">dùng</button></div>'
            : '') +
        '</td>' +
        '<td class="num" data-c="chs">' + fcChsBadge(chs) + '</td>' +
        '<td class="num fc-extra">' + fmtMoneyShort(d.acr) + '</td>' +
        '</tr>';
    }).join('');

    tb.querySelectorAll('.mc-in').forEach(function (el) {
      el.addEventListener('change', function () { mcEdit(el.getAttribute('data-key'), el.getAttribute('data-field'), el.value); });
    });
    tb.querySelectorAll('.mc-use-hint').forEach(function (btn) {
      btn.addEventListener('click', function () {
        mcEdit(btn.getAttribute('data-key'), 'o', btn.getAttribute('data-val'));
        mcRenderTable();
      });
    });
  }

  function mcEdit(key, field, val) {
    val = (val === '' ? null : (isNaN(+val) ? null : +val));
    if (!mcState[key]) mcState[key] = {};
    mcState[key][field] = val;
    var row = document.getElementById('mc-row-' + key);
    if (row) {
      var parts = key.split('|');
      row.querySelector('[data-c="chs"]').innerHTML = fcChsBadge(mcChs(fcDeals.find(function (x) { return x.id === parts[0]; }), +parts[1], parts[2]));
    }
    mcFlag('• chưa lưu về sheet');
  }

  function mcFlag(t) { var el = $('mcFlag'); if (el) el.textContent = t; }

  function mcSave() {
    var token = localStorage.getItem('cs_tool_token');
    var keys = Object.keys(mcState);
    if (!keys.length) { mcFlag('không có gì để lưu'); return; }
    var rows = keys.map(function (key) {
      var parts = key.split('|');                 // [dealId, year, ky]
      var d = fcDeals.find(function (x) { return x.id === parts[0]; });
      var eff = mcEff(d, +parts[1], parts[2]);
      return { dealId: parts[0], year: +parts[1], period: parts[2], active: eff.a, output: eff.o };
    });
    mcFlag('đang lưu ' + rows.length + ' mục…');
    fetch(CFG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ token: token, multiYearRows: rows }),
    })
      .then(function (r) { return r.text(); })
      .then(function (text) {
        var d; try { d = JSON.parse(text); } catch (e) { d = { ok: true }; }
        saveSessionToken_(d);
        if (d.ok) {
          // QUAN TRỌNG: cập nhật thẳng vào fcDeals (bộ nhớ) đúng số vừa lưu, để
          // Scorecard tính CHS_CS/commission ngay lập tức. Trước đây xoá mcState
          // ngay mà KHÔNG cập nhật fcDeals → mcEff() rơi về d.years[n] cũ (thường
          // trống), khiến Scorecard "không thấy" số vừa lưu dù sheet đã có đúng dữ
          // liệu, phải bấm "Làm mới" thủ công mới lên. Patch trực tiếp thế này còn
          // tránh phải gọi lại server (khỏi lo mất các ô Năm 1 đang sửa dở, nếu có).
          rows.forEach(function (row) {
            var deal = fcDeals.find(function (x) { return x.id === row.dealId; });
            if (!deal || !deal.years || !deal.years[row.year]) return;
            var y = deal.years[row.year];
            if (row.period === 'T1') { y.aT1_0 = row.active; y.oT1_0 = row.output; }
            else { y.aT4_0 = row.active; y.oT4_0 = row.output; }
          });
          mcState = {};
          mcFlag('✓ đã lưu ' + rows.length + ' mục · ' + new Date().toLocaleTimeString('vi-VN'));
          showToast('Đã lưu ACR nhiều năm — chuyển sang Scorecard xem commission', 'ok');
          dbMonthKey = mcFilterMonthKey;
          var dbSel = $('dbMonth'); if (dbSel) dbSel.value = mcFilterMonthKey;
          switchTab('dashboard');
        } else {
          mcFlag('⚠ lưu lỗi — backend chưa xử lý multiYearRows?');
        }
      })
      .catch(function (err) { mcFlag('⚠ lưu lỗi: ' + err.message); });
  }

  // Toggle sub-tab Năm 1 / ACR nhiều năm trong Forecast
  function fcSetView(v, fromRoute) {
    fcView = v;
    if (!fromRoute) setRoute(v === 'multi' ? 'forecast/multi-year' : 'forecast');
    document.querySelectorAll('.fc-view-btn').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-view') === v);
    });
    var y1 = $('fcYear1Block'), mc = $('fcMultiBlock');
    if (y1) y1.style.display = (v === 'y1') ? 'block' : 'none';
    if (mc) mc.style.display = (v === 'multi') ? 'block' : 'none';
    if (v === 'multi') { mcRenderFilterMonth(); mcRenderTable(); }
  }

  // =========================================================
  // DASHBOARD TAB — dữ liệu đã tính ở sheet Database + quy định policy
  // (mục 6.2 Performance, 6.3 Commission năm đầu, 6.5 thưởng Upsale/Cross)
  // =========================================================
  var dbMonthKey = mKeyNow();
  var dbMonthInit = false;

  function dashInitMonth() {
    var sel = $('dbMonth');
    if (dbMonthInit || !sel) return;
    var set = {};
    (fcDeals || []).forEach(function (d) {
      [d.crMonth, d.monthT1, d.monthT4].forEach(function (k) { if (k) set[k] = 1; });
    });
    set[mKeyNow()] = 1;
    Object.keys(set).sort(mCmp).forEach(function (k) {
      var o = document.createElement('option');
      o.value = k; o.textContent = k + (k === mKeyNow() ? ' · hiện tại' : '');
      sel.appendChild(o);
    });
    sel.value = mKeyNow();
    sel.addEventListener('change', function () { dbMonthKey = sel.value; renderDashboard(); });
    dbMonthInit = true;
  }

  // ---- Chỉ số tháng: CR / SRR_1 / SRR_4 / Doanh thu go-live ----
  function dashPerf(m) {
    var crDeals = [], t1Deals = [], t4Deals = [];
    fcDeals.forEach(function (d) {
      if (d.crMonth === m) crDeals.push(d);
      if (d.monthT1 === m) t1Deals.push(d);
      if (d.monthT4 === m) t4Deals.push(d);
    });
    var sumPhai = 0, sumDat = 0;
    crDeals.forEach(function (d) {
      var r = fcCompute(d);
      sumPhai += d.dtPhai || 0;
      sumDat += r.dtDat;
    });
    var cr = (crDeals.length && sumPhai > 0) ? Math.round(sumDat / sumPhai * 1000) / 10 : null;

    // SRR theo policy: Σ DT phần mềm có CHS_CS ≥ 50 ÷ Σ DT phần mềm cần tính tại tháng đo
    function srr(list, ky) {
      if (!list.length) return { v: null, nOk: 0, n: 0, sumOk: 0, sumAll: 0 };
      var sumAll = 0, sumOk = 0, nOk = 0;
      list.forEach(function (d) {
        var r = fcCompute(d);
        var c = (ky === 'T1') ? r.cT1 : r.cT4;
        var v = d.val || 0;
        sumAll += v;
        if (c != null && c >= 50) { sumOk += v; nOk++; }
      });
      return { v: sumAll > 0 ? Math.round(sumOk / sumAll * 1000) / 10 : null, nOk: nOk, n: list.length, sumOk: sumOk, sumAll: sumAll };
    }
    var s1 = srr(t1Deals, 'T1'), s4 = srr(t4Deals, 'T4');

    // Doanh thu go-live trong tháng — chỉ tính hợp đồng New / Upsale / Cross sale (mục 6.2)
    var rev = 0;
    crDeals.forEach(function (d) {
      if (/new|upsale|cross/i.test(d.contract)) rev += fcCompute(d).dtDat;
    });
    return { m: m, crDeals: crDeals, t1Deals: t1Deals, t4Deals: t4Deals, cr: cr, sumPhai: sumPhai, sumDat: sumDat, s1: s1, s4: s4, rev: rev };
  }

  // ---- Xếp loại Performance: xét đồng thời + loại trừ chỉ số trống (mục 6.2) ----
  function dashRating(def, p) {
    if (def.group === 'CSA') {
      if (!p.crDeals.length) return 'none';
      if (p.rev >= def.rev.out) return 'out';
      if (p.rev >= def.rev.goal) return 'goal';
      if (p.rev >= def.rev.kpi) return 'kpi';
      return 'under';
    }
    var vals = { cr: p.cr, s1: p.s1.v, s4: p.s4.v };
    var present = Object.keys(vals).filter(function (k) { return vals[k] != null; });
    if (!present.length) return 'none'; // cả 3 chỉ số trống → không xếp loại (không bị Under)
    function meets(tier) {
      var th = def.perf[tier];
      var ok = present.every(function (k) { return vals[k] >= th[k]; });
      if (tier === 'out') ok = ok && p.rev >= th.rev; // mốc OUT yêu cầu thêm doanh thu go-live
      return ok;
    }
    if (meets('out')) return 'out';
    if (meets('goal')) return 'goal';
    if (meets('kpi')) return 'kpi';
    return 'under';
  }

  function ratingBadge(r) {
    return '<span class="rating-badge rt-' + r + '">' + RATING_LABEL[r] + '</span>';
  }

  function perfBar(val, th) {
    var v = (val == null) ? 0 : Math.max(0, Math.min(100, val));
    var ticks = '';
    if (th) {
      [['kpi', th.kpi], ['goal', th.goal], ['out', th.out]].forEach(function (t) {
        ticks += '<span class="pf-tick t-' + t[0] + '" style="left:' + t[1] + '%" title="' + t[0].toUpperCase() + ': ' + t[1] + '%"></span>';
      });
    }
    var cls = 'pf-fill';
    if (val != null && th) cls += (val >= th.out ? ' f-out' : val >= th.goal ? ' f-goal' : val >= th.kpi ? ' f-kpi' : ' f-under');
    return '<div class="pf-track"><div class="' + cls + '" style="width:' + v + '%"></div>' + ticks + '</div>';
  }

  function dashRenderPerf(def, p, rating) {
    var grid = $('perfGrid');
    var cards = [];
    var pctTxt = function (v) { return v == null ? '—' : String(v).replace('.', ',') + '%'; };

    if (def.group === 'CSA') {
      var pctOfOut = p.rev && def.rev.out ? Math.min(100, Math.round(p.rev / def.rev.out * 100)) : 0;
      cards.push(
        '<div class="pf-card"><div class="kpi-label">Doanh thu go-live tháng ' + esc(p.m) + '</div>' +
        '<div class="pf-val">' + fmtMoneyShort(p.rev) + '</div>' +
        '<div class="pf-track"><div class="pf-fill f-kpi" style="width:' + pctOfOut + '%"></div></div>' +
        '<div class="kpi-sub">KPI ' + fmtMoneyShort(def.rev.kpi) + ' · GOAL ' + fmtMoneyShort(def.rev.goal) + ' · OUT ' + fmtMoneyShort(def.rev.out) + '</div></div>'
      );
    } else {
      var th = def.perf;
      var mk = function (label, val, key, sub) {
        var excluded = (val == null);
        return '<div class="pf-card' + (excluded ? ' pf-empty' : '') + '">' +
          '<div class="kpi-label">' + label + '</div>' +
          '<div class="pf-val">' + (excluded ? '<span class="pf-none">trống · loại trừ</span>' : pctTxt(val)) + '</div>' +
          perfBar(val, { kpi: th.kpi[key], goal: th.goal[key], out: th.out[key] }) +
          '<div class="kpi-sub">KPI ≥ ' + th.kpi[key] + '% · GOAL ≥ ' + th.goal[key] + '% · OUT ≥ ' + th.out[key] + '%' + (sub ? ' — ' + sub : '') + '</div></div>';
      };
      cards.push(mk('CR — tỷ lệ DT go-live', p.cr, 'cr', p.crDeals.length ? fmtMoneyShort(p.sumDat) + ' / ' + fmtMoneyShort(p.sumPhai) + ' · ' + p.crDeals.length + ' deal' : 'không có deal đến hạn CR'));
      cards.push(mk('SRR_1 — thành công sau 1 tháng', p.s1.v, 's1', p.t1Deals.length ? p.s1.nOk + '/' + p.s1.n + ' deal đạt CHS ≥ 50' : 'không có kỳ đo T1'));
      cards.push(mk('SRR_4 — thành công sau 4 tháng', p.s4.v, 's4', p.t4Deals.length ? p.s4.nOk + '/' + p.s4.n + ' deal đạt CHS ≥ 50' : 'không có kỳ đo T4'));
      cards.push(
        '<div class="pf-card"><div class="kpi-label">DT go-live (New/Up/Cross)</div>' +
        '<div class="pf-val">' + fmtMoneyShort(p.rev) + '</div>' +
        '<div class="kpi-sub">Điều kiện thêm của mốc OUT: ≥ ' + fmtMoneyShort(th.out.rev) + '</div></div>'
      );
    }
    grid.innerHTML = cards.join('');

    var note;
    if (rating === 'none') note = 'Cả 3 chỉ số đều không phát sinh dữ liệu trong tháng → <b>không xếp loại</b>, không bị ghi nhận Under KPI.';
    else if (rating === 'under') note = def.group === 'CSA'
      ? 'Dưới mốc KPI — CS_A không có commission hỗ trợ Under KPI theo bảng 6.3.'
      : 'Dưới mốc KPI — áp dụng commission hỗ trợ: T1 = 1% · T4 = 0.5% trên ACR go-live thành công (CHS_CS ≥ 50).';
    else note = 'Xét đồng thời các chỉ số có phát sinh dữ liệu; chỉ số trống được tự động loại trừ.';
    $('perfRating').innerHTML = '<span class="pr-label">Xếp loại tháng ' + esc(p.m) + ':</span> ' + ratingBadge(rating) + '<span class="pr-note">' + note + '</span>';
  }

  // ---- Bảng commission tháng (mục 6.3 + 6.5) ----
  function dashRenderCommission(def, p, rating) {
    var tb = $('comTbody'), tf = $('comTfoot'), emptyEl = $('comEmpty');
    var rT1 = (rating !== 'none' && def.comT1) ? def.comT1[rating] : null;
    var rT4 = (rating !== 'none' && def.comT4) ? def.comT4[rating] : null;

    var hint = [];
    hint.push('Performance: ' + RATING_LABEL[rating]);
    hint.push('%Com T1: ' + (rT1 != null ? rT1 + '%' : '—'));
    hint.push('%Com T4: ' + (def.comT4 ? (rT4 != null ? rT4 + '%' : '—') : 'CS_A không áp dụng'));
    $('comRateHint').textContent = hint.join(' · ');

    // NEW — combo CS_PM + CS_A khi 1 mình cân cả deal (chính sách kiêm nhiệm — mục 4 policy:
    // "nhân sự CS sẽ được cộng dồn 100% quyền lợi của vị trí CS_A"). CS_A level 1 & 2 có cùng
    // 1 mức %Com T1 (1.5/2/2.3), không có T4 -> chỉ cộng vào rate T1. Chỉ áp dụng cho nhân sự
    // CS_PM (không tự cộng cho chính CS_A), và hiển thị %Com cuối cùng đã gộp, không lộ phép tính.
    var CS_A_ADDON_T1 = { under: null, kpi: 1.5, goal: 2, out: 2.3 };
    function comboRate(d, baseRate, ky) {
      if (baseRate == null) return null;
      if (def.group === 'CSA' || ky !== 'T1') return baseRate;
      var role = String(d.role || '').toUpperCase();
      var solo = role.indexOf('CS_PM') !== -1 && role.indexOf('CS_A') !== -1;
      if (!solo) return baseRate;
      var addon = CS_A_ADDON_T1[rating];
      return (addon != null) ? Math.round((baseRate + addon) * 100) / 100 : baseRate;
    }

    // NEW — tách riêng tổng Năm 1 và ACR nhiều năm để hiển thị rõ ràng, không gộp lẫn
    var rows = [];
    var totT1Y1 = 0, totT1Multi = 0, totT4Y1 = 0, totT4Multi = 0;
    var pushRows = function (list, ky, baseRate) {
      list.forEach(function (item) {
        var isMulti = !!item.n;
        var d = item.d || item;                              // deal thường HOẶC {d,n,ky,month} multi-year
        var monthTag = item.month || p.m;
        var chs = isMulti ? mcChs(d, item.n, ky) : fcCompute(d)[ky === 'T1' ? 'cT1' : 'cT4'];
        var pass = chs != null && chs >= 50;
        var rate = comboRate(d, baseRate, ky);
        var com = (pass && rate != null) ? Math.round((d.acr || 0) * rate / 100) : 0;
        if (ky === 'T1') { if (isMulti) totT1Multi += com; else totT1Y1 += com; }
        else { if (isMulti) totT4Multi += com; else totT4Y1 += com; }
        var nguonBadge = isMulti
          ? '<span class="badge yr-multi">Năm ' + item.n + '</span>'
          : '<span class="badge yr-1">Năm 1</span>';
        rows.push('<tr class="com-row' + (pass ? '' : ' com-fail') + (isMulti ? ' com-row-multi' : '') + '" data-id="' + esc(d.id) + '" data-name="' + esc(d.company) + '">' +
          '<td><div class="deal-name">' + esc(d.company) + '</div><div class="deal-id">' + esc(dealSubLine(d)) + '</div></td>' +
          '<td><span class="badge ' + (ky === 'T1' ? 'ky-t1' : 'ky-t4') + '">' + ky + ' · ' + esc(monthTag) + '</span></td>' +
          '<td>' + nguonBadge + '</td>' +
          '<td class="num">' + fmtMoney(d.acr) + '</td>' +
          '<td class="num">' + fcChsBadge(chs) + '</td>' +
          '<td>' + (chs == null ? '<span class="badge chs-none">chưa có số</span>' : pass ? '<span class="badge gl-done">Đạt ✓</span>' : '<span class="badge gl-overdue">Không đạt</span>') + '</td>' +
          '<td class="num">' + (pass && rate != null ? String(rate).replace('.', ',') + '%' : '—') + '</td>' +
          '<td class="num"><b>' + (com ? fmtMoney(com) : '—') + '</b></td>' +
          '</tr>');
      });
    };

    pushRows(p.t1Deals, 'T1', rT1);
    if (def.comT4) pushRows(p.t4Deals, 'T4', rT4);

    // NEW — ACR nhiều năm (Năm 2-5) khớp đúng tháng Scorecard đang xem, tính y hệt cơ chế năm 1
    var multi = mcAllMatches(p.m);
    var multiT1 = multi.filter(function (x) { return x.ky === 'T1'; });
    var multiT4 = multi.filter(function (x) { return x.ky === 'T4'; });
    pushRows(multiT1, 'T1', rT1);
    if (def.comT4) pushRows(multiT4, 'T4', rT4);

    // Thưởng Upsale / Cross sale — tháng nhận PL (≈ tháng nhận deal, mục 6.5)
    var usDeals = fcDeals.filter(function (d) {
      return d.received && mNorm(d.received) === p.m && /upsale|cross/i.test(d.contract);
    });
    var usBase = usDeals.reduce(function (s, d) { return s + (d.val || 0); }, 0);
    var usPct = upsaleBonusPct(usBase);
    var usBonus = Math.round(usBase * usPct / 100);

    tb.innerHTML = rows.join('');
    tb.querySelectorAll('.com-row').forEach(function (tr) {
      tr.addEventListener('click', function () {
        goToForecastDeal(tr.getAttribute('data-id'), tr.getAttribute('data-name'));
      });
    });
    emptyEl.style.display = rows.length ? 'none' : 'block';
    if (!rows.length) emptyEl.textContent = 'Không có deal nào tới kỳ đo T1/T4 (kể cả ACR nhiều năm) trong tháng ' + p.m + '.';

    var salary = profile ? parseMoney(profile.salary) : null;
    var totT1 = totT1Y1 + totT1Multi, totT4 = totT4Y1 + totT4Multi;
    var totalCom = totT1 + totT4 + usBonus;
    var frow = function (label, val, cls) {
      return '<tr class="' + (cls || '') + '"><td colspan="7">' + label + '</td><td class="num"><b>' + val + '</b></td></tr>';
    };
    tf.innerHTML =
      frow('Com hiệu quả triển khai 1 tháng · <span class="badge yr-1">Năm 1</span> (' + p.t1Deals.length + ' deal)', fmtMoney(totT1Y1)) +
      (multiT1.length ? frow('Com hiệu quả triển khai 1 tháng · <span class="badge yr-multi">ACR nhiều năm</span> (' + multiT1.length + ' deal)', fmtMoney(totT1Multi)) : '') +
      (def.comT4
        ? frow('Com hiệu quả triển khai 4 tháng · <span class="badge yr-1">Năm 1</span> (' + p.t4Deals.length + ' deal)', fmtMoney(totT4Y1)) +
          (multiT4.length ? frow('Com hiệu quả triển khai 4 tháng · <span class="badge yr-multi">ACR nhiều năm</span> (' + multiT4.length + ' deal)', fmtMoney(totT4Multi)) : '')
        : frow('Com 4 tháng — CS_A không áp dụng theo policy 6.3', '—')) +
      frow('Thưởng Upsale/Cross sale — DT ghi nhận ' + fmtMoneyShort(usBase) + ' (' + usDeals.length + ' PL) × ' + usPct + '%', fmtMoney(usBonus)) +
      frow('TỔNG COMMISSION THÁNG ' + p.m, fmtMoney(totalCom), 'com-total') +
      (salary != null
        ? frow('Lương cứng (' + esc(profile.level) + ')', fmtMoney(salary)) +
          frow('THU NHẬP ƯỚC TÍNH', fmtMoney(totalCom + salary), 'com-grand')
        : '');
  }

  // ---- Sức khỏe portfolio + deal cần cứu trước kỳ T4 ----
  function dashRenderHealth() {
    var counts = { strong: 0, healthy: 0, weak: 0, risk: 0, none: 0 };
    var rescue = [];
    fcDeals.forEach(function (d) {
      var r = fcCompute(d);
      var chs = (r.cT4 != null) ? r.cT4 : r.cT1;
      counts[healthBand(chs, null)]++;
      // đã đo T1 dưới 50 mà kỳ T4 chưa qua → còn cửa cứu trước khi chốt SRR_4/com T4
      if (r.cT1 != null && r.cT1 < 50 && d.monthT4 && mCmp(d.monthT4, dbMonthKey) >= 0) {
        rescue.push({ d: d, chs: r.cT1 });
      }
    });
    var total = fcDeals.length || 1;
    var order = ['strong', 'healthy', 'weak', 'risk', 'none'];
    $('dbHealthStrip').innerHTML = order.map(function (b) {
      var pct = counts[b] / total * 100;
      return pct ? '<div class="seg seg-' + b + '" style="flex-basis:' + pct + '%" title="' + BAND_LABEL[b] + ': ' + counts[b] + '"></div>' : '';
    }).join('');
    var cls = { strong: 'hp-strong', healthy: 'hp-healthy', weak: 'hp-weak', risk: 'hp-risk', none: 'hp-none' };
    $('dbHealthCounts').innerHTML = order.map(function (b) {
      return '<span class="health-pill ' + cls[b] + '"><span class="n">' + counts[b] + '</span> ' + BAND_LABEL[b] + '</span>';
    }).join('');
    rescue.sort(function (a, b) { return a.chs - b.chs; });
    $('dbRescue').innerHTML = !rescue.length
      ? '<div class="rescue-ok">Không có deal nào CHS_T1 &lt; 50 còn chờ kỳ T4 — ổn ✓</div>'
      : '<div class="rescue-head">⚠ Cần cứu trước kỳ đo T4 (CHS_T1 &lt; 50):</div>' +
        rescue.slice(0, 6).map(function (x) {
          return '<div class="rescue-item rescue-clickable" data-id="' + esc(x.d.id) + '" data-name="' + esc(x.d.company) + '">' +
            '<span class="rn">' + esc(x.d.company) + '</span>' +
            '<span class="rv">' + fcChsBadge(x.chs) + ' · T4: ' + esc(x.d.monthT4) + ' · ACR ' + fmtMoneyShort(x.d.acr) + ' →</span></div>';
        }).join('') + (rescue.length > 6 ? '<div class="rescue-more">… và ' + (rescue.length - 6) + ' deal khác</div>' : '');
    $('dbRescue').querySelectorAll('.rescue-clickable').forEach(function (el) {
      el.addEventListener('click', function () {
        goToForecastDeal(el.getAttribute('data-id'), el.getAttribute('data-name'));
      });
    });
  }

  // ---- Radar kỳ đo 3 tháng tới: ACR đang "treo" theo mốc T1/T4 ----
  function dashRenderRadar() {
    var rowsHtml = [];
    for (var i = 0; i < 3; i++) {
      var k = mAdd(dbMonthKey, i);
      var t1 = fcDeals.filter(function (d) { return d.monthT1 === k; });
      var t4 = fcDeals.filter(function (d) { return d.monthT4 === k; });
      var sum = function (l) { return l.reduce(function (s, d) { return s + (d.acr || 0); }, 0); };
      rowsHtml.push('<div class="radar-row' + (i === 0 ? ' cur' : '') + '">' +
        '<div class="radar-m">' + k + (i === 0 ? ' <small>· tháng chọn</small>' : '') + '</div>' +
        '<div class="radar-cell"><span class="badge ky-t1">T1</span> ' + t1.length + ' deal · ' + fmtMoneyShort(sum(t1)) + '</div>' +
        '<div class="radar-cell"><span class="badge ky-t4">T4</span> ' + t4.length + ' deal · ' + fmtMoneyShort(sum(t4)) + '</div>' +
        '</div>');
    }
    $('dbRadar').innerHTML = rowsHtml.join('') +
      '<div class="radar-hint">Nhập đủ %Active · %Output đúng kỳ đo để ACR không rơi khỏi nền commission.</div>';
  }

  function dashRenderNote(def) {
    var notes = [
      'Com = %com theo Performance × ACR các deal Go-live thành công (CHS_CS_T ≥ 50) — mục 6.3.',
      'SRR tính theo tổng giá trị HĐ phần mềm; nền com tính theo ACR — hai đơn vị khác nhau theo policy.',
      'Thưởng Upsale/Cross tính theo tháng nhận Phụ lục (tool lấy theo Ngày nhận deal) — mục 6.5.',
    ];
    if (profile && profile.level === 'CS level 7') {
      notes.push('Lưu ý: bảng com 4 tháng của CS level 7 trong policy đang trùng level 6 (3% · 3.3% · 3.5%) — tool giữ đúng văn bản.');
    }
    if (def.group === 'CS') {
      notes.push('Deal nào cột "Vai trò phụ trách" ghi cả CS_PM,CS_A (bạn tự cân, không có CS_A riêng) — tool đã tự cộng 100% %Com CS_A vào %Com T1 của bạn theo chính sách kiêm nhiệm (mục 4).');
    }
    $('dashNote').innerHTML = notes.map(function (n) { return '• ' + n; }).join('<br>');
  }

  function renderDashboard() {
    var body = $('dashBody'), emptyEl = $('dashEmpty');
    if (!body) return;

    var name = (profile && profile.hoTen) || currentEmail || '—';
    $('dbName').textContent = name;
    var lvDef = (profile && profile.level) ? LEVELS[profile.level] : null;
    $('dbSub').textContent = (profile && profile.level)
      ? profile.level + (lvDef ? ' · ' + lvDef.title : '') + (profile.salary ? ' · lương cứng ' + fmtMoney(parseMoney(profile.salary)) : '')
      : 'Chưa đăng ký level';
    var initials = String(name).trim().split(/\s+/).slice(-2).map(function (w) { return w.charAt(0).toUpperCase(); }).join('');
    $('dbAvatar').textContent = initials || 'CS';

    if (!fcLoaded) {
      emptyEl.style.display = 'block'; body.style.display = 'none';
      emptyEl.textContent = 'Đang tải dữ liệu từ sheet Database…';
      fcLoad(false, renderDashboard);
      return;
    }
    if (profileKnown && !profileComplete(profile)) {
      emptyEl.style.display = 'block'; body.style.display = 'none';
      emptyEl.textContent = 'Bạn chưa đăng ký Họ tên / Level — dashboard cần Level để tra mốc KPI & % commission. Đăng xuất rồi đăng nhập lại để đăng ký.';
      return;
    }
    if (!lvDef) {
      emptyEl.style.display = 'block'; body.style.display = 'none';
      emptyEl.textContent = profileKnown
        ? 'Không nhận diện được Level "' + ((profile && profile.level) || '—') + '" — kiểm tra lại sheet Danh sách CS (đúng chuẩn "CS level 3", "CS_A level 1"…).'
        : 'Backend chưa cập nhật (chưa trả về profile) — deploy lại Apps Script theo hướng dẫn để dùng Dashboard.';
      return;
    }
    emptyEl.style.display = 'none'; body.style.display = 'block';
    dashInitMonth();
    try {
      var p = dashPerf(dbMonthKey);
      var rating = dashRating(lvDef, p);
      dashRenderPerf(lvDef, p, rating);
      dashRenderCommission(lvDef, p, rating);
      dashRenderHealth();
      dashRenderRadar();
      dashRenderNote(lvDef);
    } catch (err) {
      console.error('renderDashboard error:', err);
      showToast('Lỗi hiển thị Dashboard: ' + err.message, 'err');
    }
  }

  // =========================================================
  // CHANGELOG — mỗi lần cập nhật tool, thêm 1 entry mới lên ĐẦU mảng này.
  // =========================================================
  var CHANGELOG = [
    {
      date: '18/07/2026',
      title: 'Big Update: ACR nhiều năm · combo CS_PM+CS_A · search box',
      items: [
        'Forecast: thêm sub-tab "ACR nhiều năm (Năm 2-5)" — lọc theo tháng (mặc định tháng hiện tại), tự tìm deal có "Tháng nhận Com T1/T4 - Năm 2..5" khớp tháng đó, cho nhập %Active/%Output, gợi ý %Output năm liền trước kèm nút "dùng".',
        'Lưu ACR nhiều năm xong tự nhảy sang Scorecard, chấm đúng tháng vừa nhập.',
        'Scorecard: bảng Commission giờ gộp cả deal năm 1 lẫn ACR nhiều năm khớp tháng đang xem, tính chung 1 bảng %Com theo Level (policy 6.4 không có bảng riêng cho năm 2+).',
        'Combo CS_PM+CS_A: deal nào cột "Vai trò phụ trách" ghi cả CS_PM,CS_A (tự cân, không có CS_A riêng) → %Com T1 = %Com Level cộng thêm 1.5/2/2.3% (Under/KPI/GOAL/OUT) của CS_A, đúng theo "chính sách kiêm nhiệm" mục 4 policy. Bảng chỉ hiện %Com cuối cùng, không lộ phép cộng.',
        'Thêm search box theo tên deal ở cả Overview và Forecast (dùng chung cho cả 2 sub-tab Forecast).',
      ],
    },
    {
      date: '17/07/2026',
      title: 'Fix: đăng nhập Google bị khoá khi Chrome tắt "Third-party sign-in" (FedCM)',
      items: [
        'Phát hiện qua console: "FedCM was disabled... via site settings" — Chrome tắt third-party sign-in cho domain github.io (thường do trước đó từng bấm từ chối popup Google 1-2 lần), khiến One Tap luôn thất bại ngay từ đầu, không liên quan tới việc đổi tên repo.',
        'Thêm nút Google THẬT (renderButton chính chủ) làm phương án dự phòng — dựng sẵn, ẩn đi lúc load trang.',
        'Khi One Tap/FedCM thất bại vì BẤT KỲ lý do gì (bị chặn, bị tắt, timeout...), tự động hiện nút Google thật kèm nút "Thử lại One Tap" — không cần đợi báo IT bật lại site setting mới đăng nhập được.',
        'Nút thật mở popup OAuth chuẩn, không phụ thuộc cơ chế "silent prompt" của One Tap đang bị Google khai tử dần dưới FedCM — bền hơn về lâu dài cho cả team.',
      ],
    },
    {
      date: '17/07/2026',
      title: 'Fix bug: bấm "Continue with Google" cứ load, không phản hồi',
      items: [
        'Nguyên nhân: khoá promptInFlight chặn gọi chồng google.accounts.id.prompt() không có timeout — nếu 1 lần gọi bị treo (trình duyệt chặn FedCM/cookie bên thứ 3, tiện ích chặn quảng cáo…) thì khoá kẹt vĩnh viễn, mọi lần bấm nút sau đó bị bỏ qua trong im lặng.',
        'Thêm timeout cứng 6s cho mỗi lần gọi prompt(); hết giờ vẫn không có phản hồi thì tự động nhả khoá + reset nút.',
        'Nếu có lệnh gọi đến trong lúc 1 lần khác đang chạy dở (VD: lần tự động lúc load trang), lệnh gọi đó được xếp hàng chờ thay vì bị bỏ qua — đảm bảo nút luôn được reset đúng lúc, không bị treo vĩnh viễn dù rơi vào tình huống nào.',
        'Khi thất bại, hiện toast báo lỗi rõ ràng kèm gợi ý xử lý (tắt tiện ích chặn quảng cáo/cookie bên thứ 3, thử ẩn danh, bấm lại) thay vì chỉ im lặng reset nút.',
      ],
    },
    {
      date: '17/07/2026',
      title: 'Hợp nhất bộ chọn tháng · liên kết chéo tab · đổi tên header',
      items: [
        'Forecast: gộp 2 dropdown tháng (KPI "DT phải go-live" và bộ lọc chip) thành 1 — trước đây 2 ô đứng cạnh nhau dễ nhầm.',
        'Bấm vào 1 deal ở Overview (mục chi tiết) hoặc Scorecard (rescue list / bảng commission) → nhảy thẳng sang Forecast, tự lọc đúng deal đó để sửa số liệu.',
        'Đổi tên tab: "Tổng quan" → Overview, "Dashboard" → Scorecard.',
        'Overview: KPI CHS_CS ghi rõ nguồn (ưu tiên CHS_CS T4, chưa có thì lấy T1).',
        'Thêm nút Changelog & Playbook trên header.',
      ],
    },
    {
      date: '15/07/2026',
      title: 'Big Update: đăng ký lần đầu · profile · Scorecard',
      items: [
        'Thêm màn đăng ký bắt buộc lần đầu đăng nhập (Họ tên / Level / Salary) → lưu vào sheet "Danh sách CS".',
        'Overview: thêm profile strip (tên, level, lương) + KPI "Số deal nhận".',
        'Forecast: thêm bộ lọc theo tháng làm việc + 7 chip (kỳ đo tháng này, thiếu số kỳ đã qua, chưa GL theo các mốc, quá 200% TTGL).',
        'Ra mắt tab Dashboard (nay là Scorecard): Performance vs KPI/GOAL/OUT theo policy 6.2, bảng Commission 6.3 + 6.5, sức khỏe portfolio, radar kỳ đo 3 tháng tới.',
        'Fix bug: sửa 1 ô % rồi Lưu có thể xóa mất ngày Go-live đã lưu trên sheet (do payload gửi goLive rỗng) — nay giữ nguyên giá trị đã lưu nếu không sửa.',
        'Fix bug: CHS T1/T4 ở Forecast trước chỉ tính theo ô đang sửa, deal đã có số trên sheet vẫn hiện "—" — nay tính trên dữ liệu đã lưu.',
      ],
    },
  ];

  function renderChangelog() {
    $('changelogBody').innerHTML = CHANGELOG.map(function (rel) {
      return '<div class="cl-entry">' +
        '<div class="cl-date">' + esc(rel.date) + '</div>' +
        '<div class="cl-title">' + esc(rel.title) + '</div>' +
        '<ul class="cl-list">' + rel.items.map(function (it) { return '<li>' + esc(it) + '</li>'; }).join('') + '</ul>' +
        '</div>';
    }).join('');
  }

  // =========================================================
  // PLAYBOOK — hướng dẫn sử dụng theo từng tab
  // =========================================================
  function renderPlaybook() {
    $('playbookBody').innerHTML =
      '<div class="pb-section">' +
        '<h4>Overview</h4>' +
        '<p>Nhìn lại toàn bộ deal đang phụ trách: lọc theo khoảng ngày nhận deal, xem tổng revenue, CHS_CS trung bình (lấy từ CHS_CS T4, chưa có thì T1), và cơ cấu theo bộ giải pháp / loại hợp đồng.</p>' +
        '<p><b>Mẹo:</b> bấm vào 1 dòng deal để mở chi tiết ngay dưới dòng đó, có nút <i>"→ Mở trong Forecast để sửa số liệu"</i> để nhảy thẳng sang tab Forecast.</p>' +
      '</div>' +
      '<div class="pb-section">' +
        '<h4>Forecast</h4>' +
        '<p>Nơi duy nhất được nhập tay 5 ô vàng: <b>Go-live thực tế, %Active T1/T4, %Output T1/T4</b>. Các cột còn lại (Tier, Trạng thái, CHS T1/T4, ACR) tự tính lại ngay khi bạn gõ, và chỉ đẩy về sheet khi bấm <b>"Lưu &amp; đẩy về sheet"</b>.</p>' +
        '<p><b>Tháng làm việc</b> ở thanh lọc dùng chung cho cả 7 chip lọc lẫn ô KPI "DT phải go-live". Ưu tiên xử lý theo thứ tự: <i>Thiếu số kỳ đã qua</i> (khẩn nhất — CHS trống là mất luôn nền commission của deal đó) → <i>Kỳ đo T1/T4 tháng này</i> → các chip "Chưa GL".</p>' +
        '<p><b>ACR nhiều năm:</b> bấm nút "ACR nhiều năm (Năm 2-5)" ở đầu tab để chuyển sang nhập %Active/%Output cho các deal đã sang năm hợp đồng thứ 2 trở đi — chọn đúng tháng, tool tự tìm deal có kỳ nhận Com khớp tháng đó, có gợi ý %Output năm liền trước để đỡ phải tra lại. Bấm Lưu xong tool tự chuyển sang Scorecard đúng tháng vừa nhập.</p>' +
        '<p><b>Tìm nhanh:</b> gõ vào ô tìm kiếm ở đầu tab (Overview và Forecast đều có) để lọc theo tên deal.</p>' +
      '</div>' +
      '<div class="pb-section">' +
        '<h4>Scorecard</h4>' +
        '<p>Chọn "Tháng đánh giá" để xem Performance (CR/SRR_1/SRR_4 so với mốc KPI/GOAL/OUT của đúng level bạn đã đăng ký — theo chính sách mục 6.2), bảng Commission chi tiết từng deal (mục 6.3 + thưởng Upsale/Cross mục 6.5), sức khỏe portfolio và deal "cần cứu" trước kỳ đo T4.</p>' +
        '<p><b>Mẹo:</b> bấm vào deal trong danh sách "cần cứu" hoặc bảng Commission để nhảy thẳng sang Forecast sửa số liệu của đúng deal đó.</p>' +
      '</div>' +
      '<div class="pb-section pb-note">' +
        '<h4>Lưu ý chung</h4>' +
        '<p>Thông tin Level/Salary chỉ khai báo 1 lần lúc đăng ký — muốn sửa thì báo Operation cập nhật trực tiếp ở sheet "Danh sách CS".</p>' +
      '</div>';
  }

  function openModal(id) { $(id).classList.add('open'); }
  function closeModal(id) { $(id).classList.remove('open'); }

  (function () {
    var pBtn = $('playbookBtn'), pClose = $('playbookClose'), pModal = $('playbookModal');
    var cBtn = $('changelogBtn'), cClose = $('changelogClose'), cModal = $('changelogModal');
    if (pBtn) pBtn.addEventListener('click', function () { renderPlaybook(); openModal('playbookModal'); });
    if (pClose) pClose.addEventListener('click', function () { closeModal('playbookModal'); });
    if (pModal) pModal.addEventListener('click', function (e) { if (e.target === pModal) closeModal('playbookModal'); });
    if (cBtn) cBtn.addEventListener('click', function () { renderChangelog(); openModal('changelogModal'); });
    if (cClose) cClose.addEventListener('click', function () { closeModal('changelogModal'); });
    if (cModal) cModal.addEventListener('click', function (e) { if (e.target === cModal) closeModal('changelogModal'); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { closeModal('playbookModal'); closeModal('changelogModal'); }
    });
  })();

  // wiring
  (function () {
    var b = $('fcSaveBtn'); if (b) b.addEventListener('click', fcSave);
  })();

})();

(function () {
  'use strict';

  var CFG = window.CS_TOOL_CONFIG;
  var SESSION_KEY = 'cs_tool_session';

  // ---------- DOM ----------
  var $ = function (id) { return document.getElementById(id); };
  var tabNav = $('tabNav');
  var userEmail = $('userEmail');
  var logoutBtn = $('logoutBtn');

  var panels = {
    overview: $('panel-overview'),
    forecast: $('panel-forecast'),
    dashboard: $('panel-dashboard'),
  };

  // ---------- State ----------
  var allDeals = [];   // normalized deals
  var openDealId = null;
  var sortDesc = true;
  var CHART_COLORS = ['#4C6FFF', '#7C5CFC', '#22A06B', '#E39230', '#D93B3B', '#147D6F', '#4C8C2B', '#C97A0E'];

  // =========================================================
  // UI MODE (login vs app)
  // =========================================================
  function setUiMode(mode) {
    // mode: 'login' or 'app'
    document.body.className = mode + '-mode';
  }

  function showApp(email) {
    userEmail.textContent = email;
    switchTab('overview');
    setUiMode('app');
  }

  function logout() {
    try { google.accounts.id.disableAutoSelect(); } catch (e) {}
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem('cs_tool_token');
    setUiMode('login');
  }

  // =========================================================
  // AUTH: Google Sign-in + API call
  // =========================================================
function loadDeals(token) {
    fetch(CFG.API_URL + '?token=' + encodeURIComponent(token))
      .then(function (r) { return r.text(); })
      .then(function (text) { return JSON.parse(text); })
      .then(function (data) {
        if (!data.ok) { 
          localStorage.removeItem('cs_tool_token');
          localStorage.removeItem(SESSION_KEY);
          alert('Phiên đăng nhập đã hết hạn, mời đăng nhập lại.');
          resetGoogleButton();
          setUiMode('login');
          return; 
        }
        allDeals = (data.deals || []).map(normalizeDeal);
        showApp(data.email);
        setDefaultDateRange();
        renderOverview();
      })
      .catch(function (err) {
        alert('Không kết nối được tới dữ liệu: ' + err.message);
        resetGoogleButton();
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
      role: String(get(K.role) || ''),
      segment: String(get(K.segment) || ''),
      solution: String(get(K.solution) || 'Khác'),
      arr: parseMoney(get(K.arr)),
      tier: get(K.tier),
      users: parseNum(get(K.users)),
      contract: String(get(K.contract) || 'Khác'),
      received: parseDate(get(K.received)),
      ttgl: parseNum(get(K.ttgl)),
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
  var BAND_LABEL = { strong: 'Strong', healthy: 'Healthy', weak: 'Weak', risk: 'At Risk', none: 'Chưa có CHS' };

  // =========================================================
  // FILTER
  // =========================================================
  function setDefaultDateRange() {
    var now = new Date();
    var first = new Date(now.getFullYear(), now.getMonth(), 1);
    $('dateFrom').value = toInputDate(first);
    $('dateTo').value = toInputDate(now);
    setActiveChip('month');
  }

  function setActiveChip(preset) {
    document.querySelectorAll('.chip-btn').forEach(function (c) {
      c.classList.toggle('active', c.getAttribute('data-preset') === preset);
    });
  }

  function applyPreset(preset) {
    var now = new Date();
    var from = null, to = now;
    if (preset === 'month') from = new Date(now.getFullYear(), now.getMonth(), 1);
    else if (preset === 'quarter') from = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
    else if (preset === 'year') from = new Date(now.getFullYear(), 0, 1);
    else if (preset === 'all') { from = null; to = null; }
    $('dateFrom').value = from ? toInputDate(from) : '';
    $('dateTo').value = to ? toInputDate(to) : '';
    setActiveChip(preset);
    renderOverview();
  }

  function getFilteredDeals() {
    var fromV = $('dateFrom').value;
    var toV = $('dateTo').value;
    var from = fromV ? new Date(fromV + 'T00:00:00') : null;
    var to = toV ? new Date(toV + 'T23:59:59') : null;
    return allDeals.filter(function (d) {
      if (!d.received) return !from && !to;
      if (from && d.received < from) return false;
      if (to && d.received > to) return false;
      return true;
    });
  }

  // =========================================================
  // RENDER: TỔNG QUAN
  // =========================================================
  function renderOverview() {
    var deals = getFilteredDeals();
    openDealId = null;
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
      $('kpiChsSub').textContent = 'Trên ' + scored.length + ' deal đã có điểm';
    } else {
      $('kpiChs').textContent = '—';
      $('kpiChs').style.color = '';
      $('kpiChsSub').textContent = 'Chưa có deal nào được chấm CHS_CS';
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
        '<td><div class="deal-name">' + esc(d.name) + '</div><div class="deal-id">' + esc(d.id) + '</div></td>' +
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
      ['Phân khúc', deal.segment || '—'],
      ['Bộ giải pháp', deal.solution || '—'],
      ['Tier', deal.tier != null && deal.tier !== '' ? 'Tier ' + deal.tier : '—'],
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
    detail.innerHTML = '<td colspan="6">' + grid + bars + '</td>';
    tr.parentNode.insertBefore(detail, tr.nextSibling);
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
  function switchTab(name) {
    document.querySelectorAll('.tab').forEach(function (t) {
      t.classList.toggle('active', t.getAttribute('data-tab') === name);
    });
    Object.keys(panels).forEach(function (k) {
      panels[k].style.display = k === name ? 'block' : 'none';
    });
    if (name === 'forecast') renderForecast();
  }

  // =========================================================
  // EVENTS
  // =========================================================
  logoutBtn.addEventListener('click', logout);

  document.querySelectorAll('.tab').forEach(function (t) {
    t.addEventListener('click', function () { switchTab(t.getAttribute('data-tab')); });
  });

  document.querySelectorAll('.chip-btn').forEach(function (c) {
    c.addEventListener('click', function () { applyPreset(c.getAttribute('data-preset')); });
  });

  ['dateFrom', 'dateTo'].forEach(function (id) {
    $(id).addEventListener('change', function () {
      setActiveChip('');
      renderOverview();
    });
  });

  $('sortDate').addEventListener('click', function () {
    sortDesc = !sortDesc;
    renderTable(getFilteredDeals());
  });

  // =========================================================
  // BOOT: Check token & load app
  // =========================================================
  window.addEventListener('load', function () {
    if (!CFG.CLIENT_ID || CFG.CLIENT_ID.indexOf('DIEN_') === 0) {
      alert('Error: CLIENT_ID not configured in config.js');
      return;
    }

    // Check localStorage for saved token
    var savedToken = localStorage.getItem('cs_tool_token');
    if (savedToken) {
      loadDeals(savedToken);
      return;
    }

    // Init Google for future logins
    var check = setInterval(function () {
      if (window.google && google.accounts && google.accounts.id) {
        clearInterval(check);
        google.accounts.id.initialize({
          client_id: CFG.CLIENT_ID,
          hd: CFG.ALLOWED_DOMAIN,
          callback: handleCredential,
        });
      }
    }, 100);
  });

  // =========================================================
  // GLOBAL FUNCTION for HTML button click
  // =========================================================
  function handleCredential(response) {
    var token = response.credential;
    localStorage.setItem('cs_tool_token', token);
    localStorage.setItem(SESSION_KEY, JSON.stringify({ ts: Date.now() }));
    loadDeals(token);
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

  window.signInWithGoogle = function () {
    var logo = document.getElementById('glogo');
    var spinner = document.getElementById('spinner');
    var text = document.getElementById('gtext');
    var btn = document.getElementById('gbtn');
    
    if (logo) logo.classList.add('hidden');
    if (spinner) spinner.classList.remove('hidden');
    if (text) text.textContent = 'Opening Google...';
    if (btn) btn.setAttribute('disabled', '');

    // Thay vì prompt(), dùng renderButton + One Tap flow
    setTimeout(function () {
      if (window.google && google.accounts && google.accounts.id) {
        try {
          // One Tap: popup phía trên
          google.accounts.id.prompt(function(notification) {
            console.log('Google prompt:', notification.isNotDisplayed(), notification.getNotDisplayedReason());
            if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
              // Nếu One Tap không show được → reset button, user try lại
              console.warn('One Tap not available, fallback to prompt UI');
              resetGoogleButton();
            }
          });
        } catch (err) {
          console.error('Google sign-in error:', err);
          resetGoogleButton();
        }
      }
    }, 300);
};


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
    };
  }

  function fcNormalize(raw) {
    if (!FKEY) fcBuildKeymap(raw);
    var K = FKEY, g = function (k) { return k ? raw[k] : null; };
    var tm = String(g(K.tier) || '').match(/\d+/);
    return {
      id: String(g(K.id) || ''),
      name: String(g(K.name) || '—'),
      contract: String(g(K.contract) || '—'),
      val: parseMoney(g(K.val)),
      segment: String(g(K.segment) || ''),
      tierNum: tm ? +tm[0] : null,
      received: parseDate(g(K.received)),
      ttgl: parseNum(g(K.ttgl)),
      glPlan: parseDate(g(K.glPlan)),
      crMonth: String(g(K.crMonth) || ''),
      acr: parseMoney(g(K.acr)),
      dtPhai: parseMoney(g(K.dtPhai)),
      glActual0: parseDate(g(K.glActual)),
      aT1_0: parsePct(g(K.aT1)), oT1_0: parsePct(g(K.oT1)),
      aT4_0: parsePct(g(K.aT4)), oT4_0: parsePct(g(K.oT4)),
    };
  }

  function fcSeed() {
    fcState = {};
    fcDeals.forEach(function (d) {
      fcState[d.id] = {
        goLive: d.glActual0 ? fmtDate(d.glActual0) : '',
        aT1: d.aT1_0, oT1: d.oT1_0, aT4: d.aT4_0, oT4: d.oT4_0,
      };
    });
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

  function fcCompute(d) {
    var e = fcState[d.id] || {};
    var gl = e.goLive ? parseDate(e.goLive) : null;
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
    var cT1 = fcChs(t, e.aT1, e.oT1), cT4 = fcChs(t, e.aT4, e.oT4);
    var late = (status === 'Quá 200% → dồn CR1' || status === 'Trễ - chưa go-live' || status === 'Go-live trễ');
    return {
      gl: e.goLive || '', aT1: e.aT1, oT1: e.oT1, aT4: e.aT4, oT4: e.oT4,
      status: status, cT1: cT1, cT4: cT4,
      acrT1: (cT1 != null && cT1 >= 50) ? (d.acr || 0) : 0,
      acrT4: (cT4 != null && cT4 >= 50) ? (d.acr || 0) : 0,
      dtDat: gl ? (d.dtPhai || 0) : 0, late: late,
    };
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
  function fcMonthCmp(a, b) { var p = a.split('/'), q = b.split('/'); return (p[1] - q[1]) || (p[0] - q[0]); }
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
    fcRenderKpis(); fcRenderTable();
  }

  function fcLoad() {
    var token = localStorage.getItem('cs_tool_token');
    var empty = $('fcEmpty');
    if (empty) { empty.style.display = 'block'; empty.textContent = 'Đang tải dữ liệu từ sheet Database…'; }
    fetch(CFG.API_URL + '?token=' + encodeURIComponent(token) + '&sheet=Database')
      .then(function (r) { return r.text(); })
      .then(function (text) { return JSON.parse(text); })
      .then(function (data) {
        if (!data.ok) { alert('Phiên đăng nhập đã hết hạn, mời đăng nhập lại.'); return; }
        fcDeals = (data.deals || []).map(fcNormalize).filter(function (d) { return d.id; });
        fcSeed(); fcLoaded = true;
        if (empty) empty.style.display = fcDeals.length ? 'none' : 'block';
        if (empty && !fcDeals.length) empty.textContent = 'Sheet Database chưa có deal nào.';
        fcRenderKpis(); fcRenderTable();
      })
      .catch(function (err) {
        if (empty) empty.textContent = 'Không tải được dữ liệu forecast: ' + err.message;
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
    $('fcElig').textContent = fmtMoney(rows.reduce(function (s, r) { return s + r.acrT1 + r.acrT4; }, 0));

    var byM = {};
    fcDeals.forEach(function (d, i) {
      var r = rows[i], m = d.crMonth || '—';
      if (!byM[m]) byM[m] = { phai: 0, sach: 0, dat: 0 };
      byM[m].phai += d.dtPhai || 0;
      if (!r.late) byM[m].sach += d.dtPhai || 0;
      byM[m].dat += r.dtDat;
    });
    var months = Object.keys(byM).filter(function (m) { return m !== '—'; }).sort(fcMonthCmp);
    var sel = $('fcMonth');
    if (sel && sel.options.length === 0 && months.length) {
      months.forEach(function (m) { var o = document.createElement('option'); o.value = m; o.textContent = m; sel.appendChild(o); });
      sel.value = months.indexOf('08/2026') > -1 ? '08/2026' : months[months.length - 1];
    }
    var cur = sel ? sel.value : (months[months.length - 1] || '');
    var cd = byM[cur] || { phai: 0, sach: 0, dat: 0 };
    $('fcPress').textContent = fmtMoney(cd.sach);
    $('fcPressSub').textContent = 'gồm cả muộn: ' + fmtMoneyShort(cd.phai) + ' · đã go-live: ' + fmtMoneyShort(cd.dat);
  }

  function fcRenderTable() {
    if (!fcDeals) return;
    var tb = $('fcTbody');
    tb.innerHTML = fcDeals.map(function (d) {
      var r = fcCompute(d);
      var inp = function (f, cls, v) {
        return '<input class="fc-in ' + cls + '" data-id="' + esc(d.id) + '" data-f="' + f + '" value="' + esc(v == null ? '' : v) + '"'
             + (f === 'goLive' ? ' placeholder="dd/mm/yyyy"' : '') + '>';
      };
      return '<tr id="fc-row-' + esc(d.id) + '">' +
        '<td><div class="deal-name">' + esc(d.name) + '</div><div class="deal-id">' + esc(d.id) + '</div></td>' +
        '<td><span class="badge role">' + esc(d.contract) + '</span></td>' +
        '<td class="num">' + fmtMoneyShort(d.val) + '</td>' +
        '<td class="fc-y fc-yL">' + inp('goLive', 'fc-date', r.gl) + '</td>' +
        '<td class="fc-y num">' + inp('aT1', 'fc-pct', r.aT1) + '</td>' +
        '<td class="fc-y num">' + inp('oT1', 'fc-pct', r.oT1) + '</td>' +
        '<td class="fc-y num">' + inp('aT4', 'fc-pct', r.aT4) + '</td>' +
        '<td class="fc-y num fc-yR">' + inp('oT4', 'fc-pct', r.oT4) + '</td>' +
        '<td>' + (d.tierNum ? 'Tier ' + d.tierNum : '—') + '</td>' +
        '<td data-c="status">' + fcStatusBadge(r.status) + '</td>' +
        '<td>' + esc(d.crMonth || '—') + '</td>' +
        '<td class="num" data-c="cT1">' + fcChsBadge(r.cT1) + '</td>' +
        '<td class="num" data-c="cT4">' + fcChsBadge(r.cT4) + '</td>' +
        '<td class="num">' + fmtMoneyShort(d.acr) + '</td>' +
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
    if (!fcState[id]) fcState[id] = {};
    fcState[id][field] = val;
    fcUpdateRow(id);
    fcRenderKpis();
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
    var payload = fcDeals.map(function (d) {
      var e = fcState[d.id] || {};
      return { dealId: d.id, goLive: e.goLive || '', aT1: e.aT1, oT1: e.oT1, aT4: e.aT4, oT4: e.oT4 };
    });
    fcFlag('đang lưu…');
    fetch(CFG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // tránh CORS preflight
      body: JSON.stringify({ token: token, rows: payload }),
    })
      .then(function (r) { return r.text(); })
      .then(function (text) {
        var d; try { d = JSON.parse(text); } catch (e) { d = { ok: true }; }
        fcFlag(d.ok ? ('✓ đã lưu ' + (d.saved != null ? d.saved + ' deal · ' : '') + new Date().toLocaleTimeString('vi-VN')) : '⚠ lưu lỗi');
      })
      .catch(function (err) { fcFlag('⚠ lưu lỗi: ' + err.message); });
  }

  // wiring
  (function () {
    var b = $('fcSaveBtn'); if (b) b.addEventListener('click', fcSave);
    var m = $('fcMonth');   if (m) m.addEventListener('change', fcRenderKpis);
  })();

})();

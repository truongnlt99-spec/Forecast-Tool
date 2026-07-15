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
          alert('Không đăng nhập được: ' + (data.error || 'Unknown error'));
          resetGoogleButton();
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
      arr:       findKey(keys, ['arr']),
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
      chs:       findKey(keys, ['chs_cs', 'chs']),
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
    var chs = parseChs(get(K.chs));
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
      pctActive: parsePct(get(K.pctActive)),
      pctOutput: parsePct(get(K.pctOutput)),
      uPoint: parseNum(get(K.uPoint)),
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
      if (/đã go/i.test(d.glStatus)) { glCount++; if (d.arr) glArr += d.arr; }
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
    if (/đã go/i.test(s)) return '<span class="badge gl-done">' + esc(s) + '</span>';
    if (/quá hạn/i.test(s)) return '<span class="badge gl-overdue">' + esc(s) + '</span>';
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
    if (text) text.textContent = 'Connecting…';
    if (btn) btn.setAttribute('disabled', '');

    // Trigger Google prompt
    setTimeout(function () {
      if (window.google && google.accounts && google.accounts.id) {
        google.accounts.id.prompt();
      }
    }, 100);
  };

})();

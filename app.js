(function () {
  var CFG = window.CS_TOOL_CONFIG;
  var SESSION_KEY = 'cs_tool_session';

  var loginScreen = document.getElementById('loginScreen');
  var loginError = document.getElementById('loginError');
  var dashboard = document.getElementById('dashboard');
  var userBox = document.getElementById('userBox');
  var userEmail = document.getElementById('userEmail');
  var summaryBar = document.getElementById('summaryBar');
  var dealGrid = document.getElementById('dealGrid');
  var logoutBtn = document.getElementById('logoutBtn');

  function showLogin(errorMsg) {
    loginScreen.style.display = 'flex';
    dashboard.style.display = 'none';
    userBox.style.display = 'none';
    if (errorMsg) {
      loginError.textContent = errorMsg;
      loginError.style.display = 'block';
    } else {
      loginError.style.display = 'none';
    }
  }

  function showDashboard(email) {
    loginScreen.style.display = 'none';
    dashboard.style.display = 'block';
    userBox.style.display = 'flex';
    userEmail.textContent = email;
  }

  // ---------- Google Identity Services ----------
  function initGoogle() {
    google.accounts.id.initialize({
      client_id: CFG.CLIENT_ID,
      hd: CFG.ALLOWED_DOMAIN,
      auto_select: true,
      callback: handleCredential,
    });
    google.accounts.id.renderButton(document.getElementById('gsiButton'), {
      theme: 'outline',
      size: 'large',
      text: 'signin_with',
    });
    // Thử tự đăng nhập im lặng nếu thiết bị này đã từng đăng nhập Google trước đó
    google.accounts.id.prompt();
  }

  function handleCredential(response) {
    var token = response.credential;
    localStorage.setItem(SESSION_KEY, JSON.stringify({ ts: Date.now() }));
    loadDeals(token);
  }

  function logout() {
    try { google.accounts.id.disableAutoSelect(); } catch (e) {}
    localStorage.removeItem(SESSION_KEY);
    showLogin();
  }

  // ---------- Data ----------
  function loadDeals(token) {
    fetch(CFG.API_URL + '?token=' + encodeURIComponent(token))
      .then(function (r) { return r.text(); })
      .then(function (text) { return JSON.parse(text); })
      .then(function (data) {
        if (!data.ok) {
          showLogin(data.error || 'Không đăng nhập được.');
          return;
        }
        showDashboard(data.email);
        render(data.deals);
      })
      .catch(function () {
        showLogin('Không kết nối được tới dữ liệu. Thử tải lại trang.');
      });
  }

  function pickField(keys, candidates) {
    for (var i = 0; i < candidates.length; i++) {
      if (keys.indexOf(candidates[i]) !== -1) return candidates[i];
    }
    return null;
  }

  function bandOf(score) {
    var n = Number(score);
    if (isNaN(n)) return { cls: '', label: '' };
    if (n <= 20) return { cls: 'band-risk', label: 'At Risk' };
    if (n <= 50) return { cls: 'band-weak', label: 'Weak' };
    if (n <= 70) return { cls: 'band-healthy', label: 'Healthy' };
    return { cls: 'band-strong', label: 'Strong' };
  }

  function render(deals) {
    var counts = { risk: 0, weak: 0, healthy: 0, strong: 0 };
    dealGrid.innerHTML = '';

    if (!deals.length) {
      dealGrid.innerHTML = '<div class="empty">Chưa có deal nào gắn với email này trong tab Database.<br>Kiểm tra lại cột "Email phụ trách".</div>';
      summaryBar.innerHTML = '';
      return;
    }

    var keys = Object.keys(deals[0]);
    var titleKey = pickField(keys, ['Company', 'Tên khách hàng', 'Khách hàng', 'Company Name', 'Tên công ty']) || keys[0];
    var chsKey = keys.find(function (k) { return k.toUpperCase().indexOf('CHS') !== -1; });

    deals.forEach(function (deal) {
      var band = chsKey ? bandOf(deal[chsKey]) : { cls: '', label: '' };
      if (band.cls === 'band-risk') counts.risk++;
      else if (band.cls === 'band-weak') counts.weak++;
      else if (band.cls === 'band-healthy') counts.healthy++;
      else if (band.cls === 'band-strong') counts.strong++;

      var card = document.createElement('div');
      card.className = 'deal-card ' + band.cls;

      var metaHtml = '';
      keys.forEach(function (k) {
        if (k === titleKey || k === 'Email phụ trách') return;
        metaHtml += '<span class="k">' + escapeHtml(k) + '</span><span class="v">' + escapeHtml(deal[k]) + '</span>';
      });

      card.innerHTML =
        '<div class="top-row">' +
          '<div class="company">' + escapeHtml(deal[titleKey]) + '</div>' +
          (band.label ? '<span class="badge ' + band.cls + '">' + band.label + '</span>' : '') +
        '</div>' +
        '<div class="meta">' + metaHtml + '</div>';

      dealGrid.appendChild(card);
    });

    summaryBar.innerHTML =
      summaryCell(deals.length, 'Tổng số deal') +
      summaryCell(counts.risk, 'At Risk') +
      summaryCell(counts.weak, 'Weak') +
      summaryCell(counts.healthy + counts.strong, 'Healthy / Strong');
  }

  function summaryCell(num, label) {
    return '<div class="summary-cell"><div class="num">' + num + '</div><div class="lbl">' + label + '</div></div>';
  }

  function escapeHtml(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  logoutBtn.addEventListener('click', logout);

  window.onload = function () {
    if (!CFG.CLIENT_ID || CFG.CLIENT_ID.indexOf('DIEN_') === 0) {
      showLogin('Chưa cấu hình CLIENT_ID trong config.js — xem README.md.');
      return;
    }
    var check = setInterval(function () {
      if (window.google && google.accounts && google.accounts.id) {
        clearInterval(check);
        initGoogle();
      }
    }, 100);
  };
})();

/* =========================================================
   ui.js — LỚP GIAO DIỆN (UI/UX v2)
   ---------------------------------------------------------
   File này CHỈ lo phần nhìn. Không đụng gì tới logic nghiệp
   vụ, không đọc/ghi sheet, không tính CHS/commission.
   app.js giữ nguyên 100%.

   Việc nó làm:
   1. Thu gọn / mở rộng sidebar (nhớ lựa chọn trong localStorage)
   2. Mở sidebar dạng drawer trên mobile
   3. Đổi sáng / tối (nhớ lựa chọn)
   4. Đổi tiêu đề trên header theo tab đang mở
   5. Đổ chữ cái đầu của tên vào avatar góc phải
   6. Dựng banner "Tổng thu nhập ước tính" ở đầu tab Scorecard
      bằng cách ĐỌC LẠI các dòng tổng mà app.js đã render ở
      #comTfoot — không tính toán lại, nên không lệch số.
   ========================================================= */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var LS_SIDE = 'cs_tool_sidebar';
  var LS_THEME = 'cs_tool_theme';

  /* -------------------------------------------------------
     1. THU GỌN / MỞ RỘNG SIDEBAR
     ------------------------------------------------------- */
  var wrapper = $('appWrapper');
  var toggleBtn = $('sideToggle');

  function setCollapsed(on) {
    if (!wrapper || !toggleBtn) return;
    wrapper.classList.toggle('collapsed', on);
    var txt = on ? 'Mở rộng menu' : 'Thu gọn menu';
    toggleBtn.setAttribute('aria-label', txt);
    toggleBtn.setAttribute('title', txt);
    var lb = toggleBtn.querySelector('.scb-label');
    if (lb) lb.textContent = txt;
    try { localStorage.setItem(LS_SIDE, on ? 'collapsed' : 'expanded'); } catch (e) {}
  }

  if (toggleBtn) {
    toggleBtn.addEventListener('click', function () {
      setCollapsed(!wrapper.classList.contains('collapsed'));
    });
  }
  try {
    if (localStorage.getItem(LS_SIDE) === 'collapsed') setCollapsed(true);
  } catch (e) {}

  /* -------------------------------------------------------
     2. SIDEBAR DẠNG DRAWER TRÊN MOBILE
     ------------------------------------------------------- */
  var side = $('side');
  var menuBtn = $('menuBtn');
  if (menuBtn && side) {
    menuBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      side.classList.toggle('on');
    });
    // bấm ra ngoài hoặc chọn 1 mục thì đóng lại
    document.addEventListener('click', function (e) {
      if (!side.classList.contains('on')) return;
      if (side.contains(e.target) && !e.target.closest('.tab, .nav-item')) return;
      side.classList.remove('on');
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') side.classList.remove('on');
    });
  }

  /* -------------------------------------------------------
     3. SÁNG / TỐI
     ------------------------------------------------------- */
  var SUN = '<circle cx="12" cy="12" r="4.2"/><path d="M12 2v2M12 20v2M4.2 4.2l1.5 1.5M18.3 18.3l1.5 1.5M2 12h2M20 12h2M4.2 19.8l1.5-1.5M18.3 5.7l1.5-1.5"/>';
  var MOON = '<path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"/>';

  function setTheme(mode) {
    document.documentElement.setAttribute('data-theme', mode);
    var ico = $('themeIco');
    if (ico) ico.innerHTML = mode === 'dark' ? MOON : SUN;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', mode === 'dark' ? '#0B0D17' : '#EEF1FB');
    try { localStorage.setItem(LS_THEME, mode); } catch (e) {}
  }
  var themeBtn = $('themeBtn');
  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      var cur = document.documentElement.getAttribute('data-theme') || 'dark';
      setTheme(cur === 'dark' ? 'light' : 'dark');
    });
  }
  try {
    var saved = localStorage.getItem(LS_THEME);
    setTheme(saved === 'light' ? 'light' : 'dark');
  } catch (e) { setTheme('dark'); }

  /* -------------------------------------------------------
     4. TIÊU ĐỀ HEADER THEO TAB ĐANG MỞ
     app.js tự gắn/gỡ class .active trên .tab, nên ở đây chỉ
     cần quan sát thay đổi đó rồi đổi chữ — không can thiệp
     vào việc chuyển tab.
     ------------------------------------------------------- */
  var TITLES = {
    overview:  ['Overview', 'Sức khỏe portfolio'],
    forecast:  ['Forecast', 'Nhập số kỳ đo, nhập xong nhớ bấm Lưu'],
    dashboard: ['Scorecard', 'Performance · commission tháng']
  };
  function syncTitle() {
    var active = document.querySelector('.tab.active');
    var key = active ? active.getAttribute('data-tab') : 'overview';
    var t = TITLES[key] || TITLES.overview;
    var ttl = $('pageTitle'), sub = $('pageSub');
    if (ttl) ttl.textContent = t[0];
    if (sub) sub.textContent = t[1];

    // Ô tìm kiếm trên header: mỗi tab dùng một ô riêng của app.js,
    // ở đây chỉ bật/tắt cho đúng tab, không đụng vào sự kiện.
    var wrap = $('headSearch'), ov = $('ovSearch'), fc = $('fcSearch');
    if (wrap && ov && fc) {
      wrap.classList.toggle('off', key === 'dashboard');
      ov.style.display = key === 'overview' ? '' : 'none';
      fc.style.display = key === 'forecast' ? '' : 'none';
    }
  }
  document.querySelectorAll('.tab').forEach(function (t) {
    t.addEventListener('click', function () { setTimeout(syncTitle, 0); });
  });
  window.addEventListener('hashchange', function () { setTimeout(syncTitle, 0); });
  syncTitle();

  /* -------------------------------------------------------
     5. (đã bỏ) Avatar riêng ở góc phải — nay dùng luôn khối
        hồ sơ #profileStrip mà app.js tự điền, đặt trên header.
     ------------------------------------------------------- */

  /* -------------------------------------------------------
     6. BANNER TỔNG THU NHẬP (tab Scorecard)
     app.js render các dòng tổng vào #comTfoot:
        … TỔNG COMMISSION THÁNG mm/yyyy   |  x đ
        Lương cứng (level)                |  y đ
        THU NHẬP ƯỚC TÍNH                 |  z đ   (.com-grand)
     Ở đây chỉ ĐỌC LẠI 3 dòng đó rồi hiển thị to lên đầu trang.
     Không tính lại → không bao giờ lệch với bảng bên dưới.
     ------------------------------------------------------- */
  var comTfoot = $('comTfoot');
  var hero = $('incomeHero');

  function textOf(tr) {
    var tds = tr.querySelectorAll('td');
    return {
      label: (tds[0] ? tds[0].textContent : '').trim(),
      value: (tds[tds.length - 1] ? tds[tds.length - 1].textContent : '').trim()
    };
  }

  function syncHero() {
    if (!comTfoot) return;
    var rows = comTfoot.querySelectorAll('tr');
    var breakCard = $('breakCard'), brk = $('comBreak');

    if (!rows.length) {
      if (hero) hero.style.display = 'none';
      if (breakCard) breakCard.style.display = 'none';
      return;
    }

    var total = null, salary = null, com = null, month = '';
    var parts = [];

    // Bảng màu cho từng cấu phần, khớp thứ tự app.js render ở #comTfoot
    var COLORS = ['var(--cyan)', 'var(--lav)', 'var(--healthy)', '#5FE0C0', 'var(--magenta)'];

    rows.forEach(function (tr) {
      var r = textOf(tr);
      var lb = r.label.toUpperCase();

      if (lb.indexOf('THU NHẬP ƯỚC TÍNH') !== -1) { total = r.value; return; }
      if (lb.indexOf('LƯƠNG CỨNG') !== -1) { salary = r.value; return; }
      if (lb.indexOf('TỔNG COMMISSION') !== -1) {
        com = r.value;
        var m = r.label.match(/(\d{1,2}\/\d{4})/);
        if (m) month = m[1];
        return;
      }
      // còn lại là các cấu phần con: Com 1 tháng, Com 4 tháng, thưởng Upsale…
      parts.push({ label: r.label, value: r.value, num: moneyToNumber(r.value) });
    });

    // --- banner tổng thu nhập ---
    if (hero) {
      if (!total && !com) {
        hero.style.display = 'none';
      } else {
        hero.style.display = 'grid';
        $('ihTotal').textContent = total || com || '—';
        $('ihSalary').textContent = salary || 'Chưa đăng ký';
        $('ihCom').textContent = com || '—';
        $('ihMonth').textContent = month ? 'Tháng ' + month : '';
      }
    }

    // --- khung cấu phần ---
    if (!breakCard || !brk) return;
    if (!parts.length) { breakCard.style.display = 'none'; return; }

    var max = parts.reduce(function (m, p) { return Math.max(m, p.num); }, 0) || 1;
    var html = parts.map(function (p, i) {
      var col = COLORS[i % COLORS.length];
      var zero = p.num <= 0 ? ' zero' : '';
      return '<div class="brk-row' + zero + '">' +
        '<div><div class="brk-tag"><i style="background:' + col + '"></i>' + p.label + '</div>' +
        '<div class="brk-bar"><i style="width:' + (p.num / max * 100) + '%; background:' + col + '"></i></div></div>' +
        '<div class="brk-amt" style="color:' + (p.num > 0 ? col : 'var(--tx-3)') + '">' + p.value + '</div></div>';
    }).join('');

    if (com) {
      html += '<div class="brk-row sum"><div><div class="brk-tag">' +
        '<i style="background:var(--lav)"></i>Tổng commission' + (month ? ' tháng ' + month : '') + '</div>' +
        '<div class="brk-note">Cộng ' + parts.length + ' cấu phần trên · chưa gồm lương cứng</div></div>' +
        '<div class="brk-amt">' + com + '</div></div>';
    }
    if (total) {
      html += '<div class="brk-row grand"><div><div class="brk-tag">' +
        '<i style="background:var(--cyan)"></i>Thu nhập ước tính</div>' +
        '<div class="brk-note">Lương cứng ' + (salary || '—') + ' + commission ' + (com || '—') + '</div></div>' +
        '<div class="brk-amt">' + total + '</div></div>';
    }

    brk.innerHTML = html;
    breakCard.style.display = 'block';
  }

  // "12.345.000 đ" -> 12345000 (chỉ dùng để vẽ độ dài thanh, không dùng để tính tiền)
  function moneyToNumber(txt) {
    var n = String(txt || '').replace(/[^\d]/g, '');
    return n ? parseInt(n, 10) : 0;
  }

  if (comTfoot) {
    new MutationObserver(syncHero).observe(comTfoot, { childList: true, subtree: true });
    syncHero();
  }

  /* -------------------------------------------------------
     7. ĐẾM DEAL CÒN THIẾU SỐ — hiện badge nhỏ cạnh mục
        "Nhập & dự phóng". Đọc từ chip cảnh báo mà app.js đã
        render trong #fcChips (chip .warn), không tự tính.
     ------------------------------------------------------- */
  var fcChips = $('fcChips'), navMissing = $('navMissing');
  function syncMissing() {
    if (!fcChips || !navMissing) return;
    var warn = fcChips.querySelector('.fc-chip.warn');
    if (!warn) { navMissing.textContent = ''; return; }
    var m = warn.textContent.match(/(\d+)/);
    navMissing.textContent = (m && m[1] !== '0') ? m[1] : '';
  }
  if (fcChips) {
    new MutationObserver(syncMissing).observe(fcChips, { childList: true, subtree: true });
  }
})();

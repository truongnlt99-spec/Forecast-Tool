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
     0. NGHE PROFILE TỪ API — avatar lưu ở cột "avatar" trong
        sheet "Danh sách CS" (nguồn chân lý, dùng được mọi máy).
        ui.js nạp trước app.js, bọc window.fetch lại: mỗi lần
        app.js gọi API và response có d.profile thì đọc luôn
        avatar từ đó — không tốn thêm request nào.
     ------------------------------------------------------- */
  var _fetch = window.fetch;
  window.fetch = function (input, init) {
    var p = _fetch.call(window, input, init);
    try {
      var CFG = window.CS_TOOL_CONFIG || {};
      var url = typeof input === 'string' ? input : ((input && input.url) || '');
      if (CFG.API_URL && url.indexOf(CFG.API_URL) === 0) {
        p = p.then(function (res) {
          try {
            res.clone().json().then(function (d) {
              if (d && d.profile) onProfileFromApi(d.profile);
            }).catch(function () {});
          } catch (e) {}
          return res;
        });
      }
    } catch (e) {}
    return p;
  };

  function onProfileFromApi(profile) {
    var email = profile.email || '';
    if (!email) return;
    // Trường avatar CÓ trong response → sheet là nguồn chân lý:
    // có giá trị thì cache + áp dụng, rỗng thì xoá cache cũ.
    if ('avatar' in profile) {
      try {
        var v = String(profile.avatar || '').trim();
        if (v) localStorage.setItem(avatarKey(email), v);
        else localStorage.removeItem(avatarKey(email));
      } catch (e) {}
    }
    // Trường avatar KHÔNG có (backend chưa trả cột mới) → giữ cache máy.
    applyAvatarEverywhere();
  }

  /* -------------------------------------------------------
     0b. NÚT GOOGLE "XỊN" PHỦ VÔ HÌNH LÊN NÚT CUSTOM
     app.js render nút Google thật (renderButton) vào #gRealButton.
     Trước đây nút thật này bị ẩn (display:none) và chỉ hiện ra sau
     khi One Tap/FedCM thất bại → user phải bấm thêm 1 lần nữa vào
     nút dự phòng. Giờ #gRealButton là 1 overlay vô hình (opacity gần
     0) phủ đúng khít lên #gbtn ngay từ đầu (xem style.css), nên cú
     bấm ĐẦU TIÊN của user đã là bấm thẳng vào nút Google chính chủ —
     không phụ thuộc One Tap thành công hay không, khỏi cần bấm lại.
     Google chèn nút vào bất đồng bộ với kích thước cố định (~280px)
     nên phải co giãn (scale) nó cho khớp bề rộng #gbtn thực tế.
     ------------------------------------------------------- */
  (function () {
    var wrap = $('gbtnWrap'), overlay = $('gRealButton');
    if (!wrap || !overlay) return;

    function fitOverlay() {
      var inner = overlay.firstElementChild;
      if (!inner) return;
      var wrapW = wrap.clientWidth, wrapH = wrap.clientHeight;
      var natW = inner.offsetWidth, natH = inner.offsetHeight;
      if (!wrapW || !wrapH || !natW || !natH) return;
      inner.style.transformOrigin = '0 0';
      inner.style.transform = 'scale(' + (wrapW / natW) + ',' + (wrapH / natH) + ')';
    }
    new MutationObserver(fitOverlay).observe(overlay, { childList: true });
    fitOverlay();
    window.addEventListener('resize', fitOverlay);

    // Phản hồi UI ngay lúc user bấm (mousedown bắn ra TRƯỚC khi trình duyệt
    // chuyển sang xử lý bên trong iframe của Google) — để nút custom vẫn
    // đổi sang trạng thái "đang mở Google…" dù cú bấm thực chất trúng vùng
    // overlay vô hình chứ không phải bản thân #gbtn.
    var busy = false;
    function setLoading(on) {
      if (on === busy) return;
      busy = on;
      var logo = $('glogo'), spinner = $('spinner'), text = $('gtext');
      if (logo) logo.classList.toggle('hidden', on);
      if (spinner) spinner.classList.toggle('hidden', !on);
      if (text) text.textContent = on ? 'Đang mở Google…' : 'Continue with Google';
    }
    function onPress() {
      if (busy) return;
      setLoading(true);
      // An toàn: nếu user đóng popup Google mà không đăng nhập, focus quay
      // lại cửa sổ chính — coi đó là tín hiệu để trả nút về bình thường,
      // tránh kẹt spinner quay mãi. Chốt cứng thêm timeout 8s phòng hờ.
      var back = function () { setTimeout(function () { setLoading(false); }, 400); };
      window.addEventListener('focus', back, { once: true });
      setTimeout(function () {
        if (document.body.classList.contains('login-mode')) setLoading(false);
      }, 8000);
    }
    overlay.addEventListener('mousedown', onPress);
    overlay.addEventListener('touchstart', onPress, { passive: true });
  })();

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
    var lb = $('accThemeLb');
    if (lb) lb.textContent = mode === 'dark' ? 'Chế độ sáng' : 'Chế độ tối';
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', mode === 'dark' ? '#0B0D17' : '#EEF1FB');
    try { localStorage.setItem(LS_THEME, mode); } catch (e) {}
  }
  var themeBtn = $('accTheme');
  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      var cur = document.documentElement.getAttribute('data-theme') || 'dark';
      setTheme(cur === 'dark' ? 'light' : 'dark');
      closeMenu();
    });
  }
  try {
    var saved = localStorage.getItem(LS_THEME);
    setTheme(saved === 'light' ? 'light' : 'dark');
  } catch (e) { setTheme('dark'); }

  /* -------------------------------------------------------
     3b. MENU TÀI KHOẢN — bấm avatar góc phải
     ------------------------------------------------------- */
  var strip = $('profileStrip');
  var accMenu = $('accMenu');

  function closeMenu() {
    if (!accMenu) return;
    accMenu.classList.remove('open');
    if (strip) strip.setAttribute('aria-expanded', 'false');
  }
  if (strip && accMenu) {
    strip.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = accMenu.classList.toggle('open');
      strip.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.addEventListener('click', function (e) {
      if (!accMenu.contains(e.target)) closeMenu();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeMenu();
    });
  }

  /* -------------------------------------------------------
     3c. MODAL CẬP NHẬT THÔNG TIN
     Lưu qua đúng endpoint action:'register' mà app.js dùng ở màn
     đăng ký lần đầu (cùng payload) — backend ghi vào sheet
     "Danh sách CS". Ảnh đại diện lưu localStorage theo email.
     ------------------------------------------------------- */
  // Danh sách level + khung lương — CHÉP TỪ bảng LEVELS trong app.js
  // (buildRegForm chỉ chạy ở màn đăng ký lần đầu nên không mượn lại được).
  // Nếu policy đổi khung lương thì sửa cả 2 nơi.
  var PM_LEVELS = {
    'CS_A level 1': { title: 'Solution Associate',      lo: 9000000,  hi: 9000000 },
    'CS_A level 2': { title: 'Solution Associate',      lo: 11000000, hi: 11000000 },
    'CS level 1':   { title: 'Solution Representative', lo: 10000000, hi: 13000000 },
    'CS level 2':   { title: 'Solution Representative', lo: 11000000, hi: 14000000 },
    'CS level 3':   { title: 'Solution Representative', lo: 12000000, hi: 15000000 },
    'CS level 4':   { title: 'Solution Representative', lo: 13000000, hi: 17000000 },
    'CS level 5':   { title: 'Solution Specialist',     lo: 15000000, hi: 20000000 },
    'CS level 6':   { title: 'Solution Specialist',     lo: 20000000, hi: 25000000 },
    'CS level 7':   { title: 'Solution Specialist',     lo: 25000000, hi: 35000000 },
  };
  var PM_ORDER = ['CS_A level 1','CS_A level 2','CS level 1','CS level 2','CS level 3','CS level 4','CS level 5','CS level 6','CS level 7'];
  var fmtVnd = function (n) { return (n == null ? '—' : Number(n).toLocaleString('vi-VN') + ' đ'); };

  var pmModal = $('pmModal');
  var pmAvatarData = null;   // dataURL đang chọn trong modal (null = chữ cái tên)

  function currentEmailFromUI() {
    // #psSub dạng "Solution Representative · truong.nguyen@base.vn"
    var t = ($('psSub') && $('psSub').textContent) || '';
    var m = t.match(/[\w.+-]+@[\w.-]+/);
    if (m) return m[0];
    return ($('userEmail') && $('userEmail').textContent) || '';
  }
  var avatarKey = function (email) { return 'cs_tool_avatar_' + (email || 'unknown'); };

  function applyAvatarEverywhere() {
    var email = currentEmailFromUI();
    var data = null;
    try { data = localStorage.getItem(avatarKey(email)); } catch (e) {}
    ['psAvatar', 'dbAvatar'].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      // data có thể là dataURL (lưu thẳng trong sheet) hoặc link ảnh (lưu Drive)
      if (data) { el.style.backgroundImage = 'url("' + data + '")'; el.classList.add('has-img'); }
      else { el.style.backgroundImage = ''; el.classList.remove('has-img'); }
    });
    syncRole();
  }

  // Header chỉ hiện chức danh, bỏ email cho gọn (app.js ghi "Chức danh · email")
  function syncRole() {
    var sub = $('psSub'), role = $('psRole');
    if (!sub || !role) return;
    var t = String(sub.textContent || '').trim();
    if (!t || t === '—') { role.textContent = ''; return; }
    role.textContent = t.split('·')[0].trim();
  }

  function pmBuildLevels() {
    var sel = $('pmLevel');
    if (!sel || sel.options.length > 1) return;
    PM_ORDER.forEach(function (lv) {
      var o = document.createElement('option');
      o.value = lv;
      o.textContent = lv + ' — ' + PM_LEVELS[lv].title;
      sel.appendChild(o);
    });
    sel.addEventListener('change', pmOnLevel);
  }
  function pmOnLevel() {
    var lv = $('pmLevel').value, sal = $('pmSalary'), hint = $('pmSalaryHint'), lvHint = $('pmLevelHint');
    if (!lv) { sal.value = ''; sal.disabled = true; sal.placeholder = 'Chọn level trước'; hint.textContent = ''; lvHint.textContent = ''; return; }
    var d = PM_LEVELS[lv];
    lvHint.textContent = d.title;
    if (d.lo === d.hi) {
      sal.value = d.lo; sal.disabled = true;
      hint.textContent = 'Mức cố định theo policy: ' + fmtVnd(d.lo);
    } else {
      sal.disabled = false; sal.placeholder = '';
      hint.textContent = 'Khung theo policy: ' + fmtVnd(d.lo) + ' – ' + fmtVnd(d.hi);
    }
  }

  function pmOpen() {
    closeMenu();
    if (!pmModal) return;
    pmBuildLevels();
    // prefill từ những gì app.js đã hiện trên header
    $('pmName').value = (($('psName') && $('psName').textContent) || '').replace(/^—$/, '');
    var lvChip = document.querySelector('.ps-chip.lvl');
    var lv = lvChip ? lvChip.textContent.trim() : '';
    $('pmLevel').value = PM_LEVELS[lv] ? lv : '';
    pmOnLevel();
    $('pmErr').textContent = '';
    // avatar hiện tại
    var email = currentEmailFromUI();
    try { pmAvatarData = localStorage.getItem(avatarKey(email)); } catch (e) { pmAvatarData = null; }
    pmPreview();
    pmModal.classList.add('open');
  }
  function pmClose() { if (pmModal) pmModal.classList.remove('open'); }

  function pmPreview() {
    var el = $('pmAvatarPreview');
    if (!el) return;
    var name = $('pmName').value.trim() || 'CS';
    var parts = name.split(/\s+/);
    el.textContent = (parts.length > 1 ? parts[parts.length - 2][0] + parts[parts.length - 1][0] : name.slice(0, 2)).toUpperCase();
    if (pmAvatarData) { el.style.backgroundImage = 'url("' + pmAvatarData + '")'; el.classList.add('has-img'); }
    else { el.style.backgroundImage = ''; el.classList.remove('has-img'); }
  }

  // chọn ảnh → thu nhỏ về 128px vuông rồi lưu dataURL cho nhẹ localStorage
  var pmFile = $('pmAvatarFile');
  if (pmFile) pmFile.addEventListener('change', function () {
    var f = pmFile.files && pmFile.files[0];
    if (!f) return;
    var img = new Image();
    img.onload = function () {
      var S = 128, c = document.createElement('canvas');
      c.width = S; c.height = S;
      var ctx = c.getContext('2d');
      var side = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, S, S);
      pmAvatarData = c.toDataURL('image/jpeg', .85);
      pmPreview();
    };
    img.onerror = function () { $('pmErr').textContent = 'Không đọc được file ảnh này.'; };
    img.src = URL.createObjectURL(f);
    pmFile.value = '';
  });
  var pmRemove = $('pmAvatarRemove');
  if (pmRemove) pmRemove.addEventListener('click', function () { pmAvatarData = null; pmPreview(); });
  var pmNameEl = $('pmName');
  if (pmNameEl) pmNameEl.addEventListener('input', pmPreview);

  function pmSave() {
    var hoTen = $('pmName').value.trim();
    var level = $('pmLevel').value;
    var salary = parseInt(String($('pmSalary').value).replace(/[^\d]/g, ''), 10);
    var err = $('pmErr');
    if (!hoTen) { err.textContent = 'Vui lòng nhập Họ và tên.'; return; }
    if (!level) { err.textContent = 'Vui lòng chọn Level.'; return; }
    var d = PM_LEVELS[level];
    if (isNaN(salary) || salary < d.lo || salary > d.hi) {
      err.textContent = 'Salary phải nằm trong khung ' + fmtVnd(d.lo) + ' – ' + fmtVnd(d.hi) + '.';
      return;
    }
    err.textContent = '';
    var btn = $('pmSubmit'), sp = $('pmSpinner'), tx = $('pmBtnText');
    btn.setAttribute('disabled', ''); sp.classList.remove('hidden'); tx.textContent = 'Đang lưu…';

    var email = currentEmailFromUI();
    // avatar: cache ngay trên máy để hiện tức thì, đồng thời gửi lên sheet
    try {
      if (pmAvatarData) localStorage.setItem(avatarKey(email), pmAvatarData);
      else localStorage.removeItem(avatarKey(email));
    } catch (e) {}

    var CFG = window.CS_TOOL_CONFIG || {};
    var token = null;
    try { token = localStorage.getItem('cs_tool_token'); } catch (e) {}

    fetch(CFG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      // cùng action & payload với màn đăng ký lần đầu của app.js, cộng thêm
      // trường avatar (dataURL ảnh 128px, ~5-10KB) — backend ghi vào cột
      // "avatar" trong sheet "Danh sách CS"
      body: JSON.stringify({ token: token, action: 'register', hoTen: hoTen, level: level, salary: salary, avatar: pmAvatarData || '' }),
    })
      .then(function (r) { return r.text(); })
      .then(function (t) { return JSON.parse(t); })
      .then(function (res) {
        if (!res.ok) throw new Error(res.error || 'lỗi không rõ');
        tx.textContent = 'Đã lưu ✓';
        // nạp lại để app.js đọc profile mới từ đầu — mọi công thức
        // (mốc KPI, %com theo level) chắc chắn dùng đúng thông tin vừa sửa
        setTimeout(function () { location.reload(); }, 700);
      })
      .catch(function (e2) {
        btn.removeAttribute('disabled'); sp.classList.add('hidden'); tx.textContent = 'Lưu thay đổi';
        err.textContent = 'Lưu không thành công: ' + e2.message;
      });
  }

  var accEdit = $('accEdit');
  if (accEdit) accEdit.addEventListener('click', pmOpen);
  var pmCloseBtn = $('pmClose');
  if (pmCloseBtn) pmCloseBtn.addEventListener('click', pmClose);
  if (pmModal) pmModal.addEventListener('click', function (e) { if (e.target === pmModal) pmClose(); });
  var pmSubmitBtn = $('pmSubmit');
  if (pmSubmitBtn) pmSubmitBtn.addEventListener('click', pmSave);

  // Avatar tự hiện lại khi app.js điền xong hồ sơ (psSub có email)
  var psSubEl = $('psSub');
  if (psSubEl) {
    new MutationObserver(applyAvatarEverywhere)
      .observe(psSubEl, { childList: true, characterData: true, subtree: true });
    applyAvatarEverywhere();
  }

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

    // Khối điều khiển riêng theo tab trên header (toggle Năm 1/Năm 2++ của
    // Forecast, chọn Tháng đánh giá của Scorecard) — cùng cơ chế bật/tắt
    // như ô tìm kiếm ở trên, không đụng tới sự kiện app.js đã gắn.
    var hteF = $('hteForecast'), hteS = $('hteScorecard');
    if (hteF) hteF.style.display = key === 'forecast' ? '' : 'none';
    if (hteS) hteS.style.display = key === 'dashboard' ? '' : 'none';
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

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
    if (meta) meta.setAttribute('content', mode === 'dark' ? '#0B0D12' : '#F7F8FA');
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

    // Khối điều khiển riêng theo tab trên header (chọn Tháng đánh giá của
    // Scorecard) — cùng cơ chế bật/tắt như ô tìm kiếm ở trên, không đụng
    // tới sự kiện app.js đã gắn. (Toggle Năm 1/Năm 2++ của Forecast đã bỏ
    // khỏi header — xem khối .nav-sub bên dưới.)
    var hteS = $('hteScorecard');
    if (hteS) hteS.style.display = key === 'dashboard' ? '' : 'none';

    // Sub-menu "Năm 1 / Năm 2++" trong sidebar (.nav-sub — hook có sẵn ở
    // CSS: .nav-group.open .nav-sub{...}, trước giờ chưa ai gắn class .open)
    // — luôn hiện ra (không cần hover) khi đang mở đúng tab Forecast, để
    // thay thế hẳn cho toggle từng đặt trên header.
    var fcNavGroup = $('navForecastGroup');
    if (fcNavGroup) fcNavGroup.classList.toggle('open', key === 'forecast');

    // #userBox vốn có sẵn margin-left:auto (để tự đẩy sát phải khi không có
    // gì khác). Ở tab Scorecard, #hteScorecard CŨNG có margin-left:auto để
    // tự đẩy sát phải — 2 margin:auto cùng lúc sẽ CHIA ĐÔI khoảng trống còn
    // lại, để hở 1 khoảng lớn ở giữa thay vì nằm sát nhau. Tắt auto-margin
    // của #userBox riêng ở tab này để chỉ #hteScorecard đẩy cả cặp sang phải.
    var userBox = $('userBox');
    if (userBox) userBox.style.marginLeft = (key === 'dashboard') ? '0' : '';
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
    var COLORS = ['var(--cyan)', 'var(--lav)', 'var(--healthy)', '#F59E0B', 'var(--magenta)'];

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
    var badge = warn.querySelector('.fc-chip-badge');
    var n = badge ? badge.textContent.trim() : '';
    navMissing.textContent = (n && n !== '0') ? n : '';
  }
  if (fcChips) {
    new MutationObserver(syncMissing).observe(fcChips, { childList: true, subtree: true });
  }

  /* -------------------------------------------------------
     8. DONUT TƯƠNG TÁC — app.js chỉ vẽ tĩnh #donutSolution/#donutContract
        (SVG lát cắt + legend, xem renderDonut trong app.js). Ở đây chỉ
        gắn thêm hover: rê vào legend thì tô đậm đúng lát cắt tương ứng
        (khớp theo THỨ TỰ phần tử, lát cắt thứ i ứng với legend-item thứ
        i), và ngược lại — không tính toán lại số liệu, không đụng logic
        app.js. Dùng event delegation trên chính #donutSolution/#donutContract
        (2 id này app.js không bao giờ xoá/tạo lại) nên không cần gắn lại
        listener mỗi lần bộ lọc đổi làm donut vẽ lại.
     ------------------------------------------------------- */
  function bindDonut(id) {
    var wrap = $(id);
    if (!wrap) return;

    function items() { return Array.prototype.slice.call(wrap.querySelectorAll('.legend-item')); }
    function circles() { return Array.prototype.slice.call(wrap.querySelectorAll('circle')); }

    function setActive(idx) {
      circles().forEach(function (c, i) { c.classList.toggle('donut-dim', idx > -1 && i !== idx); });
      items().forEach(function (it, i) {
        it.classList.toggle('legend-dim', idx > -1 && i !== idx);
        it.classList.toggle('legend-active', i === idx);
      });
    }

    wrap.addEventListener('mouseover', function (e) {
      var item = e.target.closest('.legend-item');
      var circle = e.target.closest('circle');
      var idx = item ? items().indexOf(item) : (circle ? circles().indexOf(circle) : -1);
      if (idx > -1) setActive(idx);
    });
    wrap.addEventListener('mouseout', function (e) {
      if (!wrap.contains(e.relatedTarget)) setActive(-1);
    });

    // Tooltip gốc cho từng lát cắt — lấy đúng chữ legend app.js đã render,
    // không tự tính lại số liệu.
    function addTips() {
      var cs = circles(), its = items();
      cs.forEach(function (c, i) {
        if (c.querySelector('title')) return;
        var name = its[i] && its[i].querySelector('.legend-name');
        var val = its[i] && its[i].querySelector('.legend-val');
        var t = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        t.textContent = (name ? name.textContent : '') + (val ? ' — ' + val.textContent : '');
        c.insertBefore(t, c.firstChild);
      });
    }
    addTips();
    new MutationObserver(addTips).observe(wrap, { childList: true, subtree: true });
  }
  bindDonut('donutSolution');
  bindDonut('donutContract');

  /* -------------------------------------------------------
     9. THANH PERFORMANCE (KPI/GOAL/OUT) — app.js vẽ 3 vạch mốc bằng
        left:<mốc>% trên thang 0–100% (dashRenderPerf/perfBar trong
        app.js). Khi cả 3 mốc đều cao (vd 78/80/83) thì rất sát nhau,
        chữ nhãn (::after hiển thị attr(title) trong CSS) đè lên nhau.
        Ở đây không sửa app.js — chỉ đọc lại left/title app.js đã render
        rồi TÍNH LẠI theo thang phóng to 50–100% khi cả 3 mốc đều ≥ 50,
        để 3 vạch giãn ra đủ chỗ cho chữ. Mốc nào < 50 thì giữ nguyên
        thang 0–100% như cũ (không zoom).
     ------------------------------------------------------- */
  function numFrom(str) {
    var m = /(-?\d+(?:[.,]\d+)?)\s*%/.exec(str || '');
    return m ? parseFloat(m[1].replace(',', '.')) : null;
  }
  function zoomPct(v) { return Math.max(0, Math.min(100, (v - 50) * 2)); }

  function enhancePerfBar(track) {
    var ticks = Array.prototype.slice.call(track.querySelectorAll(':scope > .pf-tick'));
    var fill = track.querySelector(':scope > .pf-fill');
    if (!ticks.length || !fill) return;

    var tickVals = ticks.map(function (t) { return numFrom(t.getAttribute('title')); });
    var fillPct = numFrom(fill.getAttribute('style'));
    if (tickVals.indexOf(null) !== -1 || fillPct == null) return;

    // Chú thích KPI/GOAL/OUT tách thành 1 hàng riêng bên dưới track (không
    // đè lên nhau nữa), vẫn tô màu đúng theo từng mốc để phân biệt. Chạy
    // trước điều kiện zoom bên dưới vì cần áp dụng cho mọi track có tick,
    // không chỉ track bị zoom.
    if (!track.parentNode.querySelector(':scope > .pf-legend')) {
      var legend = document.createElement('div');
      legend.className = 'pf-legend';
      ticks.forEach(function (t) {
        var title = t.getAttribute('title') || ''; // VD "KPI: 78%"
        var sep = title.indexOf(':');
        var lbl = sep === -1 ? title : title.slice(0, sep).trim();
        var val = sep === -1 ? '' : title.slice(sep + 1).trim();
        var tickClass = t.className.split(/\s+/).filter(function (c) { return c.indexOf('t-') === 0; })[0] || '';
        var item = document.createElement('span');
        item.className = 'pf-legend-item ' + tickClass;
        item.innerHTML = '<i class="pf-legend-dot"></i>' + lbl + (val ? ' ' + val : '');
        legend.appendChild(item);
      });
      track.parentNode.insertBefore(legend, track.nextSibling);
    }

    if (Math.min.apply(null, tickVals) < 50) return; // số không lớn — giữ thang gốc

    ticks.forEach(function (t, i) { t.style.left = zoomPct(tickVals[i]) + '%'; });
    fill.style.width = zoomPct(fillPct) + '%';

    if (!track.querySelector('.pf-axis-lbl')) {
      var lo = document.createElement('span');
      lo.className = 'pf-axis-lbl pf-axis-lo'; lo.textContent = '50%';
      var hi = document.createElement('span');
      hi.className = 'pf-axis-lbl pf-axis-hi'; hi.textContent = '100%';
      track.appendChild(lo); track.appendChild(hi);
    }
  }
  function enhancePerfGrid() {
    var grid = $('perfGrid');
    if (!grid) return;
    Array.prototype.forEach.call(grid.querySelectorAll('.pf-track'), enhancePerfBar);
  }
  var perfGridEl = $('perfGrid');
  if (perfGridEl) {
    new MutationObserver(enhancePerfGrid).observe(perfGridEl, { childList: true });
    enhancePerfGrid();
  }

  // Rút gọn text trong dropdown "Tháng đánh giá" (#dbMonth) từ "07/2026 · hiện
  // tại" thành "07/26" — gọn đủ để nằm chung dòng 1 với profile trên mobile.
  // Đọc từ attribute value (app.js ghi "07/2026") thay vì parse textContent
  // đang hiển thị, để không tự đè lên chính kết quả mình vừa rút gọn.
  function shortenMonthOptions() {
    var sel = $('dbMonth');
    if (!sel) return;
    Array.prototype.forEach.call(sel.querySelectorAll('option'), function (opt) {
      if (opt.dataset.shortened) return;
      var m = /^(\d{2})\/(\d{4})/.exec(opt.getAttribute('value') || '');
      if (!m) return;
      opt.textContent = m[1] + '/' + m[2].slice(2);
      opt.dataset.shortened = '1';
    });
  }
  var dbMonthEl = $('dbMonth');
  if (dbMonthEl) {
    new MutationObserver(shortenMonthOptions).observe(dbMonthEl, { childList: true });
    shortenMonthOptions();
  }

  // Ẩn câu ghi chú mặc định (khi Performance đạt Strong/Healthy) trong
  // #perfRating vì đã có badge màu + legend KPI/GOAL/OUT thể hiện đủ rồi.
  // Chỉ ẩn ĐÚNG câu boilerplate này — giữ nguyên các câu note quan trọng khác
  // (VD giải thích commission hỗ trợ khi Under KPI, hoặc khi chưa có dữ liệu)
  // vì app.js vẫn ghi những câu đó vào cùng 1 chỗ (#perfRating .pr-note).
  function hidePerfBoilerplateNote() {
    var rating = $('perfRating');
    if (!rating) return;
    var note = rating.querySelector('.pr-note');
    if (!note) return;
    var isBoilerplate = note.textContent.indexOf('Xét đồng thời các chỉ số') === 0;
    note.style.display = isBoilerplate ? 'none' : '';
  }
  var perfRatingEl = $('perfRating');
  if (perfRatingEl) {
    new MutationObserver(hidePerfBoilerplateNote).observe(perfRatingEl, { childList: true, subtree: true });
    hidePerfBoilerplateNote();
  }

  // CHS score color gradient (low score = light blue, high score = dark blue)
  function colorizeChsScores() {
    var radarRows = document.querySelectorAll('.radar-row');
    Array.prototype.forEach.call(radarRows, function(row) {
      var cells = row.querySelectorAll('.radar-m');
      if (!cells.length) return;
      var scoreText = cells[0].textContent.trim();
      var match = scoreText.match(/(\d+)/);
      if (!match) return;
      var score = parseInt(match[1], 10);
      // Gradient: 0-40 = light blue (#9EBFFF), 41-79 = medium (#6FA0FF), 80-100 = dark (#3D5CFF)
      var color;
      if (score < 40) color = '#9EBFFF';
      else if (score < 80) color = '#6FA0FF';
      else color = '#3D5CFF';
      row.style.color = color;
    });
  }
  var dashBody = $('dashBody');
  if (dashBody) {
    new MutationObserver(colorizeChsScores).observe(dashBody, { childList: true, subtree: true });
    colorizeChsScores();
  }

  // CHS average score on Overview - apply same gradient instead of health band color
  function colorizeOverviewChsScore() {
    var kpiChs = $('kpiChs');
    if (!kpiChs) return;
    var text = kpiChs.textContent.trim();
    var match = text.match(/([\d,]+)/);
    if (!match) return;
    var scoreStr = match[1].replace(',', '.');
    var score = parseFloat(scoreStr);
    if (isNaN(score)) return;
    var color;
    if (score < 40) color = '#9EBFFF';
    else if (score < 80) color = '#6FA0FF';
    else color = '#3D5CFF';
    kpiChs.style.color = color;
  }
  // Observe kpiChs changes
  var kpiChs = $('kpiChs');
  if (kpiChs) {
    new MutationObserver(colorizeOverviewChsScore).observe(kpiChs, { childList: true, characterData: true, subtree: true });
    colorizeOverviewChsScore();
  }

  // Google login UX - show loading state
  var gbtn = $('gbtn');
  if (gbtn) {
    var originalSignIn = window.signInWithGoogle;
    window.signInWithGoogle = function() {
      // Disable button, fade out, show loading
      gbtn.disabled = true;
      gbtn.style.opacity = '0.6';
      gbtn.style.cursor = 'wait';
      // Show spinner, hide text
      var spinner = $('spinner');
      var gtext = $('gtext');
      var glogo = $('glogo');
      if (spinner) spinner.classList.remove('hidden');
      if (glogo) glogo.classList.add('hidden');
      if (gtext) gtext.textContent = 'Đang xác nhận...';
      // Call original Google sign-in
      if (originalSignIn) originalSignIn();
    };
  }

  /* -------------------------------------------------------
     11. FORECAST — GIA HẠN GO-LIVE / DỪNG TRIỂN KHAI / MÀN REQUEST
     ---------------------------------------------------------
     app.js đóng kín (IIFE, không expose fcDeals/fcState), nên module này:
       (a) Tự "nghe" lại response API sheet=Database (bọc fetch — cùng cơ chế
           PHẦN 0 nghe profile) để có bản dữ liệu deal riêng, đọc thêm 3 cột
           mà app.js không dùng: "Ngày Go-live gia hạn" (cột O), "Dừng triển
           khai" (cột T) và "Link request" (nếu có).
       (b) Ghi dữ liệu qua API action='saveRequest' (cần cập nhật Apps Script
           — xem APPS_SCRIPT_UPDATE.md trong repo). Chỉ cập nhật giao diện
           sau khi backend trả ok — không lưu "giả" phía client.
       (c) Vẽ đè phần hiển thị lên bảng của app.js (nhãn Gia hạn/Dừng, hàng
           mượn ở tháng gia hạn, 2 card CR đã điều chỉnh) bằng MutationObserver
           idempotent — mỗi lượt chỉ bổ sung phần còn thiếu nên không lặp vô hạn.
     Quy tắc CR (theo spec Gia hạn & Dừng):
       - Deal DỪNG: loại khỏi tử & mẫu CR ở MỌI tháng.
       - Deal GIA HẠN: loại khỏi tháng CR gốc, tính vào tháng của ngày
         Go-live gia hạn (tháng hiển thị = tháng làm việc đang chọn).
     ------------------------------------------------------- */
  (function () {
    var fcTbodyEl = $('fcTbody');
    if (!fcTbodyEl) return;

    var CFGQ = window.CS_TOOL_CONFIG || {};
    var qList = null;            // deals đã normalize (bản riêng của module)
    var qById = {};              // id -> deal
    var qKeymap = null;

    /* ---------- helpers (bản thu nhỏ của app.js, không gọi được bản gốc) ---------- */
    function qFindKey(keys, patterns) {
      for (var i = 0; i < patterns.length; i++) {
        var p = patterns[i].toLowerCase();
        for (var j = 0; j < keys.length; j++) {
          if (keys[j].toLowerCase().indexOf(p) !== -1) return keys[j];
        }
      }
      return null;
    }
    function qParseDate(v) {
      if (v == null || v === '') return null;
      if (v instanceof Date) return isNaN(v) ? null : v;
      var s = String(v).trim();
      var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
      var d = new Date(s);
      return isNaN(d) ? null : d;
    }
    function qParseMoney(v) {
      if (v == null || v === '') return 0;
      if (typeof v === 'number') return v;
      var n = Number(String(v).replace(/[^\d.-]/g, ''));
      return isNaN(n) ? 0 : n;
    }
    function qParseDays(v) {
      if (v == null || v === '') return null;
      var m = String(v).match(/\d+/);
      return m ? +m[0] : null;
    }
    function qMNorm(v) {
      if (v == null) return '';
      if (v instanceof Date && !isNaN(v)) return String(v.getMonth() + 1).padStart(2, '0') + '/' + v.getFullYear();
      var s = String(v).trim();
      var m = s.match(/(\d{1,2})\s*\/\s*(\d{4})$/);
      if (m && s.indexOf('/') === s.lastIndexOf('/')) return String(+m[1]).padStart(2, '0') + '/' + m[2];
      var d = qParseDate(s);
      return d ? qMNorm(d) : '';
    }
    function qFmtDate(d) {
      if (!d) return '—';
      return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
    }
    function qToInputDate(d) {
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    function qFmtMoney(n) {
      if (n == null) return '—';
      return n.toLocaleString('vi-VN') + ' đ';
    }
    function qFmtMoneyShort(n) {
      if (n == null) return '—';
      if (n >= 1e9) return (Math.round(n / 1e7) / 100).toLocaleString('vi-VN') + ' tỷ';
      if (n >= 1e6) return Math.round(n / 1e6).toLocaleString('vi-VN') + 'tr';
      return n.toLocaleString('vi-VN') + ' đ';
    }
    function qEsc(v) {
      return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    }
    var qToastTimer = null;
    function qToast(msg, kind) {
      var el = $('toast');
      if (!el) return;
      el.textContent = msg;
      el.className = 'toast show' + (kind ? ' ' + kind : '');
      clearTimeout(qToastTimer);
      qToastTimer = setTimeout(function () { el.className = 'toast'; }, 4200);
    }

    /* ---------- đọc dữ liệu: nghe response API sheet=Database ---------- */
    function qBuildKeymap(sample) {
      var keys = Object.keys(sample);
      qKeymap = {
        id:       qFindKey(keys, ['deal id']),
        company:  qFindKey(keys, ['tên công ty', 'ten cong ty']),
        name:     qFindKey(keys, ['tên khách hàng', 'khách hàng']),
        sysId:    qFindKey(keys, ['system id', 'sys id']),
        val:      qFindKey(keys, ['giá trị phần mềm']),
        received: qFindKey(keys, ['ngày nhận']),
        ttgl:     qFindKey(keys, ['ttgl']),
        glPlan:   qFindKey(keys, ['go-live dự kiến', 'golive dự kiến']),
        glActual: qFindKey(keys, ['go-live thực tế', 'golive thực tế']),
        crMonth:  qFindKey(keys, ['tháng ghi nhận']),
        dtPhai:   qFindKey(keys, ['dt phải go-live', 'dt phải golive', 'phải go-live']),
        acr:      qFindKey(keys, ['acr (vnđ', 'acr (']),
        // 3 cột riêng của tính năng này (app.js không đọc):
        glExtend: qFindKey(keys, ['go-live gia hạn', 'golive gia hạn', 'gia hạn']),
        stop:     qFindKey(keys, ['dừng triển khai', 'dung trien khai']),
        reqLink:  qFindKey(keys, ['link request', 'link đề xuất', 'link de xuat']),
      };
    }
    function qNormalize(raw) {
      if (!qKeymap) qBuildKeymap(raw);
      var K = qKeymap, g = function (k) { return k ? raw[k] : null; };
      var stopRaw = g(K.stop);
      var d = {
        id: String(g(K.id) || ''),
        company: String(g(K.company) || g(K.name) || '—'),
        sysId: String(g(K.sysId) || ''),
        val: qParseMoney(g(K.val)),
        received: qParseDate(g(K.received)),
        ttgl: qParseDays(g(K.ttgl)),
        glPlan: qParseDate(g(K.glPlan)),
        glActual: qParseDate(g(K.glActual)),
        crMonth: qMNorm(g(K.crMonth)),
        dtPhai: qParseMoney(g(K.dtPhai)),
        acr: qParseMoney(g(K.acr)),
        glExtend: qParseDate(g(K.glExtend)),
        stopped: !!(stopRaw != null && String(stopRaw).trim() !== '' && String(stopRaw).trim().toLowerCase() !== 'false'),
        reqLink: String(g(K.reqLink) || '').trim(),
      };
      // Ngày Go-live tối đa = ngày nhận + 200% TTGL (đúng công thức "quá 200%
      // định mức TTGL" mà app.js dùng ở fcTags/fcCompute).
      d.glMax = (d.received && d.ttgl != null) ? new Date(d.received.getTime() + 2 * d.ttgl * 86400000) : null;
      return d;
    }
    function qSub(d) { return (d.sysId ? 'Sys ' + d.sysId + ' · ' : '') + 'Deal ' + d.id; }

    var _fetchR = window.fetch;
    window.fetch = function (input, init) {
      var p = _fetchR.call(window, input, init);
      try {
        var url = typeof input === 'string' ? input : ((input && input.url) || '');
        if (CFGQ.API_URL && url.indexOf(CFGQ.API_URL) === 0 && url.indexOf('sheet=Database') !== -1) {
          p = p.then(function (res) {
            try {
              res.clone().json().then(function (d) {
                if (d && d.ok && d.deals) {
                  qKeymap = null;
                  qList = d.deals.map(qNormalize).filter(function (x) { return x.id; });
                  qById = {};
                  qList.forEach(function (x) { qById[x.id] = x; });
                  qDecorateSoon();
                  qRenderReqList();
                  qCrAdjustSoon();
                }
              }).catch(function () {});
            } catch (e) {}
            return res;
          });
        }
      } catch (e) {}
      return p;
    };

    /* ---------- ghi dữ liệu: API action=saveRequest ---------- */
    // payload: { token, action:'saveRequest', dealId, reqType:'extend'|'stop',
    //            glExtend:'dd/mm/yyyy'|'', requestLink:'', remove:true|false }
    // Backend cần được cập nhật để xử lý action này — xem APPS_SCRIPT_UPDATE.md.
    function qSaveRequest(payload, done) {
      var token = localStorage.getItem('cs_tool_token');
      payload.token = token;
      payload.action = 'saveRequest';
      fetch(CFGQ.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
      })
        .then(function (r) { return r.text(); })
        .then(function (text) {
          var d; try { d = JSON.parse(text); } catch (e) { d = null; }
          if (d && d.ok) { done(null); }
          else { done((d && d.error) || 'Backend chưa hỗ trợ action saveRequest — cần cập nhật Apps Script (xem APPS_SCRIPT_UPDATE.md trong repo).'); }
        })
        .catch(function (err) { done(err.message || 'Lỗi mạng'); });
    }
    // Cập nhật bản dữ liệu local sau khi backend đã lưu ok
    function qApplyLocal(payload) {
      var d = qById[payload.dealId];
      if (!d) return;
      if (payload.remove) {
        if (payload.reqType === 'extend') d.glExtend = null;
        if (payload.reqType === 'stop') d.stopped = false;
        d.reqLink = '';
      } else if (payload.reqType === 'extend') {
        d.glExtend = qParseDate(payload.glExtend);
        d.reqLink = payload.requestLink || '';
      } else if (payload.reqType === 'stop') {
        d.stopped = true;
        d.reqLink = payload.requestLink || '';
      }
      qStripDecorations();
      qDecorateSoon();
      qRenderReqList();
      qCrAdjustSoon();
    }

    /* =========================================================
       A. MODAL — Gia hạn / Dừng / Tạo mới / Sửa
       ========================================================= */
    var reqModal = $('reqModal'), reqModalTitle = $('reqModalTitle'), reqModalBody = $('reqModalBody');
    var reqConfirmModal = $('reqConfirmModal'), reqConfirmTitle = $('reqConfirmTitle'), reqConfirmBody = $('reqConfirmBody');
    function qOpenModal(m) { if (m) m.classList.add('open'); }
    function qCloseModal(m) { if (m) m.classList.remove('open'); }
    var closeBtn1 = $('reqModalClose'), closeBtn2 = $('reqConfirmClose');
    if (closeBtn1) closeBtn1.addEventListener('click', function () { qCloseModal(reqModal); });
    if (closeBtn2) closeBtn2.addEventListener('click', function () { qCloseModal(reqConfirmModal); });
    [reqModal, reqConfirmModal].forEach(function (m) {
      if (m) m.addEventListener('click', function (e) { if (e.target === m) qCloseModal(m); });
    });

    function qInfoGrid(d) {
      return '<dl class="req-info-grid">' +
        '<dt>Tên deal</dt><dd>' + qEsc(d.company) + '<div class="req-item-sub">' + qEsc(qSub(d)) + '</div></dd>' +
        '<dt>Giá trị hợp đồng</dt><dd>' + qFmtMoney(d.val || null) + '</dd>' +
        '<dt>Ngày Go-live dự kiến</dt><dd>' + qFmtDate(d.glPlan) + '</dd>' +
        '<dt>Ngày Go-live tối đa <span class="req-item-sub">(200% TTGL)</span></dt><dd>' + qFmtDate(d.glMax) + '</dd>' +
        '<dt>TTGL</dt><dd>' + (d.ttgl != null ? d.ttgl + ' ngày' : '—') + '</dd>' +
      '</dl>';
    }

    // Mở modal đề xuất cho 1 deal cụ thể. type='extend'|'stop'. isEdit chỉ đổi câu chữ.
    function qOpenDealModal(type, d, isEdit) {
      if (!d) return;
      reqModalTitle.textContent = (type === 'extend')
        ? ((isEdit ? 'Sửa đề xuất — ' : '') + 'Gia hạn Go-live')
        : ((isEdit ? 'Sửa đề xuất — ' : '') + 'Dừng triển khai');
      var glExtVal = d.glExtend ? qToInputDate(d.glExtend) : '';
      var maxAttr = d.glMax ? ' max="' + qToInputDate(d.glMax) + '"' : '';
      var html = qInfoGrid(d);
      if (type === 'extend') {
        html +=
          '<div class="req-form-field"><label>Ngày Go-live gia hạn <b>*</b></label>' +
            '<input type="date" class="req-in" id="reqGlExtend" value="' + glExtVal + '"' + maxAttr + '></div>' +
          '<div class="req-error" id="reqErr"></div>' +
          '<div class="req-form-field"><label>Link Request (không bắt buộc — đề xuất trên hệ thống Base)</label>' +
            '<input type="url" class="req-in" id="reqLink" placeholder="https://..." value="' + qEsc(d.reqLink) + '"></div>' +
          '<div class="req-actions">' +
            '<button type="button" class="req-btn-ghost" id="reqCancel">Huỷ</button>' +
            '<button type="button" class="req-btn-primary" id="reqOk">Xác nhận gia hạn</button>' +
          '</div>';
      } else {
        html +=
          '<div class="req-warn">Deal dừng triển khai sẽ bị loại khỏi tử số &amp; mẫu số CR của tháng hiện tại và <b>tất cả các tháng tiếp theo</b> (bỏ ra khỏi danh sách deal cần Go-live).</div>' +
          '<div class="req-form-field"><label>Link Request (không bắt buộc — đề xuất trên hệ thống Base)</label>' +
            '<input type="url" class="req-in" id="reqLink" placeholder="https://..." value="' + qEsc(d.reqLink) + '"></div>' +
          '<div class="req-error" id="reqErr"></div>' +
          '<div class="req-actions">' +
            '<button type="button" class="req-btn-ghost" id="reqCancel">Huỷ</button>' +
            '<button type="button" class="req-btn-danger" id="reqOk">Dừng triển khai</button>' +
          '</div>';
      }
      reqModalBody.innerHTML = html;
      qOpenModal(reqModal);
      $('reqCancel').addEventListener('click', function () { qCloseModal(reqModal); });
      $('reqOk').addEventListener('click', function () {
        var link = ($('reqLink') && $('reqLink').value.trim()) || '';
        var errEl = $('reqErr');
        if (type === 'extend') {
          var v = $('reqGlExtend').value;
          if (!v) { errEl.textContent = 'Cần chọn Ngày Go-live gia hạn.'; errEl.style.display = 'block'; return; }
          var dt = qParseDate(v.split('-').reverse().join('/'));
          if (d.glMax && dt && dt.getTime() > d.glMax.getTime()) {
            errEl.textContent = 'Ngày gia hạn không được vượt quá Ngày Go-live tối đa (' + qFmtDate(d.glMax) + ' — mốc 200% TTGL).';
            errEl.style.display = 'block'; return;
          }
          errEl.style.display = 'none';
          var p = d.glExtend, pv = v.split('-');
          qSubmit({ dealId: d.id, reqType: 'extend', glExtend: pv[2] + '/' + pv[1] + '/' + pv[0], requestLink: link, remove: false });
        } else {
          // Dừng triển khai: xác nhận thêm 1 lần nữa (popup nhỏ) theo spec
          qMiniConfirm(
            'Dừng triển khai deal?',
            'Xác nhận dừng triển khai <b>' + qEsc(d.company) + '</b>?<br>Thao tác này sẽ loại deal khỏi CR của mọi tháng.',
            'Xác nhận dừng', 'req-btn-danger',
            function () { qSubmit({ dealId: d.id, reqType: 'stop', glExtend: '', requestLink: link, remove: false }); }
          );
        }
      });
    }

    function qMiniConfirm(title, bodyHtml, okLabel, okClass, onOk) {
      reqConfirmTitle.textContent = title;
      reqConfirmBody.innerHTML =
        '<p style="line-height:1.7">' + bodyHtml + '</p>' +
        '<div class="req-actions">' +
          '<button type="button" class="req-btn-ghost" id="reqCfCancel">Huỷ</button>' +
          '<button type="button" class="' + okClass + '" id="reqCfOk">' + okLabel + '</button>' +
        '</div>';
      qOpenModal(reqConfirmModal);
      $('reqCfCancel').addEventListener('click', function () { qCloseModal(reqConfirmModal); });
      $('reqCfOk').addEventListener('click', function () { qCloseModal(reqConfirmModal); onOk(); });
    }

    var qSubmitting = false;
    function qSubmit(payload) {
      if (qSubmitting) return;
      qSubmitting = true;
      var flag = $('reqFlag'); if (flag) flag.textContent = 'đang lưu…';
      qSaveRequest(payload, function (err) {
        qSubmitting = false;
        if (flag) flag.textContent = '';
        if (err) { qToast('⚠ Không lưu được: ' + err, 'err'); return; }
        qApplyLocal(payload);
        qCloseModal(reqModal);
        qCloseModal(reqConfirmModal);
        qToast(payload.remove
          ? '✓ Đã xoá đề xuất — nhớ bấm "Làm mới dữ liệu" nếu cần đồng bộ lại toàn trang.'
          : (payload.reqType === 'extend' ? '✓ Đã lưu đề xuất Gia hạn Go-live về sheet Database (cột Ngày Go-live gia hạn).'
                                          : '✓ Đã lưu Dừng triển khai về sheet Database (cột Dừng triển khai).'), 'ok');
      });
    }

    /* ---- Tạo mới từ màn Request: chọn loại → tìm deal → form ---- */
    var CLOCK_BIG = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
    var X_BIG = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    function qOpenCreateModal() {
      reqModalTitle.textContent = 'Tạo đề xuất mới';
      reqModalBody.innerHTML =
        '<p style="margin-bottom:14px; color:var(--tx-3); font-size:12.5px">Chọn loại request:</p>' +
        '<div class="req-type-choice">' +
          '<button type="button" class="req-type-card rt-extend" id="rtExtend">' + CLOCK_BIG + 'Gia hạn triển khai</button>' +
          '<button type="button" class="req-type-card rt-stop" id="rtStop">' + X_BIG + 'Dừng triển khai</button>' +
        '</div>';
      qOpenModal(reqModal);
      $('rtExtend').addEventListener('click', function () { qOpenSearchStep('extend'); });
      $('rtStop').addEventListener('click', function () { qOpenSearchStep('stop'); });
    }
    function qOpenSearchStep(type) {
      reqModalTitle.textContent = (type === 'extend') ? 'Gia hạn Go-live — chọn deal' : 'Dừng triển khai — chọn deal';
      reqModalBody.innerHTML =
        '<div class="req-form-field"><label>Tên deal</label>' +
          '<div class="req-search-wrap">' +
            '<input type="text" class="req-in" id="reqSearch" placeholder="Gõ tên công ty, Sys ID hoặc Deal ID…" autocomplete="off">' +
            '<div class="req-suggest" id="reqSuggest"></div>' +
          '</div></div>' +
        '<div class="req-actions"><button type="button" class="req-btn-ghost" id="reqCancel">Huỷ</button></div>';
      $('reqCancel').addEventListener('click', function () { qCloseModal(reqModal); });
      var inp = $('reqSearch'), box = $('reqSuggest');
      inp.focus();
      inp.addEventListener('input', function () {
        var q = inp.value.trim().toLowerCase();
        if (!q || !qList) { box.classList.remove('open'); return; }
        var hits = qList.filter(function (d) {
          return (d.company + ' ' + d.sysId + ' ' + d.id).toLowerCase().indexOf(q) !== -1;
        }).slice(0, 8);
        box.innerHTML = hits.length
          ? hits.map(function (d) {
              return '<div class="req-suggest-item" data-deal="' + qEsc(d.id) + '">' + qEsc(d.company) +
                     '<div class="rs-sub">' + qEsc(qSub(d)) + '</div></div>';
            }).join('')
          : '<div class="req-suggest-empty">Không tìm thấy deal nào khớp.</div>';
        box.classList.add('open');
      });
      box.addEventListener('click', function (e) {
        var item = e.target.closest('.req-suggest-item');
        if (!item) return;
        var d = qById[item.getAttribute('data-deal')];
        if (d) qOpenDealModal(type, d, false);
      });
    }

    /* =========================================================
       B. NÚT TRÊN BẢNG DANH SÁCH DEAL (thay placeholder toast cũ)
       ========================================================= */
    var CLOCK_SVG = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
    var X_SVG = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    var PEN_SVG = '<svg viewBox="0 0 24 24"><path d="M4 20l4-1 11-11-3-3L5 16l-1 4zM14 6l3 3"/></svg>';
    var TRASH_SVG = '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg>';

    function qAddActionCell(tr) {
      if (!tr.id || tr.querySelector('.fc-action-col')) return;
      var dealId = tr.id.replace(/^fc-row-/, '');
      var td = document.createElement('td');
      td.className = 'fc-action-col';
      td.innerHTML =
        '<div class="fc-action-btns">' +
          '<button type="button" class="fc-icon-btn fc-extend-btn" title="Gia hạn Go-live" aria-label="Gia hạn Go-live">' + CLOCK_SVG + '</button>' +
          '<button type="button" class="fc-icon-btn fc-stop-btn" title="Dừng triển khai" aria-label="Dừng triển khai">' + X_SVG + '</button>' +
        '</div>';
      td.querySelector('.fc-extend-btn').addEventListener('click', function () {
        var d = qById[dealId];
        if (!d) { qToast('Dữ liệu deal chưa tải xong — thử lại sau vài giây.', 'err'); return; }
        qOpenDealModal('extend', d, !!d.glExtend);
      });
      td.querySelector('.fc-stop-btn').addEventListener('click', function () {
        var d = qById[dealId];
        if (!d) { qToast('Dữ liệu deal chưa tải xong — thử lại sau vài giây.', 'err'); return; }
        if (d.stopped) { qShowReqView(); return; } // đã dừng rồi → xem đề xuất
        qOpenDealModal('stop', d, false);
      });
      tr.appendChild(td);
    }

    /* ---- Nhãn Gia hạn / Dừng triển khai cạnh tên deal (bấm → màn Request) ---- */
    function qAddBadge(tr) {
      if (!tr.id) return;
      var d = qById[tr.id.replace(/^fc-row-/, '')];
      if (!d) return;
      var nameRow = tr.querySelector('.deal-name-row');
      if (!nameRow) return;
      var existing = nameRow.querySelector('.fc-flag-badge');
      var want = d.stopped ? 'stop' : (d.glExtend ? 'extend' : null);
      var has = existing ? (existing.classList.contains('fb-stop') ? 'stop' : 'extend') : null;
      if (want === has) {
        tr.classList.toggle('fc-row-stopped', d.stopped);
        return;
      }
      if (existing) existing.remove();
      tr.classList.toggle('fc-row-stopped', d.stopped);
      if (!want) return;
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'fc-flag-badge ' + (want === 'stop' ? 'fb-stop' : 'fb-extend');
      b.textContent = (want === 'stop') ? 'Dừng triển khai' : 'Gia hạn';
      b.title = 'Xem đề xuất ở màn Request';
      b.addEventListener('click', function () { qShowReqView(); });
      nameRow.appendChild(b);
    }

    /* ---- Hàng "mượn": deal gia hạn hiện thêm ở tháng của ngày Go-live gia hạn ---- */
    function qInjectExtendedRows() {
      var sel = $('fcFilterMonth');
      var cur = (sel && sel.value) || qMNorm(new Date());
      if (!qList) return;
      qList.forEach(function (d) {
        if (!d.glExtend || d.stopped) return;
        if (qMNorm(d.glExtend) !== cur) return;
        if (document.getElementById('fc-row-' + d.id)) return; // app.js đã render sẵn ở tháng này
        var tr = document.createElement('tr');
        tr.id = 'fc-row-' + d.id;
        tr.className = 'fc-injected';
        tr.innerHTML =
          '<td><div class="deal-name-row"><span class="deal-name">' + qEsc(d.company) + '</span></div>' +
            '<div class="deal-id">' + qEsc(qSub(d)) + '</div>' +
            '<div class="fc-injected-note">Hiện ở tháng này theo ngày Go-live gia hạn</div></td>' +
          '<td class="num fc-extra">' + qFmtMoneyShort(d.val || null) + '</td>' +
          '<td class="fc-extra">' + qEsc(qFmtDate(d.glPlan)) + '</td>' +
          '<td class="fc-y fc-yL">' + qEsc(d.glActual ? qFmtDate(d.glActual) : '—') + '</td>' +
          '<td class="fc-y num">—</td><td class="fc-y num">—</td><td class="fc-y num">—</td><td class="fc-y num fc-yR">—</td>' +
          '<td class="num">—</td><td class="num">—</td>' +
          '<td class="fc-extra">—</td>' +
          '<td class="fc-extra">Gia hạn → ' + qEsc(qFmtDate(d.glExtend)) + '</td>' +
          '<td class="fc-extra">' + qEsc(qMNorm(d.glExtend)) + '</td>' +
          '<td class="num fc-extra">' + qFmtMoneyShort(d.acr || null) + '</td>';
        fcTbodyEl.appendChild(tr);
      });
    }

    function qStripDecorations() {
      // gỡ hàng mượn + badge cũ để pass kế tiếp vẽ lại theo dữ liệu mới
      fcTbodyEl.querySelectorAll('tr.fc-injected').forEach(function (tr) { tr.remove(); });
      fcTbodyEl.querySelectorAll('.fc-flag-badge').forEach(function (b) { b.remove(); });
    }

    // Pass trang trí idempotent: chỉ bổ sung phần còn thiếu nên MutationObserver
    // có refire cũng tự dừng (không mutate gì thêm ở pass thứ hai).
    function qDecorate() {
      fcTbodyEl.querySelectorAll('tr').forEach(function (tr) {
        qAddActionCell(tr);
        qAddBadge(tr);
      });
      qInjectExtendedRows();
    }
    var qDecoPending = false;
    function qDecorateSoon() {
      if (qDecoPending) return;
      qDecoPending = true;
      setTimeout(function () { qDecoPending = false; qDecorate(); }, 0);
    }
    qDecorate();
    new MutationObserver(qDecorateSoon).observe(fcTbodyEl, { childList: true });
    var fcMonthSel = $('fcFilterMonth');
    if (fcMonthSel) fcMonthSel.addEventListener('change', qDecorateSoon);

    /* =========================================================
       C. ĐIỀU CHỈNH 2 CARD CR (tử số / mẫu số)
       ---------------------------------------------------------
       app.js gom tử/mẫu theo d.crMonth (fcRenderKpis). Ở đây tính lại theo
       quy tắc Gia hạn & Dừng rồi GHI ĐÈ nếu khác — guard bằng so sánh chuỗi
       nên không lặp vô hạn với MutationObserver.
       ========================================================= */
    function qCrCompute(cur) {
      var phai = 0, dat = 0, touched = false;
      qList.forEach(function (d) {
        if (d.stopped || d.glExtend) touched = true;
        if (d.stopped) return;
        var effM = d.glExtend ? qMNorm(d.glExtend) : d.crMonth;
        if (effM !== cur) return;
        phai += d.dtPhai || 0;
        // tử số: deal đã có go-live (ưu tiên giá trị đang gõ trong ô input nếu hàng hiển thị)
        var gl = d.glActual;
        var row = document.getElementById('fc-row-' + d.id);
        if (row && !row.classList.contains('fc-injected')) {
          var inp = row.querySelector('[data-f="goLive"]');
          if (inp) gl = inp.value ? new Date(inp.value) : null;
        }
        if (gl) dat += d.dtPhai || 0;
      });
      return { phai: phai, dat: dat, touched: touched };
    }
    function qCrAdjust() {
      if (!qList) return;
      var numEl = $('fcCrNum'), denEl = $('fcCrDen'), denSub = $('fcCrDenSub'), numSub = $('fcCrNumSub');
      if (!numEl || !denEl) return;
      var sel = $('fcFilterMonth');
      var cur = (sel && sel.value) || qMNorm(new Date());
      var r = qCrCompute(cur);
      if (!r.touched) return; // không có deal gia hạn/dừng nào → giữ nguyên số của app.js
      var wantNum = qFmtMoney(r.dat), wantDen = qFmtMoney(r.phai);
      var crPct = (r.phai > 0) ? Math.round(r.dat / r.phai * 1000) / 10 : null;
      var wantSub = 'CR = ' + (crPct == null ? '—' : String(crPct).replace('.', ',') + '%') + ' · đã trừ deal Gia hạn/Dừng';
      if (numEl.textContent !== wantNum) numEl.textContent = wantNum;
      if (denEl.textContent !== wantDen) denEl.textContent = wantDen;
      if (denSub && denSub.textContent !== wantSub) denSub.textContent = wantSub;
      if (numSub && numSub.textContent.indexOf('đã điều chỉnh') === -1) numSub.textContent += ' · đã điều chỉnh';
    }
    var qCrPending = false;
    function qCrAdjustSoon() {
      if (qCrPending) return;
      qCrPending = true;
      setTimeout(function () { qCrPending = false; qCrAdjust(); }, 0);
    }
    var crCard = $('fcCrNum');
    if (crCard && crCard.parentElement) {
      new MutationObserver(qCrAdjustSoon).observe(crCard.parentElement.parentElement || crCard.parentElement,
        { childList: true, characterData: true, subtree: true });
    }
    if (fcMonthSel) fcMonthSel.addEventListener('change', qCrAdjustSoon);
    fcTbodyEl.addEventListener('change', qCrAdjustSoon);

    /* =========================================================
       D. MÀN REQUEST — hiện/ẩn + danh sách + bộ lọc
       ========================================================= */
    var reqBlock = $('fcRequestBlock');
    var reqFilter = 'all'; // all | extend | stop
    function qShowReqView() {
      var y1 = $('fcYear1Block'), mb = $('fcMultiBlock');
      if (y1) y1.style.display = 'none';
      if (mb) mb.style.display = 'none';
      if (reqBlock) reqBlock.style.display = '';
      document.querySelectorAll('.fc-view-btn').forEach(function (b) { b.classList.remove('active'); });
      document.querySelectorAll('.fc-req-btn').forEach(function (b) { b.classList.add('active'); });
      qRenderReqList();
    }
    function qHideReqView() {
      if (reqBlock) reqBlock.style.display = 'none';
      document.querySelectorAll('.fc-req-btn').forEach(function (b) { b.classList.remove('active'); });
    }
    document.querySelectorAll('.fc-req-btn').forEach(function (b) { b.addEventListener('click', qShowReqView); });
    // Bấm lại Năm 1 / Năm 2++ (app.js tự hiện block của nó) → chỉ cần ẩn màn Request
    document.querySelectorAll('.fc-view-btn').forEach(function (b) { b.addEventListener('click', qHideReqView); });
    window.addEventListener('hashchange', qHideReqView);

    var reqCreateBtn = $('reqCreateBtn');
    if (reqCreateBtn) reqCreateBtn.addEventListener('click', qOpenCreateModal);

    function qRenderReqList() {
      var listEl = $('reqList'), chipsEl = $('reqChips'), emptyEl = $('reqEmpty'), countEl = $('reqCount');
      if (!listEl || !chipsEl) return;
      var all = (qList || []).filter(function (d) { return d.stopped || d.glExtend; });
      var ext = all.filter(function (d) { return !d.stopped && d.glExtend; });
      var stp = all.filter(function (d) { return d.stopped; });
      chipsEl.innerHTML =
        '<button type="button" class="chip-btn' + (reqFilter === 'all' ? ' active' : '') + '" data-rf="all">Tất cả · ' + all.length + '</button>' +
        '<button type="button" class="chip-btn' + (reqFilter === 'extend' ? ' active' : '') + '" data-rf="extend">Gia hạn · ' + ext.length + '</button>' +
        '<button type="button" class="chip-btn' + (reqFilter === 'stop' ? ' active' : '') + '" data-rf="stop">Dừng triển khai · ' + stp.length + '</button>';
      chipsEl.querySelectorAll('[data-rf]').forEach(function (b) {
        b.addEventListener('click', function () { reqFilter = b.getAttribute('data-rf'); qRenderReqList(); });
      });
      var shown = (reqFilter === 'extend') ? ext : (reqFilter === 'stop') ? stp : all;
      if (countEl) countEl.textContent = shown.length + ' đề xuất';
      if (emptyEl) emptyEl.style.display = shown.length ? 'none' : 'block';
      listEl.innerHTML = shown.map(function (d) {
        var isStop = d.stopped;
        var meta = [];
        if (!isStop && d.glExtend) meta.push('Go-live gia hạn: <b>' + qEsc(qFmtDate(d.glExtend)) + '</b>');
        if (d.reqLink) meta.push('<a href="' + qEsc(d.reqLink) + '" target="_blank" rel="noopener noreferrer">Link request ↗</a>');
        return '<div class="req-item" data-deal="' + qEsc(d.id) + '" data-type="' + (isStop ? 'stop' : 'extend') + '">' +
          '<div class="req-item-info">' +
            '<div class="req-item-name">' + qEsc(d.company) + ' <span class="fc-flag-badge ' + (isStop ? 'fb-stop' : 'fb-extend') + '" style="cursor:default">' + (isStop ? 'Dừng triển khai' : 'Gia hạn') + '</span></div>' +
            '<div class="req-item-sub">' + qEsc(qSub(d)) + '</div>' +
          '</div>' +
          '<div class="req-item-meta">' + meta.join(' · ') + '</div>' +
          '<div class="req-item-actions">' +
            '<button type="button" class="req-mini-btn req-edit" title="Sửa đề xuất">' + PEN_SVG + '</button>' +
            '<button type="button" class="req-mini-btn req-del" title="Xoá đề xuất">' + TRASH_SVG + '</button>' +
          '</div>' +
        '</div>';
      }).join('');
      listEl.querySelectorAll('.req-item').forEach(function (item) {
        var d = qById[item.getAttribute('data-deal')];
        var type = item.getAttribute('data-type');
        if (!d) return;
        item.querySelector('.req-edit').addEventListener('click', function () { qOpenDealModal(type, d, true); });
        item.querySelector('.req-del').addEventListener('click', function () {
          qMiniConfirm('Xoá đề xuất?',
            'Xoá đề xuất <b>' + (type === 'stop' ? 'Dừng triển khai' : 'Gia hạn') + '</b> của <b>' + qEsc(d.company) + '</b>?<br>Dữ liệu tương ứng trên sheet Database cũng sẽ được xoá.',
            'Xoá đề xuất', 'req-btn-danger',
            function () { qSubmit({ dealId: d.id, reqType: type, glExtend: '', requestLink: '', remove: true }); });
        });
      });
    }
  })();

  /* -------------------------------------------------------
     CHANGELOG — chèn thêm 1 entry mới vào #changelogBody mà
     KHÔNG đụng app.js. renderChangelog() trong app.js ghi đè
     toàn bộ innerHTML mỗi lần bấm nút Changelog, nên dùng
     MutationObserver để tự chèn lại entry này lên đầu mỗi lần
     app.js vừa render xong (idempotent, không lặp vô hạn: khi
     tự chèn xong đã có marker data-extra-cl nên lần observer
     gọi lại sẽ tự bỏ qua).
     ------------------------------------------------------- */
  (function () {
    var clBody = $('changelogBody');
    if (!clBody) return;

    function clEsc(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    }

    // Thêm entry mới lên ĐẦU mảng này mỗi lần cập nhật tool
    // (tương tự cách app.js quản lý mảng CHANGELOG của nó).
    var EXTRA_CHANGELOG = [
      {
        date: '08/08/2026',
        title: 'Gia hạn & Dừng triển khai deal',
        body:
          '<h5>Gia hạn triển khai (Go-live Extension)</h5>' +
          '<ul>' +
            '<li>Popup xử lý gia hạn ngay trên từng deal, không cần sửa tay dữ liệu.</li>' +
            '<li>Tự động validate ngày gia hạn tối đa = ngày nhận deal + 200% TTGL, tránh nhập sai mốc thời gian.</li>' +
            '<li>Deal đã gia hạn được gắn nhãn riêng trên bảng deal để dễ nhận diện.</li>' +
            '<li>Số liệu forecast tự động điều chỉnh theo đúng tháng gia hạn, khớp với thực tế.</li>' +
            '<li>Tử số/mẫu số CR được điều chỉnh tự động theo gia hạn, không lệch số như trước.</li>' +
          '</ul>' +
          '<h5>Dừng triển khai (Stop Deployment)</h5>' +
          '<ul>' +
            '<li>Popup dừng triển khai cho từng deal, có bước double-confirm để tránh bấm nhầm.</li>' +
            '<li>Deal đã dừng được gắn nhãn cảnh báo riêng trên bảng deal.</li>' +
            '<li>Toàn bộ tính toán liên quan tự động ngưng cập nhật cho deal đã dừng.</li>' +
            '<li>Deal dừng triển khai được loại khỏi cách tính CR cho đúng bản chất (không tính vào các mốc go-live nữa).</li>' +
          '</ul>' +
          '<h5>Màn hình quản lý Request</h5>' +
          '<ul>' +
            '<li>Màn hình riêng để xem toàn bộ request gia hạn/dừng triển khai đã tạo.</li>' +
            '<li>Tạo mới, chỉnh sửa, xóa và lọc request ngay trên màn hình này — không cần vào từng deal để thao tác lại.</li>' +
          '</ul>',
      },
    ];

    function clInjectExtra() {
      if (clBody.querySelector('[data-extra-cl]')) return;
      var html = EXTRA_CHANGELOG.map(function (rel) {
        return '<div class="cl-entry" data-extra-cl="1">' +
          '<div class="cl-date">' + clEsc(rel.date) + '</div>' +
          '<div class="cl-title">' + clEsc(rel.title) + '</div>' +
          '<div class="cl-body">' + rel.body + '</div>' +
          '</div>';
      }).join('');
      clBody.insertAdjacentHTML('afterbegin', html);
    }

    new MutationObserver(clInjectExtra).observe(clBody, { childList: true });
    clInjectExtra();
  })();
})();

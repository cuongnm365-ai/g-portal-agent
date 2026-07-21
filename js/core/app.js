/**
 * app.js - Khởi tạo ứng dụng: Theme, Router (chuyển trang), Login Gate, Sidebar
 *
 * CẬP NHẬT MỚI NHẤT — FIX LỖI "KHÔNG GIỮ ĐƯỢC ĐĂNG NHẬP":
 * - NGUYÊN NHÂN GỐC: trước đây, ngay khi trang tải xong (DOMContentLoaded),
 *   app.js kiểm tra access token trong localStorage — nếu đã hết hạn (access
 *   token của Google Identity Services chỉ sống khoảng 1 giờ) thì XOÁ NGAY
 *   khỏi localStorage. Vấn đề là việc xoá này xảy ra RẤT SỚM, trước khi thư
 *   viện Google (gapi/gis) kịp tải xong. Khi googleSync.js chạy tới đoạn thử
 *   "khôi phục phiên ngầm" (silent SSO, không cần nhập lại mật khẩu), nó kiểm
 *   tra lại localStorage thì token đã bị app.js xoá mất từ trước — nên điều
 *   kiện kiểm tra "có token cũ để thử khôi phục" luôn sai, và việc khôi phục
 *   ngầm KHÔNG BAO GIỜ được thực thi. Kết quả: mỗi khi access token hết hạn
 *   (rất thường xuyên vì chỉ sống 1 giờ), người dùng bị đá thẳng về màn hình
 *   đăng nhập dù họ vẫn còn phiên đăng nhập Google hợp lệ trên trình duyệt đó.
 * - CÁCH SỬA: app.js giờ KHÔNG tự xoá token nữa — việc dọn dẹp token hết hạn
 *   được chuyển hẳn sang cho googleSync.js đảm nhiệm, SAU KHI đã thử khôi
 *   phục ngầm mà thất bại thật sự. app.js chỉ còn nhiệm vụ quyết định hiển
 *   thị gì lúc khởi động:
 *     1) Token còn hạn -> vào thẳng ứng dụng.
 *     2) Token hết hạn/không có NHƯNG trình duyệt này từng đăng nhập thành
 *        công trước đó (có "dấu vết phiên" gportal_session_marker) -> hiện
 *        màn hình đăng nhập kèm dòng chữ "Đang khôi phục phiên đăng nhập...",
 *        rồi để googleSync.js thử mượn lại phiên SSO của Google.
 *     3) Chưa từng đăng nhập trên trình duyệt này -> màn hình đăng nhập bình
 *        thường, không có thông báo gì thêm.
 * - "Dấu vết phiên" (gportal_session_marker) là điểm mới quan trọng: nó KHÔNG
 *   có hạn sử dụng như access token, chỉ bị xoá khi người dùng bấm Đăng xuất.
 *   Đây là "trí nhớ" cho googleSync.js biết trình duyệt/máy này đã từng được
 *   người dùng cho phép đăng nhập, nên có thể tự tin thử khôi phục ngầm mỗi
 *   lần mở lại trang, thay vì phải đợi người dùng bấm nút "Đăng nhập với
 *   Google" theo cách thủ công.
 * - Bổ sung chức năng GHIM (pin) thanh điều hướng bên trái: người dùng bấm nút
 *   ghim ở góc trên sidebar để chọn "luôn mở rộng" thay vì mặc định tự thu gọn
 *   và chỉ mở khi rê chuột vào. Trạng thái ghim được lưu ở localStorage
 *   ('gportal_sidebar_pinned') nên vẫn giữ nguyên lựa chọn ở lần truy cập sau.
 * - Bổ sung nút mở menu (hamburger) + lớp phủ (overlay) cho di động: trước đây
 *   sidebar chỉ mở khi hover, mà điện thoại/máy tính bảng không có sự kiện
 *   hover nên sidebar không thể mở được trên các thiết bị cảm ứng. Giờ có nút
 *   hamburger ở góc trái Header (chỉ hiển thị khi màn hình hẹp) để mở/đóng
 *   sidebar dạng drawer tạm thời (không ghi nhớ, khác với trạng thái Ghim).
 * - Bổ sung view "email" (module Soạn Email) vào VIEW_META.
 */

const AppState = { currentView: 'dashboard', theme: 'dark', isLoggedIn: false, userProfile: null };
window.AppState = AppState;

// "Dấu vết phiên đăng nhập" — sống độc lập với access token (không có hạn),
// chỉ bị xoá khi người dùng chủ động Đăng xuất (xem handleSignoutClick trong
// googleSync.js). googleSync.js sẽ đọc lại đúng key này để quyết định có nên
// thử khôi phục phiên ngầm (silent SSO) hay không.
const SESSION_MARKER_KEY = 'gportal_session_marker';
window.GPORTAL_SESSION_MARKER_KEY = SESSION_MARKER_KEY;

const VIEW_META = {
    dashboard: { title: 'Dashboard', subtitle: 'Tổng quan năng suất & KPI cá nhân' },
    schedule: { title: 'Lịch Làm Việc', subtitle: 'Quản lý ca làm việc, đổi ca, trực hộ, tăng cường' },
    productivity: { title: 'Năng Suất', subtitle: 'Nhập và theo dõi năng suất cuộc gọi hàng ngày' },
    email: { title: 'Soạn Email', subtitle: 'Khởi tạo nhanh nội dung email gửi khách hàng theo mẫu chuẩn' },
    settings: { title: 'Cài Đặt', subtitle: 'Thiết lập ca làm việc, nhân sự, PCCV, tham số KPI & mẫu Email' }
};

const SIDEBAR_PIN_KEY = 'gportal_sidebar_pinned';
const MOBILE_BREAKPOINT = 768;

document.addEventListener('DOMContentLoaded', () => {
    try { initTheme(); } catch (e) { console.error('initTheme error:', e); }
    try { initThemeToggle(); } catch (e) { console.error('initThemeToggle error:', e); }
    try { initSidebarPin(); } catch (e) { console.error('initSidebarPin error:', e); }
    try { initMobileSidebarToggle(); } catch (e) { console.error('initMobileSidebarToggle error:', e); }
    try { initRouter(); } catch (e) { console.error('initRouter error:', e); }
    try { initLogoutButton(); } catch (e) { console.error('initLogoutButton error:', e); }

    const initialView = (window.location.hash || '').replace('#', '');
    if (initialView && VIEW_META[initialView]) {
        window.switchView(initialView);
    }

    // ---- QUYẾT ĐỊNH TRẠNG THÁI HIỂN THỊ BAN ĐẦU (không tự xoá token ở đây) ----
    const savedToken = localStorage.getItem('gapi_token');
    const tokenExpiry = parseInt(localStorage.getItem('gapi_token_expiry') || '0', 10);
    const hasSessionMarker = localStorage.getItem(SESSION_MARKER_KEY) === '1';

    if (savedToken && Date.now() < tokenExpiry) {
        // Token còn hạn -> vào thẳng ứng dụng ngay, không cần chờ đợi gì thêm.
        AppState.isLoggedIn = true;
        window.showApp();
    } else if (hasSessionMarker) {
        // Access token có thể đã hết hạn hoặc chưa kịp nạp lại (đóng tab lâu),
        // nhưng trình duyệt này TỪNG đăng nhập thành công trước đó -> hiển thị
        // màn hình đăng nhập kèm trạng thái "đang khôi phục", để googleSync.js
        // thử mượn lại phiên SSO của Google ngay khi thư viện Google sẵn sàng
        // (xem attemptSilentSessionRestore() trong googleSync.js).
        window.showLogin('Đang khôi phục phiên đăng nhập trước đó...');
    } else {
        // Chưa từng đăng nhập trên trình duyệt/máy này -> màn hình đăng nhập
        // bình thường, không có thông báo gì thêm.
        window.showLogin('');
    }
});

function initTheme() {
    const savedTheme = localStorage.getItem('portal-theme') || 'dark';
    setTheme(savedTheme);
}

function setTheme(theme) {
    AppState.theme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('portal-theme', theme);
    updateThemeIcon(theme);
}

function updateThemeIcon(theme) {
    const btn = document.getElementById('theme-toggle');
    if (!btn) return;
    const icon = btn.querySelector('i');
    if (icon) icon.className = theme === 'dark' ? 'bx bx-moon' : 'bx bx-sun';
}

function initThemeToggle() {
    const btn = document.getElementById('theme-toggle');
    if (!btn) return;
    btn.addEventListener('click', () => {
        const next = AppState.theme === 'dark' ? 'light' : 'dark';
        setTheme(next);
    });
}

/**
 * GHIM (PIN) SIDEBAR — người dùng tự do chọn luôn mở rộng hay tự ẩn/hiện khi rê chuột.
 * Trạng thái được ghi nhớ qua localStorage, áp dụng lại ngay khi tải trang.
 */
function initSidebarPin() {
    const sidebar = document.getElementById('sidebar');
    const pinBtn = document.getElementById('sidebar-pin-btn');
    if (!sidebar || !pinBtn) return;

    const applyPinnedState = (isPinned) => {
        sidebar.classList.toggle('pinned', isPinned);
        pinBtn.title = isPinned ? 'Bỏ ghim (tự ẩn/hiện khi rê chuột)' : 'Ghim thanh điều hướng luôn mở rộng';
        pinBtn.setAttribute('aria-pressed', isPinned ? 'true' : 'false');
    };

    applyPinnedState(localStorage.getItem(SIDEBAR_PIN_KEY) === '1');

    pinBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const nextPinned = !sidebar.classList.contains('pinned');
        applyPinnedState(nextPinned);
        localStorage.setItem(SIDEBAR_PIN_KEY, nextPinned ? '1' : '0');
    });
}

/**
 * MỞ/ĐÓNG SIDEBAR TRÊN DI ĐỘNG (drawer tạm thời, không ghi nhớ, khác trạng thái Ghim).
 */
function initMobileSidebarToggle() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    const toggleBtn = document.getElementById('mobile-sidebar-toggle');
    if (!sidebar || !overlay || !toggleBtn) return;

    const openMobileSidebar = () => {
        sidebar.classList.add('mobile-open');
        overlay.classList.add('is-visible');
    };
    const closeMobileSidebar = () => {
        sidebar.classList.remove('mobile-open');
        overlay.classList.remove('is-visible');
    };

    toggleBtn.addEventListener('click', () => {
        if (sidebar.classList.contains('mobile-open')) closeMobileSidebar();
        else openMobileSidebar();
    });
    overlay.addEventListener('click', closeMobileSidebar);

    // Chọn xong 1 mục menu trên di động thì tự đóng lại cho đỡ vướng.
    document.querySelectorAll('.sidebar .menu-item').forEach(item => {
        item.addEventListener('click', () => {
            if (window.innerWidth < MOBILE_BREAKPOINT) closeMobileSidebar();
        });
    });

    // Chuyển từ mobile sang desktop thì tự đóng trạng thái drawer tạm thời.
    window.addEventListener('resize', () => {
        if (window.innerWidth >= MOBILE_BREAKPOINT) closeMobileSidebar();
    });
}

function initLogoutButton() {
    const btn = document.getElementById('btn-google-auth');
    if (!btn) return;
    btn.addEventListener('click', () => {
        if (typeof window.handleSignoutClick === 'function') {
            window.handleSignoutClick();
        }
    });
}

function initRouter() {
    const menuItems = document.querySelectorAll('.menu-item');
    menuItems.forEach(item => {
        item.addEventListener('click', handleMenuClick);
    });

    document.addEventListener('click', (e) => {
        const item = e.target.closest ? e.target.closest('.menu-item') : null;
        if (item) handleMenuClick(e);
    });
}

function handleMenuClick(e) {
    e.preventDefault();
    if (e.stopPropagation) e.stopPropagation();
    const item = e.currentTarget && e.currentTarget.classList && e.currentTarget.classList.contains('menu-item')
        ? e.currentTarget
        : (e.target.closest ? e.target.closest('.menu-item') : null);
    const view = item ? item.getAttribute('data-target') : '';
    if (view) window.switchView(view);
}

window.switchView = function (viewName) {
    AppState.currentView = viewName;
    window.location.hash = viewName;

    document.querySelectorAll('.app-view').forEach(view => {
        view.classList.remove('active');
    });
    const targetView = document.getElementById(`view-${viewName}`);
    if (targetView) targetView.classList.add('active');

    document.querySelectorAll('.menu-item').forEach(item => {
        item.classList.toggle('active', item.getAttribute('data-target') === viewName);
    });

    const meta = VIEW_META[viewName];
    if (meta) {
        const titleEl = document.getElementById('current-page-title');
        const subtitleEl = document.getElementById('current-page-subtitle');
        if (titleEl) titleEl.innerText = meta.title;
        if (subtitleEl) subtitleEl.innerText = meta.subtitle;
    }

    if (viewName === 'schedule' && typeof window.renderCalendar === 'function') window.renderCalendar();
    if (viewName === 'settings' && typeof renderSettingsUI === 'function') renderSettingsUI();
    if (viewName === 'productivity' && typeof loadProductivityForDate === 'function') loadProductivityForDate();
    if (viewName === 'dashboard' && typeof window.updateDashboard === 'function') window.updateDashboard();
    if (viewName === 'email' && typeof window.refreshEmailStatsIfActive === 'function') window.refreshEmailStatsIfActive();
};

window.showApp = function () {
    const login = document.getElementById('login-screen');
    const shell = document.getElementById('app-shell');
    if (login) login.style.display = 'none';
    if (shell) shell.style.display = 'block';
    const view = (window.location.hash || '').replace('#', '') || AppState.currentView || 'dashboard';
    if (VIEW_META[view]) window.switchView(view);
};

window.showLogin = function (message) {
    const login = document.getElementById('login-screen');
    const shell = document.getElementById('app-shell');
    if (shell) shell.style.display = 'none';
    if (login) login.style.display = 'flex';
    const status = document.getElementById('login-status');
    if (status && message !== undefined) status.innerText = message;
};

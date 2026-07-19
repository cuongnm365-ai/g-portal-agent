/**
 * app.js - Khởi tạo ứng dụng: Theme, Router (chuyển trang), Login Gate, Sidebar
 *
 * CẬP NHẬT MỚI NHẤT:
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

    // Cờ AppState.isLoggedIn được set NGAY (đồng bộ) nếu còn token hợp lệ trong localStorage,
    // không đợi googleSync.js chạy xong (chi tiết xem googleSync.js).
    const savedToken = localStorage.getItem('gapi_token');
    const tokenExpiry = parseInt(localStorage.getItem('gapi_token_expiry') || '0', 10);
    if (savedToken && Date.now() < tokenExpiry) {
        AppState.isLoggedIn = true;
        window.showApp();
    } else {
        if (savedToken) {
            localStorage.removeItem('gapi_token');
            localStorage.removeItem('gapi_token_expiry');
        }
        window.showLogin(savedToken ? 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.' : '');
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
    if (status && message) status.innerText = message;
};

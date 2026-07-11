/**
 * app.js - Khởi tạo ứng dụng: Theme, Router (chuyển trang), Login Gate
 * (Đã kiểm tra: file này không có lỗi cú pháp, giữ nguyên logic gốc.)
 */

const AppState = { currentView: 'dashboard', theme: 'dark', isLoggedIn: false };
window.AppState = AppState;

const VIEW_META = {
    dashboard: { title: 'Dashboard', subtitle: 'Tổng quan năng suất & KPI cá nhân' },
    schedule: { title: 'Lịch Làm Việc', subtitle: 'Quản lý ca làm việc, đổi ca, trực hộ, tăng cường' },
    productivity: { title: 'Năng Suất', subtitle: 'Nhập và theo dõi năng suất cuộc gọi hàng ngày' },
    settings: { title: 'Cài Đặt', subtitle: 'Thiết lập ca làm việc, nhân sự, PCCV, tham số KPI' }
};

document.addEventListener('DOMContentLoaded', () => {
    try { initTheme(); } catch (e) { console.error('initTheme error:', e); }
    try { initThemeToggle(); } catch (e) { console.error('initThemeToggle error:', e); }
    try { initRouter(); } catch (e) { console.error('initRouter error:', e); }
    try { initLogoutButton(); } catch (e) { console.error('initLogoutButton error:', e); }

    const initialView = (window.location.hash || '').replace('#', '');
    if (initialView && VIEW_META[initialView]) {
        window.switchView(initialView);
    }

    // FIX: trước đây chỉ gọi showApp() mà KHÔNG set AppState.isLoggedIn = true.
    // Cờ này chỉ được set bên trong googleSync.js (chạy bất đồng bộ, chờ gapi/gis tải
    // xong) -> có 1 khoảng thời gian giao diện trông như đã đăng nhập nhưng
    // AppState.isLoggedIn vẫn là false -> mọi thao tác cần đăng nhập (Đồng bộ Google,
    // lưu Drive...) đều bị chặn với thông báo "Vui lòng đăng nhập Google trước!".
    // Đồng thời kiểm tra hạn token (access token của Google thường hết hạn sau ~1 giờ),
    // nếu hết hạn thì xoá và bắt đăng nhập lại thay vì để app "treo" ở trạng thái
    // tưởng như đã đăng nhập nhưng gọi API nào cũng lỗi 401.
    const savedToken = localStorage.getItem('gapi_token');
    const tokenExpiry = parseInt(localStorage.getItem('gapi_token_expiry') || '0', 10);
    if (savedToken && Date.now() < tokenExpiry) {
        AppState.isLoggedIn = true; // set NGAY, không đợi googleSync.js
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

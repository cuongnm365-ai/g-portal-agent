/**
 * app.js - Khởi tạo ứng dụng: Theme, Router (chuyển trang), Login Gate
 *
 * BẢN SỬA LỖI (so với bản cũ):
 * -------------------------------------------------------------------------
 * 1) LỖI CHÍNH khiến "toàn bộ chức năng không dùng được": các thẻ menu
 *    trong index.html dùng thuộc tính data-target (vd: data-target="schedule"),
 *    nhưng code cũ lại đọc getAttribute('data-view') -> luôn null ->
 *    switchView() không bao giờ được gọi -> bấm menu bên trái không chuyển
 *    trang được, người dùng bị kẹt mãi ở Dashboard sau khi đăng nhập.
 *    Đã sửa: đọc đúng thuộc tính "data-target".
 *
 * 2) Nút "Giao diện" (id=theme-toggle) trước đây KHÔNG được gắn sự kiện
 *    click nào trong toàn bộ mã nguồn -> bấm không có phản ứng. Đã bổ sung
 *    initThemeToggle().
 *
 * 3) Nút "Đăng xuất" (id=btn-google-auth) trước đây cũng KHÔNG được gắn sự
 *    kiện click nào -> hàm handleSignoutClick() (định nghĩa ở googleSync.js)
 *    tồn tại nhưng không bao giờ được gọi. Đã bổ sung initLogoutButton().
 *
 * Ngoài ra bổ sung: cập nhật class "active" cho menu đang chọn, cập nhật
 * tiêu đề/mô tả trang theo từng view, và khôi phục đúng view theo hash URL
 * khi tải lại trang (F5).
 * -------------------------------------------------------------------------
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

    // Nếu URL đang có hash hợp lệ (vd F5 khi đang ở #schedule) thì mở đúng view đó
    const initialView = (window.location.hash || '').replace('#', '');
    if (initialView && VIEW_META[initialView]) {
        window.switchView(initialView);
    }

    // Tự động khôi phục giao diện nếu đã có token trong localStorage (Sửa lỗi F5)
    const savedToken = localStorage.getItem('gapi_token');
    if (savedToken) {
        window.showApp();
    } else {
        window.showLogin();
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

// FIX: gắn sự kiện click cho nút chuyển Sáng/Tối (trước đây bị thiếu hoàn toàn)
function initThemeToggle() {
    const btn = document.getElementById('theme-toggle');
    if (!btn) return;
    btn.addEventListener('click', () => {
        const next = AppState.theme === 'dark' ? 'light' : 'dark';
        setTheme(next);
    });
}

// FIX: gắn sự kiện click cho nút Đăng xuất (trước đây bị thiếu hoàn toàn)
function initLogoutButton() {
    const btn = document.getElementById('btn-google-auth');
    if (!btn) return;
    btn.addEventListener('click', () => {
        if (typeof window.handleSignoutClick === 'function') {
            window.handleSignoutClick();
        }
    });
}

// FIX: đổi "data-view" -> "data-target" cho khớp với thuộc tính thật sự có trong index.html
function initRouter() {
    const menuItems = document.querySelectorAll('.menu-item');
    menuItems.forEach(item => {
        item.addEventListener('click', handleMenuClick);
    });

    // Dự phòng: nếu listener trực tiếp bị mất do render lại DOM, vẫn bắt click menu ở cấp document.
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

    // Cập nhật trạng thái "đang chọn" trên menu bên trái
    document.querySelectorAll('.menu-item').forEach(item => {
        item.classList.toggle('active', item.getAttribute('data-target') === viewName);
    });

    // Cập nhật tiêu đề + mô tả trang theo view hiện tại
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
}

// ===================== LOGIN GATE =====================
// Được gọi từ googleSync.js khi đăng nhập thành công (kể cả khôi phục phiên sau F5)
window.showApp = function () {
    const login = document.getElementById('login-screen');
    const shell = document.getElementById('app-shell');
    if (login) login.style.display = 'none';
    if (shell) shell.style.display = 'block';
    const view = (window.location.hash || '').replace('#', '') || AppState.currentView || 'dashboard';
    if (VIEW_META[view]) window.switchView(view);
};

// Được gọi từ googleSync.js khi chưa đăng nhập / đăng xuất / phiên hết hạn
window.showLogin = function (message) {
    const login = document.getElementById('login-screen');
    const shell = document.getElementById('app-shell');
    if (shell) shell.style.display = 'none';
    if (login) login.style.display = 'flex';
    const status = document.getElementById('login-status');
    if (status && message) status.innerText = message;
};

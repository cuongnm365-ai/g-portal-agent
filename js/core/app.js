const AppState = {
    currentView: 'dashboard',
    theme: 'dark',
    isLoggedIn: false
};

document.addEventListener('DOMContentLoaded', () => {
    try { initTheme(); } catch (e) { console.error('initTheme error:', e); }
    try { initRouter(); } catch (e) { console.error('initRouter error:', e); }
});

function initTheme() {
    const savedTheme = localStorage.getItem('portal-theme') || 'dark';
    setTheme(savedTheme);

    document.getElementById('theme-toggle').addEventListener('click', () => {
        const nextTheme = AppState.theme === 'dark' ? 'light' : 'dark';
        setTheme(nextTheme);
        // Vẽ lại biểu đồ theo màu theme mới nếu đang mở tab Dashboard
        if (AppState.currentView === 'dashboard' && typeof window.updateDashboard === 'function') {
            setTimeout(window.updateDashboard, 100);
        }
    });
}

function setTheme(theme) {
    AppState.theme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('portal-theme', theme);

    const themeIcon = document.querySelector('#theme-toggle i');
    if (themeIcon) {
        themeIcon.className = theme === 'dark' ? 'bx bx-sun' : 'bx bx-moon';
    }
}

function initRouter() {
    const menuItems = document.querySelectorAll('.menu-item');

    menuItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const targetView = item.getAttribute('data-target');
            switchView(targetView);
        });
    });

    const currentHash = window.location.hash.replace('#', '');
    if (['dashboard', 'schedule', 'productivity', 'settings'].includes(currentHash)) {
        switchView(currentHash);
    } else {
        switchView('dashboard'); // Mặc định vào Dashboard
    }
}

function switchView(viewName) {
    AppState.currentView = viewName;
    window.location.hash = viewName;

    document.querySelectorAll('.app-view').forEach(view => {
        view.classList.remove('active');
    });
    const targetSection = document.getElementById(`view-${viewName}`);
    if (targetSection) targetSection.classList.add('active');

    document.querySelectorAll('.menu-item').forEach(item => {
        item.classList.remove('active');
        if (item.getAttribute('data-target') === viewName) {
            item.classList.add('active');
        }
    });

    const titleMap = {
        dashboard: 'DASHBOARD HỆ THỐNG',
        schedule: 'LỊCH LÀM VIỆC & PHÂN CÔNG',
        productivity: 'NHẬP NĂNG SUẤT ĐIỆN THOẠI',
        settings: 'CẤU HÌNH THAM SỐ'
    };
    document.getElementById('current-page-title').innerText = titleMap[viewName] || 'G-PORTAL';

    // Cập nhật lại Dashboard mỗi khi click sang tab này
    if (viewName === 'dashboard' && typeof window.updateDashboard === 'function') {
        window.updateDashboard();
    }
}

// ===================== LOGIN GATE =====================
// Được gọi từ googleSync.js khi đăng nhập thành công (kể cả khôi phục phiên sau F5)
window.showApp = function () {
    const login = document.getElementById('login-screen');
    const shell = document.getElementById('app-shell');
    if (login) login.style.display = 'none';
    if (shell) shell.style.display = 'block';
};

// Được gọi từ googleSync.js khi chưa đăng nhập / đăng xuất / phiên hết hạn
window.showLogin = function (message) {
    const login = document.getElementById('login-screen');
    const shell = document.getElementById('app-shell');
    if (shell) shell.style.display = 'none';
    if (login) login.style.display = 'flex';
    const status = document.getElementById('login-status');
    if (status) status.innerText = message || '';
};

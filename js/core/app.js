const AppState = { currentView: 'dashboard', theme: 'dark', isLoggedIn: false };

document.addEventListener('DOMContentLoaded', () => { 
    try { initTheme(); } catch (e) { console.error('initTheme error:', e); } 
    try { initRouter(); } catch (e) { console.error('initRouter error:', e); } 
    
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
} 

function initRouter() { 
    const menuItems = document.querySelectorAll('.menu-item'); 
    menuItems.forEach(item => {
        item.addEventListener('click', (e) => {
            const view = e.currentTarget.getAttribute('data-view');
            if (view) switchView(view);
        });
    });
} 

function switchView(viewName) { 
    AppState.currentView = viewName; 
    window.location.hash = viewName; 
    
    document.querySelectorAll('.app-view').forEach(view => {
        view.classList.remove('active');
    });
    const targetView = document.getElementById(`view-${viewName}`);
    if (targetView) targetView.classList.add('active');
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
    if (status && message) status.innerText = message;
};

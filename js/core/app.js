// add at top of app.js
window.showApp = function () {
    const login = document.getElementById('login-screen');
    const shell = document.getElementById('app-shell');
    if (login) login.style.display = 'none';
    if (shell) shell.style.display = 'block';
    const view = (window.location.hash || '').replace('#', '') || AppState.currentView || 'dashboard';
    if (VIEW_META[view]) window.switchView(view);

    // BẮT BUỘC: load lịch khi app hiện ra và Google đã login
    if (typeof window.loadScheduleFromDrive === 'function') {
        window.loadScheduleFromDrive().catch(err => {
            console.error('[Schedule] Không load được lịch từ Drive khi mở app:', err);
        });
    }
};

// also add after switchView and after login success
if (viewName === 'schedule' && typeof window.loadScheduleFromDrive === 'function') {
    window.loadScheduleFromDrive().catch(err => {
        console.error('[Schedule] Không load được lịch khi chuyển sang schedule:', err);
    });
}

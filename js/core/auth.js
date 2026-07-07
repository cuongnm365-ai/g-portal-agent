/**
 * auth.js - Google OAuth Authentication Handler
 * Quản lý quy trình xác thực Google OAuth2
 * Xử lý: Login, Logout, Session restoration, Token management
 */

document.addEventListener('DOMContentLoaded', () => {
    try { 
        initAuthFlow(); 
    } catch (e) { 
        console.error('initAuthFlow error:', e); 
    }
});

/**
 * Khởi tạo quy trình xác thực
 * - Kiểm tra token hiện có
 * - Gắn sự kiện cho nút Login/Logout
 */
function initAuthFlow() {
    const btnLoginGoogle = document.getElementById('btn-login-google');
    const btnGoogleAuth = document.getElementById('btn-google-auth');

    if (btnLoginGoogle) {
        btnLoginGoogle.addEventListener('click', handleLoginClick);
    }

    if (btnGoogleAuth) {
        btnGoogleAuth.addEventListener('click', handleAuthToggle);
    }

    // Kiểm tra xem có token đã lưu từ lần đăng nhập trước không
    checkExistingToken();
}

/**
 * Xử lý click nút "Đăng nhập với Google" trên màn hình Login
 */
function handleLoginClick() {
    if (!window.tokenClient) {
        console.error('tokenClient chưa được khởi tạo. Vui lòng đợi Google API tải xong.');
        return;
    }

    // Yêu cầu token với prompt='consent' để ép người dùng chọn tài khoản
    window.tokenClient.requestAccessToken({ prompt: 'consent' });
}

/**
 * Xử lý click nút "Đăng xuất" hoặc "Đã kết nối Google"
 * Nếu đã đăng nhập -> đăng xuất
 * Nếu chưa đăng nhập -> đăng nhập
 */
function handleAuthToggle() {
    if (!window.AppState.isLoggedIn) {
        // Chưa đăng nhập -> Yêu cầu đăng nhập
        if (window.tokenClient) {
            window.tokenClient.requestAccessToken({ prompt: '' });
        }
    } else {
        // Đã đăng nhập -> Đăng xuất
        revokeToken();
    }
}

/**
 * Kiểm tra xem có token cũ được lưu không
 * Nếu có -> thử restore phiên trước
 * Nếu không -> hiển thị màn hình Login
 */
async function checkExistingToken() {
    // Đợi gapi và Google API tải xong
    if (!window.gapi || !window.google) {
        console.log('Đợi Google API tải...');
        setTimeout(checkExistingToken, 100);
        return;
    }

    const token = window.gapi.client.getToken();
    if (token !== null) {
        // Có token -> Khôi phục phiên
        console.log('Token cũ được tìm thấy, đang khôi phục phiên...');
        AppState.isLoggedIn = true;
        updateAuthUI();
        
        // Load dữ liệu từ Drive
        if (typeof loadSettingsFromDrive === 'function') loadSettingsFromDrive();
        if (typeof loadScheduleFromDrive === 'function') loadScheduleFromDrive();
        if (typeof loadProductivityFromDrive === 'function') loadProductivityFromDrive();
        
        // Hiển thị app shell
        window.showApp();
    } else {
        // Không có token -> Hiển thị màn hình Login
        console.log('Không tìm thấy token. Hiển thị màn hình Login.');
        window.showLogin('Vui lòng đăng nhập để tiếp tục');
    }
}

/**
 * Hủy token (Đăng xuất)
 */
function revokeToken() {
    const token = window.gapi.client.getToken();
    if (token !== null) {
        google.accounts.oauth2.revoke(token.access_token, () => {
            console.log('Token đã bị hủy');
        });
        
        // Clear state
        gapi.client.setToken(null);
        AppState.isLoggedIn = false;
        
        // Cập nhật UI
        updateAuthUI();
        
        // Quay lại màn hình Login
        window.showLogin('Bạn đã đăng xuất');
    }
}

/**
 * Cập nhật UI dựa trên trạng thái đăng nhập
 */
function updateAuthUI() {
    const authBtn = document.getElementById('btn-google-auth');
    const authBtnText = document.getElementById('auth-btn-text');

    if (!authBtn || !authBtnText) return;

    if (AppState.isLoggedIn) {
        authBtnText.innerText = "Đã kết nối Google";
        authBtn.style.background = "#10b981";
    } else {
        authBtnText.innerText = "Đăng nhập Google";
        authBtn.style.background = "#ea4335";
    }
}

/**
 * Callback được gọi khi token response được nhận
 * (Được gắn trong googleSync.js khi khởi tạo tokenClient)
 */
window.handleTokenResponse = function(tokenResponse) {
    if (tokenResponse.error !== undefined) {
        console.error('Lỗi xác thực:', tokenResponse);
        window.showLogin('Lỗi xác thực: ' + (tokenResponse.error || 'Không xác định'));
        return;
    }

    // Thành công
    AppState.isLoggedIn = true;
    console.log('Đăng nhập thành công!');
    
    updateAuthUI();
    
    // Load dữ liệu từ Drive
    if (typeof loadSettingsFromDrive === 'function') loadSettingsFromDrive();
    if (typeof loadScheduleFromDrive === 'function') loadScheduleFromDrive();
    if (typeof loadProductivityFromDrive === 'function') loadProductivityFromDrive();
    
    // Hiển thị app shell
    window.showApp();
};

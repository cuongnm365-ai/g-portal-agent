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
    
    // Đã chuyển checkExistingToken() sang gọi từ checkAuthReady() bên googleSync.js
    // để đảm bảo Google API tải xong 100% trước khi check token.
}

/**
 * Xử lý click nút "Đăng nhập với Google"
 */
function handleLoginClick() {
    if (!window.tokenClient) {
        alert('Hệ thống Google đang được khởi tạo, vui lòng đợi thêm 1-2 giây rồi thử lại!');
        console.error('tokenClient chưa được khởi tạo. Vui lòng đợi Google API tải xong.');
        return;
    }

    // Yêu cầu token với prompt='consent' để hiện popup
    window.tokenClient.requestAccessToken({ prompt: 'consent' });
}

/**
 * Xử lý click nút "Đăng xuất" hoặc "Đã kết nối" bên trong portal
 */
function handleAuthToggle() {
    if (AppState.isLoggedIn) {
        // Thu hồi token khỏi Google
        const token = gapi.client.getToken();
        if (token !== null) {
            google.accounts.oauth2.revoke(token.access_token, () => {
                console.log('Đã thu hồi token thành công.');
            });
            gapi.client.setToken('');
        }
        
        localStorage.removeItem('gportal_access_token');
        AppState.isLoggedIn = false;
        
        updateAuthUI();
        window.showLogin('Bạn đã đăng xuất khỏi G-Portal');
    } else {
        handleLoginClick();
    }
}

/**
 * Cập nhật giao diện UI nút kết nối
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
 * Callback được gọi từ googleSync.js khi Token Response được trả về
 */
window.handleTokenResponse = function(tokenResponse) {
    if (tokenResponse.error !== undefined) {
        console.error('Lỗi xác thực:', tokenResponse);
        window.showLogin('Lỗi xác thực: ' + (tokenResponse.error || 'Không xác định'));
        return;
    }

    // Đăng nhập thành công, lưu lại token để dùng cho các phiên sau (F5)
    AppState.isLoggedIn = true;
    console.log('✓ Xác thực token Google thành công!');
    
    localStorage.setItem('gportal_access_token', JSON.stringify({
        token: tokenResponse.access_token,
        expiry: new Date().getTime() + (tokenResponse.expires_in * 1000)
    }));
    
    updateAuthUI();
    
    // Mở khóa UI ẩn màn hình login, hiện portal
    if (typeof window.showApp === 'function') window.showApp();
    
    // Tải dữ liệu từ Drive
    if (typeof window.loadSettingsFromDrive === 'function') window.loadSettingsFromDrive();
    if (typeof window.loadScheduleFromDrive === 'function') window.loadScheduleFromDrive();
    if (typeof window.loadProductivityFromDrive === 'function') window.loadProductivityFromDrive();
};

/**
 * Kiểm tra xem phiên đăng nhập cũ còn hiệu lực không (được gọi từ googleSync.js)
 */
window.checkExistingToken = function() {
    const storedTokenStr = localStorage.getItem('gportal_access_token');
    if (storedTokenStr) {
        try {
            const storedToken = JSON.parse(storedTokenStr);
            if (new Date().getTime() < storedToken.expiry) {
                // Token còn hiệu lực -> Set lại token cho GAPI Client
                gapi.client.setToken({ access_token: storedToken.token });
                AppState.isLoggedIn = true;
                
                updateAuthUI();
                if (typeof window.showApp === 'function') window.showApp();
                
                // Khôi phục dữ liệu
                if (typeof window.loadSettingsFromDrive === 'function') window.loadSettingsFromDrive();
                if (typeof window.loadScheduleFromDrive === 'function') window.loadScheduleFromDrive();
                if (typeof window.loadProductivityFromDrive === 'function') window.loadProductivityFromDrive();
                
                console.log('✓ Đã khôi phục phiên đăng nhập cũ thành công.');
            } else {
                // Token hết hạn
                localStorage.removeItem('gportal_access_token');
                if (typeof window.showLogin === 'function') window.showLogin('Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.');
            }
        } catch (e) {
            localStorage.removeItem('gportal_access_token');
        }
    }
};

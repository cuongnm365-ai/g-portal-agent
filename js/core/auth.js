/**
 * auth.js - Google OAuth Authentication Handler
 * Quản lý quy trình xác thực Google OAuth2
 * Xử lý: Login, Logout, Session restoration, Token management
 *
 * FIX QUAN TRỌNG (so với bản cũ):
 * - Access token của Google (qua initTokenClient) chỉ sống ~1 giờ và KHÔNG có
 *   refresh token (vì đây là web app tĩnh, không có server backend). Bản cũ
 *   chỉ đọc token cũ trong localStorage: nếu hết hạn hoặc chưa từng có, ứng
 *   dụng bó tay và luôn bắt người dùng bấm nút đăng nhập thủ công lại từ đầu.
 * - Bản này bổ sung attemptSilentLogin(): khi không có token hợp lệ trong
 *   localStorage, hệ thống sẽ ÂM THẦM xin cấp lại token (prompt: '') trước
 *   khi hiển thị màn hình đăng nhập. Nếu trình duyệt/tài khoản đã từng cấp
 *   quyền cho ứng dụng, Google sẽ cấp lại token mà KHÔNG hiện popup, giúp
 *   người dùng không phải đăng nhập lại mỗi lần F5.
 * - Nếu trình duyệt chặn cơ chế này (vd Safari chặn cookie bên thứ 3 nghiêm
 *   ngặt), silent renew sẽ thất bại và người dùng vẫn cần đăng nhập thủ công
 *   như bình thường - đây là giới hạn từ phía Google, không phải lỗi code.
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
 * Xử lý click nút "Đăng nhập với Google" (yêu cầu tương tác người dùng -> luôn hiện popup)
 */
function handleLoginClick() {
    if (!window.tokenClient) {
        alert('Hệ thống Google đang được khởi tạo, vui lòng đợi thêm 1-2 giây rồi thử lại!');
        console.error('tokenClient chưa được khởi tạo. Vui lòng đợi Google API tải xong.');
        return;
    }

    // Yêu cầu token với prompt='consent' để hiện popup (đăng nhập thủ công)
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
 * (được dùng chung cho cả 3 trường hợp: bấm nút đăng nhập thủ công,
 * khôi phục token cũ hợp lệ đã tự setToken thẳng không qua đây,
 * và silent renew tự động khi F5)
 */
window.handleTokenResponse = function(tokenResponse) {
    if (tokenResponse.error !== undefined) {
        // Nếu đây là lần thử silent renew tự động (không phải người dùng bấm nút)
        // thì không cần báo lỗi ồn ào, chỉ cần hiển thị màn hình đăng nhập bình thường.
        if (tokenResponse.error === 'immediate_failed' || tokenResponse.error === 'access_denied' || window.__gportalSilentAttempted) {
            console.log('Không thể tự động khôi phục phiên đăng nhập (silent renew thất bại), cần đăng nhập thủ công.');
            if (typeof window.showLogin === 'function') window.showLogin('');
            window.__gportalSilentAttempted = false;
            return;
        }
        console.error('Lỗi xác thực:', tokenResponse);
        window.showLogin('Lỗi xác thực: ' + (tokenResponse.error || 'Không xác định'));
        return;
    }

    window.__gportalSilentAttempted = false;

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
 * Kiểm tra xem phiên đăng nhập cũ còn hiệu lực không (được gọi từ googleSync.js
 * ngay khi cả gapi và Google Identity Services đã tải xong, kể cả sau F5)
 */
window.checkExistingToken = function() {
    const storedTokenStr = localStorage.getItem('gportal_access_token');
    console.log('[G-Portal Auth] checkExistingToken(): token trong localStorage =', storedTokenStr ? 'CÓ' : 'KHÔNG CÓ');

    if (storedTokenStr) {
        try {
            const storedToken = JSON.parse(storedTokenStr);
            const remainMin = Math.round((storedToken.expiry - new Date().getTime()) / 60000);
            console.log(`[G-Portal Auth] Token còn hạn khoảng ${remainMin} phút.`);
            if (new Date().getTime() < storedToken.expiry) {
                // Token còn hiệu lực -> Set lại token cho GAPI Client ngay, không cần gọi Google
                gapi.client.setToken({ access_token: storedToken.token });
                AppState.isLoggedIn = true;

                updateAuthUI();
                if (typeof window.showApp === 'function') window.showApp();

                // Khôi phục dữ liệu
                if (typeof window.loadSettingsFromDrive === 'function') window.loadSettingsFromDrive();
                if (typeof window.loadScheduleFromDrive === 'function') window.loadScheduleFromDrive();
                if (typeof window.loadProductivityFromDrive === 'function') window.loadProductivityFromDrive();

                console.log('✓ Đã khôi phục phiên đăng nhập cũ thành công (token còn hạn).');
                return;
            } else {
                // Token hết hạn trong localStorage -> xoá và thử âm thầm xin cấp lại
                localStorage.removeItem('gportal_access_token');
            }
        } catch (e) {
            localStorage.removeItem('gportal_access_token');
        }
    }

    // Không có token hợp lệ trong localStorage (hết hạn / chưa từng có / lỗi đọc)
    // -> Thử âm thầm xin cấp lại token trước khi bắt đăng nhập thủ công.
    attemptSilentLogin();
};

/**
 * Âm thầm xin Google cấp lại access token mà KHÔNG hiện popup, dựa trên phiên
 * đăng nhập Google hiện có của trình duyệt (nếu người dùng đã từng cấp quyền
 * cho ứng dụng trước đó). Nếu thành công -> handleTokenResponse xử lý y hệt
 * như đăng nhập thủ công. Nếu thất bại -> hiển thị màn hình đăng nhập bình thường.
 */
function attemptSilentLogin() {
    if (!window.tokenClient) {
        // Google Identity Services chưa sẵn sàng, hiển thị màn hình đăng nhập
        if (typeof window.showLogin === 'function') window.showLogin('');
        return;
    }

    try {
        window.__gportalSilentAttempted = true;
        console.log('[G-Portal Auth] Không có token hợp lệ trong localStorage -> thử xin cấp lại ngầm (prompt: none)...');
        // prompt: 'none' => bắt buộc không hiện UI; chỉ cấp token nếu đã có sẵn phiên/uỷ quyền.
        // Lưu ý: nếu trình duyệt chặn cookie bên thứ 3 (Safari mặc định, hoặc Chrome
        // đang loại bỏ dần), bước này có thể không bao giờ gọi lại callback -> khi đó
        // người dùng vẫn cần bấm nút đăng nhập thủ công như bình thường (giới hạn từ
        // phía chính sách bảo mật của Google/trình duyệt, không phải lỗi code).
        window.tokenClient.requestAccessToken({ prompt: 'none' });
    } catch (e) {
        console.log('Silent renew không khả dụng, cần đăng nhập thủ công.', e);
        window.__gportalSilentAttempted = false;
        if (typeof window.showLogin === 'function') window.showLogin('');
    }
};

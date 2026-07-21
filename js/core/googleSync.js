/**
 * googleSync.js - Google Auth + Drive + Calendar + Tasks
 *
 * BẢN VÁ LỖI "GIỮ ĐĂNG NHẬP" (mới nhất):
 * -------------------------------------------------------------------------
 * BỐI CẢNH: Google Identity Services (token client) dùng cho ứng dụng thuần
 * client-side (không backend) KHÔNG cấp refresh token — chỉ cấp access token
 * sống ngắn (~1 giờ). Cách duy nhất để "giữ đăng nhập" lâu dài mà không bắt
 * người dùng nhập lại mật khẩu là liên tục MƯỢN LẠI phiên SSO (cookie đăng
 * nhập Google) của chính trình duyệt đó bằng cách gọi
 * tokenClient.requestAccessToken({ prompt: '' }) — lệnh này chạy NGẦM, không
 * hiện popup, miễn là người dùng vẫn còn đăng nhập Google & đã từng đồng ý
 * cấp quyền cho ứng dụng trên trình duyệt/máy đó. Đây cũng chính là lý do
 * hành vi "cùng máy thì giữ đăng nhập, đổi máy thì phải đăng nhập lại" là
 * điều tự nhiên (vì máy khác không có cookie phiên Google đó).
 *
 * LỖI ĐÃ SỬA: trước đây cơ chế khôi phục ngầm này gần như KHÔNG BAO GIỜ được
 * kích hoạt, vì app.js xoá token hết hạn khỏi localStorage NGAY khi trang vừa
 * tải (trước khi thư viện Google kịp sẵn sàng) — khiến điều kiện kiểm tra
 * "có token cũ để thử khôi phục" ở đây luôn sai. Nay app.js không tự xoá
 * token nữa (xem app.js), và toàn bộ logic khôi phục ngầm được gom lại thành
 * hàm attemptSilentSessionRestore() bên dưới, dựa vào "dấu vết phiên đăng
 * nhập" (SESSION_MARKER_KEY) — một cờ KHÔNG có hạn sử dụng, chỉ mất khi
 * người dùng chủ động Đăng xuất — để quyết định có nên thử mượn lại phiên
 * SSO hay không, bất kể access token cũ còn tồn tại trong localStorage hay
 * không.
 *
 * BỔ SUNG: lắng nghe sự kiện visibilitychange — khi người dùng quay lại tab
 * sau một thời gian tab bị ẩn/máy ngủ (lúc đó setTimeout hẹn giờ làm mới token
 * có thể không chạy đúng giờ do trình duyệt tạm dừng tab nền), hệ thống sẽ
 * kiểm tra lại hạn token và làm mới ngay nếu cần, tránh trường hợp quay lại
 * tab mà thấy đã "rớt" đăng nhập.
 *
 * (Giữ nguyên toàn bộ các fix trước đó: polling gapi/gis, gapi.client.init
 * lỗi âm thầm, isLoggedIn set đồng bộ, logout bọc try/catch/finally, cảnh
 * báo file://, cấu hình Calendar ID từ Cài đặt, xác định sự kiện G-Portal qua
 * extendedProperties.private, lấy hồ sơ Google dùng chung toàn app, các fix
 * đồng bộ Lịch/Task/OT/đồng bộ ngược đã có từ trước...)
 * -------------------------------------------------------------------------
 */

const CLIENT_ID = '714398035986-2jdd33n4h7kguauq73jbirq6rlfpkte2.apps.googleusercontent.com';
const API_KEY = 'AIzaSyB4w3xAGA3-QiYZBIltPcetBHkKCpY0Oec';
const FOLDER_IDS = {
    settings: '1j5-DPSFeUSmeDYxbR7fW0zJdlf-P2efp',
    staffs: '1eNvquq7MhTfTDn1vwm7D7mEpORkTe5kQ',
    productivity: '19BLiBpgwKnDlbqgHtRPJFXs_jz3EMOXn',
    shifts: '1I28OyoCO6jmPyS_50EnwHvyS8opFbkl2',
    tasks: '1xOntuC0tf4F5kn8-QmzFRpTYR4Y4ebzO'
};
window.GPORTAL_FOLDERS = FOLDER_IDS;
const DISCOVERY_DOCS = [
    'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest',
    'https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest',
    'https://tasks.googleapis.com/$discovery/rest?version=v1'
];

// Scope 'openid email profile' để lấy tên/email người dùng (badge Header + module Soạn Email).
const SCOPES = 'openid email profile https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/tasks';

const TOKEN_REFRESH_MARGIN_SEC = 300; // 5 phút
const TOKEN_REFRESH_MIN_DELAY_MS = 30000; // 30 giây

// "Dấu vết phiên đăng nhập" — dùng chung key với app.js (xem app.js). Sống độc
// lập với access token, chỉ bị xoá khi người dùng chủ động Đăng xuất. Có cờ
// này thì mỗi lần mở lại trang sẽ luôn thử khôi phục ngầm (silent SSO), bất kể
// access token cũ trong localStorage còn hay đã bị dọn.
const SESSION_MARKER_KEY = window.GPORTAL_SESSION_MARKER_KEY || 'gportal_session_marker';

let tokenClient;
let gapiInited = false;
let gisInited = false;
let gapiLoadRequested = false;
let tokenRefreshTimerId = null;
let silentRestoreAttempted = false;
// true trong lúc đang chờ kết quả của một lần thử khôi phục NGẦM (prompt:'').
// Dùng để error_callback phân biệt được: thất bại này đến từ việc mượn lại
// phiên SSO tự động (nên chỉ cần âm thầm quay về màn hình đăng nhập, xoá dấu
// vết phiên) hay đến từ việc người dùng chủ động bấm nút đăng nhập (nên cần
// hiển thị thông báo lỗi chi tiết như trước).
let pendingSilentRestore = false;
const GSYNC_START_TIME = Date.now();

function setLoginStatus(text, isError) {
    const el = document.getElementById('login-status');
    if (el) {
        el.innerText = text;
        el.style.color = isError ? 'var(--danger, #ef4444)' : '';
    }
    const retryBtn = document.getElementById('btn-retry-google');
    if (retryBtn) retryBtn.style.display = isError ? 'inline-flex' : 'none';

    if (isError) console.error('[G-Portal Auth]', text);
    else console.log('[G-Portal Auth]', text);
}

function markSessionActive() {
    try { localStorage.setItem(SESSION_MARKER_KEY, '1'); } catch (e) {}
}

function clearSessionMarker() {
    try { localStorage.removeItem(SESSION_MARKER_KEY); } catch (e) {}
}

function hasSessionMarker() {
    try { return localStorage.getItem(SESSION_MARKER_KEY) === '1'; } catch (e) { return false; }
}

// ============================================================
// 0. POLLING: chờ 2 thư viện gapi + Google Identity Services sẵn sàng
// ============================================================
function waitForGoogleLibraries() {
    if (!gapiInited && window.gapi && !gapiLoadRequested) {
        gapiLoadRequested = true;
        setLoginStatus('Đang khởi tạo Google API Client...');
        gapi.load('client', {
            callback: initializeGapiClient,
            onerror: function () {
                setLoginStatus('Lỗi: không tải được "gapi client". Có thể do AdBlock/tiện ích trình duyệt chặn apis.google.com — vui lòng tắt thử rồi tải lại trang.', true);
                gapiLoadRequested = false;
            },
            timeout: 10000,
            ontimeout: function () {
                setLoginStatus('Lỗi: tải "gapi client" quá thời gian chờ (mạng chậm hoặc bị chặn).', true);
                gapiLoadRequested = false;
            }
        });
    }
    if (!gisInited && window.google && window.google.accounts && window.google.accounts.oauth2) {
        gisInited = true;
        checkAllReady();
    }

    const elapsed = Date.now() - GSYNC_START_TIME;
    if (!gapiInited || !gisInited) {
        if (elapsed > 8000 && elapsed < 8500) {
            if (!window.gapi) {
                setLoginStatus('Không thể tải thư viện "apis.google.com/js/api.js". Kiểm tra kết nối mạng, AdBlock, hoặc thử mở trang qua http(s):// thay vì mở trực tiếp file trên máy.', true);
            } else if (!window.google || !window.google.accounts) {
                setLoginStatus('Không thể tải thư viện "accounts.google.com/gsi/client". Kiểm tra kết nối mạng hoặc trình chặn quảng cáo.', true);
            } else if (!gapiInited) {
                setLoginStatus('gapi đã tải nhưng gapi.client chưa khởi tạo xong. Kiểm tra Console (F12) để xem lỗi chi tiết.', true);
            }
        }
        setTimeout(waitForGoogleLibraries, 150);
    } else {
        setLoginStatus('');
    }
}

if (window.location.protocol === 'file:') {
    setLoginStatus('Trang đang được mở trực tiếp từ file (file://) — Google không cho phép đăng nhập trong trường hợp này. Vui lòng chạy qua một máy chủ web (vd: GitHub Pages, hoặc "npx serve" / "python -m http.server" trên localhost).', true);
} else {
    waitForGoogleLibraries();
}

async function initializeGapiClient() {
    try {
        await gapi.client.init({
            apiKey: API_KEY,
            discoveryDocs: DISCOVERY_DOCS,
        });
        gapiInited = true;
        checkAllReady();
    } catch (e) {
        console.error("Lỗi khởi tạo GAPI:", e);
        setLoginStatus('Lỗi khởi tạo gapi.client.init(): ' + (e && e.message ? e.message : JSON.stringify(e)) + ' — kiểm tra API_KEY / DISCOVERY_DOCS.', true);
        gapiLoadRequested = false;
    }
}

function checkAllReady() {
    if (gapiInited && gisInited) {
        initGoogleAuth();
    }
}

// ============================================================
// 1. HỒ SƠ NGƯỜI DÙNG (tên/email/ảnh) — dùng chung cho Header + module Soạn Email
// ============================================================
function applyUserProfile(profile) {
    AppState.userProfile = profile;
    try { localStorage.setItem('gportal_user_profile', JSON.stringify(profile)); } catch (e) {}

    const box = document.getElementById('user-profile-box');
    if (box && profile) {
        box.innerHTML = `
            <div class="user-profile-badge">
                ${profile.picture ? `<img src="${profile.picture}" alt="">` : ''}
                <div class="upb-text">
                    <span class="upb-name">${profile.name || ''}</span>
                    <span class="upb-email">${profile.email || ''}</span>
                </div>
            </div>`;
    }
    window.dispatchEvent(new CustomEvent('gportal_profile_ready', { detail: profile }));
}

async function fetchUserProfile(accessToken) {
    try {
        const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { Authorization: 'Bearer ' + accessToken }
        });
        if (!res.ok) return;
        const data = await res.json();
        applyUserProfile({ name: data.name || data.email || 'Nhân viên', email: data.email || '', picture: data.picture || '' });
    } catch (e) {
        console.error('[G-Portal Auth] Lỗi lấy thông tin hồ sơ Google:', e);
    }
}

// Khôi phục hồ sơ đã cache ngay khi tải trang (không cần đợi mạng) để badge Header
// và module Soạn Email có tên hiển thị ngay lập tức, rồi vẫn làm mới ngầm bên dưới.
(function restoreCachedProfile() {
    try {
        const cached = localStorage.getItem('gportal_user_profile');
        if (cached) applyUserProfile(JSON.parse(cached));
    } catch (e) {}
})();

// ============================================================
// 2. LÀM MỚI TOKEN NGẦM (hẹn giờ trước khi hết hạn + làm mới khi quay lại tab)
// ============================================================
function scheduleTokenRefresh(expiresInSeconds) {
    if (tokenRefreshTimerId) {
        clearTimeout(tokenRefreshTimerId);
        tokenRefreshTimerId = null;
    }
    const safeExpires = Number.isFinite(expiresInSeconds) && expiresInSeconds > 0 ? expiresInSeconds : 3600;
    const delayMs = Math.max((safeExpires - TOKEN_REFRESH_MARGIN_SEC) * 1000, TOKEN_REFRESH_MIN_DELAY_MS);

    tokenRefreshTimerId = setTimeout(() => {
        if (!tokenClient) return;
        console.log('[G-Portal Auth] Đang tự động làm mới phiên đăng nhập Google (ngầm)...');
        pendingSilentRestore = true;
        tokenClient.requestAccessToken({ prompt: '' });
    }, delayMs);
}

function clearScheduledTokenRefresh() {
    if (tokenRefreshTimerId) {
        clearTimeout(tokenRefreshTimerId);
        tokenRefreshTimerId = null;
    }
}

// MỚI — khi tab bị ẩn/máy ngủ trong lúc setTimeout đang chờ, trình duyệt có
// thể "đóng băng" timer khiến nó không chạy đúng giờ đã hẹn. Khi người dùng
// quay lại tab, kiểm tra lại hạn token ngay lập tức và làm mới nếu cần, để
// tránh cảm giác "bị rớt đăng nhập" dù thực ra phiên SSO vẫn còn hợp lệ.
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (!tokenClient || !gapiInited || !gisInited) return;
    if (!AppState.isLoggedIn && !hasSessionMarker()) return;

    const expiry = parseInt(localStorage.getItem('gapi_token_expiry') || '0', 10);
    const isExpiredOrNear = Date.now() >= (expiry - TOKEN_REFRESH_MARGIN_SEC * 1000);
    if (isExpiredOrNear) {
        console.log('[G-Portal Auth] Quay lại tab, token sắp/đã hết hạn -> làm mới ngầm...');
        pendingSilentRestore = true;
        tokenClient.requestAccessToken({ prompt: '' });
    }
});

function initGoogleAuth() {
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: (tokenResponse) => {
            const wasSilentAttempt = pendingSilentRestore;
            pendingSilentRestore = false;

            if (tokenResponse && tokenResponse.access_token) {
                const expiresIn = tokenResponse.expires_in || 3600;
                const expiryTime = Date.now() + (expiresIn * 1000);
                localStorage.setItem('gapi_token', JSON.stringify(tokenResponse));
                localStorage.setItem('gapi_token_expiry', String(expiryTime));
                if (gapi.client) gapi.client.setToken(tokenResponse);

                // Đăng nhập/khôi phục thành công (dù ngầm hay thủ công) -> luôn
                // đánh dấu lại "dấu vết phiên" để lần mở trang sau còn biết mà
                // thử khôi phục ngầm tiếp.
                markSessionActive();

                AppState.isLoggedIn = true;
                if (typeof window.showApp === 'function') window.showApp();

                scheduleTokenRefresh(expiresIn);
                fetchUserProfile(tokenResponse.access_token);
                loadAllDataFromDrive();
            } else if (wasSilentAttempt) {
                // Khôi phục ngầm không trả về token nhưng cũng không có lỗi rõ
                // ràng (hiếm gặp) -> coi như phiên không còn hợp lệ, quay về màn
                // hình đăng nhập bình thường, không cần thông báo lỗi to tát.
                silentSessionRestoreFailed('');
            } else {
                setLoginStatus('Đăng nhập thất bại hoặc bị huỷ. Vui lòng thử lại.', true);
            }
        },
        error_callback: (err) => {
            const wasSilentAttempt = pendingSilentRestore;
            pendingSilentRestore = false;

            const type = err && err.type ? err.type : 'unknown';
            console.error('[G-Portal Auth] OAuth error_callback:', err, wasSilentAttempt ? '(silent restore)' : '(interactive)');

            if (wasSilentAttempt) {
                // Thất bại trong lúc thử KHÔI PHỤC NGẦM (không phải người dùng chủ
                // động bấm nút) -> nghĩa là phiên SSO của Google trên trình duyệt
                // này không còn dùng được nữa (đã đăng xuất Google, thu hồi quyền,
                // hoặc trình duyệt chặn cookie bên thứ 3...). Âm thầm quay về màn
                // hình đăng nhập bình thường, xoá dấu vết phiên để không lặp lại
                // việc thử khôi phục vô ích ở những lần mở trang sau.
                silentSessionRestoreFailed(
                    type === 'popup_failed_to_open' || type === 'popup_closed'
                        ? ''
                        : 'Phiên đăng nhập trước đó đã hết hiệu lực, vui lòng đăng nhập lại.'
                );
                return;
            }

            if (type === 'popup_failed_to_open' || type === 'popup_closed') {
                setLoginStatus('');
                return;
            }

            let msg = `Đăng nhập bị gián đoạn (${type}).`;
            msg += ' Nếu đang ở chế độ Ẩn danh/Riêng tư, hãy bật "Cho phép cookie bên thứ 3" (Allow third-party cookies) cho accounts.google.com, hoặc dùng cửa sổ trình duyệt thông thường — Google Identity Services thường không hoạt động đầy đủ khi cookie bên thứ 3 bị chặn.';
            setLoginStatus(msg, true);
        }
    });

    // ---- Quyết định bước tiếp theo dựa trên access token hiện có ----
    const savedTokenStr = localStorage.getItem('gapi_token');
    const savedExpiry = parseInt(localStorage.getItem('gapi_token_expiry') || '0', 10);

    if (savedTokenStr && Date.now() < savedExpiry) {
        // Token còn hạn -> dùng luôn, không cần khôi phục gì cả.
        try {
            const savedToken = JSON.parse(savedTokenStr);
            if (gapi.client) {
                gapi.client.setToken(savedToken);
                markSessionActive();
                AppState.isLoggedIn = true;
                if (typeof window.showApp === 'function') window.showApp();

                const remainingSec = Math.floor((savedExpiry - Date.now()) / 1000);
                scheduleTokenRefresh(remainingSec);

                if (!AppState.userProfile) fetchUserProfile(savedToken.access_token);
                loadAllDataFromDrive();
            }
        } catch (e) {
            console.error("Lỗi parse token:", e);
            localStorage.removeItem('gapi_token');
            localStorage.removeItem('gapi_token_expiry');
            AppState.isLoggedIn = false;
            attemptSilentSessionRestore();
        }
    } else {
        // Token hết hạn hoặc không tồn tại -> dọn dẹp token cũ (nếu có), rồi
        // LUÔN thử khôi phục ngầm nếu trình duyệt này từng đăng nhập trước đó.
        if (savedTokenStr) {
            localStorage.removeItem('gapi_token');
            localStorage.removeItem('gapi_token_expiry');
        }
        AppState.isLoggedIn = false;
        attemptSilentSessionRestore();
    }
}

/**
 * Thử mượn lại phiên đăng nhập Google (silent SSO, không popup) nếu trình
 * duyệt này từng đăng nhập thành công trước đó. Chỉ thử MỘT LẦN mỗi lần tải
 * trang (silentRestoreAttempted) để tránh lặp vô hạn nếu Google liên tục từ
 * chối. Nếu không có dấu vết phiên nào -> hiển thị màn hình đăng nhập bình
 * thường, không làm gì thêm (đúng như một người dùng chưa từng đăng nhập).
 */
function attemptSilentSessionRestore() {
    if (!hasSessionMarker()) {
        if (typeof window.showLogin === 'function') window.showLogin('');
        return;
    }

    if (typeof window.showLogin === 'function') {
        window.showLogin('Đang khôi phục phiên đăng nhập trước đó...');
    }

    if (!silentRestoreAttempted) {
        silentRestoreAttempted = true;
        pendingSilentRestore = true;
        tokenClient.requestAccessToken({ prompt: '' });
    }
}

/**
 * Khôi phục ngầm thất bại thật sự (không phải do popup bị chặn tạm thời) ->
 * coi như phiên SSO không còn dùng được, dọn sạch dấu vết phiên + token, và
 * đưa người dùng về màn hình đăng nhập bình thường kèm thông báo phù hợp.
 */
function silentSessionRestoreFailed(message) {
    clearSessionMarker();
    localStorage.removeItem('gapi_token');
    localStorage.removeItem('gapi_token_expiry');
    AppState.isLoggedIn = false;
    if (typeof window.showLogin === 'function') window.showLogin(message || '');
}

window.retryGoogleLibraries = function () {
    gapiLoadRequested = false;
    setLoginStatus('Đang thử kết nối lại...');
    waitForGoogleLibraries();
};

function loadAllDataFromDrive() {
    if (typeof window.loadSettingsFromDrive === 'function') window.loadSettingsFromDrive();
    if (typeof window.loadScheduleFromDrive === 'function') window.loadScheduleFromDrive();
    if (typeof window.loadProductivityFromDrive === 'function') window.loadProductivityFromDrive();
}

window.handleAuthClick = function () {
    if (tokenClient) {
        pendingSilentRestore = false; // đây là thao tác đăng nhập THỦ CÔNG của người dùng
        tokenClient.requestAccessToken({ prompt: '' });
    } else {
        let reason = 'chưa rõ nguyên nhân — hãy xem dòng chữ đỏ phía dưới nút này hoặc mở Console (F12) để xem lỗi.';
        if (!window.gapi) reason = 'thư viện apis.google.com/js/api.js chưa tải xong hoặc bị chặn.';
        else if (!window.google || !window.google.accounts) reason = 'thư viện accounts.google.com/gsi/client chưa tải xong hoặc bị chặn.';
        else if (!gapiInited) reason = 'gapi.client chưa khởi tạo xong (xem Console F12 để biết lỗi cụ thể).';
        setLoginStatus('Chưa thể đăng nhập: ' + reason, true);
        alert("Hệ thống Google chưa sẵn sàng: " + reason);
    }
};

window.handleSignoutClick = function () {
    clearScheduledTokenRefresh();
    try {
        if (window.gapi && gapi.client && typeof gapi.client.getToken === 'function') {
            const token = gapi.client.getToken();
            if (token && token.access_token && window.google && google.accounts && google.accounts.oauth2) {
                google.accounts.oauth2.revoke(token.access_token, () => {
                    console.log('Đã thu hồi quyền truy cập (Revoked token)');
                });
            }
            gapi.client.setToken('');
        }
    } catch (err) {
        console.error('Lỗi khi đăng xuất khỏi Google (bỏ qua, vẫn đăng xuất cục bộ):', err);
    } finally {
        localStorage.removeItem('gapi_token');
        localStorage.removeItem('gapi_token_expiry');
        localStorage.removeItem('gportal_user_profile');
        // Đăng xuất là hành động CHỦ ĐỘNG duy nhất xoá "dấu vết phiên" — từ giờ
        // trở đi, mở lại trang sẽ không còn tự động thử khôi phục ngầm nữa,
        // đúng yêu cầu "nếu không đăng xuất thì giữ nguyên, đã đăng xuất thì
        // phải đăng nhập lại".
        clearSessionMarker();
        silentRestoreAttempted = false;
        pendingSilentRestore = false;
        AppState.isLoggedIn = false;
        AppState.userProfile = null;
        const box = document.getElementById('user-profile-box');
        if (box) box.innerHTML = '';
        if (typeof window.showLogin === 'function') window.showLogin('Đã đăng xuất.');
    }
};

// ========================================================
// PHẦN LOGIC ĐỒNG BỘ LỊCH VÀ TASKS
// ========================================================

const DEFAULT_WORK_CALENDAR_ID = 'primary';
const DEFAULT_MEETING_CALENDAR_ID = '0770c7fff204ae1af3aa25c9a88b00c17bb59c5f6f0b03dd5aa6b51fd3b567d5@group.calendar.google.com';

function getConfiguredCalendarId(kind) {
    const cfg = (window.portalSettings && window.portalSettings.googleCalendar) || {};
    if (kind === 'meeting') {
        return (cfg.meetingCalendarId && cfg.meetingCalendarId.trim()) ? cfg.meetingCalendarId.trim() : DEFAULT_MEETING_CALENDAR_ID;
    }
    return (cfg.workCalendarId && cfg.workCalendarId.trim()) ? cfg.workCalendarId.trim() : DEFAULT_WORK_CALENDAR_ID;
}

// ---------- Tiện ích ngày tháng dùng chung cho phần đồng bộ ----------
function addDaysToDateKey(dateKey, days) {
    const parts = dateKey.split('-').map(Number);
    const dt = new Date(parts[0], parts[1] - 1, parts[2]);
    dt.setDate(dt.getDate() + days);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
window.addDaysToDateKey = addDaysToDateKey;

function getMonthRangeISO(dateObj) {
    const year = dateObj.getFullYear();
    const month = dateObj.getMonth();
    const first = new Date(year, month, 1);
    const last = new Date(year, month + 1, 0);
    const pad = n => String(n).padStart(2, '0');
    const firstKey = `${first.getFullYear()}-${pad(first.getMonth() + 1)}-${pad(first.getDate())}`;
    const lastKey = `${last.getFullYear()}-${pad(last.getMonth() + 1)}-${pad(last.getDate())}`;
    return {
        firstKey,
        lastKey,
        timeMin: `${firstKey}T00:00:00+07:00`,
        timeMax: `${lastKey}T23:59:59+07:00`
    };
}

// ---------- Tìm sự kiện Lịch theo extendedProperties.private trong một khoảng thời gian ----------
async function findEventsByExtendedPropsInRange(timeMin, timeMax, calendarId, propFilters) {
    const propArray = Object.entries(propFilters).map(([k, v]) => `${k}=${v}`);
    let items = [];
    let pageToken;
    try {
        do {
            const response = await gapi.client.calendar.events.list({
                calendarId: calendarId,
                timeMin: timeMin,
                timeMax: timeMax,
                singleEvents: true,
                privateExtendedProperty: propArray,
                maxResults: 250,
                pageToken: pageToken
            });
            items = items.concat(response.result.items || []);
            pageToken = response.result.nextPageToken;
        } while (pageToken);
    } catch (err) {
        console.error('Lỗi khi tìm sự kiện Lịch (theo khoảng thời gian):', err);
    }
    return items;
}

async function findEventsByExtendedProps(dateStr, calendarId, propFilters) {
    const minTime = `${dateStr}T00:00:00+07:00`;
    const maxTime = `${dateStr}T23:59:59+07:00`;
    return findEventsByExtendedPropsInRange(minTime, maxTime, calendarId, propFilters);
}

async function deleteCalendarEventsByProps(dateStr, calendarId, propFilters) {
    try {
        const events = await findEventsByExtendedProps(dateStr, calendarId, propFilters);
        for (const ev of events) {
            await gapi.client.calendar.events.delete({
                calendarId: calendarId,
                eventId: ev.id
            });
        }
    } catch (err) {
        console.error("Lỗi khi xóa sự kiện Lịch:", err);
    }
}

function buildShiftEventTitle(dayData) {
    const hasMainShift = dayData.shift && dayData.shift !== 'OFF';
    const hasOT = dayData.ot && dayData.ot.trim() !== '';
    const shiftPart = hasMainShift ? dayData.shift : (hasOT ? dayData.ot : 'OFF');

    let typeLabel = 'Chính Chủ';
    if (dayData.type === 'doica') {
        typeLabel = dayData.trade ? `Đổi ca ${dayData.trade}` : 'Đổi ca';
    } else if (dayData.type === 'trucho') {
        typeLabel = dayData.help ? `Trực hộ ${dayData.help}` : 'Trực hộ';
    }

    return `${shiftPart} - ${typeLabel}`;
}
window.buildShiftEventTitle = buildShiftEventTitle;

// FIX #2 — CA ĐÊM: nếu giờ kết thúc <= giờ bắt đầu (VD 21:30 -> 07:30) thì ca
// làm việc kết thúc vào NGÀY HÔM SAU. Trước đây cả start lẫn end đều gán
// chung dateStr nên tạo ra sự kiện có end < start, ca đêm không lên lịch
// đúng. Giờ tự động cộng thêm 1 ngày cho phần NGÀY của thời điểm kết thúc.
window.syncCalendarEvent = async function (dateStr, dayData, shiftTime, description) {
    if (!AppState.isLoggedIn || !gapi.client) return;

    const calendarId = getConfiguredCalendarId('work');
    await deleteCalendarEventsByProps(dateStr, calendarId, { gportalType: 'work' });

    let startTimeStr = "08:00:00";
    let endTimeStr = "17:00:00";
    if (shiftTime && shiftTime.includes("-")) {
        const parts = shiftTime.split("-");
        startTimeStr = parts[0].trim() + ":00";
        endTimeStr = parts[1].trim() + ":00";
    }

    let endDateStr = dateStr;
    if (endTimeStr <= startTimeStr) {
        endDateStr = addDaysToDateKey(dateStr, 1);
    }

    const startDateTime = `${dateStr}T${startTimeStr}+07:00`;
    const endDateTime = `${endDateStr}T${endTimeStr}+07:00`;

    const event = {
        summary: buildShiftEventTitle(dayData),
        description: description,
        start: { dateTime: startDateTime, timeZone: 'Asia/Ho_Chi_Minh' },
        end: { dateTime: endDateTime, timeZone: 'Asia/Ho_Chi_Minh' },
        extendedProperties: { private: { gportalType: 'work' } }
    };

    try {
        await gapi.client.calendar.events.insert({
            calendarId: calendarId,
            resource: event
        });
        console.log(`Đã đồng bộ Lịch ngày ${dateStr} thành công.`);
    } catch (err) {
        console.error("Lỗi đồng bộ Lịch: ", err);
    }
};

window.deleteWorkCalendarEvent = async function (dateStr) {
    if (!AppState.isLoggedIn || !gapi.client) return;
    await deleteCalendarEventsByProps(dateStr, getConfiguredCalendarId('work'), { gportalType: 'work' });
};

// ---------- TĂNG CƯỜNG (OT) LÀ SỰ KIỆN LỊCH RIÊNG ----------
function buildOtEventTitle(dayData) {
    return `${dayData.ot} - Tăng cường (OT)`;
}
window.buildOtEventTitle = buildOtEventTitle;

window.syncOtCalendarEvent = async function (dateStr, dayData, otShiftTime, description) {
    if (!AppState.isLoggedIn || !gapi.client) return;
    if (!otShiftTime) return;

    const calendarId = getConfiguredCalendarId('work');
    await deleteCalendarEventsByProps(dateStr, calendarId, { gportalType: 'work-ot' });

    let startTimeStr = "08:00:00";
    let endTimeStr = "17:00:00";
    if (otShiftTime.includes("-")) {
        const parts = otShiftTime.split("-");
        startTimeStr = parts[0].trim() + ":00";
        endTimeStr = parts[1].trim() + ":00";
    }

    let endDateStr = dateStr;
    if (endTimeStr <= startTimeStr) {
        endDateStr = addDaysToDateKey(dateStr, 1);
    }

    const startDateTime = `${dateStr}T${startTimeStr}+07:00`;
    const endDateTime = `${endDateStr}T${endTimeStr}+07:00`;

    const event = {
        summary: buildOtEventTitle(dayData),
        description: description,
        start: { dateTime: startDateTime, timeZone: 'Asia/Ho_Chi_Minh' },
        end: { dateTime: endDateTime, timeZone: 'Asia/Ho_Chi_Minh' },
        extendedProperties: { private: { gportalType: 'work-ot' } }
    };

    try {
        await gapi.client.calendar.events.insert({
            calendarId: calendarId,
            resource: event
        });
        console.log(`Đã đồng bộ sự kiện Tăng cường (OT) ngày ${dateStr} thành công.`);
    } catch (err) {
        console.error("Lỗi đồng bộ sự kiện OT: ", err);
    }
};

window.deleteOtCalendarEvent = async function (dateStr) {
    if (!AppState.isLoggedIn || !gapi.client) return;
    await deleteCalendarEventsByProps(dateStr, getConfiguredCalendarId('work'), { gportalType: 'work-ot' });
};

window.deleteMeetingCalendarEvent = async function (meeting) {
    if (!AppState.isLoggedIn || !gapi.client || !meeting) return;
    await deleteCalendarEventsByProps(meeting.date, getConfiguredCalendarId('meeting'), {
        gportalType: 'meeting',
        gportalMeetingId: meeting.id
    });
};

window.syncMeetingCalendarEvent = async function (meeting) {
    if (!AppState.isLoggedIn || !gapi.client || !meeting) return;
    const calendarId = getConfiguredCalendarId('meeting');
    await deleteCalendarEventsByProps(meeting.date, calendarId, {
        gportalType: 'meeting',
        gportalMeetingId: meeting.id
    });

    const startStr = (meeting.start || '09:00') + ':00';
    const endStr = (meeting.end || '10:00') + ':00';
    let endDateStr = meeting.date;
    if (endStr <= startStr) {
        endDateStr = addDaysToDateKey(meeting.date, 1);
    }

    const startDateTime = `${meeting.date}T${startStr}+07:00`;
    const endDateTime = `${endDateStr}T${endStr}+07:00`;
    const isOnline = meeting.mode === 'online';
    const event = {
        summary: meeting.title,
        description: [meeting.content, isOnline ? `Link họp: ${meeting.location || ''}` : `Địa điểm: ${meeting.location || ''}`].filter(Boolean).join('\n'),
        location: meeting.location || '',
        start: { dateTime: startDateTime, timeZone: 'Asia/Ho_Chi_Minh' },
        end: { dateTime: endDateTime, timeZone: 'Asia/Ho_Chi_Minh' },
        extendedProperties: { private: { gportalType: 'meeting', gportalMeetingId: meeting.id } }
    };

    try {
        await gapi.client.calendar.events.insert({ calendarId, resource: event });
        console.log(`Đã đồng bộ lịch họp ${meeting.id}.`);
    } catch (err) {
        console.error('Lỗi đồng bộ lịch họp:', err);
    }
};

// ---------- TASK PCCV ----------
async function findGoogleTasksInRange(dueMin, dueMax) {
    let items = [];
    let pageToken;
    do {
        const listRes = await gapi.client.tasks.tasks.list({
            tasklist: '@default',
            showCompleted: false,
            showHidden: false,
            dueMin: dueMin,
            dueMax: dueMax,
            maxResults: 100,
            pageToken: pageToken
        });
        items = items.concat(listRes.result.items || []);
        pageToken = listRes.result.nextPageToken;
    } while (pageToken);
    return items;
}

async function findGoogleTaskByDate(dateKey) {
    const dueMin = `${dateKey}T00:00:00.000Z`;
    const dueMax = `${dateKey}T23:59:59.999Z`;
    const items = await findGoogleTasksInRange(dueMin, dueMax);
    return items.find(t => t.due && t.due.substring(0, 10) === dateKey);
}

window.syncGoogleTask = async function (dateKey, taskName, notes) {
    if (!AppState.isLoggedIn || !gapi.client.tasks) return;
    try {
        const dueISO = `${dateKey}T00:00:00.000Z`;
        const existing = await findGoogleTaskByDate(dateKey);
        const taskBody = { title: taskName, notes: notes || '', due: dueISO };

        if (existing) {
            await gapi.client.tasks.tasks.update({
                tasklist: '@default',
                task: existing.id,
                resource: { ...taskBody, id: existing.id }
            });
        } else {
            await gapi.client.tasks.tasks.insert({
                tasklist: '@default',
                resource: taskBody
            });
        }
        console.log(`Đã đồng bộ Task PCCV ngày ${dateKey}.`);
    } catch (err) {
        console.error('Lỗi đồng bộ Google Task:', err);
    }
};

window.deleteGoogleTask = async function (dateKey) {
    if (!AppState.isLoggedIn || !gapi.client.tasks) return;
    try {
        const existing = await findGoogleTaskByDate(dateKey);
        if (existing) {
            await gapi.client.tasks.tasks.delete({ tasklist: '@default', task: existing.id });
            console.log(`Đã xoá Task PCCV ngày ${dateKey}.`);
        }
    } catch (err) {
        console.error('Lỗi xoá Google Task:', err);
    }
};

// ========================================================
// ĐỒNG BỘ NGƯỢC: đọc lại Google Calendar/Tasks để khớp lại Portal
// ========================================================
function parseShiftEventTitle(title) {
    const fallback = { shiftPart: (title || '').trim() || 'OFF', type: 'chinhchu', trade: '', help: '' };
    if (!title) return fallback;
    const idx = title.indexOf(' - ');
    if (idx === -1) return fallback;
    const shiftPart = title.substring(0, idx).trim() || 'OFF';
    const rest = title.substring(idx + 3).trim();
    if (rest.indexOf('Đổi ca') === 0) {
        return { shiftPart, type: 'doica', trade: rest.replace('Đổi ca', '').trim(), help: '' };
    }
    if (rest.indexOf('Trực hộ') === 0) {
        return { shiftPart, type: 'trucho', trade: '', help: rest.replace('Trực hộ', '').trim() };
    }
    return { shiftPart, type: 'chinhchu', trade: '', help: '' };
}

function parseOtEventTitle(title) {
    if (!title) return '';
    const idx = title.indexOf(' - ');
    return (idx === -1 ? title : title.substring(0, idx)).trim();
}

function parseShiftEventDescription(desc) {
    const result = { ot: '', task: '' };
    if (!desc) return result;
    desc.split('\n').forEach(line => {
        const otMatch = line.match(/^OT:\s*(.*)$/);
        if (otMatch) result.ot = otMatch[1].trim();
        const pccvMatch = line.match(/^PCCV:\s*(.*)$/);
        if (pccvMatch) result.task = pccvMatch[1].trim();
    });
    return result;
}

function parseMeetingDescription(desc) {
    const result = { content: '', location: '', mode: 'offline' };
    if (!desc) return result;
    const lines = desc.split('\n');
    const last = lines[lines.length - 1] || '';
    if (last.indexOf('Link họp:') === 0) {
        result.mode = 'online';
        result.location = last.replace('Link họp:', '').trim();
        lines.pop();
    } else if (last.indexOf('Địa điểm:') === 0) {
        result.mode = 'offline';
        result.location = last.replace('Địa điểm:', '').trim();
        lines.pop();
    }
    result.content = lines.join('\n').trim();
    return result;
}

function eventDateKey(ev) {
    const raw = (ev.start && (ev.start.dateTime || ev.start.date)) || '';
    return raw.substring(0, 10);
}

window.reconcileMonthWithGoogle = async function (monthDate) {
    if (!AppState.isLoggedIn || !gapi.client) {
        return { changed: false, changedSchedule: false, changedMeeting: false };
    }

    const { firstKey, lastKey, timeMin, timeMax } = getMonthRangeISO(monthDate);
    const workCalendarId = getConfiguredCalendarId('work');
    const meetingCalendarId = getConfiguredCalendarId('meeting');

    let changedSchedule = false;
    let changedMeeting = false;

    const workEvents = await findEventsByExtendedPropsInRange(timeMin, timeMax, workCalendarId, { gportalType: 'work' });
    const googleScheduleMap = {};
    workEvents.forEach(ev => {
        const dateKey = eventDateKey(ev);
        if (!dateKey) return;
        const parsedTitle = parseShiftEventTitle(ev.summary);
        googleScheduleMap[dateKey] = {
            type: parsedTitle.type,
            shift: parsedTitle.shiftPart || 'OFF',
            ot: '',
            task: '',
            trade: parsedTitle.type === 'doica' ? parsedTitle.trade : '',
            help: parsedTitle.type === 'trucho' ? parsedTitle.help : ''
        };
    });

    const otEvents = await findEventsByExtendedPropsInRange(timeMin, timeMax, workCalendarId, { gportalType: 'work-ot' });
    otEvents.forEach(ev => {
        const dateKey = eventDateKey(ev);
        if (!dateKey) return;
        const otCode = parseOtEventTitle(ev.summary);
        if (!otCode) return;
        if (googleScheduleMap[dateKey]) {
            googleScheduleMap[dateKey].ot = otCode;
        } else {
            googleScheduleMap[dateKey] = { type: 'chinhchu', shift: 'OFF', ot: otCode, task: '', trade: '', help: '' };
        }
    });

    const dueMin = `${firstKey}T00:00:00.000Z`;
    const dueMax = `${lastKey}T23:59:59.999Z`;
    const monthTasks = await findGoogleTasksInRange(dueMin, dueMax);
    const googleTaskMap = {};
    monthTasks.forEach(t => {
        if (!t.due) return;
        const dateKey = t.due.substring(0, 10);
        googleTaskMap[dateKey] = t.title || '';
    });

    Object.keys(googleScheduleMap).forEach(dateKey => {
        if (googleTaskMap[dateKey] !== undefined) {
            googleScheduleMap[dateKey].task = googleTaskMap[dateKey];
        }
    });
    Object.keys(googleTaskMap).forEach(dateKey => {
        if (dateKey >= firstKey && dateKey <= lastKey && !googleScheduleMap[dateKey]) {
            googleScheduleMap[dateKey] = { type: 'chinhchu', shift: 'OFF', ot: '', task: googleTaskMap[dateKey], trade: '', help: '' };
        }
    });

    window.monthlyScheduleData = window.monthlyScheduleData || {};
    const localKeysInMonth = Object.keys(window.monthlyScheduleData).filter(k => k >= firstKey && k <= lastKey);

    Object.keys(googleScheduleMap).forEach(dateKey => {
        const g = googleScheduleMap[dateKey];
        const existing = window.monthlyScheduleData[dateKey];
        const same = existing && existing.type === g.type && existing.shift === g.shift &&
            (existing.ot || '') === (g.ot || '') && (existing.task || '') === (g.task || '') &&
            (existing.trade || '') === (g.trade || '') && (existing.help || '') === (g.help || '');
        if (!same) {
            window.monthlyScheduleData[dateKey] = g;
            changedSchedule = true;
        }
    });

    localKeysInMonth.forEach(dateKey => {
        const local = window.monthlyScheduleData[dateKey];
        const hadDataLocally = local && ((local.shift && local.shift !== 'OFF') || local.ot || local.task);
        if (hadDataLocally && !googleScheduleMap[dateKey]) {
            delete window.monthlyScheduleData[dateKey];
            changedSchedule = true;
        }
    });

    const meetingEvents = await findEventsByExtendedPropsInRange(timeMin, timeMax, meetingCalendarId, { gportalType: 'meeting' });
    const googleMeetingMap = {};
    meetingEvents.forEach(ev => {
        const meetingId = ev.extendedProperties && ev.extendedProperties.private ? ev.extendedProperties.private.gportalMeetingId : null;
        if (!meetingId) return;
        const dateKey = eventDateKey(ev);
        const parsedDesc = parseMeetingDescription(ev.description);
        const startTime = (ev.start && ev.start.dateTime) ? ev.start.dateTime.substring(11, 16) : '09:00';
        const endTime = (ev.end && ev.end.dateTime) ? ev.end.dateTime.substring(11, 16) : '10:00';
        googleMeetingMap[meetingId] = {
            id: meetingId,
            date: dateKey,
            start: startTime,
            end: endTime,
            mode: parsedDesc.mode,
            title: ev.summary || '',
            content: parsedDesc.content,
            location: parsedDesc.location || ev.location || ''
        };
    });

    window.monthlyMeetingsData = window.monthlyMeetingsData || {};
    const localMeetingIdsInMonth = Object.keys(window.monthlyMeetingsData).filter(id => {
        const m = window.monthlyMeetingsData[id];
        return m && m.date >= firstKey && m.date <= lastKey;
    });

    Object.keys(googleMeetingMap).forEach(id => {
        const g = googleMeetingMap[id];
        const existing = window.monthlyMeetingsData[id];
        const same = existing && existing.date === g.date && existing.start === g.start && existing.end === g.end &&
            existing.mode === g.mode && existing.title === g.title && (existing.content || '') === (g.content || '') &&
            (existing.location || '') === (g.location || '');
        if (!same) {
            window.monthlyMeetingsData[id] = g;
            changedMeeting = true;
        }
    });

    localMeetingIdsInMonth.forEach(id => {
        if (!googleMeetingMap[id]) {
            delete window.monthlyMeetingsData[id];
            changedMeeting = true;
        }
    });

    return { changed: changedSchedule || changedMeeting, changedSchedule, changedMeeting };
};

async function findGoogleTaskByDatePublicWrapper(dateKey) {
    return findGoogleTaskByDate(dateKey);
}
window.findGoogleTaskByDate = findGoogleTaskByDatePublicWrapper;

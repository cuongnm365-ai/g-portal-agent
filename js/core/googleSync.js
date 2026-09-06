/**
 * googleSync.js - Google Auth + Drive + Calendar + Tasks
 *
 * ============================================================================
 * BẢN VÁ MỚI NHẤT (ƯU TIÊN CAO NHẤT) — TASK PCCV VẪN BỊ TRÙNG + MẤT TRẠNG
 * THÁI "ĐÃ HOÀN THÀNH" MỖI KHI CẬP NHẬT LỊCH/PCCV HOẶC BẤM "DỌN DẸP TRÙNG LẶP"
 * ============================================================================
 * TRIỆU CHỨNG (báo cáo thực tế): Mỗi khi cập nhật Lịch làm việc/PCCV cho 1
 * ngày đã có sẵn Task, hệ thống lại TẠO THÊM 1 Task mới (rỗng) thay vì cập
 * nhật đúng Task cũ. Khi bấm "Dọn dẹp trùng lặp", hệ thống lại XOÁ ĐÚNG bản
 * Task đã tick Hoàn thành và GIỮ LẠI bản Task rỗng vừa bị tạo trùng, khiến
 * người dùng phải tick "Hoàn thành" lại từ đầu — lặp đi lặp lại mỗi lần sync.
 *
 * NGUYÊN NHÂN GỐC RỄ #1 (vì sao cứ tạo Task trùng):
 * findGoogleTaskByDate() (bản trước) xác định "ngày này đã có Task trên
 * Google Tasks hay chưa" bằng cách nhờ Google lọc sẵn theo trường "due" của
 * Task (dueMin/dueMax), dù đã mở rộng cửa sổ lọc và bật showCompleted +
 * showHidden. Trên thực tế, việc Google Tasks API lọc theo "due" đối với
 * các Task ĐÃ HOÀN THÀNH / ĐÃ ẨN xử lý không ổn định — có lúc trả về đúng,
 * có lúc không trả về dù Task đó có thật trên hệ thống — và điều này xảy ra
 * BẤT KỂ cửa sổ lọc rộng hay hẹp, vì bản chất không phải do sai biên ngày mà
 * do cách Google lập chỉ mục "due" cho Task đã hoàn thành/ẩn không đáng tin
 * cậy. Hậu quả: hệ thống hiểu nhầm "ngày này chưa có Task" -> tạo Task MỚI
 * (rỗng) dù Task CŨ (đã hoàn thành) vẫn còn nguyên trên Google -> trùng lặp.
 *
 * NGUYÊN NHÂN GỐC RỄ #2 (vì sao "Dọn dẹp trùng lặp" lại xoá nhầm bản đã
 * hoàn thành): trong mỗi nhóm Task trùng (cùng ngày), bản vá trước chỉ xét
 * "updated" (thời điểm cập nhật gần nhất) để chọn bản GIỮ LẠI, không thiên
 * vị theo trạng thái hoàn thành. Nhưng vì Task MỚI bị tạo trùng (do lỗi #1)
 * luôn có "updated" MỚI HƠN Task CŨ đã hoàn thành (vốn không bị đụng tới từ
 * lâu), quy tắc "giữ bản cập nhật gần nhất" vô tình luôn GIỮ bản rỗng mới và
 * XOÁ bản đã hoàn thành — đúng ngược lại điều người dùng mong muốn.
 *
 * FIX TẬN GỐC:
 *  1) KHÔNG còn dùng dueMin/dueMax để xác định "ngày này đã có Task hay
 *     chưa" nữa. Mỗi Task do hệ thống tạo/cập nhật giờ được gắn thêm 1 dòng
 *     "thẻ nhận diện ngày" trong phần Notes, dạng cố định:
 *         #GPORTAL_DATE:YYYY-MM-DD#
 *     Khi cần tìm Task của 1 ngày, hệ thống LẤY TOÀN BỘ Task trong danh
 *     sách (phân trang đầy đủ, showCompleted+showHidden=true, KHÔNG lọc
 *     theo due), rồi tự đọc thẻ nhận diện này để xác định chính xác Task đó
 *     thuộc ngày nào — hoàn toàn không phụ thuộc vào việc Google có lọc
 *     đúng theo "due" hay không, và không bị ảnh hưởng bởi trạng thái hoàn
 *     thành/ẩn của Task. Xem findAllGoogleTasks() / getTaskDateKey().
 *  2) Khi CẬP NHẬT 1 Task đã có, hệ thống chủ động đọc lại "status" (và
 *     "completed" nếu có) của Task hiện tại rồi gửi kèm trong resource cập
 *     nhật — đảm bảo trạng thái Hoàn thành KHÔNG BAO GIỜ bị reset chỉ vì hệ
 *     thống cập nhật lại Tiêu đề/Notes/Due.
 *  3) "Dọn dẹp trùng lặp" (cleanupDuplicateGoogleData): trong mỗi nhóm Task
 *     trùng, nếu có ít nhất 1 bản ĐÃ HOÀN THÀNH thì LUÔN ưu tiên GIỮ LẠI 1
 *     trong số các bản đã hoàn thành đó (chọn bản "updated" mới nhất trong
 *     nhóm đã hoàn thành nếu có nhiều hơn 1) — không còn xét "cập nhật gần
 *     nhất" một cách trung lập nữa, vì cách làm trung lập trước đây trên
 *     thực tế luôn thiên vị nhầm sang bản rỗng mới tạo. Chỉ khi CẢ NHÓM đều
 *     chưa hoàn thành thì mới xét "cập nhật gần nhất" như bình thường.
 *     Lưu ý: đây là bước "dọn rác" 1 lần cho các Task đã lỡ bị trùng TỪ
 *     TRƯỚC KHI có bản vá #1 — sau bản vá #1, hệ thống sẽ không còn tạo Task
 *     trùng mới nữa, nên các lần đồng bộ tiếp theo chỉ đơn thuần CẬP NHẬT
 *     đúng bản Task đang có (giữ nguyên trạng thái Hoàn thành, chỉ thay đổi
 *     Tiêu đề/Notes nếu PCCV có thay đổi).
 *  4) reconcileMonthWithGoogle() ("Kiểm tra đồng bộ"): phần đọc Task trong
 *     tháng cũng chuyển sang findAllGoogleTasks() + getTaskDateKey() thay vì
 *     lọc theo due, để nhất quán và không còn bỏ sót Task đã hoàn thành/ẩn.
 *  5) Đã loại bỏ findGoogleTasksInRange() (không còn nơi nào dùng, thay thế
 *     hoàn toàn bằng findAllGoogleTasks()).
 * ============================================================================
 *
 * ============================================================================
 * BẢN VÁ TRƯỚC ĐÓ #1 — "DOUBLE TASK" KHI LƯU TỪNG NGÀY (đã được thay thế
 * hoàn toàn bởi bản vá mới ở trên, giữ lại để biết lịch sử xử lý)
 * ============================================================================
 * findGoogleTaskByDate() bản cũ hơn dùng cửa sổ tìm kiếm ĐÚNG BẰNG 1 NGÀY,
 * khiến Task do hệ thống tạo nằm sát biên dueMin -> Google Tasks API xử lý
 * biên không ổn định với Task đã hoàn tất/ẩn -> không tìm thấy -> tạo trùng.
 * Từng được vá bằng cách NỚI RỘNG cửa sổ tìm kiếm ra 1 ngày mỗi bên rồi lọc
 * lại theo dateKey — nhưng thực tế vẫn còn sót trường hợp lỗi (xem bản vá
 * mới nhất ở trên: nguyên nhân không chỉ là sai biên mà là bản chất việc lọc
 * theo "due" với Task đã hoàn thành/ẩn không đáng tin cậy nói chung).
 *
 * BẢN VÁ TRƯỚC ĐÓ #2 — "Dọn dẹp" xóa nhầm Task đã hoàn tất: từng ưu tiên
 * giữ lại Task CHƯA hoàn tất (sai — xoá nhầm Task đã hoàn tất có ý nghĩa),
 * sau đó đổi sang trung lập chỉ xét "updated" mới nhất (vẫn sai theo chiều
 * ngược lại — vô tình vẫn hay xoá nhầm Task đã hoàn tất, xem giải thích ở
 * bản vá mới nhất phía trên). Bản vá mới nhất sửa đúng theo hướng: LUÔN ưu
 * tiên giữ Task đã hoàn thành khi trong nhóm trùng có ít nhất 1 bản như vậy.
 * ============================================================================
 *
 * ============================================================================
 * BẢN VÁ TRƯỚC ĐÓ #3 — LỖI "DOUBLE EVENT + TASK" (Event/Task bị nhân đôi do
 * bước xoá sự kiện/task cũ trước khi tạo mới bị nuốt lỗi im lặng)
 * ============================================================================
 * TRIỆU CHỨNG: Những ngày đã có sẵn Event/Task trên Google, khi người dùng
 * bổ sung thêm nội dung rồi bấm "Đồng bộ Google" (đồng bộ lại nguyên tháng),
 * các ngày CŨ vốn không hề thay đổi gì cũng bị tạo thêm 1 Event/Task trùng.
 *
 * NGUYÊN NHÂN: các hàm tìm/xoá sự kiện cũ (findEventsByExtendedPropsInRange,
 * deleteCalendarEventsByProps) trước đây tự bọc try/catch và chỉ
 * console.error() — nuốt lỗi hoàn toàn. Nếu bước xoá thất bại (403/429
 * rate-limit, lỗi mạng tạm thời...), bước tạo mới phía sau vẫn chạy vô điều
 * kiện -> tạo trùng.
 *
 * FIX ÁP DỤNG (vẫn đang áp dụng cho phần Calendar Event):
 *  1) Bỏ hoàn toàn try/catch nuốt lỗi ở 2 hàm trên — lỗi được ném ra ngoài.
 *  2) syncCalendarEvent()/syncOtCalendarEvent()/syncMeetingCalendarEvent()
 *     không tự bọc try/catch quanh bước insert — nếu xoá thất bại thì DỪNG
 *     LẠI, không tạo mới (nguyên tắc: "xoá thất bại thì không tạo mới").
 *  3) Cơ chế TỰ THỬ LẠI (retry + exponential backoff) cho lỗi tạm thời — xem
 *     withGoogleApiRetry().
 *  4) window.cleanupDuplicateGoogleData(monthDate) — quét và dọn dẹp các
 *     Event/Task đã lỡ bị tạo trùng từ trước khi có các bản vá chống-double.
 * ============================================================================
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
// Thay const bằng window để dùng chung với app.js, không bao giờ bị lỗi trùng lặp
window.GPORTAL_SESSION_MARKER_KEY = window.GPORTAL_SESSION_MARKER_KEY || 'gportal_session_marker';

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
// TIỆN ÍCH: gọi API Google kèm TỰ ĐỘNG THỬ LẠI khi gặp lỗi tạm thời
// (429 rate-limit, 403 rateLimitExceeded/userRateLimitExceeded, 500, 503).
// ============================================================
function isRetryableGoogleApiError(err) {
    const apiErr = err && err.result && err.result.error;
    const status = (apiErr && apiErr.code) || err.status || 0;
    if (status === 429 || status === 500 || status === 503) return true;
    if (status === 403) {
        const reasons = (apiErr && apiErr.errors) ? apiErr.errors.map(e => e.reason) : [];
        return reasons.some(r => r === 'rateLimitExceeded' || r === 'userRateLimitExceeded' || r === 'quotaExceeded');
    }
    // Lỗi mạng (không có response) cũng coi là tạm thời, đáng thử lại.
    return !apiErr && !err.status;
}

async function withGoogleApiRetry(fn, { retries = 4, baseDelayMs = 500, label = '' } = {}) {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastErr = err;
            if (!isRetryableGoogleApiError(err) || attempt === retries) throw err;
            const delayMs = baseDelayMs * Math.pow(2, attempt) + Math.floor(Math.random() * 250);
            console.warn(`[G-Portal Sync] ${label || 'Gọi API Google'} gặp lỗi tạm thời, thử lại lần ${attempt + 1}/${retries} sau ${delayMs}ms...`, err);
            await new Promise(res => setTimeout(res, delayMs));
        }
    }
    throw lastErr;
}
window.gportalSleep = function (ms) { return new Promise(res => setTimeout(res, ms)); };

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
        // Cảnh báo sớm ngay từ lúc khởi tạo nếu discovery doc của Tasks API
        // không nạp được namespace gapi.client.tasks — giúp phát hiện lỗi
        // "PCCV không lên Google Tasks" ngay từ gốc.
        if (!gapi.client.tasks) {
            console.error('[G-Portal Auth] CẢNH BÁO: gapi.client.tasks KHÔNG tồn tại sau khi init discovery docs. Google Tasks (PCCV) sẽ không thể đồng bộ được. Nguyên nhân thường gặp: "Google Tasks API" chưa được BẬT (Enable) trong Google Cloud Console cho project ứng với CLIENT_ID/API_KEY đang dùng — vào https://console.cloud.google.com/apis/library/tasks.googleapis.com để bật.');
        }
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
// Lịch riêng dành cho sự kiện Tăng cường (OT), tách biệt hoàn toàn khỏi
// Lịch làm việc chính để dễ theo dõi/ẩn-hiện riêng trên Google Calendar.
const DEFAULT_OT_CALENDAR_ID = 'a4fd9cc3792252ef744f35ecd2265d1647e9f9d6f9984d15624cf68ea82850ab@group.calendar.google.com';

function getConfiguredCalendarId(kind) {
    const cfg = (window.portalSettings && window.portalSettings.googleCalendar) || {};
    if (kind === 'meeting') {
        return (cfg.meetingCalendarId && cfg.meetingCalendarId.trim()) ? cfg.meetingCalendarId.trim() : DEFAULT_MEETING_CALENDAR_ID;
    }
    if (kind === 'ot') {
        return (cfg.otCalendarId && cfg.otCalendarId.trim()) ? cfg.otCalendarId.trim() : DEFAULT_OT_CALENDAR_ID;
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
// QUAN TRỌNG (xem ghi chú đầu file): KHÔNG được tự bọc try/catch nuốt lỗi ở
// đây nữa. Nếu gapi.client.calendar.events.list() thất bại (VD 429
// rate-limit), lỗi PHẢI được ném ra ngoài để deleteCalendarEventsByProps() và
// các hàm gọi nó (syncCalendarEvent/syncOtCalendarEvent) biết mà DỪNG LẠI,
// không được tiếp tục tạo sự kiện mới — nếu không sẽ tạo ra Event trùng lặp.
async function findEventsByExtendedPropsInRange(timeMin, timeMax, calendarId, propFilters) {
    const propArray = Object.entries(propFilters).map(([k, v]) => `${k}=${v}`);
    let items = [];
    let pageToken;
    do {
        const response = await withGoogleApiRetry(() => gapi.client.calendar.events.list({
            calendarId: calendarId,
            timeMin: timeMin,
            timeMax: timeMax,
            singleEvents: true,
            privateExtendedProperty: propArray,
            maxResults: 250,
            pageToken: pageToken
        }), { label: `Tìm sự kiện Lịch (${propArray.join(',')})` });
        items = items.concat(response.result.items || []);
        pageToken = response.result.nextPageToken;
    } while (pageToken);
    return items;
}

async function findEventsByExtendedProps(dateStr, calendarId, propFilters) {
    const minTime = `${dateStr}T00:00:00+07:00`;
    const maxTime = `${dateStr}T23:59:59+07:00`;
    return findEventsByExtendedPropsInRange(minTime, maxTime, calendarId, propFilters);
}

// QUAN TRỌNG: không nuốt lỗi. Nếu tìm hoặc xoá thất bại, ném lỗi ra ngoài để
// syncCalendarEvent()/syncOtCalendarEvent() KHÔNG được phép tạo sự kiện mới
// tiếp theo — đây là điều kiện cốt lõi để triệt tiêu lỗi Event bị double.
async function deleteCalendarEventsByProps(dateStr, calendarId, propFilters) {
    const events = await findEventsByExtendedProps(dateStr, calendarId, propFilters);
    for (const ev of events) {
        await withGoogleApiRetry(() => gapi.client.calendar.events.delete({
            calendarId: calendarId,
            eventId: ev.id
        }), { label: `Xoá sự kiện Lịch ngày ${dateStr}` });
    }
    return events.length;
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

// FIX CA ĐÊM: nếu giờ kết thúc <= giờ bắt đầu (VD 21:30 -> 07:30) thì ca
// làm việc kết thúc vào NGÀY HÔM SAU — tự động cộng thêm 1 ngày cho phần
// NGÀY của thời điểm kết thúc.
//
// FIX DOUBLE EVENT: hàm này KHÔNG còn tự bọc try/catch quanh bước xoá + tạo
// mới nữa. Nếu deleteCalendarEventsByProps() ném lỗi (xoá thất bại), hàm này
// sẽ NÉM LỖI ĐÓ RA NGOÀI NGAY, dừng lại TRƯỚC khi kịp gọi events.insert() —
// tức là thà "chưa đồng bộ được ngày này" còn hơn "tạo sự kiện trùng lặp".
// Nơi gọi (schedule.js) sẽ bắt lỗi này, báo rõ cho người dùng ngày nào bị
// lỗi, và không đánh dấu ngày đó là đã đồng bộ thành công.
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

    await withGoogleApiRetry(() => gapi.client.calendar.events.insert({
        calendarId: calendarId,
        resource: event
    }), { label: `Tạo sự kiện Lịch ngày ${dateStr}` });
    console.log(`Đã đồng bộ Lịch ngày ${dateStr} thành công.`);
};

window.deleteWorkCalendarEvent = async function (dateStr) {
    if (!AppState.isLoggedIn || !gapi.client) return;
    await deleteCalendarEventsByProps(dateStr, getConfiguredCalendarId('work'), { gportalType: 'work' });
};

// ---------- TĂNG CƯỜNG (OT) LÀ SỰ KIỆN TRÊN LỊCH OT RIÊNG BIỆT ----------
function buildOtEventTitle(dayData) {
    return `${dayData.ot} - Tăng cường (OT)`;
}
window.buildOtEventTitle = buildOtEventTitle;

// Cùng nguyên tắc chống double như syncCalendarEvent(): không nuốt lỗi, nếu
// xoá sự kiện OT cũ thất bại thì DỪNG LẠI, không tạo sự kiện OT mới.
window.syncOtCalendarEvent = async function (dateStr, dayData, otShiftTime, description) {
    if (!AppState.isLoggedIn || !gapi.client) return;
    if (!otShiftTime) return;

    const calendarId = getConfiguredCalendarId('ot');
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

    await withGoogleApiRetry(() => gapi.client.calendar.events.insert({
        calendarId: calendarId,
        resource: event
    }), { label: `Tạo sự kiện OT ngày ${dateStr}` });
    console.log(`Đã đồng bộ sự kiện Tăng cường (OT) ngày ${dateStr} thành công vào Lịch OT riêng.`);
};

window.deleteOtCalendarEvent = async function (dateStr) {
    if (!AppState.isLoggedIn || !gapi.client) return;
    await deleteCalendarEventsByProps(dateStr, getConfiguredCalendarId('ot'), { gportalType: 'work-ot' });
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

    await withGoogleApiRetry(() => gapi.client.calendar.events.insert({ calendarId, resource: event }), { label: `Tạo lịch họp ${meeting.id}` });
    console.log(`Đã đồng bộ lịch họp ${meeting.id}.`);
};

// ============================================================================
// ---------- TASK PCCV (xem bản vá mới nhất ở đầu file) ----------
// ============================================================================

// Thẻ nhận diện ngày gắn trong phần Notes của Task, ví dụ: #GPORTAL_DATE:2026-07-01#
// Đây là "nguồn sự thật" duy nhất để xác định 1 Task thuộc về ngày nào —
// KHÔNG còn dựa vào trường "due" để tìm kiếm/lọc nữa (xem giải thích đầu file).
const GPORTAL_TASK_DATE_TAG_REGEX = /#GPORTAL_DATE:(\d{4}-\d{2}-\d{2})#/;

function buildGportalTaskNotes(dateKey, notes) {
    const base = (notes || '').replace(GPORTAL_TASK_DATE_TAG_REGEX, '').trim();
    const tag = `#GPORTAL_DATE:${dateKey}#`;
    return base ? `${base}\n${tag}` : tag;
}

// Xác định ngày của 1 Task: ưu tiên đọc thẻ nhận diện trong Notes (đáng tin
// cậy tuyệt đối, không phụ thuộc trạng thái hoàn thành/ẩn); nếu Task được
// tạo TRƯỚC KHI có bản vá này (chưa có thẻ) thì tạm lấy theo "due" để vẫn
// tương thích ngược với dữ liệu cũ.
function getTaskDateKey(task) {
    if (task && task.notes) {
        const match = task.notes.match(GPORTAL_TASK_DATE_TAG_REGEX);
        if (match) return match[1];
    }
    if (task && task.due) return task.due.substring(0, 10);
    return null;
}

// Lấy TOÀN BỘ Task trong tasklist mặc định (phân trang đầy đủ), showCompleted
// + showHidden = true, KHÔNG lọc theo due. Đây là điểm mấu chốt của bản vá:
// việc Google Tasks API lọc theo due đối với Task đã hoàn thành/đã ẩn không
// đáng tin cậy, nên thay vì nhờ Google lọc hộ, hệ thống tự lấy hết rồi lọc
// lại chính xác ở phía client bằng getTaskDateKey().
async function findAllGoogleTasks() {
    let items = [];
    let pageToken;
    do {
        const listRes = await withGoogleApiRetry(() => gapi.client.tasks.tasks.list({
            tasklist: '@default',
            showCompleted: true,
            showHidden: true,
            maxResults: 100,
            pageToken: pageToken
        }), { label: 'Lấy toàn bộ Google Tasks' });
        items = items.concat(listRes.result.items || []);
        pageToken = listRes.result.nextPageToken;
    } while (pageToken);
    return items;
}

/**
 * Tìm Task của đúng 1 ngày (dateKey), dựa trên thẻ nhận diện trong Notes
 * (hoặc "due" cho Task cũ chưa có thẻ). Nếu vì lý do nào đó vẫn còn sót
 * nhiều hơn 1 Task cho cùng 1 ngày (dữ liệu trùng lặp cũ từ trước khi có
 * bản vá này), tạm lấy bản "updated" mới nhất để làm việc tiếp — người dùng
 * nên bấm "Dọn dẹp trùng lặp" để dọn sạch các bản còn lại.
 */
async function findGoogleTaskByDate(dateKey) {
    const allTasks = await findAllGoogleTasks();
    const matches = allTasks.filter(t => getTaskDateKey(t) === dateKey);
    if (matches.length === 0) return undefined;
    if (matches.length === 1) return matches[0];
    matches.sort((a, b) => new Date(b.updated || 0) - new Date(a.updated || 0));
    return matches[0];
}

/**
 * Đồng bộ (bổ sung hoặc cập nhật) 1 Google Task cho ngày dateKey.
 *
 * KHÔNG nuốt lỗi — nếu tìm Task cũ hoặc gọi API thất bại, ném lỗi ra ngoài
 * để nơi gọi (schedule.js) biết và báo rõ cho người dùng.
 *
 * QUAN TRỌNG (bản vá mới nhất): khi CẬP NHẬT Task đã có, hệ thống chủ động
 * đọc lại "status" (và "completed" nếu có) của Task hiện tại rồi gửi kèm
 * trong resource cập nhật — đảm bảo KHÔNG bao giờ vô tình reset trạng thái
 * Hoàn thành của Task chỉ vì cập nhật lại Tiêu đề/Notes/Due.
 */
window.syncGoogleTask = async function (dateKey, taskName, notes) {
    if (!AppState.isLoggedIn) return;

    if (!gapi.client.tasks) {
        const msg = `gapi.client.tasks chưa sẵn sàng (Google Tasks API có thể chưa được Enable trong Google Cloud Console, hoặc token thiếu quyền "tasks")`;
        console.error(`[G-Portal] Không thể đồng bộ Task PCCV ngày ${dateKey}: ${msg}`);
        throw new Error(msg);
    }

    try {
        const dueISO = `${dateKey}T00:00:00.000Z`;
        const finalNotes = buildGportalTaskNotes(dateKey, notes);
        const existing = await findGoogleTaskByDate(dateKey);
        const taskBody = { title: taskName, notes: finalNotes, due: dueISO };

        if (existing) {
            // Giữ nguyên trạng thái Hoàn thành hiện có — tránh việc người dùng
            // phải tick "Hoàn thành" lại từ đầu mỗi khi hệ thống cập nhật lại
            // Tiêu đề/Notes/Due của Task.
            if (existing.status) taskBody.status = existing.status;
            if (existing.status === 'completed' && existing.completed) taskBody.completed = existing.completed;

            await withGoogleApiRetry(() => gapi.client.tasks.tasks.update({
                tasklist: '@default',
                task: existing.id,
                resource: { ...taskBody, id: existing.id }
            }), { label: `Cập nhật Task ngày ${dateKey}` });
        } else {
            await withGoogleApiRetry(() => gapi.client.tasks.tasks.insert({
                tasklist: '@default',
                resource: taskBody
            }), { label: `Tạo Task ngày ${dateKey}` });
        }
        console.log(`Đã đồng bộ Task PCCV ngày ${dateKey}.`);
    } catch (err) {
        console.error(`[G-Portal] Lỗi đồng bộ Google Task ngày ${dateKey}:`, err && err.result ? err.result.error : err);
        throw err;
    }
};

window.deleteGoogleTask = async function (dateKey) {
    if (!AppState.isLoggedIn) return;
    if (!gapi.client.tasks) return; // không có gì để xoá nếu Tasks API chưa sẵn sàng

    try {
        const existing = await findGoogleTaskByDate(dateKey);
        if (existing) {
            await withGoogleApiRetry(() => gapi.client.tasks.tasks.delete({ tasklist: '@default', task: existing.id }), { label: `Xoá Task ngày ${dateKey}` });
            console.log(`Đã xoá Task PCCV ngày ${dateKey}.`);
        }
    } catch (err) {
        console.error(`[G-Portal] Lỗi xoá Google Task ngày ${dateKey}:`, err && err.result ? err.result.error : err);
        throw err;
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
    const otCalendarId = getConfiguredCalendarId('ot');
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

    const otEvents = await findEventsByExtendedPropsInRange(timeMin, timeMax, otCalendarId, { gportalType: 'work-ot' });
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

    // FIX (bản vá mới nhất): lấy TOÀN BỘ Task rồi lọc theo thẻ nhận diện thay
    // vì nhờ Google lọc theo "due" — tránh bỏ sót Task đã hoàn thành/đã ẩn.
    const monthTasks = gapi.client.tasks ? await findAllGoogleTasks() : [];
    const googleTaskMap = {};
    monthTasks.forEach(t => {
        const dateKey = getTaskDateKey(t);
        if (!dateKey || dateKey < firstKey || dateKey > lastKey) return;
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

// ========================================================
// DỌN DẸP EVENT/TASK ĐÃ LỠ BỊ TẠO TRÙNG LẶP TỪ TRƯỚC KHI CÓ CÁC BẢN VÁ NÀY
// ========================================================
// Quét toàn bộ Event (Lịch chính + Lịch OT + Lịch họp) và Task PCCV trong 1
// tháng, gom nhóm theo "cùng ngày + cùng loại" (Event) hoặc "cùng ngày" (xác
// định qua thẻ nhận diện trong Notes, có fallback theo "due" cho Task cũ
// chưa có thẻ — xem getTaskDateKey()). Nếu 1 nhóm có nhiều hơn 1 mục, GIỮ
// LẠI 1 mục và xoá các mục còn lại.
//
// QUY TẮC CHỌN "GIỮ LẠI" (bản vá mới nhất, xem giải thích đầu file):
//  - Với EVENT (Lịch chính/OT/Họp): không có khái niệm "hoàn thành", vẫn xét
//    "updated" mới nhất như trước.
//  - Với TASK PCCV: nếu trong nhóm trùng có ÍT NHẤT 1 bản ĐÃ HOÀN THÀNH, thì
//    LUÔN ưu tiên GIỮ LẠI 1 trong số các bản đã hoàn thành đó (chọn bản
//    "updated" mới nhất trong nhóm đã hoàn thành nếu có nhiều hơn 1) — tuyệt
//    đối KHÔNG xoá mất Task mà người dùng đã tick Hoàn thành chỉ vì có 1 bản
//    trùng khác mới được cập nhật gần đây hơn. Chỉ khi CẢ NHÓM đều CHƯA hoàn
//    thành thì mới xét "updated" mới nhất như bình thường.
//    Sau khi dọn dẹp, nếu Tiêu đề/Notes của bản được giữ lại chưa khớp với
//    PCCV mới nhất trên Portal, chỉ cần bấm lưu lại ngày đó (hoặc "Đồng bộ
//    Google") — nhờ bản vá tìm-Task-theo-thẻ-nhận-diện, hệ thống sẽ CẬP NHẬT
//    đúng bản đang giữ lại (giữ nguyên trạng thái Hoàn thành), không tạo
//    thêm bản trùng nào nữa.
window.cleanupDuplicateGoogleData = async function (monthDate) {
    if (!AppState.isLoggedIn || !gapi.client) {
        return { removedEvents: 0, removedTasks: 0 };
    }

    const { firstKey, lastKey, timeMin, timeMax } = getMonthRangeISO(monthDate);
    const workCalendarId = getConfiguredCalendarId('work');
    const otCalendarId = getConfiguredCalendarId('ot');
    const meetingCalendarId = getConfiguredCalendarId('meeting');

    let removedEvents = 0;
    let removedTasks = 0;

    async function cleanupEventGroup(calendarId, propFilters, groupKeyFn) {
        const events = await findEventsByExtendedPropsInRange(timeMin, timeMax, calendarId, propFilters);
        const groups = {};
        events.forEach(ev => {
            const key = groupKeyFn(ev);
            if (!key) return;
            if (!groups[key]) groups[key] = [];
            groups[key].push(ev);
        });

        for (const key of Object.keys(groups)) {
            const group = groups[key];
            if (group.length <= 1) continue;
            // Giữ lại bản có "updated" mới nhất (thường là bản đúng/mới nhất),
            // xoá các bản còn lại.
            group.sort((a, b) => new Date(b.updated || 0) - new Date(a.updated || 0));
            const toRemove = group.slice(1);
            for (const ev of toRemove) {
                await withGoogleApiRetry(() => gapi.client.calendar.events.delete({ calendarId, eventId: ev.id }), { label: 'Dọn dẹp Event trùng lặp' });
                removedEvents++;
                await window.gportalSleep(80);
            }
        }
    }

    await cleanupEventGroup(workCalendarId, { gportalType: 'work' }, ev => eventDateKey(ev));
    await cleanupEventGroup(otCalendarId, { gportalType: 'work-ot' }, ev => eventDateKey(ev));
    await cleanupEventGroup(meetingCalendarId, { gportalType: 'meeting' }, ev => {
        const meetingId = ev.extendedProperties && ev.extendedProperties.private ? ev.extendedProperties.private.gportalMeetingId : null;
        return meetingId; // gom theo đúng 1 lịch họp (id) — họp khác ngày khác id nên không lẫn nhau
    });

    if (gapi.client.tasks) {
        // FIX (bản vá mới nhất): lấy TOÀN BỘ Task rồi gom nhóm theo thẻ nhận
        // diện/ due — thay vì nhờ Google lọc theo due (không đáng tin cậy với
        // Task đã hoàn thành/ẩn, xem giải thích đầu file).
        const allTasks = await findAllGoogleTasks();
        const taskGroups = {};
        allTasks.forEach(t => {
            const dateKey = getTaskDateKey(t);
            if (!dateKey || dateKey < firstKey || dateKey > lastKey) return;
            if (!taskGroups[dateKey]) taskGroups[dateKey] = [];
            taskGroups[dateKey].push(t);
        });

        for (const dateKey of Object.keys(taskGroups)) {
            const group = taskGroups[dateKey];
            if (group.length <= 1) continue;

            // Quy tắc mới: nếu có bản ĐÃ HOÀN THÀNH trong nhóm, ưu tiên tuyệt
            // đối giữ lại 1 bản trong số đó (không để "updated" của bản chưa
            // hoàn thành lấn át). Chỉ khi cả nhóm đều chưa hoàn thành mới xét
            // "updated" mới nhất như bình thường.
            const completedOnes = group.filter(t => t.status === 'completed');
            const preferredPool = completedOnes.length > 0 ? completedOnes : group;
            preferredPool.sort((a, b) => new Date(b.updated || 0) - new Date(a.updated || 0));
            const keepId = preferredPool[0].id;

            const toRemove = group.filter(t => t.id !== keepId);
            for (const t of toRemove) {
                await withGoogleApiRetry(() => gapi.client.tasks.tasks.delete({ tasklist: '@default', task: t.id }), { label: 'Dọn dẹp Task trùng lặp' });
                removedTasks++;
                await window.gportalSleep(80);
            }
        }
    }

    return { removedEvents, removedTasks };
};

// LƯU Ý QUAN TRỌNG: KHÔNG được gán window.findGoogleTaskByDate bằng một hàm
// "wrapper" gọi lại tên trần findGoogleTaskByDate(...) bên trong nó. Đây là
// script thường (không phải module) nên "function findGoogleTaskByDate(...)"
// khai báo ở trên CHÍNH LÀ window.findGoogleTaskByDate — nếu gán đè
// window.findGoogleTaskByDate bằng 1 wrapper gọi lại tên trần đó, từ lúc đó
// trở đi tên trần findGoogleTaskByDate sẽ luôn trỏ về đúng cái wrapper (vì
// việc phân giải tên trần tra cứu qua thuộc tính window tại THỜI ĐIỂM GỌI,
// không phải tại thời điểm khai báo) -> wrapper tự gọi lại chính nó vô hạn
// -> "Maximum call stack size exceeded". Cách sửa AN TOÀN: export thẳng
// tham chiếu tới hàm gốc, không bọc thêm 1 lớp gọi lại tên trần.
window.findGoogleTaskByDate = findGoogleTaskByDate;

/**
 * googleSync.js - Google Auth + Drive + Calendar + Tasks
 *
 * ============================================================================
 * BẢN VÁ MỚI NHẤT (ƯU TIÊN CAO) — VẪN CÒN "DOUBLE TASK" KHI LƯU TỪNG NGÀY +
 * "DỌN DẸP TRÙNG LẶP" XÓA NHẦM TASK ĐÃ HOÀN TẤT
 * ============================================================================
 * TRIỆU CHỨNG (báo cáo thực tế): Cập nhật Lịch (Event) trước, sau đó bổ sung
 * Task PCCV cho cùng ngày đó -> Task vẫn bị tạo trùng lặp (1 bản đã hoàn tất/
 * cũ + 1 bản mới trống). Bấm "Dọn dẹp trùng lặp" thì hệ thống lại xóa đúng
 * bản Task đã hoàn tất (có ý nghĩa, đã được tick xong việc thật) và giữ lại
 * bản trống (do lỗi tạo trùng trước đó) — ngược hoàn toàn với mong muốn.
 *
 * NGUYÊN NHÂN GỐC RỄ #1 (double khi lưu từng ngày):
 * findGoogleTaskByDate() — hàm quyết định "ngày này đã có Task trên Google
 * Tasks hay chưa" khi lưu 1 ngày qua syncGoogleTask() — trước đây dùng cửa
 * sổ tìm kiếm ĐÚNG BẰNG 1 NGÀY:
 *      dueMin = `${dateKey}T00:00:00.000Z`
 *      dueMax = `${dateKey}T23:59:59.999Z`
 * Task do chính hệ thống tạo cũng có due = `${dateKey}T00:00:00.000Z`, tức
 * NẰM ĐÚNG TRÊN BIÊN dueMin. Trong thực tế, Google Tasks API xử lý biên
 * dueMin/dueMax không ổn định với các Task đã hoàn tất/đã ẩn khi cửa sổ lọc
 * quá sát biên — nhiều trường hợp Task cũ (đã hoàn tất) tồn tại thật trên
 * Google nhưng lệnh tasks.list() với cửa sổ hẹp này không trả về. Hệ thống
 * hiểu nhầm "ngày này chưa có Task" -> INSERT Task MỚI -> double, dù bước
 * đồng bộ Lịch (Event) ngay trước đó không hề gặp lỗi gì.
 * Lưu ý: reconcileMonthWithGoogle() và cleanupDuplicateGoogleData() vốn dùng
 * cửa sổ CẢ THÁNG (rộng hơn nhiều) nên ít dính lỗi này hơn — đây là lý do
 * "Kiểm tra đồng bộ" / "Dọn dẹp trùng lặp" thường nhìn thấy đúng Task, còn
 * lưu từng ngày (saveDayEdit) lại hay bị sót.
 *
 * FIX #1: findGoogleTaskByDate() giờ nới khoảng tìm kiếm ra thêm 1 ngày mỗi
 * bên (từ 00:00 hôm TRƯỚC đến 23:59:59.999 hôm SAU), rồi lọc lại CHÍNH XÁC
 * theo dateKey ở phía client (t.due.substring(0,10) === dateKey). Nhờ vậy
 * tránh đúng cái biên hay gây lỗi phía Google, mà vẫn không thể nhận nhầm
 * Task của ngày khác (vì đã lọc lại chính xác sau khi lấy về).
 *
 * NGUYÊN NHÂN GỐC RỄ #2 ("Dọn dẹp" xóa nhầm Task đã hoàn tất):
 * Trong cleanupDuplicateGoogleData(), khi 1 nhóm Task trùng ngày có nhiều
 * hơn 1 bản, code cũ CHỦ ĐỘNG ưu tiên giữ lại bản CHƯA hoàn tất:
 *      const notCompleted = group.filter(t => t.status !== 'completed');
 *      const preferredList = notCompleted.length > 0 ? notCompleted : group;
 * Hậu quả: nếu nhóm trùng gồm 1 bản đã tick hoàn tất (dữ liệu thật, có ý
 * nghĩa công việc đã xử lý xong) và 1 bản trống mới bị tạo lỗi (chưa hoàn
 * tất), hệ thống luôn XÓA bản đã hoàn tất và GIỮ bản trống — làm mất lịch
 * sử xử lý thật của người dùng.
 *
 * FIX #2: Bỏ hẳn việc ưu tiên theo trạng thái hoàn tất. Trong mỗi nhóm Task
 * trùng, chỉ xét "updated" (thời điểm cập nhật gần nhất) để quyết định giữ
 * lại — không thiên vị completed hay chưa completed nữa.
 * ============================================================================
 *
 * (Giữ nguyên toàn bộ các bản vá trước đó — xem chi tiết đầy đủ bên dưới:
 * lỗi "double Event/Task" do nuốt lỗi xoá sự kiện cũ, cơ chế retry +
 * exponential backoff, nút "Dọn dẹp trùng lặp", polling gapi/gis, gapi.client
 * init lỗi âm thầm, isLoggedIn set đồng bộ, logout bọc try/catch/finally,
 * cảnh báo file://, cấu hình Calendar ID từ Cài đặt, xác định sự kiện
 * G-Portal qua extendedProperties.private, lấy hồ sơ Google dùng chung toàn
 * app, giữ đăng nhập qua silent SSO, tách lịch OT riêng, đồng bộ ngược
 * "Kiểm tra đồng bộ", fix đệ quy vô hạn findGoogleTaskByDate, và bản vá
 * showCompleted/showHidden = true cho toàn bộ truy vấn Task...)
 * ============================================================================
 *
 * ============================================================================
 * BẢN VÁ TRƯỚC ĐÓ — LỖI "DOUBLE EVENT + TASK" (Event/Task bị nhân đôi)
 * ============================================================================
 * TRIỆU CHỨNG: Những ngày đã có sẵn Event/Task trên Google, khi người dùng
 * bổ sung thêm nội dung (thêm ngày mới, sửa ngày khác) rồi bấm "Đồng bộ
 * Google" (đồng bộ lại NGUYÊN THÁNG), các ngày CŨ vốn không hề thay đổi gì
 * cũng bị tạo thêm 1 Event/Task trùng lặp trên Google Calendar/Tasks.
 *
 * NGUYÊN NHÂN GỐC RỄ: Toàn bộ luồng đồng bộ 1 ngày luôn theo mô hình
 * "XOÁ SỰ KIỆN CŨ (theo extendedProperties) RỒI TẠO MỚI". Nhưng 2 hàm dùng
 * để tìm/xoá sự kiện cũ (findEventsByExtendedPropsInRange và
 * deleteCalendarEventsByProps) trước đây tự bọc try/catch và chỉ
 * console.error() — nuốt lỗi hoàn toàn, không báo ra ngoài:
 *   - Nếu gapi.client.calendar.events.list() thất bại giữa chừng (403/429
 *     rate-limit do Google giới hạn số request/giây, lỗi mạng tạm thời...),
 *     hàm coi như "không tìm thấy sự kiện nào cần xoá" (trả về mảng RỖNG)
 *     dù thực ra sự kiện cũ vẫn còn nguyên trên Calendar.
 *   - Nếu gapi.client.calendar.events.delete() thất bại, lỗi cũng bị nuốt
 *     tương tự.
 * Trong khi đó syncCalendarEvent()/syncOtCalendarEvent() ở BƯỚC SAU luôn vô
 * điều kiện gọi events.insert() để tạo sự kiện mới, KHÔNG hề biết bước xoá
 * phía trên đã thất bại. Kết quả: sự kiện CŨ (chưa xoá được) + sự kiện MỚI
 * (vừa tạo) => XUẤT HIỆN 2 sự kiện cho cùng 1 ngày.
 *
 * FIX ÁP DỤNG:
 *  1) Bỏ HOÀN TOÀN các try/catch nuốt lỗi ở findEventsByExtendedPropsInRange
 *     và deleteCalendarEventsByProps — để lỗi được NÉM RA NGOÀI (throw).
 *  2) syncCalendarEvent() / syncOtCalendarEvent() / syncMeetingCalendarEvent()
 *     giờ KHÔNG còn tự bọc try/catch quanh bước insert nữa — nếu bước xoá
 *     (hoặc tạo) thất bại, lỗi sẽ ném ra cho nơi gọi (schedule.js) xử lý —
 *     đúng nguyên tắc "im lặng nuốt lỗi là nguồn gốc mọi bug ẩn, phải luôn
 *     ném lỗi ra để nơi gọi biết và báo cho người dùng". Quan trọng nhất:
 *     NẾU XOÁ THẤT BẠI THÌ KHÔNG ĐƯỢC TẠO MỚI.
 *  3) Thêm cơ chế TỰ THỬ LẠI (retry + exponential backoff) cho các lệnh gọi
 *     Calendar API hay gặp lỗi tạm thời (429/403 rate-limit, 500/503) — xem
 *     hàm withGoogleApiRetry().
 *  4) window.cleanupDuplicateGoogleData(monthDate) — hàm quét và DỌN DẸP
 *     các Event/Task đã lỡ bị tạo trùng lặp TỪ TRƯỚC KHI CÓ BẢN VÁ NÀY. Với
 *     mỗi nhóm (cùng ngày + cùng loại) có nhiều hơn 1 mục, hàm giữ lại đúng
 *     1 bản (bản có "updated" mới nhất) và xoá các bản còn lại. Được gắn
 *     vào nút "Dọn dẹp trùng lặp" trên giao diện Lịch làm việc.
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
// TIỆN ÍCH MỚI: gọi API Google kèm TỰ ĐỘNG THỬ LẠI khi gặp lỗi tạm thời
// (429 rate-limit, 403 rateLimitExceeded/userRateLimitExceeded, 500, 503).
// Đây là một trong các mảnh ghép giúp triệt tiêu lỗi "double Event/Task":
// giảm mạnh khả năng bước xoá sự kiện cũ bị thất bại giữa chừng chỉ vì
// Google tạm thời giới hạn tốc độ gọi API.
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
        // "PCCV không lên Google Tasks" ngay từ gốc (thay vì chỉ biết khi
        // bấm Đồng bộ Google) và ghi rõ log để dễ dò khi báo lỗi.
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

// ---------- TASK PCCV ----------
// showCompleted/showHidden = true để không "mù" trước các Task đã tick hoàn
// tất hoặc đã bị ẩn trên Google Tasks (xem ghi chú đầu file).
async function findGoogleTasksInRange(dueMin, dueMax) {
    let items = [];
    let pageToken;
    do {
        const listRes = await withGoogleApiRetry(() => gapi.client.tasks.tasks.list({
            tasklist: '@default',
            showCompleted: true,
            showHidden: true,
            dueMin: dueMin,
            dueMax: dueMax,
            maxResults: 100,
            pageToken: pageToken
        }), { label: 'Tìm Google Tasks theo khoảng ngày' });
        items = items.concat(listRes.result.items || []);
        pageToken = listRes.result.nextPageToken;
    } while (pageToken);
    return items;
}

/**
 * FIX MỚI (xem ghi chú đầu file, mục "NGUYÊN NHÂN GỐC RỄ #1"): trước đây
 * hàm này tìm Task cũ bằng cửa sổ ĐÚNG BẰNG 1 NGÀY (dueMin = dueMax = đúng
 * giá trị "due" mà hệ thống từng ghi khi tạo Task cho ngày này) — tức nằm
 * SÁT BIÊN dueMin. Với các Task đã hoàn tất/đã ẩn, việc lọc dueMin/dueMax
 * của Google Tasks API không ổn định ở đúng biên này, khiến Task cũ có
 * thật nhưng không được trả về -> hệ thống tạo Task MỚI -> double.
 *
 * Cách sửa: NỚI RỘNG cửa sổ tìm kiếm ra 1 ngày mỗi bên (hôm trước 00:00 ->
 * hôm sau 23:59:59.999), rồi LỌC LẠI CHÍNH XÁC theo đúng dateKey ở phía
 * client. Nới cửa sổ tránh được lỗi biên phía Google, còn lọc lại chính xác
 * đảm bảo không bao giờ nhận nhầm Task của ngày liền kề.
 */
async function findGoogleTaskByDate(dateKey) {
    const prevDayKey = addDaysToDateKey(dateKey, -1);
    const nextDayKey = addDaysToDateKey(dateKey, 1);
    const dueMin = `${prevDayKey}T00:00:00.000Z`;
    const dueMax = `${nextDayKey}T23:59:59.999Z`;
    const items = await findGoogleTasksInRange(dueMin, dueMax);
    return items.find(t => t.due && t.due.substring(0, 10) === dateKey);
}

/**
 * Đồng bộ (bổ sung hoặc cập nhật) 1 Google Task cho ngày dateKey.
 *
 * Giữ nguyên nguyên tắc đã áp dụng từ trước: KHÔNG nuốt lỗi — nếu tìm Task
 * cũ hoặc gọi API thất bại, ném lỗi ra ngoài để nơi gọi (schedule.js) biết
 * và báo rõ cho người dùng, tránh tình trạng "chạy xong" một cách im lặng
 * dù Task thực ra chưa lên/chưa cập nhật đúng.
 *
 * Nhờ findGoogleTaskByDate() giờ nới rộng cửa sổ tìm kiếm và nhìn thấy cả
 * Task đã hoàn tất/đã ẩn, bước "existing" bên dưới sẽ tìm đúng Task cũ (nếu
 * có) để UPDATE — kể cả khi Task đó đã được người dùng tick hoàn tất trên
 * Google Tasks — thay vì tạo thêm 1 Task mới chồng lên. gapi.client.tasks
 * .tasks.update() hỗ trợ patch semantics (chỉ áp field được truyền:
 * title/notes/due), nên KHÔNG làm mất trạng thái hoàn tất đã có của Task.
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
        const existing = await findGoogleTaskByDate(dateKey);
        const taskBody = { title: taskName, notes: notes || '', due: dueISO };

        if (existing) {
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

    const dueMin = `${firstKey}T00:00:00.000Z`;
    const dueMax = `${lastKey}T23:59:59.999Z`;
    const monthTasks = gapi.client.tasks ? await findGoogleTasksInRange(dueMin, dueMax) : [];
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

// ========================================================
// DỌN DẸP EVENT/TASK ĐÃ LỠ BỊ TẠO TRÙNG LẶP TỪ TRƯỚC KHI CÓ CÁC BẢN VÁ NÀY
// ========================================================
// Quét toàn bộ Event (Lịch chính + Lịch OT + Lịch họp) và Task PCCV trong 1
// tháng, gom nhóm theo "cùng ngày + cùng loại" (Event) hoặc "cùng ngày due"
// (Task); nếu 1 nhóm có nhiều hơn 1 mục, GIỮ LẠI mục có thời điểm cập nhật
// (updated) MỚI NHẤT và xoá các mục còn lại.
//
// FIX MỚI (xem ghi chú đầu file, mục "NGUYÊN NHÂN GỐC RỄ #2"): trước đây,
// khi gom nhóm Task trùng, hàm này CHỦ ĐỘNG ưu tiên giữ lại Task CHƯA hoàn
// tất (loại bỏ Task đã hoàn tất khỏi danh sách ứng viên được giữ nếu còn ít
// nhất 1 Task chưa hoàn tất trong nhóm). Hậu quả: Task đã hoàn tất (dữ liệu
// thật, có ý nghĩa) bị XOÁ, còn Task trống do lỗi tạo trùng lại được GIỮ —
// ngược hoàn toàn với ý muốn của người dùng, gây mất lịch sử xử lý.
// Nay đã bỏ hẳn việc thiên vị theo trạng thái hoàn tất: chỉ còn xét đúng 1
// tiêu chí duy nhất là "updated" mới nhất trong toàn bộ nhóm, bất kể Task đó
// đã hoàn tất hay chưa.
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
        const dueMin = `${firstKey}T00:00:00.000Z`;
        const dueMax = `${lastKey}T23:59:59.999Z`;
        const tasks = await findGoogleTasksInRange(dueMin, dueMax);
        const taskGroups = {};
        tasks.forEach(t => {
            if (!t.due) return;
            const dateKey = t.due.substring(0, 10);
            if (!taskGroups[dateKey]) taskGroups[dateKey] = [];
            taskGroups[dateKey].push(t);
        });

        for (const dateKey of Object.keys(taskGroups)) {
            const group = taskGroups[dateKey];
            if (group.length <= 1) continue;
            // KHÔNG còn thiên vị theo trạng thái hoàn tất (status). Chỉ xét
            // "updated" mới nhất trong TOÀN BỘ nhóm để chọn bản giữ lại — nhờ
            // vậy Task đã hoàn tất không còn bị xoá oan chỉ vì nó "đã xong".
            group.sort((a, b) => new Date(b.updated || 0) - new Date(a.updated || 0));
            const keepId = group[0].id;
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

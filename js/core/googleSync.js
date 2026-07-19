/**
 * googleSync.js - Google Auth + Drive + Calendar + Tasks
 *
 * BẢN VÁ LỖI ĐỒNG BỘ (mới nhất) — 3 thay đổi chính so với bản trước:
 * -------------------------------------------------------------------------
 * 1) FIX "Task bị double khi update lịch cho ngày/tuần mới":
 *    Nguyên nhân: findGoogleTaskByDate() cũ lấy tối đa 100 Task (không lọc
 *    theo ngày ở phía Google) rồi mới lọc bằng JS ở client. Khi tasklist
 *    '@default' đã tích lũy nhiều tháng (>100 task), các Task cũ/tháng
 *    trước có thể KHÔNG nằm trong 100 kết quả đầu tiên trả về (Google Tasks
 *    API không sắp xếp theo ngày due mà theo "position" hiển thị) -> hệ
 *    thống tưởng ngày đó CHƯA có Task -> tạo Task MỚI đè lên -> bị double.
 *    Cách sửa: dùng tham số dueMin/dueMax mà Google Tasks API hỗ trợ sẵn để
 *    lọc NGAY TẠI SERVER theo đúng ngày cần tìm (và có phân trang đầy đủ
 *    phòng trường hợp hi hữu vẫn còn nhiều task cùng ngày), thay vì lấy 100
 *    task bất kỳ rồi lọc tay. Nhờ vậy luôn tìm đúng Task hiện có của ngày
 *    đó, không tạo trùng.
 *
 * 2) FIX "Ca đêm (VD 21:30 hôm nay -> 07:30 sáng hôm sau) không lên lịch
 *    đúng": syncCalendarEvent() cũ gán CẢ giờ bắt đầu lẫn giờ kết thúc vào
 *    chung một dateStr, nên khi giờ kết thúc nhỏ hơn giờ bắt đầu (ca qua
 *    đêm) sẽ tạo ra event có end < start (Google Calendar không hiển thị
 *    đúng khoảng thời gian, có ca thậm chí bị bỏ qua). Cách sửa: nếu giờ
 *    kết thúc <= giờ bắt đầu, tự động cộng thêm 1 ngày cho phần NGÀY của
 *    thời điểm kết thúc.
 *
 * 3) MỚI: "Kiểm tra đồng bộ" (đồng bộ ngược Google -> Portal). Trước đây hệ
 *    thống chỉ đẩy dữ liệu MỘT CHIỀU Portal -> Google. Nếu người dùng sửa
 *    hoặc xóa trực tiếp trên Google Calendar/Google Tasks, Portal (và dữ
 *    liệu lưu trên Drive) không hề hay biết, dẫn đến lệch dữ liệu. Hàm mới
 *    window.reconcileMonthWithGoogle(monthDate) sẽ đọc lại toàn bộ sự kiện
 *    Lịch làm việc (gportalType=work), Lịch họp (gportalType=meeting) và
 *    Google Tasks trong đúng tháng đang xem, "dịch ngược" tiêu đề/mô tả sự
 *    kiện về lại cấu trúc dữ liệu của Portal, rồi so sánh với dữ liệu hiện
 *    có: ngày/lịch họp nào bị xóa trên Google -> xóa khỏi Portal; ngày/lịch
 *    họp nào bị sửa trên Google -> cập nhật lại Portal cho khớp. Sau khi
 *    gọi hàm này, phía gọi (schedule.js) chịu trách nhiệm lưu lại lên Drive
 *    và render lại giao diện.
 *
 * (Giữ nguyên toàn bộ các fix trước đó: polling gapi/gis, gapi.client.init
 * lỗi âm thầm, isLoggedIn set đồng bộ, logout bọc try/catch/finally, cảnh
 * báo file://, cấu hình Calendar ID từ Cài đặt, làm mới token ngầm trước
 * khi hết hạn, xác định sự kiện G-Portal qua extendedProperties.private,
 * lấy hồ sơ Google (tên/email) dùng chung cho toàn app...)
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

let tokenClient;
let gapiInited = false;
let gisInited = false;
let gapiLoadRequested = false;
let tokenRefreshTimerId = null;
let silentRestoreAttempted = false;
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
// 2. LÀM MỚI TOKEN NGẦM
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
        tokenClient.requestAccessToken({ prompt: '' });
    }, delayMs);
}

function clearScheduledTokenRefresh() {
    if (tokenRefreshTimerId) {
        clearTimeout(tokenRefreshTimerId);
        tokenRefreshTimerId = null;
    }
}

function initGoogleAuth() {
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: (tokenResponse) => {
            if (tokenResponse && tokenResponse.access_token) {
                const expiresIn = tokenResponse.expires_in || 3600;
                const expiryTime = Date.now() + (expiresIn * 1000);
                localStorage.setItem('gapi_token', JSON.stringify(tokenResponse));
                localStorage.setItem('gapi_token_expiry', String(expiryTime));
                if (gapi.client) gapi.client.setToken(tokenResponse);

                AppState.isLoggedIn = true;
                if (typeof window.showApp === 'function') window.showApp();

                scheduleTokenRefresh(expiresIn);
                fetchUserProfile(tokenResponse.access_token);
                loadAllDataFromDrive();
            } else {
                setLoginStatus('Đăng nhập thất bại hoặc bị huỷ. Vui lòng thử lại.', true);
            }
        },
        error_callback: (err) => {
            console.error('[G-Portal Auth] OAuth error_callback:', err);
            const type = err && err.type ? err.type : 'unknown';

            if (type === 'popup_failed_to_open' || type === 'popup_closed') {
                setLoginStatus('');
                return;
            }

            let msg = `Đăng nhập bị gián đoạn (${type}).`;
            msg += ' Nếu đang ở chế độ Ẩn danh/Riêng tư, hãy bật "Cho phép cookie bên thứ 3" (Allow third-party cookies) cho accounts.google.com, hoặc dùng cửa sổ trình duyệt thông thường — Google Identity Services thường không hoạt động đầy đủ khi cookie bên thứ 3 bị chặn.';
            setLoginStatus(msg, true);
        }
    });

    const savedTokenStr = localStorage.getItem('gapi_token');
    const savedExpiry = parseInt(localStorage.getItem('gapi_token_expiry') || '0', 10);

    if (savedTokenStr && Date.now() < savedExpiry) {
        try {
            const savedToken = JSON.parse(savedTokenStr);
            if (gapi.client) {
                gapi.client.setToken(savedToken);
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
            if (typeof window.showLogin === 'function') window.showLogin();
        }
    } else if (savedTokenStr) {
        localStorage.removeItem('gapi_token');
        localStorage.removeItem('gapi_token_expiry');
        AppState.isLoggedIn = false;
        if (typeof window.showLogin === 'function') window.showLogin('Đang khôi phục phiên đăng nhập trước đó...');

        if (!silentRestoreAttempted) {
            silentRestoreAttempted = true;
            tokenClient.requestAccessToken({ prompt: '' });
        }
    }
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

// ---------- MỚI — TĂNG CƯỜNG (OT) LÀ SỰ KIỆN LỊCH RIÊNG ----------
// Trước đây khi một ngày vừa có CA CHÍNH vừa có TĂNG CƯỜNG (OT), hệ thống chỉ
// tạo DUY NHẤT một sự kiện Lịch dùng khung giờ của ca chính; thông tin OT chỉ
// được ghi chú dạng chữ trong mô tả (description), KHÔNG có khung giờ riêng
// trên Calendar. Với những ca mà khung giờ OT tách biệt / không liền kề với
// ca chính (VD: Ca chính C2 14:45-22:00, OT T+ 11:00-14:00) thì OT hoàn toàn
// không xuất hiện trên Google Calendar.
// Nay: mỗi khi CÙNG LÚC có ca chính + OT, hệ thống tạo THÊM một sự kiện Lịch
// thứ hai, dùng đúng khung giờ cấu hình của mã OT đó, đánh dấu riêng bằng
// extendedProperties.private.gportalType = 'work-ot' để không lẫn với sự
// kiện ca chính (gportalType = 'work') khi tìm/xoá/cập nhật.
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

    // Cùng nguyên tắc "qua đêm" như ca chính: nếu giờ kết thúc <= giờ bắt đầu
    // thì khung giờ OT kết thúc vào ngày hôm sau.
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

// Đồng bộ Lịch họp cũng được vá theo cùng nguyên tắc "qua đêm" (an toàn nếu về
// sau có lịch họp thâu đêm), dù trường hợp phổ biến vẫn là họp trong ngày.
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

// ---------- FIX #1 — TASK BỊ DOUBLE ----------
// Trước đây: lấy tối đa 100 task bất kỳ (không lọc theo ngày ở server) rồi lọc
// tay theo due date -> khi tasklist có nhiều tháng dữ liệu, task của ngày cần
// tìm có thể không nằm trong 100 kết quả đầu -> tưởng chưa có -> tạo trùng.
// Giờ dùng thẳng dueMin/dueMax mà Google Tasks API hỗ trợ để lọc CHÍNH XÁC
// theo ngày ngay tại server, có phân trang đầy đủ để không bỏ sót.
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
// MỚI — ĐỒNG BỘ NGƯỢC: đọc lại Google Calendar/Tasks để khớp lại Portal
// ========================================================
// Các hàm "parse" dưới đây đọc ngược đúng định dạng do buildShiftEventTitle /
// syncCalendarEvent / syncMeetingCalendarEvent tạo ra ở trên, nên chỉ áp dụng
// đúng cho sự kiện do chính G-Portal tạo (đã gắn extendedProperties.private).

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

// Đọc ngược tiêu đề sự kiện OT riêng do buildOtEventTitle() tạo ra
// (dạng "{otCode} - Tăng cường (OT)") để lấy lại mã ca tăng cường.
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

/**
 * Đọc lại Google Calendar (Lịch làm + Lịch họp) và Google Tasks trong ĐÚNG
 * tháng của `monthDate`, so sánh với window.monthlyScheduleData /
 * window.monthlyMeetingsData hiện có, rồi cập nhật lại cho khớp:
 *  - Có trên Google nhưng khác/chưa có ở Portal -> cập nhật Portal theo Google.
 *  - Có ở Portal (trong phạm vi tháng) nhưng KHÔNG còn trên Google (đã bị xoá
 *    hoặc sửa mất) -> xoá khỏi Portal.
 * Hàm KHÔNG tự lưu Drive / render lại UI — nơi gọi (schedule.js) tự xử lý
 * sau khi nhận kết quả trả về.
 */
window.reconcileMonthWithGoogle = async function (monthDate) {
    if (!AppState.isLoggedIn || !gapi.client) {
        return { changed: false, changedSchedule: false, changedMeeting: false };
    }

    const { firstKey, lastKey, timeMin, timeMax } = getMonthRangeISO(monthDate);
    const workCalendarId = getConfiguredCalendarId('work');
    const meetingCalendarId = getConfiguredCalendarId('meeting');

    let changedSchedule = false;
    let changedMeeting = false;

    // ---------- 1. LỊCH LÀM VIỆC (ca chính) ----------
    const workEvents = await findEventsByExtendedPropsInRange(timeMin, timeMax, workCalendarId, { gportalType: 'work' });
    const googleScheduleMap = {};
    workEvents.forEach(ev => {
        const dateKey = eventDateKey(ev);
        if (!dateKey) return;
        const parsedTitle = parseShiftEventTitle(ev.summary);
        googleScheduleMap[dateKey] = {
            type: parsedTitle.type,
            shift: parsedTitle.shiftPart || 'OFF',
            // OT không còn lấy từ text mô tả (dễ lỗi thời) — sẽ được gán lại
            // ở bước 1b dựa trên sự kiện Lịch OT riêng (gportalType=work-ot),
            // nguồn xác thực chính xác nhất kể từ khi OT có sự kiện riêng.
            ot: '',
            task: '',
            trade: parsedTitle.type === 'doica' ? parsedTitle.trade : '',
            help: parsedTitle.type === 'trucho' ? parsedTitle.help : ''
        };
    });

    // ---------- 1b. SỰ KIỆN TĂNG CƯỜNG (OT) RIÊNG ----------
    // Chỉ áp dụng cho những ngày VỪA CÓ ca chính VỪA CÓ OT (lúc đó OT được tạo
    // thành 1 sự kiện Lịch độc lập, gportalType=work-ot). Trường hợp OT-đơn
    // (không có ca chính) vẫn nằm gọn trong 1 sự kiện gportalType=work như cũ
    // (shiftPart của event đó chính là mã OT), nên không cần xử lý thêm ở đây.
    const otEvents = await findEventsByExtendedPropsInRange(timeMin, timeMax, workCalendarId, { gportalType: 'work-ot' });
    otEvents.forEach(ev => {
        const dateKey = eventDateKey(ev);
        if (!dateKey) return;
        const otCode = parseOtEventTitle(ev.summary);
        if (!otCode) return;
        if (googleScheduleMap[dateKey]) {
            googleScheduleMap[dateKey].ot = otCode;
        } else {
            // Hi hữu: có sự kiện OT riêng nhưng không tìm thấy sự kiện ca
            // chính tương ứng (VD người dùng lỡ xoá nhầm event ca chính) ->
            // vẫn giữ lại thông tin OT dưới dạng "chỉ có OT".
            googleScheduleMap[dateKey] = { type: 'chinhchu', shift: 'OFF', ot: otCode, task: '', trade: '', help: '' };
        }
    });

    // ---------- 2. TASKS PCCV trong tháng (nguồn chính xác nhất cho PCCV) ----------
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
    // Ngày có Task trên Google nhưng không có event Lịch tương ứng (VD người
    // dùng lỡ xoá nhầm event Lịch nhưng Task vẫn còn) -> vẫn giữ lại PCCV.
    Object.keys(googleTaskMap).forEach(dateKey => {
        if (dateKey >= firstKey && dateKey <= lastKey && !googleScheduleMap[dateKey]) {
            googleScheduleMap[dateKey] = { type: 'chinhchu', shift: 'OFF', ot: '', task: googleTaskMap[dateKey], trade: '', help: '' };
        }
    });

    // ---------- 3. So sánh & ghi đè lại monthlyScheduleData trong phạm vi tháng ----------
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

    // ---------- 4. LỊCH HỌP ----------
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

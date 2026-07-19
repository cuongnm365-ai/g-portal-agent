/**
 * googleSync.js - Google Auth + Drive + Calendar + Tasks
 *
 * BẢN GỘP EMAIL-TEMPLATE-TOOL VÀO G-PORTAL — THAY ĐỔI MỚI NHẤT:
 * -------------------------------------------------------------------------
 * 1) Bổ sung 2 scope 'openid email profile' vào SCOPES. Trước đây G-Portal
 *    chỉ xin quyền Drive/Calendar/Tasks, không có cách nào biết được người
 *    đang đăng nhập tên gì / email gì (không hiển thị ở đâu trên UI cả).
 *    Module "Soạn Email" (gộp từ email-template-tool) trước đây dùng MỘT
 *    hệ thống đăng nhập Google RIÊNG (Google Identity Services / One-Tap,
 *    file JS/google-auth.js cũ) chỉ để lấy tên/email hiển thị và gửi kèm
 *    khi ghi nhận thống kê sử dụng mẫu email — hệ thống đó đã bị loại bỏ
 *    hoàn toàn để chỉ còn DUY NHẤT một lượt đăng nhập Google cho toàn bộ
 *    ứng dụng (đúng yêu cầu gộp chung).
 * 2) Thêm fetchUserProfile(accessToken): gọi endpoint chuẩn của Google
 *    (openid userinfo) để lấy {name, email, picture}, lưu vào
 *    AppState.userProfile và localStorage 'gportal_user_profile' (cache để
 *    hiển thị ngay cả trước khi mạng phản hồi ở lần load lại trang).
 *    Đồng thời cập nhật badge người dùng ở góc phải Header
 *    (#user-profile-box, có sẵn trong index.html nhưng trước đây bỏ trống)
 *    và bắn sự kiện 'gportal_profile_ready' để các module khác (VD: module
 *    Soạn Email) có thể lắng nghe và tự làm mới tên Agent nếu cần.
 * 3) engine.js (module Soạn Email) giờ đọc AppState.userProfile thay vì
 *    authManager.user như bản cũ.
 *
 * (Giữ nguyên toàn bộ các fix trước đó: polling gapi/gis, gapi.client.init
 * lỗi âm thầm, isLoggedIn set đồng bộ, logout bọc try/catch/finally, cảnh
 * báo file://, cấu hình Calendar ID từ Cài đặt, làm mới token ngầm trước
 * khi hết hạn, xác định sự kiện G-Portal qua extendedProperties.private...)
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

// MỚI: thêm 'openid email profile' để lấy được tên/email người dùng (dùng cho
// badge Header + module Soạn Email), không cần hệ thống đăng nhập Google riêng nữa.
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

async function findEventsByExtendedProps(dateStr, calendarId, propFilters) {
    const minTime = `${dateStr}T00:00:00+07:00`;
    const maxTime = `${dateStr}T23:59:59+07:00`;
    const propArray = Object.entries(propFilters).map(([k, v]) => `${k}=${v}`);
    try {
        const response = await gapi.client.calendar.events.list({
            calendarId: calendarId,
            timeMin: minTime,
            timeMax: maxTime,
            singleEvents: true,
            privateExtendedProperty: propArray
        });
        return response.result.items || [];
    } catch (err) {
        console.error('Lỗi khi tìm sự kiện Lịch:', err);
        return [];
    }
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

    const startDateTime = `${dateStr}T${startTimeStr}+07:00`;
    const endDateTime = `${dateStr}T${endTimeStr}+07:00`;

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

    const startDateTime = `${meeting.date}T${meeting.start || '09:00'}:00+07:00`;
    const endDateTime = `${meeting.date}T${meeting.end || '10:00'}:00+07:00`;
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

async function findGoogleTaskByDate(dateKey) {
    const listRes = await gapi.client.tasks.tasks.list({
        tasklist: '@default',
        showCompleted: false,
        showHidden: false,
        maxResults: 100
    });
    const items = listRes.result.items || [];
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

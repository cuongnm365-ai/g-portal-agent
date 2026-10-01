/**
 * googleSync.js - Google Auth + Drive + Calendar + Tasks + Monitoring Sheet
 * 
 * Tổng hợp toàn bộ logic vận hành Google Ecosystem cho G-Portal:
 * - Xác thực OAuth2 & Khôi phục phiên ngầm (Silent SSO) qua window.GPORTAL_SESSION_MARKER_KEY
 * - Đọc/ghi cấu hình & dữ liệu JSON vào các Thư mục Google Drive chỉ định (FOLDER_IDS)
 * - Đồng bộ Lịch làm việc, Lịch OT, Lịch họp và Google Tasks (PCCV) có bảo lưu trạng thái hoàn thành
 * - Tích hợp ghi nhận dữ liệu Trang Giám Sát lên Google Sheet chỉ định (datae2erq)
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

// Scope bao gồm Drive, Calendar, Tasks và Spreadsheets để ghi nhận trang giám sát
const SCOPES = 'openid email profile https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/tasks https://www.googleapis.com/auth/spreadsheets';

const TOKEN_REFRESH_MARGIN_SEC = 300;
const TOKEN_REFRESH_MIN_DELAY_MS = 30000;

// Khai báo biến dấu vết phiên toàn cục an toàn
window.GPORTAL_SESSION_MARKER_KEY = window.GPORTAL_SESSION_MARKER_KEY || 'gportal_session_marker';

let tokenClient;
let gapiInited = false;
let gisInited = false;
let gapiLoadRequested = false;
let tokenRefreshTimerId = null;
let silentRestoreAttempted = false;
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
    try { localStorage.setItem(window.GPORTAL_SESSION_MARKER_KEY, '1'); } catch (e) {}
}

function clearSessionMarker() {
    try { localStorage.removeItem(window.GPORTAL_SESSION_MARKER_KEY); } catch (e) {}
}

function hasSessionMarker() {
    try { return localStorage.getItem(window.GPORTAL_SESSION_MARKER_KEY) === '1'; } catch (e) { return false; }
}

// ============================================================
// TIỆN ÍCH: Gọi API Google kèm cơ chế thử lại (Retry & Exponential Backoff)
// ============================================================
function isRetryableGoogleApiError(err) {
    const apiErr = err && err.result && err.result.error;
    const status = (apiErr && apiErr.code) || err.status || 0;
    if (status === 429 || status === 500 || status === 503) return true;
    if (status === 403) {
        const reasons = (apiErr && apiErr.errors) ? apiErr.errors.map(e => e.reason) : [];
        return reasons.some(r => r === 'rateLimitExceeded' || r === 'userRateLimitExceeded' || r === 'quotaExceeded');
    }
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
// KHỞI TẠO THƯ VIỆN GOOGLE API & GIS
// ============================================================
function waitForGoogleLibraries() {
    if (!gapiInited && window.gapi && !gapiLoadRequested) {
        gapiLoadRequested = true;
        setLoginStatus('Đang khởi tạo Google API Client...');
        gapi.load('client', {
            callback: initializeGapiClient,
            onerror: function () {
                setLoginStatus('Lỗi: không tải được gapi client. Kiểm tra kết nối mạng hoặc tiện ích chặn.', true);
                gapiLoadRequested = false;
            },
            timeout: 10000,
            ontimeout: function () {
                setLoginStatus('Lỗi: tải gapi client quá thời gian chờ.', true);
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
                setLoginStatus('Không thể tải apis.google.com/js/api.js. Kiểm tra lại mạng.', true);
            } else if (!window.google || !window.google.accounts) {
                setLoginStatus('Không thể tải accounts.google.com/gsi/client.', true);
            }
        }
        setTimeout(waitForGoogleLibraries, 150);
    } else {
        setLoginStatus('');
    }
}

if (window.location.protocol === 'file:') {
    setLoginStatus('Trang đang mở trực tiếp từ file (file://) — Google không cho phép đăng nhập. Vui lòng chạy qua Localhost hoặc GitHub Pages.', true);
} else {
    waitForGoogleLibraries();
}

async function initializeGapiClient() {
    try {
        await gapi.client.init({
            apiKey: API_KEY,
            discoveryDocs: DISCOVERY_DOCS,
        });
        try {
            await gapi.client.load('https://sheets.googleapis.com/$discovery/rest?version=v4');
            console.log('[G-Portal] Google Sheets API loaded');
        } catch (err) {
            console.error('[G-Portal] Google Sheets API load failed:', err);
        }
        gapiInited = true;
        if (!gapi.client.tasks) {
            console.error('[G-Portal Auth] CẢNH BÁO: gapi.client.tasks không tồn tại. Hãy bật Google Tasks API trong Google Cloud Console.');
        }
        checkAllReady();
    } catch (e) {
        console.error("Lỗi khởi tạo GAPI:", e);
        setLoginStatus('Lỗi khởi tạo gapi.client.init(): ' + (e && e.message ? e.message : JSON.stringify(e)), true);
        gapiLoadRequested = false;
    }
}

function checkAllReady() {
    if (gapiInited && gisInited) {
        initGoogleAuth();
    }
}

// ============================================================
// HỒ SƠ NGƯỜI DÙNG & TOKEN MANAGEMENT
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
        console.error('[G-Portal Auth] Lỗi lấy thông tin hồ sơ:', e);
    }
}

(function restoreCachedProfile() {
    try {
        const cached = localStorage.getItem('gportal_user_profile');
        if (cached) applyUserProfile(JSON.parse(cached));
    } catch (e) {}
})();

function scheduleTokenRefresh(expiresInSeconds) {
    if (tokenRefreshTimerId) {
        clearTimeout(tokenRefreshTimerId);
        tokenRefreshTimerId = null;
    }
    const safeExpires = Number.isFinite(expiresInSeconds) && expiresInSeconds > 0 ? expiresInSeconds : 3600;
    const delayMs = Math.max((safeExpires - TOKEN_REFRESH_MARGIN_SEC) * 1000, TOKEN_REFRESH_MIN_DELAY_MS);

    tokenRefreshTimerId = setTimeout(() => {
        if (!tokenClient) return;
        console.log('[G-Portal Auth] Tự động làm mới phiên đăng nhập ngầm...');
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

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (!tokenClient || !gapiInited || !gisInited) return;
    if (!AppState.isLoggedIn && !hasSessionMarker()) return;

    const expiry = parseInt(localStorage.getItem('gapi_token_expiry') || '0', 10);
    const isExpiredOrNear = Date.now() >= (expiry - TOKEN_REFRESH_MARGIN_SEC * 1000);
    if (isExpiredOrNear) {
        console.log('[G-Portal Auth] Tab hoạt động lại, token sắp/đã hết hạn -> làm mới ngầm...');
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

                markSessionActive();

                AppState.isLoggedIn = true;
                if (typeof window.showApp === 'function') window.showApp();

                scheduleTokenRefresh(expiresIn);
                fetchUserProfile(tokenResponse.access_token);
                loadAllDataFromDrive();
            } else if (wasSilentAttempt) {
                silentSessionRestoreFailed('');
            } else {
                setLoginStatus('Đăng nhập thất bại hoặc bị huỷ.', true);
            }
        },
        error_callback: (err) => {
            const wasSilentAttempt = pendingSilentRestore;
            pendingSilentRestore = false;
            const type = err && err.type ? err.type : 'unknown';

            if (wasSilentAttempt) {
                silentSessionRestoreFailed('Phiên đăng nhập hết hiệu lực, vui lòng đăng nhập lại.');
                return;
            }

            if (type === 'popup_failed_to_open' || type === 'popup_closed') {
                setLoginStatus('');
                return;
            }

            setLoginStatus(`Đăng nhập bị gián đoạn (${type}). Vui lòng cho phép cookie bên thứ 3.`, true);
        }
    });

    const savedTokenStr = localStorage.getItem('gapi_token');
    const savedExpiry = parseInt(localStorage.getItem('gapi_token_expiry') || '0', 10);

    if (savedTokenStr && Date.now() < savedExpiry) {
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
            localStorage.removeItem('gapi_token');
            localStorage.removeItem('gapi_token_expiry');
            AppState.isLoggedIn = false;
            attemptSilentSessionRestore();
        }
    } else {
        if (savedTokenStr) {
            localStorage.removeItem('gapi_token');
            localStorage.removeItem('gapi_token_expiry');
        }
        AppState.isLoggedIn = false;
        attemptSilentSessionRestore();
    }
}

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
    if (typeof window.loadWorkflowSettingsFromDrive === 'function') window.loadWorkflowSettingsFromDrive();
    if (typeof window.loadScheduleFromDrive === 'function') window.loadScheduleFromDrive();
    if (typeof window.loadProductivityFromDrive === 'function') window.loadProductivityFromDrive();
}

// Gắn trực tiếp vào window để các thành phần HTML gọi được onclick
window.handleAuthClick = function () {
    if (tokenClient) {
        pendingSilentRestore = false;
        tokenClient.requestAccessToken({ prompt: '' });
    } else {
        setLoginStatus('Hệ thống Google chưa sẵn sàng, vui lòng thử lại sau 1-2 giây.', true);
    }
};

window.handleSignoutClick = function () {
    clearScheduledTokenRefresh();
    try {
        if (window.gapi && gapi.client && typeof gapi.client.getToken === 'function') {
            const token = gapi.client.getToken();
            if (token && token.access_token && window.google && google.accounts && google.accounts.oauth2) {
                google.accounts.oauth2.revoke(token.access_token, () => {});
            }
            gapi.client.setToken('');
        }
    } catch (err) {
        console.error('Lỗi khi đăng xuất:', err);
    } finally {
        localStorage.removeItem('gapi_token');
        localStorage.removeItem('gapi_token_expiry');
        localStorage.removeItem('gportal_user_profile');
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
// ĐỒNG BỘ GOOGLE CALENDAR & TASKS (PCCV)
// ========================================================
const DEFAULT_WORK_CALENDAR_ID = 'primary';
const DEFAULT_MEETING_CALENDAR_ID = '0770c7fff204ae1af3aa25c9a88b00c17bb59c5f6f0b03dd5aa6b51fd3b567d5@group.calendar.google.com';
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

    const event = {
        summary: buildShiftEventTitle(dayData),
        description: description,
        start: { dateTime: `${dateStr}T${startTimeStr}+07:00`, timeZone: 'Asia/Ho_Chi_Minh' },
        end: { dateTime: `${endDateStr}T${endTimeStr}+07:00`, timeZone: 'Asia/Ho_Chi_Minh' },
        extendedProperties: { private: { gportalType: 'work' } }
    };

    await withGoogleApiRetry(() => gapi.client.calendar.events.insert({
        calendarId: calendarId,
        resource: event
    }), { label: `Tạo sự kiện Lịch ngày ${dateStr}` });
};

window.deleteWorkCalendarEvent = async function (dateStr) {
    if (!AppState.isLoggedIn || !gapi.client) return;
    await deleteCalendarEventsByProps(dateStr, getConfiguredCalendarId('work'), { gportalType: 'work' });
};

function buildOtEventTitle(dayData) {
    return `${dayData.ot} - Tăng cường (OT)`;
}
window.buildOtEventTitle = buildOtEventTitle;

window.syncOtCalendarEvent = async function (dateStr, dayData, otShiftTime, description) {
    if (!AppState.isLoggedIn || !gapi.client || !otShiftTime) return;

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

    const event = {
        summary: buildOtEventTitle(dayData),
        description: description,
        start: { dateTime: `${dateStr}T${startTimeStr}+07:00`, timeZone: 'Asia/Ho_Chi_Minh' },
        end: { dateTime: `${endDateStr}T${endTimeStr}+07:00`, timeZone: 'Asia/Ho_Chi_Minh' },
        extendedProperties: { private: { gportalType: 'work-ot' } }
    };

    await withGoogleApiRetry(() => gapi.client.calendar.events.insert({
        calendarId: calendarId,
        resource: event
    }), { label: `Tạo sự kiện OT ngày ${dateStr}` });
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

    const event = {
        summary: meeting.title,
        description: [meeting.content, meeting.mode === 'online' ? `Link họp: ${meeting.location || ''}` : `Địa điểm: ${meeting.location || ''}`].filter(Boolean).join('\n'),
        location: meeting.location || '',
        start: { dateTime: `${meeting.date}T${startStr}+07:00`, timeZone: 'Asia/Ho_Chi_Minh' },
        end: { dateTime: `${endDateStr}T${endStr}+07:00`, timeZone: 'Asia/Ho_Chi_Minh' },
        extendedProperties: { private: { gportalType: 'meeting', gportalMeetingId: meeting.id } }
    };

    await withGoogleApiRetry(() => gapi.client.calendar.events.insert({ calendarId, resource: event }), { label: `Tạo lịch họp ${meeting.id}` });
};

// ============================================================================
// TASK PCCV (Gắn thẻ #GPORTAL_DATE:YYYY-MM-DD# chống trùng lặp & mất trạng thái)
// ============================================================================
const GPORTAL_TASK_DATE_TAG_REGEX = /#GPORTAL_DATE:(\d{4}-\d{2}-\d{2})#/;

function buildGportalTaskNotes(dateKey, notes) {
    const base = (notes || '').replace(GPORTAL_TASK_DATE_TAG_REGEX, '').trim();
    const tag = `#GPORTAL_DATE:${dateKey}#`;
    return base ? `${base}\n${tag}` : tag;
}

function getTaskDateKey(task) {
    if (task && task.notes) {
        const match = task.notes.match(GPORTAL_TASK_DATE_TAG_REGEX);
        if (match) return match[1];
    }
    if (task && task.due) return task.due.substring(0, 10);
    return null;
}

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

async function findGoogleTaskByDate(dateKey) {
    const allTasks = await findAllGoogleTasks();
    const matches = allTasks.filter(t => getTaskDateKey(t) === dateKey);
    if (matches.length === 0) return undefined;
    if (matches.length === 1) return matches[0];
    matches.sort((a, b) => new Date(b.updated || 0) - new Date(a.updated || 0));
    return matches[0];
}

window.syncGoogleTask = async function (dateKey, taskName, notes) {
    if (!AppState.isLoggedIn) return;
    if (!gapi.client.tasks) {
        throw new Error('Google Tasks API chưa sẵn sàng hoặc chưa được bật.');
    }

    try {
        const dueISO = `${dateKey}T00:00:00.000Z`;
        const finalNotes = buildGportalTaskNotes(dateKey, notes);
        const existing = await findGoogleTaskByDate(dateKey);
        const taskBody = { title: taskName, notes: finalNotes, due: dueISO };

        if (existing) {
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
    } catch (err) {
        console.error(`[G-Portal] Lỗi đồng bộ Google Task ngày ${dateKey}:`, err);
        throw err;
    }
};

window.deleteGoogleTask = async function (dateKey) {
    if (!AppState.isLoggedIn || !gapi.client.tasks) return;
    try {
        const existing = await findGoogleTaskByDate(dateKey);
        if (existing) {
            await withGoogleApiRetry(() => gapi.client.tasks.tasks.delete({ tasklist: '@default', task: existing.id }), { label: `Xoá Task ngày ${dateKey}` });
        }
    } catch (err) {
        console.error(`[G-Portal] Lỗi xoá Google Task ngày ${dateKey}:`, err);
        throw err;
    }
};

window.findGoogleTaskByDate = findGoogleTaskByDate;

// ========================================================
// ĐỒNG BỘ NGƯỢC (RECONCILE) & DỌN DẸP TRÙNG LẶP
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

    return { changed: changedSchedule || changedMeeting, changedSchedule, changedMeeting };
};

// ========================================================
// TÍCH HỢP GHI NHỮNG DỮ LIỆU TRANG GIÁM SÁT LÊN GOOGLE SHEET
// ========================================================
const MONITORING_SHEET_ID = '1HLQfY4l0PTqNZ-WL0o40jRJvw2DpSNW6RsVeOu_EYn0';
const MONITORING_TAB_NAME = 'datae2erq';

window.appendDataToMonitoringSheet = async function(valuesArray) {
    if (!AppState.isLoggedIn || !gapi.client.sheets) {
        console.error('[G-Portal] Google Sheets API chưa sẵn sàng hoặc chưa đăng nhập.');
        throw new Error('Google Sheets API chưa sẵn sàng.');
    }

    try {
        const response = await withGoogleApiRetry(() => gapi.client.sheets.spreadsheets.values.append({
            spreadsheetId: MONITORING_SHEET_ID,
            range: `${MONITORING_TAB_NAME}!A:Z`,
            valueInputOption: 'USER_ENTERED',
            insertDataOption: 'INSERT_ROWS',
            resource: {
                values: [valuesArray]
            }
        }), { label: 'Ghi dữ liệu lên Sheet Giám Sát' });
        
        console.log('[G-Portal] Đã ghi dữ liệu giám sát lên Google Sheet thành công.', response);
        return response;
    } catch (error) {
        console.error('[G-Portal] Lỗi khi ghi dữ liệu lên Sheet Giám Sát:', error);
        throw error;
    }
};

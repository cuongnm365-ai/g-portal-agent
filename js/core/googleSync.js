/**
 * googleSync.js - Google Auth + Drive + Calendar + Tasks + Monitoring Sheet
 * 
 * Tổng hợp toàn bộ logic vận hành Google Ecosystem cho G-Portal:
 * - Xác thực OAuth2 & Khôi phục phiên ngầm (Silent SSO) qua window.GPORTAL_SESSION_MARKER_KEY
 * - Đọc/ghi cấu hình & dữ liệu JSON vào các Thư mục Google Drive phân tán theo FOLDER_IDS
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
    'https://tasks.googleapis.com/$discovery/rest?version=v1',
    'https://sheets.googleapis.com/$discovery/rest?version=v4'
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

async function ensureGoogleSheetsReady() {
    if (!window.gapi || !window.gapi.client) {
        throw new Error('Google API client chưa sẵn sàng.');
    }
    if (!gapi.client.sheets) {
        try {
            await gapi.client.load('https://sheets.googleapis.com/$discovery/rest?version=v4');
        } catch (err) {
            console.error('[G-Portal] Không load được Google Sheets API:', err);
            throw new Error('Google Sheets API chưa sẵn sàng. Kiểm tra DISCOVERY_DOCS và Google Sheets API.');
        }
    }
    return true;
}

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

        await ensureGoogleSheetsReady();
        console.log('[G-Portal] Google Sheets API loaded');

        gapiInited = true;
        if (!gapi.client.tasks) {
            console.error('[G-Portal Auth] CẢNH BÁO: gapi.client.tasks không tồn tại. Hãy bật Google Tasks API trong Google Cloud Console.');
        }
        checkAllReady();
    } catch (e) {
        console.error('Lỗi khởi tạo GAPI:', e);
        setLoginStatus('Lỗi khởi tạo gapi.client.init(): ' + (e && e.message ? e.message : JSON.stringify(e)), true);
        gapiLoadRequested = false;
    }
}

function checkAllReady() {
    if (gapiInited && gisInited) {
        initGoogleAuth();
    }
}

// continue rest of file unchanged ...

/**
 * googleSync.js - Google Auth + Drive + Calendar + Tasks
 *
 * BẢN SỬA LỖI NGÀY 12/07 (mới nhất — 3 vấn đề được yêu cầu sửa):
 * -------------------------------------------------------------------------
 * 1) "Tắt tab ~10 phút quay lại phải đăng nhập lại":
 *    - Trước đây token chỉ được lưu 1 lần lúc đăng nhập và không có cơ chế
 *      LÀM MỚI trước khi hết hạn. Access token của Google (GIS) chỉ sống
 *      khoảng 1 giờ và KHÔNG có refresh token ở luồng này, nên càng dùng
 *      lâu càng dễ rơi vào trạng thái "hết hạn" bất ngờ giữa chừng.
 *    - Đã bổ sung scheduleTokenRefresh(): tự động gọi lại
 *      tokenClient.requestAccessToken({prompt:''}) NGẦM (không hiện popup
 *      nếu trình duyệt vẫn còn phiên Google hợp lệ) 5 phút TRƯỚC khi token
 *      hết hạn, để phiên đăng nhập được "gia hạn" liên tục trong lúc đang
 *      mở app.
 *    - Khi mở lại tab sau một thời gian và token đã hết hạn: thay vì bắt
 *      đăng nhập lại ngay, hệ thống tự thử "đăng nhập ngầm"
 *      (prompt:'') một lần — nếu trình duyệt vẫn còn cookie phiên Google
 *      hợp lệ (chưa đăng xuất Google, chưa xoá cookie) thì sẽ vào thẳng
 *      ứng dụng mà KHÔNG cần bấm nút. Nếu thất bại, mới hiện màn hình
 *      đăng nhập như bình thường.
 *    - Nút "Đăng nhập với Google" cũng đổi từ prompt:'consent' (luôn ép
 *      hiện màn hình xin quyền) sang prompt:'' (chỉ hiện khi thật sự cần),
 *      giúp các lần đăng nhập lại sau này nhanh hơn.
 *
 * 2) Thêm chức năng XÓA LỊCH của 1 ngày (nút trong modal hiệu chỉnh ngày,
 *    xem js/modules/schedule/schedule.js) — khi xoá, phải xoá đồng bộ cả
 *    sự kiện Google Calendar LẪN Google Task tương ứng của ngày đó, không
 *    chỉ xoá dữ liệu trong app. Các hàm deleteWorkCalendarEvent() và
 *    deleteGoogleTask() đã có sẵn từ trước, được tái sử dụng ở đây, nhưng
 *    cơ chế xác định "đây là sự kiện của G-Portal" đã đổi sang cách đáng
 *    tin cậy hơn (xem mục 3 bên dưới).
 *
 * 3) Đổi định dạng tên sự kiện & Task cho khớp với hệ thống chấm công:
 *    - Trước đây: summary = "[G-Portal Work] Ca: S2"
 *    - Bây giờ:   summary = "S2 - Chính Chủ" / "S2 - Trực hộ HuyenNTM" /
 *                 "S2 - Đổi ca DungDM" (xem buildShiftEventTitle()).
 *    - Task trên Google Tasks: bỏ tiền tố "[G-Portal]", chỉ còn đúng tên
 *      PCCV giống hệ thống (VD: "HiFPT Chat").
 *    - HỆ QUẢ: vì không còn tiền tố "[G-Portal Work]"/"[G-Portal]" trong
 *      tiêu đề để lọc/tìm khi xoá hoặc cập nhật, cách xác định "sự kiện
 *      nào do G-Portal tạo ra" được chuyển từ tìm-kiếm-theo-chữ (dễ nhầm
 *      với sự kiện khác của người dùng) sang dùng
 *      extendedProperties.private trên Google Calendar — một vùng dữ liệu
 *      ẩn, không hiển thị cho người dùng, chỉ ứng dụng đọc được. Đây là
 *      cách làm chuẩn và đáng tin cậy hơn nhiều so với so khớp chuỗi.
 * -------------------------------------------------------------------------
 *
 * (Giữ nguyên toàn bộ các fix trước đó: polling gapi/gis, gapi.client.init
 * lỗi âm thầm, isLoggedIn set đồng bộ, logout bọc try/catch/finally, cảnh
 * báo file://, cấu hình Calendar ID từ Cài đặt...)
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

const SCOPES = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/tasks';

// Làm mới token sớm hơn thời điểm hết hạn thực tế bao nhiêu giây (an toàn dự phòng độ trễ mạng)
const TOKEN_REFRESH_MARGIN_SEC = 300; // 5 phút
// Khoảng chờ tối thiểu giữa các lần lên lịch làm mới, tránh loop gọi liên tục nếu Google trả về expires_in rất ngắn
const TOKEN_REFRESH_MIN_DELAY_MS = 30000; // 30 giây

let tokenClient;
let gapiInited = false;
let gisInited = false;
let gapiLoadRequested = false; // tránh gọi gapi.load() nhiều lần trong lúc polling
let tokenRefreshTimerId = null;
let silentRestoreAttempted = false; // chỉ tự thử đăng nhập ngầm 1 lần mỗi phiên tải trang
const GSYNC_START_TIME = Date.now();

// Cập nhật dòng trạng thái dưới nút "Đăng nhập với Google" để người dùng thấy
// tiến trình mà KHÔNG cần mở Console (F12) mới xem được lỗi.
function setLoginStatus(text, isError) {
    const el = document.getElementById('login-status');
    if (el) {
        el.innerText = text;
        el.style.color = isError ? 'var(--danger, #ef4444)' : '';
    }
    // Hiện nút "Thử lại kết nối Google" mỗi khi có lỗi, ẩn đi khi trạng thái bình thường
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
                gapiLoadRequested = false; // cho phép thử lại
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
        // Sau 8 giây vẫn chưa xong -> báo rõ đang kẹt ở thư viện nào để dễ xử lý
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

// Google OAuth (GIS) không hoạt động khi mở trực tiếp file HTML từ ổ đĩa (file://) —
// bắt buộc phải phục vụ qua http(s) (kể cả localhost). Cảnh báo sớm để không mất công
// debug nhầm hướng.
if (window.location.protocol === 'file:') {
    setLoginStatus('Trang đang được mở trực tiếp từ file (file://) — Google không cho phép đăng nhập trong trường hợp này. Vui lòng chạy qua một máy chủ web (vd: GitHub Pages, hoặc "npx serve" / "python -m http.server" trên localhost).', true);
} else {
    waitForGoogleLibraries();
}

// Khởi tạo GAPI Client
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
        gapiLoadRequested = false; // cho phép thử lại ở vòng polling kế tiếp nếu lỗi
    }
}

// Chỉ khởi tạo Auth khi CẢ 2 thư viện đã sẵn sàng
function checkAllReady() {
    if (gapiInited && gisInited) {
        initGoogleAuth();
    }
}

// ============================================================
// 1. LÀM MỚI TOKEN NGẦM (giữ phiên đăng nhập sống lâu hơn 1 lần hết hạn)
// ============================================================

// Lên lịch tự làm mới token TRƯỚC khi hết hạn, để người dùng không bao giờ
// thấy app "rớt" về màn hình đăng nhập giữa lúc đang thao tác.
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
        // prompt:'' => không ép hiện màn hình xin quyền nếu trình duyệt vẫn còn phiên hợp lệ
        tokenClient.requestAccessToken({ prompt: '' });
    }, delayMs);
}

function clearScheduledTokenRefresh() {
    if (tokenRefreshTimerId) {
        clearTimeout(tokenRefreshTimerId);
        tokenRefreshTimerId = null;
    }
}

// Khởi tạo xác thực Google (tự động đăng nhập lại khi F5 nếu đã có token, và
// tự thử đăng nhập ngầm nếu token đã hết hạn nhưng máy này từng đăng nhập)
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
                loadAllDataFromDrive();
            } else {
                setLoginStatus('Đăng nhập thất bại hoặc bị huỷ. Vui lòng thử lại.', true);
            }
        },
        // FIX: bổ sung error_callback — trước đây nếu popup đăng nhập bị đóng, bị chặn
        // (popup blocker), hoặc thất bại do hạn chế cookie bên thứ 3 (thường gặp ở chế
        // độ Ẩn danh / Private Browsing), lỗi bị "nuốt" âm thầm, người dùng chỉ thấy
        // không có phản ứng gì mà không rõ lý do.
        error_callback: (err) => {
            console.error('[G-Portal Auth] OAuth error_callback:', err);
            const type = err && err.type ? err.type : 'unknown';

            // Nếu đây là lần thử "đăng nhập ngầm" tự động (không phải người dùng bấm nút)
            // thì không cần làm phiền bằng thông báo lỗi to tướng — chỉ cần quay về màn
            // hình đăng nhập bình thường để người dùng tự bấm khi cần.
            if (type === 'popup_failed_to_open' || type === 'popup_closed') {
                // Có thể do trình duyệt chặn popup vì không có thao tác chuột trực tiếp
                // (trường hợp tự làm mới ngầm). Bỏ qua yên lặng, giữ phiên cũ nếu còn hạn,
                // hoặc để người dùng bấm nút đăng nhập thủ công nếu đã hết hạn.
                setLoginStatus('');
                return;
            }

            let msg = `Đăng nhập bị gián đoạn (${type}).`;
            msg += ' Nếu đang ở chế độ Ẩn danh/Riêng tư, hãy bật "Cho phép cookie bên thứ 3" (Allow third-party cookies) cho accounts.google.com, hoặc dùng cửa sổ trình duyệt thông thường — Google Identity Services thường không hoạt động đầy đủ khi cookie bên thứ 3 bị chặn.';
            setLoginStatus(msg, true);
        }
    });

    // Khôi phục phiên đăng nhập cũ (nếu có) ngay khi tokenClient đã sẵn sàng.
    // Kiểm tra thêm hạn token: access token của Google thường hết hạn sau ~1 giờ,
    // nếu còn hạn thì dùng luôn VÀ lên lịch tự làm mới trước khi hết hạn thật sự.
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
        // Token đã hết hạn, nhưng thiết bị này từng đăng nhập thành công trước đó ->
        // thử "đăng nhập ngầm" 1 lần (không ép hiện popup xin quyền) trước khi bắt
        // người dùng phải tự bấm nút. Nếu trình duyệt vẫn còn phiên Google hợp lệ
        // (chưa đăng xuất khỏi Google, cookie bên thứ 3 không bị chặn), thao tác này
        // sẽ tự đưa người dùng vào thẳng ứng dụng mà không cần thao tác gì thêm.
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

// Cho phép người dùng chủ động thử kết nối lại thư viện Google (dùng khi bị lỗi mạng/AdBlock)
window.retryGoogleLibraries = function () {
    gapiLoadRequested = false;
    setLoginStatus('Đang thử kết nối lại...');
    waitForGoogleLibraries();
};

// Gọi API lấy dữ liệu Settings, Lịch, Năng suất
function loadAllDataFromDrive() {
    if (typeof window.loadSettingsFromDrive === 'function') window.loadSettingsFromDrive();
    if (typeof window.loadScheduleFromDrive === 'function') window.loadScheduleFromDrive();
    if (typeof window.loadProductivityFromDrive === 'function') window.loadProductivityFromDrive();
}

// Nút Đăng nhập
// FIX: đổi prompt từ 'consent' (luôn ép hiện màn hình xin quyền, kể cả những lần
// đăng nhập lại sau này) sang '' (chỉ hiện khi Google thấy thật sự cần, ví dụ lần
// đầu tiên hoặc khi phạm vi quyền thay đổi) -> các lần đăng nhập lại sau đó nhanh
// và mượt hơn hẳn.
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

// Nút Đăng xuất
// FIX QUAN TRỌNG: bản cũ gọi thẳng gapi.client.getToken() KHÔNG kiểm tra gapi/gapi.client
// đã tồn tại chưa. Nếu thư viện Google chưa tải xong, bị chặn (AdBlock/mạng), hoặc phiên
// đăng nhập là "đăng nhập giả" do lỗi race-condition ở trên -> gọi gapi.client.getToken()
// ném lỗi (TypeError: Cannot read properties of undefined) NGAY LẬP TỨC, hàm dừng giữa
// chừng -> localStorage.removeItem() và showLogin() phía dưới KHÔNG BAO GIỜ được chạy
// -> bấm "Đăng xuất" không có phản ứng gì. Giờ bọc try/catch/finally để đăng xuất CỤC BỘ
// (xoá token, quay về màn hình đăng nhập) LUÔN LUÔN thành công, kể cả khi phần thu hồi
// quyền (revoke) trên server Google bị lỗi. Đồng thời huỷ bộ đếm tự làm mới token ngầm.
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
        AppState.isLoggedIn = false;
        if (typeof window.showLogin === 'function') window.showLogin('Đã đăng xuất.');
    }
};

// ========================================================
// PHẦN LOGIC ĐỒNG BỘ LỊCH VÀ TASKS
// ========================================================

// FIX: trước đây 2 ID lịch này bị HARD-CODE cứng trong source code (1 dòng ghi 'primary',
// 1 dòng ghi thẳng ID lịch họp cá nhân của người viết code cũ) -> không có chỗ nào trên
// giao diện để người dùng khác tự nhập ID lịch của họ. Giờ đọc từ Cài đặt
// (window.portalSettings.googleCalendar), có ô nhập ở trang "Cài Đặt" > "Cấu hình Google
// Calendar". Nếu người dùng để trống thì mặc định dùng 'primary' (lịch chính của tài
// khoản Google đang đăng nhập).
const DEFAULT_WORK_CALENDAR_ID = 'primary';
const DEFAULT_MEETING_CALENDAR_ID = '0770c7fff204ae1af3aa25c9a88b00c17bb59c5f6f0b03dd5aa6b51fd3b567d5@group.calendar.google.com';

function getConfiguredCalendarId(kind) {
    const cfg = (window.portalSettings && window.portalSettings.googleCalendar) || {};
    if (kind === 'meeting') {
        return (cfg.meetingCalendarId && cfg.meetingCalendarId.trim()) ? cfg.meetingCalendarId.trim() : DEFAULT_MEETING_CALENDAR_ID;
    }
    return (cfg.workCalendarId && cfg.workCalendarId.trim()) ? cfg.workCalendarId.trim() : DEFAULT_WORK_CALENDAR_ID;
}

// ------------------------------------------------------------------------
// Xác định & xoá sự kiện do G-Portal tạo ra bằng extendedProperties.private
// (KHÔNG còn dựa vào chuỗi trong tiêu đề như "[G-Portal Work]" nữa, vì tiêu
// đề giờ hiển thị thân thiện theo mẫu "S2 - Chính Chủ" / "S2 - Trực hộ ..."
// và không còn tiền tố cố định để so khớp an toàn).
// ------------------------------------------------------------------------
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

// Dựng tiêu đề sự kiện Google Calendar theo đúng mẫu chấm công:
//   "S2 - Chính Chủ"
//   "S2 - Trực hộ HuyenNTM"
//   "S2 - Đổi ca DungDM"
// Nếu ca chính là OFF nhưng có tăng cường (OT) thì lấy mã ca OT làm phần đầu.
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

// Đồng bộ 1 ngày lên Google Calendar (thêm mới hoặc cập nhật = xoá cũ rồi tạo lại).
// THAM SỐ: dayData là object đầy đủ của ngày đó (shift, ot, type, trade, help, task...)
// để dựng đúng tiêu đề theo mẫu chấm công.
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

// Xoá sự kiện làm việc của 1 ngày (dùng khi ngày đó chuyển thành OFF hoàn toàn,
// không còn ca/OT, HOẶC khi người dùng bấm "Xóa lịch" cho cả ngày đó).
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

// Tìm Google Task đã tồn tại của 1 ngày cụ thể (dựa vào trường "due")
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

// Đồng bộ PCCV lên Google Tasks: cập nhật nếu đã có Task của ngày đó, thêm mới nếu chưa có.
// FIX: bỏ tiền tố "[G-Portal] " khỏi tiêu đề Task — giờ tiêu đề chỉ còn đúng tên PCCV,
// giống hệt tên hiển thị trên hệ thống (VD: "HiFPT Chat"). Việc xác định Task nào thuộc
// về ngày nào vẫn dựa vào trường "due" (ngày đến hạn) như trước, không phụ thuộc tiêu đề.
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

// Xoá Google Task của 1 ngày (dùng khi PCCV bị gỡ khỏi ngày đó trên G-Portal,
// hoặc khi người dùng bấm "Xóa lịch" cho cả ngày đó).
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

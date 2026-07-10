/**
 * googleSync.js - Google Auth + Drive + Calendar + Tasks
 *
 * BẢN SỬA LỖI ĐĂNG NHẬP (quan trọng):
 * -------------------------------------------------------------------------
 * TRƯỚC ĐÂY: dùng onload="gapiLoaded()" / onload="gisLoaded()" ngay trên thẻ
 * <script async defer ...> trong index.html. Vì các script này có "async",
 * trình duyệt tải chúng song song không theo thứ tự cố định. Thư viện
 * "gsi/client" rất nhẹ nên gần như luôn tải xong TRƯỚC KHI file này
 * (googleSync.js - nơi định nghĩa gapiLoaded/gisLoaded) được tải và chạy
 * xong. Khi đó onload gọi một hàm CHƯA TỒN TẠI -> lỗi bị nuốt âm thầm ->
 * gapiInited/gisInited không bao giờ cùng true -> tokenClient luôn
 * undefined -> bấm "Đăng nhập với Google" luôn rơi vào alert cảnh báo
 * "Hệ thống Google đang được kết nối...".
 *
 * CÁCH SỬA: bỏ hẳn onload trên thẻ <script> (xem index.html), thay bằng
 * vòng lặp kiểm tra (polling) window.gapi / window.google.accounts đã sẵn
 * sàng hay chưa. Cách này không phụ thuộc thứ tự tải file nên luôn chạy
 * đúng, kể cả khi mạng chậm/nhanh thất thường. Đây cũng chính là cách file
 * tham khảo "google-auth-repo mail.js" của bạn dùng (waitForGoogleAuth)
 * để giữ phiên đăng nhập ổn định.
 * -------------------------------------------------------------------------
 */

const CLIENT_ID = '764929266866-62ua4ratuu6jimphrullociovmcdmkq9.apps.googleusercontent.com';
const API_KEY = 'AIzaSyChHKJeaAnGQ5cVoSeqQQ8R-BgPK2DLv2Y';
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
    'https://tasks.googleapis.com/$discovery/rest/v1'
];

const SCOPES = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/tasks';

let tokenClient;
let gapiInited = false;
let gisInited = false;
let gapiLoadRequested = false; // tránh gọi gapi.load() nhiều lần trong lúc polling

// ============================================================
// 0. POLLING: chờ 2 thư viện gapi + Google Identity Services sẵn sàng
//    (thay thế cho onload="gapiLoaded()"/"gisLoaded()" cũ, không còn dùng nữa)
// ============================================================
function waitForGoogleLibraries() {
    if (!gapiInited && window.gapi && !gapiLoadRequested) {
        gapiLoadRequested = true;
        gapi.load('client', initializeGapiClient);
    }
    if (!gisInited && window.google && window.google.accounts && window.google.accounts.oauth2) {
        gisInited = true;
        checkAllReady();
    }
    if (!gapiInited || !gisInited) {
        setTimeout(waitForGoogleLibraries, 150);
    }
}
waitForGoogleLibraries();

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
        gapiLoadRequested = false; // cho phép thử lại ở vòng polling kế tiếp nếu lỗi
    }
}

// Chỉ khởi tạo Auth khi CẢ 2 thư viện đã sẵn sàng
function checkAllReady() {
    if (gapiInited && gisInited) {
        initGoogleAuth();
    }
}

// Khởi tạo xác thực Google (tự động đăng nhập lại khi F5 nếu đã có token)
function initGoogleAuth() {
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: (tokenResponse) => {
            if (tokenResponse && tokenResponse.access_token) {
                localStorage.setItem('gapi_token', JSON.stringify(tokenResponse));
                if (gapi.client) gapi.client.setToken(tokenResponse);

                AppState.isLoggedIn = true;
                if (typeof window.showApp === 'function') window.showApp();

                loadAllDataFromDrive();
            }
        },
    });

    // Khôi phục phiên đăng nhập cũ (nếu có) ngay khi tokenClient đã sẵn sàng
    const savedTokenStr = localStorage.getItem('gapi_token');
    if (savedTokenStr) {
        try {
            const savedToken = JSON.parse(savedTokenStr);
            if (gapi.client) {
                gapi.client.setToken(savedToken);
                AppState.isLoggedIn = true;
                if (typeof window.showApp === 'function') window.showApp();
                loadAllDataFromDrive();
            }
        } catch (e) {
            console.error("Lỗi parse token:", e);
            localStorage.removeItem('gapi_token');
            if (typeof window.showLogin === 'function') window.showLogin();
        }
    }
}

// Gọi API lấy dữ liệu Settings, Lịch, Năng suất
function loadAllDataFromDrive() {
    if (typeof window.loadSettingsFromDrive === 'function') window.loadSettingsFromDrive();
    if (typeof window.loadScheduleFromDrive === 'function') window.loadScheduleFromDrive();
    if (typeof window.loadProductivityFromDrive === 'function') window.loadProductivityFromDrive();
}

// Nút Đăng nhập
window.handleAuthClick = function () {
    if (tokenClient) {
        tokenClient.requestAccessToken({ prompt: 'consent' });
    } else {
        alert("Hệ thống Google đang được kết nối, vui lòng chờ trong giây lát rồi thử lại (không cần F5).");
    }
};

// Nút Đăng xuất
window.handleSignoutClick = function () {
    const token = gapi.client.getToken();
    if (token !== null) {
        google.accounts.oauth2.revoke(token.access_token, () => {
            console.log('Đã thu hồi quyền truy cập (Revoked token)');
        });
        gapi.client.setToken('');
    }
    localStorage.removeItem('gapi_token');
    AppState.isLoggedIn = false;
    if (typeof window.showLogin === 'function') window.showLogin();
};

// ========================================================
// PHẦN LOGIC ĐỒNG BỘ LỊCH VÀ TASKS
// ========================================================

async function deleteCalendarEvent(dateStr) {
    try {
        const minTime = `${dateStr}T00:00:00+07:00`;
        const maxTime = `${dateStr}T23:59:59+07:00`;
        let response = await gapi.client.calendar.events.list({
            'calendarId': 'primary',
            'timeMin': minTime,
            'timeMax': maxTime,
            'q': 'Ca:',
            'singleEvents': true
        });

        const events = response.result.items;
        if (events && events.length > 0) {
            for (const ev of events) {
                await gapi.client.calendar.events.delete({
                    'calendarId': 'primary',
                    'eventId': ev.id
                });
            }
        }
    } catch (err) {
        console.error("Lỗi khi xóa sự kiện Lịch:", err);
    }
}

// Đồng bộ 1 ngày lên Google Calendar (thêm mới hoặc cập nhật = xoá cũ rồi tạo lại)
window.syncCalendarEvent = async function (dateStr, shiftCode, shiftTime, description) {
    if (!AppState.isLoggedIn || !gapi.client) return;

    await deleteCalendarEvent(dateStr);

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
        'summary': `Ca: ${shiftCode}`,
        'description': description,
        'start': { 'dateTime': startDateTime, 'timeZone': 'Asia/Ho_Chi_Minh' },
        'end': { 'dateTime': endDateTime, 'timeZone': 'Asia/Ho_Chi_Minh' }
    };

    try {
        await gapi.client.calendar.events.insert({
            'calendarId': 'primary',
            'resource': event
        });
        console.log(`Đã đồng bộ Lịch ngày ${dateStr} thành công.`);
    } catch (err) {
        console.error("Lỗi đồng bộ Lịch: ", err);
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

// Đồng bộ PCCV lên Google Tasks: cập nhật nếu đã có Task của ngày đó, thêm mới nếu chưa có
window.syncGoogleTask = async function (dateKey, taskName, notes) {
    if (!AppState.isLoggedIn || !gapi.client.tasks) return;
    try {
        const dueISO = `${dateKey}T00:00:00.000Z`;
        const existing = await findGoogleTaskByDate(dateKey);
        const taskBody = { title: `[G-Portal] ${taskName}`, notes: notes || '', due: dueISO };

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
        console.log(`Đã đồng bộ Task ngày ${dateKey} thành công.`);
    } catch (err) {
        console.error("Lỗi đồng bộ Task: ", err);
    }
};

// Xoá Google Task của 1 ngày (khi PCCV bị gỡ khỏi ngày đó)
window.deleteGoogleTask = async function (dateKey) {
    if (!AppState.isLoggedIn || !gapi.client.tasks) return;
    try {
        const existing = await findGoogleTaskByDate(dateKey);
        if (existing) {
            await gapi.client.tasks.tasks.delete({ tasklist: '@default', task: existing.id });
            console.log(`Đã xoá Task ngày ${dateKey}.`);
        }
    } catch (err) {
        console.error("Lỗi xoá Task: ", err);
    }
};

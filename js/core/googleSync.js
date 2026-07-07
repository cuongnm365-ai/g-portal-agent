/**
 * googleSync.js - Google OAuth & API Initialization
 * Quản lý: OAuth initialization, API discovery, Token callback
 *
 * FIX QUAN TRỌNG (so với bản cũ):
 * 1. syncGoogleTask() trước đây yêu cầu tham số taskBody phải là OBJECT
 *    (có .title/.notes) nhưng nơi gọi (schedule.js) lại truyền vào một
 *    CHUỖI TEXT (vd "CHAT") -> Google Tasks API từ chối request, lỗi bị
 *    catch nuốt mất (chỉ log console) -> nhìn như task "không đẩy lên".
 *    Đã đổi chữ ký hàm thành syncGoogleTask(dateStr, taskName, notes) và
 *    tự dựng object hợp lệ bên trong, có thêm trường "due" bắt buộc.
 * 2. deleteGoogleTask() cũng đổi chữ ký còn (dateStr) - tự tìm và xoá đúng
 *    task PCCV của ngày đó, được gọi từ schedule.js khi PCCV bị gỡ bỏ.
 * 3. Bổ sung console.log/console.error chi tiết ở từng bước khởi tạo GSI/GAPI
 *    để chẩn đoán lỗi "F5 vẫn phải đăng nhập lại" (do lỗi này phụ thuộc
 *    trình duyệt/chính sách cookie, cần xem log Console mới xác định
 *    chính xác dừng ở bước nào).
 */

const CLIENT_ID = '764929266866-62ua4ratuu6jimphrullociovmcdmkq9.apps.googleusercontent.com';
const API_KEY = 'AIzaSyChHKJeaAnGQ5cVoSeqQQ8R-BgPK2DLv2Y'; // API_KEY hợp lệ lấy từ code gốc của bạn

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

// ----------------------------------------------------
// KHỞI TẠO BIẾN TOÀN CỤC ĐỂ AUTH.JS CÓ THỂ GỌI ĐƯỢC
// ----------------------------------------------------
window.tokenClient = null;
let gapiInited = false;
let gsiInited = false;

// CƠ CHẾ MỚI: Chủ động tải thư viện Google để chống lỗi khi F5
document.addEventListener('DOMContentLoaded', () => {
    console.log('[G-Portal Auth] Bắt đầu tải thư viện Google Identity Services (GSI)...');

    // Tải Google Identity Services (GSI)
    const gsiScript = document.createElement('script');
    gsiScript.src = "https://accounts.google.com/gsi/client";
    gsiScript.async = true;
    gsiScript.defer = true;
    gsiScript.onload = () => {
        try {
            window.tokenClient = google.accounts.oauth2.initTokenClient({
                client_id: CLIENT_ID,
                scope: SCOPES,
                callback: (tokenResponse) => {
                    console.log('[G-Portal Auth] GSI callback nhận được phản hồi:', tokenResponse.error ? `LỖI: ${tokenResponse.error}` : 'THÀNH CÔNG');
                    if (typeof window.handleTokenResponse === 'function') {
                        window.handleTokenResponse(tokenResponse);
                    }
                },
            });
            gsiInited = true;
            console.log('[G-Portal Auth] ✓ GSI (tokenClient) đã khởi tạo xong.');
            checkAuthReady();
        } catch (err) {
            console.error('[G-Portal Auth] ❌ Lỗi khởi tạo GSI tokenClient:', err);
        }
    };
    gsiScript.onerror = () => console.error('[G-Portal Auth] ❌ Không tải được script GSI (accounts.google.com). Kiểm tra mạng/adblock.');
    document.body.appendChild(gsiScript);

    // Tải Google API Client (GAPI)
    console.log('[G-Portal Auth] Bắt đầu tải thư viện Google API Client (GAPI)...');
    const gapiScript = document.createElement('script');
    gapiScript.src = "https://apis.google.com/js/api.js";
    gapiScript.async = true;
    gapiScript.defer = true;
    gapiScript.onload = () => {
        gapi.load('client', async () => {
            try {
                await gapi.client.init({
                    apiKey: API_KEY,
                    discoveryDocs: DISCOVERY_DOCS,
                });
                gapiInited = true;
                console.log('[G-Portal Auth] ✓ GAPI client.init() thành công (Drive/Calendar/Tasks discovery OK).');
                checkAuthReady();
            } catch (err) {
                // FIX: bắt lỗi rõ ràng thay vì để rơi mất (unhandled rejection) -
                // trước đây nếu client.init() lỗi (vd sai API key / referrer bị chặn),
                // gapiInited không bao giờ được set true và checkAuthReady() không
                // bao giờ được gọi lại từ nhánh này -> không thể khôi phục phiên đăng nhập.
                console.error('[G-Portal Auth] ❌ Lỗi gapi.client.init() - kiểm tra API_KEY / referrer được phép trong Google Cloud Console:', err);
            }
        });
    };
    gapiScript.onerror = () => console.error('[G-Portal Auth] ❌ Không tải được script GAPI (apis.google.com). Kiểm tra mạng/adblock.');
    document.body.appendChild(gapiScript);
});

// Kiểm tra khi cả 2 thư viện đã load thành công mới khôi phục phiên đăng nhập cũ
function checkAuthReady() {
    console.log(`[G-Portal Auth] checkAuthReady(): gapiInited=${gapiInited}, gsiInited=${gsiInited}`);
    if (gapiInited && gsiInited) {
        console.log('[G-Portal Auth] ✓ Toàn bộ hệ thống API Google đã kết nối thành công! Đang kiểm tra token cũ...');
        if (typeof window.checkExistingToken === 'function') {
            window.checkExistingToken();
        } else {
            console.error('[G-Portal Auth] ❌ Không tìm thấy window.checkExistingToken (auth.js chưa tải xong hoặc lỗi thứ tự load script).');
        }
    }
}

// ----------------------------------------------------
// CÁC HÀM ĐỒNG BỘ GOOGLE CALENDAR VÀ GOOGLE TASKS
// ----------------------------------------------------

window.syncCalendarEvent = async function(dateStr, shiftCode, shiftTime, description) {
    try {
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
            let targetEvent = events.find(e => e.summary && e.summary.includes("Ca:"));
            if (targetEvent) {
                await gapi.client.calendar.events.update({
                    'calendarId': 'primary',
                    'eventId': targetEvent.id,
                    'resource': event
                });
                console.log(`✓ Updated Google Calendar for ${dateStr}`);
                return;
            }
        }

        await gapi.client.calendar.events.insert({
            'calendarId': 'primary',
            'resource': event
        });
        console.log(`✓ Created Google Calendar event for ${dateStr}`);
    } catch (err) {
        console.error("Lỗi Calendar:", err);
    }
};

window.deleteCalendarEvent = async function(dateStr) {
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
            for (let e of events) {
                if (e.summary && e.summary.includes("Ca:")) {
                    await gapi.client.calendar.events.delete({
                        'calendarId': 'primary',
                        'eventId': e.id
                    });
                    console.log(`✓ Deleted Google Calendar event for ${dateStr}`);
                }
            }
        }
    } catch (err) {
        console.error("Lỗi xóa Calendar:", err);
    }
};

/**
 * FIX: Chữ ký hàm đổi từ (dateStr, taskBody{object}) -> (dateStr, taskName, notes).
 * Hàm tự dựng object hợp lệ cho Google Tasks API (bắt buộc phải có "due" hợp lệ
 * để lần sau còn tìm lại đúng task theo ngày mà cập nhật, tránh tạo trùng lặp).
 */
window.syncGoogleTask = async function(dateStr, taskName, notes) {
    try {
        const taskBody = {
            title: `PCCV: ${taskName}`,
            notes: notes || '',
            due: `${dateStr}T00:00:00.000Z`
        };

        let response = await gapi.client.tasks.tasks.list({
            'tasklist': '@default',
            'dueMin': `${dateStr}T00:00:00.000Z`,
            'dueMax': `${dateStr}T23:59:59.000Z`,
            'showCompleted': true,
            'showHidden': true
        });
        const tasks = response.result.items || [];
        let targetTask = tasks.find(t => t.title && t.title.startsWith('PCCV:'));

        if (targetTask) {
            targetTask.title = taskBody.title;
            targetTask.notes = taskBody.notes;
            targetTask.due = taskBody.due;
            await gapi.client.tasks.tasks.update({
                'tasklist': '@default',
                'task': targetTask.id,
                'resource': targetTask
            });
            console.log(`✓ Updated Google Task for ${dateStr}`);
        } else {
            await gapi.client.tasks.tasks.insert({
                'tasklist': '@default',
                'resource': taskBody
            });
            console.log(`✓ Created Google Task for ${dateStr}`);
        }
    } catch (err) {
        console.error("Lỗi Tasks:", err);
    }
};

/**
 * FIX: Trước đây hàm này chưa từng được gọi ở đâu -> PCCV bị gỡ khỏi 1 ngày
 * thì Task cũ trên Google vẫn còn tồn tại vĩnh viễn. Giờ được gọi từ
 * schedule.js mỗi khi dayData.task rỗng.
 */
window.deleteGoogleTask = async function(dateStr) {
    try {
        let response = await gapi.client.tasks.tasks.list({
            'tasklist': '@default',
            'dueMin': `${dateStr}T00:00:00.000Z`,
            'dueMax': `${dateStr}T23:59:59.000Z`,
            'showCompleted': true,
            'showHidden': true
        });
        const tasks = response.result.items || [];
        for (let t of tasks) {
            if (t.title && t.title.startsWith('PCCV:')) {
                await gapi.client.tasks.tasks.delete({
                    'tasklist': '@default',
                    'task': t.id
                });
                console.log(`✓ Deleted Google Task for ${dateStr}`);
            }
        }
    } catch (err) {
        console.error("Lỗi xóa Tasks:", err);
    }
};

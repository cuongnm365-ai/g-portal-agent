/**
 * googleSync.js - Google OAuth & API Initialization
 * Quản lý: OAuth initialization, API discovery, Token callback
 */

const CLIENT_ID = '780344267458-j0ti8pkkofqer8p4m13jmkte3ln64c6h.apps.googleusercontent.com';
const API_KEY = 'AIzaSyAsSD-DmNUjATuf8gjWlvq7LbUWaF6IHL4'; // API_KEY hợp lệ lấy từ code gốc của bạn

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

const SCOPES = 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/tasks';

// ----------------------------------------------------
// KHỞI TẠO BIẾN TOÀN CỤC ĐỂ AUTH.JS CÓ THỂ GỌI ĐƯỢC
// ----------------------------------------------------
window.tokenClient = null;
let gapiInited = false;
let gsiInited = false;

// CƠ CHẾ MỚI: Chủ động tải thư viện Google để chống lỗi khi F5
document.addEventListener('DOMContentLoaded', () => {
    // Tải Google Identity Services (GSI)
    const gsiScript = document.createElement('script');
    gsiScript.src = "https://accounts.google.com/gsi/client";
    gsiScript.async = true;
    gsiScript.defer = true;
    gsiScript.onload = () => {
        window.tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: CLIENT_ID,
            scope: SCOPES,
            callback: (tokenResponse) => {
                if (typeof window.handleTokenResponse === 'function') {
                    window.handleTokenResponse(tokenResponse);
                }
            },
        });
        gsiInited = true;
        checkAuthReady();
    };
    document.body.appendChild(gsiScript);

    // Tải Google API Client (GAPI)
    const gapiScript = document.createElement('script');
    gapiScript.src = "https://apis.google.com/js/api.js";
    gapiScript.async = true;
    gapiScript.defer = true;
    gapiScript.onload = () => {
        gapi.load('client', async () => {
            await gapi.client.init({
                apiKey: API_KEY,
                discoveryDocs: DISCOVERY_DOCS,
            });
            gapiInited = true;
            checkAuthReady();
        });
    };
    document.body.appendChild(gapiScript);
});

// Kiểm tra khi cả 2 thư viện đã load thành công mới khôi phục phiên đăng nhập cũ
function checkAuthReady() {
    if (gapiInited && gsiInited) {
        console.log('✓ [G-Portal] Toàn bộ hệ thống API Google đã kết nối thành công!');
        if (typeof window.checkExistingToken === 'function') {
            window.checkExistingToken();
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
            'summary': `Ca: ${shiftCode} - Chính chủ`,
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

window.syncGoogleTask = async function(dateStr, taskBody) {
    try {
        let response = await gapi.client.tasks.tasks.list({
            'tasklist': '@default',
            'dueMin': `${dateStr}T00:00:00.000Z`,
            'dueMax': `${dateStr}T23:59:59.000Z`
        });
        const tasks = response.result.items || [];
        if (tasks.length > 0) {
            let targetTask = tasks.find(t => t.title && (t.title.includes('PCCV') || t.title === taskBody.title));
            if (targetTask) {
                targetTask.title = taskBody.title;
                targetTask.notes = taskBody.notes;
                await gapi.client.tasks.tasks.update({
                    'tasklist': '@default',
                    'task': targetTask.id,
                    'resource': targetTask
                });
                console.log(`✓ Updated Google Task for ${dateStr}`);
                return;
            }
        }
        
        await gapi.client.tasks.tasks.insert({
            'tasklist': '@default',
            'resource': taskBody
        });
        console.log(`✓ Created Google Task for ${dateStr}`);
    } catch (err) {
        console.error("Lỗi Tasks:", err);
    }
};

window.deleteGoogleTask = async function(dateStr, taskTitle) {
    try {
        let response = await gapi.client.tasks.tasks.list({
            'tasklist': '@default',
            'dueMin': `${dateStr}T00:00:00.000Z`,
            'dueMax': `${dateStr}T23:59:59.000Z`
        });
        const tasks = response.result.items || [];
        if (tasks.length > 0) {
            let targetTask = tasks.find(t => t.title && t.title.includes(taskTitle));
            if (targetTask) {
                await gapi.client.tasks.tasks.delete({
                    'tasklist': '@default',
                    'task': targetTask.id
                });
                console.log(`✓ Deleted Google Task for ${dateStr}`);
            }
        }
    } catch (err) {
        console.error("Lỗi xóa Tasks:", err);
    }
};

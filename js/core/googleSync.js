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

// 1. Hàm Tải GAPI
window.gapiLoaded = function() {
    gapi.load('client', initializeGapiClient);
};

// 2. Khởi tạo GAPI Client
async function initializeGapiClient() {
    try {
        await gapi.client.init({
            apiKey: API_KEY,
            discoveryDocs: DISCOVERY_DOCS,
        });
        gapiInited = true;
        checkAllReady(); // Kiểm tra xem GIS tải xong chưa
    } catch (e) {
        console.error("Lỗi khởi tạo GAPI:", e);
    }
}

// 3. Hàm tải Google Identity Services (GIS)
window.gisLoaded = function() {
    gisInited = true;
    checkAllReady(); // Kiểm tra xem GAPI tải xong chưa
};

// 4. KIỂM TRA ĐỒNG BỘ: Chỉ chạy khi CẢ 2 ĐÃ SẴN SÀNG (Sửa lỗi crash giao diện)
function checkAllReady() {
    if (gapiInited && gisInited) {
        initGoogleAuth();
    }
}

// 5. Khởi tạo xác thực Google (Tự động đăng nhập lại khi F5)
function initGoogleAuth() {
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: (tokenResponse) => {
            if (tokenResponse && tokenResponse.access_token) {
                // Đăng nhập thành công, lưu token vào máy tính
                localStorage.setItem('gapi_token', JSON.stringify(tokenResponse));
                
                // Gán token cho GAPI 
                if (gapi.client) gapi.client.setToken(tokenResponse);
                
                AppState.isLoggedIn = true;
                if (typeof window.showApp === 'function') window.showApp();
                
                // Tải dữ liệu giao diện
                loadAllDataFromDrive();
            }
        },
    });
    
    // Kiểm tra xem trước đó đã đăng nhập chưa (Chạy mỗi khi F5)
    const savedTokenStr = localStorage.getItem('gapi_token');
    if (savedTokenStr) {
        try {
            const savedToken = JSON.parse(savedTokenStr);
            // Gán lại token đang có trên trình duyệt cho gapi
            if (gapi.client) {
                gapi.client.setToken(savedToken);
                AppState.isLoggedIn = true;
                if (typeof window.showApp === 'function') window.showApp();
                
                // Tải dữ liệu ngầm sau khi khôi phục đăng nhập
                loadAllDataFromDrive();
            }
        } catch (e) {
            console.error("Lỗi parse token:", e);
            localStorage.removeItem('gapi_token');
            if (typeof window.showLogin === 'function') window.showLogin();
        }
    }
}

// Gọi API lấy dữ liệu Settings và Calendar
function loadAllDataFromDrive() {
    if (typeof window.loadSettingsFromDrive === 'function') window.loadSettingsFromDrive();
    if (typeof window.loadScheduleFromDrive === 'function') window.loadScheduleFromDrive();
    if (typeof window.loadProductivityFromDrive === 'function') window.loadProductivityFromDrive();
}

// 6. Xử lý nút Click Đăng nhập 
window.handleAuthClick = function() {
    if (tokenClient) {
        tokenClient.requestAccessToken({prompt: 'consent'});
    } else {
        alert("Hệ thống Google đang được kết nối, vui lòng F5 và chờ trong giây lát.");
    }
}

// 7. Xử lý nút Click Đăng xuất
window.handleSignoutClick = function() {
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

window.syncShiftToGoogle = async function(dateStr, shiftCode, shiftTime, description) {
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
        'summary': `Ca: ${shiftCode} - Chính chủ`, 
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

window.syncTaskToGoogle = async function(taskTitle, taskNotes, dueDateStr) {
    if (!AppState.isLoggedIn || !gapi.client) return;
    
    try {
        const task = {
            title: taskTitle,
            notes: taskNotes,
            due: `${dueDateStr}T00:00:00.000Z`
        };
        
        await gapi.client.tasks.tasks.insert({
            tasklist: '@default',
            resource: task
        });
        console.log(`Đã đồng bộ Task [${taskTitle}] thành công.`);
    } catch (err) {
        console.error("Lỗi đồng bộ Task: ", err);
    }
};

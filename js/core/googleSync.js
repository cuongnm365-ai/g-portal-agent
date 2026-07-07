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

// Đã bổ sung đủ quyền Tasks, Calendar, Drive để thực hiện đồng bộ (Sửa lỗi không đồng bộ task)
const SCOPES = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/tasks';

let tokenClient; 
let gapiInited = false;

// 1. Hàm Tải GAPI
function gapiLoaded() {
    gapi.load('client', initializeGapiClient);
}

// 2. Khởi tạo GAPI Client
async function initializeGapiClient() {
    await gapi.client.init({
        apiKey: API_KEY,
        discoveryDocs: DISCOVERY_DOCS,
    });
    gapiInited = true;
}

// 3. Hàm tải Google Identity Services (GIS)
function gisLoaded() {
    initGoogleAuth();
}

// 4. Khởi tạo xác thực Google (Tự động đăng nhập lại khi F5 / Reload trang)
function initGoogleAuth() {
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: (tokenResponse) => {
            if (tokenResponse && tokenResponse.access_token) {
                // Đăng nhập thành công, lưu token vào máy tính
                localStorage.setItem('gapi_token', JSON.stringify(tokenResponse));
                gapi.client.setToken(tokenResponse);
                AppState.isLoggedIn = true;
                window.showApp();
                
                // Tự động tải lại dữ liệu ngầm từ Drive
                if (typeof window.loadSettingsFromDrive === 'function') window.loadSettingsFromDrive();
                if (typeof window.loadScheduleFromDrive === 'function') window.loadScheduleFromDrive();
                if (typeof window.loadProductivityFromDrive === 'function') window.loadProductivityFromDrive();
            }
        },
    });
    
    // Kiểm tra xem trước đó đã đăng nhập chưa (Chạy mỗi khi F5)
    const savedTokenStr = localStorage.getItem('gapi_token');
    if (savedTokenStr) {
        try {
            const savedToken = JSON.parse(savedTokenStr);
            // Gán lại token đang có trên trình duyệt cho gapi
            gapi.client.setToken(savedToken);
            AppState.isLoggedIn = true;
            window.showApp();
            
            // Tải dữ liệu ngầm sau khi khôi phục đăng nhập
            if (typeof window.loadSettingsFromDrive === 'function') window.loadSettingsFromDrive();
            if (typeof window.loadScheduleFromDrive === 'function') window.loadScheduleFromDrive();
            if (typeof window.loadProductivityFromDrive === 'function') window.loadProductivityFromDrive();
        } catch (e) {
            console.error("Lỗi parse token:", e);
            localStorage.removeItem('gapi_token');
            window.showLogin();
        }
    }
}

// 5. Xử lý nút Click Đăng nhập 
window.handleAuthClick = function() {
    if (tokenClient) {
        tokenClient.requestAccessToken({prompt: 'consent'});
    }
}

// 6. Xử lý nút Click Đăng xuất
window.handleSignoutClick = function() {
    const token = gapi.client.getToken();
    if (token !== null) {
        google.accounts.oauth2.revoke(token.access_token, () => {
            console.log('Đã thu hồi quyền truy cập (Revoked token)');
        });
        gapi.client.setToken('');
    }
    // Xóa session ở trình duyệt
    localStorage.removeItem('gapi_token'); 
    AppState.isLoggedIn = false;
    window.showLogin();
};

// ========================================================
// PHẦN LOGIC ĐỒNG BỘ LỊCH VÀ TASKS (Đã bao gồm hàm chuẩn hóa)
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
    if (!AppState.isLoggedIn) return;
    
    // Xóa sự kiện cũ trong ngày trước khi đồng bộ cái mới
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
    if (!AppState.isLoggedIn) return;
    
    // Hàm đẩy task lên Google Tasks sử dụng gapi.client.tasks
    try {
        const task = {
            title: taskTitle,
            notes: taskNotes,
            due: `${dueDateStr}T00:00:00.000Z`
        };
        
        await gapi.client.tasks.tasks.insert({
            tasklist: '@default', // Lưu vào danh sách Mặc định của người dùng
            resource: task
        });
        console.log(`Đã đồng bộ Task [${taskTitle}] thành công.`);
    } catch (err) {
        console.error("Lỗi đồng bộ Task: ", err);
    }
};

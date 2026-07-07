/**
 * googleSync.js - Google OAuth & API Initialization
 * Quản lý: OAuth initialization, API discovery, Token callback
 */

const CLIENT_ID = '780344267458-j0ti8pkkofqer8p4m13jmkte3ln64c6h.apps.googleusercontent.com';
const API_KEY = 'AIzaSyAsSD-DmNUjATuf8gjWlvq7LbUWaF6IHL4';

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

const SCOPES = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/tasks https://www.googleapis.com/auth/userinfo.profile';

let tokenClient;
let gapiInited = false;

document.addEventListener('DOMContentLoaded', () => {
    const checkGoogleLoaded = setInterval(() => {
        if (window.gapi && window.google) {
            clearInterval(checkGoogleLoaded);
            initializeGoogleSync();
        }
    }, 100);
});

/**
 * Khởi tạo Google Sync - Load client library và OAuth2
 */
function initializeGoogleSync() {
    console.log('Initializing Google Sync...');
    
    gapi.load('client', intializeGapiClient);
    
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: handleTokenResponse, // Gọi hàm trong auth.js
    });
    
    console.log('✓ Google Sync initialized');
}

/**
 * Khởi tạo GAPI client
 */
async function intializeGapiClient() {
    try {
        await gapi.client.init({ 
            apiKey: API_KEY, 
            discoveryDocs: DISCOVERY_DOCS 
        });
        gapiInited = true;
        console.log('✓ GAPI Client initialized');
    } catch (error) {
        console.error('Error initializing GAPI:', error);
    }
}

/**
 * Lưu JSON file lên Google Drive (Create or Update)
 */
async function saveJsonToDrive(fileName, jsonData, targetFolderId) {
    if (!targetFolderId) {
        console.warn('targetFolderId not specified');
        return;
    }

    try {
        // Kiểm tra file đã tồn tại chưa
        let checkRes = await gapi.client.drive.files.list({
            q: `'${targetFolderId}' in parents and name='${fileName}' and trashed=false`,
            fields: 'files(id)'
        });

        const fileContent = JSON.stringify(jsonData, null, 2);
        const fileMetadata = { name: fileName, mimeType: 'application/json' };
        const boundary = '-------314159265358979323846';
        const delimiter = "\r\n--" + boundary + "\r\n";
        const close_delim = "\r\n--" + boundary + "--";

        let multipartRequestBody = delimiter + 
            'Content-Type: application/json\r\n\r\n' + 
            JSON.stringify(fileMetadata) + 
            delimiter + 
            'Content-Type: application/json\r\n\r\n' + 
            fileContent + 
            close_delim;

        if (checkRes.result.files && checkRes.result.files.length > 0) {
            // Update file
            let fileId = checkRes.result.files[0].id;
            await gapi.client.request({
                path: `/upload/drive/v3/files/${fileId}`,
                method: 'PATCH',
                params: { uploadType: 'multipart' },
                headers: { 'Content-Type': `multipart/related; boundary="${boundary}"` },
                body: multipartRequestBody
            });
            console.log(`✓ Updated ${fileName} on Drive`);
        } else {
            // Create new file
            fileMetadata.parents = [targetFolderId];
            multipartRequestBody = delimiter + 
                'Content-Type: application/json\r\n\r\n' + 
                JSON.stringify(fileMetadata) + 
                delimiter + 
                'Content-Type: application/json\r\n\r\n' + 
                fileContent + 
                close_delim;
            
            await gapi.client.request({
                path: '/upload/drive/v3/files',
                method: 'POST',
                params: { uploadType: 'multipart' },
                headers: { 'Content-Type': `multipart/related; boundary="${boundary}"` },
                body: multipartRequestBody
            });
            console.log(`✓ Created ${fileName} on Drive`);
        }
    } catch (err) {
        console.error("Lỗi Drive:", err);
        throw err;
    }
}

/**
 * Đọc JSON file từ Google Drive
 */
async function getJsonFromDrive(fileName, targetFolderId) {
    if (!targetFolderId) {
        console.warn('targetFolderId not specified');
        return null;
    }

    try {
        let checkRes = await gapi.client.drive.files.list({
            q: `'${targetFolderId}' in parents and name='${fileName}' and trashed=false`,
            fields: 'files(id)'
        });

        if (checkRes.result.files && checkRes.result.files.length > 0) {
            let fileId = checkRes.result.files[0].id;
            let response = await gapi.client.drive.files.get({ 
                fileId: fileId, 
                alt: 'media' 
            });
            return response.result;
        }
        return null;
    } catch (err) {
        console.error('Lỗi đọc Drive:', err);
        return null;
    }
}

/**
 * Đồng bộ sự kiện lên Google Calendar
 */
async function syncCalendarEvent(dateStr, shiftCode, shiftTime, description) {
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
            'description': description || '',
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
            // Update existing event
            await gapi.client.calendar.events.update({
                'calendarId': 'primary',
                'eventId': events[0].id,
                'resource': event
            });
            console.log(`✓ Updated calendar event for ${dateStr}`);
        } else {
            // Create new event
            await gapi.client.calendar.events.insert({
                'calendarId': 'primary',
                'resource': event
            });
            console.log(`✓ Created calendar event for ${dateStr}`);
        }
    } catch (err) {
        console.error("Lỗi Calendar:", err);
    }
}

/**
 * Xóa sự kiện khỏi Google Calendar
 */
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
            await gapi.client.calendar.events.delete({
                'calendarId': 'primary',
                'eventId': events[0].id
            });
            console.log(`✓ Deleted calendar event for ${dateStr}`);
        }
    } catch (err) {
        console.error("Lỗi xóa Calendar:", err);
    }
}

/**
 * Đồng bộ công việc lên Google Tasks
 */
async function syncGoogleTask(dateStr, taskTitle) {
    try {
        let response = await gapi.client.tasks.tasks.list({
            'tasklist': '@default',
            'dueMin': `${dateStr}T00:00:00.000Z`,
            'dueMax': `${dateStr}T23:59:59.000Z`
        });

        const tasks = response.result.items || [];
        const taskBody = { 
            'title': `PCCV: ${taskTitle}`,
            'due': `${dateStr}T00:00:00.000Z`
        };

        if (tasks.length > 0) {
            let targetTask = tasks.find(t => t.title && t.title.startsWith('PCCV:'));
            
            if (targetTask) {
                targetTask.title = taskBody.title;
                await gapi.client.tasks.tasks.update({
                    'tasklist': '@default',
                    'task': targetTask.id,
                    'resource': targetTask
                });
                console.log(`✓ Updated Google Task for ${dateStr}`);
                return;
            }
        }
        
        // Create new task
        await gapi.client.tasks.tasks.insert({
            'tasklist': '@default',
            'resource': taskBody
        });
        console.log(`✓ Created Google Task for ${dateStr}`);
    } catch (err) {
        console.error("Lỗi Tasks:", err);
    }
}

/**
 * Xóa công việc khỏi Google Tasks
 */
async function deleteGoogleTask(dateStr, taskTitle) {
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
        console.error("Lỗi xóa Task:", err);
    }
}

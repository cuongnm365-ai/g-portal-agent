const CLIENT_ID = '764929266866-62ua4ratuu6jimphrullociovmcdmkq9.apps.googleusercontent.com';
const API_KEY = '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';

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

document.addEventListener('DOMContentLoaded', () => {
    const checkGoogleLoaded = setInterval(() => {
        if (window.gapi && window.google) {
            clearInterval(checkGoogleLoaded);
            initializeGoogleSync();
        }
    }, 100);
});

function initializeGoogleSync() {
    gapi.load('client', intializeGapiClient);
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: (tokenResponse) => {
            if (tokenResponse.error !== undefined) throw (tokenResponse);
            AppState.isLoggedIn = true;
            document.getElementById('auth-btn-text').innerText = "Đã kết nối Google";
            document.getElementById('btn-google-auth').style.background = "#10b981";
            
            // Kích hoạt load dữ liệu
            if (typeof loadSettingsFromDrive === 'function') loadSettingsFromDrive();
            if (typeof loadScheduleFromDrive === 'function') loadScheduleFromDrive();
            if (typeof loadProductivityFromDrive === 'function') loadProductivityFromDrive();
        },
    });
    document.getElementById('btn-google-auth').addEventListener('click', handleAuthClick);
}

async function intializeGapiClient() {
    await gapi.client.init({ apiKey: API_KEY, discoveryDocs: DISCOVERY_DOCS });
    gapiInited = true;
}

function handleAuthClick() {
    if (!AppState.isLoggedIn) {
        if (gapi.client.getToken() === null) tokenClient.requestAccessToken({prompt: 'consent'});
        else tokenClient.requestAccessToken({prompt: ''});
    } else {
        const token = gapi.client.getToken();
        if (token !== null) {
            google.accounts.oauth2.revoke(token.access_token);
            gapi.client.setToken('');
            AppState.isLoggedIn = false;
            document.getElementById('auth-btn-text').innerText = "Đăng nhập Google";
            document.getElementById('btn-google-auth').style.background = "#ea4335";
        }
    }
}

async function saveJsonToDrive(fileName, jsonData, targetFolderId) {
    if (!targetFolderId) return;
    try {
        let checkRes = await gapi.client.drive.files.list({
            q: `'${targetFolderId}' in parents and name='${fileName}' and trashed=false`,
            fields: 'files(id)'
        });
        const fileContent = JSON.stringify(jsonData);
        const fileMetadata = { name: fileName, mimeType: 'application/json' };
        const boundary = '-------314159265358979323846';
        const delimiter = "\r\n--" + boundary + "\r\n";
        const close_delim = "\r\n--" + boundary + "--";

        let multipartRequestBody = delimiter + 'Content-Type: application/json\r\n\r\n' + JSON.stringify(fileMetadata) + delimiter + 'Content-Type: application/json\r\n\r\n' + fileContent + close_delim;

        if (checkRes.result.files.length > 0) {
            let fileId = checkRes.result.files[0].id;
            await gapi.client.request({
                path: `/upload/drive/v3/files/${fileId}`,
                method: 'PATCH',
                params: {uploadType: 'multipart'},
                headers: {'Content-Type': `multipart/related; boundary="${boundary}"`},
                body: multipartRequestBody
            });
        } else {
            fileMetadata.parents = [targetFolderId];
            multipartRequestBody = delimiter + 'Content-Type: application/json\r\n\r\n' + JSON.stringify(fileMetadata) + delimiter + 'Content-Type: application/json\r\n\r\n' + fileContent + close_delim;
            await gapi.client.request({
                path: '/upload/drive/v3/files',
                method: 'POST',
                params: {uploadType: 'multipart'},
                headers: {'Content-Type': `multipart/related; boundary="${boundary}"`},
                body: multipartRequestBody
            });
        }
    } catch (err) { console.error("Lỗi Drive:", err); }
}

async function getJsonFromDrive(fileName, targetFolderId) {
    if (!targetFolderId) return null;
    try {
        let checkRes = await gapi.client.drive.files.list({
            q: `'${targetFolderId}' in parents and name='${fileName}' and trashed=false`,
            fields: 'files(id)'
        });
        if (checkRes.result.files.length > 0) {
            let fileId = checkRes.result.files[0].id;
            let response = await gapi.client.drive.files.get({ fileId: fileId, alt: 'media' });
            return response.result;
        }
        return null;
    } catch (err) { return null; }
}

async function syncCalendarEvent(dateStr, shiftCode, shiftTime, description) {
    try {
        let startTimeStr = "08:00:00";
        let endTimeStr = "17:00:00";
        if(shiftTime && shiftTime.includes("-")) {
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
            'calendarId': 'primary', 'timeMin': minTime, 'timeMax': maxTime, 'q': 'Ca:', 'singleEvents': true
        });
        const events = response.result.items;
        if (events && events.length > 0) {
            await gapi.client.calendar.events.update({ 'calendarId': 'primary', 'eventId': events[0].id, 'resource': event });
        } else {
            await gapi.client.calendar.events.insert({ 'calendarId': 'primary', 'resource': event });
        }
    } catch (err) { console.error("Lỗi Calendar:", err); }
}

async function deleteCalendarEvent(dateStr) {
    try {
        const minTime = `${dateStr}T00:00:00+07:00`;
        const maxTime = `${dateStr}T23:59:59+07:00`;
        let response = await gapi.client.calendar.events.list({
            'calendarId': 'primary', 'timeMin': minTime, 'timeMax': maxTime, 'q': 'Ca:', 'singleEvents': true
        });
        const events = response.result.items;
        if (events && events.length > 0) {
            await gapi.client.calendar.events.delete({ 'calendarId': 'primary', 'eventId': events[0].id });
        }
    } catch (err) { console.error("Lỗi xóa Calendar:", err); }
}

async function syncGoogleTask(dateStr, taskTitle) {
    try {
        let response = await gapi.client.tasks.tasks.list({
            'tasklist': '@default', 'dueMin': `${dateStr}T00:00:00.000Z`, 'dueMax': `${dateStr}T23:59:59.000Z`
        });
        const tasks = response.result.items;
        const taskBody = { 'title': `PCCV: ${taskTitle}`, 'due': `${dateStr}T00:00:00.000Z` };

        if (tasks && tasks.length > 0) {
            let targetTask = tasks.find(t => t.title.startsWith('PCCV:'));
            if(targetTask) {
                targetTask.title = taskBody.title;
                await gapi.client.tasks.tasks.update({ 'tasklist': '@default', 'task': targetTask.id, 'resource': targetTask });
                return;
            }
        } 
        await gapi.client.tasks.tasks.insert({ 'tasklist': '@default', 'resource': taskBody });
    } catch (err) { console.error("Lỗi Tasks:", err); }
}
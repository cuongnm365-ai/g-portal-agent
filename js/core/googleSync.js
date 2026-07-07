const CLIENT_ID = '764929266866-62ua4ratuu6jimphrullociovmcdmkq9.apps.googleusercontent.com';
// CẢNH BÁO: Hãy thay giá trị dưới đây bằng API KEY thật (bắt đầu bằng AIzaSy...) lấy từ Google Cloud
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

const SCOPES = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/tasks';

// FIX LỖI: Chuyển hẳn sang đối tượng window để các file JS khác dùng chung
window.tokenClient = null; 
let gapiInited = false;
let gsiInited = false;

// Hàm tự kích hoạt khi script gsi tải xong
window.gsiInit = function() {
    try {
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
        console.log('✓ Google GSI Token Client đã sẵn sàng.');
        checkAuthReady();
    } catch (err) {
        console.error('Lỗi khởi tạo GSI:', err);
    }
};

// Hàm tự kích hoạt khi script api tải xong
window.gapiInit = function() {
    try {
        gapi.load('client', async () => {
            await gapi.client.init({
                apiKey: API_KEY,
                discoveryDocs: DISCOVERY_DOCS,
            });
            gapiInited = true;
            console.log('✓ Google GAPI Client đã sẵn sàng.');
            checkAuthReady();
        });
    } catch (err) {
        console.error('Lỗi khởi tạo GAPI:', err);
    }
};

// Kiểm tra khi cả 2 thư viện đã load thành công mới khôi phục phiên đăng nhập cũ
function checkAuthReady() {
    if (gapiInited && gsiInited) {
        console.log('✓ [G-Portal] Toàn bộ hệ thống API Google đã kết nối thành công!');
        if (typeof checkExistingToken === 'function') {
            checkExistingToken();
        }
    }
}

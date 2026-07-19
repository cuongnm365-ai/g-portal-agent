/**
 * drive.js - Google Drive Data Persistence
 * Quản lý: Load Settings, Save/Load Schedule, Save/Load Productivity
 */

/**
 * 1. Hàm Cốt lõi: Lấy file JSON từ một Folder cụ thể trên Drive
 */
window.getJsonFromDrive = async function(fileName, folderId) {
    try {
        const response = await gapi.client.drive.files.list({
            q: `name='${fileName}' and '${folderId}' in parents and trashed=false`,
            spaces: 'drive',
            fields: 'files(id, name)'
        });

        const files = response.result.files;
        if (files && files.length > 0) {
            const fileId = files[0].id;
            const fileData = await gapi.client.drive.files.get({
                fileId: fileId,
                alt: 'media'
            });
            return fileData.result;
        }
        return null;
    } catch (err) {
        console.error(`Lỗi tải file ${fileName}:`, err);
        return null;
    }
};

/**
 * 2. Hàm Cốt lõi: Lưu file JSON vào một Folder cụ thể (Ghi đè nếu đã tồn tại)
 */
window.saveJsonToDrive = async function(fileName, dataObj, folderId) {
    try {
        if (!folderId) {
            console.error(`Không tìm thấy Folder ID cho file ${fileName}`);
            return;
        }

        const response = await gapi.client.drive.files.list({
            q: `name='${fileName}' and '${folderId}' in parents and trashed=false`,
            spaces: 'drive',
            fields: 'files(id, name)'
        });

        const files = response.result.files;
        const fileContent = JSON.stringify(dataObj, null, 2);

        const file = new Blob([fileContent], { type: 'application/json' });
        const metadata = {
            name: fileName,
            mimeType: 'application/json'
        };

        let uploadUrl = '';
        let method = '';

        if (files && files.length > 0) {
            const fileId = files[0].id;
            uploadUrl = `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`;
            method = 'PATCH';
        } else {
            metadata.parents = [folderId];
            uploadUrl = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
            method = 'POST';
        }

        const form = new FormData();
        form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
        form.append('file', file);

        const token = gapi.client.getToken().access_token;
        const res = await fetch(uploadUrl, {
            method: method,
            headers: new Headers({ 'Authorization': 'Bearer ' + token }),
            body: form
        });

        if (res.ok) {
            console.log(`✓ Đã lưu thành công ${fileName} vào thư mục ${folderId}`);
        } else {
            console.error(`❌ Lỗi khi lưu ${fileName}:`, await res.text());
        }
    } catch (err) {
        console.error(`❌ Lỗi hệ thống khi lưu ${fileName}:`, err);
    }
};

/**
 * 3. Load cấu hình (Settings) từ Google Drive
 */
window.loadSettingsFromDrive = async function() {
    if (!window.GPORTAL_FOLDERS || !AppState.isLoggedIn) return;
    console.log('Đang tải Settings từ Drive...');

    try {
        const settingsData = await getJsonFromDrive('settings.json', window.GPORTAL_FOLDERS.settings);
        if (settingsData) {
            window.portalSettings = settingsData;
            console.log('✓ Đã load Settings thành công.');
            if (typeof renderSettingsUI === 'function') renderSettingsUI();
            if (typeof renderSettings === 'function') renderSettings();
        } else {
            if(typeof getDefaultSettings === 'function') {
                window.portalSettings = getDefaultSettings();
            }
        }
    } catch (error) {
        console.error('Lỗi load Settings:', error);
    }
};

/**
 * 4. Lưu cấu hình (Settings) lên Google Drive
 */
window.saveSettingsToDrive = async function(settingsData) {
    if (!window.GPORTAL_FOLDERS || !AppState.isLoggedIn) return;
    try {
        await saveJsonToDrive('settings.json', settingsData, window.GPORTAL_FOLDERS.settings);
        window.portalSettings = settingsData;
    } catch (error) {
        console.error('Lỗi lưu Settings:', error);
    }
};

/**
 * 5. Các hàm xóa phần tử trong Cấu Hình (Settings)
 */
window.deleteShift = async function(shiftCode) {
    if (!window.portalSettings || !window.portalSettings.shifts) return;
    window.portalSettings.shifts = window.portalSettings.shifts.filter(s => s.code !== shiftCode);
    await window.saveSettingsToDrive(window.portalSettings);
    if (typeof renderSettingsUI === 'function') renderSettingsUI();
    if (typeof renderSettings === 'function') renderSettings();
};

window.deleteOTShift = async function(otCode) {
    if (!window.portalSettings || !window.portalSettings.otShifts) return;
    window.portalSettings.otShifts = window.portalSettings.otShifts.filter(s => s.code !== otCode);
    await window.saveSettingsToDrive(window.portalSettings);
    if (typeof renderSettingsUI === 'function') renderSettingsUI();
    if (typeof renderSettings === 'function') renderSettings();
};

window.deleteTask = async function(taskCode) {
    if (!window.portalSettings || !window.portalSettings.tasks) return;
    window.portalSettings.tasks = window.portalSettings.tasks.filter(t => t.code !== taskCode);
    await window.saveSettingsToDrive(window.portalSettings);
    if (typeof renderSettingsUI === 'function') renderSettingsUI();
    if (typeof renderSettings === 'function') renderSettings();
};

window.deleteStaff = async function(staffId) {
    if (!window.portalSettings || !window.portalSettings.staffs) return;
    window.portalSettings.staffs = window.portalSettings.staffs.filter(s => s.id !== staffId);
    await window.saveSettingsToDrive(window.portalSettings);
    if (typeof renderSettingsUI === 'function') renderSettingsUI();
    if (typeof renderSettings === 'function') renderSettings();
};

// Lưu ý: Các hàm loadScheduleFromDrive và loadProductivityFromDrive đã được xử lý
// tách biệt trong schedule.js và productivity.js.

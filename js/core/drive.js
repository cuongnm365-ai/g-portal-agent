/**
 * drive.js - Google Drive Data Persistence
 * Quản lý: Load Settings, Save/Load Schedule, Save/Load Productivity
 *
 * BẢN VÁ LỖI: "Đổi ca / Trực hộ không hiện danh sách nhân sự + popup hiệu
 * chỉnh lịch bị treo"
 * -------------------------------------------------------------------------
 * NGUYÊN NHÂN: loadSettingsFromDrive() trước đây GHI ĐÈ TOÀN BỘ
 * window.portalSettings bằng đúng những gì đọc được từ settings.json trên
 * Drive, không merge với getDefaultSettings() như loadLocalSettings() vẫn
 * làm. Nếu file settings.json trên Drive được tạo từ trước khi có tính năng
 * Nhân sự (hoặc thiếu field nào đó vì lý do bất kỳ), window.portalSettings
 * .staffs sẽ là undefined -> dropdown chọn người Đổi ca/Trực hộ trong modal
 * hiệu chỉnh lịch build ra rỗng, không có ai để chọn.
 *
 * FIX: sau khi tải từ Drive, luôn Object.assign với getDefaultSettings() rồi
 * đảm bảo từng mảng con (shifts/otShifts/tasks/staffs) và coefficients luôn
 * tồn tại hợp lệ, bất kể file trên Drive cũ/mới/thiếu field.
 * -------------------------------------------------------------------------
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
 *    FIX: luôn merge với getDefaultSettings() + đảm bảo từng mảng con hợp lệ,
 *    để tránh trường hợp file cũ trên Drive thiếu field (VD "staffs") khiến
 *    các dropdown liên quan (Đổi ca/Trực hộ) bị trống.
 */
window.loadSettingsFromDrive = async function() {
    if (!window.GPORTAL_FOLDERS || !AppState.isLoggedIn) return;
    console.log('Đang tải Settings từ Drive...');

    const defaults = (typeof getDefaultSettings === 'function') ? getDefaultSettings() : {
        shifts: [], otShifts: [], tasks: [], staffs: [],
        coefficients: { saModifier: 3, kpiTarget: 2000, coeffOtCong: 0.5 }
    };

    try {
        const settingsData = await getJsonFromDrive('settings.json', window.GPORTAL_FOLDERS.settings);

        // Merge: dữ liệu thật từ Drive được ưu tiên, nhưng field nào thiếu thì
        // lấy từ mặc định — không bao giờ để undefined lọt xuống UI.
        const merged = Object.assign({}, defaults, settingsData || {});
        merged.shifts = Array.isArray(merged.shifts) ? merged.shifts : (defaults.shifts || []);
        merged.otShifts = Array.isArray(merged.otShifts) ? merged.otShifts : (defaults.otShifts || []);
        merged.tasks = Array.isArray(merged.tasks) ? merged.tasks : (defaults.tasks || []);
        merged.staffs = Array.isArray(merged.staffs) ? merged.staffs : (defaults.staffs || []);
        merged.coefficients = Object.assign({}, defaults.coefficients, merged.coefficients || {});

        window.portalSettings = merged;
        console.log(`✓ Đã load Settings thành công. (Nhân sự: ${merged.staffs.length}, Ca: ${merged.shifts.length}, OT: ${merged.otShifts.length}, PCCV: ${merged.tasks.length})`);

        if (typeof renderSettingsUI === 'function') renderSettingsUI();
        if (typeof renderSettings === 'function') renderSettings();

        // Nếu Drive vốn dĩ chưa có file settings.json (settingsData === null),
        // hoặc file thiếu field -> lưu lại ngay bản đã merge lên Drive để các
        // lần load sau không còn thiếu nữa.
        if (!settingsData || Object.keys(settingsData).length < Object.keys(defaults).length) {
            window.saveSettingsToDrive(merged);
        }
    } catch (error) {
        console.error('Lỗi load Settings:', error);
        // Dù lỗi mạng/API, vẫn phải đảm bảo có 1 bộ Settings hợp lệ trong bộ
        // nhớ, nếu không các màn hình khác (VD modal hiệu chỉnh lịch) sẽ bị
        // treo vì window.portalSettings undefined.
        if (!window.portalSettings) {
            window.portalSettings = defaults;
            if (typeof renderSettingsUI === 'function') renderSettingsUI();
        }
        alert('Không thể tải Cấu hình (Ca làm việc/Nhân sự/PCCV) từ Google Drive. Vui lòng kiểm tra kết nối mạng và thử tải lại trang. Trong lúc chờ, hệ thống đang dùng cấu hình tạm.');
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
        alert('Có lỗi khi lưu Cấu hình lên Google Drive. Vui lòng thử lại.');
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

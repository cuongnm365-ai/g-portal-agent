/**
 * settings.js - Settings Module
 * Quản lý: Shifts, OT Shifts, Tasks, Staffs, Coefficients
 * Tương tác: Google Drive qua drive.js
 */

document.addEventListener('DOMContentLoaded', () => {
    try { 
        initSettingsEvents(); 
    } catch (e) { 
        console.error('initSettingsEvents error:', e); 
    }
});

/**
 * Khởi tạo tất cả event listeners cho Settings
 */
function initSettingsEvents() {
    // === CA LÀM VIỆC ===
    document.getElementById('btn-add-shift')?.addEventListener('click', addShift);
    document.getElementById('btn-tpl-shift')?.addEventListener('click', downloadShiftTemplate);
    document.getElementById('import-shift')?.addEventListener('change', importShiftFromExcel);

    // === CA TĂNG CƯỜNG (OT) ===
    document.getElementById('btn-add-otshift')?.addEventListener('click', addOTShift);
    document.getElementById('btn-tpl-otshift')?.addEventListener('click', downloadOTShiftTemplate);
    document.getElementById('import-otshift')?.addEventListener('change', importOTShiftFromExcel);

    // === PHÂN CÔNG CÔNG VIỆC (PCCV) ===
    document.getElementById('btn-add-task')?.addEventListener('click', addTask);
    document.getElementById('btn-tpl-task')?.addEventListener('click', downloadTaskTemplate);
    document.getElementById('import-task')?.addEventListener('change', importTaskFromExcel);

    // === NHÂN SỰ ===
    document.getElementById('btn-add-staff')?.addEventListener('click', addStaff);
    document.getElementById('btn-tpl-staff')?.addEventListener('click', downloadStaffTemplate);
    document.getElementById('import-staff')?.addEventListener('change', importStaffFromExcel);

    // === THAM SỐ KPI ===
    document.getElementById('btn-save-coeff')?.addEventListener('click', saveCoefficients);

    // Load settings từ Drive khi trang tải
    if (typeof AppState !== 'undefined' && AppState.isLoggedIn) {
        if (typeof loadSettingsFromDrive === 'function') {
            loadSettingsFromDrive();
        }
    }
}

// ==================== CA LÀM VIỆC ====================

/**
 * Thêm ca làm việc mới
 */
function addShift() {
    const code = document.getElementById('shift-code')?.value.trim();
    const name = document.getElementById('shift-name')?.value.trim() || '';
    const time = document.getElementById('shift-time')?.value.trim();

    if (!code || !time) {
        alert('Vui lòng nhập Mã Ca và Thời gian!');
        return;
    }

    if (!window.portalSettings) window.portalSettings = getDefaultSettings();
    if (!window.portalSettings.shifts) window.portalSettings.shifts = [];

    // Check duplicate
    if (window.portalSettings.shifts.find(s => s.code === code)) {
        alert('Mã Ca đã tồn tại!');
        return;
    }

    // Tạo màu random
    const colors = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#06b6d4'];
    const color = colors[Math.floor(Math.random() * colors.length)];

    window.portalSettings.shifts.push({ code, name, time, color });
    saveSettingsToDriveAndRefresh();

    // Clear inputs
    document.getElementById('shift-code').value = '';
    document.getElementById('shift-name').value = '';
    document.getElementById('shift-time').value = '';
}

/**
 * Tải file mẫu Ca làm việc
 */
function downloadShiftTemplate() {
    const ws_data = [
        ["Mã Ca", "Tên Ca", "Thời gian", "Ghi chú"],
        ["S1", "Ca sáng", "07:15 - 14:45", ""],
        ["S2", "Ca chiều", "14:45 - 22:15", ""],
        ["S3", "Ca tối", "22:15 - 07:15", ""]
    ];

    const ws = XLSX.utils.aoa_to_sheet(ws_data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "CaLamViec");
    XLSX.writeFile(wb, "Mau_CaLamViec.xlsx");
}

/**
 * Import ca làm việc từ Excel
 */
function importShiftFromExcel(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const data = new Uint8Array(e.target.result);
            const wb = XLSX.read(data, { type: 'array' });
            const rawJson = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);

            if (!window.portalSettings) window.portalSettings = getDefaultSettings();
            if (!window.portalSettings.shifts) window.portalSettings.shifts = [];

            rawJson.forEach(row => {
                const code = row['Mã Ca'] || row['Code'];
                const name = row['Tên Ca'] || row['Name'] || '';
                const time = row['Thời gian'] || row['Time'];

                if (code && time) {
                    if (!window.portalSettings.shifts.find(s => s.code === code)) {
                        const colors = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981'];
                        const color = colors[Math.floor(Math.random() * colors.length)];
                        window.portalSettings.shifts.push({ code, name, time, color });
                    }
                }
            });

            saveSettingsToDriveAndRefresh();
            alert('✓ Import Ca làm việc thành công!');
        } catch (err) {
            console.error('Lỗi import:', err);
            alert('Lỗi đọc file Excel!');
        } finally {
            event.target.value = '';
        }
    };
    reader.readAsArrayBuffer(file);
}

// ==================== CA TĂNG CƯỜNG (OT) ====================

/**
 * Thêm ca tăng cường mới
 */
function addOTShift() {
    const code = document.getElementById('otshift-code')?.value.trim();
    const name = document.getElementById('otshift-name')?.value.trim() || '';
    const time = document.getElementById('otshift-time')?.value.trim();

    if (!code || !time) {
        alert('Vui lòng nhập Mã ca và Thời gian!');
        return;
    }

    if (!window.portalSettings) window.portalSettings = getDefaultSettings();
    if (!window.portalSettings.otShifts) window.portalSettings.otShifts = [];

    if (window.portalSettings.otShifts.find(s => s.code === code)) {
        alert('Mã ca tăng cường đã tồn tại!');
        return;
    }

    const color = '#ea4335'; // Red for OT
    window.portalSettings.otShifts.push({ code, name, time, color });
    saveSettingsToDriveAndRefresh();

    document.getElementById('otshift-code').value = '';
    document.getElementById('otshift-name').value = '';
    document.getElementById('otshift-time').value = '';
}

/**
 * Tải file mẫu Ca tăng cường
 */
function downloadOTShiftTemplate() {
    const ws_data = [
        ["Mã Ca", "Tên Ca", "Thời gian", "Ghi chú"],
        ["S+", "Tăng cường ca", "14:45 - 18:00", ""]
    ];

    const ws = XLSX.utils.aoa_to_sheet(ws_data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "CaTangCuong");
    XLSX.writeFile(wb, "Mau_CaTangCuong.xlsx");
}

/**
 * Import ca tăng cường từ Excel
 */
function importOTShiftFromExcel(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const data = new Uint8Array(e.target.result);
            const wb = XLSX.read(data, { type: 'array' });
            const rawJson = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);

            if (!window.portalSettings) window.portalSettings = getDefaultSettings();
            if (!window.portalSettings.otShifts) window.portalSettings.otShifts = [];

            rawJson.forEach(row => {
                const code = row['Mã Ca'] || row['Code'];
                const name = row['Tên Ca'] || row['Name'] || '';
                const time = row['Thời gian'] || row['Time'];

                if (code && time) {
                    if (!window.portalSettings.otShifts.find(s => s.code === code)) {
                        window.portalSettings.otShifts.push({ code, name, time, color: '#ea4335' });
                    }
                }
            });

            saveSettingsToDriveAndRefresh();
            alert('✓ Import Ca tăng cường thành công!');
        } catch (err) {
            console.error('Lỗi import:', err);
            alert('Lỗi đọc file Excel!');
        } finally {
            event.target.value = '';
        }
    };
    reader.readAsArrayBuffer(file);
}

// ==================== PHÂN CÔNG CÔNG VIỆC (PCCV) ====================

/**
 * Thêm phân công công việc mới
 */
function addTask() {
    const code = document.getElementById('task-code')?.value.trim();
    const name = document.getElementById('task-name')?.value.trim();

    if (!code || !name) {
        alert('Vui lòng nhập Mã và Tên PCCV!');
        return;
    }

    if (!window.portalSettings) window.portalSettings = getDefaultSettings();
    if (!window.portalSettings.tasks) window.portalSettings.tasks = [];

    if (window.portalSettings.tasks.find(t => t.code === code)) {
        alert('Mã PCCV đã tồn tại!');
        return;
    }

    window.portalSettings.tasks.push({ code, name });
    saveSettingsToDriveAndRefresh();

    document.getElementById('task-code').value = '';
    document.getElementById('task-name').value = '';
}

/**
 * Tải file mẫu PCCV
 */
function downloadTaskTemplate() {
    const ws_data = [
        ["Mã", "Tên PCCV", "Ghi chú"],
        ["CHAT", "Chat hỗ trợ", ""],
        ["CALL", "Cuộc gọi ngoài", ""],
        ["ADMIN", "Hành chính", ""]
    ];

    const ws = XLSX.utils.aoa_to_sheet(ws_data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "PCCV");
    XLSX.writeFile(wb, "Mau_PCCV.xlsx");
}

/**
 * Import PCCV từ Excel
 */
function importTaskFromExcel(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const data = new Uint8Array(e.target.result);
            const wb = XLSX.read(data, { type: 'array' });
            const rawJson = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);

            if (!window.portalSettings) window.portalSettings = getDefaultSettings();
            if (!window.portalSettings.tasks) window.portalSettings.tasks = [];

            rawJson.forEach(row => {
                const code = row['Mã'] || row['Code'];
                const name = row['Tên PCCV'] || row['Name'];

                if (code && name) {
                    if (!window.portalSettings.tasks.find(t => t.code === code)) {
                        window.portalSettings.tasks.push({ code, name });
                    }
                }
            });

            saveSettingsToDriveAndRefresh();
            alert('✓ Import PCCV thành công!');
        } catch (err) {
            console.error('Lỗi import:', err);
            alert('Lỗi đọc file Excel!');
        } finally {
            event.target.value = '';
        }
    };
    reader.readAsArrayBuffer(file);
}

// ==================== NHÂN SỰ ====================

/**
 * Thêm nhân sự mới
 */
function addStaff() {
    const id = document.getElementById('staff-id')?.value.trim();
    const name = document.getElementById('staff-name')?.value.trim();

    if (!id || !name) {
        alert('Vui lòng nhập Mã NV và Họ tên!');
        return;
    }

    if (!window.portalSettings) window.portalSettings = getDefaultSettings();
    if (!window.portalSettings.staffs) window.portalSettings.staffs = [];

    if (window.portalSettings.staffs.find(s => s.id === id)) {
        alert('Mã NV đã tồn tại!');
        return;
    }

    window.portalSettings.staffs.push({ id, name });
    saveSettingsToDriveAndRefresh();

    document.getElementById('staff-id').value = '';
    document.getElementById('staff-name').value = '';
}

/**
 * Tải file mẫu Nhân sự
 */
function downloadStaffTemplate() {
    const ws_data = [
        ["Mã NV", "Họ và Tên"],
        ["NV01", "Nguyễn Văn A"],
        ["NV02", "Trần Thị B"]
    ];

    const ws = XLSX.utils.aoa_to_sheet(ws_data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "NhanSu");
    XLSX.writeFile(wb, "Mau_NhanSu.xlsx");
}

/**
 * Import nhân sự từ Excel
 */
function importStaffFromExcel(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const data = new Uint8Array(e.target.result);
            const wb = XLSX.read(data, { type: 'array' });
            const rawJson = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);

            if (!window.portalSettings) window.portalSettings = getDefaultSettings();
            if (!window.portalSettings.staffs) window.portalSettings.staffs = [];

            rawJson.forEach(row => {
                const id = row['Mã NV'] || row['ID'];
                const name = row['Họ và Tên'] || row['Name'];

                if (id && name) {
                    if (!window.portalSettings.staffs.find(s => s.id === id)) {
                        window.portalSettings.staffs.push({ id, name });
                    }
                }
            });

            saveSettingsToDriveAndRefresh();
            alert('✓ Import Nhân sự thành công!');
        } catch (err) {
            console.error('Lỗi import:', err);
            alert('Lỗi đọc file Excel!');
        } finally {
            event.target.value = '';
        }
    };
    reader.readAsArrayBuffer(file);
}

// ==================== THAM SỐ KPI ====================

/**
 * Lưu các tham số KPI và công thức
 */
async function saveCoefficients() {
    if (!window.portalSettings) window.portalSettings = getDefaultSettings();
    if (!window.portalSettings.coefficients) window.portalSettings.coefficients = {};

    const saModifier = parseFloat(document.getElementById('sa-modifier')?.value) || 3;
    const kpiTarget = parseInt(document.getElementById('kpi-target')?.value) || 2000;
    const coeffOtCong = parseFloat(document.getElementById('coeff-ot-cong')?.value) || 0.5;

    window.portalSettings.coefficients = {
        saModifier,
        kpiTarget,
        coeffOtCong
    };

    await saveSettingsToDrive(window.portalSettings);
    alert('✓ Đã lưu Tham số thành công!');
}

// ==================== HELPERS ====================

/**
 * Lấy cấu hình mặc định
 */
function getDefaultSettings() {
    return {
        shifts: [
            { code: 'S1', name: 'Ca sáng', time: '07:15 - 14:45', color: '#3b82f6' },
            { code: 'S2', name: 'Ca chiều', time: '14:45 - 22:15', color: '#8b5cf6' },
            { code: 'S3', name: 'Ca tối', time: '22:15 - 07:15', color: '#ec4899' }
        ],
        otShifts: [
            { code: 'S+', name: 'Tăng cường ca', time: '14:45 - 18:00', color: '#ea4335' }
        ],
        tasks: [
            { code: 'CHAT', name: 'Chat hỗ trợ' },
            { code: 'CALL', name: 'Cuộc gọi ngoài' },
            { code: 'ADMIN', name: 'Hành chính' }
        ],
        staffs: [],
        coefficients: {
            saModifier: 3,
            kpiTarget: 2000,
            coeffOtCong: 0.5
        }
    };
}

/**
 * Lưu settings lên Drive và refresh UI
 */
async function saveSettingsToDriveAndRefresh() {
    if (typeof AppState !== 'undefined' && AppState.isLoggedIn) {
        await saveSettingsToDrive(window.portalSettings);
    }
    
    if (typeof renderSettingsUI === 'function') {
        renderSettingsUI();
    }
}

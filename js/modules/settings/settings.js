/**
 * settings.js - Settings Module
 * Quản lý: Shifts, OT Shifts, Tasks, Staffs, Coefficients
 * Tương tác: Google Drive qua drive.js
 *
 * FIX QUAN TRỌNG (so với bản cũ):
 * - Trước đây mọi nơi trong file này đều gọi renderSettingsUI() để vẽ lại
 *   danh sách Ca làm việc / Ca tăng cường / PCCV / Nhân sự, NHƯNG hàm này
 *   chưa từng được định nghĩa -> toàn bộ trang Cài đặt luôn trống rỗng dù
 *   dữ liệu (window.portalSettings) vẫn tồn tại và được các trang khác
 *   (vd: modal hiệu chỉnh lịch) đọc đúng bình thường.
 * - Đã bổ sung đầy đủ hàm renderSettingsUI() ở cuối file.
 */

// ==================== CƠ CHẾ LOAD DATA & RENDER ĐẦU TIÊN ====================

function loadLocalSettings() {
    // Tải dữ liệu lưu tạm ở máy lên ngay lập tức để giao diện không bị trống
    const saved = localStorage.getItem('gportal_settings');
    if (saved) {
        try {
            window.portalSettings = { ...getDefaultSettings(), ...JSON.parse(saved) };
        } catch (e) {
            window.portalSettings = getDefaultSettings();
        }
    } else {
        window.portalSettings = getDefaultSettings();
    }

    // Ép render ra giao diện (dùng 1 trong 2 tên hàm để chống lỗi)
    if (typeof renderSettingsUI === 'function') renderSettingsUI();
    else if (typeof renderSettings === 'function') renderSettings();
}

document.addEventListener('DOMContentLoaded', () => {
    loadLocalSettings(); // Gọi ngay khi tải trang
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

    // Lưu ý: Tự động tải từ Drive đã được xử lý bên auth.js / googleSync.js
    // khi đăng nhập thành công, nên không gọi lại ở đây để tránh đụng độ.
}

// ==================== CA LÀM VIỆC ====================

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

            let addedCount = 0;
            rawJson.forEach(row => {
                const code = row['Mã Ca'] || row['Code'];
                const name = row['Tên Ca'] || row['Name'] || '';
                const time = row['Thời gian'] || row['Time'];

                if (code && time) {
                    if (!window.portalSettings.shifts.find(s => s.code === code)) {
                        const colors = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981'];
                        const color = colors[Math.floor(Math.random() * colors.length)];
                        window.portalSettings.shifts.push({ code, name, time, color });
                        addedCount++;
                    }
                }
            });

            saveSettingsToDriveAndRefresh();
            alert(`✓ Đã Import thành công ${addedCount} ca làm việc mới!`);
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

    const colors = ['#ea4335', '#f97316', '#eab308', '#14b8a6', '#a855f7'];
    const color = colors[Math.floor(Math.random() * colors.length)];
    window.portalSettings.otShifts.push({ code, name, time, color });
    saveSettingsToDriveAndRefresh();

    document.getElementById('otshift-code').value = '';
    document.getElementById('otshift-name').value = '';
    document.getElementById('otshift-time').value = '';
}

function downloadOTShiftTemplate() {
    const ws_data = [
        ["Mã Ca", "Tên Ca", "Thời gian", "Ghi chú"],
        ["S+", "Tăng cường sáng", "14:45 - 18:00", ""],
        ["T+", "Tăng cường chiều", "22:15 - 02:00", ""],
        ["C+", "Tăng cường tối", "06:00 - 07:15", ""]
    ];

    const ws = XLSX.utils.aoa_to_sheet(ws_data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "CaTangCuong");
    XLSX.writeFile(wb, "Mau_CaTangCuong.xlsx");
}

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

            let addedCount = 0;
            rawJson.forEach(row => {
                const code = row['Mã Ca'] || row['Code'];
                const name = row['Tên Ca'] || row['Name'] || '';
                const time = row['Thời gian'] || row['Time'];

                if (code && time) {
                    if (!window.portalSettings.otShifts.find(s => s.code === code)) {
                        window.portalSettings.otShifts.push({ code, name, time, color: '#ea4335' });
                        addedCount++;
                    }
                }
            });

            saveSettingsToDriveAndRefresh();
            alert(`✓ Đã Import thành công ${addedCount} ca tăng cường mới!`);
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

            let addedCount = 0;
            rawJson.forEach(row => {
                const code = row['Mã'] || row['Code'];
                const name = row['Tên PCCV'] || row['Name'];

                if (code && name) {
                    if (!window.portalSettings.tasks.find(t => t.code === code)) {
                        window.portalSettings.tasks.push({ code, name });
                        addedCount++;
                    }
                }
            });

            saveSettingsToDriveAndRefresh();
            alert(`✓ Đã Import thành công ${addedCount} PCCV mới!`);
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

            let addedCount = 0;
            rawJson.forEach(row => {
                const id = row['Mã NV'] || row['ID'];
                const name = row['Họ và Tên'] || row['Name'];

                if (id && name) {
                    if (!window.portalSettings.staffs.find(s => s.id === id)) {
                        window.portalSettings.staffs.push({ id, name });
                        addedCount++;
                    }
                }
            });

            saveSettingsToDriveAndRefresh();
            alert(`✓ Đã Import thành công ${addedCount} Nhân sự mới!`);
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

    saveSettingsToDriveAndRefresh();
    alert('✓ Đã lưu Tham số thành công!');
}

// ==================== HELPERS TRUNG TÂM ====================

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
 * FIX CHÍNH: Hàm này trước đây được gọi ở khắp nơi trong file nhưng CHƯA TỪNG
 * được định nghĩa -> đây là nguyên nhân khiến trang Cài đặt luôn trống trơn
 * (dù dữ liệu window.portalSettings vẫn có, và trang Lịch làm việc vẫn đọc
 * đúng dữ liệu này vì nó truy cập trực tiếp, không qua hàm render).
 *
 * Hàm sẽ vẽ lại 4 danh sách (Ca làm việc, Ca tăng cường, PCCV, Nhân sự)
 * và đổ dữ liệu Tham số KPI vào các ô input tương ứng.
 */
function renderSettingsUI() {
    if (!window.portalSettings) return;

    const emptyRow = (text) =>
        `<li class="data-item" style="justify-content:center; color:var(--text-muted);">${text}</li>`;

    // ---------- Ca làm việc ----------
    const shiftList = document.getElementById('shift-list');
    if (shiftList) {
        const shifts = window.portalSettings.shifts || [];
        shiftList.innerHTML = shifts.length
            ? shifts.map(s => `
                <li class="data-item">
                    <span>
                        <span class="color-badge" style="background:${s.color || '#64748b'}"></span>
                        <b>${s.code}</b>${s.name ? ' - ' + s.name : ''}
                        <span style="color:var(--text-muted); font-size:12px;"> (${s.time || ''})</span>
                    </span>
                    <button class="btn-delete" onclick="deleteShift('${s.code}')" title="Xoá"><i class='bx bx-trash'></i></button>
                </li>`).join('')
            : emptyRow('Chưa có ca làm việc nào. Hãy thêm mới hoặc import từ Excel.');
    }

    // ---------- Ca tăng cường (OT) ----------
    const otList = document.getElementById('otshift-list');
    if (otList) {
        const otShifts = window.portalSettings.otShifts || [];
        otList.innerHTML = otShifts.length
            ? otShifts.map(s => `
                <li class="data-item">
                    <span>
                        <span class="color-badge" style="background:${s.color || '#ea4335'}"></span>
                        <b>${s.code}</b>${s.name ? ' - ' + s.name : ''}
                        <span style="color:var(--text-muted); font-size:12px;"> (${s.time || ''})</span>
                    </span>
                    <button class="btn-delete" onclick="deleteOTShift('${s.code}')" title="Xoá"><i class='bx bx-trash'></i></button>
                </li>`).join('')
            : emptyRow('Chưa có ca tăng cường nào.');
    }

    // ---------- Phân công công việc (PCCV) ----------
    const taskList = document.getElementById('task-list');
    if (taskList) {
        const tasks = window.portalSettings.tasks || [];
        taskList.innerHTML = tasks.length
            ? tasks.map(t => `
                <li class="data-item">
                    <span><b>${t.code}</b> - ${t.name}</span>
                    <button class="btn-delete" onclick="deleteTask('${t.code}')" title="Xoá"><i class='bx bx-trash'></i></button>
                </li>`).join('')
            : emptyRow('Chưa có PCCV nào.');
    }

    // ---------- Nhân sự ----------
    const staffList = document.getElementById('staff-list');
    if (staffList) {
        const staffs = window.portalSettings.staffs || [];
        staffList.innerHTML = staffs.length
            ? staffs.map(s => `
                <li class="data-item">
                    <span><b>${s.id}</b> - ${s.name}</span>
                    <button class="btn-delete" onclick="deleteStaff('${s.id}')" title="Xoá"><i class='bx bx-trash'></i></button>
                </li>`).join('')
            : emptyRow('Chưa có nhân sự nào.');
    }

    // ---------- Tham số KPI ----------
    const coeff = window.portalSettings.coefficients || {};
    const saInput = document.getElementById('sa-modifier');
    const kpiInput = document.getElementById('kpi-target');
    const otCongInput = document.getElementById('coeff-ot-cong');
    if (saInput) saInput.value = coeff.saModifier ?? 3;
    if (kpiInput) kpiInput.value = coeff.kpiTarget ?? 2000;
    if (otCongInput) otCongInput.value = coeff.coeffOtCong ?? 0.5;
}
window.renderSettingsUI = renderSettingsUI;

/**
 * 3 Nhiệm vụ chính: Lưu máy (chống mất dữ liệu), Render Giao diện ngay, Đẩy lên Drive ngầm
 */
async function saveSettingsToDriveAndRefresh() {
    // 1. Lưu ngay vào máy ảo trình duyệt để F5 không bao giờ bị mất
    localStorage.setItem('gportal_settings', JSON.stringify(window.portalSettings));

    // 2. Kích hoạt vẽ lại giao diện Settings lập tức
    if (typeof renderSettingsUI === 'function') {
        renderSettingsUI();
    } else if (typeof renderSettings === 'function') {
        renderSettings();
    }

    // 3. Đẩy lên Drive ở chế độ ngầm (nếu đang online)
    if (typeof AppState !== 'undefined' && AppState.isLoggedIn && typeof window.saveSettingsToDrive === 'function') {
        await window.saveSettingsToDrive(window.portalSettings);
    }
}

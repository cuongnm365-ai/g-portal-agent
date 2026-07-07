/**
 * drive.js - Google Drive Data Persistence
 * Quản lý: Load Settings, Save/Load Schedule, Save/Load Productivity
 */

/**
 * Load cấu hình (Settings) từ Google Drive
 * Bao gồm: Shifts, OT Shifts, Tasks, Staffs, Coefficients
 */
window.loadSettingsFromDrive = async function() {
    if (!window.GPORTAL_FOLDERS || !AppState.isLoggedIn) {
        console.log('GPORTAL_FOLDERS chưa được khởi tạo hoặc chưa đăng nhập');
        return;
    }

    console.log('Đang tải Settings từ Drive...');

    try {
        const settingsData = await getJsonFromDrive('settings.json', window.GPORTAL_FOLDERS.settings);
        
        if (settingsData) {
            // Lưu vào global state
            window.portalSettings = settingsData;
            console.log('✓ Đã load Settings thành công:', settingsData);
            
            // Kích hoạt UI updates
            if (typeof renderSettingsUI === 'function') renderSettingsUI();
        } else {
            console.log('Không tìm thấy settings.json - Sẽ sử dụng giá trị mặc định');
            window.portalSettings = getDefaultSettings();
        }
    } catch (error) {
        console.error('Lỗi load Settings:', error);
        window.portalSettings = getDefaultSettings();
    }
};

/**
 * Load dữ liệu Lịch làm việc cho tháng hiện tại
 * File name: schedule_YYYY_MM.json
 */
window.loadScheduleFromDrive = async function() {
    if (!window.GPORTAL_FOLDERS || !AppState.isLoggedIn) return;

    console.log('Đang tải Schedule từ Drive...');

    try {
        // Lấy tháng/năm hiện tại (từ module schedule.js)
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const fileName = `schedule_${year}_${month}.json`;

        const scheduleData = await getJsonFromDrive(fileName, window.GPORTAL_FOLDERS.shifts);
        
        if (scheduleData) {
            window.monthlyScheduleData = scheduleData;
            console.log('✓ Đã load Schedule thành công');
            
            // Render lại lịch
            if (typeof renderCalendar === 'function') renderCalendar();
        } else {
            console.log('Không tìm thấy dữ liệu lịch cho tháng này');
            window.monthlyScheduleData = {};
        }
    } catch (error) {
        console.error('Lỗi load Schedule:', error);
    }
};

/**
 * Load dữ liệu Năng suất cho tháng hiện tại
 * File name: productivity_YYYY_MM.json
 */
window.loadProductivityFromDrive = async function() {
    if (!window.GPORTAL_FOLDERS || !AppState.isLoggedIn) return;

    console.log('Đang tải Productivity từ Drive...');

    try {
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const fileName = `productivity_${year}_${month}.json`;

        const productivityData = await getJsonFromDrive(fileName, window.GPORTAL_FOLDERS.productivity);
        
        if (productivityData) {
            window.monthlyProductivityData = productivityData;
            console.log('✓ Đã load Productivity thành công');
        } else {
            console.log('Không tìm thấy dữ liệu năng suất cho tháng này');
            window.monthlyProductivityData = {};
        }
    } catch (error) {
        console.error('Lỗi load Productivity:', error);
    }
};

/**
 * Render UI cài đặt khi load dữ liệu từ Drive thành công
 */
async function renderSettingsUI() {
    if (!window.portalSettings) return;

    console.log('Rendering Settings UI...');

    // Render Ca làm việc
    if (window.portalSettings.shifts) {
        const shiftList = document.getElementById('shift-list');
        if (shiftList) {
            shiftList.innerHTML = window.portalSettings.shifts.map(s => 
                `<li><strong>${s.code}</strong> - ${s.time} ${s.name ? '(' + s.name + ')' : ''} <button class="btn-delete" onclick="deleteShift('${s.code}')">Xóa</button></li>`
            ).join('');
        }
    }

    // Render Ca tăng cường
    if (window.portalSettings.otShifts) {
        const otList = document.getElementById('otshift-list');
        if (otList) {
            otList.innerHTML = window.portalSettings.otShifts.map(s => 
                `<li><strong>${s.code}</strong> - ${s.time} ${s.name ? '(' + s.name + ')' : ''} <button class="btn-delete" onclick="deleteOTShift('${s.code}')">Xóa</button></li>`
            ).join('');
        }
    }

    // Render PCCV
    if (window.portalSettings.tasks) {
        const taskList = document.getElementById('task-list');
        if (taskList) {
            taskList.innerHTML = window.portalSettings.tasks.map(t => 
                `<li><strong>${t.code}</strong> - ${t.name} <button class="btn-delete" onclick="deleteTask('${t.code}')">Xóa</button></li>`
            ).join('');
        }
    }

    // Render Nhân sự
    if (window.portalSettings.staffs) {
        const staffList = document.getElementById('staff-list');
        if (staffList) {
            staffList.innerHTML = window.portalSettings.staffs.map(s => 
                `<li><strong>${s.id}</strong> - ${s.name} <button class="btn-delete" onclick="deleteStaff('${s.id}')">Xóa</button></li>`
            ).join('');
        }
    }

    // Render Coefficients (Tham số KPI)
    if (window.portalSettings.coefficients) {
        const coeff = window.portalSettings.coefficients;
        
        if (document.getElementById('sa-modifier')) 
            document.getElementById('sa-modifier').value = coeff.saModifier || 3;
        
        if (document.getElementById('kpi-target')) 
            document.getElementById('kpi-target').value = coeff.kpiTarget || 2000;
        
        if (document.getElementById('coeff-ot-cong')) 
            document.getElementById('coeff-ot-cong').value = coeff.coeffOtCong || 0.5;
    }
}

/**
 * Lấy cấu hình mặc định khi chưa có dữ liệu từ Drive
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
 * Lưu Settings lên Drive
 */
window.saveSettingsToDrive = async function(settingsData) {
    if (!window.GPORTAL_FOLDERS || !AppState.isLoggedIn) {
        console.log('Không thể lưu: chưa đăng nhập hoặc chưa có GPORTAL_FOLDERS');
        return;
    }

    try {
        await saveJsonToDrive('settings.json', settingsData, window.GPORTAL_FOLDERS.settings);
        console.log('✓ Đã lưu Settings thành công');
        window.portalSettings = settingsData;
    } catch (error) {
        console.error('Lỗi lưu Settings:', error);
    }
};

/**
 * Xóa ca làm việc khỏi cấu hình
 */
window.deleteShift = async function(shiftCode) {
    if (!window.portalSettings || !window.portalSettings.shifts) return;

    window.portalSettings.shifts = window.portalSettings.shifts.filter(s => s.code !== shiftCode);
    await window.saveSettingsToDrive(window.portalSettings);
    renderSettingsUI();
};

/**
 * Xóa ca tăng cường khỏi cấu hình
 */
window.deleteOTShift = async function(otCode) {
    if (!window.portalSettings || !window.portalSettings.otShifts) return;

    window.portalSettings.otShifts = window.portalSettings.otShifts.filter(s => s.code !== otCode);
    await window.saveSettingsToDrive(window.portalSettings);
    renderSettingsUI();
};

/**
 * Xóa PCCV khỏi cấu hình
 */
window.deleteTask = async function(taskCode) {
    if (!window.portalSettings || !window.portalSettings.tasks) return;

    window.portalSettings.tasks = window.portalSettings.tasks.filter(t => t.code !== taskCode);
    await window.saveSettingsToDrive(window.portalSettings);
    renderSettingsUI();
};

/**
 * Xóa nhân sự khỏi cấu hình
 */
window.deleteStaff = async function(staffId) {
    if (!window.portalSettings || !window.portalSettings.staffs) return;

    window.portalSettings.staffs = window.portalSettings.staffs.filter(s => s.id !== staffId);
    await window.saveSettingsToDrive(window.portalSettings);
    renderSettingsUI();
};

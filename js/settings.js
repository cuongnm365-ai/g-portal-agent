window.portalSettings = { shifts: [], staffs: [], tasks: [], coefficients: { saModifier: 3, kpiTarget: 2000 } };

document.addEventListener('DOMContentLoaded', () => {
    loadLocalSettings();
    initSettingsEvents();
    initExcelFeatures();
});

function initSettingsEvents() {
    document.getElementById('btn-add-shift').addEventListener('click', () => {
        const code = document.getElementById('shift-code').value.trim();
        const time = document.getElementById('shift-time').value.trim();
        if (!code || !time) return alert("Vui lòng nhập đủ Mã Ca và Thời gian!");
        window.portalSettings.shifts.push({ id: Date.now().toString(), code: code, time: time, color: generateRandomColor() });
        triggerSaveAndRender();
        document.getElementById('shift-code').value = ''; document.getElementById('shift-time').value = '';
    });

    document.getElementById('btn-add-staff').addEventListener('click', () => {
        const id = document.getElementById('staff-id').value.trim();
        const name = document.getElementById('staff-name').value.trim();
        if (!id || !name) return alert("Vui lòng nhập đủ Mã NV và Họ Tên!");
        window.portalSettings.staffs.push({ id: id, name: name });
        triggerSaveAndRender();
        document.getElementById('staff-id').value = ''; document.getElementById('staff-name').value = '';
    });

    document.getElementById('btn-add-task').addEventListener('click', () => {
        const code = document.getElementById('task-code').value.trim();
        const name = document.getElementById('task-name').value.trim();
        if (!code || !name) return alert("Vui lòng nhập đủ Mã PCCV và Tên PCCV!");
        window.portalSettings.tasks.push({ code: code, name: name });
        triggerSaveAndRender();
        document.getElementById('task-code').value = ''; document.getElementById('task-name').value = '';
    });

    document.getElementById('btn-save-coeff').addEventListener('click', () => {
        window.portalSettings.coefficients.saModifier = parseFloat(document.getElementById('coeff-sa').value) || 3;
        window.portalSettings.coefficients.kpiTarget = parseInt(document.getElementById('kpi-target').value) || 2000;
        triggerSaveAndRender(); alert("Đã lưu tham số cấu hình!");
        if(typeof window.updateDashboard === 'function') window.updateDashboard();
    });
}

// KHỐI XỬ LÝ IMPORT / EXPORT TỪ EXCEL
function initExcelFeatures() {
    // 1. CA LÀM VIỆC
    document.getElementById('btn-tpl-shift').addEventListener('click', () => {
        const ws = XLSX.utils.aoa_to_sheet([["Mã Ca", "Thời gian"], ["S1", "07:15 - 14:45"], ["S2", "14:45 - 22:15"]]);
        const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "CaLamViec");
        XLSX.writeFile(wb, "Mau_CaLamViec.xlsx");
    });
    document.getElementById('import-shift').addEventListener('change', function(e) {
        processExcelImport(e, (row) => {
            const code = row['Mã Ca']; const time = row['Thời gian'];
            if(code && time) {
                window.portalSettings.shifts = window.portalSettings.shifts.filter(s => s.code !== code); // Chống trùng lặp
                window.portalSettings.shifts.push({id: Date.now().toString()+Math.random(), code, time, color: generateRandomColor()});
            }
        });
        this.value = '';
    });

    // 2. NHÂN SỰ
    document.getElementById('btn-tpl-staff').addEventListener('click', () => {
        const ws = XLSX.utils.aoa_to_sheet([["Mã NV", "Họ và tên"], ["NV01", "Nguyễn Văn A"]]);
        const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "NhanSu");
        XLSX.writeFile(wb, "Mau_NhanSu.xlsx");
    });
    document.getElementById('import-staff').addEventListener('change', function(e) {
        processExcelImport(e, (row) => {
            const id = row['Mã NV']; const name = row['Họ và tên'];
            if(id && name) {
                window.portalSettings.staffs = window.portalSettings.staffs.filter(s => s.id !== id);
                window.portalSettings.staffs.push({id, name});
            }
        });
        this.value = '';
    });

    // 3. PCCV
    document.getElementById('btn-tpl-task').addEventListener('click', () => {
        const ws = XLSX.utils.aoa_to_sheet([["Mã PCCV", "Tên PCCV"], ["CHAT", "HiFPT Chat"]]);
        const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "PCCV");
        XLSX.writeFile(wb, "Mau_PCCV.xlsx");
    });
    document.getElementById('import-task').addEventListener('change', function(e) {
        processExcelImport(e, (row) => {
            const code = row['Mã PCCV']; const name = row['Tên PCCV'];
            if(code && name) {
                window.portalSettings.tasks = window.portalSettings.tasks.filter(t => t.code !== code);
                window.portalSettings.tasks.push({code, name});
            }
        });
        this.value = '';
    });
}

// Hàm dùng chung để đọc file Excel
function processExcelImport(event, callback) {
    const file = event.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        const data = new Uint8Array(e.target.result);
        const wb = XLSX.read(data, {type: 'array'});
        const rawJson = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
        rawJson.forEach(row => callback(row));
        triggerSaveAndRender();
        alert("Import dữ liệu thành công!");
    };
    reader.readAsArrayBuffer(file);
}

function renderSettings() {
    document.getElementById('shift-list').innerHTML = window.portalSettings.shifts.map((shift, index) => `
        <li class="data-item"><div><span class="shift-color-badge" style="background-color: ${shift.color}"></span><strong>${shift.code}</strong> (${shift.time})</div><button class="btn-delete" onclick="deleteSetting('shifts', ${index})"><i class='bx bx-trash'></i></button></li>`).join('');

    document.getElementById('staff-list').innerHTML = window.portalSettings.staffs.map((staff, index) => `
        <li class="data-item"><div><strong>${staff.id}</strong> - ${staff.name}</div><button class="btn-delete" onclick="deleteSetting('staffs', ${index})"><i class='bx bx-trash'></i></button></li>`).join('');

    if (window.portalSettings.tasks) {
        document.getElementById('task-list').innerHTML = window.portalSettings.tasks.map((task, index) => `
            <li class="data-item"><div><strong>${task.code}</strong> - ${task.name}</div><button class="btn-delete" onclick="deleteSetting('tasks', ${index})"><i class='bx bx-trash'></i></button></li>`).join('');
    }

    if (window.portalSettings.coefficients) {
        document.getElementById('coeff-sa').value = window.portalSettings.coefficients.saModifier || 3;
        document.getElementById('kpi-target').value = window.portalSettings.coefficients.kpiTarget || 2000;
    }
    if (typeof renderCalendar === 'function') renderCalendar();
}

window.deleteSetting = function(type, index) { window.portalSettings[type].splice(index, 1); triggerSaveAndRender(); }
function generateRandomColor() { return `hsl(${Math.floor(Math.random() * 360)}, 70%, 60%)`; }

function triggerSaveAndRender() {
    localStorage.setItem('gportal_settings', JSON.stringify(window.portalSettings));
    renderSettings();
    if (typeof AppState !== 'undefined' && AppState.isLoggedIn && typeof saveJsonToDrive === 'function' && window.GPORTAL_FOLDERS) {
        saveJsonToDrive('shifts.json', window.portalSettings.shifts, window.GPORTAL_FOLDERS.shifts);
        saveJsonToDrive('staffs.json', window.portalSettings.staffs, window.GPORTAL_FOLDERS.staffs);
        saveJsonToDrive('tasks.json', window.portalSettings.tasks, window.GPORTAL_FOLDERS.tasks);
        saveJsonToDrive('coefficients.json', window.portalSettings.coefficients, window.GPORTAL_FOLDERS.settings);
    }
}

function loadLocalSettings() {
    const saved = localStorage.getItem('gportal_settings');
    if (saved) {
        window.portalSettings = { ...window.portalSettings, ...JSON.parse(saved) };
        if (!window.portalSettings.tasks) window.portalSettings.tasks = [];
        if (!window.portalSettings.coefficients.kpiTarget) window.portalSettings.coefficients.kpiTarget = 2000;
        renderSettings();
    }
}

window.loadSettingsFromDrive = async function() {
    if (!window.GPORTAL_FOLDERS) return;
    const [shiftsData, staffsData, tasksData, coeffData] = await Promise.all([
        getJsonFromDrive('shifts.json', window.GPORTAL_FOLDERS.shifts),
        getJsonFromDrive('staffs.json', window.GPORTAL_FOLDERS.staffs),
        getJsonFromDrive('tasks.json', window.GPORTAL_FOLDERS.tasks),
        getJsonFromDrive('coefficients.json', window.GPORTAL_FOLDERS.settings)
    ]);

    if (shiftsData) window.portalSettings.shifts = shiftsData;
    if (staffsData) window.portalSettings.staffs = staffsData;
    if (tasksData) window.portalSettings.tasks = tasksData;
    if (coeffData) window.portalSettings.coefficients = coeffData;
    if (!window.portalSettings.coefficients.kpiTarget) window.portalSettings.coefficients.kpiTarget = 2000;

    localStorage.setItem('gportal_settings', JSON.stringify(window.portalSettings));
    renderSettings();
    if(typeof window.updateDashboard === 'function') window.updateDashboard();
}
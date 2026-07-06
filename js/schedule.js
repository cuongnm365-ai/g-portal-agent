let monthlyScheduleData = {}; 
let currentDate = new Date();

document.addEventListener('DOMContentLoaded', () => {
    initCalendar();
    initScheduleEvents();
});

function initScheduleEvents() {
    document.getElementById('btn-prev-month').addEventListener('click', () => { currentDate.setMonth(currentDate.getMonth() - 1); changeMonthHandler(); });
    document.getElementById('btn-next-month').addEventListener('click', () => { currentDate.setMonth(currentDate.getMonth() + 1); changeMonthHandler(); });

    // Download Lịch Mẫu
    document.getElementById('btn-download-schedule-tpl').addEventListener('click', () => {
        const ws_data = [ ["Ngày", "Mã Ca", "OT", "Mã PCCV", "Phân loại", "Nhân sự liên quan"] ];
        ws_data.push(["01/07/2026", "S1", "S+", "CHAT", "Chính chủ", ""]);
        ws_data.push(["02/07/2026", "S2", "", "", "Đổi ca", "NV01"]);
        
        const ws = XLSX.utils.aoa_to_sheet(ws_data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "LichLamViec");
        XLSX.writeFile(wb, "Mau_LichLamViec.xlsx");
    });

    document.getElementById('excel-upload').addEventListener('change', handleExcelUpload);

    // Modal Events
    document.getElementById('btn-close-modal').addEventListener('click', () => { document.getElementById('day-modal').classList.remove('active'); });
    document.getElementById('day-modal').addEventListener('click', (e) => {
        if (e.target.id === 'day-modal') document.getElementById('day-modal').classList.remove('active');
    });

    document.getElementById('modal-shift-type').addEventListener('change', function() {
        const val = this.value;
        document.getElementById('modal-trade-group').style.display = val === 'doica' ? 'block' : 'none';
        document.getElementById('modal-help-group').style.display = val === 'trucho' ? 'block' : 'none';
    });

    document.getElementById('btn-save-day').addEventListener('click', saveDayEdit);
    document.getElementById('btn-sync-calendar').addEventListener('click', syncToGoogleEcosystem);
}

function changeMonthHandler() {
    monthlyScheduleData = {}; 
    renderCalendar();
    if(typeof AppState !== 'undefined' && AppState.isLoggedIn) loadScheduleFromDrive();
}

function getScheduleFileName() {
    const year = currentDate.getFullYear();
    const month = (currentDate.getMonth() + 1).toString().padStart(2, '0');
    return `schedule_${year}_${month}.json`;
}

async function saveScheduleToDrive() {
    if (typeof AppState !== 'undefined' && AppState.isLoggedIn && window.GPORTAL_FOLDERS) {
        await saveJsonToDrive(getScheduleFileName(), monthlyScheduleData, window.GPORTAL_FOLDERS.shifts);
    }
}

window.loadScheduleFromDrive = async function() {
    if (!window.GPORTAL_FOLDERS) return;
    const data = await getJsonFromDrive(getScheduleFileName(), window.GPORTAL_FOLDERS.shifts);
    if (data) { monthlyScheduleData = data; renderCalendar(); }
}

window.renderCalendar = function() {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    document.getElementById('current-month-display').innerText = `Tháng ${(month + 1).toString().padStart(2, '0')}/${year}`;

    const firstDay = new Date(year, month, 1).getDay(); 
    const daysInMonth = new Date(year, month + 1, 0).getDate(); 
    
    const calendarGrid = document.getElementById('calendar-grid');
    if (!calendarGrid) return;
    calendarGrid.innerHTML = '';

    for (let i = 0; i < firstDay; i++) calendarGrid.innerHTML += `<div class="calendar-day empty"></div>`;

    const today = new Date();
    for (let day = 1; day <= daysInMonth; day++) {
        const dateKey = `${year}-${(month + 1).toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
        const isToday = (day === today.getDate() && month === today.getMonth() && year === today.getFullYear());
        const dayData = monthlyScheduleData[dateKey] || { shift: 'OFF', type: 'chinhchu' };

        let shiftColor = '#475569';
        if (dayData.shift !== 'OFF' && window.portalSettings && Array.isArray(window.portalSettings.shifts)) {
            const shiftConfig = window.portalSettings.shifts.find(s => s.code === dayData.shift);
            if (shiftConfig) shiftColor = shiftConfig.color;
        }

        let tagsHtml = '';
        if (dayData.shift !== 'OFF') {
            tagsHtml += `<div class="shift-tag" style="background-color: ${shiftColor}"><span>Ca: ${dayData.shift}</span></div>`;
        }
        if (dayData.ot) tagsHtml += `<span class="ot-tag">OT: ${dayData.ot}</span>`;
        if (dayData.task) tagsHtml += `<div class="task-tag"><i class='bx bx-check-square'></i> ${dayData.task}</div>`;
        
        if (dayData.type === 'doica' && dayData.trade) tagsHtml += `<div class="trade-tag"><i class='bx bx-transfer'></i> Đổi: ${dayData.trade}</div>`;
        if (dayData.type === 'trucho' && dayData.help) tagsHtml += `<div class="trade-tag" style="background:#10b981"><i class='bx bx-support'></i> Hộ: ${dayData.help}</div>`;

        calendarGrid.innerHTML += `
            <div class="calendar-day ${isToday ? 'today' : ''}" onclick="openDayModal('${dateKey}')">
                <div class="day-number">${day}</div><div class="day-content">${tagsHtml}</div>
            </div>`;
    }
}

let editingDateKey = null;

function openDayModal(dateKey) {
    editingDateKey = dateKey;
    const dayData = monthlyScheduleData[dateKey] || { type: 'chinhchu', shift: 'OFF', ot: '', task: '', trade: '', help: '' };

    const parts = dateKey.split('-');
    document.getElementById('modal-date-title').innerText = `Hiệu chỉnh: ${parts[2]}/${parts[1]}/${parts[0]}`;

    if (window.portalSettings) {
        const shiftsHtml = `<option value="OFF">OFF (Nghỉ)</option>` + 
            (window.portalSettings.shifts || []).map(s => `<option value="${s.code}">${s.code} (${s.time})</option>`).join('');
        document.getElementById('modal-shift').innerHTML = shiftsHtml;
        
        const otHtml = `<option value="">-- Không có --</option>` + 
            (window.portalSettings.shifts || []).map(s => `<option value="${s.code}">${s.code} (${s.time})</option>`).join('');
        document.getElementById('modal-ot').innerHTML = otHtml;

        const taskSelect = document.getElementById('modal-task');
        taskSelect.innerHTML = `<option value="">-- Không có --</option>` + 
            (window.portalSettings.tasks || []).map(t => `<option value="${t.name}">${t.name}</option>`).join('');

        const staffOptions = `<option value="">-- Không có --</option>` + 
            (window.portalSettings.staffs || []).map(s => `<option value="${s.name}">${s.name} (${s.id})</option>`).join('');
        document.getElementById('modal-trade').innerHTML = staffOptions;
        document.getElementById('modal-help').innerHTML = staffOptions;
    }

    document.getElementById('modal-shift-type').value = dayData.type || 'chinhchu';
    document.getElementById('modal-shift').value = dayData.shift || 'OFF';
    document.getElementById('modal-ot').value = dayData.ot || '';
    document.getElementById('modal-task').value = dayData.task || '';
    document.getElementById('modal-trade').value = dayData.trade || '';
    document.getElementById('modal-help').value = dayData.help || '';

    // Kích hoạt sự kiện để hiện/ẩn dropdown nhân sự
    document.getElementById('modal-shift-type').dispatchEvent(new Event('change'));
    document.getElementById('day-modal').classList.add('active');
}

function saveDayEdit() {
    if (!editingDateKey) return;
    const type = document.getElementById('modal-shift-type').value;
    const shift = document.getElementById('modal-shift').value;
    const ot = document.getElementById('modal-ot').value;
    const task = document.getElementById('modal-task').value;
    let trade = ''; let help = '';
    
    if (type === 'doica') trade = document.getElementById('modal-trade').value;
    if (type === 'trucho') help = document.getElementById('modal-help').value;

    monthlyScheduleData[editingDateKey] = { type, shift, ot, task, trade, help };

    document.getElementById('day-modal').classList.remove('active');
    renderCalendar();
    saveScheduleToDrive();
}

function handleExcelUpload(event) {
    const file = event.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        const data = new Uint8Array(e.target.result);
        const wb = XLSX.read(data, {type: 'array'});
        const rawJson = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
        
        rawJson.forEach(row => {
            const dateStr = row['Ngày'] || row['Date'];
            const shiftCode = row['Mã Ca'] || row['Ca'];
            if (dateStr && shiftCode) {
                const formattedKey = parseDateToKey(dateStr);
                if (formattedKey) {
                    let type = 'chinhchu'; let trade = ''; let help = '';
                    const rawType = (row['Phân loại'] || '').toLowerCase();
                    const person = row['Nhân sự liên quan'] || '';
                    if (rawType.includes('đổi')) { type = 'doica'; trade = person; } 
                    else if (rawType.includes('hộ')) { type = 'trucho'; help = person; }
                    
                    monthlyScheduleData[formattedKey] = {
                        type: type,
                        shift: shiftCode,
                        ot: row['OT'] || '',
                        task: row['Mã PCCV'] || row['PCCV'] || '',
                        trade: trade, help: help
                    };
                }
            }
        });
        alert("Import Lịch thành công!");
        renderCalendar(); saveScheduleToDrive();
        document.getElementById('excel-upload').value = '';
    };
    reader.readAsArrayBuffer(file);
}

function parseDateToKey(dateStr) {
    if (typeof dateStr === 'number') {
        const date = new Date(Math.round((dateStr - 25569)*86400*1000));
        return `${date.getFullYear()}-${(date.getMonth()+1).toString().padStart(2,'0')}-${date.getDate().toString().padStart(2,'0')}`;
    }
    if (typeof dateStr === 'string') {
        const parts = dateStr.split('/');
        if (parts.length === 3) return `${parts[2].trim()}-${parts[1].trim().padStart(2, '0')}-${parts[0].trim().padStart(2, '0')}`;
        if (dateStr.includes('-')) return dateStr.substring(0, 10);
    }
    return null;
}

async function syncToGoogleEcosystem() {
    if (typeof AppState === 'undefined' || !AppState.isLoggedIn) return alert("Vui lòng đăng nhập Google trước!");
    const keys = Object.keys(monthlyScheduleData);
    if(keys.length === 0) return alert("Không có dữ liệu lịch để đồng bộ.");

    alert("Đang tiến hành đồng bộ nền... Quá trình này có thể mất vài giây.");
    for (let key of keys) {
        const dayData = monthlyScheduleData[key];
        if (dayData.shift === 'OFF') {
            if(typeof deleteCalendarEvent === 'function') await deleteCalendarEvent(key);
        } else {
            let shiftTime = "08:00 - 17:00";
            if (window.portalSettings && window.portalSettings.shifts) {
                const conf = window.portalSettings.shifts.find(s => s.code === dayData.shift);
                if(conf) shiftTime = conf.time;
            }
            let desc = [];
            if(dayData.task) desc.push(`PCCV: ${dayData.task}`);
            if(dayData.ot) desc.push(`OT: ${dayData.ot}`);
            if(dayData.type === 'doica' && dayData.trade) desc.push(`Đổi ca: ${dayData.trade}`);
            if(dayData.type === 'trucho' && dayData.help) desc.push(`Trực hộ: ${dayData.help}`);

            if(typeof syncCalendarEvent === 'function') await syncCalendarEvent(key, dayData.shift, shiftTime, desc.join('\n'));
        }
        if (dayData.task && typeof syncGoogleTask === 'function') await syncGoogleTask(key, dayData.task);
    }
    alert("✅ Đã đồng bộ Lịch và Task lên Google thành công!");
}
/**
 * schedule.js - Module Lịch làm việc
 *
 * BẢN VÁ LỖI QUAN TRỌNG NHẤT (mới nhất): "Đổi ca/Trực hộ không hiện dropdown
 * chọn nhân sự, nút Lưu/Xóa trong popup hiệu chỉnh ngày không phản hồi gì"
 * -------------------------------------------------------------------------
 * NGUYÊN NHÂN THẬT SỰ: initScheduleEvents() gắn TẤT CẢ sự kiện (đổi tháng,
 * upload Excel, đóng modal, đổi loại ca, nút Lưu, nút Xóa, đồng bộ Google,
 * modal họp...) tuần tự trong CÙNG MỘT HÀM bằng
 * `document.getElementById(id).addEventListener(...)` KHÔNG kiểm tra null.
 * Nếu bất kỳ 1 phần tử nào trong danh sách đó bị thiếu ID trên HTML (báo lỗi
 * "Cannot read properties of null (reading 'addEventListener')"), toàn bộ
 * các dòng addEventListener PHÍA SAU dòng lỗi đó trong hàm sẽ KHÔNG BAO GIỜ
 * được thực thi — kể cả khi nằm trong try/catch bên ngoài (try/catch chỉ
 * chặn crash lan ra ngoài, không "chạy tiếp" các dòng sau lỗi trong cùng
 * 1 lệnh gọi hàm).
 *
 * Hậu quả trực tiếp: sự kiện "change" của #modal-shift-type (dùng để hiện/ẩn
 * dropdown Đổi ca/Trực hộ) và sự kiện "click" của #btn-save-day / các nút
 * khác nằm SAU phần tử bị lỗi trong hàm không hề được gắn -> chọn "Đổi ca"
 * không thấy dropdown hiện, bấm Lưu/Xóa im lặng không phản hồi.
 *
 * FIX: chuyển TOÀN BỘ lệnh gắn sự kiện trong initScheduleEvents() sang dùng
 * bindIfPresent() (đã có kiểm tra tồn tại phần tử). Nếu thiếu 1 phần tử nào
 * đó, chỉ riêng sự kiện của phần tử đó không được gắn (kèm console.warn ghi
 * rõ ID thiếu để dễ dò), các sự kiện còn lại trong hàm vẫn hoạt động bình
 * thường — không còn hiện tượng "một lỗi làm treo toàn bộ modal" nữa.
 * -------------------------------------------------------------------------
 * (Giữ nguyên toàn bộ tính năng gốc + bản vá trước đó về Settings/staffs
 * fallback mặc định, try/catch quanh openDayModal/saveDayEdit/deleteDayEdit)
 */

window.monthlyScheduleData = window.monthlyScheduleData || {};
window.monthlyMeetingsData = window.monthlyMeetingsData || {};
let currentDate = new Date();
let editingDateKey = null;
let editingMeetingId = null;

document.addEventListener('DOMContentLoaded', () => {
    try { initCalendar(); } catch (e) { console.error('initCalendar error:', e); }
    try { initScheduleEvents(); } catch (e) { console.error('initScheduleEvents error:', e); }
});

function initCalendar() {
    renderCalendar();
}

// Fallback cứng phòng khi settings.js chưa kịp nạp / getDefaultSettings chưa tồn tại
function getSafePortalSettings() {
    if (window.portalSettings) return window.portalSettings;
    if (typeof getDefaultSettings === 'function') {
        window.portalSettings = getDefaultSettings();
        return window.portalSettings;
    }
    return { shifts: [], otShifts: [], tasks: [], staffs: [], coefficients: {} };
}

/**
 * Gắn sự kiện an toàn: nếu phần tử không tồn tại trên trang, chỉ cảnh báo ra
 * Console (console.warn) chứ KHÔNG ném lỗi làm gián đoạn các lượt gắn sự
 * kiện còn lại phía sau trong initScheduleEvents().
 */
function bindIfPresent(id, eventName, handler, targetOverride) {
    const el = targetOverride || document.getElementById(id);
    if (el) {
        el.addEventListener(eventName, handler);
        return true;
    }
    console.warn(`[schedule.js] Không tìm thấy phần tử #${id} trên trang — sự kiện "${eventName}" KHÔNG được gắn. Kiểm tra lại HTML (id có thể đã bị đổi/xóa nhầm).`);
    return false;
}

function initScheduleEvents() {
    bindIfPresent('btn-prev-month', 'click', () => { currentDate.setMonth(currentDate.getMonth() - 1); changeMonthHandler(); });
    bindIfPresent('btn-next-month', 'click', () => { currentDate.setMonth(currentDate.getMonth() + 1); changeMonthHandler(); });

    bindIfPresent('btn-download-schedule-tpl', 'click', () => {
        const ws_data = [["Ngày", "Mã Ca", "OT", "Mã PCCV", "Phân loại", "Nhân sự liên quan"]];
        ws_data.push(["01/07/2026", "S1", "S+", "CHAT", "Chính chủ", ""]);
        ws_data.push(["02/07/2026", "S2", "", "", "Đổi ca", "NV01"]);

        const ws = XLSX.utils.aoa_to_sheet(ws_data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "LichLamViec");
        XLSX.writeFile(wb, "Mau_LichLamViec.xlsx");
    });

    bindIfPresent('excel-upload', 'change', handleExcelUpload);

    bindIfPresent('btn-close-modal', 'click', closeDayModal);
    bindIfPresent('day-modal', 'click', (e) => {
        if (e.target.id === 'day-modal') closeDayModal();
    });
    // document luôn tồn tại, không cần bindIfPresent
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { closeDayModal(); closeMeetingModal(); }
    });

    bindIfPresent('modal-shift-type', 'change', function () {
        const val = this.value;
        const tradeGroup = document.getElementById('modal-trade-group');
        const helpGroup = document.getElementById('modal-help-group');
        if (tradeGroup) tradeGroup.style.display = val === 'doica' ? 'block' : 'none';
        if (helpGroup) helpGroup.style.display = val === 'trucho' ? 'block' : 'none';
    });

    bindIfPresent('btn-save-day', 'click', saveDayEdit);
    bindIfPresent('btn-delete-day', 'click', deleteDayEdit);
    bindIfPresent('btn-sync-calendar', 'click', syncToGoogleEcosystem);
    bindIfPresent('btn-check-sync', 'click', checkSyncWithGoogleHandler);
    bindIfPresent('btn-add-meeting', 'click', () => openMeetingModal());
    bindIfPresent('btn-close-meeting-modal', 'click', closeMeetingModal);
    bindIfPresent('meeting-modal', 'click', (e) => { if (e.target.id === 'meeting-modal') closeMeetingModal(); });
    bindIfPresent('btn-save-meeting', 'click', saveMeetingEdit);
    bindIfPresent('btn-delete-meeting', 'click', deleteMeetingEdit);
    bindIfPresent('meeting-mode', 'change', updateMeetingLocationLabel);
}

function closeDayModal() {
    const modal = document.getElementById('day-modal');
    if (modal) modal.classList.remove('active');
    editingDateKey = null;
}

function changeMonthHandler() {
    window.monthlyScheduleData = {};
    window.monthlyMeetingsData = {};
    renderCalendar();
    if (typeof AppState !== 'undefined' && AppState.isLoggedIn) loadScheduleFromDrive();
}

function getScheduleFileName() {
    const year = currentDate.getFullYear();
    const month = (currentDate.getMonth() + 1).toString().padStart(2, '0');
    return `schedule_${year}_${month}.json`;
}

function getMeetingsFileName() {
    const year = currentDate.getFullYear();
    const month = (currentDate.getMonth() + 1).toString().padStart(2, '0');
    return `meetings_${year}_${month}.json`;
}

async function saveScheduleToDrive() {
    if (typeof AppState !== 'undefined' && AppState.isLoggedIn && window.GPORTAL_FOLDERS) {
        try {
            await saveJsonToDrive(getScheduleFileName(), window.monthlyScheduleData, window.GPORTAL_FOLDERS.shifts);
        } catch (e) {
            console.error('Lỗi lưu Lịch làm việc lên Drive:', e);
            alert('Có lỗi khi lưu Lịch làm việc lên Google Drive. Dữ liệu vẫn đang hiển thị tạm trên trình duyệt, vui lòng thử "Đồng bộ Google" lại sau hoặc tải lại trang để kiểm tra.');
        }
    }
}

async function saveMeetingsToDrive() {
    if (typeof AppState !== 'undefined' && AppState.isLoggedIn && window.GPORTAL_FOLDERS) {
        try {
            await saveJsonToDrive(getMeetingsFileName(), window.monthlyMeetingsData, window.GPORTAL_FOLDERS.shifts);
        } catch (e) {
            console.error('Lỗi lưu Lịch họp lên Drive:', e);
            alert('Có lỗi khi lưu Lịch họp lên Google Drive. Vui lòng thử lại.');
        }
    }
}

window.loadScheduleFromDrive = async function () {
    if (!window.GPORTAL_FOLDERS) return;
    try {
        const [data, meetings] = await Promise.all([
            getJsonFromDrive(getScheduleFileName(), window.GPORTAL_FOLDERS.shifts),
            getJsonFromDrive(getMeetingsFileName(), window.GPORTAL_FOLDERS.shifts)
        ]);
        window.monthlyScheduleData = data || {};
        window.monthlyMeetingsData = meetings || {};
        renderCalendar();
    } catch (e) {
        console.error('Lỗi tải Lịch làm việc từ Drive:', e);
        window.monthlyScheduleData = window.monthlyScheduleData || {};
        window.monthlyMeetingsData = window.monthlyMeetingsData || {};
        renderCalendar();
    }
};

window.renderCalendar = function () {
    try {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();
        const monthDisplay = document.getElementById('current-month-display');
        if (monthDisplay) monthDisplay.innerText = `Tháng ${(month + 1).toString().padStart(2, '0')}/${year}`;

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
            const dayData = window.monthlyScheduleData[dateKey] || { shift: 'OFF', type: 'chinhchu' };

            const meetings = getMeetingsByDate(dateKey);
            const shiftConfig = getShiftConfig(dayData.shift, false);
            const otConfig = getShiftConfig(dayData.ot, true);
            const shiftColor = shiftConfig && shiftConfig.color ? shiftConfig.color : '#475569';
            const dayStatus = dayData.shift && dayData.shift !== 'OFF' ? 'has-shift' : 'is-off';

            let tagsHtml = `<div class="day-topline"><span class="day-number">${day}</span><span class="day-status ${dayStatus}">${dayStatus === 'has-shift' ? 'Đi làm' : 'OFF'}</span></div>`;
            if (dayData.shift && dayData.shift !== 'OFF') tagsHtml += `<div class="shift-card" style="--shift-color:${shiftColor}"><b>${escapeHtml(dayData.shift)}</b><span>${escapeHtml(shiftConfig && shiftConfig.time ? shiftConfig.time : 'Chưa cấu hình giờ')}</span></div>`;
            if (dayData.ot) tagsHtml += `<div class="mini-pill ot"><i class='bx bx-trending-up'></i> OT ${escapeHtml(dayData.ot)}${otConfig && otConfig.time ? ` · ${escapeHtml(otConfig.time)}` : ''}</div>`;
            if (dayData.task) tagsHtml += `<div class="mini-pill task"><i class='bx bx-check-square'></i> ${escapeHtml(dayData.task)}</div>`;
            if (dayData.type === 'doica' && dayData.trade) tagsHtml += `<div class="mini-pill trade"><i class='bx bx-transfer'></i> Đổi: ${escapeHtml(dayData.trade)}</div>`;
            if (dayData.type === 'trucho' && dayData.help) tagsHtml += `<div class="mini-pill help"><i class='bx bx-support'></i> Hộ: ${escapeHtml(dayData.help)}</div>`;
            meetings.slice(0, 2).forEach(m => { tagsHtml += `<button class="meeting-chip" onclick="event.stopPropagation(); openMeetingModal('${m.id}')"><i class='bx bx-video'></i>${escapeHtml(m.start || '--:--')} ${escapeHtml(m.title)}</button>`; });
            if (meetings.length > 2) tagsHtml += `<div class="more-chip">+${meetings.length - 2} lịch họp</div>`;

            calendarGrid.innerHTML += `<div class="calendar-day ${isToday ? 'today' : ''} ${meetings.length ? 'has-meeting' : ''}" onclick="openDayModal('${dateKey}')"><div class="day-content">${tagsHtml}</div></div>`;
        }
        renderScheduleAgenda();
    } catch (e) {
        console.error('Lỗi render Lịch làm việc:', e);
    }
};

window.openDayModal = function (dateKey) {
    try {
        editingDateKey = dateKey;
        const existingData = window.monthlyScheduleData[dateKey];
        const dayData = existingData || { type: 'chinhchu', shift: 'OFF', ot: '', task: '', trade: '', help: '' };

        const parts = dateKey.split('-');
        const titleEl = document.getElementById('modal-date-title');
        if (titleEl) titleEl.innerText = `Hiệu chỉnh: ${parts[2]}/${parts[1]}/${parts[0]}`;

        const settings = getSafePortalSettings();

        const shiftsHtml = `<option value="OFF">OFF (Nghỉ)</option>` +
            (settings.shifts || []).map(s => `<option value="${s.code}">${s.code} (${s.time})</option>`).join('');
        const modalShift = document.getElementById('modal-shift');
        if (modalShift) modalShift.innerHTML = shiftsHtml;

        const otHtml = `<option value="">-- Không có --</option>` +
            (settings.otShifts || []).map(s => `<option value="${s.code}">${s.code} (${s.time})</option>`).join('');
        const modalOt = document.getElementById('modal-ot');
        if (modalOt) modalOt.innerHTML = otHtml;

        const taskSelect = document.getElementById('modal-task');
        if (taskSelect) {
            taskSelect.innerHTML = `<option value="">-- Không có --</option>` +
                (settings.tasks || []).map(t => `<option value="${t.name}">${t.name}</option>`).join('');
        }

        const staffList = settings.staffs || [];
        const staffOptions = staffList.length
            ? (`<option value="">-- Không có --</option>` + staffList.map(s => `<option value="${s.name}">${s.name} (${s.id})</option>`).join(''))
            : `<option value="">-- Chưa có Nhân sự nào, vào Cài Đặt > Nhân sự để thêm --</option>`;
        const modalTrade = document.getElementById('modal-trade');
        const modalHelp = document.getElementById('modal-help');
        if (modalTrade) modalTrade.innerHTML = staffOptions;
        if (modalHelp) modalHelp.innerHTML = staffOptions;

        const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
        setVal('modal-shift-type', dayData.type || 'chinhchu');
        setVal('modal-shift', dayData.shift || 'OFF');
        setVal('modal-ot', dayData.ot || '');
        setVal('modal-task', dayData.task || '');
        setVal('modal-trade', dayData.trade || '');
        setVal('modal-help', dayData.help || '');

        const tradeGroup = document.getElementById('modal-trade-group');
        const helpGroup = document.getElementById('modal-help-group');
        if (tradeGroup) tradeGroup.style.display = dayData.type === 'doica' ? 'block' : 'none';
        if (helpGroup) helpGroup.style.display = dayData.type === 'trucho' ? 'block' : 'none';

        const deleteBtn = document.getElementById('btn-delete-day');
        if (deleteBtn) deleteBtn.style.display = existingData ? 'inline-flex' : 'none';

        const modal = document.getElementById('day-modal');
        if (modal) modal.classList.add('active');
    } catch (e) {
        console.error('Lỗi mở modal hiệu chỉnh ngày:', e);
        alert('Có lỗi khi mở popup hiệu chỉnh ngày. Vui lòng tải lại trang và thử lại. (Chi tiết lỗi đã ghi trong Console F12)');
    }
};

function saveDayEdit() {
    try {
        if (!editingDateKey) return;

        const getVal = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };

        const type = getVal('modal-shift-type') || 'chinhchu';
        const shift = getVal('modal-shift') || 'OFF';
        const ot = getVal('modal-ot');
        const task = getVal('modal-task');
        const trade = type === 'doica' ? getVal('modal-trade') : '';
        const help = type === 'trucho' ? getVal('modal-help') : '';

        window.monthlyScheduleData[editingDateKey] = { type, shift, ot, task, trade, help };

        const savedKey = editingDateKey;
        closeDayModal();
        renderCalendar();
        saveScheduleToDrive();

        if (typeof AppState !== 'undefined' && AppState.isLoggedIn) {
            if (task && task.trim() !== '') {
                let taskNote = [];
                if (shift && shift !== 'OFF') taskNote.push(`Ca: ${shift}`);
                if (ot) taskNote.push(`OT: ${ot}`);
                if (typeof syncGoogleTask === 'function') {
                    syncGoogleTask(savedKey, task, taskNote.join(' | ')).catch(err => console.error('Lỗi đồng bộ Google Task:', err));
                }
            } else if (typeof deleteGoogleTask === 'function') {
                deleteGoogleTask(savedKey).catch(err => console.error('Lỗi xóa Google Task:', err));
            }
        }
    } catch (e) {
        console.error('Lỗi lưu hiệu chỉnh ngày:', e);
        alert('Có lỗi khi lưu lịch làm việc của ngày này. Vui lòng thử lại. (Chi tiết lỗi đã ghi trong Console F12)');
        closeDayModal();
    }
}

function deleteDayEdit() {
    try {
        if (!editingDateKey) return;
        if (!window.monthlyScheduleData[editingDateKey]) {
            closeDayModal();
            return;
        }

        const confirmed = confirm('Xóa toàn bộ dữ liệu lịch làm việc của ngày này?\nSự kiện tương ứng trên Google Calendar và Google Tasks (nếu có) cũng sẽ được xóa theo.');
        if (!confirmed) return;

        const dateKey = editingDateKey;
        delete window.monthlyScheduleData[dateKey];

        closeDayModal();
        renderCalendar();
        saveScheduleToDrive();

        if (typeof AppState !== 'undefined' && AppState.isLoggedIn) {
            if (typeof window.deleteWorkCalendarEvent === 'function') window.deleteWorkCalendarEvent(dateKey).catch(err => console.error('Lỗi xóa sự kiện Lịch (Ca chính):', err));
            if (typeof window.deleteOtCalendarEvent === 'function') window.deleteOtCalendarEvent(dateKey).catch(err => console.error('Lỗi xóa sự kiện Lịch (OT):', err));
            if (typeof window.deleteGoogleTask === 'function') window.deleteGoogleTask(dateKey).catch(err => console.error('Lỗi xóa Google Task:', err));
        }
    } catch (e) {
        console.error('Lỗi xóa lịch ngày:', e);
        alert('Có lỗi khi xóa lịch làm việc của ngày này. Vui lòng thử lại. (Chi tiết lỗi đã ghi trong Console F12)');
        closeDayModal();
    }
}

function handleExcelUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const data = new Uint8Array(e.target.result);
            const wb = XLSX.read(data, { type: 'array' });
            const rawJson = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);

            let importedCount = 0;
            rawJson.forEach(row => {
                const rawDate = row['Ngày'] || row['Date'];
                const shift = (row['Mã Ca'] || row['Shift'] || 'OFF').toString().trim();
                const ot = (row['OT'] || '').toString().trim();
                const task = (row['Mã PCCV'] || row['Task'] || '').toString().trim();
                const typeRaw = (row['Phân loại'] || row['Type'] || 'Chính chủ').toString().trim().toLowerCase();
                const staff = (row['Nhân sự liên quan'] || row['Staff'] || '').toString().trim();

                const dateKey = parseDateToKey(rawDate);
                if (!dateKey) return;

                let type = 'chinhchu';
                if (typeRaw.includes('đổi') || typeRaw.includes('doi')) type = 'doica';
                else if (typeRaw.includes('trực') || typeRaw.includes('truc')) type = 'trucho';

                window.monthlyScheduleData[dateKey] = {
                    type,
                    shift: shift || 'OFF',
                    ot,
                    task,
                    trade: type === 'doica' ? staff : '',
                    help: type === 'trucho' ? staff : ''
                };
                importedCount++;
            });

            alert(`Import Lịch thành công! (${importedCount} ngày)`);
            renderCalendar();
            saveScheduleToDrive();
        } catch (err) {
            console.error('Lỗi đọc file Excel:', err);
            alert("Không đọc được file Excel. Vui lòng dùng đúng định dạng file mẫu (.xlsx/.xls).");
        } finally {
            const uploadInput = document.getElementById('excel-upload');
            if (uploadInput) uploadInput.value = '';
        }
    };
    reader.readAsArrayBuffer(file);
}

function parseDateToKey(dateStr) {
    if (typeof dateStr === 'number') {
        const date = new Date(Math.round((dateStr - 25569) * 86400 * 1000));
        return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;
    }
    if (typeof dateStr === 'string') {
        const parts = dateStr.split('/');
        if (parts.length === 3) return `${parts[2].trim()}-${parts[1].trim().padStart(2, '0')}-${parts[0].trim().padStart(2, '0')}`;
        if (dateStr.includes('-')) return dateStr.substring(0, 10);
    }
    return null;
}

function escapeHtml(value) {
    return String(value || '').replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
}

function getShiftConfig(code, isOt) {
    if (!code || code === 'OFF') return null;
    const settings = getSafePortalSettings();
    const list = isOt ? settings.otShifts : settings.shifts;
    return (list || []).find(s => s.code === code) || null;
}

function getMeetingsByDate(dateKey) {
    return Object.values(window.monthlyMeetingsData || {}).filter(m => m.date === dateKey).sort((a, b) => (a.start || '').localeCompare(b.start || ''));
}

function renderScheduleAgenda() {
    const agenda = document.getElementById('schedule-agenda');
    const meetingAgenda = document.getElementById('meeting-agenda');
    if (!agenda || !meetingAgenda) return;
    const workItems = Object.entries(window.monthlyScheduleData || {}).filter(([, d]) => d.task || (d.shift && d.shift !== 'OFF') || d.ot).sort(([a], [b]) => a.localeCompare(b));
    const taskCountEl = document.getElementById('schedule-task-count');
    if (taskCountEl) taskCountEl.innerText = workItems.length;
    agenda.innerHTML = workItems.length ? workItems.map(([date, d]) => `<button class="agenda-item" onclick="openDayModal('${date}')"><b>${date.slice(8, 10)}/${date.slice(5, 7)}</b><span>${escapeHtml(d.shift || 'OFF')}${d.ot ? ` · OT ${escapeHtml(d.ot)}` : ''}</span><small>${escapeHtml(d.task || 'Chưa phân công PCCV')}</small></button>`).join('') : '<div class="empty-agenda">Chưa có lịch làm việc trong tháng.</div>';

    const meetings = Object.values(window.monthlyMeetingsData || {}).sort((a, b) => (`${a.date} ${a.start}`).localeCompare(`${b.date} ${b.start}`));
    const meetingCountEl = document.getElementById('meeting-count');
    if (meetingCountEl) meetingCountEl.innerText = meetings.length;
    meetingAgenda.innerHTML = meetings.length ? meetings.map(m => `<button class="agenda-item meeting" onclick="openMeetingModal('${m.id}')"><b>${m.date.slice(8, 10)}/${m.date.slice(5, 7)} · ${escapeHtml(m.start)}</b><span>${escapeHtml(m.title)}</span><small>${m.mode === 'online' ? 'Online' : 'Offline'} · ${escapeHtml(m.location)}</small></button>`).join('') : '<div class="empty-agenda">Chưa có lịch họp trong tháng.</div>';
}

function closeMeetingModal() {
    const modal = document.getElementById('meeting-modal');
    if (modal) modal.classList.remove('active');
    editingMeetingId = null;
}

function updateMeetingLocationLabel() {
    const modeEl = document.getElementById('meeting-mode');
    const online = modeEl ? modeEl.value === 'online' : false;
    const labelEl = document.getElementById('meeting-location-label');
    const locEl = document.getElementById('meeting-location');
    if (labelEl) labelEl.innerText = online ? 'Link Webex / Google Meet' : 'Địa chỉ văn phòng / phòng họp';
    if (locEl) locEl.placeholder = online ? 'https://meet.google.com/... hoặc link Webex' : 'VD: Văn phòng Q1 - Phòng họp A';
}

window.openMeetingModal = function (meetingId) {
    try {
        editingMeetingId = meetingId || null;
        const m = editingMeetingId ? window.monthlyMeetingsData[editingMeetingId] : null;

        const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
        const setText = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };

        setText('meeting-modal-title', m ? 'Cập nhật lịch họp' : 'Thêm lịch họp');
        setVal('meeting-date', m && m.date ? m.date : `${currentDate.getFullYear()}-${(currentDate.getMonth() + 1).toString().padStart(2, '0')}-01`);
        setVal('meeting-start', m && m.start ? m.start : '09:00');
        setVal('meeting-end', m && m.end ? m.end : '10:00');
        setVal('meeting-mode', m && m.mode ? m.mode : 'offline');
        setVal('meeting-title', m && m.title ? m.title : '');
        setVal('meeting-content', m && m.content ? m.content : '');
        setVal('meeting-location', m && m.location ? m.location : '');

        const delBtn = document.getElementById('btn-delete-meeting');
        if (delBtn) delBtn.style.display = m ? 'inline-flex' : 'none';

        updateMeetingLocationLabel();
        const modal = document.getElementById('meeting-modal');
        if (modal) modal.classList.add('active');
    } catch (e) {
        console.error('Lỗi mở modal Lịch họp:', e);
        alert('Có lỗi khi mở popup Lịch họp. Vui lòng thử lại.');
    }
};

function saveMeetingEdit() {
    try {
        const getVal = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };

        const date = getVal('meeting-date');
        const title = getVal('meeting-title').trim();
        if (!date || !title) return alert('Vui lòng nhập ngày họp và tiêu đề.');
        const id = editingMeetingId || `meeting_${Date.now()}`;
        const previousMeeting = editingMeetingId ? window.monthlyMeetingsData[editingMeetingId] : null;
        if (previousMeeting && previousMeeting.date !== date && typeof window.deleteMeetingCalendarEvent === 'function') {
            window.deleteMeetingCalendarEvent(previousMeeting).catch(err => console.error('Lỗi xóa sự kiện Lịch họp cũ:', err));
        }
        window.monthlyMeetingsData[id] = {
            id, date,
            start: getVal('meeting-start') || '09:00',
            end: getVal('meeting-end') || '10:00',
            mode: getVal('meeting-mode'),
            title,
            content: getVal('meeting-content').trim(),
            location: getVal('meeting-location').trim()
        };
        closeMeetingModal();
        renderCalendar();
        saveMeetingsToDrive();

        if (typeof AppState !== 'undefined' && AppState.isLoggedIn && typeof syncMeetingCalendarEvent === 'function') {
            syncMeetingCalendarEvent(window.monthlyMeetingsData[id]).catch(err => console.error('Lỗi đồng bộ Lịch họp:', err));
        }
    } catch (e) {
        console.error('Lỗi lưu Lịch họp:', e);
        alert('Có lỗi khi lưu Lịch họp. Vui lòng thử lại.');
        closeMeetingModal();
    }
}

function deleteMeetingEdit() {
    try {
        if (!editingMeetingId) return;
        const meeting = window.monthlyMeetingsData[editingMeetingId];
        if (meeting && typeof window.deleteMeetingCalendarEvent === 'function') {
            window.deleteMeetingCalendarEvent(meeting).catch(err => console.error('Lỗi xóa sự kiện Lịch họp:', err));
        }
        delete window.monthlyMeetingsData[editingMeetingId];
        closeMeetingModal();
        renderCalendar();
        saveMeetingsToDrive();
    } catch (e) {
        console.error('Lỗi xóa Lịch họp:', e);
        alert('Có lỗi khi xóa Lịch họp. Vui lòng thử lại.');
        closeMeetingModal();
    }
}

async function syncToGoogleEcosystem() {
    if (typeof AppState === 'undefined' || !AppState.isLoggedIn) return alert("Vui lòng đăng nhập Google trước!");

    const keys = Object.keys(window.monthlyScheduleData);
    const meetingItems = Object.values(window.monthlyMeetingsData || {});
    if (keys.length === 0 && meetingItems.length === 0) return alert("Không có dữ liệu để đồng bộ.");

    alert("Đang tiến hành đồng bộ nền... Quá trình này có thể mất vài giây, vui lòng không tắt trình duyệt.");

    try {
        const settings = getSafePortalSettings();

        for (const key of keys) {
            const dayData = window.monthlyScheduleData[key];
            const hasMainShift = dayData.shift && dayData.shift !== 'OFF';
            const hasOT = dayData.ot && dayData.ot.trim() !== '';

            if (!hasMainShift && !hasOT) {
                if (typeof window.deleteWorkCalendarEvent === 'function') await window.deleteWorkCalendarEvent(key);
                if (typeof window.deleteOtCalendarEvent === 'function') await window.deleteOtCalendarEvent(key);
            } else {
                let shiftTime = "08:00 - 17:00";

                if (hasMainShift) {
                    const conf = (settings.shifts || []).find(s => s.code === dayData.shift);
                    if (conf) shiftTime = conf.time;
                } else if (!hasMainShift && hasOT) {
                    const conf = (settings.otShifts || []).find(s => s.code === dayData.ot);
                    if (conf) shiftTime = conf.time;
                }

                let desc = [];
                if (dayData.task) desc.push(`PCCV: ${dayData.task}`);
                if (hasMainShift && hasOT) desc.push(`OT: ${dayData.ot}`);

                if (typeof syncCalendarEvent === 'function') await syncCalendarEvent(key, dayData, shiftTime, desc.join('\n'));

                if (hasMainShift && hasOT) {
                    let otTime = null;
                    const otConf = (settings.otShifts || []).find(s => s.code === dayData.ot);
                    if (otConf) otTime = otConf.time;

                    if (otTime && typeof window.syncOtCalendarEvent === 'function') {
                        let otDesc = [`Ca chính: ${dayData.shift}`];
                        if (dayData.task) otDesc.push(`PCCV: ${dayData.task}`);
                        await window.syncOtCalendarEvent(key, dayData, otTime, otDesc.join('\n'));
                    } else if (typeof window.deleteOtCalendarEvent === 'function') {
                        await window.deleteOtCalendarEvent(key);
                    }
                } else if (typeof window.deleteOtCalendarEvent === 'function') {
                    await window.deleteOtCalendarEvent(key);
                }
            }

            if (dayData.task && dayData.task.trim() !== '') {
                let taskNote = [];
                if (hasMainShift) taskNote.push(`Ca: ${dayData.shift}`);
                if (hasOT) taskNote.push(`OT: ${dayData.ot}`);
                if (typeof syncGoogleTask === 'function') await syncGoogleTask(key, dayData.task, taskNote.join(' | '));
            } else {
                if (typeof deleteGoogleTask === 'function') await deleteGoogleTask(key);
            }
        }

        for (const meeting of meetingItems) {
            if (typeof syncMeetingCalendarEvent === 'function') await syncMeetingCalendarEvent(meeting);
        }

        alert("✅ Đã đồng bộ Lịch, Task và Lịch họp lên Google thành công!");
    } catch (err) {
        console.error('Lỗi đồng bộ Google Ecosystem:', err);
        alert("Có lỗi xảy ra trong quá trình đồng bộ lên Google. Một phần dữ liệu có thể đã đồng bộ thành công, vui lòng kiểm tra lại Google Calendar/Tasks hoặc thử đồng bộ lại.");
    }
}

async function checkSyncWithGoogleHandler() {
    if (typeof AppState === 'undefined' || !AppState.isLoggedIn) return alert("Vui lòng đăng nhập Google trước!");
    if (typeof window.reconcileMonthWithGoogle !== 'function') {
        return alert("Chức năng kiểm tra đồng bộ chưa sẵn sàng, vui lòng tải lại trang.");
    }

    const btn = document.getElementById('btn-check-sync');
    const originalHtml = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i class='bx bx-loader-alt bx-spin'></i> Đang kiểm tra...`;
    }

    try {
        const result = await window.reconcileMonthWithGoogle(currentDate);

        if (result.changedSchedule) await saveScheduleToDrive();
        if (result.changedMeeting) await saveMeetingsToDrive();

        renderCalendar();

        if (result.changed) {
            alert("✅ Đã kiểm tra xong. Dữ liệu Lịch làm việc / Lịch họp trên Portal đã được cập nhật lại cho khớp với những thay đổi (sửa/xoá) trên Google Calendar & Google Tasks trong tháng này.");
        } else {
            alert("Dữ liệu trên Portal đã khớp hoàn toàn với Google Calendar/Tasks trong tháng này. Không có gì cần cập nhật.");
        }
    } catch (err) {
        console.error('Lỗi kiểm tra đồng bộ với Google:', err);
        alert("Có lỗi xảy ra khi kiểm tra đồng bộ với Google. Vui lòng thử lại sau.");
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        }
    }
}

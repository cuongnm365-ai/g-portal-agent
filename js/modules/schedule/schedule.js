window.monthlyScheduleData = window.monthlyScheduleData || {};
window.monthlyMeetingsData = window.monthlyMeetingsData || {};
let currentDate = new Date();
let editingDateKey = null;
let editingMeetingId = null;

document.addEventListener('DOMContentLoaded', () => {
    // Mỗi bước bọc try/catch riêng: nếu 1 bước lỗi, các bước còn lại (đặc biệt là
    // gắn sự kiện cho nút File Mẫu / Import / Đóng modal) vẫn được thực thi bình thường.
    try { initCalendar(); } catch (e) { console.error('initCalendar error:', e); }
    try { initScheduleEvents(); } catch (e) { console.error('initScheduleEvents error:', e); }
});

function initCalendar() {
    renderCalendar();
}

function initScheduleEvents() {
    document.getElementById('btn-prev-month').addEventListener('click', () => { currentDate.setMonth(currentDate.getMonth() - 1); changeMonthHandler(); });
    document.getElementById('btn-next-month').addEventListener('click', () => { currentDate.setMonth(currentDate.getMonth() + 1); changeMonthHandler(); });

    // Download Lịch Mẫu
    document.getElementById('btn-download-schedule-tpl').addEventListener('click', () => {
        const ws_data = [["Ngày", "Mã Ca", "OT", "Mã PCCV", "Phân loại", "Nhân sự liên quan"]];
        ws_data.push(["01/07/2026", "S1", "S+", "CHAT", "Chính chủ", ""]);
        ws_data.push(["02/07/2026", "S2", "", "", "Đổi ca", "NV01"]);

        const ws = XLSX.utils.aoa_to_sheet(ws_data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "LichLamViec");
        XLSX.writeFile(wb, "Mau_LichLamViec.xlsx");
    });

    document.getElementById('excel-upload').addEventListener('change', handleExcelUpload);

    // Modal Events
    document.getElementById('btn-close-modal').addEventListener('click', closeDayModal);
    document.getElementById('day-modal').addEventListener('click', (e) => {
        if (e.target.id === 'day-modal') closeDayModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeDayModal();
    });

    document.getElementById('modal-shift-type').addEventListener('change', function () {
        const val = this.value;
        document.getElementById('modal-trade-group').style.display = val === 'doica' ? 'block' : 'none';
        document.getElementById('modal-help-group').style.display = val === 'trucho' ? 'block' : 'none';
    });

    document.getElementById('btn-save-day').addEventListener('click', saveDayEdit);
    document.getElementById('btn-sync-calendar').addEventListener('click', syncToGoogleEcosystem);
    document.getElementById('btn-add-meeting').addEventListener('click', () => openMeetingModal());
    document.getElementById('btn-close-meeting-modal').addEventListener('click', closeMeetingModal);
    document.getElementById('meeting-modal').addEventListener('click', (e) => { if (e.target.id === 'meeting-modal') closeMeetingModal(); });
    document.getElementById('btn-save-meeting').addEventListener('click', saveMeetingEdit);
    document.getElementById('btn-delete-meeting').addEventListener('click', deleteMeetingEdit);
    document.getElementById('meeting-mode').addEventListener('change', updateMeetingLocationLabel);
}

function closeDayModal() {
    document.getElementById('day-modal').classList.remove('active');
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
        await saveJsonToDrive(getScheduleFileName(), window.monthlyScheduleData, window.GPORTAL_FOLDERS.shifts);
    }
}

async function saveMeetingsToDrive() {
    if (typeof AppState !== 'undefined' && AppState.isLoggedIn && window.GPORTAL_FOLDERS) {
        await saveJsonToDrive(getMeetingsFileName(), window.monthlyMeetingsData, window.GPORTAL_FOLDERS.shifts);
    }
}

window.loadScheduleFromDrive = async function () {
    if (!window.GPORTAL_FOLDERS) return;
    const data = await getJsonFromDrive(getScheduleFileName(), window.GPORTAL_FOLDERS.shifts);
    if (data) { window.monthlyScheduleData = data; renderCalendar(); }
    const meetings = await getJsonFromDrive(getMeetingsFileName(), window.GPORTAL_FOLDERS.shifts);
    window.monthlyScheduleData = data || {};
    window.monthlyMeetingsData = meetings || {};
    renderCalendar();
}

window.renderCalendar = function () {
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
        const dayData = window.monthlyScheduleData[dateKey] || { shift: 'OFF', type: 'chinhchu' };

        let shiftColor = '#475569';
        if (dayData.shift !== 'OFF' && window.portalSettings && Array.isArray(window.portalSettings.shifts)) {
            const shiftConfig = window.portalSettings.shifts.find(s => s.code === dayData.shift);
            if (shiftConfig) shiftColor = shiftConfig.color;
        }

        let tagsHtml = '';
        if (dayData.shift !== 'OFF') {
            tagsHtml += `<div class="shift-tag" style="background-color: ${shiftColor}"><span>Ca: ${dayData.shift}</span></div>`;
        }
        if (dayData.ot) {
            let otColor = '#ea4335';
            if (window.portalSettings && Array.isArray(window.portalSettings.otShifts)) {
                const otConfig = window.portalSettings.otShifts.find(s => s.code === dayData.ot);
                if (otConfig) otColor = otConfig.color;
            }
            tagsHtml += `<span class="ot-tag" style="background:${otColor}">OT: ${dayData.ot}</span>`;
        }
        if (dayData.task) tagsHtml += `<div class="task-tag"><i class='bx bx-check-square'></i> ${dayData.task}</div>`;

        if (dayData.type === 'doica' && dayData.trade) tagsHtml += `<div class="trade-tag"><i class='bx bx-transfer'></i> Đổi: ${dayData.trade}</div>`;
        if (dayData.type === 'trucho' && dayData.help) tagsHtml += `<div class="trade-tag" style="background:#10b981"><i class='bx bx-support'></i> Hộ: ${dayData.help}</div>`;

        calendarGrid.innerHTML += `
            <div class="calendar-day ${isToday ? 'today' : ''}" onclick="openDayModal('${dateKey}')">
                <div class="day-number">${day}</div><div class="day-content">${tagsHtml}</div>
            </div>`;
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
}

function openDayModal(dateKey) {
window.openDayModal = function (dateKey) {
    editingDateKey = dateKey;
    const dayData = window.monthlyScheduleData[dateKey] || { type: 'chinhchu', shift: 'OFF', ot: '', task: '', trade: '', help: '' };

    const parts = dateKey.split('-');
    document.getElementById('modal-date-title').innerText = `Hiệu chỉnh: ${parts[2]}/${parts[1]}/${parts[0]}`;

    if (window.portalSettings) {
        const shiftsHtml = `<option value="OFF">OFF (Nghỉ)</option>` +
            (window.portalSettings.shifts || []).map(s => `<option value="${s.code}">${s.code} (${s.time})</option>`).join('');
        document.getElementById('modal-shift').innerHTML = shiftsHtml;

        const otHtml = `<option value="">-- Không có --</option>` +
            (window.portalSettings.otShifts || []).map(s => `<option value="${s.code}">${s.code} (${s.time})</option>`).join('');
        document.getElementById('modal-ot').innerHTML = otHtml;

        const taskSelect = document.getElementById('modal-task');
        taskSelect.innerHTML = `<option value="">-- Không có --</option>` +
            (window.portalSettings.tasks || []).map(t => `<option value="${t.name}">${t.name}</option>`).join('');

        const staffOptions = `<option value="">-- Không có --</option>` +
            (window.portalSettings.staffs || []).map(s => `<option value="${s.name}">${s.name} (${s.id})</option>`).join('');
        document.getElementById('modal-trade').innerHTML = staffOptions;
        document.getElementById('modal-help').innerHTML = staffOptions;
    }

@@ -218,85 +230,177 @@ function handleExcelUpload(event) {
            alert("Import Lịch thành công!");
            renderCalendar(); saveScheduleToDrive();
        } catch (err) {
            console.error('Lỗi đọc file Excel:', err);
            alert("Không đọc được file Excel. Vui lòng dùng đúng định dạng file mẫu (.xlsx/.xls).");
        } finally {
            document.getElementById('excel-upload').value = '';
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
    if (!code || code === 'OFF' || !window.portalSettings) return null;
    const list = isOt ? window.portalSettings.otShifts : window.portalSettings.shifts;
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
    document.getElementById('schedule-task-count').innerText = workItems.length;
    agenda.innerHTML = workItems.length ? workItems.map(([date, d]) => `<button class="agenda-item" onclick="openDayModal('${date}')"><b>${date.slice(8,10)}/${date.slice(5,7)}</b><span>${escapeHtml(d.shift || 'OFF')}${d.ot ? ` · OT ${escapeHtml(d.ot)}` : ''}</span><small>${escapeHtml(d.task || 'Chưa phân công PCCV')}</small></button>`).join('') : '<div class="empty-agenda">Chưa có lịch làm việc trong tháng.</div>';

    const meetings = Object.values(window.monthlyMeetingsData || {}).sort((a, b) => (`${a.date} ${a.start}`).localeCompare(`${b.date} ${b.start}`));
    document.getElementById('meeting-count').innerText = meetings.length;
    meetingAgenda.innerHTML = meetings.length ? meetings.map(m => `<button class="agenda-item meeting" onclick="openMeetingModal('${m.id}')"><b>${m.date.slice(8,10)}/${m.date.slice(5,7)} · ${escapeHtml(m.start)}</b><span>${escapeHtml(m.title)}</span><small>${m.mode === 'online' ? 'Online' : 'Offline'} · ${escapeHtml(m.location)}</small></button>`).join('') : '<div class="empty-agenda">Chưa có lịch họp trong tháng.</div>';
}


function closeMeetingModal() {
    document.getElementById('meeting-modal').classList.remove('active');
    editingMeetingId = null;
}

function updateMeetingLocationLabel() {
    const online = document.getElementById('meeting-mode').value === 'online';
    document.getElementById('meeting-location-label').innerText = online ? 'Link Webex / Google Meet' : 'Địa chỉ văn phòng / phòng họp';
    document.getElementById('meeting-location').placeholder = online ? 'https://meet.google.com/... hoặc link Webex' : 'VD: Văn phòng Q1 - Phòng họp A';
}

window.openMeetingModal = function (meetingId) {
    editingMeetingId = meetingId || null;
    const m = editingMeetingId ? window.monthlyMeetingsData[editingMeetingId] : null;
    document.getElementById('meeting-modal-title').innerText = m ? 'Cập nhật lịch họp' : 'Thêm lịch họp';
    document.getElementById('meeting-date').value = m && m.date ? m.date : `${currentDate.getFullYear()}-${(currentDate.getMonth() + 1).toString().padStart(2, '0')}-01`;
    document.getElementById('meeting-start').value = m && m.start ? m.start : '09:00';
    document.getElementById('meeting-end').value = m && m.end ? m.end : '10:00';
    document.getElementById('meeting-mode').value = m && m.mode ? m.mode : 'offline';
    document.getElementById('meeting-title').value = m && m.title ? m.title : '';
    document.getElementById('meeting-content').value = m && m.content ? m.content : '';
    document.getElementById('meeting-location').value = m && m.location ? m.location : '';
    document.getElementById('btn-delete-meeting').style.display = m ? 'inline-flex' : 'none';
    updateMeetingLocationLabel();
    document.getElementById('meeting-modal').classList.add('active');
}

function saveMeetingEdit() {
    const date = document.getElementById('meeting-date').value;
    const title = document.getElementById('meeting-title').value.trim();
    if (!date || !title) return alert('Vui lòng nhập ngày họp và tiêu đề.');
    const id = editingMeetingId || `meeting_${Date.now()}`;
    const previousMeeting = editingMeetingId ? window.monthlyMeetingsData[editingMeetingId] : null;
    if (previousMeeting && previousMeeting.date !== date && typeof window.deleteMeetingCalendarEvent === 'function') {
        window.deleteMeetingCalendarEvent(previousMeeting);
    }
    window.monthlyMeetingsData[id] = {
        id, date,
        start: document.getElementById('meeting-start').value || '09:00',
        end: document.getElementById('meeting-end').value || '10:00',
        mode: document.getElementById('meeting-mode').value,
        title,
        content: document.getElementById('meeting-content').value.trim(),
        location: document.getElementById('meeting-location').value.trim()
    };
    closeMeetingModal();
    renderCalendar();
    saveMeetingsToDrive();
}

function deleteMeetingEdit() {
    if (!editingMeetingId) return;
    const meeting = window.monthlyMeetingsData[editingMeetingId];
    if (meeting && typeof window.deleteMeetingCalendarEvent === 'function') window.deleteMeetingCalendarEvent(meeting);
    delete window.monthlyMeetingsData[editingMeetingId];
    closeMeetingModal();
    renderCalendar();
    saveMeetingsToDrive();
}
/**
 * FIX QUAN TRỌNG:
 * 1. Trước đây gọi syncGoogleTask(key, dayData.task) - truyền 1 CHUỖI thay vì
 *    OBJECT như hàm yêu cầu -> Google Tasks API từ chối âm thầm -> Task không
 *    bao giờ được đẩy lên. Giờ gọi đúng theo chữ ký mới: syncGoogleTask(key, taskName, notes).
 * 2. Bổ sung: khi PCCV bị gỡ khỏi 1 ngày (dayData.task rỗng) -> gọi deleteGoogleTask()
 *    để xoá Task cũ tương ứng trên Google, đúng yêu cầu "nếu xóa thì cũng phải xóa".
 * 3. Bổ sung: nếu ca chính là OFF nhưng có OT (tăng cường) thì vẫn đẩy lên Calendar
 *    theo khung giờ của ca OT, thay vì xoá hẳn sự kiện của ngày đó.
 */
async function syncToGoogleEcosystem() {
    if (typeof AppState === 'undefined' || !AppState.isLoggedIn) return alert("Vui lòng đăng nhập Google trước!");
    const keys = Object.keys(window.monthlyScheduleData);
    if (keys.length === 0) return alert("Không có dữ liệu lịch để đồng bộ.");

    alert("Đang tiến hành đồng bộ nền... Quá trình này có thể mất vài giây, vui lòng không tắt trình duyệt.");

    for (let key of keys) {
        const dayData = window.monthlyScheduleData[key];
        const hasMainShift = dayData.shift && dayData.shift !== 'OFF';
        const hasOT = dayData.ot && dayData.ot.trim() !== '';

        // ----- 1. ĐỒNG BỘ GOOGLE CALENDAR -----
        if (!hasMainShift && !hasOT) {
            // Ngày nghỉ hoàn toàn, không OT -> xoá sự kiện lịch nếu có
            if (typeof deleteCalendarEvent === 'function') await deleteCalendarEvent(key);
        } else {
            let shiftLabel = hasMainShift ? dayData.shift : `OT ${dayData.ot} (OFF)`;
            let shiftTime = "08:00 - 17:00";

            if (hasMainShift && window.portalSettings?.shifts) {
            if (hasMainShift && window.portalSettings && window.portalSettings.shifts) {
                const conf = window.portalSettings.shifts.find(s => s.code === dayData.shift);
                if (conf) shiftTime = conf.time;
            } else if (!hasMainShift && hasOT && window.portalSettings?.otShifts) {
            } else if (!hasMainShift && hasOT && window.portalSettings && window.portalSettings.otShifts) {
                // Ca chính OFF nhưng có tăng cường -> lấy giờ theo ca OT
                const conf = window.portalSettings.otShifts.find(s => s.code === dayData.ot);
                if (conf) shiftTime = conf.time;
            }

            let desc = [];
            if (dayData.task) desc.push(`PCCV: ${dayData.task}`);
            if (hasMainShift && hasOT) desc.push(`OT: ${dayData.ot}`);
            if (dayData.type === 'doica' && dayData.trade) desc.push(`Đổi ca: ${dayData.trade}`);
            if (dayData.type === 'trucho' && dayData.help) desc.push(`Trực hộ: ${dayData.help}`);

            if (typeof syncCalendarEvent === 'function') await syncCalendarEvent(key, shiftLabel, shiftTime, desc.join('\n'));
        }

        // ----- 2. ĐỒNG BỘ GOOGLE TASKS (PCCV) -----
        if (dayData.task && dayData.task.trim() !== '') {
            let taskNote = [];
            if (hasMainShift) taskNote.push(`Ca: ${dayData.shift}`);
            if (hasOT) taskNote.push(`OT: ${dayData.ot}`);
            if (typeof syncGoogleTask === 'function') await syncGoogleTask(key, dayData.task, taskNote.join(' | '));
        } else {
            if (typeof deleteGoogleTask === 'function') await deleteGoogleTask(key);
        }
    }
    alert("✅ Đã đồng bộ Lịch và Task lên Google thành công!");
    const meetingItems = Object.values(window.monthlyMeetingsData || {});
    for (const meeting of meetingItems) {
        if (typeof syncMeetingCalendarEvent === 'function') await syncMeetingCalendarEvent(meeting);
    }
    alert("✅ Đã đồng bộ Lịch, Task và Lịch họp lên Google thành công!");
    }

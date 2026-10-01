/**
 * schedule.js - Quản lý Lịch làm việc, OT, Lịch họp, PCCV
 * - Lưu trữ: Google Drive (folder "shifts")
 * - Hiển thị: calendar tháng + chi tiết ngày
 * - Auto-sync: Google Calendar, Google Tasks
 */

// ==============================
// CONSTANT & STATE
// ==============================

const SHIFT_CODES = {
    'DA': 'Đêm A',
    'DB': 'Đêm B',
    'SA': 'Sáng A',
    'SB': 'Sáng B',
    'OFF': 'Nghỉ phép',
    'OFF_NP': 'Nghỉ phép không lương'
};

const OT_CODES = {
    'OT1': 'OT 8h',
    'OT2': 'OT 4h',
    'OT3': 'OT 2h'
};

let currentDate = new Date();
let todayKey = getDateKey(new Date());

window.monthlyScheduleData = {};
window.monthlyMeetingsData = {};

// ==============================
// KHỞI TẠO
// ==============================

document.addEventListener('DOMContentLoaded', () => {
    renderCalendar();
    initScheduleEventListeners();
    // Không load ngay ở đây — chờ sau khi Google Auth sẵn sàng
});

function initScheduleEventListeners() {
    // Previous / Next month buttons
    const btnPrev = document.getElementById('sch-btn-prev-month');
    const btnNext = document.getElementById('sch-btn-next-month');
    const btnToday = document.getElementById('sch-btn-today');
    if (btnPrev) btnPrev.addEventListener('click', () => { currentDate.setMonth(currentDate.getMonth() - 1); changeMonthHandler(); });
    if (btnNext) btnNext.addEventListener('click', () => { currentDate.setMonth(currentDate.getMonth() + 1); changeMonthHandler(); });
    if (btnToday) btnToday.addEventListener('click', () => { currentDate = new Date(); changeMonthHandler(); });

    // Add day
    const btnAdd = document.getElementById('sch-btn-add-day');
    if (btnAdd) btnAdd.addEventListener('click', () => { openDayModal(todayKey); });

    // Sync to Google
    const btnSync = document.getElementById('btn-sync-calendar');
    if (btnSync) btnSync.addEventListener('click', syncToGoogleEcosystem);

    // Modal
    const btnCloseModal = document.getElementById('sch-btn-close-modal');
    if (btnCloseModal) btnCloseModal.addEventListener('click', closeDayModal);

    const btnAddMeeting = document.getElementById('sch-btn-add-meeting');
    if (btnAddMeeting) btnAddMeeting.addEventListener('click', openMeetingModal);

    const btnCloseMeetingModal = document.getElementById('sch-btn-close-meeting-modal');
    if (btnCloseMeetingModal) btnCloseMeetingModal.addEventListener('click', closeMeetingModal);

    const btnSaveDay = document.getElementById('sch-btn-save-day');
    if (btnSaveDay) btnSaveDay.addEventListener('click', saveDaySchedule);

    const btnSaveMeeting = document.getElementById('sch-btn-save-meeting');
    if (btnSaveMeeting) btnSaveMeeting.addEventListener('click', saveMeeting);

    const btnDeleteDay = document.getElementById('sch-btn-delete-day');
    if (btnDeleteDay) btnDeleteDay.addEventListener('click', deleteDay);

    const btnDeleteMeeting = document.getElementById('sch-btn-delete-meeting');
    if (btnDeleteMeeting) btnDeleteMeeting.addEventListener('click', deleteMeeting);
}

// ==============================
// CHANGE MONTH - Load từ Drive trước khi xóa dữ liệu cũ
// ==============================
async function changeMonthHandler() {
    // QUAN TRỌNG: Load từ Drive TRƯỚC khi render/xóa dữ liệu hiện tại
    // Nếu không đăng nhập, chỉ render với dữ liệu hiện có
    if (typeof AppState !== 'undefined' && AppState.isLoggedIn) {
        await loadScheduleFromDrive();
    } else {
        renderCalendar();
    }
}

function getScheduleFileName() {
    const year = currentDate.getFullYear();
    const month = (currentDate.getMonth() + 1).toString().padStart(2, '0');
    return `schedule_${year}_${month}.json`;
}

// Tên file lịch cho một tháng BẤT KỲ (không nhất thiết là tháng đang xem),
// dùng khi Excel import chứa dữ liệu của tháng khác tháng hiện tại.
function getScheduleFileNameForYm(ymKey) {
    const [y, m] = ymKey.split('-');
    return `schedule_${y}_${m}.json`;
}

function getMeetingsFileName() {
    const year = currentDate.getFullYear();
    const month = (currentDate.getMonth() + 1).toString().padStart(2, '0');
    return `meetings_${year}_${month}.json`;
}

function getCurrentYmKey() {
    return `${currentDate.getFullYear()}-${(currentDate.getMonth() + 1).toString().padStart(2, '0')}`;
}

async function saveScheduleToDrive() {
    if (typeof AppState !== 'undefined' && AppState.isLoggedIn && window.GPORTAL_FOLDERS) {
        try {
            await saveJsonToDrive(getScheduleFileName(), window.monthlyScheduleData, window.GPORTAL_FOLDERS.shifts);
            console.log('[Schedule] Lưu lịch làm việc lên Drive thành công.');
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
            console.log('[Schedule] Lưu lịch họp lên Drive thành công.');
        } catch (e) {
            console.error('Lỗi lưu Lịch họp lên Drive:', e);
            alert('Có lỗi khi lưu Lịch họp lên Google Drive. Vui lòng thử lại.');
        }
    }
}

// Load dữ liệu lịch từ Google Drive cho tháng hiện tại
// QUAN TRỌNG: Không xóa dữ liệu cũ nếu load thất bại - giữ lại dữ liệu hiện có
window.loadScheduleFromDrive = async function () {
    if (!window.GPORTAL_FOLDERS) {
        console.warn('[Schedule] GPORTAL_FOLDERS chưa khả dụng, không load từ Drive.');
        renderCalendar();
        return;
    }
    try {
        console.log(`[Schedule] Đang load ${getScheduleFileName()} và ${getMeetingsFileName()} từ Drive...`);
        const [data, meetings] = await Promise.all([
            getJsonFromDrive(getScheduleFileName(), window.GPORTAL_FOLDERS.shifts),
            getJsonFromDrive(getMeetingsFileName(), window.GPORTAL_FOLDERS.shifts)
        ]);
        // Chỉ gán lại nếu data load thành công, nếu null (file không tồn tại) vẫn giữ lại dữ liệu cũ
        if (data !== null) window.monthlyScheduleData = data;
        if (meetings !== null) window.monthlyMeetingsData = meetings;
        console.log('[Schedule] Tải lịch từ Drive thành công:', window.monthlyScheduleData);
        renderCalendar();
    } catch (e) {
        console.error('Lỗi tải Lịch làm việc từ Drive:', e);
        // Lỗi mạng hoặc API -> giữ nguyên dữ liệu cũ, không xóa
        window.monthlyScheduleData = window.monthlyScheduleData || {};
        window.monthlyMeetingsData = window.monthlyMeetingsData || {};
        renderCalendar();
    }
};

// ==================== TIỆN ÍCH CA / KHUNG GIỜ ====================

function getDateKey(d) {
    const y = d.getFullYear();
    const m = (d.getMonth() + 1).toString().padStart(2, '0');
    const day = d.getDate().toString().padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function getMonthKey(d) {
    const y = d.getFullYear();
    const m = (d.getMonth() + 1).toString().padStart(2, '0');
    return `${y}-${m}`;
}

function pad2(n) { return String(n).padStart(2, '0'); }

// ==================== RENDER CALENDAR ====================

function renderCalendar() {
    const monthLabel = document.getElementById('sch-month-label');
    if (monthLabel) {
        monthLabel.textContent = `Tháng ${currentDate.getMonth() + 1} năm ${currentDate.getFullYear()}`;
    }

    const container = document.getElementById('sch-calendar-grid');
    if (!container) return;

    // Tính ngày bắt đầu tháng
    const firstDay = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    const lastDay = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
    const startWeekday = firstDay.getDay(); // 0=Sunday

    // Tính ngày đầu tiên của grid (từ tháng trước)
    const startDate = new Date(firstDay);
    startDate.setDate(startDate.getDate() - startWeekday);

    const todayKey = getDateKey(new Date());
    const monthKey = getMonthKey(currentDate);

    // Tạo lưới 6x7 (42 ô)
    const cells = [];
    for (let i = 0; i < 42; i++) {
        const d = new Date(startDate);
        d.setDate(d.getDate() + i);
        const key = getDateKey(d);
        const inMonth = d.getMonth() === currentDate.getMonth();
        const dayData = window.monthlyScheduleData[key] || {};
        
        const shiftDisplay = dayData.shift ? SHIFT_CODES[dayData.shift] || dayData.shift : '–';
        const otDisplay = dayData.ot ? `OT: ${dayData.ot}` : '–';
        const taskDisplay = dayData.task ? `📌 ${dayData.task}` : '';
        
        cells.push({
            date: d,
            key: key,
            day: d.getDate(),
            inMonth: inMonth,
            shift: shiftDisplay,
            ot: otDisplay,
            task: taskDisplay,
            isToday: key === todayKey
        });
    }

    const cellOpen = (x) => x.inMonth ? ` onclick="openDayModal('${x.key}')"` : '';
    const cellCls = (x, extra) => `sch-wcell${extra ? ' ' + extra : ''}${x.inMonth ? '' : ' outside'}${x.key === todayKey ? ' today' : ''}`;

    const html = cells.map(x => `
        <div class="${cellCls(x)}"${cellOpen(x)}>
            <div class="sch-wcell-day">${x.day}</div>
            <div class="sch-wcell-shift">${x.shift}</div>
            <div class="sch-wcell-ot">${x.ot}</div>
            <div class="sch-wcell-task">${x.task}</div>
        </div>
    `).join('');

    container.innerHTML = html;
}

// ==================== DAY MODAL ====================

window.openDayModal = function(key) {
    const dayData = window.monthlyScheduleData[key] || {};
    const modal = document.getElementById('sch-day-modal');
    if (!modal) return;

    document.getElementById('sch-modal-day-title').textContent = `Ngày ${key}`;
    document.getElementById('sch-modal-day-key').value = key;

    // Set values
    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    setVal('sch-day-shift', dayData.shift || '');
    setVal('sch-day-shift-time', dayData.shiftTime || '08:00-17:00');
    setVal('sch-day-ot', dayData.ot || '');
    setVal('sch-day-ot-time', dayData.otTime || '');
    setVal('sch-day-type', dayData.type || 'chinhchu');
    setVal('sch-day-trade', dayData.trade || '');
    setVal('sch-day-help', dayData.help || '');
    setVal('sch-day-task', dayData.task || '');
    setVal('sch-day-note', dayData.note || '');

    modal.classList.add('active');
};

function closeDayModal() {
    const modal = document.getElementById('sch-day-modal');
    if (modal) modal.classList.remove('active');
}

async function saveDaySchedule() {
    const key = document.getElementById('sch-modal-day-key').value;
    const getVal = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };

    const dayData = {
        shift: getVal('sch-day-shift'),
        shiftTime: getVal('sch-day-shift-time'),
        ot: getVal('sch-day-ot'),
        otTime: getVal('sch-day-ot-time'),
        type: getVal('sch-day-type'),
        trade: getVal('sch-day-trade'),
        help: getVal('sch-day-help'),
        task: getVal('sch-day-task'),
        note: getVal('sch-day-note')
    };

    // Remove empty fields
    Object.keys(dayData).forEach(k => !dayData[k] && delete dayData[k]);

    if (!Object.keys(dayData).length) {
        delete window.monthlyScheduleData[key];
    } else {
        window.monthlyScheduleData[key] = dayData;
    }

    closeDayModal();
    renderCalendar();
    await saveScheduleToDrive();
};

function deleteDay() {
    const key = document.getElementById('sch-modal-day-key').value;
    if (confirm(`Xóa ngày ${key}?`)) {
        delete window.monthlyScheduleData[key];
        closeDayModal();
        renderCalendar();
        saveScheduleToDrive();
    }
}

// ==================== MEETING MODAL ====================

window.openMeetingModal = function(id) {
    const modal = document.getElementById('sch-meeting-modal');
    if (!modal) return;

    if (id) {
        // Edit existing
        const meeting = window.monthlyMeetingsData[id];
        if (!meeting) return;
        document.getElementById('sch-modal-meeting-title').textContent = 'Sửa Lịch Họp';
        document.getElementById('sch-meeting-modal-id').value = id;
        const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
        setVal('sch-meeting-date', meeting.date);
        setVal('sch-meeting-title', meeting.title);
        setVal('sch-meeting-time-start', meeting.start || '09:00');
        setVal('sch-meeting-time-end', meeting.end || '10:00');
        setVal('sch-meeting-mode', meeting.mode || 'offline');
        setVal('sch-meeting-location', meeting.location || '');
        setVal('sch-meeting-content', meeting.content || '');
    } else {
        // New
        document.getElementById('sch-modal-meeting-title').textContent = 'Thêm Lịch Họp';
        document.getElementById('sch-meeting-modal-id').value = '';
        document.getElementById('sch-meeting-form').reset();
        const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
        setVal('sch-meeting-date', getDateKey(new Date()));
        setVal('sch-meeting-time-start', '09:00');
        setVal('sch-meeting-time-end', '10:00');
        setVal('sch-meeting-mode', 'offline');
    }

    modal.classList.add('active');
};

function closeMeetingModal() {
    const modal = document.getElementById('sch-meeting-modal');
    if (modal) modal.classList.remove('active');
}

async function saveMeeting() {
    const getVal = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };
    const meetingId = getVal('sch-meeting-modal-id');
    const id = meetingId || `meeting_${Date.now()}`;

    const meeting = {
        id: id,
        date: getVal('sch-meeting-date'),
        title: getVal('sch-meeting-title'),
        start: getVal('sch-meeting-time-start'),
        end: getVal('sch-meeting-time-end'),
        mode: getVal('sch-meeting-mode'),
        location: getVal('sch-meeting-location'),
        content: getVal('sch-meeting-content')
    };

    window.monthlyMeetingsData[id] = meeting;
    closeMeetingModal();
    await saveMeetingsToDrive();
    // TODO: sync to Google Calendar
}

function deleteMeeting() {
    const id = document.getElementById('sch-meeting-modal-id').value;
    if (id && confirm('Xóa lịch họp này?')) {
        delete window.monthlyMeetingsData[id];
        closeMeetingModal();
        saveMeetingsToDrive();
    }
}

// ==================== SYNC TO GOOGLE ====================

let googleBulkSyncing = false;

async function syncScheduleDayToGoogle(key, dayData, settings) {
    if (!dayData || !dayData.shift) return { eventError: null, taskError: null };

    const result = {
        eventError: null,
        taskError: null
    };

    try {
        if (dayData.shift && dayData.shift !== 'OFF') {
            await syncCalendarEvent(key, dayData, dayData.shiftTime, dayData.note || '');
        }

        if (dayData.ot) {
            await syncOtCalendarEvent(key, dayData, dayData.otTime, dayData.note || '');
        }
    } catch (eventErr) {
        console.error(`Lỗi đồng bộ sự kiện ngày ${key}:`, eventErr);
        result.eventError = eventErr;
    }

    try {
        if (dayData.task) {
            const taskNote = [];
            if (dayData.shift) taskNote.push(`Ca: ${dayData.shift}`);
            if (dayData.ot) taskNote.push(`OT: ${dayData.ot}`);
            if (dayData.note) taskNote.push(dayData.note);
            if (typeof syncGoogleTask === 'function') await syncGoogleTask(key, dayData.task, taskNote.join(' | '));
        } else {
            if (typeof deleteGoogleTask === 'function') await deleteGoogleTask(key);
        }
    } catch (taskErr) {
        console.error(`[G-Portal] Lỗi đồng bộ Task PCCV ngày ${key}:`, taskErr);
        result.taskError = taskErr;
    }

    return result;
}

async function syncToGoogleEcosystem() {
    if (typeof AppState === 'undefined' || !AppState.isLoggedIn) return alert("Vui lòng đăng nhập Google trước!");
    if (googleBulkSyncing) return alert("Hệ thống đang đồng bộ, vui lòng chờ hoàn tất rồi bấm lại.");
    googleBulkSyncing = true;
    try {
        await enqueueGoogleSync(runBulkGoogleSync);
    } finally {
        googleBulkSyncing = false;
    }
}

async function runBulkGoogleSync() {

    const keys = Object.keys(window.monthlyScheduleData);
    const meetingItems = Object.values(window.monthlyMeetingsData || {});
    if (keys.length === 0 && meetingItems.length === 0) return alert("Không có dữ liệu để đồng bộ.");

    alert("Đang tiến hành đồng bộ nền... Với lịch cả tháng quá trình này có thể mất khoảng vài chục giây (hệ thống cố tình đi chậm lại một chút để tránh bị Google giới hạn tốc độ), vui lòng không tắt trình duyệt.");

    const taskFailedDates = [];
    const eventFailedDates = [];
    let firstTaskErrorDetail = '';
    let firstEventErrorDetail = '';

    const btn = document.getElementById('btn-sync-calendar');
    const originalBtnHtml = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i class='bx bx-loader-alt bx-spin'></i> Đang đồng bộ...`;
    }

    try {
        const settings = getSafePortalSettings();

        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            const result = await syncScheduleDayToGoogle(key, window.monthlyScheduleData[key], settings);

            if (result && result.eventError) {
                eventFailedDates.push(key);
                if (!firstEventErrorDetail) {
                    const apiErr = result.eventError && result.eventError.result && result.eventError.result.error;
                    firstEventErrorDetail = apiErr ? `${apiErr.code} - ${apiErr.message}` : (result.eventError.message || String(result.eventError));
                }
            }
            if (result && result.taskError) {
                taskFailedDates.push(key);
                if (!firstTaskErrorDetail) {
                    const apiErr = result.taskError && result.taskError.result && result.taskError.result.error;
                    firstTaskErrorDetail = apiErr ? `${apiErr.code} - ${apiErr.message}` : (result.taskError.message || String(result.taskError));
                }
            }

            // Nghỉ 1 nhịp ngắn giữa mỗi ngày để tránh dồn quá nhiều request
            // lên Google API cùng lúc (rate-limit). Không áp dụng cho ngày cuối.
            if (i < keys.length - 1) {
                await window.gportalSleep(500);
            }
        }

        for (const meeting of meetingItems) {
            try {
                await syncMeetingCalendarEvent(meeting);
            } catch (err) {
                console.error(`Lỗi đồng bộ lịch họp ${meeting.id}:`, err);
            }
            await window.gportalSleep(500);
        }

        let summary = 'Đồng bộ hoàn tất!';
        if (eventFailedDates.length > 0) {
            summary += `\n\nCảnh báo: Không đồng bộ được ${eventFailedDates.length} ngày lịch làm việc (${eventFailedDates.join(', ')})`;
            if (firstEventErrorDetail) summary += `\nLỗi: ${firstEventErrorDetail}`;
        }
        if (taskFailedDates.length > 0) {
            summary += `\n\nCảnh báo: Không đồng bộ được ${taskFailedDates.length} Task PCCV (${taskFailedDates.join(', ')})`;
            if (firstTaskErrorDetail) summary += `\nLỗi: ${firstTaskErrorDetail}`;
        }

        alert(summary);
    } catch (err) {
        alert(`Lỗi đồng bộ tổng thể: ${err.message}`);
        console.error('[G-Portal] Lỗi đồng bộ:', err);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalBtnHtml;
        }
    }
}

function getSafePortalSettings() {
    return (window.portalSettings || {});
}

// Polling để đảm bảo `enqueueGoogleSync` sẵn sàng
let enqueueGoogleSyncReady = false;
const waitForEnqueueGoogleSync = setInterval(() => {
    if (typeof window.enqueueGoogleSync === 'function') {
        enqueueGoogleSyncReady = true;
        clearInterval(waitForEnqueueGoogleSync);
    }
}, 100);

// Hook vào lifecycle - load lịch khi đăng nhập xong
window.addEventListener('gportal_profile_ready', () => {
    if (AppState.currentView === 'schedule') window.loadScheduleFromDrive();
});

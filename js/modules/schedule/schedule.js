/**
 * schedule.js - Module Lịch làm việc
 *
 * ============================================================================
 * BẢN VÁ MỚI NHẤT — LỖI "DOUBLE EVENT + TASK" (Event/Task bị nhân đôi)
 * ============================================================================
 * Nguyên nhân gốc rễ (chi tiết đầy đủ xem ghi chú đầu file js/core/googleSync.js):
 * bước "xoá sự kiện cũ trước khi tạo mới" trong googleSync.js trước đây có
 * thể thất bại ÂM THẦM (do bị Google giới hạn tần suất API khi đồng bộ nhiều
 * ngày liên tiếp trong thời gian ngắn), nhưng vẫn tiếp tục tạo sự kiện mới
 * phía sau => sự kiện/task bị NHÂN ĐÔI trên Google.
 *
 * Thay đổi ở file này để phối hợp với bản vá bên googleSync.js:
 *  1) syncScheduleDayToGoogle(): tách rõ 2 loại lỗi — lỗi Event (Lịch chính +
 *     Lịch OT) và lỗi Task (PCCV) — xử lý độc lập, lỗi bên này không làm mất
 *     kết quả bên kia, và CẢ HAI đều được báo cáo đầy đủ cho người dùng thay
 *     vì chỉ báo mỗi Task như bản trước.
 *  2) syncToGoogleEcosystem(): thêm khoảng nghỉ ngắn (150ms) giữa mỗi ngày
 *     khi đồng bộ cả tháng, để giảm khả năng dồn dập request gây rate-limit
 *     — đây là nguyên nhân trực tiếp khiến bug "double" hay xảy ra khi đồng
 *     bộ nhiều ngày cùng lúc.
 *  3) MỚI: nút "Dọn dẹp trùng lặp" (btn-cleanup-duplicates) gọi
 *     window.cleanupDuplicateGoogleData() bên googleSync.js để quét và xoá
 *     sạch các Event/Task đã lỡ bị double từ TRƯỚC KHI có bản vá này — vì
 *     sửa code chỉ ngăn lỗi phát sinh mới, không tự dọn dữ liệu cũ.
 * ============================================================================
 *
 * (Giữ nguyên toàn bộ các bản vá trước đó: gom nhóm Import Excel theo tháng
 * thực tế của từng dòng, fix 2 mũi tên chuyển tháng do id trùng lặp, Import
 * Excel không tự động đẩy lên Google, Settings/staffs fallback mặc định,
 * try/catch quanh openDayModal/saveDayEdit/deleteDayEdit, bindIfPresent()
 * chống 1 phần tử thiếu làm treo cả loạt sự kiện phía sau).
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

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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
    console.warn(`[schedule.js] Không tìm thấy phần tử #${id} trên trang — sự kiện "${eventName}" KHÔNG được gắn. Kiểm tra lại HTML (id có thể đã bị đổi/xóa nhầm, hoặc bị trùng thuộc tính id với phần tử khác).`);
    return false;
}

function initScheduleEvents() {
    bindIfPresent('btn-prev-month', 'click', () => { currentDate.setMonth(currentDate.getMonth() - 1); changeMonthHandler(); });
    bindIfPresent('btn-next-month', 'click', () => { currentDate.setMonth(currentDate.getMonth() + 1); changeMonthHandler(); });

    bindIfPresent('btn-download-schedule-tpl', 'click', () => {
        const ws_data = [["Ngày", "Mã Ca", "OT", "Mã PCCV", "Phân loại", "Nhân sự liên quan"]];
        ws_data.push(["01/07/2026", "S1", "S+", "CHAT", "Chính chủ", ""]);
        ws_data.push(["02/07/2026", "S2", "", "", "Đổi ca", "NV01"]);
        ws_data.push(["03/07/2026", "S1", "", "", "", ""]); // Ví dụ: chỉ cần Ngày + Mã Ca -> tự mặc định Chính chủ

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
    bindIfPresent('btn-cleanup-duplicates', 'click', cleanupDuplicatesHandler);
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

        // Đồng bộ ngay 1 ngày vừa lưu lên Google (Event + Task) — dùng chung
        // đúng hàm syncScheduleDayToGoogle() với luồng "Đồng bộ Google" hàng
        // loạt, để đảm bảo tuân thủ nguyên tắc chống double (xoá thất bại thì
        // không tạo mới) một cách nhất quán, thay vì gọi tay từng API riêng lẻ
        // như trước (vốn chỉ đồng bộ Task, dễ gây lệch dữ liệu so với Event).
        if (typeof AppState !== 'undefined' && AppState.isLoggedIn) {
            const settings = getSafePortalSettings();
            syncScheduleDayToGoogle(savedKey, window.monthlyScheduleData[savedKey], settings).then(result => {
                if (result && (result.eventError || result.taskError)) {
                    let msg = `⚠️ Đã lưu lịch ngày ${savedKey} trên Portal, nhưng gặp lỗi khi đồng bộ lên Google:\n`;
                    if (result.eventError) {
                        const apiErr = result.eventError.result && result.eventError.result.error;
                        msg += `- Lịch (Event): ${apiErr ? `${apiErr.code} - ${apiErr.message}` : (result.eventError.message || String(result.eventError))}\n`;
                    }
                    if (result.taskError) {
                        const apiErr = result.taskError.result && result.taskError.result.error;
                        msg += `- Task PCCV: ${apiErr ? `${apiErr.code} - ${apiErr.message}` : (result.taskError.message || String(result.taskError))}\n`;
                    }
                    msg += `\nDữ liệu KHÔNG bị tạo trùng lặp (hệ thống đã huỷ bước tạo mới nếu không xoá được dữ liệu cũ). Vui lòng bấm "Đồng bộ Google" ở thanh công cụ để thử đồng bộ lại toàn tháng.`;
                    alert(msg);
                }
            }).catch(err => {
                console.error(`[G-Portal] Lỗi đồng bộ ngày ${savedKey}:`, err);
            });
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

/**
 * Đọc 1 dòng dữ liệu từ Excel và trả về { dateKey, dayData } hoặc null nếu
 * dòng không hợp lệ (không đọc được ngày). CHỈ BẮT BUỘC "Ngày" + "Mã Ca":
 * - Thiếu "Mã Ca" -> mặc định 'OFF'.
 * - Thiếu "Phân loại" (hoặc không khớp "đổi ca"/"trực hộ") -> mặc định
 *   'chinhchu' (Chính chủ).
 * - Thiếu OT / Mã PCCV / Nhân sự liên quan -> để trống, không bắt buộc.
 */
function parseScheduleRow(row) {
    const rawDate = row['Ngày'] || row['Date'];
    const dateKey = parseDateToKey(rawDate);
    if (!dateKey) return null;

    const shift = (row['Mã Ca'] || row['Shift'] || 'OFF').toString().trim() || 'OFF';
    const ot = (row['OT'] || '').toString().trim();
    const task = (row['Mã PCCV'] || row['Task'] || '').toString().trim();
    const typeRaw = (row['Phân loại'] || row['Type'] || 'Chính chủ').toString().trim().toLowerCase();
    const staff = (row['Nhân sự liên quan'] || row['Staff'] || '').toString().trim();

    let type = 'chinhchu';
    if (typeRaw.includes('đổi') || typeRaw.includes('doi')) type = 'doica';
    else if (typeRaw.includes('trực') || typeRaw.includes('truc')) type = 'trucho';

    return {
        dateKey,
        dayData: {
            type,
            shift,
            ot,
            task,
            trade: type === 'doica' ? staff : '',
            help: type === 'trucho' ? staff : ''
        }
    };
}

function handleExcelUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async function (e) {
        const uploadInput = document.getElementById('excel-upload');
        try {
            const data = new Uint8Array(e.target.result);
            const wb = XLSX.read(data, { type: 'array' });
            const rawJson = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);

            // Gom từng dòng hợp lệ theo THÁNG (khoá "YYYY-MM") lấy từ chính cột
            // "Ngày" của dòng đó — quan trọng để không lưu nhầm lịch của tháng
            // khác vào file của tháng đang xem trên Portal.
            const groups = {};
            let importedCount = 0;

            rawJson.forEach(row => {
                const parsed = parseScheduleRow(row);
                if (!parsed) return;
                const ymKey = parsed.dateKey.substring(0, 7);
                if (!groups[ymKey]) groups[ymKey] = {};
                groups[ymKey][parsed.dateKey] = parsed.dayData;
                importedCount++;
            });

            if (importedCount === 0) {
                alert('Không đọc được dòng dữ liệu hợp lệ nào trong file. Vui lòng kiểm tra lại cột "Ngày" (định dạng dd/mm/yyyy) và thử lại.');
                return;
            }

            const currentYmKey = getCurrentYmKey();
            const otherYmKeys = Object.keys(groups).filter(k => k !== currentYmKey);
            let otherMonthsSavedCount = 0;
            let otherMonthsSkippedCount = 0;

            // Tháng đang xem trên Portal: cập nhật ngay vào bộ nhớ + lưu theo
            // luồng hiện có (saveScheduleToDrive dùng đúng tên file tháng này).
            if (groups[currentYmKey]) {
                Object.assign(window.monthlyScheduleData, groups[currentYmKey]);
            }

            // Các tháng KHÁC tháng đang xem: tự tải đúng file của tháng đó trên
            // Drive, gộp (merge) với dữ liệu vừa import rồi lưu lại — không cần
            // người dùng phải chuyển tháng thủ công thì mới lưu được.
            if (otherYmKeys.length > 0) {
                if (typeof AppState !== 'undefined' && AppState.isLoggedIn && window.GPORTAL_FOLDERS) {
                    for (const ymKey of otherYmKeys) {
                        try {
                            const fileName = getScheduleFileNameForYm(ymKey);
                            const existing = (await getJsonFromDrive(fileName, window.GPORTAL_FOLDERS.shifts)) || {};
                            const merged = Object.assign({}, existing, groups[ymKey]);
                            await saveJsonToDrive(fileName, merged, window.GPORTAL_FOLDERS.shifts);
                            otherMonthsSavedCount += Object.keys(groups[ymKey]).length;
                        } catch (err) {
                            console.error(`Lỗi lưu lịch tháng ${ymKey}:`, err);
                            otherMonthsSkippedCount += Object.keys(groups[ymKey]).length;
                        }
                    }
                } else {
                    otherYmKeys.forEach(ymKey => { otherMonthsSkippedCount += Object.keys(groups[ymKey]).length; });
                }
            }

            renderCalendar();
            saveScheduleToDrive();

            let msg = `Import Lịch thành công! (${importedCount} ngày)`;
            if (otherMonthsSavedCount > 0) {
                msg += `\nĐã lưu thêm ${otherMonthsSavedCount} ngày thuộc ${otherYmKeys.length} tháng khác (${otherYmKeys.join(', ')}) trực tiếp lên Google Drive — hãy chuyển sang tháng đó để xem.`;
            }
            if (otherMonthsSkippedCount > 0) {
                msg += `\nLưu ý: ${otherMonthsSkippedCount} ngày thuộc tháng khác CHƯA lưu được lên Google Drive (do chưa đăng nhập Google hoặc có lỗi mạng). Vui lòng đăng nhập/kiểm tra mạng rồi import lại các tháng đó.`;
            }
            msg += `\nDữ liệu đã sẵn sàng để hiệu chỉnh trên Portal. Khi hiệu chỉnh xong, bấm "Đồng bộ Google" để đẩy Lịch + Task PCCV lên Google Calendar/Tasks.`;
            alert(msg);
        } catch (err) {
            console.error('Lỗi đọc file Excel:', err);
            alert("Không đọc được file Excel. Vui lòng dùng đúng định dạng file mẫu (.xlsx/.xls).");
        } finally {
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

/**
 * Đồng bộ 1 NGÀY lịch làm việc (ca chính + OT + PCCV) lên Google Calendar và
 * Google Tasks. Hàm dùng chung cho 3 nơi:
 *  1) syncToGoogleEcosystem() — nút "Đồng bộ Google" thủ công, quét toàn bộ
 *     tháng đang xem.
 *  2) saveDayEdit() — tự động đồng bộ ngay sau khi hiệu chỉnh xong 1 ngày.
 *  3) handleExcelUpload() (gián tiếp, qua "Đồng bộ Google" thủ công sau khi
 *     import) — Import Excel CHỈ lưu dữ liệu để hiệu chỉnh, không tự đẩy lên
 *     Google.
 *
 * FIX DOUBLE EVENT/TASK: kết quả trả về giờ tách RÕ 2 loại lỗi độc lập —
 * result.eventError (lỗi khi đồng bộ Lịch chính/OT) và result.taskError (lỗi
 * khi đồng bộ Task PCCV). Vì bên googleSync.js giờ luôn "xoá thất bại thì
 * không tạo mới", nếu 1 trong 2 loại lỗi xảy ra thì NGÀY ĐÓ CHỈ ĐƠN GIẢN LÀ
 * CHƯA ĐỒNG BỘ ĐƯỢC — không có khả năng tạo dữ liệu trùng lặp — và người
 * dùng sẽ được báo rõ để có thể bấm đồng bộ lại.
 */
async function syncScheduleDayToGoogle(key, dayData, settings) {
    const hasMainShift = dayData.shift && dayData.shift !== 'OFF';
    const hasOT = dayData.ot && dayData.ot.trim() !== '';
    const result = { eventError: null, taskError: null };

    try {
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
    } catch (eventErr) {
        console.error(`[G-Portal] Lỗi đồng bộ Lịch (Event) ngày ${key}:`, eventErr);
        result.eventError = eventErr;
    }

    // PCCV (Google Task) — TÁCH RIÊNG khỏi phần Lịch phía trên. Lỗi bên này
    // không ảnh hưởng tới kết quả phần Lịch (và ngược lại), cả 2 đều được ghi
    // nhận độc lập trong result để nơi gọi tổng hợp và báo đầy đủ cho người
    // dùng, thay vì chỉ báo mỗi Task như bản trước.
    try {
        if (dayData.task && dayData.task.trim() !== '') {
            let taskNote = [];
            if (hasMainShift) taskNote.push(`Ca: ${dayData.shift}`);
            if (hasOT) taskNote.push(`OT: ${dayData.ot}`);
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

            // FIX DOUBLE EVENT/TASK: nghỉ 1 nhịp ngắn giữa mỗi ngày để tránh
            // dồn quá nhiều request lên Google API cùng lúc — nguyên nhân
            // chính khiến bước xoá dữ liệu cũ dễ bị lỗi 429/403 rate-limit
            // giữa chừng ở các bản trước. Không áp dụng cho ngày cuối cùng.
            if (i < keys.length - 1) await sleep(150);
        }

        for (const meeting of meetingItems) {
            if (typeof syncMeetingCalendarEvent === 'function') {
                try {
                    await syncMeetingCalendarEvent(meeting);
                } catch (mErr) {
                    console.error(`[G-Portal] Lỗi đồng bộ Lịch họp ${meeting.id}:`, mErr);
                }
            }
        }

        if (taskFailedDates.length === 0 && eventFailedDates.length === 0) {
            alert("✅ Đã đồng bộ Lịch, Task PCCV và Lịch họp lên Google thành công! (Không có Event/Task nào bị trùng lặp.)");
        } else {
            let msg = `⚠️ Đồng bộ hoàn tất nhưng có một số ngày gặp lỗi:\n\n`;
            if (eventFailedDates.length > 0) {
                msg += `• Lịch (Ca/OT) lỗi ở ${eventFailedDates.length} ngày: ${eventFailedDates.slice(0, 10).join(', ')}${eventFailedDates.length > 10 ? '...' : ''}\n`;
                if (firstEventErrorDetail) msg += `  Chi tiết: ${firstEventErrorDetail}\n`;
            }
            if (taskFailedDates.length > 0) {
                msg += `• Task PCCV lỗi ở ${taskFailedDates.length} ngày: ${taskFailedDates.slice(0, 10).join(', ')}${taskFailedDates.length > 10 ? '...' : ''}\n`;
                if (firstTaskErrorDetail) msg += `  Chi tiết: ${firstTaskErrorDetail}\n`;
            }
            msg += `\nCÁC NGÀY BỊ LỖI KHÔNG TẠO TRÙNG LẶP (hệ thống đã huỷ bước tạo mới nếu không xoá được dữ liệu cũ) — chỉ đơn giản là CHƯA đồng bộ được. Vui lòng bấm "Đồng bộ Google" lại (có thể chờ 1-2 phút để Google hết giới hạn tốc độ), hoặc kiểm tra quyền Tasks API / kết nối mạng.`;
            alert(msg);
        }
    } catch (err) {
        console.error('Lỗi đồng bộ Google Ecosystem:', err);
        alert("Có lỗi xảy ra trong quá trình đồng bộ lên Google. Một phần dữ liệu có thể đã đồng bộ thành công, vui lòng kiểm tra lại Google Calendar/Tasks hoặc thử đồng bộ lại.");
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalBtnHtml;
        }
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

/**
 * MỚI: "Dọn dẹp trùng lặp" — quét Event (Lịch chính + Lịch OT + Lịch họp) và
 * Task PCCV của THÁNG ĐANG XEM, gom nhóm theo ngày/loại, giữ lại 1 bản mới
 * nhất và xoá các bản trùng lặp còn lại. Dùng để dọn sạch dữ liệu đã lỡ bị
 * double từ TRƯỚC KHI có bản vá chống double ở trên (bản vá chỉ ngăn lỗi mới
 * phát sinh, không tự xoá dữ liệu cũ đã lỡ bị trùng).
 */
async function cleanupDuplicatesHandler() {
    if (typeof AppState === 'undefined' || !AppState.isLoggedIn) return alert("Vui lòng đăng nhập Google trước!");
    if (typeof window.cleanupDuplicateGoogleData !== 'function') {
        return alert("Chức năng dọn dẹp trùng lặp chưa sẵn sàng, vui lòng tải lại trang.");
    }

    const confirmed = confirm('Hệ thống sẽ quét toàn bộ Event (Lịch chính/OT/Họp) và Task PCCV trong THÁNG ĐANG XEM. Với mỗi ngày có nhiều hơn 1 bản trùng, hệ thống sẽ GIỮ LẠI bản mới nhất và XOÁ các bản còn lại trên Google Calendar/Tasks.\n\nBạn có muốn tiếp tục?');
    if (!confirmed) return;

    const btn = document.getElementById('btn-cleanup-duplicates');
    const originalHtml = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i class='bx bx-loader-alt bx-spin'></i> Đang dọn dẹp...`;
    }

    try {
        const result = await window.cleanupDuplicateGoogleData(currentDate);
        if (result.removedEvents === 0 && result.removedTasks === 0) {
            alert("✅ Không phát hiện Event/Task nào bị trùng lặp trong tháng này.");
        } else {
            alert(`✅ Đã dọn dẹp xong: xoá ${result.removedEvents} Event trùng lặp và ${result.removedTasks} Task trùng lặp trên Google Calendar/Tasks (đã giữ lại đúng 1 bản mới nhất cho mỗi ngày).`);
        }
        if (typeof checkSyncWithGoogleHandler === 'function') await checkSyncWithGoogleHandler();
    } catch (err) {
        console.error('Lỗi dọn dẹp trùng lặp:', err);
        alert("Có lỗi xảy ra khi dọn dẹp trùng lặp. Vui lòng thử lại sau, hoặc kiểm tra Console (F12) để biết chi tiết.");
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        }
    }
}

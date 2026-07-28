/**
 * schedule.js - Module Lịch làm việc
 *
 * BẢN VÁ LỖI MỚI NHẤT (2 lỗi được báo cáo):
 * -------------------------------------------------------------------------
 * LỖI 1 — "Import Excel chỉ điền Ngày + Mã Ca báo thành công nhưng không
 * thấy dữ liệu": Nguyên nhân thật sự là do saveScheduleToDrive() luôn lưu
 * TOÀN BỘ window.monthlyScheduleData vào file của THÁNG ĐANG XEM
 * (currentDate), bất kể ngày tháng thật sự trong file Excel là tháng nào.
 * Nếu file Excel chứa lịch của một tháng KHÁC tháng đang xem trên Portal,
 * dữ liệu bị ghi nhầm vào file tháng đang xem thay vì tháng thật -> khi
 * chuyển sang đúng tháng đó sẽ không thấy gì.
 *
 * FIX: handleExcelUpload() giờ GOM dữ liệu theo từng tháng (khoá "YYYY-MM")
 * dựa trên cột "Ngày" của từng dòng. Dòng nào thuộc THÁNG ĐANG XEM thì cập
 * nhật thẳng vào bộ nhớ + lưu theo luồng cũ. Dòng nào thuộc THÁNG KHÁC thì
 * tự tải file lịch đúng tháng đó trên Drive, gộp (merge) với dữ liệu vừa
 * import rồi lưu lại đúng file — không cần người dùng phải chuyển tháng.
 *
 * Đồng thời làm rõ yêu cầu "chỉ cần Ngày + Mã Ca, các cột khác bỏ trống thì
 * mặc định Chính chủ": nếu thiếu cột "Phân loại" -> mặc định 'chinhchu'
 * (đã có sẵn nhưng viết lại tường minh hơn), nếu thiếu "Mã Ca" -> mặc định
 * 'OFF', các cột OT/PCCV/Nhân sự liên quan bỏ trống thì để rỗng, không bắt
 * buộc.
 *
 * LỖI 2 — "2 mũi tên chọn tháng không chuyển được": nút "Tháng sau" trong
 * index.html trước đây bị khai báo TRÙNG 2 thuộc tính id trên cùng 1 thẻ
 * (id="btn-dash-next-month" id="btn-next-month"). Theo chuẩn HTML, khi 1
 * thẻ có nhiều thuộc tính id trùng tên, trình duyệt chỉ nhận thuộc tính ĐẦU
 * TIÊN, thuộc tính sau bị bỏ qua hoàn toàn -> phần tử thực tế mang id
 * "btn-dash-next-month", không hề có id "btn-next-month" nào tồn tại trên
 * trang. Trong khi initScheduleEvents() bên dưới lại gắn sự kiện vào
 * "btn-next-month" -> bindIfPresent() không tìm thấy phần tử -> nút "Tháng
 * sau" không hề có sự kiện click nào được gắn, bấm vào không phản hồi gì.
 * FIX: đã xoá id trùng lặp trong index.html (xem file index.html đính kèm).
 * Sau khi id đúng lại, currentDate.setMonth(+1/-1) hoạt động không giới hạn
 * (không có ràng buộc chặn số tháng trong code), nên đã đáp ứng luôn yêu
 * cầu "chọn được tháng trước/sau, không giới hạn".
 * -------------------------------------------------------------------------
 *
 * ĐÍNH CHÍNH: Import Excel CHỈ lưu dữ liệu lên Portal/Drive để hiệu chỉnh —
 * KHÔNG tự động đẩy lên Google Calendar/Tasks (đúng luồng gốc: Import ->
 * Hiệu chỉnh -> bấm "Đồng bộ Google" khi đã sẵn sàng). Bản trước có thêm
 * nhầm bước tự động đồng bộ ngay sau Import, đã được gỡ bỏ.
 *
 * LỖI THẬT ĐANG XỬ LÝ: "Đồng bộ Google" đẩy đúng sự kiện Ca/OT lên Google
 * Calendar, nhưng PCCV KHÔNG lên được Google Tasks — và không có bất kỳ
 * thông báo lỗi nào hiển thị cho người dùng (âm thầm thất bại), vì hàm
 * syncGoogleTask() trong googleSync.js tự bắt lỗi bên trong rồi chỉ
 * console.error(), không báo ra ngoài; nếu thất bại (403 do chưa bật Google
 * Tasks API cho project, hoặc token cũ thiếu scope "tasks" từ trước khi
 * scope này được thêm vào, hoặc gapi.client.tasks chưa kịp tải xong) thì
 * coi như "chạy xong" một cách im lặng, người dùng chỉ thấy Lịch lên mà
 * không hề biết Task bị lỗi ở đâu.
 *
 * FIX: syncScheduleDayToGoogle() giờ tách riêng bước đồng bộ PCCV (Task) ra
 * khỏi bước đồng bộ Lịch — nếu Task lỗi thì KHÔNG làm hỏng phần Lịch đã
 * đồng bộ thành công, nhưng lỗi đó được GHI NHẬN LẠI (không còn bị nuốt âm
 * thầm) để syncToGoogleEcosystem() tổng hợp và BÁO RÕ CHO NGƯỜI DÙNG số
 * ngày Task bị lỗi + gợi ý nguyên nhân thường gặp, thay vì chỉ báo
 * "Đã đồng bộ thành công" chung chung như trước dù Task thực ra chưa lên.
 * (Xem thêm phần sửa tương ứng trong js/core/googleSync.js.)
 * -------------------------------------------------------------------------
 * (Giữ nguyên toàn bộ các bản vá trước đó: Settings/staffs fallback mặc
 * định, try/catch quanh openDayModal/saveDayEdit/deleteDayEdit,
 * bindIfPresent() chống 1 phần tử thiếu làm treo cả loạt sự kiện phía sau).
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

        if (typeof AppState !== 'undefined' && AppState.isLoggedIn) {
            if (task && task.trim() !== '') {
                let taskNote = [];
                if (shift && shift !== 'OFF') taskNote.push(`Ca: ${shift}`);
                if (ot) taskNote.push(`OT: ${ot}`);
                if (typeof syncGoogleTask === 'function') {
                    syncGoogleTask(savedKey, task, taskNote.join(' | ')).catch(err => {
                        console.error(`[G-Portal] Lỗi đồng bộ Google Task ngày ${savedKey}:`, err);
                        const apiErr = err && err.result && err.result.error;
                        const detail = apiErr ? `${apiErr.code} - ${apiErr.message}` : (err && err.message) || String(err);
                        alert(`⚠️ Đã lưu lịch/PCCV trên Portal, nhưng KHÔNG đồng bộ được lên Google Tasks cho ngày ${savedKey}.\nChi tiết: ${detail}\nCó thể do Google Tasks API chưa bật cho project, hoặc cần Đăng xuất/Đăng nhập lại để cấp quyền Tasks.`);
                    });
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
 * Google Tasks. Hàm dùng chung cho 2 nơi:
 *  1) syncToGoogleEcosystem() — nút "Đồng bộ Google" thủ công, quét toàn bộ
 *     tháng đang xem.
 *  2) handleExcelUpload() — TỰ ĐỘNG gọi ngay sau khi Import Excel thành
 *     công, để không cần thao tác thêm bước "Đồng bộ Google" thủ công nữa.
 * Vì mỗi lần gọi đều xoá sự kiện/task cũ của đúng ngày đó rồi tạo lại (xem
 * syncCalendarEvent/syncOtCalendarEvent/syncGoogleTask trong googleSync.js),
 * nên gọi lại nhiều lần cho cùng 1 ngày là an toàn — ngày nào chưa có thì
 * thêm mới, ngày nào đã có thì tự cập nhật theo đúng dữ liệu mới nhất.
 */
async function syncScheduleDayToGoogle(key, dayData, settings) {
    const hasMainShift = dayData.shift && dayData.shift !== 'OFF';
    const hasOT = dayData.ot && dayData.ot.trim() !== '';
    const result = { taskError: null };

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

    // PCCV (Google Task) — TÁCH RIÊNG khỏi phần Lịch phía trên. Trước đây
    // syncGoogleTask()/deleteGoogleTask() tự bắt lỗi bên trong rồi chỉ
    // console.error(), khiến lỗi (VD: 403 do Google Tasks API chưa được bật
    // cho project, hoặc token cũ thiếu quyền "tasks") bị "nuốt" âm thầm —
    // người dùng thấy Lịch lên Calendar bình thường nên tưởng đã xong, không
    // hề biết Task bị lỗi. Nay các hàm này sẽ NÉM LẠI lỗi, và ở đây bắt lại
    // để KHÔNG làm hỏng phần Lịch đã đồng bộ thành công, đồng thời trả lỗi
    // đó ra ngoài qua result.taskError để syncToGoogleEcosystem() tổng hợp
    // và báo rõ ràng cho người dùng biết chính xác ngày nào, lỗi gì.
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

    alert("Đang tiến hành đồng bộ nền... Quá trình này có thể mất vài giây, vui lòng không tắt trình duyệt.");

    const taskFailedDates = [];
    let firstTaskErrorDetail = '';

    try {
        const settings = getSafePortalSettings();

        for (const key of keys) {
            const result = await syncScheduleDayToGoogle(key, window.monthlyScheduleData[key], settings);
            if (result && result.taskError) {
                taskFailedDates.push(key);
                if (!firstTaskErrorDetail) {
                    const apiErr = result.taskError && result.taskError.result && result.taskError.result.error;
                    firstTaskErrorDetail = apiErr ? `${apiErr.code} - ${apiErr.message}` : (result.taskError.message || String(result.taskError));
                }
            }
        }

        for (const meeting of meetingItems) {
            if (typeof syncMeetingCalendarEvent === 'function') await syncMeetingCalendarEvent(meeting);
        }

        if (taskFailedDates.length === 0) {
            alert("✅ Đã đồng bộ Lịch, Task PCCV và Lịch họp lên Google thành công!");
        } else {
            // Lịch/Calendar vẫn đã lên bình thường (không phụ thuộc Task), chỉ
            // riêng Task PCCV bị lỗi -> báo rõ để không còn "im lặng" như trước.
            let msg = `⚠️ Đã đồng bộ xong Lịch (Ca/OT) và Lịch họp lên Google Calendar.\n`;
            msg += `Nhưng Task PCCV của ${taskFailedDates.length} ngày KHÔNG đồng bộ được lên Google Tasks: ${taskFailedDates.slice(0, 10).join(', ')}${taskFailedDates.length > 10 ? '...' : ''}.\n`;
            if (firstTaskErrorDetail) msg += `Chi tiết lỗi: ${firstTaskErrorDetail}\n`;
            msg += `Nguyên nhân thường gặp:\n`;
            msg += `- Google Tasks API chưa được BẬT (Enable) trong Google Cloud Console cho project đang dùng API_KEY/CLIENT_ID này.\n`;
            msg += `- Tài khoản đăng nhập từ trước khi quyền "Tasks" được thêm vào hệ thống -> hãy Đăng xuất rồi Đăng nhập lại để cấp lại đầy đủ quyền.\n`;
            msg += `Xem Console (F12) để biết lỗi đầy đủ của từng ngày.`;
            alert(msg);
        }
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
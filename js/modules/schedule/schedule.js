/**
 * schedule.js - Module Lịch làm việc
 *
 * ============================================================================
 * BẢN CẬP NHẬT GIAO DIỆN LỊCH (làm lại toàn bộ file)
 * ============================================================================
 * 1) HAI CHẾ ĐỘ XEM: "Tháng" (lưới lịch) và "Tuần" (bảng ca: hàng = Ca sáng /
 *    Ca chiều / Ca đêm / Tăng cường / Lịch họp, cột = 7 ngày trong tuần).
 *    Chế độ xem được ghi nhớ trong localStorage (gportal_schedule_view).
 * 2) PHÂN BIỆT CA SÁNG / CHIỀU / ĐÊM tự động theo GIỜ BẮT ĐẦU của ca trong
 *    phần Cài Đặt (04:00-11:59 = Sáng, 12:00-17:59 = Chiều, còn lại = Đêm).
 *    Ca không có giờ hợp lệ được xếp vào nhóm "Khác".
 * 3) THẺ CA HIỂN THỊ THEO DỮ LIỆU THỰC TẾ — mục nào không có thì ẩn:
 *      - Chính chủ: không có dòng nhân sự.
 *      - Trực hộ:   "Hộ: <tên>".
 *      - Đổi ca:    "Đổi với: <tên>".
 *      - PCCV luôn hiển thị (chưa có dữ liệu thì hiện "–").
 *      - Ngày OFF hoàn toàn: chỉ hiện số ngày + nhãn OFF.
 * 4) TĂNG CƯỜNG (OT) có 2 kiểu hiển thị khác nhau:
 *      - Ngày nghỉ mà làm tăng cường (kể cả cả ca chính như S2): thẻ nổi
 *        bật "Tăng cường cả ca".
 *      - Ngày có ca chính, làm thêm OT: thẻ nhỏ nét đứt "+OT S+".
 *    Ô chọn OT trong popup hiệu chỉnh giờ liệt kê cả "Ca tăng cường" lẫn
 *    "Ca chính", và phần "Phân loại ca" có thêm lựa chọn
 *    "Tăng cường (OT) – ngày nghỉ".
 * 5) ĐỒNG BỘ GOOGLE: ngày nghỉ làm OT chỉ tạo sự kiện ở LỊCH OT riêng (không
 *    tạo thêm sự kiện ở Lịch chính). Giờ của OT được tra theo cả danh sách
 *    ca tăng cường lẫn ca chính. Nguyên tắc chống double (xoá thất bại thì
 *    không tạo mới) giữ nguyên.
 * 7) CHỐNG TASK/EVENT BỊ NHÂN ĐÔI DO CHẠY ĐỒNG THỜI: mọi thao tác ghi lên
 *    Google (lưu 1 ngày, xoá ngày, Đồng bộ Google cả tháng, lịch họp, Kiểm
 *    tra đồng bộ, Dọn dẹp trùng lặp) giờ được XẾP HÀNG (enqueueGoogleSync) và
 *    chạy lần lượt từng việc một. Trước đây lưu 1 ngày chạy ngầm trong khi
 *    bấm "Đồng bộ Google" hoặc lưu ngày khác -> 2 luồng cùng thấy "chưa có
 *    Task" và cùng tạo mới -> trùng lặp.
 * 6) Tuần bắt đầu từ Thứ 2. Điều hướng tháng dùng ngày mùng 1 để tránh lỗi
 *    nhảy tháng khi đang ở ngày 29-31.
 *
 * (Giữ nguyên toàn bộ các bản vá trước: gom nhóm Import Excel theo tháng
 * thực tế của từng dòng, Import Excel không tự đẩy lên Google, fallback
 * Settings mặc định, try/catch quanh các popup, bindIfPresent(), chống
 * double Event/Task, nút Kiểm tra đồng bộ & Dọn dẹp trùng lặp.)
 * ============================================================================
 */

window.monthlyScheduleData = window.monthlyScheduleData || {};
window.monthlyMeetingsData = window.monthlyMeetingsData || {};

const SCHEDULE_VIEW_KEY = 'gportal_schedule_view';
const WEEKDAY_SHORT = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

let currentDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let weekAnchor = new Date();
let viewMode = 'month';
let editingDateKey = null;
let editingMeetingId = null;

const PERIODS = {
    sang: { label: 'Sáng', full: 'Ca sáng', icon: 'bx-sun' },
    chieu: { label: 'Chiều', full: 'Ca chiều', icon: 'bx-cloud' },
    dem: { label: 'Đêm', full: 'Ca đêm', icon: 'bx-moon' },
    khac: { label: 'Khác', full: 'Ca khác', icon: 'bx-time-five' }
};

document.addEventListener('DOMContentLoaded', () => {
    try { initViewMode(); } catch (e) { console.error('initViewMode error:', e); }
    try { initCalendar(); } catch (e) { console.error('initCalendar error:', e); }
    try { initScheduleEvents(); } catch (e) { console.error('initScheduleEvents error:', e); }
});

function initViewMode() {
    let saved = null;
    try { saved = localStorage.getItem(SCHEDULE_VIEW_KEY); } catch (e) {}
    if (saved === 'month' || saved === 'week') viewMode = saved;
    else viewMode = (window.innerWidth < 700) ? 'week' : 'month';
    weekAnchor = defaultAnchorForMonth(currentDate);
}

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

// Hàng đợi tuần tự cho MỌI thao tác ghi lên Google (Calendar/Tasks). Mỗi việc
// chỉ bắt đầu khi việc trước đã xong (kể cả khi việc trước lỗi), nhờ vậy
// không bao giờ có 2 luồng cùng "tìm thấy chưa có Task" rồi cùng tạo mới.
// LƯU Ý: không gọi enqueueGoogleSync() lồng bên trong 1 hàm đang chạy trong
// hàng đợi (sẽ tự chờ chính mình -> treo).
let googleSyncChain = Promise.resolve();
let googleBulkSyncing = false;
function enqueueGoogleSync(task) {
    const run = googleSyncChain.then(() => task());
    googleSyncChain = run.catch(() => {});
    return run;
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
    bindIfPresent('btn-prev-month', 'click', () => navigateSchedule(-1));
    bindIfPresent('btn-next-month', 'click', () => navigateSchedule(1));
    bindIfPresent('btn-go-today', 'click', goToToday);
    bindIfPresent('btn-view-month', 'click', () => setViewMode('month'));
    bindIfPresent('btn-view-week', 'click', () => setViewMode('week'));

    bindIfPresent('btn-download-schedule-tpl', 'click', () => {
        const ws_data = [["Ngày", "Mã Ca", "OT", "Mã PCCV", "Phân loại", "Nhân sự liên quan"]];
        ws_data.push(["01/07/2026", "S1", "S+", "CHAT", "Chính chủ", ""]);
        ws_data.push(["02/07/2026", "S2", "", "", "Đổi ca", "NV01"]);
        ws_data.push(["03/07/2026", "S1", "", "", "", ""]); // Ví dụ: chỉ cần Ngày + Mã Ca -> tự mặc định Chính chủ
        ws_data.push(["04/07/2026", "OFF", "S2", "", "", ""]); // Ví dụ: ngày nghỉ nhưng làm tăng cường nguyên ca S2

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

    bindIfPresent('modal-shift-type', 'change', handleDayTypeChange);
    bindIfPresent('modal-shift', 'change', updateDayModalPreview);
    bindIfPresent('modal-ot', 'change', updateDayModalPreview);
    bindIfPresent('modal-task', 'change', updateDayModalPreview);
    bindIfPresent('modal-trade', 'change', updateDayModalPreview);
    bindIfPresent('modal-help', 'change', updateDayModalPreview);

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

// ==================== ĐIỀU HƯỚNG THÁNG / TUẦN ====================

function pad2(n) { return String(n).padStart(2, '0'); }

function toDateKey(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function defaultAnchorForMonth(monthDate) {
    const t = new Date();
    if (t.getFullYear() === monthDate.getFullYear() && t.getMonth() === monthDate.getMonth()) return t;
    return new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
}

// Thứ 2 của tuần chứa ngày d
function getWeekStart(d) {
    const s = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    s.setDate(s.getDate() - ((s.getDay() + 6) % 7));
    return s;
}

function navigateSchedule(delta) {
    if (viewMode === 'week') {
        shiftWeek(delta);
        return;
    }
    currentDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + delta, 1);
    weekAnchor = defaultAnchorForMonth(currentDate);
    changeMonthHandler();
}

function shiftWeek(delta) {
    let a = new Date(weekAnchor.getFullYear(), weekAnchor.getMonth(), weekAnchor.getDate() + 7 * delta);
    const crossed = a.getMonth() !== currentDate.getMonth() || a.getFullYear() !== currentDate.getFullYear();
    if (crossed) {
        // Sang tháng mới: nhảy về ngày đầu (đi tới) hoặc ngày cuối (đi lùi) của tháng đó
        a = delta > 0
            ? new Date(a.getFullYear(), a.getMonth(), 1)
            : new Date(a.getFullYear(), a.getMonth() + 1, 0);
        currentDate = new Date(a.getFullYear(), a.getMonth(), 1);
        weekAnchor = a;
        changeMonthHandler();
    } else {
        weekAnchor = a;
        renderCalendar();
    }
}

function goToToday() {
    const t = new Date();
    const sameMonth = t.getFullYear() === currentDate.getFullYear() && t.getMonth() === currentDate.getMonth();
    weekAnchor = t;
    if (sameMonth) {
        renderCalendar();
    } else {
        currentDate = new Date(t.getFullYear(), t.getMonth(), 1);
        changeMonthHandler();
    }
}

function setViewMode(mode) {
    if (mode !== 'month' && mode !== 'week') return;
    viewMode = mode;
    try { localStorage.setItem(SCHEDULE_VIEW_KEY, mode); } catch (e) {}
    if (mode === 'week') weekAnchor = defaultAnchorForMonth(currentDate);
    renderCalendar();
}

function syncViewSwitchUI() {
    const monthBtn = document.getElementById('btn-view-month');
    const weekBtn = document.getElementById('btn-view-week');
    if (monthBtn) monthBtn.classList.toggle('active', viewMode === 'month');
    if (weekBtn) weekBtn.classList.toggle('active', viewMode === 'week');
    const monthView = document.getElementById('sch-month-view');
    const weekView = document.getElementById('sch-week-view');
    if (monthView) monthView.style.display = viewMode === 'month' ? 'block' : 'none';
    if (weekView) weekView.style.display = viewMode === 'week' ? 'block' : 'none';
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

// ==================== TIỆN ÍCH CA / KHUNG GIỜ ====================

function escapeHtml(value) {
    return String(value || '').replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
}

// Ca sáng / chiều / đêm được phân theo GIỜ BẮT ĐẦU của ca
function getPeriodFromTime(time) {
    const m = String(time || '').match(/(\d{1,2})\s*[:h]\s*(\d{2})/);
    if (!m) return 'khac';
    const h = parseInt(m[1], 10);
    if (h >= 4 && h < 12) return 'sang';
    if (h >= 12 && h < 18) return 'chieu';
    return 'dem';
}

function formatTimeRange(time) {
    return String(time || '').replace(/\s*-\s*/, ' – ');
}

function getShiftConfig(code, isOt) {
    if (!code || code === 'OFF') return null;
    const settings = getSafePortalSettings();
    const list = isOt ? settings.otShifts : settings.shifts;
    return (list || []).find(s => s.code === code) || null;
}

// Ô OT giờ có thể chọn cả "Ca tăng cường" lẫn "Ca chính" -> tra theo cả hai
// danh sách (ưu tiên Ca tăng cường nếu trùng mã).
function getAnyShiftConfig(code) {
    if (!code || code === 'OFF') return null;
    return getShiftConfig(code, true) || getShiftConfig(code, false);
}

// Gom toàn bộ thông tin hiển thị của 1 ngày từ dữ liệu lịch
function buildDayInfo(dateKey) {
    const raw = window.monthlyScheduleData[dateKey];
    const d = raw || {};
    const shiftCode = d.shift && d.shift !== 'OFF' ? d.shift : '';
    const otCode = (d.ot || '').trim();
    const mainCfg = shiftCode ? getShiftConfig(shiftCode, false) : null;
    const otCfg = otCode ? getAnyShiftConfig(otCode) : null;
    return {
        hasData: !!raw,
        type: d.type || 'chinhchu',
        shiftCode,
        otCode,
        task: (d.task || '').trim(),
        trade: (d.trade || '').trim(),
        help: (d.help || '').trim(),
        mainCfg,
        otCfg,
        mainPeriod: shiftCode ? getPeriodFromTime(mainCfg && mainCfg.time) : null,
        otPeriod: otCode ? getPeriodFromTime(otCfg && otCfg.time) : null,
        hasMain: !!shiftCode,
        hasOt: !!otCode,
        isOtOnly: !shiftCode && !!otCode,
        isOff: !shiftCode && !otCode
    };
}

// ==================== HTML CÁC THÀNH PHẦN THẺ ====================

function periodChipHtml(period) {
    const p = PERIODS[period] || PERIODS.khac;
    return `<span class="sch-period p-${period}"><i class='bx ${p.icon}'></i>${p.label}</span>`;
}

function typeChipHtml(info) {
    if (info.type === 'doica') return `<span class="sch-chip swap"><i class='bx bx-transfer'></i>Đổi ca</span>`;
    if (info.type === 'trucho') return `<span class="sch-chip cover"><i class='bx bx-support'></i>Trực hộ</span>`;
    return `<span class="sch-chip own">Chính chủ</span>`;
}

function staffLineHtml(info) {
    if (info.type === 'doica') {
        return `<div class="sch-staff swap"><i class='bx bx-transfer'></i><span>Đổi với: <b>${info.trade ? escapeHtml(info.trade) : 'chưa chọn'}</b></span></div>`;
    }
    if (info.type === 'trucho') {
        return `<div class="sch-staff cover"><i class='bx bx-support'></i><span>Hộ: <b>${info.help ? escapeHtml(info.help) : 'chưa chọn'}</b></span></div>`;
    }
    return '';
}

function taskLineHtml(info) {
    return `<div class="sch-task${info.task ? '' : ' empty'}" title="${info.task ? 'Phân công công việc' : 'Chưa phân công — bấm vào ngày để cập nhật'}"><i class='bx bx-pin'></i><span class="sch-task-k">PCCV</span><span class="sch-task-v">${info.task ? escapeHtml(info.task) : '–'}</span></div>`;
}

function timeLineHtml(cfg) {
    if (cfg && cfg.time) return `<div class="sch-time"><i class='bx bx-time-five'></i>${escapeHtml(formatTimeRange(cfg.time))}</div>`;
    return `<div class="sch-time muted"><i class='bx bx-time-five'></i>Chưa cấu hình giờ</div>`;
}

// Thẻ ca chính. showPeriod=false ở chế độ Tuần (vì cột hàng đã cho biết sáng/chiều/đêm)
function mainCardHtml(info, showPeriod) {
    const color = (info.mainCfg && info.mainCfg.color) || '#64748b';
    const name = info.mainCfg && info.mainCfg.name ? info.mainCfg.name : '';
    return `<div class="sch-card main p-${info.mainPeriod}" style="--shift-color:${escapeHtml(color)}">
        <div class="sch-card-top">${showPeriod ? periodChipHtml(info.mainPeriod) : ''}${typeChipHtml(info)}</div>
        <div class="sch-shift-line"><span class="sch-code">${escapeHtml(info.shiftCode)}</span>${name ? `<span class="sch-name">${escapeHtml(name)}</span>` : ''}</div>
        ${timeLineHtml(info.mainCfg)}
        ${staffLineHtml(info)}
        ${taskLineHtml(info)}
    </div>`;
}

// Ngày nghỉ nhưng làm tăng cường (VD OT S2 / S+ / T+...) -> thẻ nổi bật riêng
function otOnlyCardHtml(info) {
    const name = info.otCfg && info.otCfg.name ? info.otCfg.name : '';
    return `<div class="sch-card ot-only p-${info.otPeriod}">
        <div class="sch-card-top"><span class="sch-ot-badge"><i class='bx bx-bolt-circle'></i>Tăng cường cả ca</span>${periodChipHtml(info.otPeriod)}</div>
        <div class="sch-shift-line"><span class="sch-code">${escapeHtml(info.otCode)}</span>${name ? `<span class="sch-name">${escapeHtml(name)}</span>` : ''}</div>
        ${timeLineHtml(info.otCfg)}
        ${taskLineHtml(info)}
    </div>`;
}

// Ngày có ca chính + làm thêm OT -> thẻ nhỏ nét đứt, khác hẳn thẻ ca chính
function otAddHtml(info) {
    const time = info.otCfg && info.otCfg.time ? `<span class="sch-ot-add-time">${escapeHtml(formatTimeRange(info.otCfg.time))}</span>` : '';
    return `<div class="sch-ot-add" title="Làm thêm giờ ngoài ca chính"><i class='bx bx-plus-circle'></i><span>OT <b>${escapeHtml(info.otCode)}</b></span>${time}</div>`;
}

function statusBadgeHtml(info) {
    if (info.isOtOnly) return `<span class="sch-status ot">Tăng cường</span>`;
    if (info.isOff) return `<span class="sch-status off">OFF</span>`;
    return `<span class="sch-status work">Đi làm</span>`;
}

function meetingChipHtml(m) {
    return `<button class="sch-meeting" type="button" onclick="event.stopPropagation(); openMeetingModal('${m.id}')"><i class='bx bx-video'></i>${escapeHtml(m.start || '--:--')} ${escapeHtml(m.title)}</button>`;
}

// Bản rút gọn dành cho điện thoại ở chế độ Tháng (ô lịch quá hẹp để hiện thẻ đầy đủ)
function miniHtml(info, meetings) {
    let h = '';
    if (info.hasMain) h += `<span class="sch-mini-chip p-${info.mainPeriod}">${escapeHtml(info.shiftCode)}</span>`;
    if (info.hasOt) h += `<span class="sch-mini-chip ot">+${escapeHtml(info.otCode)}</span>`;
    if (info.task) h += `<i class='bx bx-pin sch-mini-ico'></i>`;
    if (meetings.length) h += `<i class='bx bx-video sch-mini-ico'></i>`;
    return h ? `<div class="sch-mini">${h}</div>` : '';
}

// ==================== VẼ LỊCH ====================

window.renderCalendar = function () {
    try {
        syncViewSwitchUI();
        const monthDisplay = document.getElementById('current-month-display');

        if (viewMode === 'week') {
            const start = getWeekStart(weekAnchor);
            const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
            if (monthDisplay) monthDisplay.innerText = `Tuần ${pad2(start.getDate())}/${pad2(start.getMonth() + 1)} – ${pad2(end.getDate())}/${pad2(end.getMonth() + 1)}/${end.getFullYear()}`;
            renderWeekBoard();
        } else {
            if (monthDisplay) monthDisplay.innerText = `Tháng ${pad2(currentDate.getMonth() + 1)}/${currentDate.getFullYear()}`;
            renderMonthGrid();
        }
        renderScheduleAgenda();
    } catch (e) {
        console.error('Lỗi render Lịch làm việc:', e);
    }
};

function renderMonthGrid() {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const calendarGrid = document.getElementById('calendar-grid');
    if (!calendarGrid) return;

    const leading = (new Date(year, month, 1).getDay() + 6) % 7; // tuần bắt đầu từ Thứ 2
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = new Date();
    const cells = [];

    for (let i = 0; i < leading; i++) cells.push(`<div class="sch-cell empty"></div>`);

    for (let day = 1; day <= daysInMonth; day++) {
        const dateKey = `${year}-${pad2(month + 1)}-${pad2(day)}`;
        const isToday = (day === today.getDate() && month === today.getMonth() && year === today.getFullYear());
        const info = buildDayInfo(dateKey);
        const meetings = getMeetingsByDate(dateKey);

        let body = '';
        if (info.hasMain) body += mainCardHtml(info, true);
        if (info.isOtOnly) body += otOnlyCardHtml(info);
        if (info.hasMain && info.hasOt) body += otAddHtml(info);
        // Ngày OFF hoàn toàn chỉ hiện số ngày + OFF; còn lại PCCV luôn hiển thị
        // (thẻ ca/OT đã có sẵn dòng PCCV; riêng ngày OFF mà đã có PCCV thì vẫn hiện)
        if (info.isOff && info.task) body += taskLineHtml(info);
        meetings.slice(0, 2).forEach(m => { body += meetingChipHtml(m); });
        if (meetings.length > 2) body += `<div class="sch-more">+${meetings.length - 2} lịch họp</div>`;

        const classes = ['sch-cell'];
        if (isToday) classes.push('today');
        if (info.isOff) classes.push('is-off');
        if (info.isOtOnly) classes.push('is-ot');
        if (meetings.length) classes.push('has-meeting');

        cells.push(`<div class="${classes.join(' ')}" onclick="openDayModal('${dateKey}')">
            <div class="sch-cell-head"><span class="sch-daynum">${day}</span>${statusBadgeHtml(info)}</div>
            <div class="sch-cell-body">${body}</div>
            ${miniHtml(info, meetings)}
        </div>`);
    }

    calendarGrid.innerHTML = cells.join('');
}

function renderWeekBoard() {
    const board = document.getElementById('week-board');
    if (!board) return;

    const settings = getSafePortalSettings();
    const start = getWeekStart(weekAnchor);
    const today = new Date();
    const todayKey = toDateKey(today);

    const days = [];
    for (let i = 0; i < 7; i++) {
        const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
        const inMonth = d.getMonth() === currentDate.getMonth() && d.getFullYear() === currentDate.getFullYear();
        const key = toDateKey(d);
        days.push({ date: d, key, inMonth, info: inMonth ? buildDayInfo(key) : null, meetings: inMonth ? getMeetingsByDate(key) : [] });
    }

    const periodRows = ['sang', 'chieu', 'dem'];
    if (days.some(x => x.info && x.info.hasMain && x.info.mainPeriod === 'khac')) periodRows.push('khac');

    let html = `<div class="sch-week-scroll"><div class="sch-week">`;

    // Hàng tiêu đề: góc + 7 ngày (T2 -> CN)
    html += `<div class="sch-wcorner">Ca / Ngày</div>`;
    days.forEach(x => {
        const dow = WEEKDAY_SHORT[x.date.getDay()];
        const cls = ['sch-whead'];
        if (x.key === todayKey) cls.push('today');
        if (!x.inMonth) cls.push('outside');
        let badge = '';
        if (x.info) badge = statusBadgeHtml(x.info);
        html += `<div class="${cls.join(' ')}"><span class="sch-wdow">${dow}</span><b class="sch-wnum">${pad2(x.date.getDate())}</b><small>/${pad2(x.date.getMonth() + 1)}</small>${badge}</div>`;
    });

    const cellOpen = (x) => x.inMonth ? ` onclick="openDayModal('${x.key}')"` : '';
    const cellCls = (x, extra) => `sch-wcell${extra ? ' ' + extra : ''}${x.inMonth ? '' : ' outside'}${x.key === todayKey ? ' today' : ''}`;

    // Các hàng Ca sáng / chiều / đêm (/ khác)
    periodRows.forEach(p => {
        const codes = (settings.shifts || []).filter(s => getPeriodFromTime(s.time) === p).map(s => s.code);
        const meta = PERIODS[p];
        html += `<div class="sch-rowlabel p-${p}"><i class='bx ${meta.icon}'></i><div><b>${meta.full}</b><small>${codes.length ? escapeHtml(codes.join(' · ')) : 'Chưa có ca'}</small></div></div>`;
        days.forEach(x => {
            const has = x.info && x.info.hasMain && x.info.mainPeriod === p;
            html += `<div class="${cellCls(x)}"${cellOpen(x)}>${has ? mainCardHtml(x.info, false) : '<span class="sch-empty-mark"></span>'}</div>`;
        });
    });

    // Hàng Tăng cường
    html += `<div class="sch-rowlabel ot"><i class='bx bx-bolt-circle'></i><div><b>Tăng cường</b><small>Ngoài giờ / ngày nghỉ</small></div></div>`;
    days.forEach(x => {
        let inner = '<span class="sch-empty-mark"></span>';
        if (x.info && x.info.isOtOnly) inner = otOnlyCardHtml(x.info);
        else if (x.info && x.info.hasMain && x.info.hasOt) inner = otAddHtml(x.info);
        html += `<div class="${cellCls(x)}"${cellOpen(x)}>${inner}</div>`;
    });

    // Hàng Lịch họp
    html += `<div class="sch-rowlabel meet"><i class='bx bx-video'></i><div><b>Lịch họp</b><small>Họp trong ngày</small></div></div>`;
    days.forEach(x => {
        const inner = x.meetings.length ? x.meetings.map(meetingChipHtml).join('') : '<span class="sch-empty-mark"></span>';
        html += `<div class="${cellCls(x, 'meet')}"${cellOpen(x)}>${inner}</div>`;
    });

    html += `</div></div>`;
    board.innerHTML = html;
}

// ==================== POPUP HIỆU CHỈNH NGÀY ====================

function ensureOption(selectEl, value, label) {
    if (!selectEl || !value) return;
    const exists = Array.from(selectEl.options).some(o => o.value === value);
    if (!exists) {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = label || `${value} (không còn trong Cài Đặt)`;
        selectEl.appendChild(opt);
    }
}

function handleDayTypeChange() {
    const typeEl = document.getElementById('modal-shift-type');
    const type = typeEl ? typeEl.value : 'chinhchu';
    const tradeGroup = document.getElementById('modal-trade-group');
    const helpGroup = document.getElementById('modal-help-group');
    const shiftEl = document.getElementById('modal-shift');

    if (tradeGroup) tradeGroup.style.display = type === 'doica' ? 'flex' : 'none';
    if (helpGroup) helpGroup.style.display = type === 'trucho' ? 'flex' : 'none';

    if (shiftEl) {
        if (type === 'ot') {
            shiftEl.value = 'OFF';
            shiftEl.disabled = true;
        } else {
            shiftEl.disabled = false;
        }
    }
    updateDayModalPreview();
}

// Xem nhanh kết quả sau khi chọn (giờ làm việc tự lấy theo thiết lập ca)
function updateDayModalPreview() {
    const box = document.getElementById('modal-preview');
    if (!box) return;
    const getVal = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };

    const type = getVal('modal-shift-type') || 'chinhchu';
    const shift = getVal('modal-shift') || 'OFF';
    const ot = getVal('modal-ot');
    const task = getVal('modal-task');
    const lines = [];

    if (shift !== 'OFF' && type !== 'ot') {
        const cfg = getShiftConfig(shift, false);
        const period = PERIODS[getPeriodFromTime(cfg && cfg.time)];
        lines.push(`<div><b>Ca chính:</b> ${escapeHtml(shift)}${cfg && cfg.name ? ' · ' + escapeHtml(cfg.name) : ''} — ${cfg && cfg.time ? escapeHtml(formatTimeRange(cfg.time)) : 'chưa cấu hình giờ'} (${period.full.toLowerCase()})</div>`);
    } else {
        lines.push(`<div><b>Ca chính:</b> OFF (nghỉ)</div>`);
    }

    if (ot) {
        const cfg = getAnyShiftConfig(ot);
        const kind = (shift !== 'OFF' && type !== 'ot') ? 'làm thêm ngoài ca chính' : 'tăng cường cả ca trong ngày nghỉ';
        lines.push(`<div><b>Tăng cường:</b> ${escapeHtml(ot)} — ${cfg && cfg.time ? escapeHtml(formatTimeRange(cfg.time)) : 'chưa cấu hình giờ'} (${kind})</div>`);
    } else if (type === 'ot') {
        lines.push(`<div style="color: var(--warning);"><b>Tăng cường:</b> hãy chọn ca ở ô "Tăng cường (OT)".</div>`);
    }

    if (type === 'doica') lines.push(`<div><b>Đổi ca với:</b> ${escapeHtml(getVal('modal-trade') || 'chưa chọn')}</div>`);
    if (type === 'trucho') lines.push(`<div><b>Trực hộ cho:</b> ${escapeHtml(getVal('modal-help') || 'chưa chọn')}</div>`);
    lines.push(`<div><b>PCCV:</b> ${task ? escapeHtml(task) : '–'}</div>`);

    box.innerHTML = lines.join('');
}

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
            (settings.shifts || []).map(s => `<option value="${escapeHtml(s.code)}">${escapeHtml(s.code)}${s.name ? ' - ' + escapeHtml(s.name) : ''} (${escapeHtml(s.time)})</option>`).join('');
        const modalShift = document.getElementById('modal-shift');
        if (modalShift) modalShift.innerHTML = shiftsHtml;

        // Ô OT: liệt kê cả Ca tăng cường lẫn Ca chính (để làm nguyên ca vào ngày nghỉ)
        const otList = settings.otShifts || [];
        const shiftList = settings.shifts || [];
        let otHtml = `<option value="">-- Không có --</option>`;
        if (otList.length) {
            otHtml += `<optgroup label="Ca tăng cường">` +
                otList.map(s => `<option value="${escapeHtml(s.code)}">${escapeHtml(s.code)}${s.name ? ' - ' + escapeHtml(s.name) : ''} (${escapeHtml(s.time)})</option>`).join('') +
                `</optgroup>`;
        }
        if (shiftList.length) {
            otHtml += `<optgroup label="Ca chính (làm nguyên ca khi nghỉ)">` +
                shiftList.map(s => `<option value="${escapeHtml(s.code)}">${escapeHtml(s.code)}${s.name ? ' - ' + escapeHtml(s.name) : ''} (${escapeHtml(s.time)})</option>`).join('') +
                `</optgroup>`;
        }
        const modalOt = document.getElementById('modal-ot');
        if (modalOt) modalOt.innerHTML = otHtml;

        const taskSelect = document.getElementById('modal-task');
        if (taskSelect) {
            taskSelect.innerHTML = `<option value="">-- Không có --</option>` +
                (settings.tasks || []).map(t => `<option value="${escapeHtml(t.name)}">${escapeHtml(t.name)}</option>`).join('');
        }

        const staffList = settings.staffs || [];
        const staffOptions = staffList.length
            ? (`<option value="">-- Không có --</option>` + staffList.map(s => `<option value="${escapeHtml(s.name)}">${escapeHtml(s.name)} (${escapeHtml(s.id)})</option>`).join(''))
            : `<option value="">-- Chưa có Nhân sự nào, vào Cài Đặt > Nhân sự để thêm --</option>`;
        const modalTrade = document.getElementById('modal-trade');
        const modalHelp = document.getElementById('modal-help');
        if (modalTrade) modalTrade.innerHTML = staffOptions;
        if (modalHelp) modalHelp.innerHTML = staffOptions;

        // Mã đã lưu nhưng nay không còn trong Cài Đặt -> vẫn giữ lại để không mất dữ liệu khi lưu
        ensureOption(modalShift, dayData.shift && dayData.shift !== 'OFF' ? dayData.shift : '');
        ensureOption(modalOt, dayData.ot);
        ensureOption(taskSelect, dayData.task, dayData.task);
        ensureOption(modalTrade, dayData.trade, dayData.trade);
        ensureOption(modalHelp, dayData.help, dayData.help);

        // Ngày nghỉ nhưng có OT -> mở popup ở chế độ "Tăng cường (OT) – ngày nghỉ"
        const hasMain = dayData.shift && dayData.shift !== 'OFF';
        const hasOt = dayData.ot && dayData.ot.trim() !== '';
        let displayType = dayData.type || 'chinhchu';
        if (!hasMain && hasOt) displayType = 'ot';

        const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
        setVal('modal-shift-type', displayType);
        setVal('modal-shift', dayData.shift || 'OFF');
        setVal('modal-ot', dayData.ot || '');
        setVal('modal-task', dayData.task || '');
        setVal('modal-trade', dayData.trade || '');
        setVal('modal-help', dayData.help || '');

        handleDayTypeChange();

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

        let type = getVal('modal-shift-type') || 'chinhchu';
        let shift = getVal('modal-shift') || 'OFF';
        const ot = getVal('modal-ot');
        const task = getVal('modal-task');

        // "Tăng cường (OT) – ngày nghỉ": ca chính = OFF, bắt buộc phải chọn ca OT.
        // Lưu dưới dạng chinhchu + OFF + ot (hiển thị tự nhận ra là ngày tăng cường).
        if (type === 'ot') {
            if (!ot) {
                alert('Vui lòng chọn ca ở ô "Tăng cường (OT)" cho ngày này.');
                return;
            }
            shift = 'OFF';
            type = 'chinhchu';
        }

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
        // không tạo mới) một cách nhất quán.
        if (typeof AppState !== 'undefined' && AppState.isLoggedIn) {
            const settings = getSafePortalSettings();
            const daySnapshot = Object.assign({}, window.monthlyScheduleData[savedKey]);
            enqueueGoogleSync(() => syncScheduleDayToGoogle(savedKey, daySnapshot, settings)).then(result => {
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
            enqueueGoogleSync(async () => {
                if (typeof window.deleteWorkCalendarEvent === 'function') await window.deleteWorkCalendarEvent(dateKey).catch(err => console.error('Lỗi xóa sự kiện Lịch (Ca chính):', err));
                if (typeof window.deleteOtCalendarEvent === 'function') await window.deleteOtCalendarEvent(dateKey).catch(err => console.error('Lỗi xóa sự kiện Lịch (OT):', err));
                if (typeof window.deleteGoogleTask === 'function') await window.deleteGoogleTask(dateKey).catch(err => console.error('Lỗi xóa Google Task:', err));
            });
        }
    } catch (e) {
        console.error('Lỗi xóa lịch ngày:', e);
        alert('Có lỗi khi xóa lịch làm việc của ngày này. Vui lòng thử lại. (Chi tiết lỗi đã ghi trong Console F12)');
        closeDayModal();
    }
}

// ==================== IMPORT EXCEL ====================

/**
 * Đọc 1 dòng dữ liệu từ Excel và trả về { dateKey, dayData } hoặc null nếu
 * dòng không hợp lệ (không đọc được ngày). CHỈ BẮT BUỘC "Ngày" + "Mã Ca":
 * - Thiếu "Mã Ca" -> mặc định 'OFF'.
 * - Thiếu "Phân loại" (hoặc không khớp "đổi ca"/"trực hộ") -> mặc định
 *   'chinhchu' (Chính chủ).
 * - Thiếu OT / Mã PCCV / Nhân sự liên quan -> để trống, không bắt buộc.
 * - Ngày nghỉ làm tăng cường: Mã Ca = OFF (hoặc để trống) + cột OT = mã ca.
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

// ==================== LỊCH HỌP & DANH SÁCH BÊN PHẢI ====================

function getMeetingsByDate(dateKey) {
    return Object.values(window.monthlyMeetingsData || {}).filter(m => m.date === dateKey).sort((a, b) => (a.start || '').localeCompare(b.start || ''));
}

function renderScheduleAgenda() {
    const agenda = document.getElementById('schedule-agenda');
    const meetingAgenda = document.getElementById('meeting-agenda');
    if (!agenda || !meetingAgenda) return;

    const workItems = Object.entries(window.monthlyScheduleData || {})
        .filter(([, d]) => d.task || (d.shift && d.shift !== 'OFF') || d.ot)
        .sort(([a], [b]) => a.localeCompare(b));
    const taskCountEl = document.getElementById('schedule-task-count');
    if (taskCountEl) taskCountEl.innerText = workItems.length;

    agenda.innerHTML = workItems.length ? workItems.map(([date]) => {
        const info = buildDayInfo(date);
        const dt = new Date(parseInt(date.slice(0, 4), 10), parseInt(date.slice(5, 7), 10) - 1, parseInt(date.slice(8, 10), 10));
        const dow = WEEKDAY_SHORT[dt.getDay()];

        let line = '';
        if (info.hasMain) line += `${periodChipHtml(info.mainPeriod)}<span class="ag-code">${escapeHtml(info.shiftCode)}</span>`;
        if (info.isOtOnly) line += `<span class="ag-ot-only"><i class='bx bx-bolt-circle'></i>${escapeHtml(info.otCode)}</span>`;
        else if (info.hasOt) line += `<span class="ag-ot-add">+OT ${escapeHtml(info.otCode)}</span>`;

        let who = '';
        if (info.hasMain && info.type === 'doica') who = `Đổi với: ${info.trade || 'chưa chọn'}`;
        if (info.hasMain && info.type === 'trucho') who = `Hộ: ${info.help || 'chưa chọn'}`;

        return `<button class="agenda-item" type="button" onclick="openDayModal('${date}')">
            <b>${date.slice(8, 10)}/${date.slice(5, 7)} · ${dow}</b>
            <span class="ag-line">${line}</span>
            ${who ? `<small>${escapeHtml(who)}</small>` : ''}
            <small>${info.task ? 'PCCV: ' + escapeHtml(info.task) : 'Chưa phân công PCCV'}</small>
        </button>`;
    }).join('') : '<div class="empty-agenda">Chưa có lịch làm việc trong tháng.</div>';

    const meetings = Object.values(window.monthlyMeetingsData || {}).sort((a, b) => (`${a.date} ${a.start}`).localeCompare(`${b.date} ${b.start}`));
    const meetingCountEl = document.getElementById('meeting-count');
    if (meetingCountEl) meetingCountEl.innerText = meetings.length;
    meetingAgenda.innerHTML = meetings.length ? meetings.map(m => `<button class="agenda-item meeting" type="button" onclick="openMeetingModal('${m.id}')"><b>${m.date.slice(8, 10)}/${m.date.slice(5, 7)} · ${escapeHtml(m.start)}</b><span>${escapeHtml(m.title)}</span><small>${m.mode === 'online' ? 'Online' : 'Offline'} · ${escapeHtml(m.location)}</small></button>`).join('') : '<div class="empty-agenda">Chưa có lịch họp trong tháng.</div>';
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
            enqueueGoogleSync(() => window.deleteMeetingCalendarEvent(previousMeeting)).catch(err => console.error('Lỗi xóa sự kiện Lịch họp cũ:', err));
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
            const meetingSnapshot = Object.assign({}, window.monthlyMeetingsData[id]);
            enqueueGoogleSync(() => syncMeetingCalendarEvent(meetingSnapshot)).catch(err => console.error('Lỗi đồng bộ Lịch họp:', err));
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
            enqueueGoogleSync(() => window.deleteMeetingCalendarEvent(meeting)).catch(err => console.error('Lỗi xóa sự kiện Lịch họp:', err));
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

// ==================== ĐỒNG BỘ GOOGLE ====================

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
 * QUY TẮC LỊCH:
 *  - Có ca chính  -> sự kiện ở Lịch chính (giờ theo ca chính).
 *  - Có OT        -> sự kiện ở Lịch OT riêng (giờ tra theo cả Ca tăng cường
 *                    lẫn Ca chính, vì ô OT giờ chọn được cả hai loại).
 *  - Ngày nghỉ làm OT (không ca chính) -> CHỈ có sự kiện ở Lịch OT; sự kiện
 *    cũ ở Lịch chính (nếu có) được xoá đi.
 *
 * FIX DOUBLE EVENT/TASK: kết quả trả về tách RÕ 2 loại lỗi độc lập —
 * result.eventError (Lịch chính/OT) và result.taskError (Task PCCV). Bên
 * googleSync.js luôn "xoá thất bại thì không tạo mới", nên nếu có lỗi thì
 * ngày đó chỉ đơn giản là CHƯA đồng bộ được — không có khả năng tạo dữ liệu
 * trùng lặp — và người dùng được báo rõ để đồng bộ lại.
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
            // ---- Lịch chính ----
            if (hasMainShift) {
                let shiftTime = "08:00 - 17:00";
                const conf = (settings.shifts || []).find(s => s.code === dayData.shift);
                if (conf) shiftTime = conf.time;

                let desc = [];
                if (dayData.task) desc.push(`PCCV: ${dayData.task}`);
                if (hasOT) desc.push(`OT: ${dayData.ot}`);

                if (typeof syncCalendarEvent === 'function') await syncCalendarEvent(key, dayData, shiftTime, desc.join('\n'));
            } else if (typeof window.deleteWorkCalendarEvent === 'function') {
                // Ngày nghỉ làm tăng cường: không tạo sự kiện ở Lịch chính
                await window.deleteWorkCalendarEvent(key);
            }

            // ---- Lịch OT riêng ----
            if (hasOT) {
                let otTime = null;
                const otConf = (settings.otShifts || []).find(s => s.code === dayData.ot)
                    || (settings.shifts || []).find(s => s.code === dayData.ot);
                if (otConf) otTime = otConf.time;

                if (otTime && typeof window.syncOtCalendarEvent === 'function') {
                    let otDesc = [hasMainShift ? `Ca chính: ${dayData.shift}` : 'Ngày nghỉ - làm tăng cường'];
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
    // dùng.
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
        const result = await enqueueGoogleSync(() => window.reconcileMonthWithGoogle(currentDate));

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
 * "Dọn dẹp trùng lặp" — quét Event (Lịch chính + Lịch OT + Lịch họp) và Task
 * PCCV của THÁNG ĐANG XEM, gom nhóm theo ngày/loại, giữ lại 1 bản mới nhất
 * (riêng Task: ưu tiên bản đã hoàn thành) và xoá các bản trùng lặp còn lại.
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
        const result = await enqueueGoogleSync(() => window.cleanupDuplicateGoogleData(currentDate));
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

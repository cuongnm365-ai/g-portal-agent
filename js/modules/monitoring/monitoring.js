/**
 * monitoring.js - Module Giám Sát Request Layer 2
 *
 * ============================================================================
 * BẢN CẬP NHẬT NHỎ (giao diện): tô màu cả dòng bảng theo Trạng thái, dùng chung
 * bảng màu với trang Complaint (class st-* trong css/complaint.css). Toàn bộ
 * logic / dữ liệu / bộ lọc / Google Sheets bên dưới giữ NGUYÊN.
 *   In Progress          -> vàng nhạt (giống "In Process")
 *   Fully Resolved       -> xanh lá nhạt (giống "Đã xử lý")
 *   Closed without Action-> xám nhạt   (giống "Đã xử lý, KH thanh lý")
 * Giao diện popup "Sửa Request" được làm rộng / nhiều cột hoàn toàn bằng CSS
 * (css/complaint.css, khối #mon-modal) — không đổi HTML hay cấu trúc dữ liệu.
 * ============================================================================
 *
 * ============================================================================
 * BẢN VÁ TRƯỚC ĐÓ — "Nhập xong hiển thị OK, F5 lại thì báo chưa đăng nhập rồi
 * ~3 giây sau báo 'Không có dữ liệu phù hợp'"
 * ============================================================================
 * Có 3 nguyên nhân độc lập, đã xử lý cả 3:
 *
 * 1) SHEETS TỰ "BIẾN ĐỔI" DỮ LIỆU KHI GHI (nguyên nhân chính khiến dữ liệu
 *    biến mất sau F5). Code cũ ghi bằng valueInputOption = 'USER_ENTERED' nên
 *    Google Sheets tự nhận dạng:
 *      - "2026-10-02T14:30" (TG tiếp nhận) -> chuyển thành ô ngày giờ, khi đọc
 *        lại trả về dạng "10/2/2026 14:30:00" => r.receivedTime.slice(0,7)
 *        không còn là "2026-10" => bộ lọc tháng loại hết bản ghi => bảng báo
 *        "Không có dữ liệu phù hợp".
 *      - SĐT "0901234567" -> thành số 901234567 (mất số 0 đầu).
 *    Cách sửa: ghi bằng 'RAW' (giữ nguyên chuỗi), và khi đọc dùng
 *    UNFORMATTED_VALUE + SERIAL_NUMBER rồi tự chuẩn hoá lại (cả các dòng đã
 *    lỡ bị Sheets chuyển đổi từ trước vẫn đọc lại đúng, không mất dữ liệu).
 *
 * 2) KHÔNG AI GỌI NẠP DỮ LIỆU SAU KHI ĐĂNG NHẬP LẠI NGẦM. Khi F5, lúc trang
 *    mở thì Google chưa đăng nhập xong (isLoggedIn = false) nên lần nạp đầu
 *    thoát im lặng; sau đó đăng nhập ngầm xong cũng không có sự kiện nào kích
 *    hoạt nạp lại (hồ sơ đã cache nên 'gportal_profile_ready' không bắn nữa).
 *    Cách sửa: module tự "chờ Google sẵn sàng" (polling) rồi mới nạp, không
 *    phụ thuộc sự kiện bên ngoài; trong lúc chờ hiển thị trạng thái rõ ràng
 *    ("Đang chờ kết nối Google..." / "Đang tải...") thay vì câu "Không có dữ
 *    liệu" gây hiểu nhầm. Lỗi nạp (nếu có) hiển thị kèm nút Thử lại, KHÔNG xoá
 *    dữ liệu đang có.
 *
 * 3) HIỂN THỊ TỨC THÌ TỪ BỘ NHỚ ĐỆM: bản ghi lần trước được lưu cache trong
 *    localStorage (gắn theo email tài khoản) nên F5 là có dữ liệu hiện ngay,
 *    rồi cập nhật lại từ Google Sheets ngầm phía sau.
 *
 * FILE GOOGLE SHEET: tài khoản đăng nhập là tài khoản chính nên hệ thống TỰ
 * TẠO file "monitoring_data" (nếu chưa có), ghi nhớ ID để lần sau mở thẳng,
 * và chống tạo trùng khi nhiều tác vụ gọi cùng lúc. Nếu lỡ có nhiều file cùng
 * tên thì chọn file có nhiều dòng dữ liệu nhất.
 *
 * DEEPLINK: dưới ô Hợp đồng -> OmniAgent (kèm SĐT + số hợp đồng); dưới ô SR ID
 * -> trang chi tiết SR. Cột Hợp đồng/SR ID trong bảng cũng bấm được.
 * ============================================================================
 */

// ======================================================================
// CONSTANTS & STATE
// ======================================================================
const MON_SHEET_NAME   = 'E2E Request';
const MON_SHEET_TAB    = 'datae2erq';
const MON_FOLDER_ID    = '1iY95fH02z0fkxf6mVw5nifwZPA4x_kIO'; // thư mục chứa file (nếu không chuyển được thì để ở Drive gốc)
const MON_SHEET_ID_KEY = 'gportal_mon_sheet_id';
const MON_CACHE_KEY    = 'gportal_mon_cache_v1';
const OMNI_BASE        = 'http://omniagent.fpt.net/?phoneCs=';
const SR_BASE          = 'http://sr.fpt.net/sr/ServiceRequest/detail?code=';

const MON_HEADERS = [
    'id','stt','region','province','branch',
    'receivedTime','ticketId','srId','contractNo','contactNo',
    'requestDetails','status','requestType','subType','resolution',
    'completedTime','processingTime','completed'
];

let monState = {
    spreadsheetId : null,
    tab           : MON_SHEET_TAB,
    sheetGid      : 0,
    records       : [],
    filtered      : [],
    editingId     : null,
    status        : 'loading',   // 'loading' | 'ready' | 'error'
    errorMsg      : ''
};

const MA_TINH_LIST = [
    'HN','QN','HD','DA','NT','DN','BD','BG','BN','CB','HA','HB','LC','LS','PT',
    'TN','TQ','VP','YB','DB','HM','HY','NA','NB','SL','TB','TH','SG','HP','BI',
    'DK','DL','GL','HU','KT','PY','QB','QI','QA','QT','BT','LA','LD','NN','TI',
    'AG','BL','CM','BE','CT','DT','HG','KG','ST','TG','TV','VL','LI','BK','VT',
    'ND','HT','BP'
];

// ======================================================================
// TIỆN ÍCH CHUNG
// ======================================================================
function el(id) { return document.getElementById(id); }
function val(id) { const e = el(id); return e ? (e.value || '') : ''; }
function setValue(id, v) { const e = el(id); if (e) e.value = v; }
function pad2(n) { return String(n).padStart(2, '0'); }

function esc(s) {
    return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

function safeGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
function safeSet(key, v) { try { localStorage.setItem(key, v); } catch (e) {} }
function safeDel(key) { try { localStorage.removeItem(key); } catch (e) {} }

function nowLocalInput() {
    const now = new Date();
    return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function errText(err) {
    const api = err && err.result && err.result.error;
    if (api) return `${api.code} - ${api.message}`;
    return (err && err.message) ? err.message : String(err);
}

function errCode(err) {
    return (err && err.status) || (err && err.result && err.result.error && err.result.error.code) || 0;
}

function formatDT(dt) {
    if (!dt) return '';
    try { return new Date(dt).toLocaleString('vi-VN', { hour12: false }).replace(',', ''); }
    catch (e) { return dt; }
}

function toDatetimeLocal(str) {
    if (!str) return '';
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(str)) return str.slice(0, 16);
    try {
        const d = new Date(str);
        if (isNaN(d.getTime())) return '';
        return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    } catch (e) { return ''; }
}

// ---- Chuẩn hoá dữ liệu đọc từ Sheets (xem ghi chú nguyên nhân #1 đầu file) ----
function cellToDateTimeLocal(v) {
    if (v === '' || v === null || v === undefined) return '';
    if (typeof v === 'number') {
        // Serial của Sheets là giờ "treo tường" không múi giờ -> đọc bằng các hàm UTC
        let ms = Math.round((v - 25569) * 86400000);
        ms = Math.round(ms / 60000) * 60000;
        const d = new Date(ms);
        return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
    }
    return toDatetimeLocal(String(v));
}

function fixPhone(v) {
    if (v === '' || v === null || v === undefined) return '';
    const s = String(v).trim();
    if (/^\d{9}$/.test(s)) return '0' + s; // Sheets đã làm rơi số 0 đầu
    return s;
}

function normalizeRecord(arr) {
    const o = {};
    MON_HEADERS.forEach((h, i) => {
        const v = arr[i];
        o[h] = (v === undefined || v === null) ? '' : v;
    });
    ['id', 'stt', 'region', 'province', 'branch', 'ticketId', 'srId', 'contractNo',
     'requestDetails', 'status', 'requestType', 'subType', 'resolution',
     'processingTime', 'completed'].forEach(k => { o[k] = String(o[k]); });
    o.receivedTime  = cellToDateTimeLocal(o.receivedTime);
    o.completedTime = cellToDateTimeLocal(o.completedTime);
    o.contactNo     = fixPhone(o.contactNo);
    return o;
}

function rng(a1) { return `'${monState.tab}'!${a1}`; }

// ---- Deeplink ----
function omniUrl(phone, contract) {
    return OMNI_BASE + encodeURIComponent((phone || '').trim()) + '&contractCs=' + encodeURIComponent((contract || '').trim());
}
function srUrl(sr) {
    return SR_BASE + encodeURIComponent((sr || '').trim());
}

// ---- Màu dòng theo Trạng thái (dùng chung bảng màu st-* với trang Complaint) ----
function monStatusClass(status) {
    if (status === 'Fully Resolved') return 'st-done';
    if (status === 'Closed without Action') return 'st-terminated';
    return 'st-inprocess'; // In Progress và mọi giá trị khác
}

// CSS màu/popup nằm trong css/complaint.css — tự nạp nếu index.html chưa link
function ensureMonStylesheet() {
    const has = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).some(l => /complaint\.css/.test(l.getAttribute('href') || ''));
    if (has) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'css/complaint.css';
    document.head.appendChild(link);
}

// ======================================================================
// INIT
// ======================================================================
document.addEventListener('DOMContentLoaded', () => {
    const on = (id, ev, fn) => { const e = el(id); if (e) e.addEventListener(ev, fn); };

    ensureMonStylesheet();

    on('btn-mon-add', 'click', openAddModal);
    on('btn-mon-refresh', 'click', refreshMonitoring);
    on('btn-mon-export-excel', 'click', exportMonitoringExcel);
    on('mon-filter-status', 'change', applyFilters);
    on('mon-filter-month', 'change', applyFilters);
    on('mon-filter-region', 'change', applyFilters);

    on('btn-close-mon-modal', 'click', closeMonModal);
    on('btn-mon-save', 'click', saveMonRecord);
    on('btn-mon-delete', 'click', deleteMonRecord);
    on('btn-mon-extract', 'click', autoExtract);
    on('mon-req-type', 'change', updateSubTypeDropdown);

    on('mon-completed', 'change', () => {
        updateStatusDisplay();
        const v = val('mon-completed');
        const g = el('mon-completed-time-group');
        if (g) g.style.display = v ? '' : 'none';
        if (v && !val('mon-completed-time')) setValue('mon-completed-time', nowLocalInput());
    });

    // Deeplink dưới ô Hợp đồng / SR ID (tự chèn bằng JS, không cần sửa index.html)
    ensureLinkSlot('mon-contract', 'mon-contract-link');
    ensureLinkSlot('mon-sr', 'mon-sr-link');
    ['mon-contract', 'mon-phone', 'mon-sr'].forEach(id => on(id, 'input', updateDeepLinks));
    on('mon-contract', 'input', () => lookupRegionByContract(val('mon-contract')));

    const modal = el('mon-modal');
    if (modal) modal.addEventListener('click', e => { if (e.target === modal) closeMonModal(); });

    initMonthFilter();

    // Hiện ngay dữ liệu cache (nếu có) rồi nạp lại từ Google ngầm phía sau
    renderFromCache();
    renderTable();
    window.loadMonitoringData();
});

// ======================================================================
// CACHE (hiển thị tức thì khi F5)
// ======================================================================
function currentEmail() {
    try {
        if (window.AppState && AppState.userProfile && AppState.userProfile.email) return AppState.userProfile.email;
        const p = JSON.parse(safeGet('gportal_user_profile') || 'null');
        return p && p.email ? p.email : '';
    } catch (e) { return ''; }
}

function saveCache() {
    const email = currentEmail();
    if (!email) return;
    safeSet(MON_CACHE_KEY, JSON.stringify({ email, ts: Date.now(), records: monState.records }));
}

function renderFromCache() {
    try {
        // Đã đăng xuất (hồ sơ bị xoá) -> xoá luôn cache, không lộ dữ liệu
        if (!safeGet('gportal_user_profile')) { safeDel(MON_CACHE_KEY); return; }
        const cache = JSON.parse(safeGet(MON_CACHE_KEY) || 'null');
        if (!cache || cache.email !== currentEmail() || !Array.isArray(cache.records)) return;
        monState.records = cache.records;
        populateRegionFilter();
        applyFilters();
    } catch (e) { console.warn('[Monitoring] Cache không hợp lệ, bỏ qua:', e); }
}

// ======================================================================
// CHỜ GOOGLE SẴN SÀNG (không phụ thuộc sự kiện bên ngoài)
// ======================================================================
function googleReady() {
    return !!(window.AppState && AppState.isLoggedIn && window.gapi && gapi.client &&
        gapi.client.sheets && gapi.client.drive &&
        typeof gapi.client.getToken === 'function' && gapi.client.getToken());
}

function waitForGoogleReady(timeoutMs = 10 * 60 * 1000) {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        (function tick() {
            if (googleReady()) return resolve();
            if (Date.now() - start > timeoutMs) return reject(new Error('Chưa kết nối được Google. Vui lòng đăng nhập rồi bấm "Làm mới".'));
            setTimeout(tick, 300);
        })();
    });
}

// ======================================================================
// SHEET HELPERS
// ======================================================================
let sheetPromise = null;

function ensureSpreadsheet() {
    if (monState.spreadsheetId) return Promise.resolve(monState.spreadsheetId);
    // Chỉ cho 1 luồng tìm/tạo file tại một thời điểm -> không bao giờ tạo trùng file
    if (!sheetPromise) sheetPromise = resolveSpreadsheet().finally(() => { sheetPromise = null; });
    return sheetPromise;
}

async function detectTab(id) {
    const m = await gapi.client.sheets.spreadsheets.get({
        spreadsheetId: id, fields: 'sheets.properties(title,sheetId)'
    });
    const sheets = m.result.sheets || [];
    const t = sheets.find(s => s.properties.title === MON_SHEET_TAB) || sheets[0];
    monState.tab = t ? t.properties.title : MON_SHEET_TAB;
    monState.sheetGid = t ? t.properties.sheetId : 0;
}

async function countRows(id) {
    const r = await gapi.client.sheets.spreadsheets.values.get({ spreadsheetId: id, range: 'A2:A' });
    return (r.result.values || []).length;
}

async function resolveSpreadsheet() {
    let id = null;

    // 1) ID đã ghi nhớ từ lần trước -> mở thẳng
    const cached = safeGet(MON_SHEET_ID_KEY);
    if (cached) {
        try {
            await detectTab(cached);
            id = cached;
        } catch (e) {
            const c = errCode(e);
            if (c === 404 || c === 403 || c === 400) safeDel(MON_SHEET_ID_KEY);
            else throw e;
        }
    }

    // 2) Tìm file cùng tên trên Drive của tài khoản đang đăng nhập
    if (!id) {
        const res = await gapi.client.drive.files.list({
            q: `name='${MON_SHEET_NAME}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
            spaces: 'drive', fields: 'files(id,name,createdTime)', orderBy: 'createdTime', pageSize: 10
        });
        const files = res.result.files || [];
        if (files.length === 1) {
            id = files[0].id;
        } else if (files.length > 1) {
            let best = files[0].id, bestN = -1;
            for (const f of files) {
                const n = await countRows(f.id).catch(() => 0);
                if (n > bestN) { bestN = n; best = f.id; }
            }
            id = best;
        }
        if (id) await detectTab(id);
    }

    // 3) Chưa có -> TỰ TẠO file mới
    if (!id) {
        const cr = await gapi.client.sheets.spreadsheets.create({
            resource: {
                properties: { title: MON_SHEET_NAME },
                sheets: [{ properties: { title: MON_SHEET_TAB } }]
            }
        });
        id = cr.result.spreadsheetId;
        monState.spreadsheetId = id;
        monState.tab = MON_SHEET_TAB;
        monState.sheetGid = (cr.result.sheets && cr.result.sheets[0]) ? cr.result.sheets[0].properties.sheetId : 0;
        await writeHeaderRow();
        moveToFolder(id);
    }

    monState.spreadsheetId = id;
    safeSet(MON_SHEET_ID_KEY, id);
    return id;
}

// Chuyển file vào thư mục chỉ định (không bắt buộc — thất bại thì để ở Drive gốc)
async function moveToFolder(fileId) {
    try {
        await gapi.client.drive.files.update({
            fileId, addParents: MON_FOLDER_ID, removeParents: 'root', fields: 'id'
        });
    } catch (e) {
        console.warn('[Monitoring] Không chuyển được file vào thư mục, giữ ở Drive gốc:', errText(e));
    }
}

async function writeHeaderRow() {
    const labels = [
        'ID','STT','Khu Vực','Tỉnh/Thành','Chi Nhánh',
        'TG Tiếp nhận','Ticket ID','SR ID','Hợp Đồng','SĐT',
        'Nội dung YC','Trạng thái','Loại RQL2','Phân loại','Phương án',
        'TG Hoàn tất','TG Xử lý','Hoàn tất'
    ];
    await gapi.client.sheets.spreadsheets.values.update({
        spreadsheetId: monState.spreadsheetId,
        range: rng('A1'),
        valueInputOption: 'RAW',
        resource: { values: [labels] }
    });
}

async function loadAllRows() {
    const sid = await ensureSpreadsheet();
    const res = await gapi.client.sheets.spreadsheets.values.get({
        spreadsheetId: sid,
        range: rng('A2:R'),
        valueRenderOption: 'UNFORMATTED_VALUE',
        dateTimeRenderOption: 'SERIAL_NUMBER'
    });
    return (res.result.values || []).map(normalizeRecord).filter(r => r.id);
}

function recordToRow(record) {
    return MON_HEADERS.map(h => (record[h] === undefined || record[h] === null) ? '' : String(record[h]));
}

async function findRowIndexById(id) {
    const sid = await ensureSpreadsheet();
    const res = await gapi.client.sheets.spreadsheets.values.get({
        spreadsheetId: sid, range: rng('A2:A'), valueRenderOption: 'UNFORMATTED_VALUE'
    });
    const col = res.result.values || [];
    return col.findIndex(r => String(r[0]) === String(id)); // 0 = dòng dữ liệu đầu tiên
}

async function appendRow(record) {
    const sid = await ensureSpreadsheet();
    await gapi.client.sheets.spreadsheets.values.append({
        spreadsheetId: sid,
        range: rng('A1'),
        valueInputOption: 'RAW',          // RAW: giữ nguyên chuỗi, không để Sheets tự đổi ngày/SĐT
        insertDataOption: 'INSERT_ROWS',
        resource: { values: [recordToRow(record)] }
    });
}

async function updateRow(record) {
    const sid = await ensureSpreadsheet();
    const idx = await findRowIndexById(record.id);
    if (idx === -1) throw new Error('Không tìm thấy dòng dữ liệu trên Google Sheets (có thể đã bị xoá thủ công). Hãy bấm "Làm mới".');
    const sheetRow = idx + 2;
    await gapi.client.sheets.spreadsheets.values.update({
        spreadsheetId: sid,
        range: rng(`A${sheetRow}:R${sheetRow}`),
        valueInputOption: 'RAW',
        resource: { values: [recordToRow(record)] }
    });
}

async function deleteRow(id) {
    const sid = await ensureSpreadsheet();
    const idx = await findRowIndexById(id);
    if (idx === -1) return; // đã không còn trên Sheets
    const startIndex = idx + 1; // 0-based, dòng 0 là tiêu đề
    await gapi.client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: sid,
        resource: {
            requests: [{
                deleteDimension: {
                    range: { sheetId: monState.sheetGid, dimension: 'ROWS', startIndex, endIndex: startIndex + 1 }
                }
            }]
        }
    });
}

// ======================================================================
// DATA LOAD & FILTER
// ======================================================================
let monLoading = null;

window.loadMonitoringData = function () {
    if (monLoading) return monLoading;
    monLoading = doLoadMonitoring().finally(() => { monLoading = null; });
    return monLoading;
};

async function doLoadMonitoring() {
    if (!monState.records.length) { monState.status = 'loading'; renderTable(); }
    try {
        await waitForGoogleReady();
        const rows = await loadAllRows();
        monState.records = rows;
        monState.status = 'ready';
        monState.errorMsg = '';
        saveCache();
        populateRegionFilter();
        applyFilters();
    } catch (err) {
        console.error('[Monitoring] Lỗi tải dữ liệu:', err);
        monState.status = 'error';
        monState.errorMsg = errText(err);
        renderTable(); // KHÔNG xoá dữ liệu đang có
    }
}

async function refreshMonitoring() {
    const btn = el('btn-mon-refresh');
    if (btn) { btn.disabled = true; btn.innerHTML = "<i class='bx bx-loader-alt bx-spin'></i> Đang tải..."; }
    if (!monState.records.length) monState.status = 'loading';
    renderTable();
    await window.loadMonitoringData();
    if (btn) { btn.disabled = false; btn.innerHTML = "<i class='bx bx-refresh'></i> Làm mới"; }
}

function initMonthFilter() {
    const sel = el('mon-filter-month');
    if (!sel) return;
    const now = new Date();
    sel.innerHTML = '<option value="all">-- Tất cả (+ In Progress cũ) --</option>';
    for (let i = 0; i < 12; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const v = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
        const opt = document.createElement('option');
        opt.value = v; opt.textContent = `Tháng ${d.getMonth() + 1}/${d.getFullYear()}`;
        if (i === 0) opt.selected = true;
        sel.appendChild(opt);
    }
}

function applyFilters() {
    const monthVal  = val('mon-filter-month') || 'all';
    const statusVal = val('mon-filter-status');
    const regionVal = val('mon-filter-region');
    const now = new Date();
    const currentYM = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;

    monState.filtered = monState.records.filter(r => {
        const recYM = (r.receivedTime || '').slice(0, 7) || currentYM;

        let passMonth;
        if (monthVal === 'all') {
            passMonth = (recYM === currentYM) || (r.status === 'In Progress' && recYM < currentYM);
        } else {
            passMonth = (recYM === monthVal) || (monthVal < currentYM && r.status === 'In Progress' && recYM <= monthVal);
        }
        if (!passMonth) return false;
        if (statusVal && r.status !== statusVal) return false;
        if (regionVal && r.region !== regionVal) return false;
        return true;
    });

    renderTable();
}

function populateRegionFilter() {
    const sel = el('mon-filter-region');
    if (!sel) return;
    const keep = sel.value;
    const regions = [...new Set(monState.records.map(r => r.region).filter(Boolean))].sort();
    sel.innerHTML = '<option value="">-- Tất cả khu vực --</option>';
    regions.forEach(reg => {
        const opt = document.createElement('option');
        opt.value = reg; opt.textContent = reg;
        sel.appendChild(opt);
    });
    if (keep && regions.includes(keep)) sel.value = keep;
}

// ======================================================================
// RENDER TABLE
// ======================================================================
function statusBadge(status) {
    const map = {
        'In Progress'          : 'background:#f59e0b;color:#fff',
        'Fully Resolved'       : 'background:#10b981;color:#fff',
        'Closed without Action': 'background:#6b7280;color:#fff'
    };
    const style = map[status] || 'background:var(--border-color);';
    return `<span style="padding:3px 8px;border-radius:20px;font-size:11.5px;font-weight:600;white-space:nowrap;${style}">${esc(status) || '–'}</span>`;
}

function messageRow(html) {
    return `<tr><td colspan="18" style="text-align:center;padding:40px;color:var(--text-muted);">${html}</td></tr>`;
}

function renderTable() {
    const tbody = el('mon-tbody');
    if (!tbody) return;

    const badge = el('mon-count-badge');
    if (badge) badge.textContent = `${monState.filtered.length} bản ghi`;

    if (!monState.filtered.length) {
        if (!monState.records.length) {
            if (monState.status === 'error') {
                tbody.innerHTML = messageRow(`<i class='bx bx-error-circle'></i> Không tải được dữ liệu: ${esc(monState.errorMsg)}<br><br><button class="btn-primary" type="button" onclick="refreshMonitoringFromUI()"><i class='bx bx-refresh'></i> Thử lại</button>`);
            } else if (monState.status === 'loading') {
                const msg = googleReady() ? 'Đang tải dữ liệu từ Google Sheets...' : 'Đang chờ kết nối Google...';
                tbody.innerHTML = messageRow(`<i class='bx bx-loader-alt bx-spin'></i> ${msg}`);
            } else {
                tbody.innerHTML = messageRow('Chưa có dữ liệu — bấm <strong>Thêm mới</strong> để bắt đầu.');
            }
        } else {
            tbody.innerHTML = messageRow(`Không có dữ liệu phù hợp với bộ lọc hiện tại (tổng cộng ${monState.records.length} bản ghi — hãy đổi tháng/trạng thái/khu vực).`);
        }
        return;
    }

    let note = '';
    if (monState.status === 'error') {
        note = `<tr><td colspan="18" style="padding:8px 12px;background:rgba(239,68,68,.1);color:var(--danger);font-size:12.5px;">⚠ Chưa cập nhật được từ Google Sheets (${esc(monState.errorMsg)}) — đang hiển thị dữ liệu đã lưu trước đó. <a href="#" onclick="refreshMonitoringFromUI();return false;" style="color:var(--accent)">Thử lại</a></td></tr>`;
    }

    tbody.innerHTML = note + monState.filtered.map((r, idx) => {
        const details = r.requestDetails || '';
        return `
        <tr class="mon-row ${monStatusClass(r.status)}" data-id="${esc(r.id)}" style="cursor:pointer;">
            <td>${idx + 1}</td>
            <td title="${esc(r.region)}">${esc(r.region) || '–'}</td>
            <td title="${esc(r.province)}">${esc(r.province) || '–'}</td>
            <td>${esc(r.branch) || '–'}</td>
            <td style="font-size:12px;">${esc(formatDT(r.receivedTime))}</td>
            <td>${esc(r.ticketId) || '–'}</td>
            <td>${r.srId ? `<a class="mon-link" href="${esc(srUrl(r.srId))}" target="_blank" rel="noopener" style="color:var(--accent)">${esc(r.srId)}</a>` : '–'}</td>
            <td>${r.contractNo ? `<a class="mon-link" href="${esc(omniUrl(r.contactNo, r.contractNo))}" target="_blank" rel="noopener" style="color:var(--accent);font-weight:700;">${esc(r.contractNo)}</a>` : '–'}</td>
            <td>${esc(r.contactNo) || '–'}</td>
            <td class="mon-cell-truncate" title="${esc(details)}">${esc(details.substring(0, 80))}${details.length > 80 ? '…' : ''}</td>
            <td>${statusBadge(r.status)}</td>
            <td style="font-size:12px;">${esc(r.requestType) || '–'}</td>
            <td style="font-size:12px;">${esc(r.subType) || '–'}</td>
            <td style="font-size:12px;">${esc(r.resolution) || '–'}</td>
            <td style="font-size:12px;">${esc(formatDT(r.completedTime))}</td>
            <td style="font-size:12px;">${esc(r.processingTime) || '–'}</td>
            <td style="font-size:12px;">${esc(r.completed) || '–'}</td>
            <td>
                <button class="btn-icon" onclick="openEditModal('${esc(r.id)}')" title="Sửa"><i class='bx bx-edit'></i></button>
            </td>
        </tr>`;
    }).join('');

    // Bấm vào dòng = mở sửa (trừ ô có link và nút sửa)
    tbody.querySelectorAll('.mon-row td:not(:last-child)').forEach(td => {
        td.addEventListener('click', (e) => {
            if (e.target.closest && e.target.closest('a')) return;
            openEditModal(td.parentElement.dataset.id);
        });
    });
}

window.refreshMonitoringFromUI = function () { refreshMonitoring(); };

// ======================================================================
// DEEPLINK DƯỚI Ô HỢP ĐỒNG / SR ID
// ======================================================================
function ensureLinkSlot(inputId, slotId) {
    const input = el(inputId);
    if (!input || el(slotId)) return;
    const d = document.createElement('div');
    d.id = slotId;
    d.style.cssText = 'margin-top:4px;font-size:12.5px;min-height:16px;';
    input.insertAdjacentElement('afterend', d);
}

function updateDeepLinks() {
    const contract = val('mon-contract').trim();
    const phone = val('mon-phone').trim();
    const sr = val('mon-sr').trim();

    const cSlot = el('mon-contract-link');
    if (cSlot) {
        cSlot.innerHTML = contract
            ? `<a href="${esc(omniUrl(phone, contract))}" target="_blank" rel="noopener" style="color:var(--accent);font-weight:600;text-decoration:none;"><i class='bx bx-link-external'></i> Mở OmniAgent (${esc(contract)})</a>`
            : '';
    }
    const sSlot = el('mon-sr-link');
    if (sSlot) {
        sSlot.innerHTML = sr
            ? `<a href="${esc(srUrl(sr))}" target="_blank" rel="noopener" style="color:var(--accent);font-weight:600;text-decoration:none;"><i class='bx bx-link-external'></i> Mở chi tiết SR (${esc(sr)})</a>`
            : '';
    }
}

// ======================================================================
// MODAL OPEN / CLOSE
// ======================================================================
function openAddModal() {
    monState.editingId = null;
    el('mon-modal-title').textContent = 'Thêm Request mới';
    clearMonForm();
    populateMonDropdowns();
    setValue('mon-received-time', nowLocalInput());
    el('btn-mon-delete').style.display = 'none';
    el('mon-completed-time-group').style.display = 'none';
    updateStatusDisplay();
    el('mon-modal').classList.add('active');
}

window.openEditModal = function (id) {
    const record = monState.records.find(r => r.id === id);
    if (!record) return;
    monState.editingId = id;
    el('mon-modal-title').textContent = 'Sửa Request';
    clearMonForm();
    populateMonDropdowns();
    fillMonForm(record);
    el('btn-mon-delete').style.display = 'inline-flex';
    el('mon-completed-time-group').style.display = record.completed ? '' : 'none';
    el('mon-modal').classList.add('active');
};

function closeMonModal() {
    el('mon-modal').classList.remove('active');
}

function clearMonForm() {
    ['mon-details','mon-contract','mon-phone','mon-ticket','mon-sr',
     'mon-region','mon-province','mon-received-time','mon-completed-time',
     'mon-branch','mon-req-type','mon-sub-type','mon-resolution','mon-completed'].forEach(id => setValue(id, ''));
    updateStatusDisplay();
    updateDeepLinks();
}

function fillMonForm(r) {
    setValue('mon-details',        r.requestDetails);
    setValue('mon-contract',       r.contractNo);
    setValue('mon-phone',          r.contactNo);
    setValue('mon-ticket',         r.ticketId);
    setValue('mon-sr',             r.srId);
    setValue('mon-region',         r.region);
    setValue('mon-province',       r.province);
    setValue('mon-received-time',  toDatetimeLocal(r.receivedTime));
    setValue('mon-completed-time', toDatetimeLocal(r.completedTime));
    setValue('mon-completed',      r.completed);

    populateBranchDropdown((r.contractNo || '').slice(0, 2).toUpperCase() || r.province);
    setValue('mon-branch', r.branch);

    setValue('mon-req-type', r.requestType);
    updateSubTypeDropdown();
    setValue('mon-sub-type', r.subType);
    setValue('mon-resolution', r.resolution);

    updateStatusDisplay();
    updateDeepLinks();
}

// ======================================================================
// DROPDOWNS IN MODAL
// ======================================================================
function populateMonDropdowns() {
    const ws = window.workflowSettings || { requestTypes: [], resolutions: [] };

    const rtSel = el('mon-req-type');
    if (rtSel) {
        rtSel.innerHTML = '<option value="">-- Chọn Loại RQL2 --</option>';
        (ws.requestTypes || []).forEach(rt => {
            const op = document.createElement('option');
            op.value = rt.type; op.textContent = rt.type;
            rtSel.appendChild(op);
        });
    }

    const resSel = el('mon-resolution');
    if (resSel) {
        resSel.innerHTML = '<option value="">-- Chọn Phương án --</option>';
        (ws.resolutions || []).forEach(r => {
            const op = document.createElement('option');
            op.value = r.name; op.textContent = r.name;
            resSel.appendChild(op);
        });
    }
}

function updateSubTypeDropdown() {
    const rtVal = val('mon-req-type');
    const stSel = el('mon-sub-type');
    if (!stSel) return;
    stSel.innerHTML = '<option value="">-- Chọn Phân loại --</option>';
    const ws = window.workflowSettings || { requestTypes: [] };
    const parent = (ws.requestTypes || []).find(rt => rt.type === rtVal);
    if (parent) {
        (parent.subTypes || []).forEach(st => {
            const op = document.createElement('option');
            op.value = st; op.textContent = st;
            stSel.appendChild(op);
        });
    }
}

function populateBranchDropdown(provinceCodeOrName) {
    const sel = el('mon-branch');
    if (!sel) return;
    sel.innerHTML = '<option value="">-- Chọn chi nhánh --</option>';
    const ws = window.workflowSettings || { regions: [] };
    const key = String(provinceCodeOrName || '').toUpperCase();
    const pObj = (ws.regions || []).find(r =>
        String(r.provinceCode || '').toUpperCase() === key ||
        String(r.provinceName || '').toUpperCase() === key
    );
    if (pObj) {
        (pObj.branches || []).forEach(b => {
            const op = document.createElement('option');
            op.value = b; op.textContent = b;
            sel.appendChild(op);
        });
    }
}

function updateStatusDisplay() {
    const completedVal = val('mon-completed');
    let status = 'In Progress';
    if (completedVal === 'Completed') status = 'Fully Resolved';
    else if (completedVal === 'Closed by Others') status = 'Closed without Action';
    setValue('mon-status-display', status);
}

// ======================================================================
// AUTO-EXTRACT
// ======================================================================
function autoExtract() {
    const text = val('mon-details');
    if (!text.trim()) return alert('Vui lòng nhập Nội dung YC trước!');

    // Ticket ID
    const ticketMatch = text.match(/Mã Ticket[:\s]+([^\s.]+)/i);
    if (ticketMatch) setValue('mon-ticket', ticketMatch[1].trim());

    const identifiers = window.extractMonitoringIdentifiers(text);
    const srCode = identifiers.srCode;
    const contract = identifiers.contractNo;
    const phone = identifiers.phone;
    if (srCode) setValue('mon-sr', srCode);

    if (contract) {
        setValue('mon-contract', contract);
        lookupRegionByContract(contract);
    }
    if (phone) setValue('mon-phone', phone);

    if (!val('mon-received-time')) setValue('mon-received-time', nowLocalInput());
    updateDeepLinks();
}

// Shared identifier extraction for other modules that ingest pasted alert text.
window.extractMonitoringIdentifiers = function (text) {
    const whole = String(text || '');
    let srCode = '';
    const srMatch = whole.match(/Mã SR[:\s]+([A-Za-z0-9-]+)/i);
    if (srMatch) srCode = srMatch[1].trim();
    if (!srCode) {
        const fallback = whole.match(/\b(SHI-[A-Z0-9-]+)\b/i);
        if (fallback) srCode = fallback[1];
    }
    let contractNo = '', phone = '';
    whole.split(/\s+/).forEach(raw => {
        const token = raw.replace(/[^A-Za-z0-9]/g, '');
        if (!contractNo && token.length === 9 && MA_TINH_LIST.includes(token.slice(0, 2).toUpperCase())) contractNo = token.toUpperCase();
        if (!phone && token.length === 10 && token.startsWith('0') && /^\d+$/.test(token)) phone = token;
    });
    return { srCode, contractNo, phone };
};

function lookupRegionByContract(contractNo) {
    if (!contractNo || contractNo.length < 2) return;
    const code = contractNo.slice(0, 2).toUpperCase();
    const ws = window.workflowSettings || { regions: [] };
    const pObj = (ws.regions || []).find(r => String(r.provinceCode || '').toUpperCase() === code);
    if (pObj) {
        const changed = val('mon-province') !== pObj.provinceName;
        setValue('mon-region', pObj.region);
        setValue('mon-province', pObj.provinceName);
        if (changed) populateBranchDropdown(pObj.provinceCode);
    }
}

// ======================================================================
// SAVE / DELETE
// ======================================================================
async function saveMonRecord() {
    const details = val('mon-details').trim();
    if (!details) return alert('Nội dung YC không được để trống!');

    const contract      = val('mon-contract').trim().toUpperCase();
    const phone         = val('mon-phone').trim();
    const ticket        = val('mon-ticket').trim();
    const sr            = val('mon-sr').trim();
    const region        = val('mon-region').trim();
    const province      = val('mon-province').trim();
    const branch        = val('mon-branch');
    const receivedTime  = val('mon-received-time');
    const reqType       = val('mon-req-type');
    const subType       = val('mon-sub-type');
    const resolution    = val('mon-resolution');
    const completed     = val('mon-completed');
    const completedTime = completed ? val('mon-completed-time') : '';
    const statusDisp    = val('mon-status-display') || 'In Progress';

    let processingTime = '';
    if (receivedTime && completedTime) {
        const ms = new Date(completedTime) - new Date(receivedTime);
        if (!isNaN(ms) && ms >= 0) {
            processingTime = `${Math.floor(ms / 3600000)}h${Math.floor((ms % 3600000) / 60000)}m`;
        }
    }

    const btn = el('btn-mon-save');
    btn.disabled = true; btn.innerHTML = "<i class='bx bx-loader-alt bx-spin'></i> Đang lưu...";

    try {
        await waitForGoogleReady(30000);

        if (monState.editingId) {
            const record = monState.records.find(r => r.id === monState.editingId);
            if (record) {
                const updated = Object.assign({}, record, {
                    region, province, branch, receivedTime,
                    ticketId: ticket, srId: sr, contractNo: contract, contactNo: phone,
                    requestDetails: details, status: statusDisp,
                    requestType: reqType, subType, resolution,
                    completedTime, processingTime, completed
                });
                await updateRow(updated);      // ghi Sheets thành công rồi mới cập nhật bộ nhớ
                Object.assign(record, updated);
            }
        } else {
            const id = `mon_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
            const record = {
                id, stt: String(monState.records.length + 1),
                region, province, branch, receivedTime,
                ticketId: ticket, srId: sr, contractNo: contract, contactNo: phone,
                requestDetails: details, status: statusDisp,
                requestType: reqType, subType, resolution,
                completedTime, processingTime, completed
            };
            await appendRow(record);
            monState.records.push(record);
        }

        monState.status = 'ready';
        saveCache();
        populateRegionFilter();
        closeMonModal();
        applyFilters();
    } catch (err) {
        alert('Lỗi lưu dữ liệu: ' + errText(err));
        console.error(err);
    } finally {
        btn.disabled = false; btn.innerHTML = "<i class='bx bx-save'></i> Lưu";
    }
}

async function deleteMonRecord() {
    if (!monState.editingId) return;
    if (!confirm('Bạn có chắc muốn xóa bản ghi này?')) return;
    try {
        await waitForGoogleReady(30000);
        await deleteRow(monState.editingId);
        monState.records = monState.records.filter(r => r.id !== monState.editingId);
        saveCache();
        populateRegionFilter();
        closeMonModal();
        applyFilters();
    } catch (err) {
        alert('Lỗi xóa: ' + errText(err));
    }
}

// ======================================================================
// EXPORT EXCEL
// ======================================================================
function exportMonitoringExcel() {
    const data = monState.filtered.map((r, idx) => ({
        'STT'           : idx + 1,
        'Khu Vực'       : r.region,
        'Tỉnh/Thành'    : r.province,
        'Chi Nhánh'     : r.branch,
        'TG Tiếp nhận'  : formatDT(r.receivedTime),
        'Ticket ID'     : r.ticketId,
        'SR ID'         : r.srId,
        'Hợp Đồng'      : r.contractNo,
        'SĐT'           : r.contactNo,
        'Nội dung YC'   : r.requestDetails,
        'Trạng thái'    : r.status,
        'Loại RQL2'     : r.requestType,
        'Phân loại'     : r.subType,
        'Phương án'     : r.resolution,
        'TG Hoàn tất'   : formatDT(r.completedTime),
        'TG Xử lý'      : r.processingTime,
        'Hoàn tất'      : r.completed
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'GiamSat');
    const now = new Date();
    XLSX.writeFile(wb, `GiamSat_${now.getFullYear()}${pad2(now.getMonth() + 1)}.xlsx`);
}

// ======================================================================
// Hook vào vòng đời ứng dụng
// ======================================================================
window.addEventListener('gportal_profile_ready', () => {
    // Hồ sơ/đăng nhập vừa sẵn sàng -> nạp lại (nếu chưa có dữ liệu thật từ Sheets)
    if (monState.status !== 'ready') window.loadMonitoringData();
});

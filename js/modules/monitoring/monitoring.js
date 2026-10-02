/**
 * monitoring.js - Module Giám Sát Request Layer 2
 * - Lưu trữ: Google Sheets (file cố định, xem MON_SPREADSHEET_ID bên dưới)
 * - Hiển thị: tháng hiện tại + các record "In Progress" từ tháng cũ
 * - Auto-extract: Hợp đồng, SĐT, Ticket ID, SR ID từ Nội dung YC
 * - Auto-lookup: Khu vực, Tỉnh/Thành từ mã 2 ký tự đầu Hợp đồng
 *
 * ============================================================================
 * BẢN VÁ: "Giám sát ghi nhận được dữ liệu nhưng không thấy đổ về Google Sheet"
 * ============================================================================
 * NGUYÊN NHÂN (phân tích từ code cũ):
 *  1) Code cũ KHÔNG biết file Google Sheet của bạn. Nó tìm trên Drive 1 file
 *     tên "monitoring_data"; không có thì TỰ TẠO 1 file mới ở thư mục GỐC của
 *     Drive. Vì Portal chỉ được cấp quyền "drive.file" (chỉ thấy file do chính
 *     Portal tạo) nên file bạn tự tạo/để trong folder luôn "vô hình" với
 *     Portal -> dữ liệu có thể đã đổ vào 1 file "monitoring_data" khác, nằm ở
 *     thư mục gốc, trong khi bạn mở file/folder của mình thì không thấy gì.
 *  2) Tên tab bị cố định là "Requests". Nếu tab trong sheet của bạn tên khác
 *     (VD "Trang tính1"/"Sheet1") thì ghi sẽ lỗi.
 *  3) Các hàm ghi dữ liệu bị `if (!sid) return;` — im lặng bỏ qua, màn hình
 *     vẫn hiện dòng mới (vì dữ liệu được đẩy vào bộ nhớ trình duyệt) dù chưa
 *     hề ghi lên Sheet. Đây là lý do "thấy ghi nhận rồi mà Sheet không có".
 *  4) Ghi bằng USER_ENTERED nên SĐT "0901234567" bị Google Sheets đổi thành số
 *     901234567 (mất số 0 đầu), mã hợp đồng/ngày giờ cũng có thể bị đổi định dạng.
 * CÁCH SỬA:
 *  - Ghi thẳng vào Sheet có ID cố định MON_SPREADSHEET_ID (Portal đã có scope
 *    "spreadsheets" nên truy cập được mọi Sheet của tài khoản đăng nhập theo ID).
 *  - Tự dò tên tab: dùng tab "Requests" nếu có, không thì dùng tab đầu tiên;
 *    nếu dòng 1 trống thì tự ghi dòng tiêu đề.
 *  - Mọi lỗi đều được ném ra và HIỆN THÔNG BÁO (không còn nuốt lỗi); dòng mới
 *    chỉ được thêm vào bảng SAU KHI ghi Sheet thành công.
 *  - Ghi bằng RAW để giữ nguyên SĐT/mã hợp đồng dạng văn bản.
 * ============================================================================
 */

// ======================================================================
// CONSTANTS & STATE
// ======================================================================
// Google Sheet lưu dữ liệu Giám Sát (lấy từ link .../spreadsheets/d/<ID>/edit)
const MON_SPREADSHEET_ID = '1HLQfY4l0PTqNZ-WL0o40jRJvw2DpSNW6RsVeOu_EYn0';
// Thư mục Drive chứa Sheet (chỉ để tham khảo/hiển thị link, không dùng để ghi)
const MON_FOLDER_ID      = '1iY95fH02z0fkxf6mVw5nifwZPA4x_kIO';
const MON_PREFERRED_TAB  = 'Requests';
const MON_HEADERS        = [
    'id','stt','region','province','branch',
    'receivedTime','ticketId','srId','contractNo','contactNo',
    'requestDetails','status','requestType','subType','resolution',
    'completedTime','processingTime','completed'
];
const MON_HEADER_LABELS = [
    'ID','STT','Khu Vực','Tỉnh/Thành','Chi Nhánh',
    'TG Tiếp nhận','Ticket ID','SR ID','Hợp Đồng','SĐT',
    'Nội dung YC','Trạng thái','Loại RQL2','Phân loại','Phương án',
    'TG Hoàn tất','TG Xử lý','Hoàn tất'
];

let monState = {
    spreadsheetId : MON_SPREADSHEET_ID,
    tabTitle      : null,   // tên tab thực tế đang dùng (tự dò)
    tabSheetId    : null,   // sheetId (gid) của tab đang dùng
    ready         : false,  // đã kiểm tra tab + dòng tiêu đề chưa
    records       : [],
    filtered      : [],
    editingId     : null,
};

const MA_TINH_LIST = [
    'HN','QN','HD','DA','NT','DN','BD','BG','BN','CB','HA','HB','LC','LS','PT',
    'TN','TQ','VP','YB','DB','HM','HY','NA','NB','SL','TB','TH','SG','HP','BI',
    'DK','DL','GL','HU','KT','PY','QB','QI','QA','QT','BT','LA','LD','NN','TI',
    'AG','BL','CM','BE','CT','DT','HG','KG','ST','TG','TV','VL','LI','BK','VT',
    'ND','HT','BP'
];

// ======================================================================
// INIT
// ======================================================================
document.addEventListener('DOMContentLoaded', () => {
    const elAdd     = document.getElementById('btn-mon-add');
    const elRefresh = document.getElementById('btn-mon-refresh');
    const elExport  = document.getElementById('btn-mon-export-excel');
    const elStatus  = document.getElementById('mon-filter-status');
    const elMonth   = document.getElementById('mon-filter-month');
    const elRegion  = document.getElementById('mon-filter-region');

    if (elAdd)     elAdd.addEventListener('click', openAddModal);
    if (elRefresh) elRefresh.addEventListener('click', refreshMonitoring);
    if (elExport)  elExport.addEventListener('click', exportMonitoringExcel);
    if (elStatus)  elStatus.addEventListener('change', applyFilters);
    if (elMonth)   elMonth.addEventListener('change', applyFilters);
    if (elRegion)  elRegion.addEventListener('change', applyFilters);

    const elClose   = document.getElementById('btn-close-mon-modal');
    const elSave    = document.getElementById('btn-mon-save');
    const elDel     = document.getElementById('btn-mon-delete');
    const elExtract = document.getElementById('btn-mon-extract');
    const elReqType = document.getElementById('mon-req-type');
    const elCompleted = document.getElementById('mon-completed');
    const elContract = document.getElementById('mon-contract');

    if (elClose)    elClose.addEventListener('click', closeMonModal);
    if (elSave)     elSave.addEventListener('click', saveMonRecord);
    if (elDel)      elDel.addEventListener('click', deleteMonRecord);
    if (elExtract)  elExtract.addEventListener('click', autoExtract);
    if (elReqType)  elReqType.addEventListener('change', updateSubTypeDropdown);
    if (elContract) elContract.addEventListener('change', () => lookupRegionByContract(elContract.value.trim()));
    if (elCompleted) elCompleted.addEventListener('change', () => {
        updateStatusDisplay();
        const v = elCompleted.value;
        const g = document.getElementById('mon-completed-time-group');
        if (g) g.style.display = v ? '' : 'none';
    });

    const modal = document.getElementById('mon-modal');
    if (modal) modal.addEventListener('click', e => { if (e.target === modal) closeMonModal(); });

    initMonthFilter();
});

// ======================================================================
// SHEET HELPERS
// ======================================================================
function monErrMsg(err) {
    const apiErr = err && err.result && err.result.error;
    if (apiErr) return `${apiErr.code} - ${apiErr.message}`;
    return (err && err.message) ? err.message : String(err);
}

function monRange(a1) {
    // Tên tab có khoảng trắng/ký tự đặc biệt phải đặt trong nháy đơn
    return `'${String(monState.tabTitle).replace(/'/g, "''")}'!${a1}`;
}

/**
 * Kiểm tra truy cập Sheet, dò tên tab, đảm bảo có dòng tiêu đề.
 * Chỉ chạy đầy đủ 1 lần mỗi phiên (monState.ready).
 */
async function ensureSpreadsheet() {
    if (monState.ready) return monState.spreadsheetId;

    if (typeof AppState === 'undefined' || !AppState.isLoggedIn || !window.gapi || !gapi.client) {
        throw new Error('Chưa đăng nhập Google.');
    }
    if (!gapi.client.sheets) {
        throw new Error('Google Sheets API chưa sẵn sàng. Hãy bật "Google Sheets API" trong Google Cloud Console (project của CLIENT_ID đang dùng) và tải lại trang.');
    }

    let meta;
    try {
        meta = await gapi.client.sheets.spreadsheets.get({
            spreadsheetId: monState.spreadsheetId,
            fields: 'sheets.properties(sheetId,title)'
        });
    } catch (err) {
        throw new Error(`Không mở được Google Sheet Giám Sát (${monErrMsg(err)}). Kiểm tra: (1) tài khoản đang đăng nhập có quyền sửa file này; (2) Google Sheets API đã được bật.`);
    }

    const sheets = (meta.result.sheets || []).map(s => s.properties);
    if (!sheets.length) throw new Error('Google Sheet Giám Sát không có tab nào.');

    const chosen = sheets.find(s => s.title === MON_PREFERRED_TAB) || sheets[0];
    monState.tabTitle = chosen.title;
    monState.tabSheetId = chosen.sheetId;

    // Dòng tiêu đề: chỉ ghi khi ô A1 đang trống (không ghi đè dữ liệu người dùng)
    const head = await gapi.client.sheets.spreadsheets.values.get({
        spreadsheetId: monState.spreadsheetId,
        range: monRange('A1:R1')
    });
    const a1 = head.result.values && head.result.values[0] && head.result.values[0][0];
    if (!a1) {
        await gapi.client.sheets.spreadsheets.values.update({
            spreadsheetId: monState.spreadsheetId,
            range: monRange('A1'),
            valueInputOption: 'RAW',
            resource: { values: [MON_HEADER_LABELS] }
        });
    } else if (String(a1).trim().toUpperCase() !== 'ID') {
        console.warn(`[Monitoring] Ô A1 của tab "${monState.tabTitle}" đang là "${a1}" (không phải "ID"). Portal vẫn ghi dữ liệu từ dòng 2 trở đi theo đúng thứ tự cột: ${MON_HEADER_LABELS.join(', ')}.`);
    }

    monState.ready = true;
    return monState.spreadsheetId;
}

async function loadAllRows() {
    const sid = await ensureSpreadsheet();
    const res = await gapi.client.sheets.spreadsheets.values.get({
        spreadsheetId: sid,
        range: monRange('A2:R')
    });
    const rows = res.result.values || [];
    return rows.map(r => {
        const obj = {};
        MON_HEADERS.forEach((h, i) => obj[h] = r[i] || '');
        return obj;
    }).filter(r => r.id);
}

async function appendRow(record) {
    const sid = await ensureSpreadsheet();
    const row = MON_HEADERS.map(h => record[h] == null ? '' : String(record[h]));
    const res = await gapi.client.sheets.spreadsheets.values.append({
        spreadsheetId: sid,
        range: monRange('A1'),
        valueInputOption: 'RAW',          // RAW: giữ nguyên SĐT "0901..." và mã hợp đồng
        insertDataOption: 'INSERT_ROWS',
        resource: { values: [row] }
    });
    console.log('[Monitoring] Đã ghi vào Sheet:', res.result && res.result.updates && res.result.updates.updatedRange);
}

async function findRowIndexById(id) {
    const sid = await ensureSpreadsheet();
    const res = await gapi.client.sheets.spreadsheets.values.get({
        spreadsheetId: sid, range: monRange('A2:A')
    });
    const col = res.result.values || [];
    return col.findIndex(r => r[0] === id); // 0-based so với dòng 2
}

async function updateRow(record) {
    const sid = await ensureSpreadsheet();
    const idx = await findRowIndexById(record.id);
    if (idx === -1) throw new Error('Không tìm thấy dòng cần cập nhật trong Google Sheet (có thể đã bị xoá thủ công). Hãy bấm "Làm mới".');
    const sheetRow = idx + 2;
    const row = MON_HEADERS.map(h => record[h] == null ? '' : String(record[h]));
    await gapi.client.sheets.spreadsheets.values.update({
        spreadsheetId: sid,
        range: monRange(`A${sheetRow}:R${sheetRow}`),
        valueInputOption: 'RAW',
        resource: { values: [row] }
    });
}

async function deleteRow(id) {
    const sid = await ensureSpreadsheet();
    const idx = await findRowIndexById(id);
    if (idx === -1) return; // đã không còn trên Sheet
    const startIndex = idx + 1; // chỉ số 0-based của dòng (dòng 1 = tiêu đề = index 0)

    await gapi.client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: sid,
        resource: {
            requests: [{
                deleteDimension: {
                    range: { sheetId: monState.tabSheetId, dimension: 'ROWS', startIndex, endIndex: startIndex + 1 }
                }
            }]
        }
    });
}

// ======================================================================
// DATA LOAD & FILTER
// ======================================================================
window.loadMonitoringData = async function () {
    if (typeof AppState === 'undefined' || !AppState.isLoggedIn) return;
    try {
        monState.records = await loadAllRows();
        populateRegionFilter();
        applyFilters();
    } catch (err) {
        console.error('[Monitoring] Lỗi tải dữ liệu:', err);
        const tbody = document.getElementById('mon-tbody');
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="18" style="text-align:center;padding:40px;color:var(--danger);">Không tải được dữ liệu từ Google Sheet: ${monEscape(monErrMsg(err))}</td></tr>`;
        }
    }
};

async function refreshMonitoring() {
    const btn = document.getElementById('btn-mon-refresh');
    if (btn) { btn.disabled = true; btn.innerHTML = "<i class='bx bx-loader-alt bx-spin'></i> Đang tải..."; }
    monState.ready = false; // dò lại tab + tiêu đề cho chắc
    await window.loadMonitoringData();
    if (btn) { btn.disabled = false; btn.innerHTML = "<i class='bx bx-refresh'></i> Làm mới"; }
}

function initMonthFilter() {
    const sel = document.getElementById('mon-filter-month');
    if (!sel) return;
    const now = new Date();
    sel.innerHTML = '<option value="all">-- Tất cả (+ In Progress cũ) --</option>';
    for (let i = 0; i < 12; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const val = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
        const lbl = `Tháng ${d.getMonth()+1}/${d.getFullYear()}`;
        const opt = document.createElement('option');
        opt.value = val; opt.textContent = lbl;
        if (i === 0) opt.selected = true;
        sel.appendChild(opt);
    }
}

function applyFilters() {
    const monthVal  = (document.getElementById('mon-filter-month')?.value) || 'all';
    const statusVal = (document.getElementById('mon-filter-status')?.value) || '';
    const regionVal = (document.getElementById('mon-filter-region')?.value) || '';
    const now = new Date();
    const currentYM = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;

    monState.filtered = monState.records.filter(r => {
        const recYM = (r.receivedTime || '').slice(0, 7);

        let passMonth = false;
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
    const sel = document.getElementById('mon-filter-region');
    if (!sel) return;
    const current = sel.value;
    const regions = [...new Set(monState.records.map(r => r.region).filter(Boolean))].sort();
    sel.innerHTML = '<option value="">-- Tất cả khu vực --</option>';
    regions.forEach(reg => {
        const opt = document.createElement('option');
        opt.value = reg; opt.textContent = reg;
        sel.appendChild(opt);
    });
    if (current && regions.includes(current)) sel.value = current;
}

// ======================================================================
// RENDER TABLE
// ======================================================================
function monEscape(value) {
    return String(value == null ? '' : value).replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
}

function statusBadge(status) {
    const map = {
        'In Progress'          : 'background:#f59e0b;color:#fff',
        'Fully Resolved'       : 'background:#10b981;color:#fff',
        'Closed without Action': 'background:#6b7280;color:#fff',
    };
    const style = map[status] || 'background:var(--border-color);';
    return `<span style="padding:3px 8px;border-radius:20px;font-size:11.5px;font-weight:600;white-space:nowrap;${style}">${monEscape(status) || '–'}</span>`;
}

function formatDT(dt) {
    if (!dt) return '';
    try { return new Date(dt).toLocaleString('vi-VN', {hour12:false}).replace(',',''); }
    catch (e) { return dt; }
}

function renderTable() {
    const tbody = document.getElementById('mon-tbody');
    if (!tbody) return;

    const badge = document.getElementById('mon-count-badge');
    if (badge) badge.textContent = `${monState.filtered.length} bản ghi`;

    if (!monState.filtered.length) {
        tbody.innerHTML = `<tr><td colspan="18" style="text-align:center;padding:40px;color:var(--text-muted);">Không có dữ liệu phù hợp.</td></tr>`;
        return;
    }

    tbody.innerHTML = monState.filtered.map((r, idx) => `
        <tr class="mon-row" data-id="${monEscape(r.id)}" style="cursor:pointer;">
            <td>${idx+1}</td>
            <td title="${monEscape(r.region)}">${monEscape(r.region) || '–'}</td>
            <td title="${monEscape(r.province)}">${monEscape(r.province) || '–'}</td>
            <td>${monEscape(r.branch) || '–'}</td>
            <td style="font-size:12px;">${monEscape(formatDT(r.receivedTime))}</td>
            <td>${monEscape(r.ticketId) || '–'}</td>
            <td>${r.srId ? `<a href="http://sr.fpt.net/sr/ServiceRequest/detail?code=${encodeURIComponent(r.srId)}" target="_blank" style="color:var(--accent)">${monEscape(r.srId)}</a>` : '–'}</td>
            <td><strong>${monEscape(r.contractNo) || '–'}</strong></td>
            <td>${monEscape(r.contactNo) || '–'}</td>
            <td class="mon-cell-truncate" title="${monEscape(r.requestDetails)}">${monEscape((r.requestDetails||'').substring(0,80))}${(r.requestDetails||'').length>80?'…':''}</td>
            <td>${statusBadge(r.status)}</td>
            <td style="font-size:12px;">${monEscape(r.requestType) || '–'}</td>
            <td style="font-size:12px;">${monEscape(r.subType) || '–'}</td>
            <td style="font-size:12px;">${monEscape(r.resolution) || '–'}</td>
            <td style="font-size:12px;">${monEscape(formatDT(r.completedTime))}</td>
            <td style="font-size:12px;">${monEscape(r.processingTime) || '–'}</td>
            <td style="font-size:12px;">${monEscape(r.completed) || '–'}</td>
            <td>
                <button class="btn-icon" onclick="event.stopPropagation(); openEditModal('${monEscape(r.id)}')" title="Sửa"><i class='bx bx-edit'></i></button>
            </td>
        </tr>
    `).join('');

    tbody.querySelectorAll('.mon-row td:not(:last-child)').forEach(td => {
        td.addEventListener('click', () => openEditModal(td.parentElement.dataset.id));
    });
}

// ======================================================================
// MODAL OPEN / CLOSE
// ======================================================================
function openAddModal() {
    monState.editingId = null;
    document.getElementById('mon-modal-title').textContent = 'Thêm Request mới';
    clearMonForm();
    populateMonDropdowns();
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset()*60000).toISOString().slice(0,16);
    document.getElementById('mon-received-time').value = local;
    document.getElementById('btn-mon-delete').style.display = 'none';
    document.getElementById('mon-completed-time-group').style.display = 'none';
    updateStatusDisplay();
    document.getElementById('mon-modal').classList.add('active');
}

window.openEditModal = function (id) {
    const record = monState.records.find(r => r.id === id);
    if (!record) return;
    monState.editingId = id;
    document.getElementById('mon-modal-title').textContent = 'Sửa Request';
    clearMonForm();
    populateMonDropdowns();
    fillMonForm(record);
    document.getElementById('btn-mon-delete').style.display = 'inline-flex';
    document.getElementById('mon-completed-time-group').style.display = record.completed ? '' : 'none';
    document.getElementById('mon-modal').classList.add('active');
};

function closeMonModal() {
    document.getElementById('mon-modal').classList.remove('active');
}

function clearMonForm() {
    ['mon-details','mon-contract','mon-phone','mon-ticket','mon-sr',
     'mon-region','mon-province','mon-received-time','mon-completed-time'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    ['mon-branch','mon-req-type','mon-sub-type','mon-resolution','mon-completed'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    updateStatusDisplay();
}

function fillMonForm(r) {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
    set('mon-details',        r.requestDetails);
    set('mon-contract',       r.contractNo);
    set('mon-phone',          r.contactNo);
    set('mon-ticket',         r.ticketId);
    set('mon-sr',             r.srId);
    set('mon-region',         r.region);
    set('mon-province',       r.province);
    set('mon-received-time',  toDatetimeLocal(r.receivedTime));
    set('mon-completed-time', toDatetimeLocal(r.completedTime));
    set('mon-completed',      r.completed);

    // Chi nhánh: tra theo mã tỉnh (2 ký tự đầu Hợp đồng), không có thì theo tên tỉnh
    const branchSel = document.getElementById('mon-branch');
    populateBranchDropdown(r.contractNo ? r.contractNo.slice(0,2).toUpperCase() : r.province);
    if (branchSel) {
        ensureSelectOption(branchSel, r.branch);
        branchSel.value = r.branch || '';
    }

    const rtSel = document.getElementById('mon-req-type');
    if (rtSel) { ensureSelectOption(rtSel, r.requestType); rtSel.value = r.requestType || ''; updateSubTypeDropdown(); }
    const stSel = document.getElementById('mon-sub-type');
    if (stSel) { ensureSelectOption(stSel, r.subType); stSel.value = r.subType || ''; }

    const resSel = document.getElementById('mon-resolution');
    if (resSel) { ensureSelectOption(resSel, r.resolution); resSel.value = r.resolution || ''; }

    updateStatusDisplay();
}

// Giá trị đã lưu nhưng nay không còn trong Workflow Setting -> vẫn giữ lại để không mất dữ liệu khi lưu
function ensureSelectOption(sel, value) {
    if (!sel || !value) return;
    if (!Array.from(sel.options).some(o => o.value === value)) {
        const op = document.createElement('option');
        op.value = value; op.textContent = value;
        sel.appendChild(op);
    }
}

function toDatetimeLocal(str) {
    if (!str) return '';
    try {
        const d = new Date(str);
        if (isNaN(d.getTime())) return '';
        return new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString().slice(0,16);
    } catch (e) { return ''; }
}

// ======================================================================
// DROPDOWNS IN MODAL
// ======================================================================
function populateMonDropdowns() {
    const ws = window.workflowSettings || { requestTypes: [], resolutions: [] };

    const rtSel = document.getElementById('mon-req-type');
    if (rtSel) {
        rtSel.innerHTML = '<option value="">-- Chọn Loại RQL2 --</option>';
        ws.requestTypes.forEach(rt => {
            const op = document.createElement('option');
            op.value = rt.type; op.textContent = rt.type;
            rtSel.appendChild(op);
        });
    }

    const stSel = document.getElementById('mon-sub-type');
    if (stSel) stSel.innerHTML = '<option value="">-- Chọn Phân loại --</option>';

    const brSel = document.getElementById('mon-branch');
    if (brSel) brSel.innerHTML = '<option value="">-- Chọn chi nhánh --</option>';

    const resSel = document.getElementById('mon-resolution');
    if (resSel) {
        resSel.innerHTML = '<option value="">-- Chọn Phương án --</option>';
        ws.resolutions.forEach(r => {
            const op = document.createElement('option');
            op.value = r.name; op.textContent = r.name;
            resSel.appendChild(op);
        });
    }
}

function updateSubTypeDropdown() {
    const rtVal = document.getElementById('mon-req-type')?.value || '';
    const stSel = document.getElementById('mon-sub-type');
    if (!stSel) return;
    stSel.innerHTML = '<option value="">-- Chọn Phân loại --</option>';
    const ws = window.workflowSettings || { requestTypes: [] };
    const parent = ws.requestTypes.find(rt => rt.type === rtVal);
    if (parent) {
        (parent.subTypes || []).forEach(st => {
            const op = document.createElement('option');
            op.value = st; op.textContent = st;
            stSel.appendChild(op);
        });
    }
}

function populateBranchDropdown(provinceCodeOrName) {
    const sel = document.getElementById('mon-branch');
    if (!sel) return;
    sel.innerHTML = '<option value="">-- Chọn chi nhánh --</option>';
    const ws = window.workflowSettings || { regions: [] };
    const key = String(provinceCodeOrName || '').toLowerCase();
    const pObj = ws.regions.find(r =>
        String(r.provinceCode).toLowerCase() === key ||
        String(r.provinceName).toLowerCase() === key
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
    const completedVal = document.getElementById('mon-completed')?.value || '';
    let status = 'In Progress';
    if (completedVal === 'Completed')        status = 'Fully Resolved';
    else if (completedVal === 'Closed by Others') status = 'Closed without Action';
    const el = document.getElementById('mon-status-display');
    if (el) el.value = status;
}

// ======================================================================
// AUTO-EXTRACT
// ======================================================================
function monIsKnownProvinceCode(code) {
    const c = String(code || '').toUpperCase();
    if (MA_TINH_LIST.includes(c)) return true;
    const ws = window.workflowSettings || { regions: [] };
    return ws.regions.some(r => String(r.provinceCode).toUpperCase() === c);
}

function autoExtract() {
    const text = document.getElementById('mon-details')?.value || '';
    if (!text.trim()) return alert('Vui lòng nhập Nội dung YC trước!');

    const ticketMatch = text.match(/Mã Ticket[:\s]+([^\s.]+)/i);
    if (ticketMatch) setValue('mon-ticket', ticketMatch[1].trim());

    const srMatch = text.match(/Mã SR[:\s]+([^\s.]+)/i);
    if (srMatch) setValue('mon-sr', srMatch[1].trim());

    const tokens = text.split(/\s+/);
    let contract = '';
    let phone = '';
    tokens.forEach(tok => {
        if (!contract && tok.length === 9 && monIsKnownProvinceCode(tok.slice(0,2))) {
            contract = tok;
        }
        if (!phone && tok.startsWith('0') && tok.length === 10 && /^\d+$/.test(tok)) {
            phone = tok;
        }
    });

    if (contract) {
        setValue('mon-contract', contract);
        lookupRegionByContract(contract);
    }
    if (phone) setValue('mon-phone', phone);

    const rtEl = document.getElementById('mon-received-time');
    if (rtEl && !rtEl.value) {
        const now = new Date();
        rtEl.value = new Date(now.getTime() - now.getTimezoneOffset()*60000).toISOString().slice(0,16);
    }
}

function setValue(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val;
}

function lookupRegionByContract(contractNo) {
    if (!contractNo || contractNo.length < 2) return;
    const code = contractNo.slice(0,2).toUpperCase();
    const ws = window.workflowSettings || { regions: [] };
    const pObj = ws.regions.find(r => String(r.provinceCode).toUpperCase() === code);
    if (pObj) {
        setValue('mon-region', pObj.region);
        setValue('mon-province', pObj.provinceName);
        populateBranchDropdown(pObj.provinceCode);
    }
}

// ======================================================================
// SAVE / DELETE
// ======================================================================
async function saveMonRecord() {
    const details = document.getElementById('mon-details')?.value.trim() || '';
    if (!details) return alert('Nội dung YC không được để trống!');

    const contract     = document.getElementById('mon-contract')?.value.trim() || '';
    const phone        = document.getElementById('mon-phone')?.value.trim() || '';
    const ticket       = document.getElementById('mon-ticket')?.value.trim() || '';
    const sr           = document.getElementById('mon-sr')?.value.trim() || '';
    const region       = document.getElementById('mon-region')?.value.trim() || '';
    const province     = document.getElementById('mon-province')?.value.trim() || '';
    const branch       = document.getElementById('mon-branch')?.value || '';
    const receivedTime = document.getElementById('mon-received-time')?.value || '';
    const reqType      = document.getElementById('mon-req-type')?.value || '';
    const subType      = document.getElementById('mon-sub-type')?.value || '';
    const resolution   = document.getElementById('mon-resolution')?.value || '';
    const completed    = document.getElementById('mon-completed')?.value || '';
    const completedTime = document.getElementById('mon-completed-time')?.value || '';
    const statusDisp   = document.getElementById('mon-status-display')?.value || 'In Progress';

    let processingTime = '';
    if (receivedTime && completedTime) {
        const ms = new Date(completedTime) - new Date(receivedTime);
        if (!isNaN(ms) && ms >= 0) {
            const h = Math.floor(ms / 3600000);
            const m = Math.floor((ms % 3600000) / 60000);
            processingTime = `${h}h${m}m`;
        }
    }

    const btn = document.getElementById('btn-mon-save');
    btn.disabled = true; btn.innerHTML = "<i class='bx bx-loader-alt bx-spin'></i> Đang lưu...";

    try {
        if (monState.editingId) {
            const record = monState.records.find(r => r.id === monState.editingId);
            if (record) {
                // Ghi lên Sheet trước bằng bản sao; chỉ cập nhật bảng khi ghi thành công
                const updated = Object.assign({}, record, {
                    region, province, branch, receivedTime,
                    ticketId: ticket, srId: sr, contractNo: contract, contactNo: phone,
                    requestDetails: details, status: statusDisp,
                    requestType: reqType, subType, resolution,
                    completedTime, processingTime, completed
                });
                await updateRow(updated);
                Object.assign(record, updated);
            }
        } else {
            const id = `mon_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
            const stt = String(monState.records.length + 1);
            const record = {
                id, stt, region, province, branch, receivedTime,
                ticketId: ticket, srId: sr, contractNo: contract, contactNo: phone,
                requestDetails: details, status: statusDisp,
                requestType: reqType, subType, resolution,
                completedTime, processingTime, completed
            };
            await appendRow(record);          // lỗi sẽ ném ra -> KHÔNG thêm vào bảng
            monState.records.push(record);
            populateRegionFilter();
        }

        closeMonModal();
        applyFilters();
    } catch (err) {
        console.error('[Monitoring] Lỗi lưu dữ liệu:', err);
        alert('Không lưu được lên Google Sheet:\n' + monErrMsg(err) + '\n\nDữ liệu CHƯA được ghi. Vui lòng kiểm tra lại rồi bấm Lưu lần nữa.');
    } finally {
        btn.disabled = false; btn.innerHTML = "<i class='bx bx-save'></i> Lưu";
    }
}

async function deleteMonRecord() {
    if (!monState.editingId) return;
    if (!confirm('Bạn có chắc muốn xóa bản ghi này?')) return;
    try {
        await deleteRow(monState.editingId);
        monState.records = monState.records.filter(r => r.id !== monState.editingId);
        closeMonModal();
        populateRegionFilter();
        applyFilters();
    } catch (err) {
        console.error('[Monitoring] Lỗi xóa:', err);
        alert('Không xóa được trên Google Sheet:\n' + monErrMsg(err));
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
    XLSX.writeFile(wb, `GiamSat_${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}.xlsx`);
}

// ======================================================================
// Hook into app lifecycle
// ======================================================================
window.addEventListener('gportal_profile_ready', () => {
    if (AppState.currentView === 'monitoring') window.loadMonitoringData();
});

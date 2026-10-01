/**
 * monitoring.js - Module Giám Sát Request Layer 2
 * - Lưu trữ: Google Sheets (1 sheet = 1 file "monitoring_data" trên Drive)
 * - Hiển thị: tháng hiện tại + các record "In Progress" từ tháng cũ
 * - Auto-extract: Hợp đồng, SĐT, Ticket ID, SR ID từ Nội dung YC
 * - Auto-lookup: Khu vực, Tỉnh/Thành từ mã 2 ký tự đầu Hợp đồng
 */

// ======================================================================
// CONSTANTS & STATE
// ======================================================================
const MON_SHEET_NAME   = 'monitoring_data';
const MON_SHEET_TAB    = 'Requests';
const MON_HEADERS      = [
    'id','stt','region','province','branch',
    'receivedTime','ticketId','srId','contractNo','contactNo',
    'requestDetails','status','requestType','subType','resolution',
    'completedTime','processingTime','completed'
];

let monState = {
    spreadsheetId : null,   // Google Sheets file ID
    records       : [],     // all records loaded from sheet
    filtered      : [],     // records currently displayed
    editingId     : null,   // id of record being edited (null = new)
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
    // Toolbar
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

    // Modal
    const elClose   = document.getElementById('btn-close-mon-modal');
    const elSave    = document.getElementById('btn-mon-save');
    const elDel     = document.getElementById('btn-mon-delete');
    const elExtract = document.getElementById('btn-mon-extract');
    const elReqType = document.getElementById('mon-req-type');
    const elCompleted = document.getElementById('mon-completed');

    if (elClose)    elClose.addEventListener('click', closeMonModal);
    if (elSave)     elSave.addEventListener('click', saveMonRecord);
    if (elDel)      elDel.addEventListener('click', deleteMonRecord);
    if (elExtract)  elExtract.addEventListener('click', autoExtract);
    if (elReqType)  elReqType.addEventListener('change', updateSubTypeDropdown);
    if (elCompleted) elCompleted.addEventListener('change', () => {
        updateStatusDisplay();
        const v = elCompleted.value;
        const g = document.getElementById('mon-completed-time-group');
        if (g) g.style.display = v ? '' : 'none';
    });

    // Close modal on overlay click
    const modal = document.getElementById('mon-modal');
    if (modal) modal.addEventListener('click', e => { if (e.target === modal) closeMonModal(); });

    initMonthFilter();
});

// ======================================================================
// SHEET HELPERS
// ======================================================================
async function ensureSpreadsheet() {
    if (monState.spreadsheetId) return monState.spreadsheetId;

    if (!AppState.isLoggedIn || !gapi.client) return null;

    // Try to find existing sheet on Drive
    const res = await gapi.client.drive.files.list({
        q: `name='${MON_SHEET_NAME}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
        spaces: 'drive', fields: 'files(id,name)', pageSize: 1
    });
    const files = res.result.files || [];

    if (files.length > 0) {
        monState.spreadsheetId = files[0].id;
    } else {
        // Create new spreadsheet
        const cr = await gapi.client.sheets.spreadsheets.create({
            resource: {
                properties: { title: MON_SHEET_NAME },
                sheets: [{ properties: { title: MON_SHEET_TAB } }]
            }
        });
        monState.spreadsheetId = cr.result.spreadsheetId;
        // Write header row
        await writeHeaderRow();
    }
    return monState.spreadsheetId;
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
        range: `${MON_SHEET_TAB}!A1`,
        valueInputOption: 'RAW',
        resource: { values: [labels] }
    });
}

async function loadAllRows() {
    const sid = await ensureSpreadsheet();
    if (!sid) return [];

    const res = await gapi.client.sheets.spreadsheets.values.get({
        spreadsheetId: sid,
        range: `${MON_SHEET_TAB}!A2:R`
    });
    const rows = res.result.values || [];
    return rows.map(r => {
        const obj = {};
        MON_HEADERS.forEach((h, i) => obj[h] = r[i] || '');
        return obj;
    }).filter(r => r.id); // skip empty rows
}

async function appendRow(record) {
    const sid = await ensureSpreadsheet();
    if (!sid) return;
    const row = MON_HEADERS.map(h => record[h] || '');
    await gapi.client.sheets.spreadsheets.values.append({
        spreadsheetId: sid,
        range: `${MON_SHEET_TAB}!A1`,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        resource: { values: [row] }
    });
}

async function updateRow(record) {
    const sid = await ensureSpreadsheet();
    if (!sid) return;
    // Find row index by id
    const allRows = await loadAllRaw();
    const rowIdx = allRows.findIndex(r => r[0] === record.id);
    if (rowIdx === -1) return;
    const sheetRow = rowIdx + 2; // +2 because header is row 1, data starts row 2, 0-indexed
    const row = MON_HEADERS.map(h => record[h] || '');
    await gapi.client.sheets.spreadsheets.values.update({
        spreadsheetId: sid,
        range: `${MON_SHEET_TAB}!A${sheetRow}:R${sheetRow}`,
        valueInputOption: 'USER_ENTERED',
        resource: { values: [row] }
    });
}

async function deleteRow(id) {
    const sid = await ensureSpreadsheet();
    if (!sid) return;
    const allRows = await loadAllRaw();
    const rowIdx = allRows.findIndex(r => r[0] === id);
    if (rowIdx === -1) return;
    const sheetRow = rowIdx + 1; // 0-indexed sheet row (header = row 0)

    // Get sheet ID (gid) first
    const meta = await gapi.client.sheets.spreadsheets.get({ spreadsheetId: sid });
    const sheet = meta.result.sheets.find(s => s.properties.title === MON_SHEET_TAB);
    if (!sheet) return;
    const sheetId = sheet.properties.sheetId;

    await gapi.client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: sid,
        resource: {
            requests: [{
                deleteDimension: {
                    range: {
                        sheetId, dimension: 'ROWS',
                        startIndex: sheetRow, endIndex: sheetRow + 1
                    }
                }
            }]
        }
    });
}

async function loadAllRaw() {
    const sid = await ensureSpreadsheet();
    if (!sid) return [];
    const res = await gapi.client.sheets.spreadsheets.values.get({
        spreadsheetId: sid, range: `${MON_SHEET_TAB}!A2:A`
    });
    // We need all columns; fetch full range
    const resAll = await gapi.client.sheets.spreadsheets.values.get({
        spreadsheetId: sid, range: `${MON_SHEET_TAB}!A2:R`
    });
    return resAll.result.values || [];
}

// ======================================================================
// DATA LOAD & FILTER
// ======================================================================
window.loadMonitoringData = async function() {
    if (!AppState.isLoggedIn) return;
    try {
        monState.records = await loadAllRows();
        populateRegionFilter();
        applyFilters();
    } catch(err) {
        console.error('[Monitoring] Lỗi tải dữ liệu:', err);
    }
};

async function refreshMonitoring() {
    const btn = document.getElementById('btn-mon-refresh');
    if (btn) { btn.disabled = true; btn.innerHTML = "<i class='bx bx-loader-alt bx-spin'></i> Đang tải..."; }
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
        const recYM = (r.receivedTime || '').slice(0, 7); // "YYYY-MM"

        let passMonth = false;
        if (monthVal === 'all') {
            // Current month OR in-progress from past
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
    const regions = [...new Set(monState.records.map(r => r.region).filter(Boolean))].sort();
    sel.innerHTML = '<option value="">-- Tất cả khu vực --</option>';
    regions.forEach(reg => {
        const opt = document.createElement('option');
        opt.value = reg; opt.textContent = reg;
        sel.appendChild(opt);
    });
}

// ======================================================================
// RENDER TABLE
// ======================================================================
function statusBadge(status) {
    const map = {
        'In Progress'          : 'background:#f59e0b;color:#fff',
        'Fully Resolved'       : 'background:#10b981;color:#fff',
        'Closed without Action': 'background:#6b7280;color:#fff',
    };
    const style = map[status] || 'background:var(--border-color);';
    return `<span style="padding:3px 8px;border-radius:20px;font-size:11.5px;font-weight:600;white-space:nowrap;${style}">${status || '–'}</span>`;
}

function formatDT(dt) {
    if (!dt) return '';
    try { return new Date(dt).toLocaleString('vi-VN', {hour12:false}).replace(',',''); }
    catch { return dt; }
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
        <tr class="mon-row" data-id="${r.id}" style="cursor:pointer;">
            <td>${idx+1}</td>
            <td title="${r.region}">${r.region || '–'}</td>
            <td title="${r.province}">${r.province || '–'}</td>
            <td>${r.branch || '–'}</td>
            <td style="font-size:12px;">${formatDT(r.receivedTime)}</td>
            <td>${r.ticketId || '–'}</td>
            <td>${r.srId ? `<a href="http://sr.fpt.net/sr/ServiceRequest/detail?code=${r.srId}" target="_blank" style="color:var(--accent)">${r.srId}</a>` : '–'}</td>
            <td><strong>${r.contractNo || '–'}</strong></td>
            <td>${r.contactNo || '–'}</td>
            <td class="mon-cell-truncate" title="${(r.requestDetails||'').replace(/"/g,'&quot;')}">${(r.requestDetails||'').substring(0,80)}${(r.requestDetails||'').length>80?'…':''}</td>
            <td>${statusBadge(r.status)}</td>
            <td style="font-size:12px;">${r.requestType || '–'}</td>
            <td style="font-size:12px;">${r.subType || '–'}</td>
            <td style="font-size:12px;">${r.resolution || '–'}</td>
            <td style="font-size:12px;">${formatDT(r.completedTime)}</td>
            <td style="font-size:12px;">${r.processingTime || '–'}</td>
            <td style="font-size:12px;">${r.completed || '–'}</td>
            <td>
                <button class="btn-icon" onclick="openEditModal('${r.id}')" title="Sửa"><i class='bx bx-edit'></i></button>
            </td>
        </tr>
    `).join('');

    // Row click = open edit
    tbody.querySelectorAll('.mon-row td:not(:last-child)').forEach(td => {
        td.addEventListener('click', () => {
            const id = td.parentElement.dataset.id;
            openEditModal(id);
        });
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
    // Auto set received time = now
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset()*60000).toISOString().slice(0,16);
    document.getElementById('mon-received-time').value = local;
    document.getElementById('btn-mon-delete').style.display = 'none';
    document.getElementById('mon-completed-time-group').style.display = 'none';
    updateStatusDisplay();
    document.getElementById('mon-modal').classList.add('active');
}

window.openEditModal = function(id) {
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
    const set = (id, v) => { const el = document.getElementById(id); if(el) el.value = v || ''; };
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

    // Branch
    const branchSel = document.getElementById('mon-branch');
    populateBranchDropdown(r.provinceCode || r.province);
    if (branchSel) branchSel.value = r.branch || '';

    // Req type
    const rtSel = document.getElementById('mon-req-type');
    if (rtSel) { rtSel.value = r.requestType || ''; updateSubTypeDropdown(); }
    const stSel = document.getElementById('mon-sub-type');
    if (stSel) stSel.value = r.subType || '';

    const resSel = document.getElementById('mon-resolution');
    if (resSel) resSel.value = r.resolution || '';

    updateStatusDisplay();
}

function toDatetimeLocal(str) {
    if (!str) return '';
    try {
        const d = new Date(str);
        return new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString().slice(0,16);
    } catch { return ''; }
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
    const pObj = ws.regions.find(r =>
        r.provinceCode === provinceCodeOrName ||
        r.provinceName === provinceCodeOrName
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
function autoExtract() {
    const text = document.getElementById('mon-details')?.value || '';
    if (!text.trim()) return alert('Vui lòng nhập Nội dung YC trước!');

    // Extract Ticket ID (INC... or similar before .)
    const ticketMatch = text.match(/Mã Ticket[:\s]+([^\s.]+)/i);
    if (ticketMatch) setValue('mon-ticket', ticketMatch[1].trim());

    // Extract SR ID
    const srMatch = text.match(/Mã SR[:\s]+([^\s.]+)/i);
    if (srMatch) setValue('mon-sr', srMatch[1].trim());

    // Extract Contract No: 9-char token starting with province code
    const tokens = text.split(/\s+/);
    let contract = '';
    let phone = '';
    tokens.forEach(tok => {
        if (!contract && tok.length === 9 && MA_TINH_LIST.includes(tok.slice(0,2).toUpperCase())) {
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

    // Auto set received time if empty
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
    const pObj = ws.regions.find(r => r.provinceCode.toUpperCase() === code);
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

    // Processing time
    let processingTime = '';
    if (receivedTime && completedTime) {
        const ms = new Date(completedTime) - new Date(receivedTime);
        if (!isNaN(ms) && ms >= 0) {
            const h = Math.floor(ms / 3600000);
            const m = Math.floor((ms % 3600000) / 60000);
            processingTime = `${h}h${m}m`;
        }
    }

    const provinceCode = contract ? contract.slice(0,2).toUpperCase() : '';

    const btn = document.getElementById('btn-mon-save');
    btn.disabled = true; btn.innerHTML = "<i class='bx bx-loader-alt bx-spin'></i> Đang lưu...";

    try {
        if (monState.editingId) {
            // Update
            const record = monState.records.find(r => r.id === monState.editingId);
            if (record) {
                Object.assign(record, {
                    region, province, branch, receivedTime,
                    ticketId: ticket, srId: sr, contractNo: contract, contactNo: phone,
                    requestDetails: details, status: statusDisp,
                    requestType: reqType, subType, resolution,
                    completedTime, processingTime, completed
                });
                await updateRow(record);
            }
        } else {
            // New record
            const id = `mon_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
            const stt = String(monState.records.length + 1);
            const record = {
                id, stt, region, province, branch, receivedTime,
                ticketId: ticket, srId: sr, contractNo: contract, contactNo: phone,
                requestDetails: details, status: statusDisp,
                requestType: reqType, subType, resolution,
                completedTime, processingTime, completed
            };
            await appendRow(record);
            monState.records.push(record);
        }

        closeMonModal();
        applyFilters();
    } catch(err) {
        alert('Lỗi lưu dữ liệu: ' + err.message);
        console.error(err);
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
        applyFilters();
    } catch(err) {
        alert('Lỗi xóa: ' + err.message);
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

function formatDT(dt) {
    if (!dt) return '';
    try { return new Date(dt).toLocaleString('vi-VN', {hour12:false}).replace(',',''); }
    catch { return dt; }
}

// ======================================================================
// Hook into app lifecycle
// ======================================================================
window.addEventListener('gportal_profile_ready', () => {
    if (AppState.currentView === 'monitoring') window.loadMonitoringData();
});

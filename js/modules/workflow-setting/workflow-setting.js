/**
 * workflow-setting.js - Workflow Settings Module
 * Quản lý: Phân loại RQL2, Vùng miền, Phương án (dành cho module Giám Sát, Complaint)
 *
 * ============================================================================
 * BẢN CẬP NHẬT (viết lại toàn bộ file)
 * ============================================================================
 * 1) DỮ LIỆU VÙNG MIỀN GỌN HƠN: trước đây mỗi TỈNH là 1 khối riêng, tên Khu vực
 *    lặp lại nhiều lần (VD "01.Thập Đại Đô Thị" xuất hiện cho cả HN lẫn QN) nên
 *    danh sách rất dài. Giờ gom theo cấp:  Khu vực  >  Tỉnh/Thành  >  Chi nhánh.
 *    - Mỗi Khu vực là 1 khối THU GỌN mặc định (bấm để mở), hiện sẵn số tỉnh /
 *      số chi nhánh bên cạnh.
 *    - Chi nhánh hiển thị dạng "chip" xếp ngang thay vì mỗi dòng 1 chi nhánh.
 *    - Có ô tìm kiếm + nút "Mở hết / Thu hết".
 *    - Phân loại RQL2 cũng dùng cách hiển thị thu gọn tương tự.
 *    Cấu trúc dữ liệu lưu trên Drive KHÔNG đổi (regions: [{region, provinceCode,
 *    provinceName, branches[]}]) nên dữ liệu cũ dùng được ngay.
 * 2) IMPORT EXCEL CHẠY ĐƯỢC VỚI NHIỀU KIỂU TIÊU ĐỀ: trước đây tiêu đề cột phải
 *    khớp TUYỆT ĐỐI (đúng chữ hoa/thường, đúng dấu cách) và gặp ô dạng số là
 *    báo lỗi/bỏ qua im lặng. Giờ:
 *    - So khớp tiêu đề không phân biệt hoa/thường, dấu tiếng Việt, khoảng trắng,
 *      dấu "/" ("Mã Tỉnh/Thành", "ma tinh", "Tỉnh / Thành"... đều nhận).
 *    - Mọi ô được ép về chuỗi (SĐT/mã dạng số không gây lỗi).
 *    - Ô Khu vực / Mã tỉnh / Tên tỉnh để trống (ô gộp trong Excel) sẽ tự lấy giá
 *      trị của dòng phía trên.
 *    - Ô Chi nhánh cho phép nhiều chi nhánh cách nhau bằng dấu phẩy.
 *    - Import xong luôn hiện thông báo kết quả (thêm bao nhiêu, bỏ qua bao nhiêu,
 *      và nếu không nhận ra cột nào thì liệt kê các tiêu đề đọc được).
 * ============================================================================
 */

window.workflowSettings = {
    requestTypes: [], // { type: string, subTypes: string[] }
    regions: [],      // { region, provinceCode, provinceName, branches: string[] }
    resolutions: []   // { name }
};

// Trạng thái giao diện (không lưu lên Drive)
const wfUi = {
    openReg: new Set(),
    openReq: new Set(),
    filterReg: '',
    filterReq: ''
};

// ==================== TIỆN ÍCH ====================
function wfEsc(value) {
    return String(value == null ? '' : value).replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
}

// Chuẩn hoá để so khớp: bỏ dấu tiếng Việt, hạ chữ thường, bỏ mọi ký tự không phải chữ/số
function wfNorm(value) {
    return String(value == null ? '' : value)
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd').replace(/Đ/g, 'd')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
}

// Lấy giá trị 1 cột theo danh sách tên tiêu đề chấp nhận được (đã chuẩn hoá)
function wfPick(row, aliases) {
    const keys = Object.keys(row);
    for (const k of keys) {
        if (aliases.includes(wfNorm(k))) return String(row[k] == null ? '' : row[k]).trim();
    }
    return '';
}

function wfBindIfExists(id, eventName, handler) {
    const el = document.getElementById(id);
    if (el) el.addEventListener(eventName, handler);
}

function wfInjectStyle() {
    if (document.getElementById('wf-style')) return;
    const st = document.createElement('style');
    st.id = 'wf-style';
    st.textContent = `
#view-workflow_setting .workflow-tree { display:flex; flex-direction:column; gap:8px; }
#view-workflow_setting .wf-toolbar { display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-bottom:12px; }
#view-workflow_setting .wf-toolbar input { flex:1; min-width:180px; padding:8px 12px; border-radius:9px; border:1px solid var(--border-color); background:var(--bg-primary); color:var(--text-main); font-size:13px; outline:none; }
#view-workflow_setting .wf-toolbar input:focus { border-color: var(--accent); }
#view-workflow_setting .wf-acc { background: var(--bg-card); border:1px solid var(--border-color); border-radius:10px; overflow:hidden; }
#view-workflow_setting .wf-acc > summary { list-style:none; cursor:pointer; display:flex; align-items:center; gap:10px; padding:10px 14px; font-weight:600; font-size:13.5px; color:var(--text-main); user-select:none; }
#view-workflow_setting .wf-acc > summary::-webkit-details-marker { display:none; }
#view-workflow_setting .wf-acc > summary::after { content:'\\25BE'; margin-left:auto; color:var(--text-muted); transition:transform .15s; }
#view-workflow_setting .wf-acc:not([open]) > summary::after { transform:rotate(-90deg); }
#view-workflow_setting .wf-acc > summary:hover { background: var(--accent-glow); }
#view-workflow_setting .wf-count { font-weight:500; font-size:11.5px; color:var(--text-muted); background:var(--bg-primary); border:1px solid var(--border-color); padding:2px 8px; border-radius:999px; white-space:nowrap; }
#view-workflow_setting .wf-acc-body { padding:4px 14px 12px; border-top:1px solid var(--border-color); display:flex; flex-direction:column; gap:10px; }
#view-workflow_setting .wf-prov { padding-top:8px; }
#view-workflow_setting .wf-prov-head { display:flex; align-items:center; gap:8px; font-size:13px; color:var(--text-main); margin-bottom:6px; }
#view-workflow_setting .wf-prov-head b { color: var(--accent); }
#view-workflow_setting .wf-prov-head span { color: var(--text-muted); font-size:12px; }
#view-workflow_setting .wf-chips { display:flex; flex-wrap:wrap; gap:6px; padding-left:24px; }
#view-workflow_setting .wf-chip { display:inline-flex; align-items:center; gap:6px; font-size:12px; color:var(--text-main); background:var(--bg-primary); border:1px solid var(--border-color); border-radius:8px; padding:3px 9px; cursor:pointer; }
#view-workflow_setting .wf-chip:hover { border-color: var(--accent); }
#view-workflow_setting .wf-chip input { margin:0; }
#view-workflow_setting .wf-empty { color:var(--text-muted); font-size:12.5px; padding:14px; text-align:center; border:1px dashed var(--border-color); border-radius:10px; }
#view-workflow_setting .data-item { gap:10px; justify-content:flex-start; }
`;
    document.head.appendChild(st);
}

// Tạo thanh công cụ (tìm kiếm + mở/thu hết) phía trên danh sách, chỉ tạo 1 lần
function wfEnsureToolbar(listId, kind) {
    const list = document.getElementById(listId);
    if (!list || document.getElementById(`wf-toolbar-${kind}`)) return;
    const bar = document.createElement('div');
    bar.className = 'wf-toolbar';
    bar.id = `wf-toolbar-${kind}`;
    bar.innerHTML = `
        <input type="text" id="wf-search-${kind}" placeholder="Tìm kiếm nhanh...">
        <button type="button" class="btn-ghost" id="wf-expand-${kind}" style="padding:6px 12px;font-size:12px;">Mở hết</button>
        <button type="button" class="btn-ghost" id="wf-collapse-${kind}" style="padding:6px 12px;font-size:12px;">Thu hết</button>`;
    list.parentNode.insertBefore(bar, list);

    document.getElementById(`wf-search-${kind}`).addEventListener('input', (e) => {
        if (kind === 'reg') { wfUi.filterReg = wfNorm(e.target.value); renderRegions(); }
        else { wfUi.filterReq = wfNorm(e.target.value); renderRequestTypes(); }
    });
    document.getElementById(`wf-expand-${kind}`).addEventListener('click', () => {
        if (kind === 'reg') { window.workflowSettings.regions.forEach(r => wfUi.openReg.add(r.region)); renderRegions(); }
        else { window.workflowSettings.requestTypes.forEach(r => wfUi.openReq.add(r.type)); renderRequestTypes(); }
    });
    document.getElementById(`wf-collapse-${kind}`).addEventListener('click', () => {
        if (kind === 'reg') { wfUi.openReg.clear(); renderRegions(); }
        else { wfUi.openReq.clear(); renderRequestTypes(); }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    wfInjectStyle();
    wfEnsureToolbar('ws-req-type-list', 'req');
    wfEnsureToolbar('ws-region-list', 'reg');

    wfBindIfExists('btn-add-req-type', 'click', addRequestType);
    wfBindIfExists('btn-add-region', 'click', addRegion);
    wfBindIfExists('btn-add-resolution', 'click', addResolution);

    wfBindIfExists('btn-export-req', 'click', exportReqExcel);
    wfBindIfExists('import-req-excel', 'change', importReqExcel);

    wfBindIfExists('btn-export-region', 'click', exportRegionExcel);
    wfBindIfExists('import-region-excel', 'change', importRegionExcel);

    wfBindIfExists('btn-export-res', 'click', exportResExcel);
    wfBindIfExists('import-res-excel', 'change', importResExcel);

    wfBindIfExists('btn-del-selected-req', 'click', deleteSelectedReq);
    wfBindIfExists('btn-del-selected-region', 'click', deleteSelectedRegion);
    wfBindIfExists('btn-del-selected-res', 'click', deleteSelectedRes);

    renderWorkflowSettingsUI();
});

window.loadWorkflowSettingsFromDrive = async function () {
    if (!window.GPORTAL_FOLDERS || !AppState.isLoggedIn) return;
    try {
        const settingsData = await window.getJsonFromDrive('workflow_settings.json', window.GPORTAL_FOLDERS.settings);

        if (settingsData) {
            // Chuyển cấu trúc phẳng cũ (nếu có) sang cấu trúc cha-con
            let reqTypes = Array.isArray(settingsData.requestTypes) ? settingsData.requestTypes : [];
            if (reqTypes.length > 0 && typeof reqTypes[0].subType !== 'undefined') {
                const grouped = {};
                reqTypes.forEach(rt => {
                    if (!grouped[rt.type]) grouped[rt.type] = [];
                    grouped[rt.type].push(rt.subType);
                });
                reqTypes = Object.keys(grouped).map(k => ({ type: k, subTypes: grouped[k] }));
            }
            window.workflowSettings.requestTypes = reqTypes;

            let regs = Array.isArray(settingsData.regions) ? settingsData.regions : [];
            if (regs.length > 0 && typeof regs[0].branch !== 'undefined') {
                const grouped = {};
                regs.forEach(r => {
                    const k = `${r.region}|${r.provinceCode}|${r.provinceName}`;
                    if (!grouped[k]) grouped[k] = { region: r.region, provinceCode: r.provinceCode, provinceName: r.provinceName, branches: [] };
                    grouped[k].branches.push(r.branch);
                });
                regs = Object.values(grouped);
            }
            window.workflowSettings.regions = regs;

            window.workflowSettings.resolutions = Array.isArray(settingsData.resolutions) ? settingsData.resolutions : [];
        }

        renderWorkflowSettingsUI();
    } catch (err) {
        console.error('Lỗi khi tải workflow settings:', err);
    }
};

window.saveWorkflowSettingsToDrive = async function () {
    if (!window.GPORTAL_FOLDERS || typeof AppState === 'undefined' || !AppState.isLoggedIn) return;
    try {
        await window.saveJsonToDrive('workflow_settings.json', window.workflowSettings, window.GPORTAL_FOLDERS.settings);
    } catch (err) {
        console.error('Lỗi khi lưu workflow settings:', err);
    }
};

function renderWorkflowSettingsUI() {
    renderRequestTypes();
    renderRegions();
    renderResolutions();
}
window.renderWorkflowSettingsUI = renderWorkflowSettingsUI;

// ==================== CHECKBOX UTILS ====================
function toggleDelBtn(listId, btnId) {
    const list = document.getElementById(listId);
    const btn = document.getElementById(btnId);
    if (!list || !btn) return;
    const checked = list.querySelectorAll('.custom-chk:checked').length > 0;
    btn.style.display = checked ? 'inline-block' : 'none';
}

// Gắn hành vi chung cho 1 danh sách dạng thu gọn: nhớ trạng thái mở/đóng,
// chặn click checkbox làm đóng/mở khối, tick cha thì tick luôn con.
function wfWireList(listId, btnId, openSet, chkClass) {
    const list = document.getElementById(listId);
    if (!list) return;

    list.querySelectorAll('details.wf-acc').forEach(d => {
        d.addEventListener('toggle', () => {
            const key = d.dataset.key;
            if (d.open) openSet.add(key); else openSet.delete(key);
        });
    });

    list.querySelectorAll('summary, .wf-prov-head, .wf-chip').forEach(el => {
        el.querySelectorAll('input.custom-chk').forEach(chk => {
            chk.addEventListener('click', (e) => e.stopPropagation());
        });
    });
    // Nhãn của chip nằm trong summary? Không — nhưng summary chứa nhãn tiêu đề, để click chữ vẫn mở/đóng khối.

    list.querySelectorAll(`.${chkClass}`).forEach(chk => {
        chk.addEventListener('change', () => {
            const kind = chk.dataset.kind;
            if (kind === 'region' || kind === 'parent') {
                const box = chk.closest('details');
                if (box) box.querySelectorAll(`.${chkClass}`).forEach(c => { c.checked = chk.checked; });
            } else if (kind === 'prov') {
                const prov = chk.closest('.wf-prov');
                if (prov) prov.querySelectorAll(`.${chkClass}`).forEach(c => { c.checked = chk.checked; });
            }
            toggleDelBtn(listId, btnId);
        });
    });
    toggleDelBtn(listId, btnId);
}

// ==================== REQUEST TYPE (Loại RQL2 > Phân loại) ====================
function updateReqDatalist() {
    const dl = document.getElementById('rql2-parent-list');
    if (!dl) return;
    dl.innerHTML = '';
    window.workflowSettings.requestTypes.forEach(rt => {
        const op = document.createElement('option'); op.value = rt.type; dl.appendChild(op);
    });
}

function renderRequestTypes() {
    const list = document.getElementById('ws-req-type-list');
    if (!list) return;

    const q = wfUi.filterReq;
    const items = window.workflowSettings.requestTypes;
    let html = '';
    let shown = 0;

    items.forEach((item, pIndex) => {
        const subs = item.subTypes || [];
        const parentMatch = !q || wfNorm(item.type).includes(q);
        const visibleSubs = subs.map((s, c) => ({ s, c })).filter(x => parentMatch || wfNorm(x.s).includes(q));
        if (q && !parentMatch && visibleSubs.length === 0) return;
        shown++;

        const isOpen = q ? true : wfUi.openReq.has(item.type);
        const chips = visibleSubs.map(x => `
            <label class="wf-chip"><input type="checkbox" class="custom-chk req-chk" data-kind="child" data-p="${pIndex}" data-c="${x.c}">${wfEsc(x.s)}</label>`).join('');

        html += `
            <details class="wf-acc" data-key="${wfEsc(item.type)}" ${isOpen ? 'open' : ''}>
                <summary>
                    <input type="checkbox" class="custom-chk req-chk" data-kind="parent" data-p="${pIndex}" data-c="-1">
                    <span>${wfEsc(item.type)}</span>
                    <span class="wf-count">${subs.length} phân loại</span>
                </summary>
                <div class="wf-acc-body">
                    <div class="wf-chips" style="padding-left:0;">${chips || '<span style="color:var(--text-muted);font-size:12px;">Chưa có phân loại con</span>'}</div>
                </div>
            </details>`;
    });

    list.innerHTML = html || `<div class="wf-empty">${items.length ? 'Không tìm thấy kết quả phù hợp.' : 'Chưa có dữ liệu — hãy thêm mới hoặc Import từ Excel.'}</div>`;
    wfWireList('ws-req-type-list', 'btn-del-selected-req', wfUi.openReq, 'req-chk');
    updateReqDatalist();
}

function addRequestType() {
    const type = document.getElementById('ws-req-type-name').value.trim();
    const subType = document.getElementById('ws-sub-type-name').value.trim();
    if (!type) return alert('Vui lòng nhập Loại RQL2 (Mục cha)');

    let parentObj = window.workflowSettings.requestTypes.find(rt => rt.type.toLowerCase() === type.toLowerCase());
    if (!parentObj) {
        parentObj = { type: type, subTypes: [] };
        window.workflowSettings.requestTypes.push(parentObj);
    }

    if (subType) {
        subType.split(',').map(s => s.trim()).filter(s => s).forEach(s => {
            if (!parentObj.subTypes.find(x => x.toLowerCase() === s.toLowerCase())) parentObj.subTypes.push(s);
        });
    }

    wfUi.openReq.add(parentObj.type);
    document.getElementById('ws-req-type-name').value = '';
    document.getElementById('ws-sub-type-name').value = '';
    renderRequestTypes();
    window.saveWorkflowSettingsToDrive();
}

function deleteSelectedReq() {
    if (!confirm('Xóa các mục đã chọn?')) return;
    const delParents = new Set();
    const delChildren = new Map(); // p -> Set(c)

    document.querySelectorAll('#ws-req-type-list .req-chk:checked').forEach(chk => {
        const p = parseInt(chk.dataset.p, 10);
        const c = parseInt(chk.dataset.c, 10);
        if (c === -1) delParents.add(p);
        else {
            if (!delChildren.has(p)) delChildren.set(p, new Set());
            delChildren.get(p).add(c);
        }
    });

    const result = [];
    window.workflowSettings.requestTypes.forEach((item, p) => {
        if (delParents.has(p)) return;
        const cs = delChildren.get(p);
        if (cs) item.subTypes = item.subTypes.filter((_, c) => !cs.has(c));
        result.push(item);
    });
    window.workflowSettings.requestTypes = result;

    renderRequestTypes();
    window.saveWorkflowSettingsToDrive();
}

function exportReqExcel() {
    const data = [];
    window.workflowSettings.requestTypes.forEach(rt => {
        if (rt.subTypes.length === 0) data.push({ 'Loại RQL2': rt.type, 'Phân loại': '' });
        else rt.subTypes.forEach(st => data.push({ 'Loại RQL2': rt.type, 'Phân loại': st }));
    });
    if (data.length === 0) data.push({ 'Loại RQL2': 'Ví dụ: Khiếu nại', 'Phân loại': 'Ví dụ: Chất lượng dịch vụ' });
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "RequestType");
    XLSX.writeFile(wb, "RQL2_PhanLoai.xlsx");
}

function wfReadExcelFile(file, onRows, inputEl) {
    if (typeof XLSX === 'undefined') {
        alert('Thư viện đọc Excel (XLSX) chưa tải xong, vui lòng tải lại trang và thử lại.');
        if (inputEl) inputEl.value = '';
        return;
    }
    const reader = new FileReader();
    reader.onload = function (evt) {
        try {
            const wb = XLSX.read(new Uint8Array(evt.target.result), { type: 'array' });
            const ws = wb.Sheets[wb.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
            onRows(rows);
        } catch (err) {
            console.error('Lỗi đọc file Excel:', err);
            alert('Không đọc được file Excel: ' + err.message);
        } finally {
            if (inputEl) inputEl.value = '';
        }
    };
    reader.onerror = function () {
        alert('Không đọc được file. Vui lòng thử lại.');
        if (inputEl) inputEl.value = '';
    };
    reader.readAsArrayBuffer(file);
}

function importReqExcel(e) {
    const file = e.target.files[0];
    if (!file) return;
    wfReadExcelFile(file, (rows) => {
        const TYPE = ['loairql2', 'rql2', 'loai', 'loaiyeucau', 'type', 'requesttype'];
        const SUB = ['phanloai', 'phanloaicon', 'subtype', 'loaicon'];

        let lastType = '';
        let addedParents = 0, addedSubs = 0, skipped = 0;

        rows.forEach(row => {
            let type = wfPick(row, TYPE) || lastType;
            const sub = wfPick(row, SUB);
            if (!type) { skipped++; return; }
            lastType = type;

            let p = window.workflowSettings.requestTypes.find(rt => rt.type.toLowerCase() === type.toLowerCase());
            if (!p) { p = { type, subTypes: [] }; window.workflowSettings.requestTypes.push(p); addedParents++; }
            if (sub && !p.subTypes.find(s => s.toLowerCase() === sub.toLowerCase())) { p.subTypes.push(sub); addedSubs++; }
        });

        if (rows.length && addedParents === 0 && addedSubs === 0 && skipped === rows.length) {
            alert('Không nhận ra cột nào trong file. Các tiêu đề đọc được: ' + Object.keys(rows[0]).join(' | ') + '\nCần có cột "Loại RQL2" và "Phân loại".');
            return;
        }
        renderRequestTypes();
        window.saveWorkflowSettingsToDrive();
        alert(`Import xong: thêm ${addedParents} loại RQL2 mới, ${addedSubs} phân loại mới${skipped ? `, bỏ qua ${skipped} dòng thiếu dữ liệu` : ''}.`);
    }, e.target);
}

// ==================== REGIONS (Khu vực > Tỉnh/Thành > Chi nhánh) ====================
function updateRegionDatalist() {
    const dl = document.getElementById('region-parent-list');
    if (!dl) return;
    dl.innerHTML = '';
    [...new Set(window.workflowSettings.regions.map(r => r.region))].forEach(r => {
        const op = document.createElement('option'); op.value = r; dl.appendChild(op);
    });
}

function renderRegions() {
    const list = document.getElementById('ws-region-list');
    if (!list) return;

    const q = wfUi.filterReg;

    // Gom theo Khu vực (giữ thứ tự xuất hiện đầu tiên)
    const groups = new Map();
    window.workflowSettings.regions.forEach((item, idx) => {
        if (!groups.has(item.region)) groups.set(item.region, []);
        groups.get(item.region).push({ item, idx });
    });

    let html = '';
    groups.forEach((entries, regionName) => {
        const regionMatch = !q || wfNorm(regionName).includes(q);

        // Lọc theo từ khoá: tỉnh khớp (mã/tên) hoặc chi nhánh khớp
        const shownProvs = entries.map(({ item, idx }) => {
            const provMatch = regionMatch || wfNorm(item.provinceCode).includes(q) || wfNorm(item.provinceName).includes(q);
            const branches = (item.branches || []).map((b, c) => ({ b, c }))
                .filter(x => provMatch || wfNorm(x.b).includes(q));
            return { item, idx, provMatch, branches };
        }).filter(x => !q || x.provMatch || x.branches.length > 0);

        if (q && shownProvs.length === 0) return;

        const totalBranches = entries.reduce((s, e) => s + (e.item.branches || []).length, 0);
        const isOpen = q ? true : wfUi.openReg.has(regionName);

        const provHtml = shownProvs.map(({ item, idx, branches }) => `
            <div class="wf-prov">
                <div class="wf-prov-head">
                    <input type="checkbox" class="custom-chk reg-chk" data-kind="prov" data-p="${idx}" data-c="-1">
                    <b>${wfEsc(item.provinceCode)}</b><span>${wfEsc(item.provinceName)} · ${(item.branches || []).length} chi nhánh</span>
                </div>
                <div class="wf-chips">
                    ${branches.map(x => `<label class="wf-chip"><input type="checkbox" class="custom-chk reg-chk" data-kind="branch" data-p="${idx}" data-c="${x.c}">${wfEsc(x.b)}</label>`).join('') || '<span style="color:var(--text-muted);font-size:12px;">Chưa có chi nhánh</span>'}
                </div>
            </div>`).join('');

        html += `
            <details class="wf-acc" data-key="${wfEsc(regionName)}" ${isOpen ? 'open' : ''}>
                <summary>
                    <input type="checkbox" class="custom-chk reg-chk" data-kind="region" data-region="${wfEsc(regionName)}">
                    <span>${wfEsc(regionName)}</span>
                    <span class="wf-count">${entries.length} tỉnh · ${totalBranches} chi nhánh</span>
                </summary>
                <div class="wf-acc-body">${provHtml}</div>
            </details>`;
    });

    list.innerHTML = html || `<div class="wf-empty">${window.workflowSettings.regions.length ? 'Không tìm thấy kết quả phù hợp.' : 'Chưa có dữ liệu — hãy thêm mới hoặc Import từ Excel.'}</div>`;
    wfWireList('ws-region-list', 'btn-del-selected-region', wfUi.openReg, 'reg-chk');
    updateRegionDatalist();
}

function addRegion() {
    const region = document.getElementById('ws-region-name').value.trim();
    const pCode = document.getElementById('ws-province-code').value.trim();
    const pName = document.getElementById('ws-province-name').value.trim();
    const branchInput = document.getElementById('ws-branch-name').value.trim();

    if (!region || !pCode || !pName) return alert('Vui lòng nhập Khu vực, Mã Tỉnh, Tỉnh/Thành');

    let pObj = window.workflowSettings.regions.find(r => r.provinceCode.toLowerCase() === pCode.toLowerCase());
    if (!pObj) {
        pObj = { region, provinceCode: pCode, provinceName: pName, branches: [] };
        window.workflowSettings.regions.push(pObj);
    }

    if (branchInput) {
        branchInput.split(',').map(s => s.trim()).filter(s => s).forEach(b => {
            if (!pObj.branches.find(x => x.toLowerCase() === b.toLowerCase())) pObj.branches.push(b);
        });
    }

    wfUi.openReg.add(pObj.region);
    ['ws-region-name', 'ws-province-code', 'ws-province-name', 'ws-branch-name'].forEach(id => { document.getElementById(id).value = ''; });
    renderRegions();
    window.saveWorkflowSettingsToDrive();
}

function deleteSelectedRegion() {
    if (!confirm('Xóa các mục đã chọn?')) return;
    const delRegions = new Set();
    const delProvs = new Set();
    const delBranches = new Map(); // idx -> Set(c)

    document.querySelectorAll('#ws-region-list .reg-chk:checked').forEach(chk => {
        const kind = chk.dataset.kind;
        if (kind === 'region') { delRegions.add(chk.dataset.region); return; }
        const p = parseInt(chk.dataset.p, 10);
        if (kind === 'prov') { delProvs.add(p); return; }
        if (kind === 'branch') {
            if (!delBranches.has(p)) delBranches.set(p, new Set());
            delBranches.get(p).add(parseInt(chk.dataset.c, 10));
        }
    });

    const result = [];
    window.workflowSettings.regions.forEach((item, idx) => {
        if (delRegions.has(item.region) || delProvs.has(idx)) return;
        const cs = delBranches.get(idx);
        if (cs) item.branches = item.branches.filter((_, c) => !cs.has(c));
        result.push(item);
    });
    window.workflowSettings.regions = result;

    renderRegions();
    window.saveWorkflowSettingsToDrive();
}

function exportRegionExcel() {
    const data = [];
    window.workflowSettings.regions.forEach(r => {
        if (r.branches.length === 0) data.push({ 'Khu Vực': r.region, 'Mã Tỉnh/Thành': r.provinceCode, 'Tỉnh / Thành': r.provinceName, 'Chi Nhánh': '' });
        else r.branches.forEach(b => data.push({ 'Khu Vực': r.region, 'Mã Tỉnh/Thành': r.provinceCode, 'Tỉnh / Thành': r.provinceName, 'Chi Nhánh': b }));
    });
    if (data.length === 0) data.push({ 'Khu Vực': '01.Thập Đại Đô Thị', 'Mã Tỉnh/Thành': 'HN', 'Tỉnh / Thành': '01.Hà Nội', 'Chi Nhánh': 'HNI_01' });
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Regions");
    XLSX.writeFile(wb, "DuLieuVungMien.xlsx");
}

function importRegionExcel(e) {
    const file = e.target.files[0];
    if (!file) return;
    wfReadExcelFile(file, (rows) => {
        const REGION = ['khuvuc', 'vungmien', 'vung', 'region'];
        const PCODE = ['matinh', 'matinhthanh', 'matp', 'mat', 'provincecode', 'code'];
        const PNAME = ['tinhthanh', 'tinh', 'tentinh', 'tentinhthanh', 'tinhthanhpho', 'provincename', 'province'];
        const BRANCH = ['chinhanh', 'tenchinhanh', 'branch', 'cn'];

        let lastRegion = '', lastCode = '', lastName = '';
        let addedProvs = 0, addedBranches = 0, skipped = 0;

        rows.forEach(row => {
            const region = wfPick(row, REGION) || lastRegion;
            const pCode = wfPick(row, PCODE) || lastCode;
            const pName = wfPick(row, PNAME) || lastName;
            const branchRaw = wfPick(row, BRANCH);

            if (!region || !pCode || !pName) { skipped++; return; }
            lastRegion = region; lastCode = pCode; lastName = pName;

            let pObj = window.workflowSettings.regions.find(r => r.provinceCode.toLowerCase() === pCode.toLowerCase());
            if (!pObj) {
                pObj = { region, provinceCode: pCode, provinceName: pName, branches: [] };
                window.workflowSettings.regions.push(pObj);
                addedProvs++;
            }
            if (branchRaw) {
                branchRaw.split(',').map(s => s.trim()).filter(Boolean).forEach(b => {
                    if (!pObj.branches.find(x => x.toLowerCase() === b.toLowerCase())) { pObj.branches.push(b); addedBranches++; }
                });
            }
        });

        if (rows.length === 0) {
            alert('File Excel không có dòng dữ liệu nào (kiểm tra lại sheet đầu tiên).');
            return;
        }
        if (addedProvs === 0 && addedBranches === 0 && skipped === rows.length) {
            alert('Không nhận ra cột nào trong file. Các tiêu đề đọc được: ' + Object.keys(rows[0]).join(' | ') + '\nCần có các cột: Khu Vực, Mã Tỉnh/Thành, Tỉnh / Thành, Chi Nhánh.');
            return;
        }

        renderRegions();
        window.saveWorkflowSettingsToDrive();
        alert(`Import xong: thêm ${addedProvs} tỉnh/thành mới, ${addedBranches} chi nhánh mới${skipped ? `, bỏ qua ${skipped} dòng thiếu Khu vực/Mã tỉnh/Tên tỉnh` : ''}.`);
    }, e.target);
}

// ==================== RESOLUTION ====================
function renderResolutions() {
    const list = document.getElementById('ws-resolution-list');
    if (!list) return;
    list.innerHTML = '';
    if (!window.workflowSettings.resolutions.length) {
        list.innerHTML = '<li class="wf-empty">Chưa có phương án — hãy thêm mới hoặc Import từ Excel.</li>';
    }
    window.workflowSettings.resolutions.forEach((item, index) => {
        const li = document.createElement('li');
        li.className = 'data-item';
        li.innerHTML = `
            <input type="checkbox" class="custom-chk res-chk" data-idx="${index}">
            <span style="flex:1;"><strong>${wfEsc(item.name)}</strong></span>`;
        list.appendChild(li);
    });
    list.querySelectorAll('.res-chk').forEach(chk => {
        chk.addEventListener('change', () => toggleDelBtn('ws-resolution-list', 'btn-del-selected-res'));
    });
    toggleDelBtn('ws-resolution-list', 'btn-del-selected-res');
}

function addResolution() {
    const name = document.getElementById('ws-resolution-name').value.trim();
    if (!name) return alert('Vui lòng nhập tên Phương án');
    if (!window.workflowSettings.resolutions.find(r => r.name.toLowerCase() === name.toLowerCase())) {
        window.workflowSettings.resolutions.push({ name });
    }
    document.getElementById('ws-resolution-name').value = '';
    renderResolutions();
    window.saveWorkflowSettingsToDrive();
}

function deleteSelectedRes() {
    if (!confirm('Xóa các phương án đã chọn?')) return;
    const del = new Set(Array.from(document.querySelectorAll('#ws-resolution-list .res-chk:checked')).map(c => parseInt(c.dataset.idx, 10)));
    window.workflowSettings.resolutions = window.workflowSettings.resolutions.filter((_, i) => !del.has(i));
    renderResolutions();
    window.saveWorkflowSettingsToDrive();
}

function exportResExcel() {
    const data = window.workflowSettings.resolutions.map(item => ({ 'Phương án': item.name }));
    if (data.length === 0) data.push({ 'Phương án': 'Ví dụ: Hướng dẫn khách hàng' });
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Resolutions");
    XLSX.writeFile(wb, "PhuongAn.xlsx");
}

function importResExcel(e) {
    const file = e.target.files[0];
    if (!file) return;
    wfReadExcelFile(file, (rows) => {
        const NAME = ['phuongan', 'tenphuongan', 'resolution', 'ten'];
        let added = 0;
        rows.forEach(row => {
            const name = wfPick(row, NAME);
            if (name && !window.workflowSettings.resolutions.find(r => r.name.toLowerCase() === name.toLowerCase())) {
                window.workflowSettings.resolutions.push({ name });
                added++;
            }
        });
        if (rows.length && added === 0 && !rows.some(r => wfPick(r, NAME))) {
            alert('Không nhận ra cột nào trong file. Các tiêu đề đọc được: ' + Object.keys(rows[0]).join(' | ') + '\nCần có cột "Phương án".');
            return;
        }
        renderResolutions();
        window.saveWorkflowSettingsToDrive();
        alert(`Import xong: thêm ${added} phương án mới.`);
    }, e.target);
}

/**
 * workflow-setting.js - Workflow Settings Module
 * Quản lý: Phân loại RQL2, Vùng miền, Phương án (dành cho module Giám Sát, Complaint)
 */

window.workflowSettings = {
    requestTypes: [], // { type: string, subTypes: string[] }
    regions: [],      // { region, provinceCode, provinceName, branches: string[] }
    resolutions: []   // { name }
};

document.addEventListener('DOMContentLoaded', () => {
    // Buttons Add
    bindIfExists('btn-add-req-type', 'click', addRequestType);
    bindIfExists('btn-add-region', 'click', addRegion);
    bindIfExists('btn-add-resolution', 'click', addResolution);

    // Import/Export
    bindIfExists('btn-export-req', 'click', exportReqExcel);
    bindIfExists('import-req-excel', 'change', importReqExcel);
    
    bindIfExists('btn-export-region', 'click', exportRegionExcel);
    bindIfExists('import-region-excel', 'change', importRegionExcel);
    
    bindIfExists('btn-export-res', 'click', exportResExcel);
    bindIfExists('import-res-excel', 'change', importResExcel);

    // Delete Selected
    bindIfExists('btn-del-selected-req', 'click', deleteSelectedReq);
    bindIfExists('btn-del-selected-region', 'click', deleteSelectedRegion);
    bindIfExists('btn-del-selected-res', 'click', deleteSelectedRes);
});

function bindIfExists(id, eventName, handler) {
    const el = document.getElementById(id);
    if (el) el.addEventListener(eventName, handler);
}

window.loadWorkflowSettingsFromDrive = async function() {
    if (!window.GPORTAL_FOLDERS || !AppState.isLoggedIn) return;
    try {
        const settingsData = await window.getJsonFromDrive('workflow_settings.json', window.GPORTAL_FOLDERS.settings);
        
        if (settingsData) {
            // Migrate old flat structure if needed
            let reqTypes = Array.isArray(settingsData.requestTypes) ? settingsData.requestTypes : [];
            if (reqTypes.length > 0 && typeof reqTypes[0].subType !== 'undefined') {
                // old format
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
                // old format
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

window.saveWorkflowSettingsToDrive = async function() {
    if (!window.GPORTAL_FOLDERS || !AppState.isLoggedIn) return;
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

// ==================== CHECKBOX UTILS ====================
function toggleDelBtn(listId, btnId) {
    const list = document.getElementById(listId);
    const btn = document.getElementById(btnId);
    if (!list || !btn) return;
    const checked = list.querySelectorAll('.custom-chk:checked').length > 0;
    btn.style.display = checked ? 'inline-block' : 'none';
}

// ==================== REQUEST TYPE ====================
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
    list.innerHTML = '';
    
    window.workflowSettings.requestTypes.forEach((item, pIndex) => {
        const node = document.createElement('div');
        node.className = 'wf-parent-node';
        
        let childHtml = '';
        item.subTypes.forEach((st, cIndex) => {
            childHtml += `
                <div class="wf-child-item">
                    <input type="checkbox" class="custom-chk req-chk" data-p="${pIndex}" data-c="${cIndex}">
                    <span>${st}</span>
                </div>
            `;
        });

        node.innerHTML = `
            <div class="wf-parent-header">
                <input type="checkbox" class="custom-chk req-chk" data-p="${pIndex}" data-c="-1">
                ${item.type}
            </div>
            <div class="wf-child-list">${childHtml}</div>
        `;
        list.appendChild(node);
    });

    list.querySelectorAll('.req-chk').forEach(chk => {
        chk.addEventListener('change', () => toggleDelBtn('ws-req-type-list', 'btn-del-selected-req'));
    });
    toggleDelBtn('ws-req-type-list', 'btn-del-selected-req');
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
        const subs = subType.split(',').map(s => s.trim()).filter(s => s);
        subs.forEach(s => {
            if (!parentObj.subTypes.find(x => x.toLowerCase() === s.toLowerCase())) {
                parentObj.subTypes.push(s);
            }
        });
    }
    
    document.getElementById('ws-req-type-name').value = '';
    document.getElementById('ws-sub-type-name').value = '';
    renderRequestTypes();
    window.saveWorkflowSettingsToDrive();
}

function deleteSelectedReq() {
    if (!confirm('Xóa các mục đã chọn?')) return;
    const chks = Array.from(document.querySelectorAll('#ws-req-type-list .req-chk:checked'));
    
    // Sort descending so splicing doesn't mess up indices
    chks.sort((a, b) => {
        if (a.dataset.p !== b.dataset.p) return b.dataset.p - a.dataset.p;
        return b.dataset.c - a.dataset.c;
    });

    chks.forEach(chk => {
        const p = parseInt(chk.dataset.p);
        const c = parseInt(chk.dataset.c);
        if (c === -1) {
            window.workflowSettings.requestTypes.splice(p, 1);
        } else {
            if (window.workflowSettings.requestTypes[p]) {
                window.workflowSettings.requestTypes[p].subTypes.splice(c, 1);
                // If empty, maybe leave it or delete parent? Let's leave parent.
            }
        }
    });

    renderRequestTypes();
    window.saveWorkflowSettingsToDrive();
}

function exportReqExcel() {
    const data = [];
    window.workflowSettings.requestTypes.forEach(rt => {
        if (rt.subTypes.length === 0) data.push({ 'Loại RQL2': rt.type, 'Phân loại': '' });
        else rt.subTypes.forEach(st => data.push({ 'Loại RQL2': rt.type, 'Phân loại': st }));
    });
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "RequestType");
    XLSX.writeFile(wb, "RQL2_PhanLoai.xlsx");
}

function importReqExcel(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(evt) {
        try {
            const data = new Uint8Array(evt.target.result);
            const wb = XLSX.read(data, {type: 'array'});
            const ws = wb.Sheets[wb.SheetNames[0]];
            const jsonData = XLSX.utils.sheet_to_json(ws);
            
            jsonData.forEach(row => {
                const type = (row['Loại RQL2'] || '').trim();
                const subType = (row['Phân loại'] || '').trim();
                if (type) {
                    let p = window.workflowSettings.requestTypes.find(rt => rt.type.toLowerCase() === type.toLowerCase());
                    if (!p) { p = { type: type, subTypes: [] }; window.workflowSettings.requestTypes.push(p); }
                    if (subType && !p.subTypes.find(s => s.toLowerCase() === subType.toLowerCase())) {
                        p.subTypes.push(subType);
                    }
                }
            });
            renderRequestTypes();
            window.saveWorkflowSettingsToDrive();
        } catch(err) { alert('Lỗi file Excel: ' + err.message); }
        e.target.value = '';
    };
    reader.readAsArrayBuffer(file);
}


// ==================== REGIONS ====================
function updateRegionDatalist() {
    const dl = document.getElementById('region-parent-list');
    if (!dl) return;
    dl.innerHTML = '';
    const uniqueRegions = [...new Set(window.workflowSettings.regions.map(r => r.region))];
    uniqueRegions.forEach(r => {
        const op = document.createElement('option'); op.value = r; dl.appendChild(op);
    });
}

function renderRegions() {
    const list = document.getElementById('ws-region-list');
    if (!list) return;
    list.innerHTML = '';
    
    window.workflowSettings.regions.forEach((item, pIndex) => {
        const node = document.createElement('div');
        node.className = 'wf-parent-node';
        
        let childHtml = '';
        item.branches.forEach((b, cIndex) => {
            childHtml += `
                <div class="wf-child-item">
                    <input type="checkbox" class="custom-chk reg-chk" data-p="${pIndex}" data-c="${cIndex}">
                    <span>${b}</span>
                </div>
            `;
        });

        node.innerHTML = `
            <div class="wf-parent-header">
                <input type="checkbox" class="custom-chk reg-chk" data-p="${pIndex}" data-c="-1">
                ${item.region} &nbsp;<span style="font-weight:normal; font-size:12px; color:var(--text-muted)">(${item.provinceCode} - ${item.provinceName})</span>
            </div>
            <div class="wf-child-list">${childHtml}</div>
        `;
        list.appendChild(node);
    });

    list.querySelectorAll('.reg-chk').forEach(chk => {
        chk.addEventListener('change', () => toggleDelBtn('ws-region-list', 'btn-del-selected-region'));
    });
    toggleDelBtn('ws-region-list', 'btn-del-selected-region');
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
        const branches = branchInput.split(',').map(s => s.trim()).filter(s => s);
        branches.forEach(b => {
            if (!pObj.branches.find(x => x.toLowerCase() === b.toLowerCase())) {
                pObj.branches.push(b);
            }
        });
    }
    
    document.getElementById('ws-region-name').value = '';
    document.getElementById('ws-province-code').value = '';
    document.getElementById('ws-province-name').value = '';
    document.getElementById('ws-branch-name').value = '';
    renderRegions();
    window.saveWorkflowSettingsToDrive();
}

function deleteSelectedRegion() {
    if (!confirm('Xóa các mục đã chọn?')) return;
    const chks = Array.from(document.querySelectorAll('#ws-region-list .reg-chk:checked'));
    
    chks.sort((a, b) => {
        if (a.dataset.p !== b.dataset.p) return b.dataset.p - a.dataset.p;
        return b.dataset.c - a.dataset.c;
    });

    chks.forEach(chk => {
        const p = parseInt(chk.dataset.p);
        const c = parseInt(chk.dataset.c);
        if (c === -1) {
            window.workflowSettings.regions.splice(p, 1);
        } else {
            if (window.workflowSettings.regions[p]) {
                window.workflowSettings.regions[p].branches.splice(c, 1);
            }
        }
    });

    renderRegions();
    window.saveWorkflowSettingsToDrive();
}

function exportRegionExcel() {
    const data = [];
    window.workflowSettings.regions.forEach(r => {
        if (r.branches.length === 0) data.push({ 'Khu Vực': r.region, 'Mã Tỉnh/Thành': r.provinceCode, 'Tỉnh / Thành': r.provinceName, 'Chi Nhánh': '' });
        else r.branches.forEach(b => data.push({ 'Khu Vực': r.region, 'Mã Tỉnh/Thành': r.provinceCode, 'Tỉnh / Thành': r.provinceName, 'Chi Nhánh': b }));
    });
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Regions");
    XLSX.writeFile(wb, "DuLieuVungMien.xlsx");
}

function importRegionExcel(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(evt) {
        try {
            const data = new Uint8Array(evt.target.result);
            const wb = XLSX.read(data, {type: 'array'});
            const ws = wb.Sheets[wb.SheetNames[0]];
            const jsonData = XLSX.utils.sheet_to_json(ws);
            
            jsonData.forEach(row => {
                const reg = (row['Khu Vực'] || '').trim();
                const pCode = (row['Mã Tỉnh/Thành'] || '').trim();
                const pName = (row['Tỉnh / Thành'] || '').trim();
                const branch = (row['Chi Nhánh'] || '').trim();
                
                if (reg && pCode && pName) {
                    let pObj = window.workflowSettings.regions.find(r => r.provinceCode.toLowerCase() === pCode.toLowerCase());
                    if (!pObj) { pObj = { region: reg, provinceCode: pCode, provinceName: pName, branches: [] }; window.workflowSettings.regions.push(pObj); }
                    if (branch && !pObj.branches.find(b => b.toLowerCase() === branch.toLowerCase())) {
                        pObj.branches.push(branch);
                    }
                }
            });
            renderRegions();
            window.saveWorkflowSettingsToDrive();
        } catch(err) { alert('Lỗi file Excel: ' + err.message); }
        e.target.value = '';
    };
    reader.readAsArrayBuffer(file);
}


// ==================== RESOLUTION ====================
function renderResolutions() {
    const list = document.getElementById('ws-resolution-list');
    if (!list) return;
    list.innerHTML = '';
    window.workflowSettings.resolutions.forEach((item, index) => {
        const li = document.createElement('li');
        li.innerHTML = `
            <div><input type="checkbox" class="custom-chk res-chk" data-idx="${index}"></div>
            <div style="flex:1;"><strong>${item.name}</strong></div>
        `;
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
    const chks = Array.from(document.querySelectorAll('#ws-resolution-list .res-chk:checked'));
    chks.sort((a,b) => b.dataset.idx - a.dataset.idx);
    chks.forEach(chk => {
        window.workflowSettings.resolutions.splice(parseInt(chk.dataset.idx), 1);
    });
    renderResolutions();
    window.saveWorkflowSettingsToDrive();
}

function exportResExcel() {
    const data = window.workflowSettings.resolutions.map(item => ({ 'Phương án': item.name }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Resolutions");
    XLSX.writeFile(wb, "PhuongAn.xlsx");
}

function importResExcel(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(evt) {
        try {
            const data = new Uint8Array(evt.target.result);
            const wb = XLSX.read(data, {type: 'array'});
            const ws = wb.Sheets[wb.SheetNames[0]];
            const jsonData = XLSX.utils.sheet_to_json(ws);
            
            jsonData.forEach(row => {
                const name = (row['Phương án'] || '').trim();
                if (name && !window.workflowSettings.resolutions.find(r => r.name.toLowerCase() === name.toLowerCase())) {
                    window.workflowSettings.resolutions.push({ name });
                }
            });
            renderResolutions();
            window.saveWorkflowSettingsToDrive();
        } catch(err) { alert('Lỗi file Excel: ' + err.message); }
        e.target.value = '';
    };
    reader.readAsArrayBuffer(file);
}

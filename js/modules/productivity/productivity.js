window.monthlyProductivityData = window.monthlyProductivityData || {};

document.addEventListener('DOMContentLoaded', () => {
    try { initProductivityEvents(); } catch (e) { console.error('initProductivityEvents error:', e); }
});

function initProductivityEvents() {
    const dateInput = document.getElementById('prod-date');

    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    dateInput.value = `${yyyy}-${mm}-${dd}`;

    dateInput.addEventListener('change', loadProductivityForDate);

    const inputs = document.querySelectorAll('.prod-input');
    inputs.forEach(input => {
        input.addEventListener('input', calculateTotal);
    });

    document.getElementById('btn-save-prod').addEventListener('click', saveProductivity);

    loadProductivityForDate();
}

window.loadProductivityFromDrive = async function () {
    if (!window.GPORTAL_FOLDERS) return;
    const dateInput = document.getElementById('prod-date').value;
    if (!dateInput) return;

    const [year, month, _] = dateInput.split('-');
    const fileName = `productivity_${year}_${month}.json`;

    const data = await getJsonFromDrive(fileName, window.GPORTAL_FOLDERS.productivity);
    if (data) {
        window.monthlyProductivityData = data;
    } else {
        window.monthlyProductivityData = {};
    }

    loadProductivityForDate();
}

function loadProductivityForDate() {
    const dateKey = document.getElementById('prod-date').value;
    if (!dateKey) return;

    const scheduleData = window.monthlyScheduleData || {};

    let shiftInfo = 'OFF';
    let taskInfo = '--';
    let shiftColor = 'var(--text-muted)';

    if (scheduleData[dateKey]) {
        const dayData = scheduleData[dateKey];
        shiftInfo = dayData.shift || 'OFF';
        taskInfo = dayData.task || '--';

        if (shiftInfo !== 'OFF' && window.portalSettings && window.portalSettings.shifts) {
            const shiftConf = window.portalSettings.shifts.find(s => s.code === shiftInfo);
            if (shiftConf) shiftColor = shiftConf.color;
        }
    }

    document.getElementById('prod-shift-tag').innerText = `Ca: ${shiftInfo}`;
    document.getElementById('prod-shift-tag').style.background = shiftColor;
    document.getElementById('prod-task-tag').innerHTML = `<i class='bx bx-check-square'></i> PCCV: ${taskInfo}`;

    const prodData = window.monthlyProductivityData[dateKey] || {
        inbound: 0, busy: 0, hifpt: 0, online: 0, saInfo: 0, saTech: 0, timeLate: '', timeEarly: ''
    };

    document.getElementById('call-inbound').value = prodData.inbound || 0;
    document.getElementById('call-busy').value = prodData.busy || 0;
    document.getElementById('call-hifpt').value = prodData.hifpt || 0;
    document.getElementById('call-online').value = prodData.online || 0;
    document.getElementById('call-sa-info').value = prodData.saInfo || 0;
    document.getElementById('call-sa-tech').value = prodData.saTech || 0;
    document.getElementById('time-late').value = prodData.timeLate || '';
    document.getElementById('time-early').value = prodData.timeEarly || '';

    calculateTotal();
}

function calculateTotal() {
    const inbound = parseInt(document.getElementById('call-inbound').value) || 0;
    const busy = parseInt(document.getElementById('call-busy').value) || 0;
    const hifpt = parseInt(document.getElementById('call-hifpt').value) || 0;
    const online = parseInt(document.getElementById('call-online').value) || 0;
    const saInfo = parseInt(document.getElementById('call-sa-info').value) || 0;
    const saTech = parseInt(document.getElementById('call-sa-tech').value) || 0;

    let coeff = 3;
    if (window.portalSettings && window.portalSettings.coefficients) {
        coeff = window.portalSettings.coefficients.saModifier || 3;
    }

    const total = inbound + busy + hifpt + online + ((saInfo + saTech) * coeff);

    document.getElementById('prod-total').innerText = total;
}

async function saveProductivity() {
    const dateKey = document.getElementById('prod-date').value;
    if (!dateKey) return alert("Vui lòng chọn ngày!");

    const inbound = parseInt(document.getElementById('call-inbound').value) || 0;
    const busy = parseInt(document.getElementById('call-busy').value) || 0;
    const hifpt = parseInt(document.getElementById('call-hifpt').value) || 0;
    const online = parseInt(document.getElementById('call-online').value) || 0;
    const saInfo = parseInt(document.getElementById('call-sa-info').value) || 0;
    const saTech = parseInt(document.getElementById('call-sa-tech').value) || 0;
    const timeLate = document.getElementById('time-late').value.trim();
    const timeEarly = document.getElementById('time-early').value.trim();
    const total = parseInt(document.getElementById('prod-total').innerText) || 0;

    window.monthlyProductivityData[dateKey] = {
        inbound, busy, hifpt, online, saInfo, saTech, timeLate, timeEarly, total
    };

    if (typeof AppState !== 'undefined' && AppState.isLoggedIn && window.GPORTAL_FOLDERS) {
        const [year, month, _] = dateKey.split('-');
        const fileName = `productivity_${year}_${month}.json`;

        await saveJsonToDrive(fileName, window.monthlyProductivityData, window.GPORTAL_FOLDERS.productivity);
        alert("Đã lưu Năng suất thành công lên Google Drive!");
    } else {
        alert("Đã lưu tạm thời tại máy. Vui lòng đăng nhập Google để đồng bộ!");
    }

    if (typeof window.updateDashboard === 'function') window.updateDashboard();
}

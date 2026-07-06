window.monthlyProductivityData = {};

document.addEventListener('DOMContentLoaded', () => {
    initProductivityEvents();
});

function initProductivityEvents() {
    const dateInput = document.getElementById('prod-date');
    
    // Mặc định chọn ngày hôm nay
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    dateInput.value = `${yyyy}-${mm}-${dd}`;

    // Lắng nghe sự kiện thay đổi ngày
    dateInput.addEventListener('change', loadProductivityForDate);

    // Lắng nghe thay đổi dữ liệu để Tự động tính Tổng Cuộc Gọi
    const inputs = document.querySelectorAll('.prod-input');
    inputs.forEach(input => {
        input.addEventListener('input', calculateTotal);
    });

    // Nút Lưu
    document.getElementById('btn-save-prod').addEventListener('click', saveProductivity);
}

// Hàm này được gọi bởi googleSync.js sau khi đăng nhập thành công
window.loadProductivityFromDrive = async function() {
    if (!window.GPORTAL_FOLDERS) return;
    const dateInput = document.getElementById('prod-date').value;
    if(!dateInput) return;
    
    const [year, month, _] = dateInput.split('-');
    const fileName = `productivity_${year}_${month}.json`;
    
    // Tải dữ liệu năng suất của cả tháng đó về
    const data = await getJsonFromDrive(fileName, window.GPORTAL_FOLDERS.productivity);
    if (data) {
        window.monthlyProductivityData = data;
    } else {
        window.monthlyProductivityData = {};
    }
    
    // Hiển thị dữ liệu của ngày đang chọn
    loadProductivityForDate();
}

function loadProductivityForDate() {
    const dateKey = document.getElementById('prod-date').value; // Định dạng chuẩn YYYY-MM-DD
    if(!dateKey) return;

    // 1. Lấy thông tin Ca và PCCV từ module Lịch làm việc (monthlyScheduleData)
    const scheduleData = typeof monthlyScheduleData !== 'undefined' ? monthlyScheduleData : (window.monthlyScheduleData || {});
    
    let shiftInfo = 'OFF';
    let taskInfo = '--';
    let shiftColor = 'var(--text-muted)';
    
    if (scheduleData[dateKey]) {
        const dayData = scheduleData[dateKey];
        shiftInfo = dayData.shift || 'OFF';
        taskInfo = dayData.task || '--';
        
        if (shiftInfo !== 'OFF' && window.portalSettings && window.portalSettings.shifts) {
            const shiftConf = window.portalSettings.shifts.find(s => s.code === shiftInfo);
            if(shiftConf) shiftColor = shiftConf.color;
        }
    }

    // Hiển thị ra giao diện thẻ Tag
    document.getElementById('prod-shift-tag').innerText = `Ca: ${shiftInfo}`;
    document.getElementById('prod-shift-tag').style.background = shiftColor;
    document.getElementById('prod-task-tag').innerHTML = `<i class='bx bx-check-square'></i> PCCV: ${taskInfo}`;

    // 2. Lấy dữ liệu Năng suất đã lưu của ngày này (nếu có) đổ vào Form
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

    // Tự động tính toán lại tổng
    calculateTotal();
}

function calculateTotal() {
    const inbound = parseInt(document.getElementById('call-inbound').value) || 0;
    const busy = parseInt(document.getElementById('call-busy').value) || 0;
    const hifpt = parseInt(document.getElementById('call-hifpt').value) || 0;
    const online = parseInt(document.getElementById('call-online').value) || 0;
    const saInfo = parseInt(document.getElementById('call-sa-info').value) || 0;
    const saTech = parseInt(document.getElementById('call-sa-tech').value) || 0;

    // Lấy hệ số (Mặc định là 3 nếu chưa cài đặt)
    let coeff = 3; 
    if (window.portalSettings && window.portalSettings.coefficients) {
        coeff = window.portalSettings.coefficients.saModifier || 3;
    }

    // CÔNG THỨC: Tổng = Inbound + Busy + HiFPT + Online + ((SA_Thông_Tin + SA_Kỹ_Thuật) * Hệ Số)
    const total = inbound + busy + hifpt + online + ((saInfo + saTech) * coeff);
    
    document.getElementById('prod-total').innerText = total;
}

async function saveProductivity() {
    const dateKey = document.getElementById('prod-date').value;
    if(!dateKey) return alert("Vui lòng chọn ngày!");

    const inbound = parseInt(document.getElementById('call-inbound').value) || 0;
    const busy = parseInt(document.getElementById('call-busy').value) || 0;
    const hifpt = parseInt(document.getElementById('call-hifpt').value) || 0;
    const online = parseInt(document.getElementById('call-online').value) || 0;
    const saInfo = parseInt(document.getElementById('call-sa-info').value) || 0;
    const saTech = parseInt(document.getElementById('call-sa-tech').value) || 0;
    const timeLate = document.getElementById('time-late').value.trim();
    const timeEarly = document.getElementById('time-early').value.trim();
    const total = parseInt(document.getElementById('prod-total').innerText) || 0;

    // Lưu vào State
    window.monthlyProductivityData[dateKey] = {
        inbound, busy, hifpt, online, saInfo, saTech, timeLate, timeEarly, total
    };

    // Đẩy lên Google Drive ID chỉ định
    if (typeof AppState !== 'undefined' && AppState.isLoggedIn && window.GPORTAL_FOLDERS) {
        const [year, month, _] = dateKey.split('-');
        const fileName = `productivity_${year}_${month}.json`;
        
        await saveJsonToDrive(fileName, window.monthlyProductivityData, window.GPORTAL_FOLDERS.productivity);
        alert("Đã lưu Năng suất thành công lên Google Drive!");
    } else {
        alert("Đã lưu tạm thời tại máy. Vui lòng đăng nhập Google để đồng bộ!");
    }
}

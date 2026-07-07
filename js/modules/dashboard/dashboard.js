/**
 * dashboard.js - Dashboard Module
 *
 * FIX QUAN TRỌNG (so với bản cũ):
 * - Bản cũ dùng các ID không tồn tại trong index.html (vd: 'kpi-calls',
 *   'kpi-progress', 'kpi-percent') trong khi HTML thực tế dùng
 *   'kpi-calls-month', 'kpi-progress-month', 'kpi-percent-month'...
 *   -> document.getElementById(...) trả về null -> gán .innerText/.style
 *   trên null làm toàn bộ hàm updateDashboard() bị dừng giữa chừng bởi lỗi,
 *   khiến biểu đồ và các KPI phía sau không bao giờ được vẽ.
 * - Đã khớp lại đúng toàn bộ ID theo index.html, đồng thời bổ sung:
 *     + KPI Tuần (kpi-calls-week / kpi-progress-week / kpi-percent-week)
 *     + Tổng công tính lương (kpi-cong) = Ngày công + Ngày OT * hệ số quy đổi
 *       (lấy từ Cài đặt > coefficients.coeffOtCong)
 */

let dashboardChart = null;
let dashDate = new Date(); // Tháng đang xem trên Dashboard

document.addEventListener('DOMContentLoaded', () => {
    try {
        document.getElementById('btn-dash-prev').addEventListener('click', () => {
            dashDate.setMonth(dashDate.getMonth() - 1);
            syncDashboardData();
        });

        document.getElementById('btn-dash-next').addEventListener('click', () => {
            dashDate.setMonth(dashDate.getMonth() + 1);
            syncDashboardData();
        });

        document.getElementById('btn-dash-refresh').addEventListener('click', () => {
            syncDashboardData();
        });
    } catch (e) {
        console.error('Dashboard init error:', e);
    }
});

// Hàm gọi API tải lại dữ liệu Lịch và Năng suất theo tháng đang chọn trên Dashboard
async function syncDashboardData() {
    const year = dashDate.getFullYear();
    const month = (dashDate.getMonth() + 1).toString().padStart(2, '0');
    document.getElementById('dash-month-display').innerText = `Tháng ${month}/${year}`;

    if (typeof AppState !== 'undefined' && AppState.isLoggedIn && window.GPORTAL_FOLDERS) {
        // Tải song song 2 file của tháng tương ứng
        const [schData, prodData] = await Promise.all([
            getJsonFromDrive(`schedule_${year}_${month}.json`, window.GPORTAL_FOLDERS.shifts),
            getJsonFromDrive(`productivity_${year}_${month}.json`, window.GPORTAL_FOLDERS.productivity)
        ]);

        // Ghi đè vào biến toàn cục để module khác cũng nhận diện
        window.monthlyScheduleData = schData || {};
        window.monthlyProductivityData = prodData || {};
    }

    window.updateDashboard();
}

window.updateDashboard = function () {
    const year = dashDate.getFullYear();
    const month = dashDate.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    document.getElementById('dash-month-display').innerText = `Tháng ${(month + 1).toString().padStart(2, '0')}/${year}`;

    let totalCallsMonth = 0;
    let totalCallsWeek = 0;
    let workDays = 0;
    let otDays = 0;
    let totalLateSec = 0;
    let totalEarlySec = 0;

    const chartLabels = [];
    const chartData = [];

    const schData = window.monthlyScheduleData || {};
    const prodData = window.monthlyProductivityData || {};

    // Xác định khoảng ngày của "tuần này" (Chủ nhật -> Thứ 7, chứa ngày hôm nay thật)
    const today = new Date();
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - today.getDay()); // lùi về Chủ nhật
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    for (let day = 1; day <= daysInMonth; day++) {
        const dateKey = `${year}-${(month + 1).toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
        const dateObj = new Date(year, month, day);

        // Trục X của biểu đồ
        chartLabels.push(day.toString());

        // Thống kê Lịch
        if (schData[dateKey]) {
            if (schData[dateKey].shift !== 'OFF') workDays++;
            if (schData[dateKey].ot && schData[dateKey].ot.trim() !== '') otDays++;
        }

        // Thống kê Năng suất
        let dayTotal = 0;
        if (prodData[dateKey]) {
            dayTotal = prodData[dateKey].total || 0;
            totalCallsMonth += dayTotal;
            chartData.push(dayTotal);

            if (prodData[dateKey].timeLate) totalLateSec += timeStrToSeconds(prodData[dateKey].timeLate);
            if (prodData[dateKey].timeEarly) totalEarlySec += timeStrToSeconds(prodData[dateKey].timeEarly);
        } else {
            chartData.push(0);
        }

        // Cộng dồn cho KPI tuần nếu ngày này rơi vào tuần hiện tại
        if (dateObj >= weekStart && dateObj <= weekEnd) {
            totalCallsWeek += dayTotal;
        }
    }

    // Lấy các tham số từ Cài đặt
    let target = 2000;
    let coeffOtCong = 0.5;
    if (window.portalSettings && window.portalSettings.coefficients) {
        target = window.portalSettings.coefficients.kpiTarget || 2000;
        coeffOtCong = (window.portalSettings.coefficients.coeffOtCong ?? 0.5);
    }

    // 1. Render KPI Tháng
    let percentMonth = target > 0 ? ((totalCallsMonth / target) * 100).toFixed(1) : 0;
    if (percentMonth > 100) percentMonth = 100;

    setText('kpi-calls-month', `${totalCallsMonth} / ${target}`);
    setWidth('kpi-progress-month', `${percentMonth}%`);
    setText('kpi-percent-month', `Hoàn thành: ${percentMonth}%`);

    // 2. Render KPI Tuần (mục tiêu tuần ước tính = mục tiêu tháng / 4.33 tuần)
    const weekTarget = Math.round(target / 4.33) || 0;
    let percentWeek = weekTarget > 0 ? ((totalCallsWeek / weekTarget) * 100).toFixed(1) : 0;
    if (percentWeek > 100) percentWeek = 100;

    setText('kpi-calls-week', `${totalCallsWeek} / ${weekTarget}`);
    setWidth('kpi-progress-week', `${percentWeek}%`);
    setText('kpi-percent-week', `Hoàn thành: ${percentWeek}%`);

    // 3. Render Ngày công & Tổng công tính lương
    const tongCong = (workDays + otDays * coeffOtCong).toFixed(2);
    setText('kpi-workdays', `${workDays} Ngày`);
    setText('kpi-ot', `Tăng cường (OT): ${otDays} ngày`);
    setText('kpi-cong', `Tổng công tính lương: ${tongCong}`);

    // 4. Render Vi phạm
    setText('kpi-late', `Trễ: ${secondsToTimeStr(totalLateSec)}`);
    setText('kpi-early', `Về sớm: ${secondsToTimeStr(totalEarlySec)}`);

    // 5. Vẽ Biểu đồ
    drawProductivityChart(chartLabels, chartData);
}

function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.innerText = text;
}

function setWidth(id, width) {
    const el = document.getElementById(id);
    if (el) el.style.width = width;
}

function drawProductivityChart(labels, data) {
    const ctx = document.getElementById('productivity-chart');
    if (!ctx) return;

    if (dashboardChart) {
        dashboardChart.destroy();
    }

    // Lấy màu từ biến CSS (--accent) để biểu đồ đồng bộ với theme
    const rootStyles = getComputedStyle(document.documentElement);
    const accentColor = rootStyles.getPropertyValue('--accent').trim() || '#38bdf8';

    dashboardChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Tổng cuộc gọi',
                data: data,
                backgroundColor: accentColor,
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: { beginAtZero: true }
            }
        }
    });
}

// Helpers quy đổi thời gian hh:mm:ss
function timeStrToSeconds(str) {
    if (!str) return 0;
    const parts = str.split(':');
    if (parts.length !== 3) return 0;
    return (+parts[0]) * 3600 + (+parts[1]) * 60 + (+parts[2]);
}

function secondsToTimeStr(totalSeconds) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

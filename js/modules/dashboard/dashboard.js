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

    let totalCalls = 0;
    let workDays = 0;
    let otDays = 0;
    let totalLateSec = 0;
    let totalEarlySec = 0;

    const chartLabels = [];
    const chartData = [];

    const schData = window.monthlyScheduleData || {};
    const prodData = window.monthlyProductivityData || {};

    for (let day = 1; day <= daysInMonth; day++) {
        const dateKey = `${year}-${(month + 1).toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;

        // Trục X của biểu đồ
        chartLabels.push(day.toString());

        // Thống kê Lịch
        if (schData[dateKey]) {
            if (schData[dateKey].shift !== 'OFF') workDays++;
            if (schData[dateKey].ot && schData[dateKey].ot.trim() !== '') otDays++;
        }

        // Thống kê Năng suất
        if (prodData[dateKey]) {
            const dayTotal = prodData[dateKey].total || 0;
            totalCalls += dayTotal;
            chartData.push(dayTotal);

            if (prodData[dateKey].timeLate) totalLateSec += timeStrToSeconds(prodData[dateKey].timeLate);
            if (prodData[dateKey].timeEarly) totalEarlySec += timeStrToSeconds(prodData[dateKey].timeEarly);
        } else {
            chartData.push(0);
        }
    }

    // 1. Render KPI Mục Tiêu
    let target = 2000;
    if (window.portalSettings && window.portalSettings.coefficients && window.portalSettings.coefficients.kpiTarget) {
        target = window.portalSettings.coefficients.kpiTarget;
    }
    let percent = target > 0 ? ((totalCalls / target) * 100).toFixed(1) : 0;
    if (percent > 100) percent = 100; // Cap thanh Progress ở 100%

    document.getElementById('kpi-calls').innerText = `${totalCalls} / ${target}`;
    document.getElementById('kpi-progress').style.width = `${percent}%`;
    document.getElementById('kpi-percent').innerText = `Hoàn thành: ${percent}%`;

    // 2. Render Ngày công
    document.getElementById('kpi-workdays').innerText = `${workDays} Ngày`;
    document.getElementById('kpi-ot').innerText = `Tăng cường (OT): ${otDays} ngày`;

    // 3. Render Vi phạm
    document.getElementById('kpi-late').innerText = `Trễ: ${secondsToTimeStr(totalLateSec)}`;
    document.getElementById('kpi-early').innerText = `Về sớm: ${secondsToTimeStr(totalEarlySec)}`;

    // 4. Vẽ Biểu đồ
    drawProductivityChart(chartLabels, chartData);
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

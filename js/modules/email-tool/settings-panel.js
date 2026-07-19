/* =========================================================
   PANEL THỐNG KÊ & CẤU HÌNH VÙNG MIỀN - Module "Soạn Email"
   Đã gộp vào G-Portal — thay đổi so với bản gốc:
   - Bản gốc có 3 tab cấp TRANG riêng (Soạn Email / Thống kê / Cài đặt) với
     sidebar/login riêng. Giờ chỉ còn 2 tab CON nằm bên trong view "Soạn
     Email" của G-Portal: "Soạn Email" và "Thống kê sử dụng".
   - Phần "Cài đặt" (BCC mặc định + Email/Ký tự nhận diện Vùng miền) không
     còn là 1 tab riêng nữa — đã chuyển thẳng vào trang Cài Đặt chung
     (view-settings) của G-Portal, dùng lại đúng các ID input cũ
     (settingsBccEmail, settingsSouthEmail...) nên không cần sửa gì ở
     region-detector.js ngoài đổi tên hàm gọi lại (loadSettingsUI ->
     loadEmailSettingsUI) cho rõ nghĩa hơn giữa 2 module.
   - Thống kê tổng hợp TẤT CẢ nhân viên vẫn lấy từ Google Sheet qua API GET
     (STATS_API_URL_READ), y hệt bản gốc.
   ========================================================= */

const STATS_API_URL_READ = "https://script.google.com/macros/s/AKfycbzIGRhMMZ5KLjjNgkocTxX0CrEM2_zTipwK4LGQfJweaEsRejqOksxG3C8XfopB0gZ4/exec";

function initEmailSubTabs() {
    const btnCompose = document.getElementById("btnEmailComposeTab");
    const btnStats = document.getElementById("btnEmailStatsTab");

    if (btnCompose) btnCompose.addEventListener("click", () => switchEmailSubTab("main"));
    if (btnStats) {
        btnStats.addEventListener("click", () => {
            switchEmailSubTab("stats");
            renderTemplateStatistics();
        });
    }
}

function switchEmailSubTab(tabName) {
    document.querySelectorAll("#view-email .email-tab-content").forEach(tab => {
        tab.classList.remove("active");
        tab.style.display = "none";
    });
    document.querySelectorAll("#view-email .email-subtab-btn").forEach(btn => btn.classList.remove("active"));

    const activeTab = document.getElementById(tabName + "Tab");
    if (activeTab) {
        activeTab.classList.add("active");
        activeTab.style.display = "block";
    }
    const activeBtn = document.getElementById("btnEmail" + tabName.charAt(0).toUpperCase() + tabName.slice(1) + "Tab");
    if (activeBtn) activeBtn.classList.add("active");
}

// Được app.js gọi mỗi khi chuyển vào view "email" — nếu người dùng đang đứng
// ở tab Thống kê thì làm mới số liệu ngay, khỏi cần bấm lại.
window.refreshEmailStatsIfActive = function () {
    const statsTab = document.getElementById("statsTab");
    if (statsTab && statsTab.classList.contains("active") && typeof renderTemplateStatistics === "function") {
        renderTemplateStatistics();
    }
};

/* =========================================================
   CẤU HÌNH BCC MẶC ĐỊNH & VÙNG MIỀN (hiển thị trong trang Cài Đặt chung)
   ========================================================= */

function loadEmailSettingsUI() {
    if (typeof regionManager === "undefined") return;

    const southEmailInput = document.getElementById("settingsSouthEmail");
    const northEmailInput = document.getElementById("settingsNorthEmail");
    const bccEmailInput = document.getElementById("settingsBccEmail");
    const southPatterns = document.getElementById("settingsSouthPatterns");
    const northPatterns = document.getElementById("settingsNorthPatterns");

    if (southEmailInput) southEmailInput.value = regionManager.settings.southEmail || "";
    if (northEmailInput) northEmailInput.value = regionManager.settings.northEmail || "";
    if (bccEmailInput) bccEmailInput.value = regionManager.settings.defaultBccEmail || "";
    if (southPatterns) southPatterns.value = regionManager.getSouthPatterns ? regionManager.getSouthPatterns() : "";
    if (northPatterns) northPatterns.value = regionManager.getNorthPatterns ? regionManager.getNorthPatterns() : "";

    disableEmailSettingsEditing();
}
// Giữ tên hàm cũ làm alias, phòng khi có code khác còn gọi tên cũ.
window.loadEmailSettingsUI = loadEmailSettingsUI;
window.loadSettingsUI = loadEmailSettingsUI;

function disableEmailSettingsEditing() {
    const inputs = ["settingsSouthEmail", "settingsNorthEmail", "settingsBccEmail", "settingsSouthPatterns", "settingsNorthPatterns"];
    inputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.disabled = true;
    });

    const notice = document.getElementById("emailSettingsLockNotice");
    if (notice && !notice.dataset.filled) {
        notice.dataset.filled = "1";
        notice.innerHTML = `
            <div class="flex items-center gap-2 font-bold text-amber-950">
                <i class="fa-solid fa-user-shield text-base text-amber-600"></i>
                <span>THÔNG BÁO</span>
            </div>
            <p class="text-xs text-amber-800 leading-relaxed mt-1">
                Các ký tự nhận diện Vùng Miền và địa chỉ Email đã được <strong>khóa cố định cấu hình</strong> để đảm bảo gửi đúng nghiệp vụ.
            </p>
            <div class="mt-2 pt-2 border-t border-amber-200/60 text-xs font-semibold text-red-600 flex items-center gap-1.5">
                <i class="fa-solid fa-circle-exclamation text-sm"></i>
                <span>Nếu cần điều chỉnh, vui lòng liên hệ trực tiếp với <strong>Admin</strong>.</span>
            </div>`;
    }
}

/* =========================================================
   MÔ-ĐUN: THỐNG KÊ TẦN SUẤT SỬ DỤNG MẪU EMAIL (TỔNG HỢP TẤT CẢ NHÂN VIÊN)
   ========================================================= */

function renderTemplateStatistics() {
    const container = document.getElementById("statsTabContent");
    if (!container) return;

    container.innerHTML = `
        <div class="p-10 text-center text-slate-400">
            <i class="fa-solid fa-spinner fa-spin text-xl mb-3"></i>
            <p class="text-sm">Đang tải dữ liệu thống kê tổng hợp từ hệ thống...</p>
        </div>
    `;

    if (!STATS_API_URL_READ || STATS_API_URL_READ.includes("DÁN_LINK")) {
        container.innerHTML = `<div class="p-8 text-center text-slate-400">Chưa cấu hình đường dẫn API thống kê.</div>`;
        return;
    }

    fetch(STATS_API_URL_READ)
        .then(res => res.json())
        .then(result => {
            if (result.status !== "success") throw new Error(result.message || "Phản hồi không hợp lệ");
            renderStatsTable(result.stats || {}, result.totalUsage || 0);
        })
        .catch(error => {
            console.error("Lỗi tải thống kê tổng hợp:", error);
            container.innerHTML = `
                <div class="p-8 text-center text-red-400 text-sm">
                    <i class="fa-solid fa-triangle-exclamation mr-1"></i>
                    Không thể tải dữ liệu thống kê tổng hợp. Vui lòng kiểm tra kết nối mạng hoặc thử lại sau.
                </div>
            `;
        });
}

function renderStatsTable(remoteStats, totalUsage) {
    const container = document.getElementById("statsTabContent");
    if (!container) return;

    const templates = window.SOC_TEMPLATES || {};
    let rowsHtml = "";

    const sortedTemplates = Object.keys(templates).map(id => {
        return {
            id: id,
            name: templates[id].name ? templates[id].name.replace(/^Mẫu (Mới|Cũ) \d+: /, "") : id,
            count: (remoteStats[id] && remoteStats[id].count) || 0
        };
    }).sort((a, b) => b.count - a.count);

    if (sortedTemplates.length === 0) {
        container.innerHTML = `<div class="p-8 text-center text-slate-400">Không tìm thấy danh sách mẫu email hoạt động trên hệ thống.</div>`;
        return;
    }

    sortedTemplates.forEach((item, index) => {
        const percentage = totalUsage > 0 ? ((item.count / totalUsage) * 100).toFixed(1) : 0;

        rowsHtml += `
            <tr class="border-b border-slate-100 hover:bg-slate-50/50 transition">
                <td class="p-4 text-center font-medium text-slate-400 text-xs">${index + 1}</td>
                <td class="p-4">
                    <div class="font-semibold text-slate-800 text-sm">${item.name}</div>
                    <div class="text-xs text-slate-400 font-mono mt-0.5">${item.id}</div>
                </td>
                <td class="p-4 text-center font-bold text-indigo-600 text-sm font-mono">${item.count} lượt</td>
                <td class="p-4">
                    <div class="flex items-center gap-3">
                        <div class="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                            <div class="bg-gradient-to-r from-orange-500 to-amber-500 h-2 rounded-full" style="width: ${percentage}%"></div>
                        </div>
                        <span class="text-xs font-bold text-slate-500 w-12 text-right font-mono">${percentage}%</span>
                    </div>
                </td>
            </tr>
        `;
    });

    container.innerHTML = `
        <div class="grid grid-cols-1 md:grid-cols-3 gap-5 mb-6">
            <div class="bg-gradient-to-br from-slate-800 to-slate-950 p-5 rounded-2xl text-white shadow-sm border border-slate-700">
                <div class="text-white/60 text-xs font-bold uppercase tracking-wider">Tổng số lượt sử dụng (Tất cả nhân viên)</div>
                <div class="text-4xl font-black mt-1 font-mono text-amber-500">${totalUsage}</div>
                <div class="text-xs text-white/40 mt-2 flex items-center gap-1">
                    <i class="fa-solid fa-clock-rotate-left"></i> Tổng số lượt click Copy thành công của toàn hệ thống
                </div>
            </div>
            <div class="bg-white border border-slate-200 p-5 rounded-2xl shadow-sm flex flex-col justify-center">
                <div class="text-slate-400 text-xs font-bold uppercase tracking-wider">Mẫu email sử dụng cao nhất</div>
                <div class="text-base font-bold text-slate-800 mt-2 truncate">${sortedTemplates[0].count > 0 ? sortedTemplates[0].name : 'Chưa có dữ liệu'}</div>
                <div class="text-xs text-slate-500 mt-0.5 font-mono">${sortedTemplates[0].count > 0 ? `Đã dùng: ${sortedTemplates[0].count} lần` : '0 thao tác'}</div>
            </div>
            <div class="bg-white border border-slate-200 p-5 rounded-2xl shadow-sm flex flex-col justify-between gap-3">
                <div class="text-slate-400 text-xs font-bold uppercase tracking-wider">Dữ liệu hệ thống</div>
                <button onclick="renderTemplateStatistics()" class="w-full btn-danger-soft py-2 px-4 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition border border-red-100">
                    <i class="fa-solid fa-arrows-rotate"></i> Làm mới dữ liệu
                </button>
            </div>
        </div>

        <div class="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            <div class="p-4 border-b border-slate-100 bg-slate-50/50">
                <h3 class="font-bold text-slate-700 text-xs uppercase tracking-wider flex items-center gap-2">
                    <i class="fa-solid fa-list-ol text-amber-500"></i> Bảng xếp hạng tần suất sử dụng mẫu email (Toàn hệ thống)
                </h3>
            </div>
            <div class="overflow-x-auto">
                <table class="w-full text-left text-sm text-slate-600 border-collapse">
                    <thead>
                        <tr class="bg-slate-50 text-slate-400 font-bold border-b border-slate-200 text-xs uppercase tracking-wider">
                            <th class="p-4 text-center w-16">STT</th>
                            <th class="p-4">Tên nghiệp vụ mẫu</th>
                            <th class="p-4 text-center w-36">Tổng lượt dùng</th>
                            <th class="p-4 w-56">Tỷ lệ</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rowsHtml}
                    </tbody>
                </table>
            </div>
        </div>
    `;
}

document.addEventListener("DOMContentLoaded", () => {
    initEmailSubTabs();
});

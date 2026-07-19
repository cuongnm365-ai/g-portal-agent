/* =========================================================
   UI ENHANCEMENTS — Module "Soạn Email"
   Đã gộp vào G-Portal: bỏ toggle Sáng/Tối riêng và Sidebar Drawer riêng
   (dùng chung #theme-toggle + .sidebar của G-Portal). Chỉ còn giữ lại
   "chấm trạng thái" (status pill) báo đang soạn mẫu email nào.
   ========================================================= */

(function () {
    document.addEventListener("DOMContentLoaded", () => {
        const selector = document.getElementById("templateSelector");
        const pill = document.getElementById("statusPill");
        const pillLabel = document.getElementById("statusPillLabel");

        function updateStatusPill() {
            if (!selector || !pill || !pillLabel) return;
            const templateId = selector.value;
            const template = templateId && window.SOC_TEMPLATES ? window.SOC_TEMPLATES[templateId] : null;

            if (template) {
                pill.classList.add("is-ready");
                pillLabel.textContent = `Đang soạn: ${template.name.replace(/^Mẫu (Mới|Cũ) \d+: /, "")}`;
            } else {
                pill.classList.remove("is-ready");
                pillLabel.textContent = "Chưa chọn mẫu";
            }
        }

        if (selector) selector.addEventListener("change", updateStatusPill);
        updateStatusPill();
    });
})();

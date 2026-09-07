/* =========================================================
   HỆ THỐNG NHẬN DIỆN VÀ CẤU HÌNH VÙNG MIỀN (API CLOUD LOAD)
   Module: Soạn Email (đã gộp từ email-template-tool vào G-Portal)

   ĐỒNG BỘ TỪ REPO GỐC (email-template-tool) — thay đổi so với bản G-Portal
   trước đây:
   - Mở rộng từ 2 vùng (Nam/Bắc) lên 7 VÙNG MIỀN chi tiết theo đúng nghiệp vụ
     CSKH mới nhất: Hà Nội, Hồ Chí Minh, Tây Bắc Bộ + Quảng Ninh, Đông Bắc Bộ
     + Hải Phòng + Hải Dương, Miền Trung - Tây Nguyên + Khánh Hòa + Đà Nẵng,
     Đông Nam Bộ + Đồng Nai + Bình Dương + Vũng Tàu, Tây Nam Bộ.
   - Bổ sung mã "SG" (Sài Gòn) vào nhóm Hồ Chí Minh — trước đây khai báo
     thiếu khiến CC không nhận diện được các hợp đồng dạng SGxxxxxx.
   - Hỗ trợ mã nhận diện dài 2 HOẶC 3 ký tự (VD: "HCM" 3 ký tự, còn lại đa số
     2 ký tự) bằng cách so khớp đúng độ dài của từng mẫu khai báo.
   - Thêm getRegionLabel()/getPatterns() để phần Cài Đặt (settings-panel.js)
     có thể tự dựng ĐỘNG danh sách thẻ theo từng vùng miền, không cần sửa
     HTML mỗi khi thêm/bớt vùng.
   - Ký tự nhận diện vẫn hardcode trong file này (không tải từ Sheet); CHỈ có
     Email từng vùng + BCC mặc định là tải từ Google Sheet qua CONFIG_API_URL
     — giữ đúng nguyên tắc cũ.
   ========================================================= */

class RegionManager {
    constructor() {
        // DÁN LINK API CẤU HÌNH (SHEET 1) VÀO ĐÂY:
        this.CONFIG_API_URL = "https://script.google.com/macros/s/AKfycbyPnMb6B_t5Gv_7K0PtbYWpZVNuoPZZC5KkQ4roe1HbkM8LmkrX2TSMr8HRvPzH3I6y4A/exec";

        // Danh sách 7 vùng miền + ký tự nhận diện (2-3 ký tự đầu Số hợp đồng).
        // "key" dùng để ghép thành tên biến settings (vd: hnEmail, hcmEmail...)
        // và cũng chính là "key" cột tương ứng trên Google Sheet cấu hình.
        this.regionDefs = [
            { key: "hn", label: "Hà Nội", patterns: ["HN"] },
            { key: "hcm", label: "Hồ Chí Minh", patterns: ["HCM", "SG"] },
            { key: "tayBac", label: "Tây Bắc Bộ + Quảng Ninh", patterns: ["BG", "BN", "CB", "LS", "LC", "PT", "TQ", "TN", "VP", "YB", "HA", "QN"] },
            { key: "dongBac", label: "Đông Bắc Bộ + Hải Phòng + Hải Dương", patterns: ["DB", "HM", "HT", "HB", "HY", "ND", "NB", "NA", "SL", "TB", "TH", "HP", "HD"] },
            { key: "mienTrung", label: "Miền Trung - Tây Nguyên + Khánh Hòa + Đà Nẵng", patterns: ["BI", "DL", "GL", "HU", "KT", "PY", "QB", "QA", "QI", "QT", "DK", "NT", "DA"] },
            { key: "dongNamBo", label: "Đông Nam Bộ + Đồng Nai + Bình Dương + Vũng Tàu", patterns: ["BP", "BT", "LD", "LA", "NN", "TI", "DN", "BD", "VT"] },
            { key: "tayNamBo", label: "Tây Nam Bộ", patterns: ["AG", "BL", "BE", "CM", "CT", "DT", "HG", "KG", "ST", "TG", "TV", "VL"] }
        ];

        // Khởi tạo settings rỗng cho từng vùng + BCC
        this.settings = { defaultBccEmail: "" };
        this.regionDefs.forEach(r => { this.settings[r.key + "Email"] = ""; });

        // Tự động tải cấu hình Email từ Google Sheets khi khởi chạy
        this.loadRemoteConfig();
    }

    async loadRemoteConfig() {
        if (!this.CONFIG_API_URL || this.CONFIG_API_URL.includes("DÁN_LINK")) return;

        try {
            const response = await fetch(this.CONFIG_API_URL);
            const data = await response.json();

            this.regionDefs.forEach(r => {
                const key = r.key + "Email";
                if (data[key]) this.settings[key] = data[key];
            });
            if (data.defaultBccEmail) this.settings.defaultBccEmail = data.defaultBccEmail;

            // Cập nhật lên UI ngay khi kéo dữ liệu xong (tên hàm dùng riêng
            // cho G-Portal, xem js/modules/email-tool/settings-panel.js)
            if (typeof loadEmailSettingsUI === "function") {
                loadEmailSettingsUI();
            }
        } catch (error) {
            console.error("Lỗi khi kéo cấu hình từ Google Sheets:", error);
        }
    }

    clearSettings() {
        this.regionDefs.forEach(r => { this.settings[r.key + "Email"] = ""; });
        this.settings.defaultBccEmail = "";
    }

    // Nhận diện vùng miền dựa trên tiền tố của Số hợp đồng. Hỗ trợ mã 2 ký tự
    // (đa số) lẫn 3 ký tự (HCM) bằng cách so khớp đúng độ dài của từng mẫu.
    detectRegion(contractId) {
        if (!contractId) return null;
        const upper = contractId.toUpperCase();

        for (const r of this.regionDefs) {
            for (const p of r.patterns) {
                if (upper.substring(0, p.length) === p) return r.key;
            }
        }
        return null;
    }

    getRegionEmail(region) {
        if (!region) return "";
        return this.settings[region + "Email"] || "";
    }

    getRegionLabel(region) {
        const found = this.regionDefs.find(r => r.key === region);
        return found ? found.label : "";
    }

    getPatterns(regionKey) {
        const found = this.regionDefs.find(r => r.key === regionKey);
        return found ? found.patterns.join(", ") : "";
    }
}

const regionManager = new RegionManager();

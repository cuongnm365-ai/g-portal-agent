/* =========================================================
   HỆ THỐNG NHẬN DIỆN VÀ CẤU HÌNH VÙNG MIỀN (API CLOUD LOAD)
   Module: Soạn Email (đã gộp từ email-template-tool vào G-Portal)
   ========================================================= */

class RegionManager {
    constructor() {
        // DÁN LINK API CẤU HÌNH (SHEET 1) VÀO ĐÂY:
        this.CONFIG_API_URL = "https://script.google.com/macros/s/AKfycbyPnMb6B_t5Gv_7K0PtbYWpZVNuoPZZC5KkQ4roe1HbkM8LmkrX2TSMr8HRvPzH3I6y4A/exec";

        this.settings = {
            southPatterns: [
                "SG","BD","DA","DN","NT","VT","BP","BT","LD","LA",
                "NN","TI","AG","BL","BE","CM","CT","DT","HG","KG",
                "ST","TG","TV","VL","BI","DL","GL","HU","KT","PY",
                "QB","QA","QI","QT","DK"
            ],
            northPatterns: [
                "DB","HM","HT","HB","HY","ND","NB","NA","SL","TB",
                "TH","BG","BN","CB","LS","LC","PT","TQ","TN","VP",
                "YB","HA","HN","HD","HP","QN"
            ],
            southEmail: "",
            northEmail: "",
            defaultBccEmail: ""
        };

        this.loadRemoteConfig();
    }

    async loadRemoteConfig() {
        if (!this.CONFIG_API_URL || this.CONFIG_API_URL.includes("DÁN_LINK")) return;

        try {
            const response = await fetch(this.CONFIG_API_URL);
            const data = await response.json();

            if (data.southEmail) this.settings.southEmail = data.southEmail;
            if (data.northEmail) this.settings.northEmail = data.northEmail;
            if (data.defaultBccEmail) this.settings.defaultBccEmail = data.defaultBccEmail;

            if (typeof loadEmailSettingsUI === "function") {
                loadEmailSettingsUI();
            }
        } catch (error) {
            console.error("Lỗi khi kéo cấu hình từ Google Sheets:", error);
        }
    }

    clearSettings() {
        this.settings.southEmail = "";
        this.settings.northEmail = "";
        this.settings.defaultBccEmail = "";
    }

    detectRegion(contractId) {
        if (!contractId) return null;
        const code = contractId.substring(0, 2).toUpperCase();
        if (this.settings.southPatterns.includes(code)) return "south";
        if (this.settings.northPatterns.includes(code)) return "north";
        return null;
    }

    getRegionEmail(region) {
        if (region === "south") return this.settings.southEmail;
        if (region === "north") return this.settings.northEmail;
        return "";
    }

    getSouthPatterns() { return this.settings.southPatterns.join(", "); }
    getNorthPatterns() { return this.settings.northPatterns.join(", "); }
}

const regionManager = new RegionManager();

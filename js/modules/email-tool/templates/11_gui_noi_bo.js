window.SOC_TEMPLATES = window.SOC_TEMPLATES || {};

window.SOC_TEMPLATES["t_gui_noi_bo"] = {
    name: "Mẫu Mới 8: Gửi nội bộ (DVKH/TIN/PNC...)",
    hideCustomerInfo: true,
    hideSignature: true,
    hideBcc: true,
    subject: "{{sourcePrefix}}{{sosPrefix}}{{area}} - {{branch}} - {{contractId}} - [Tóm tắt vấn đề]",

    fields: [
        {
            type: "row",
            fields: [
                { id: "dept_DVKH", label: "Gửi DVKH", type: "checkbox", width: "w-1/3" },
                { id: "dept_TIN", label: "Gửi TIN/PNC", type: "checkbox", width: "w-1/3" },
                { id: "dept_OTHER", label: "Gửi Khác", type: "checkbox", width: "w-1/3" }
            ]
        },
        { id: "dept_OTHER_text", label: "Nhập tên bộ phận khác (Nếu tick chọn 'Gửi Khác')", type: "text", format: "uppercase", placeholder: "Ví dụ: CSKH, HO, PMB..." },
        {
            type: "row",
            fields: [
                { id: "source", label: "Nguồn khiếu nại", type: "select", options: [
                    {value: "", text: "-- Không bắt buộc --"},
                    {value: "KN MXH", text: "KN MXH"},
                    {value: "KN Email", text: "KN Email"}
                ], width: "w-1/2" },
                { id: "isSOS", label: "Khẩn cấp (SOS)", type: "checkbox", width: "w-1/2" }
            ]
        },
        { id: "sourceDetail", label: "Link bài Post / Địa chỉ Email (Tùy nguồn)", type: "text", placeholder: "Dán link bài viết hoặc Email của KH..." },
        {
            type: "row",
            fields: [
                { id: "area", label: "Khu vực", type: "text", placeholder: "Ví dụ: HCM", width: "w-1/2" },
                { id: "branch", label: "Chi nhánh", type: "text", placeholder: "Ví dụ: CN Quận 7", width: "w-1/2" }
            ]
        },
        {
            type: "row",
            fields: [
                { id: "contractId", label: "Số hợp đồng", type: "text", format: "uppercase", width: "w-1/3" },
                { id: "phone", label: "Số điện thoại", type: "text", width: "w-1/3" },
                { id: "address", label: "Địa chỉ", type: "text", format: "titlecase", width: "w-1/3" }
            ]
        },
        { id: "complaintDetails", label: "Nội dung phản ánh/khiếu nại", type: "textarea", placeholder: "Nhập nội dung KH phản ánh..." },
        { id: "socAction", label: "Thông tin xử lý từ SOC", type: "textarea", placeholder: "Các bước SOC đã thực hiện..." },
        { id: "proposal", label: "Đề xuất/Đề nghị xử lý", type: "textarea", placeholder: "Đề nghị xử lý..." }
    ],

    computedVars: function(data) {
        let depts = [];
        if (data.dept_DVKH) depts.push("DVKH");
        if (data.dept_TIN) depts.push("TIN/PNC");

        if (data.dept_OTHER) {
            let otherDept = (data.dept_OTHER_text && data.dept_OTHER_text !== "[dept_OTHER_text]")
                            ? data.dept_OTHER_text.toUpperCase()
                            : "CÁC BP LIÊN QUAN";
            depts.push(otherDept);
        }

        let deptStr = depts.length > 0 ? depts.join(" / ") : "[Chưa chọn bộ phận]";

        let sourcePrefix = "";
        let extraHTML = "";
        if (data.source && data.source !== "[source]") {
            sourcePrefix = `[${data.source}] - `;

            if (data.sourceDetail && data.sourceDetail !== "[sourceDetail]") {
                if (data.source === "KN MXH") {
                    extraHTML = `<li><b>Link bài Post:</b> <a href="${data.sourceDetail}" style="color: #2b6cb0; text-decoration: underline;">Nhấn để xem</a></li>`;
                } else if (data.source === "KN Email") {
                    extraHTML = `<li><b>Email KH:</b> <a href="mailto:${data.sourceDetail}" style="color: #2b6cb0;">${data.sourceDetail}</a></li>`;
                }
            }
        }

        let sosPrefix = data.isSOS ? "[Khẩn Cấp/SOS] - " : "";

        return {
            sourcePrefix: sourcePrefix,
            sosPrefix: sosPrefix,
            dept: deptStr,
            extraInfo: extraHTML
        };
    },

    body: `
        Dear <b>{{dept}}</b>,<br><br>
        SOC tiếp nhận thông tin phản ánh/khiếu nại từ Khách hàng với chi tiết như sau:<br><br>

        <b>1. Thông tin khách hàng:</b>
        <ul style="margin: 0; padding-left: 20px;">
            <li><b>Số hợp đồng:</b> {{contractId}}</li>
            <li><b>Số điện thoại:</b> {{phone}}</li>
            <li><b>Địa chỉ:</b> {{address}}</li>
            {{extraInfo}}
        </ul><br>

        <b>2. Thông tin phản ánh/khiếu nại từ KH:</b><br>
        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-top: 4px; border-left: 3px solid #f26f21;">
            <tr><td style="padding-left: 15px;">{{complaintDetails}}</td></tr>
        </table><br>

        <b>3. Thông tin xử lý từ SOC:</b><br>
        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-top: 4px; border-left: 3px solid #f26f21;">
            <tr><td style="padding-left: 15px;">{{socAction}}</td></tr>
        </table><br>

        <b>4. Đề xuất/Đề nghị xử lý:</b><br>
        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-top: 4px; border-left: 3px solid #f26f21;">
            <tr><td style="padding-left: 15px;">{{proposal}}</td></tr>
        </table>
    `
};

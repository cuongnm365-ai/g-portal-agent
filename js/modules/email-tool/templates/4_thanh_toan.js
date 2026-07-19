window.SOC_TEMPLATES = window.SOC_TEMPLATES || {};

window.SOC_TEMPLATES["t_thanh_toan"] = {
    name: "Mẫu Mới 4: Đáo hạn cước phí & Thanh toán",
    subject: "[Thông Báo] Thông tin cước phí và gia hạn dịch vụ Internet - HĐ: {{contractId}}",

    fields: [
        { id: "contractId", label: "Số hợp đồng / Đường truyền", type: "text", format: "uppercase", placeholder: "Ví dụ: SGH859892" },
        { id: "phone", label: "Số điện thoại đăng ký", type: "text", placeholder: "Ví dụ: 0912345689" },
        { id: "address", label: "Địa chỉ đường truyền", type: "text", format: "titlecase", placeholder: "Nhập địa chỉ lắp đặt" },
        { id: "cycleStart", label: "Ngày bắt đầu trả trước", type: "date" },
        { id: "monthsCount", label: "Gói cước trả trước", type: "select", options: [
            {value: "6", text: "Trả trước 6 tháng"},
            {value: "12", text: "Trả trước 12 tháng (Tặng 1 tháng)"}
        ]},
        { id: "amount", label: "Số tiền thanh toán", type: "text", format: "currency", placeholder: "Ví dụ: 1200000" },
        { id: "servicePackage", label: "Gói dịch vụ", type: "text", format: "titlecase", placeholder: "Ví dụ: Internet Sky" }
    ],

    computedVars: function(data) {
        let labelText = (data.monthsCount === "6") ? "Kỳ hạn 6 tháng" : "Kỳ hạn 13 tháng";
        let cycleText = `<span style="font-style: italic;">Từ ... đến ...</span>`;

        if (data.cycleStart && data.cycleStart !== '[cycleStart]') {
            let startDate = new Date(data.cycleStart);
            let endDate = new Date(data.cycleStart);
            endDate.setMonth(startDate.getMonth() + (data.monthsCount === "6" ? 6 : 13));
            endDate.setDate(endDate.getDate() - 1);

            const formatBtn = (d) => `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`;
            cycleText = `<span style="font-style: italic;">Từ <b>${formatBtn(startDate)}</b> đến <b>${formatBtn(endDate)}</b></span>`;
        }
        return { cycleListHTML: `<li style="margin-bottom: 4px;"><b>${labelText}:</b> ${cycleText}</li>` };
    },

    qrType: "thanh_toan",

    boxContent: `
        <ul style="margin: 0; padding-left: 20px;">
            <li style="margin-bottom: 4px;"><b>Số tiền cần thanh toán:</b> <span style="color: #c53030; font-weight: bold; font-size: 15px;">{{amount}} VNĐ</span></li>
            {{cycleListHTML}}
            <li style="margin-bottom: 4px;"><b>Gói dịch vụ:</b> <b>{{servicePackage}}</b></li>
        </ul>
        <p style="margin-bottom:0; font-style: italic;">➔ Thanh toán nhanh, an toàn & dễ dàng kiểm tra tình trạng thanh toán ngay tại ứng dụng <b>Hi FPT</b> (quét QR bên cạnh, đăng nhập SĐT <b>{{phone}}</b>)</p>
    `,

    body: `
        Thân chào {{honorific}} <b>{{customerName}}</b>,<br><br>
        Em là <b>{{staffName}}</b> - Nhân viên CSKH FPT Telecom.<br><br>
        Hiện tại hợp đồng <b>{{contractId}}</b> tại địa chỉ <b>{{address}}</b> đã đến kỳ gia hạn trả trước. Em gửi {{pronounLc}} thông tin thanh toán cho gói mới như sau:<br>
        {INFO_BOX}
        Khi cần phục vụ hoặc yêu cầu xử lý khác, {{pronounLc}} có thể gửi yêu cầu trực tiếp trên Ứng dụng Hi FPT tại mục <b>"Phục vụ"</b> hoặc <b>"Báo hỏng nhanh"</b> để được xử lý nhanh chóng mà không cần gọi tổng đài.<br><br>
        FPT Telecom cảm ơn {{honorific}} <b>{{customerName}}</b> đã liên hệ.
    `
};

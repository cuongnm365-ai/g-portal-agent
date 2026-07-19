window.SOC_TEMPLATES = window.SOC_TEMPLATES || {};

window.SOC_TEMPLATES["o_payment"] = {
    name: "Mẫu Cũ 2: Thanh toán / Đáo hạn cước",
    subject: "[Thông Báo] Nhắc gia hạn và Đáo hạn cước dịch vụ Internet - HĐ: {{contractId}}",

    fields: [
        { id: "contractId", label: "Số hợp đồng", type: "text", format: "uppercase" },
        { id: "phone", label: "Số điện thoại đăng ký", type: "text" },
        { id: "address", label: "Địa chỉ đường truyền", type: "text", format: "titlecase" },
        { id: "cycleStart", label: "Ngày bắt đầu trả trước", type: "date" },
        { id: "monthsCount", label: "Gói cước trả trước", type: "select", options: [
            {value: "6", text: "Trả trước 6 tháng"},
            {value: "12", text: "Trả trước 12 tháng"}
        ]},
        { id: "amount", label: "Số tiền thanh toán", type: "text", format: "currency" },
        { id: "servicePackage", label: "Gói dịch vụ", type: "text", format: "titlecase" }
    ],

    computedVars: function(data) {
        let labelText = (data.monthsCount === "6") ? "Kỳ hạn 6 tháng" : "Kỳ hạn 13 tháng";
        let displayMonthText = (data.monthsCount === "6") ? "6" : "12";
        let cycleText = `<span style="font-style: italic;">Từ ... đến ...</span>`;

        if (data.cycleStart && data.cycleStart !== '[cycleStart]') {
            let startDate = new Date(data.cycleStart);
            let endDate = new Date(data.cycleStart);
            endDate.setMonth(startDate.getMonth() + (data.monthsCount === "6" ? 6 : 13));
            endDate.setDate(endDate.getDate() - 1);

            const formatBtn = (d) => `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`;
            cycleText = `<span style="font-style: italic;">Từ <b>${formatBtn(startDate)}</b> đến <b>${formatBtn(endDate)}</b></span>`;
        }
        return {
            cycleListHTML: `<li style="margin-bottom: 4px;"><b>${labelText}:</b> ${cycleText}</li>`,
            displayMonthText: displayMonthText
        };
    },

    qrType: "thanh_toan",

    boxContent: `
        <ul style="margin: 0; padding-left: 20px;">
            <li style="margin-bottom: 4px;"><b>Số tiền cần thanh toán:</b> {{amount}} VNĐ</li>
            {{cycleListHTML}}
            <li style="margin-bottom: 4px;"><b>Gói dịch vụ:</b> <b>{{servicePackage}}</b></li>
        </ul>
        <p style="margin-bottom:0; font-style: italic;">Thanh toán nhanh, an toàn & dễ dàng kiểm tra tình trạng thanh toán ngay tại ứng dụng <b>Hi FPT</b> (quét hoặc chạm mã QR bên cạnh, đăng nhập SĐT <b>{{phone}}</b>).</p>
    `,

    body: `
        Thân chào {{honorific}} <b>{{customerName}}</b>,<br><br>
        Em là <b>{{staffName}}</b> - Nhân viên CSKH FPT Telecom.<br><br>
        Hiện tại hợp đồng <b>{{contractId}}</b> tại <b>{{address}}</b> đã đến kỳ gia hạn trả trước.<br><br>
        Em gửi {{pronounLc}} thông tin thanh toán kỳ <b>{{displayMonthText}}</b> tháng tiếp theo cho gói dịch vụ đang sử dụng như sau:<br>
        {INFO_BOX}
        Khi cần báo hỏng hoặc yêu cầu phục vụ khác, {{pronounLc}} có thể quét mã QR để gửi yêu cầu trực tiếp trên <b>Ứng dụng Hi FPT</b> tại mục <b>"Phục vụ"</b> hoặc <b>"Báo hỏng nhanh"</b> sẽ được xử lý nhanh chóng mà không cần gọi hotline.<br><br>
        FPT Telecom cảm ơn {{pronounLc}} <b>{{customerName}}</b> đã liên hệ ạ.
    `
};

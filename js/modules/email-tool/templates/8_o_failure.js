window.SOC_TEMPLATES = window.SOC_TEMPLATES || {};

window.SOC_TEMPLATES["o_failure"] = {
    name: "Mẫu Cũ 1: Thông báo sự cố / Báo hỏng",
    subject: "[Báo Hỏng] Ghi nhận xử lý sự cố đường truyền mạng - HĐ: {{contractId}}",

    fields: [
        { id: "contractId", label: "Số hợp đồng / Đường truyền", type: "text", format: "uppercase" },
        { id: "phone", label: "Số điện thoại đăng ký", type: "text" },
        { id: "address", label: "Địa chỉ đường truyền", type: "text", format: "titlecase" },
        { id: "expectedTime", label: "Thời gian xử lý dự kiến", type: "text" },
        { id: "techName", label: "Kỹ thuật viên phục vụ", type: "text", format: "titlecase" }
    ],

    qrType: "bao_hong",

    boxContent: `
        <ul style="margin: 0; padding-left: 20px;">
            <li style="margin-bottom: 4px;"><b>Thời gian xử lý dự kiến:</b> {{expectedTime}}</li>
            <li style="margin-bottom: 4px;"><b>Kỹ thuật viên:</b> {{techName}}</li>
        </ul>
        <p style="margin-bottom:0; font-style: italic;">Chi tiết tiến độ xử lý và thông tin kỹ thuật viên, vui lòng xem tại ứng dụng <b>Hi FPT</b> (quét hoặc chạm mã QR bên cạnh, đăng nhập bằng SĐT <b>{{phone}}</b>).</p>
    `,

    body: `
        Thân chào {{honorific}} <b>{{customerName}}</b>,<br><br>
        Em là <b>{{staffName}}</b> - Nhân viên CSKH FPT Telecom.<br><br>
        Bên em đã ghi nhận thông tin phản ánh về chất lượng của đường truyền có Số hợp đồng <b>{{contractId}}</b> tại địa chỉ <b>{{address}}</b> và sẽ cử kỹ thuật viên qua phục vụ trực tiếp tại nhà.<br>
        {INFO_BOX}
        Trong quá trình sử dụng, khi cần báo hỏng hoặc yêu cầu phục vụ khác, {{pronounLc}} có thể quét mã QR để gửi yêu cầu trực tiếp trên <b>Ứng dụng Hi FPT</b> tại mục <b>"Phục vụ"</b> hoặc <b>"Báo hỏng nhanh"</b>. Bên em sẽ xử lý nhanh chóng mà không cần gọi hotline.<br><br>
        Chân thành cảm ơn {{pronounLc}} <b>{{customerName}}</b> đã tin tưởng và sử dụng dịch vụ của FPT Telecom.
    `
};

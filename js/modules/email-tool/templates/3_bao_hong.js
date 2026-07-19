window.SOC_TEMPLATES = window.SOC_TEMPLATES || {};

window.SOC_TEMPLATES["t_bao_hong"] = {
    name: "Mẫu Mới 3: Báo hỏng (Có CL kỹ thuật đang xử lý)",
    subject: "[Báo Hỏng] Kế hoạch phục vụ xử lý sự cố đường truyền mạng - HĐ: {{contractId}}",

    fields: [
        { id: "contractId", label: "Số hợp đồng / Đường truyền", type: "text", format: "uppercase", placeholder: "Ví dụ: SGH859892" },
        { id: "phone", label: "Số điện thoại đăng ký", type: "text", placeholder: "Ví dụ: 0912345689" },
        { id: "address", label: "Địa chỉ đường truyền", type: "text", format: "titlecase", placeholder: "Nhập địa chỉ lắp đặt" },
        { id: "expectedTime", label: "Thời gian xử lý dự kiến", type: "text", placeholder: "Ví dụ: 15:30 - 17:30 31/05/2026" },
        { id: "techName", label: "Kỹ thuật viên phục vụ", type: "text", format: "titlecase", placeholder: "Ví dụ: Nguyễn Duy Khanh – 038***4707" }
    ],

    qrType: "bao_hong",

    boxContent: `
        <ul style="margin: 0; padding-left: 20px;">
            <li style="margin-bottom: 4px;"><b>Thời gian xử lý dự kiến:</b> <span style="color: #c53030; font-weight: bold;">{{expectedTime}}</span></li>
            <li style="margin-bottom: 4px;"><b>Kỹ thuật viên phục vụ:</b> <b>{{techName}}</b></li>
        </ul>
        <p style="margin-bottom:0; font-style: italic;">➔ Chi tiết tiến độ xử lý và thông tin KTV, vui lòng xem tại ứng dụng <b>Hi FPT</b> (quét hoặc chạm mã QR, đăng nhập bằng SĐT <b>{{phone}}</b>)</p>
    `,

    body: `
        Thân chào {{honorific}} <b>{{customerName}}</b>,<br><br>
        Em là <b>{{staffName}}</b> – Nhân viên Chăm sóc Khách hàng của FPT Telecom.<br><br>
        Như trao đổi với {{pronoun}} qua điện thoại, bên em đã ghi nhận vấn đề gián đoạn của đường truyền <b>{{contractId}}</b> tại địa chỉ <b>{{address}}</b> và sẽ cử kỹ thuật viên qua phục vụ trực tiếp tại nhà mình.<br>
        {INFO_BOX}
        Lần tới khi cần báo hỏng hoặc yêu cầu phục vụ khác, {{pronoun}} có thể gửi yêu cầu trực tiếp ngay trên Ứng dụng Hi FPT tại mục <b>"Phục vụ"</b> hoặc <b>"Báo hỏng nhanh"</b> mà không cần gọi lên tổng đài.<br><br>
        FPT Telecom luôn sẵn sàng phục vụ và cảm ơn {{honorific}} đã liên hệ.
    `
};

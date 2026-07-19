window.SOC_TEMPLATES = window.SOC_TEMPLATES || {};

window.SOC_TEMPLATES["t_da_xu_ly"] = {
    name: "Mẫu Mới 2: KH đã xử lý xong (Giới thiệu báo hỏng nhanh)",
    subject: "[FPT Telecom] Phản hồi thông tin dịch vụ đường truyền Internet",

    fields: [
        { id: "phone", label: "Số điện thoại đăng ký", type: "text", placeholder: "Ví dụ: 0912345689" }
    ],

    qrType: "bao_hong",

    boxContent: `
        <ul style="margin: 0; padding-left: 20px;">
            <li style="margin-bottom: 4px;"><b>Kiểm tra “sức khỏe mạng”</b>, Cài đặt wifi dễ dàng <i>(đổi tên/mật khẩu)</i></li>
            <li style="margin-bottom: 4px;">Theo dõi và <b>thanh toán hóa đơn</b> định kỳ</li>
            <li style="margin-bottom: 4px;">Gửi <b>báo hỏng nhanh</b> khi có sự cố không cần gọi Tổng đài</li>
        </ul>
        <p style="margin-bottom:0; font-style: italic;">➔ Chi tiết vui lòng xem tại ứng dụng <b>Hi FPT</b> (quét hoặc chạm mã QR bên cạnh, đăng nhập bằng SĐT <b>{{phone}}</b>)</p>
    `,

    body: `
        Thân chào {{honorific}} <b>{{customerName}}</b>,<br><br>
        Em là <b>{{staffName}}</b> – Nhân viên CSKH FPT Telecom.<br><br>
        Em cảm ơn {{pronounLc}} đã phản hồi tích cực. Trong quá trình sử dụng không tránh khỏi những vấn đề phát sinh, với mong muốn tiếp nhận được phản ánh của khách hàng sớm nhất, {{honorific}} cài đặt và sử dụng ứng dụng <b>Hi FPT</b> giúp em nhé:<br>
        {INFO_BOX}
        Lần tới khi cần báo hỏng hoặc yêu cầu phục vụ khác, {{honorific}} có thể gửi yêu cầu trực tiếp ngay trên Ứng dụng Hi FPT tại mục <b>"Hỗ trợ"</b> hoặc <b>"Báo hỏng nhanh"</b> mà không cần gọi lên tổng đài.<br><br>
        Chúc {{honorific}} cuối tuần vui vẻ!
    `
};

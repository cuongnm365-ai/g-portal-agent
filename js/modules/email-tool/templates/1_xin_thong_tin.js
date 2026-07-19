window.SOC_TEMPLATES = window.SOC_TEMPLATES || {};

window.SOC_TEMPLATES["t_xin_thong_tin"] = {
    name: "Mẫu Mới 1: Xin thông tin hợp đồng (Thiếu thông tin)",
    subject: "[Xử Lý] Tiếp nhận làm rõ thông tin thắc mắc hợp đồng",

    fields: [],

    qrType: "bao_hong",

    boxContent: `
        <ul style="margin: 0; padding-left: 20px;">
            <li style="margin-bottom: 4px;"><b>Số điện thoại liên hệ</b> hoặc <b>Số hợp đồng</b></li>
            <li style="margin-bottom: 4px;"><b>Gói dịch vụ</b> đang sử dụng <i>(nếu có)</i></li>
        </ul>
        <p style="margin-bottom:0; font-style: italic;">➔ Chi tiết vui lòng lấy tại ứng dụng <b>Hi FPT</b> (quét hoặc chạm mã QR bên cạnh, đăng nhập bằng SĐT đăng ký với FPT Telecom).</p>
    `,

    body: `
        Thân chào {{honorific}} <b>{{customerName}}</b>,<br><br>
        Em là <b>{{staffName}}</b> – Nhân viên CSKH FPT Telecom.<br><br>
        Em hiểu những mong muốn từ {{pronoun}}. Để có thể phục vụ {{pronounLc}} tốt nhất, vui lòng cung cấp giúp em thêm thông tin đường truyền đang sử dụng như:<br>
        {INFO_BOX}
        Ngay khi nhận được phản hồi, bên em sẽ kiểm tra tình trạng và có phương án đề xuất phục vụ tốt nhất dành cho hợp đồng của {{pronounLc}}.<br><br>
        Cảm ơn {{pronounLc}} <b>{{customerName}}</b> đã liên hệ.
    `
};

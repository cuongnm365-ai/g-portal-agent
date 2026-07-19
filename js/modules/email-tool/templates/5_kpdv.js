window.SOC_TEMPLATES = window.SOC_TEMPLATES || {};

window.SOC_TEMPLATES["t_kpdv"] = {
    name: "Mẫu Mới 5: Thủ tục khôi phục dịch vụ (KPDV)",
    subject: "[Thủ Tục] Hướng dẫn khôi phục dịch vụ Internet - HĐ: {{contractId}}",

    fields: [
        { id: "contractId", label: "Số hợp đồng / Đường truyền", type: "text", format: "uppercase" },
        { id: "phone", label: "Số điện thoại đăng ký", type: "text", placeholder: "Ví dụ: 0912345689" },
        { id: "address", label: "Địa chỉ đường truyền", type: "text", format: "titlecase" },
        { id: "monthSuspend", label: "Tháng bắt đầu tạm ngưng", type: "text", placeholder: "Ví dụ: 03/2026" },
        { id: "monthDebt", label: "Tháng còn nợ cước", type: "text", placeholder: "Ví dụ: 02/2026" },
        { id: "servicePackageKPDV", label: "Gói dịch vụ đang dùng", type: "text", format: "titlecase" }
    ],

    qrType: "cai_dat",

    boxContent: `
        <ul style="margin: 0; padding-left: 20px;">
            <li style="margin-bottom: 4px;"><b>Mã khách hàng:</b> <b>{{contractId}}</b></li>
            <li style="margin-bottom: 4px;"><b>Gói dịch vụ:</b> {{servicePackageKPDV}}</li>
            <li style="margin-bottom: 4px;"><b>Tình trạng hiện tại:</b> <span style="background-color: #fef08a; padding: 2px 4px; color: #744210; font-weight: bold; border-radius: 3px;">Tạm ngưng sử dụng</span></li>
        </ul>
        <p style="margin-top: 10px; margin-bottom: 4px; font-style: italic;">➔ Chi tiết vui lòng xem tại ứng dụng <b>Hi FPT</b> (quét QR, đăng nhập bằng SĐT <b>{{phone}}</b>).</p>
        <p style="margin-bottom: 0; font-style: italic;">➔ Em gửi đường dẫn trực tiếp đến tính năng <a href="https://hi.fpt.vn/rev/qkr/KD50EDzN" style="color: #2b6cb0; font-weight: bold;">Khôi phục dịch vụ trên Hi FPT</a> để {{pronounLc}} tham khảo.</p>
    `,

    body: `
        Thân chào {{honorific}} <b>{{customerName}}</b>,<br><br>
        Em là <b>{{staffName}}</b> – Nhân viên CSKH FPT Telecom.<br><br>
        Chúc {{pronoun}} cuối tuần nhiều niềm vui. Với vị trí thuận lợi, em tin {{pronounLc}} sẽ sớm tìm được khách thuê phù hợp.<br><br>
        Để thuận tiện cho {{pronounLc}} cũng như người thuê nhà trong tương lai, em xin chia sẻ thông tin về đường truyền Internet hiện có tại địa chỉ <b>{{address}}</b>. <br><br>
        Khi có nhu cầu dùng lại dịch vụ, người thuê mới có thể thực hiện thủ tục khôi phục trong vòng 06 tháng kể từ tháng <b>{{monthSuspend}}</b>. Chỉ cần thanh toán hóa đơn còn tồn tháng <b>{{monthDebt}}</b> và thực hiện yêu cầu khôi phục dịch vụ, đường truyền sẽ sẵn sàng sử dụng mà không cần chờ triển khai mới.<br><br>
        Do hóa đơn tháng <b>{{monthDebt}}</b> đã được phát hành theo quy định nên hiện chưa thể thu hồi. Em rất mong {{pronounLc}} thông cảm. Em gửi {{pronounLc}} thông tin sơ bộ về hợp đồng này để nắm và chia sẻ tới người thuê nhà nếu cần:<br>
        {INFO_BOX}
        Khi cần phục vụ, {{pronounLc}} gửi yêu cầu xử lý ngay trên ứng dụng Hi FPT hoặc phản hồi lại email này để bên em phục vụ.
    `
};

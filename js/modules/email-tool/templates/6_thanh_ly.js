window.SOC_TEMPLATES = window.SOC_TEMPLATES || {};

window.SOC_TEMPLATES["t_thanh_ly"] = {
    name: "Mẫu Mới 6: KH Thanh lý (Cứu vớt / Chuyển ĐĐ)",
    subject: "[Chăm Sóc] Phản hồi thông tin hợp đồng dịch vụ Internet FPT - HĐ: {{contractId}}",

    fields: [
        { id: "contractId", label: "Số hợp đồng", type: "text", format: "uppercase" },
        { id: "phone", label: "Số điện thoại đăng ký", type: "text", placeholder: "Ví dụ: 0912345689" },
        { id: "address", label: "Địa chỉ đường truyền", type: "text", format: "titlecase" }
    ],

    qrType: "cai_dat",

    boxContent: `
        <ul style="margin: 0; padding-left: 20px;">
            <li style="margin-bottom: 4px;"><b>Mã khách hàng:</b> <b>{{contractId}}</b></li>
            <li style="margin-bottom: 4px;"><b>Địa chỉ sử dụng:</b> <b>{{address}}</b></li>
        </ul>
        <p style="margin-top: 10px; margin-bottom: 0; font-style: italic;">➔ Chi tiết hợp đồng, biên bản điện tử vui lòng xem tại ứng dụng <b>Hi FPT</b> (quét hoặc chạm mã QR bên cạnh, đăng nhập bằng SĐT <b>{{phone}}</b>).</p>
    `,

    body: `
        Kính chào {{honorific}} <b>{{customerName}}</b>,<br><br>
        Em là <b>{{staffName}}</b> – Nhân viên CSKH FPT Telecom.<br><br>
        Em hiểu và chia sẻ với những thông tin mà {{pronoun}} cung cấp liên quan tới hợp đồng dịch vụ Internet <b>{{contractId}}</b> tại địa chỉ <b>{{address}}</b>.<br><br>
        Như có trao đổi với {{pronoun}}, hiện bên em sẽ phối hợp cùng phía phụ trách hợp đồng để có phương án phục vụ phù hợp nhất với yêu cầu của {{pronounLc}}. Trong thời gian này, em xin phép gửi lại thông tin hợp đồng để {{pronounLc}} tham khảo và cân nhắc:<br>
        {INFO_BOX}
        Với mong muốn được tiếp tục đồng hành và phục vụ, FPT Telecom linh hoạt trong việc xử lý cho khách hàng chuyển địa điểm sử dụng, có thể thực hiện ngay trên ứng dụng Hi FPT bằng cách vào mục <b>“Phục vụ” > Chuyển địa điểm</b>.<br><br>
        Em cảm ơn {{pronoun}} <b>{{customerName}}</b> đã phản hồi và liên lạc.
    `
};

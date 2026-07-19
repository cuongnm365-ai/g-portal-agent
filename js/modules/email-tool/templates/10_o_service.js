window.SOC_TEMPLATES = window.SOC_TEMPLATES || {};

window.SOC_TEMPLATES["o_service"] = {
    name: "Mẫu Cũ 3: Thủ tục/dịch vụ",
    subject: "[Thông Báo] Tiếp nhận phục vụ dịch vụ thủ tục khách hàng - HĐ: {{contractId}}",

    fields: [
        { id: "contractId", label: "Số hợp đồng", type: "text", format: "uppercase" },
        { id: "phone", label: "Số điện thoại đăng ký", type: "text" },
        { id: "address", label: "Địa chỉ đường truyền", type: "text", format: "titlecase" },
        { id: "requestType", label: "Nội dung yêu cầu", type: "select", options: [
            {value: "cước phí", text: "Cước Phí"},
            {value: "khiếu nại nhân viên", text: "Khiếu Nại Nhân Viên"},
            {value: "Thanh lý / Tạm ngưng", text: "Thanh Lý Tạm Ngưng"},
            {value: "dịch vụ FPT Play", text: "Dịch vụ FPT Play"},
            {value: "other", text: "Khác"}
        ]},
        { id: "customRequest", label: "Nhập nội dung yêu cầu (Nếu chọn Khác)", type: "text", placeholder: "Ví dụ: thay đổi thông tin chủ thể..." }
    ],

    computedVars: function(data) {
        let finalReq = data.requestType;
        if (data.requestType === 'other') {
            finalReq = (data.customRequest && data.customRequest !== '[customRequest]') ? data.customRequest.trim() : 'yêu cầu thủ tục / dịch vụ';
        }
        return { finalRequestText: finalReq };
    },

    qrType: "cai_dat",

    boxContent: `
        <ul style="margin: 0; padding-left: 20px;">
            <li style="margin-bottom: 4px;">Khi có thông tin kết quả xử lý bên em sẽ liên hệ lại <b>{{pronounLc}}</b> qua số điện thoại <b>{{phone}}</b> để phản hồi kết quả xử lý.</li>
        </ul>
        <p style="margin-bottom:0; font-style: italic;">Theo dõi tiến độ trực tiếp hoặc tương tác nhanh hơn ngay tại ứng dụng <b>Hi FPT</b> (quét hoặc chạm mã QR bên cạnh).</p>
    `,

    body: `
        Thân chào {{honorific}} <b>{{customerName}}</b>,<br><br>
        Em là <b>{{staffName}}</b> - Nhân viên Chăm sóc Khách hàng FPT Telecom.<br><br>
        Bên em đã ghi nhận yêu cầu về <b>{{finalRequestText}}</b> của {{pronounLc}} đối với Số hợp đồng <b>{{contractId}}</b> tại địa chỉ <b>{{address}}</b>. Hiện tại, bên em sẽ phối hợp cùng bộ phận phụ trách để thực hiện kiểm tra, đối soát nhằm xử lý nhanh chóng, dứt điểm yêu cầu.<br>
        {INFO_BOX}
        Trong quá trình sử dụng, khi cần báo hỏng hoặc yêu cầu phục vụ khác, {{pronounLc}} có thể quét mã QR để gửi yêu cầu trực tiếp trên <b>Ứng dụng Hi FPT</b> tại mục <b>"Phục vụ"</b> hoặc <b>"Báo hỏng nhanh"</b>. Bên em sẽ xử lý nhanh chóng mà không cần gọi hotline.<br><br>
        Chân thành cảm ơn <b>{{honorific}} {{customerName}}</b> đã tin tưởng và sử dụng dịch vụ của FPT Telecom.
    `
};

window.SOC_TEMPLATES = window.SOC_TEMPLATES || {};

window.SOC_TEMPLATES["t_phuc_dap"] = {
    name: "Mẫu Mới 7: Khiếu nại nặng / Phúc đáp đơn thư",
    subject: "[Phúc Đáp] Văn bản xử lý giải đáp đơn thư thắc mắc khiếu nại - HĐ: {{contractId}}",

    fields: [
        { id: "contractId", label: "Số hợp đồng", type: "text", format: "uppercase" },
        { id: "phone", label: "Số điện thoại đăng ký", type: "text", placeholder: "Ví dụ: 0912345689" },
        { id: "emailPhucDap", label: "Email khách hàng", type: "text", placeholder: "Ví dụ: khachhang@gmail.com" },
        { id: "khieuNai", label: "Tóm tắt vấn đề khiếu nại/thắc mắc", type: "textarea", placeholder: "Ví dụ: Yêu cầu giải đáp thông tin gói cước" },
        { id: "huongXuLy", label: "Đề xuất / Hướng xử lý", type: "textarea", placeholder: "Ví dụ: - Chuyển đổi gói dịch vụ sang Super300 Biz." },
        { id: "chiNhanhPhucDap", label: "Đơn vị / Chi nhánh phúc đáp", type: "text", format: "titlecase", placeholder: "Ví dụ: FPT Telecom chi nhánh Đống Đa" }
    ],

    computedVars: function(data) {
        const pronoun = data.pronoun || "Quý khách";
        return {
            pronoun: pronoun,
            pronounLc: pronoun.toLowerCase(),
            khieuNaiBr: (data.khieuNai && data.khieuNai !== '[khieuNai]') ? data.khieuNai.replace(/\n/g, '<br>') : '[Tóm tắt khiếu nại]',
            huongXuLyBr: (data.huongXuLy && data.huongXuLy !== '[huongXuLy]') ? data.huongXuLy.replace(/\n/g, '<br>') : '[Hướng xử lý]'
        }
    },

    boxContent: `
        <b>I. Tóm tắt nội dung thắc mắc/khiếu nại:</b><br>
        <div style="padding-left: 15px; margin-bottom: 10px; font-style: italic;">{{khieuNaiBr}}</div>
        <b>II. Phương án xử lý / Đề xuất:</b><br>
        <div style="padding-left: 15px; margin-bottom: 10px;">{{huongXuLyBr}}</div>
    `,

    body: `
        <b>Kính gửi:</b> {{honorific}} <b>{{customerName}}</b><br>
        <b>Email:</b> {{emailPhucDap}} &nbsp;|&nbsp; <b>Số điện thoại:</b> <b>{{phone}}</b><br><br>
        Lời đầu tiên, Chi nhánh Công ty Cổ phần Viễn thông FPT <i>(sau đây gọi là “FPT Telecom”)</i> chân thành cảm ơn {{pronoun}} và Quý công ty đã tin tưởng sử dụng dịch vụ của chúng tôi.<br><br>
        Liên quan đến yêu cầu kiểm tra và khiếu nại đối với hợp đồng <b>{{contractId}}</b>, chúng tôi xin được phúc đáp chi tiết như sau:<br>
        {INFO_BOX}
        Để thực hiện theo phương án đề xuất, {{pronoun}} vui lòng phản hồi lại email này để bộ phận phụ trách tiếp tục xử lý các thủ tục liên quan theo đúng nguyện vọng của {{pronounLc}}.<br><br>
        Chúng tôi chân thành xin lỗi vì những bất tiện {{pronoun}} đã gặp phải trong thời gian qua và trân trọng cảm ơn những ý kiến đóng góp quý báu để FPT Telecom không ngừng nâng cao chất lượng phục vụ.<br><br>
        Trân trọng./.<br>
        <b>{{chiNhanhPhucDap}}</b>
    `,

    customSignature: `
        <b>TRUNG TÂM CHĂM SÓC KHÁCH HÀNG FPT TELECOM</b><br>
        🌐 www.fpt.vn | ✉️ hotrokhachhang@fpt.com<br><br>
        <span style="color: #f26f21; font-weight: bold; letter-spacing: 0.5px;">QUÉT QR Hi FPT – PHỤC VỤ MỌI YÊU CẦU CHỈ TRONG 1 CHẠM</span>
    `
};

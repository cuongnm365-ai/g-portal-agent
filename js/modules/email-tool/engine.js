/* =========================================================
   BỘ NÃO XỬ LÝ (ENGINE) - Module "Soạn Email" (SOC Command Center cũ)
   Đã gộp vào G-Portal — thay đổi so với bản gốc:
   - Bỏ hoàn toàn phụ thuộc vào `authManager` (hệ đăng nhập Google riêng
     của bản cũ, file JS/google-auth.js đã bị loại bỏ). Tên Agent mặc định
     và thông tin gửi kèm thống kê giờ lấy từ AppState.userProfile — hồ sơ
     Google DUY NHẤT dùng chung cho toàn bộ G-Portal (xem js/core/googleSync.js).
   - Toàn bộ phần còn lại (render form động, sinh nội dung email theo mẫu,
     format tiền tệ, DOMPurify, tracking Google Analytics, copy nội dung,
     CC/BCC theo vùng miền...) giữ nguyên logic gốc.
   ========================================================= */

const SYSTEM_ASSETS = {
    "cai_dat": { img: "https://tools.manhcuongit.online/Images/Picture/cai-dat-nhanh.jpg", link: "https://hi.fpt.vn/rev/lbq/P3M3JDZB" },
    "theo_doi_ktv": { img: "https://tools.manhcuongit.online/Images/Picture/theo-doi-ktv.jpg", link: "https://hi.fpt.vn/rev/lbq/P3M3JDZB" },
    "thanh_toan": { img: "https://tools.manhcuongit.online/Images/Picture/thanh-toan-nhanh.jpg", link: "https://hi.fpt.vn/rev/fbu/1dnN3BoM" },
    "bao_hong": { img: "https://tools.manhcuongit.online/Images/Picture/bao-hong-nhanh.jpg", link: "https://hi.fpt.vn/rev/esv/Mq9r4jlG" }
};

window.SOC_TEMPLATES = window.SOC_TEMPLATES || {};
let currentTemplateId = "";

// --- HÀM TRACKING GOOGLE ANALYTICS ---
function trackTemplateUsage(method) {
    if (!currentTemplateId) return;
    const templateName = window.SOC_TEMPLATES[currentTemplateId]?.name || currentTemplateId;

    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({
        'event': 'use_template',
        'template_id': currentTemplateId,
        'template_name': templateName,
        'copy_method': method
    });
    console.log(`[Tracking] Đã ghi nhận sử dụng mẫu: ${templateName} (${method})`);
}

document.addEventListener("DOMContentLoaded", () => {
    const selector = document.getElementById("templateSelector");
    if (selector) {
        selector.innerHTML = '<option value="">-- Chọn nghiệp vụ / Mẫu email phục vụ --</option>';
        for (const [id, template] of Object.entries(window.SOC_TEMPLATES)) {
            selector.innerHTML += `<option value="${id}">${template.name}</option>`;
        }
        selector.addEventListener("change", (e) => {
            currentTemplateId = e.target.value;
            renderForm(currentTemplateId);
        });
    }

    const btnReset = document.getElementById("btnReset");
    if (btnReset) btnReset.addEventListener("click", () => renderForm(currentTemplateId));

    const btnCopy = document.getElementById("btnCopy");
    if (btnCopy) btnCopy.addEventListener("click", () => {
        copyEmailContent();
        trackTemplateUsage('button_click');
    });

    setupDoubleClickCopy("ccDisplay", "ccValue", "CC");
    setupDoubleClickCopy("bccDisplay", "bccValue", "BCC");

    document.addEventListener("copy", (e) => {
        const selection = document.getSelection();
        const emailContentNode = document.getElementById("emailContent");

        if (emailContentNode && selection.anchorNode && emailContentNode.contains(selection.anchorNode)) {
            trackTemplateUsage('manual_select');
        }
    });

    // Nếu hồ sơ Google (tên/email) đến sau khi form email đã render (VD: người
    // dùng vào thẳng module Soạn Email trong lúc đang đăng nhập ngầm), tự làm
    // mới ô "Tên Agent xử lý" một lần nếu người dùng chưa từng tự nhập tay.
    window.addEventListener('gportal_profile_ready', () => {
        const staffInput = document.getElementById('field_staffName');
        const saved = localStorage.getItem("soc_agent_name") || "";
        if (staffInput && !saved && typeof AppState !== 'undefined' && AppState.userProfile && AppState.userProfile.name) {
            staffInput.value = AppState.userProfile.name;
            renderEmail();
        }
    });
});

function getFieldHtml(field) {
    let formatAttr = field.format ? `data-format="${field.format}"` : "";
    let extraHtml = "";
    if (field.id === "phone") {
        extraHtml = `<div id="phone_error" style="display: none; color: #dc2626; font-size: 12px; margin-top: 4px; font-weight: 500;">Sai định dạng số ĐT</div>`;
    }

    if (field.type === "textarea") {
        return `<textarea id="field_${field.id}" rows="4" class="soc-input template-input w-full" ${formatAttr} placeholder="${field.placeholder || ''}"></textarea>${extraHtml}`;
    } else if (field.type === "select") {
        let html = `<select id="field_${field.id}" class="soc-input template-input w-full">`;
        field.options.forEach(opt => html += `<option value="${opt.value}">${opt.text}</option>`);
        return html + `</select>${extraHtml}`;
    } else if (field.type === "date") {
        return `<input type="date" id="field_${field.id}" class="soc-input template-input w-full">${extraHtml}`;
    } else if (field.type === "checkbox") {
        return `<input type="checkbox" id="field_${field.id}" class="template-input cursor-pointer" style="transform: scale(1.3);">${extraHtml}`;
    } else {
        return `<input type="text" id="field_${field.id}" class="soc-input template-input w-full" ${formatAttr} placeholder="${field.placeholder || ''}">${extraHtml}`;
    }
}

function renderForm(templateId) {
    const formContainer = document.getElementById("dynamicForm");
    const template = window.SOC_TEMPLATES[templateId];

    if (!template) {
        formContainer.innerHTML = '<p class="text-center text-slate-400 text-sm italic py-10 font-medium">Vui lòng chọn một mẫu để hệ thống tự động lắp ráp Form...</p>';
        const emailHeaders = document.getElementById("emailHeaders");
        if (emailHeaders) emailHeaders.classList.add("hidden");
        return;
    }

    // Ưu tiên tên do người dùng tự lưu tay (localStorage), sau đó mới tới hồ sơ
    // Google đang đăng nhập (AppState.userProfile, dùng chung cho cả G-Portal).
    let savedAgentName = localStorage.getItem("soc_agent_name") || "";
    if (!savedAgentName && typeof AppState !== "undefined" && AppState.userProfile && AppState.userProfile.name) {
        savedAgentName = AppState.userProfile.name;
    }

    let html = "";

    if (!template.hideCustomerInfo) {
        html += `
            <div class="mb-4">
                <label class="soc-label">Tên Agent xử lý:</label>
                <input type="text" id="field_staffName" class="soc-input template-input w-full" data-format="titlecase" placeholder="Ví dụ: Nguyễn Văn A" value="${savedAgentName}">
            </div>
            <div class="flex gap-3 mb-4">
                <div class="w-1/3">
                    <label class="soc-label">Danh xưng:</label>
                    <select id="field_gender" class="soc-input template-input w-full">
                        <option value="Anh">Anh</option><option value="Chị">Chị</option>
                        <option value="Cô">Cô</option><option value="Chú">Chú</option>
                        <option value="Bác">Bác</option><option value="Doanh Nghiệp">Doanh Nghiệp</option>
                    </select>
                </div>
                <div class="w-2/3">
                    <label class="soc-label">Tên khách hàng:</label>
                    <input type="text" id="field_customerName" class="soc-input template-input w-full" data-format="titlecase" placeholder="Nhập tên KH">
                </div>
            </div>
        `;
    }

    if (template.fields) {
        template.fields.forEach(field => {
            if (field.type === "row") {
                html += `<div class="flex gap-4 mb-4 items-end">`;
                field.fields.forEach(sub => {
                    let wCls = sub.width || "flex-1";
                    html += `<div class="${wCls}">`;
                    if (sub.type !== "checkbox") {
                        html += `<label class="soc-label block mb-1">${sub.label}:</label>`;
                        html += getFieldHtml(sub);
                    } else {
                        html += `<div class="flex items-center h-[38px] pb-2">`;
                        html += getFieldHtml(sub);
                        html += `<label for="field_${sub.id}" class="soc-label mb-0 ml-2 cursor-pointer font-medium">${sub.label}</label>`;
                        html += `</div>`;
                    }
                    html += `</div>`;
                });
                html += `</div>`;
            } else {
                html += `<div class="mb-4">`;
                if (field.type !== "checkbox") {
                    html += `<label class="soc-label block mb-1">${field.label}:</label>`;
                    html += getFieldHtml(field);
                } else {
                    html += `<div class="flex items-center">`;
                    html += getFieldHtml(field);
                    html += `<label for="field_${field.id}" class="soc-label mb-0 ml-2 cursor-pointer font-medium">${field.label}</label>`;
                    html += `</div>`;
                }
                html += `</div>`;
            }
        });
    }

    formContainer.innerHTML = html;

    document.querySelectorAll('.template-input').forEach(input => {
        input.addEventListener('input', (e) => {
            if (e.target.id === "field_staffName") localStorage.setItem("soc_agent_name", e.target.value);

            let formatAttr = e.target.getAttribute('data-format');
            if (formatAttr === 'uppercase') {
                let start = e.target.selectionStart;
                let end = e.target.selectionEnd;
                e.target.value = e.target.value.toUpperCase();
                e.target.setSelectionRange(start, end);
            } else if (formatAttr === 'titlecase') {
                let start = e.target.selectionStart;
                let end = e.target.selectionEnd;
                e.target.value = e.target.value.toLowerCase().replace(/(?:^|\s)\S/g, function(a) { return a.toUpperCase(); });
                e.target.setSelectionRange(start, end);
            } else if (formatAttr === 'currency') {
                let raw = e.target.value.replace(/[^\d]/g, '');
                if (raw) {
                    raw = String(parseInt(raw, 10));
                    e.target.value = Number(raw).toLocaleString('vi-VN');
                } else {
                    e.target.value = '';
                }
                e.target.setSelectionRange(e.target.value.length, e.target.value.length);
            }
            renderEmail();
        });

        if(input.tagName === 'SELECT') {
            input.addEventListener('change', renderEmail);
        }
    });

    renderEmail();
}

function renderEmail() {
    try {
        if (!currentTemplateId) return;
        const template = window.SOC_TEMPLATES[currentTemplateId];
        let data = {};

        document.querySelectorAll('.template-input').forEach(input => {
            let key = input.id.replace('field_', '');
            if (input.type === 'checkbox') {
                data[key] = input.checked;
            } else {
                let val = input.value;
                if (input.tagName.toLowerCase() === 'textarea' && val) {
                    val = val.replace(/\n/g, '<br>').replace(/ {2}/g, '&nbsp;&nbsp;');
                }
                data[key] = val || `[${key}]`;
            }
        });

        data.honorific = data.gender || "Anh/Chị";
        data.pronoun = (data.gender === 'Doanh Nghiệp') ? 'Quý công ty' : (data.gender || "Anh/Chị");
        data.pronounLc = data.pronoun.toLowerCase();
        if (data.gender === 'Doanh Nghiệp') data.honorific = 'Quý công ty';

        if (typeof template.computedVars === 'function') Object.assign(data, template.computedVars(data));

        const replaceVars = (text) => text ? text.replace(/\{\{(\w+)\}\}/g, (match, key) => data[key] !== undefined ? data[key] : match) : "";

        let infoBoxHtml = "";
        if (template.boxContent) {
            let qrSection = "";
            if (template.qrType && SYSTEM_ASSETS[template.qrType]) {
                let asset = SYSTEM_ASSETS[template.qrType];
                qrSection = `<td width="140" align="center" valign="middle" style="padding: 15px; border-left: 1px dashed #cbd5e0;"><a href="${asset.link}" target="_blank"><img src="${asset.img}" alt="QR Code" style="max-width: 120px;"></a></td>`;
            }

            let substitutedBox = replaceVars(template.boxContent);
            let formattedBox = substitutedBox
                .replace(/<ul[^>]*>/g, '<div style="margin: 0;">')
                .replace(/<\/ul>/g, '</div>')
                .replace(/<li[^>]*>/g, '<div style="margin-bottom: 6px; display: flex; align-items: flex-start;"><span style="margin-right: 8px; color: #f26f21;">➔</span><span>')
                .replace(/<\/li>/g, '</span></div>');

            infoBoxHtml = `<table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-left: 4px solid #f26f21; border-radius: 4px; margin: 12px 0;">
                <tr>
                    <td valign="middle" style="padding: 15px; font-family: sans-serif; font-size: 14.5px; color: #2d3748; line-height: 1.6;">
                        ${formattedBox}
                    </td>
                    ${qrSection}
                </tr>
            </table>`;
        }

        let finalBodyRaw = replaceVars(template.body).replace('{INFO_BOX}', infoBoxHtml);

        let finalBody = typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(finalBodyRaw) : finalBodyRaw;

        let agentName = (data.staffName && data.staffName !== "[staffName]") ? data.staffName : "[Tên Agent]";
        let finalSigRaw = template.customSignature ? replaceVars(template.customSignature) : `Trân trọng,<br>Em <b>${agentName}</b> – CSKH FPT Telecom.`;

        let finalSig = typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(finalSigRaw) : finalSigRaw;

        if (template.hideSignature) finalSig = "";

        displayEmailHeaders(template, data);

        const emailSubject = document.getElementById("emailSubject");
        if (emailSubject) emailSubject.innerText = replaceVars(template.subject);

        const emailContent = document.getElementById("emailContent");
        if (emailContent) emailContent.innerHTML = finalBody;

        const emailSignature = document.getElementById("emailSignature");
        if (emailSignature) emailSignature.innerHTML = finalSig;

    } catch (error) {
        console.error("Lỗi Render Email:", error);
    }
}

/* =========================================================
   HÀM CẬP NHẬT HEADER EMAIL (CC/BCC)
   ========================================================= */
function displayEmailHeaders(template, data) {
    try {
        const headersDiv = document.getElementById("emailHeaders");
        const ccDisplay = document.getElementById("ccDisplay");
        const bccDisplay = document.getElementById("bccDisplay");
        const ccValue = document.getElementById("ccValue");
        const bccValue = document.getElementById("bccValue");

        if (!headersDiv || !ccDisplay || !bccDisplay) return;

        ccDisplay.classList.add("hidden");
        bccDisplay.classList.add("hidden");
        headersDiv.classList.add("hidden");

        if (typeof regionManager === "undefined") return;

        let hasCC = false;
        let hasBCC = false;

        const contractId = document.getElementById("field_contractId")?.value || "";
        const region = regionManager.detectRegion(contractId);
        const regionEmail = regionManager.getRegionEmail(region);

        if (regionEmail) {
            ccValue.textContent = regionEmail;
            ccDisplay.classList.remove("hidden");
            hasCC = true;
        }

        const bccEmail = (!template.hideBcc) ? (regionManager.settings.defaultBccEmail || "") : "";
        if (bccEmail) {
            bccValue.textContent = bccEmail;
            bccDisplay.classList.remove("hidden");
            hasBCC = true;
        }

        if (hasCC || hasBCC) {
            headersDiv.classList.remove("hidden");
        }

    } catch (e) {
        console.error("Lỗi hiển thị Header CC/BCC:", e);
    }
}

function setupDoubleClickCopy(containerId, valueId, typeName) {
    const container = document.getElementById(containerId);
    const valueEl = document.getElementById(valueId);

    if (container && valueEl) {
        container.setAttribute("title", `Nhấp đúp chuột để copy nhanh danh sách email ${typeName}`);
        container.classList.add("cursor-pointer", "hover:bg-blue-100", "transition", "rounded", "px-1");
        container.addEventListener("dblclick", () => {
            const textToCopy = valueEl.textContent.trim();
            if (textToCopy) {
                navigator.clipboard.writeText(textToCopy).then(() => showToast(`Đã copy danh sách ${typeName}!`));
            }
        });
    }
}

function copyEmailContent() {
    const contentEl = document.getElementById('emailContent');
    const sigEl = document.getElementById('emailSignature');

    if (!contentEl) return;

    const cloneContent = document.createElement('div');
    cloneContent.innerHTML = contentEl.innerHTML;

    const qrImages = cloneContent.querySelectorAll('img[src*="tools.manhcuongit"]');
    qrImages.forEach(img => {
        img.style.width = "160px";
        img.style.height = "auto";
        img.style.maxWidth = "100%";
        if (img.closest('td')) {
            img.closest('td').style.width = "170px";
        }
    });

    const content = cloneContent.innerHTML;
    const sig = sigEl ? sigEl.innerHTML : "";

    const fullHtml = `
        <div style="font-family: 'Aptos', 'Segoe UI', Arial, sans-serif; font-size: 12pt; color: #2d3748; max-width: 800px; margin: 0 auto; line-height: 1.5;">
            ${content}
            ${sig ? `<br><br>${sig}` : ''}
        </div>
    `;

    // --- GHI NHẬN THỐNG KÊ & PUSH LÊN GOOGLE SHEETS API ---
    if (typeof currentTemplateId !== 'undefined' && currentTemplateId) {
        try {
            let stats = JSON.parse(localStorage.getItem('soc_template_stats')) || {};
            stats[currentTemplateId] = (stats[currentTemplateId] || 0) + 1;
            localStorage.setItem('soc_template_stats', JSON.stringify(stats));
        } catch (e) { console.error("Lỗi local storage:", e); }

        const STATS_API_URL = "https://script.google.com/macros/s/AKfycbzIGRhMMZ5KLjjNgkocTxX0CrEM2_zTipwK4LGQfJweaEsRejqOksxG3C8XfopB0gZ4/exec";
        if (STATS_API_URL && !STATS_API_URL.includes("DÁN_LINK")) {
            const templateObj = window.SOC_TEMPLATES[currentTemplateId];
            const tName = templateObj ? templateObj.name : currentTemplateId;
            // Lấy tên/email từ hồ sơ Google DUY NHẤT của G-Portal (AppState.userProfile)
            const user = (typeof AppState !== 'undefined' && AppState.userProfile)
                ? AppState.userProfile
                : { name: "Nhân viên", email: "Khuyết danh" };

            fetch(STATS_API_URL, {
                method: "POST",
                headers: { "Content-Type": "text/plain;charset=utf-8" },
                body: JSON.stringify({
                    userName: user.name,
                    userEmail: user.email,
                    templateId: currentTemplateId,
                    templateName: tName
                })
            }).catch(e => console.log("Gửi API ngầm bị lỗi (Mạng):", e));
        }
    }
    // -------------------------------------------------------------------------

    const blob = new Blob([fullHtml], { type: 'text/html' });
    const data = [new ClipboardItem({ 'text/html': blob })];

    navigator.clipboard.write(data).then(() => {
        showToast("Đã copy thành công nội dung phục vụ!");
        if (typeof renderTemplateStatistics === 'function' && document.getElementById('statsTab') && document.getElementById('statsTab').classList.contains('active')) {
            renderTemplateStatistics();
        }
    }).catch(() => {
        alert("Trình duyệt chặn Copy ẩn. Vui lòng bôi đen nội dung và nhấn Ctrl+C.");
    });
}

function showToast(msg) {
    const toast = document.getElementById('toast');
    const toastMessage = document.getElementById('toast-message');
    if (toast && toastMessage) {
        toastMessage.innerText = msg;
        toast.classList.remove('hidden');
        toast.classList.add('flex');
        setTimeout(() => {
            toast.classList.add('hidden');
            toast.classList.remove('flex');
        }, 3000);
    }
}

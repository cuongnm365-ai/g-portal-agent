(function () {
    'use strict';

    const TABLE_KEY = 'gportal_complaint_records_v1';
    const SHEET_ID_KEY = 'gportal_complaint_sheet_id';
    const SHEET_ROWS_KEY = 'gportal_complaint_sheet_rows_v1';
    const COLUMN_VISIBILITY_KEY = 'gportal_complaint_visible_columns_v1';
    const SHEET_NAME = 'Complaint Management';
    const SHEET_TAB = 'Complaint';
    const SHEET_HEADERS = [
        'STT', 'Nguồn', 'KV', 'CN', 'SHĐ/SĐT', 'Nick FTel',
        'Tên Nick KH & Link URL Profile cá nhân hoặc Email KH',
        'Link URL bài post (Chỉ có khi là MXH)', 'Nội dung bài viết MXH/ Email', 'Cấp độ',
        'TG KH p/anh (FB: time post bài - Email: time KH gửi)', 'TG nhận mail (Alert)',
        'TG phản hồi KH lần đầu tiên', 'TG xử lý HT', 'Account Tiếp nhận', 'Acount Chủ trì',
        'Account XL cuối cùng', 'Loại YC SR (cấp 1)', 'Loại YC SR (cấp 2)',
        'Loại dịch vụ KH khiếu nại', 'Ghi chú', 'Đơn vị xử lý (- SOC HTTC - Phối hợp đơn vị)',
        'Voucher', 'KQ', 'SR'
    ];
    const COMPLAINT_COLUMN_LABELS = [
        'STT', 'Nguồn', 'Trạng thái', 'KV', 'CN', 'SHĐ/SĐT', 'Nick FTel', 'KH / Profile / Email',
        'Link bài viết', 'Nội dung', 'Cấp độ', 'TG KH phản ánh', 'TG nhận mail', 'TG phản hồi đầu',
        'TG xử lý HT', 'Account tiếp nhận', 'Account chủ trì', 'Account XL cuối', 'YC SR cấp 1',
        'YC SR cấp 2', 'Dịch vụ KH', 'Ghi chú', 'Đơn vị xử lý', 'Voucher', 'KQ', 'SR'
    ];
    const DEFAULT_ACCOUNT = 'CuongNM3';
    const CONTRACT_PREFIXES = [
        'HN','QN','HD','DA','NT','DN','BD','BG','BN','CB','HA','HB','LC','LS','PT','TN','TQ','VP','YB','DB','HM','HY','NA','NB','SL','TB','TH','SG','HP','BI','DK','DL','GL','HU','KT','PY','QB','QI','QA','QT','BT','LA','LD','NN','TI','AG','BL','CM','BE','CT','DT','HG','KG','ST','TG','TV','VL','LI','BK','VT','ND','HT','BP'
    ];

    const complaintState = {
        records: [],
        editingId: null,
        lastParsed: null,
        stage: 'initial',
        detected: null
    };

    function escapeHtml(value) {
        return String(value === undefined || value === null ? '' : value).replace(/[&<>"']/g, (char) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[char]));
    }

    function normalizeText(value) {
        return String(value === undefined || value === null ? '' : value).trim();
    }

    function normalizePhone(raw) {
        const value = normalizeText(raw).replace(/[^0-9+]/g, '');
        if (!value) return '';
        if (/^\+84\d{9,10}$/.test(value)) return '0' + value.slice(3);
        if (/^84\d{9,10}$/.test(value)) return '0' + value.slice(2);
        if (/^0\d{9,10}$/.test(value)) return value;
        if (/^\d{9,10}$/.test(value)) return '0' + value;
        return value;
    }

    function toLocalInput(dt) {
        if (!dt) return '';
        if (typeof dt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(dt)) return dt;
        const d = new Date(dt);
        if (Number.isNaN(d.getTime())) return '';
        const offset = d.getTimezoneOffset();
        const local = new Date(d.getTime() - offset * 60000);
        return local.toISOString().slice(0, 16);
    }

    function getWorkflowSettings() {
        return window.workflowSettings || { regions: [], sources: [], requestTypes: [], srTypes: [], fbAccounts: [], levels: [], handlingUnits: [], vouchers: [], results: [], complaintServices: [] };
    }

    function slugify(value) {
        return normalizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    }

    function unique(values) {
        const seen = new Set();
        return values.filter((value) => {
            const key = normalizeText(value).toLowerCase();
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    function safeLocalGet(key) {
        try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; }
    }

    function safeLocalSet(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { console.warn('[Complaint] localStorage save failed:', e); }
    }

    function getComplaintSourceOptions() {
        const setting = getWorkflowSettings();
        const fromWorkflow = (setting.sources || []).map((item) => item && item.name ? item.name : item).filter(Boolean);
        const fallback = ['Facebook', 'Email', 'X', 'Zalo', 'Other social media channels'];
        return unique(fromWorkflow.concat(fallback));
    }

    function getKVOptions() {
        const setting = getWorkflowSettings();
        const regions = Array.isArray(setting.regions) ? setting.regions : [];
        const kvs = regions.map((item) => item && item.region ? item.region : '');
        return unique(kvs.concat('CXD'));
    }

    function getCNOptionsByKV(kv) {
        const setting = getWorkflowSettings();
        const regions = Array.isArray(setting.regions) ? setting.regions : [];
        if (!kv || kv === 'CXD') return ['CXD'];
        const matched = regions.find((item) => normalizeText(item.region) === normalizeText(kv));
        if (!matched) return ['CXD'];
        const branches = Array.isArray(matched.branches) ? matched.branches : [];
        return unique(branches.map((item) => normalizeText(item)).concat('CXD'));
    }

    function getFTelOptionsByKV(kv) {
        const setting = getWorkflowSettings();
        const list = Array.isArray(setting.fbAccounts) ? setting.fbAccounts : [];
        if (!kv) return unique(list.map((item) => item && item.name ? item.name : item).filter(Boolean));
        const matched = list.filter((item) => {
            const name = normalizeText(item && item.name ? item.name : item);
            const kvName = normalizeText(item && item.kv ? item.kv : '');
            return !kvName || kvName === kv || name.toLowerCase().includes(kv.toLowerCase());
        });
        return unique(matched.map((item) => item && item.name ? item.name : item).filter(Boolean));
    }

    function getLevelOptions() {
        const setting = getWorkflowSettings();
        const values = Array.isArray(setting.levels) ? setting.levels : [];
        return unique(values.map((item) => item && item.name ? item.name : item).filter(Boolean));
    }

    function getSRType1Options() {
        const tree = getWorkflowSettings().srTypes || [];
        return unique(tree.map((item) => item && item.type ? item.type : item).filter(Boolean));
    }

    function getSRType2Options(level1) {
        const tree = getWorkflowSettings().srTypes || [];
        const match = tree.find((item) => normalizeText(item.type) === normalizeText(level1));
        return match ? unique((match.subTypes || []).map(normalizeText).filter(Boolean)) : [];
    }

    function getSimpleOptions(key, fallback) {
        const setting = getWorkflowSettings();
        const values = Array.isArray(setting[key]) ? setting[key] : [];
        const out = values.map((item) => item && item.name ? item.name : item).filter(Boolean);
        return unique(out.length ? out : fallback);
    }

    function fillSelect(select, options, selectedValue) {
        if (!select) return;
        const before = select.value;
        select.innerHTML = '<option value="">-- Chọn --</option>' + options.map((option) => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`).join('');
        if (selectedValue && options.includes(selectedValue)) select.value = selectedValue;
        else if (before && options.includes(before)) select.value = before;
        else select.value = '';
    }

    function fillDatalist(list, options) {
        if (!list) return;
        list.innerHTML = unique(options).map((value) => `<option value="${escapeHtml(value)}"></option>`).join('');
    }

    function renderBranchOptions() {
        const list = document.getElementById('complaint-cn-options');
        const filter = document.getElementById('complaint-cn-filter');
        const selected = document.getElementById('complaint-cn')?.value || '';
        if (!list) return;
        const query = normalizeText(filter?.value).toLocaleLowerCase();
        const options = getCNOptionsByKV(document.getElementById('complaint-kv')?.value || '')
            .filter((option) => option !== 'CXD' && option.toLocaleLowerCase().includes(query));
        list.replaceChildren();
        if (!options.length) {
            const empty = document.createElement('div');
            empty.className = 'complaint-branch-empty';
            empty.textContent = 'Không có chi nhánh phù hợp';
            list.appendChild(empty);
            return;
        }
        options.forEach((option) => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'complaint-branch-option';
            item.setAttribute('role', 'option');
            item.setAttribute('aria-selected', String(option === selected));
            item.textContent = option;
            item.addEventListener('click', () => {
                const select = document.getElementById('complaint-cn');
                const input = document.getElementById('complaint-cn-search');
                setComboValue(select, input, option);
                const origin = document.getElementById('complaint-branch-origin');
                if (origin) origin.textContent = complaintState.detected?.branch === option ? 'Đã tự phát hiện' : 'Đã chọn thủ công';
                const menu = document.getElementById('complaint-cn-menu');
                if (menu) menu.hidden = true;
                if (input) input.setAttribute('aria-expanded', 'false');
            });
            list.appendChild(item);
        });
    }

    function setComboValue(select, input, value) {
        const clean = normalizeText(value);
        if (select && clean) {
            if (![...select.options].some((option) => option.value === clean)) select.add(new Option(clean, clean));
            select.value = clean;
        } else if (select) select.value = '';
        if (input) input.value = clean;
    }

    function updateRelatedDropdowns() {
        const kv = document.getElementById('complaint-kv') ? document.getElementById('complaint-kv').value : '';
        const cnSelect = document.getElementById('complaint-cn');
        const fTelSelect = document.getElementById('complaint-ftel');
        const cnInput = document.getElementById('complaint-cn-search');
        const fTelInput = document.getElementById('complaint-ftel-search');
        const srType1 = document.getElementById('complaint-request-type-1') ? document.getElementById('complaint-request-type-1').value : '';

        if (cnSelect) {
            const current = cnInput?.value || cnSelect.value;
            fillSelect(cnSelect, getCNOptionsByKV(kv), current || '');
            renderBranchOptions();
        }
        if (fTelSelect) {
            const current = fTelInput?.value || fTelSelect.value;
            fillSelect(fTelSelect, getFTelOptionsByKV(kv), current || '');
            fillDatalist(document.getElementById('complaint-ftel-options'), getFTelOptionsByKV(kv));
        }

        const request2 = document.getElementById('complaint-request-type-2');
        if (request2) fillSelect(request2, getSRType2Options(srType1), request2.value || '');
    }

    function collectWorkflowOptions() {
        fillSelect(document.getElementById('complaint-source'), getComplaintSourceOptions(), '');
        fillSelect(document.getElementById('complaint-kv'), getKVOptions(), '');
        fillSelect(document.getElementById('complaint-level'), getLevelOptions(), '');
        fillSelect(document.getElementById('complaint-request-type-1'), getSRType1Options(), '');
        fillSelect(document.getElementById('complaint-ftel'), getFTelOptionsByKV(''), '');
        fillSelect(document.getElementById('complaint-service-type'), getSimpleOptions('complaintServices', ['Internet', 'TV', 'Phone', 'Di động', 'Data', 'Khác']), '');
        fillSelect(document.getElementById('complaint-handling-unit'), getSimpleOptions('handlingUnits', ['SOC HTTC', 'Phối hợp đơn vị']), '');
        fillSelect(document.getElementById('complaint-voucher'), getSimpleOptions('vouchers', []), '');
        fillDatalist(document.getElementById('complaint-voucher-options'), getSimpleOptions('vouchers', []));
        fillSelect(document.getElementById('complaint-result'), getSimpleOptions('results', ['Đã xử lý', 'Đang xử lý', 'Chưa xử lý', 'Khác']), '');
        fillSelect(document.getElementById('complaint-cn'), getCNOptionsByKV(''), '');
        fillSelect(document.getElementById('complaint-request-type-2'), [], '');
        document.getElementById('complaint-account-receive').value = '';
        document.getElementById('complaint-account-lead').value = '';
        document.getElementById('complaint-account-last').value = '';
    }

    function showComplaintModal(mode, row) {
        const modal = document.getElementById('complaint-modal');
        if (!modal) return;
        const title = document.getElementById('complaint-modal-title');
        const deleteBtn = document.getElementById('btn-delete-complaint');
        const saveBtn = document.getElementById('btn-save-complaint');
        if (title) title.textContent = mode === 'edit' ? 'Chỉnh sửa khiếu nại' : 'Thêm khiếu nại mới';
        if (deleteBtn) deleteBtn.style.display = mode === 'edit' ? 'inline-flex' : 'none';
        if (saveBtn) saveBtn.textContent = 'Lưu';
        complaintState.editingId = row && row.id ? row.id : null;
        populateComplaintForm(row || {});
        modal.style.display = 'flex';
        modal.classList.add('active');
    }

    function closeComplaintModal() {
        const modal = document.getElementById('complaint-modal');
        if (modal) {
            modal.classList.remove('active');
            modal.style.display = 'none';
        }
        complaintState.editingId = null;
        complaintState.lastParsed = null;
    }

    function populateComplaintForm(row) {
        const values = row || {};
        const fields = {
            source: document.getElementById('complaint-source'),
            kv: document.getElementById('complaint-kv'),
            cn: document.getElementById('complaint-cn'),
            phone: document.getElementById('complaint-phone'),
            ftel: document.getElementById('complaint-ftel'),
            customer: document.getElementById('complaint-customer'),
            customerProfile: document.getElementById('complaint-customer-profile'),
            postUrl: document.getElementById('complaint-post-url'),
            content: document.getElementById('complaint-content'),
            level: document.getElementById('complaint-level'),
            customerTime: document.getElementById('complaint-customer-time'),
            alertTime: document.getElementById('complaint-alert-time'),
            firstReply: document.getElementById('complaint-first-reply'),
            completeTime: document.getElementById('complaint-complete-time'),
            accountReceive: document.getElementById('complaint-account-receive'),
            accountLead: document.getElementById('complaint-account-lead'),
            accountLast: document.getElementById('complaint-account-last'),
            requestType1: document.getElementById('complaint-request-type-1'),
            requestType2: document.getElementById('complaint-request-type-2'),
            serviceType: document.getElementById('complaint-service-type'),
            srCode: document.getElementById('complaint-sr-code'),
            handlingUnit: document.getElementById('complaint-handling-unit'),
            voucher: document.getElementById('complaint-voucher'),
            result: document.getElementById('complaint-result'),
            status: document.getElementById('complaint-status'),
            note: document.getElementById('complaint-note'),
            paste: document.getElementById('complaint-paste-text')
        };

        const sourceOptions = getComplaintSourceOptions();
        const kvOptions = getKVOptions();
        const levelOptions = getLevelOptions();
        const request1Options = getSRType1Options();
        const serviceOptions = getSimpleOptions('complaintServices', ['Internet', 'TV', 'Phone', 'Di động', 'Data', 'Khác']);
        const unitOptions = getSimpleOptions('handlingUnits', ['SOC HTTC', 'Phối hợp đơn vị']);
        const voucherOptions = getSimpleOptions('vouchers', []);
        const resultOptions = getSimpleOptions('results', ['Đã xử lý', 'Đang xử lý', 'Chưa xử lý', 'Khác']);

        fillSelect(fields.source, sourceOptions, values.source || '');
        fillSelect(fields.kv, kvOptions, values.kv || '');
        fillSelect(fields.cn, getCNOptionsByKV(values.kv || ''), values.cn || '');
        fillSelect(fields.ftel, getFTelOptionsByKV(values.kv || ''), values.nickFtel || '');
        fillSelect(fields.level, levelOptions, values.level || '');
        fillSelect(fields.requestType1, request1Options, values.requestType1 || '');
        fillSelect(fields.requestType2, getSRType2Options(values.requestType1 || ''), values.requestType2 || '');
        fillSelect(fields.serviceType, serviceOptions, values.serviceType || '');
        fillSelect(fields.handlingUnit, unitOptions, values.handlingUnit || '');
        fillSelect(fields.voucher, voucherOptions, values.voucher || '');
        setComboValue(fields.voucher, document.getElementById('complaint-voucher-search'), values.voucher || '');
        fillDatalist(document.getElementById('complaint-voucher-options'), voucherOptions);
        fillSelect(fields.result, resultOptions, values.result || '');
        setComboValue(fields.cn, document.getElementById('complaint-cn-search'), values.cn || '');
        setComboValue(fields.ftel, document.getElementById('complaint-ftel-search'), values.nickFtel || '');
        updateRelatedDropdowns();
        const branchOrigin = document.getElementById('complaint-branch-origin');
        const ftelOrigin = document.getElementById('complaint-ftel-origin');
        if (branchOrigin) branchOrigin.textContent = values.cn ? 'Giá trị đã lưu · có thể sửa' : 'Chọn thủ công hoặc dùng gợi ý';
        if (ftelOrigin) ftelOrigin.textContent = values.nickFtel ? 'Giá trị đã lưu · có thể sửa' : 'Chọn hoặc nhập tài khoản';
        if (fields.status && !Array.from(fields.status.options).some((option) => option.value === (values.status || 'In Process'))) {
            fields.status.add(new Option(values.status || 'In Process', values.status || 'In Process'));
        }
        if (fields.status) fields.status.value = values.status || 'In Process';
        const statusBadge = document.getElementById('complaint-status-badge');
        if (statusBadge) statusBadge.textContent = values.status || 'In Process';

        fields.phone.value = values.phone || values.contractNo || '';
        fields.customer.value = values.customer || values.customerInfo || '';
        fields.customerProfile.value = values.customerProfile || values.customerEmail || '';
        fields.postUrl.value = values.postUrl || '';
        fields.postUrl.style.display = 'none';
        updatePostLinkDisplay();
        fields.content.value = values.complaintText || '';
        fields.customerTime.value = toLocalInput(values.complaintTime || values.customerComplaintTime || '');
        fields.alertTime.value = toLocalInput(values.alertReceivedTime || '');
        fields.firstReply.value = toLocalInput(values.firstReplyTime || '');
        fields.completeTime.value = toLocalInput(values.handlingCompletedTime || '');
        fields.accountReceive.value = values.accountReceive || '';
        fields.accountLead.value = values.accountLead || '';
        fields.accountLast.value = values.accountLast || '';
        fields.srCode.value = values.srCode || '';
        fields.note.value = values.note || '';
        complaintState.detected = null;
        updateProcessingDetection(fields.note.value, false);
        fields.paste.value = values.rawText || values.complaintText || '';

        if (Object.keys(values).some((key) => key !== 'id' && key !== 'createdAt' && Boolean(normalizeText(values[key])))) {
            fields.accountReceive.value = fields.accountReceive.value || DEFAULT_ACCOUNT;
            fields.accountLead.value = fields.accountLead.value || DEFAULT_ACCOUNT;
            fields.accountLast.value = fields.accountLast.value || DEFAULT_ACCOUNT;
        }

        const summary = document.getElementById('complaint-detection-summary');
        if (summary) summary.textContent = values.rawText ? 'Dữ liệu đã được phân tích từ paste' : 'Chưa phân tích';
        setComplaintStage('initial');
    }

    function parseComplaintEmail(text) {
        const whole = String(text || '').trim();
        const result = { detected: {}, confidence: {}, rawText: whole };
        if (!whole) return result;
        const lines = whole.replace(/\r/g, '').split('\n').map((line) => line.trim()).filter(Boolean);
        const emailMatches = [...whole.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)];
        const urls = [...whole.matchAll(/https?:\/\/[^\s\)\]>"']+/gi)].map((match) => match[0].replace(/[.,;]+$/, ''));
        const source = /facebook|fb\.com/i.test(whole) ? 'Facebook'
            : /x\.com|twitter/i.test(whole) ? 'X'
                : /zalo/i.test(whole) ? 'Zalo'
                    : /instagram/i.test(whole) ? 'Instagram'
                        : /tiktok/i.test(whole) ? 'TikTok'
                            : (emailMatches.length || /\b(sent|from):/i.test(whole)) ? 'Email' : 'Other social media channels';
        const createdMatch = whole.match(/(?:Created|Published|Date|Sent)\s*:\s*(?:(\d{1,2}:\d{2})\s+)?(\d{1,2})[/-](\d{1,2})[/-](\d{4})/i);
        const sentMatch = whole.match(/Sent\s*:\s*(?:(\d{1,2}:\d{2})\s+)?(\d{1,2})[/-](\d{1,2})[/-](\d{4})/i);
        const isoMatch = whole.match(/(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})/);
        const detectedTime = source === 'Email' && sentMatch
            ? `${sentMatch[4]}-${String(sentMatch[3]).padStart(2, '0')}-${String(sentMatch[2]).padStart(2, '0')}T${sentMatch[1] || '00:00'}`
            : createdMatch
            ? `${createdMatch[4]}-${String(createdMatch[3]).padStart(2, '0')}-${String(createdMatch[2]).padStart(2, '0')}T${createdMatch[1] || '00:00'}`
            : isoMatch ? `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}T${isoMatch[4]}:${isoMatch[5]}` : '';
        const emailSentLine = lines.find((line) => /^Sent\s*:/i.test(line)) || lines.find((line) => /^Date\s*:/i.test(line));
        const emailSentDate = emailSentLine ? new Date(emailSentLine.replace(/^(Sent|Date)\s*:\s*/i, '')) : null;
        const complaintTime = source === 'Email' && sentMatch ? detectedTime
            : source === 'Email' && emailSentDate && !Number.isNaN(emailSentDate.getTime()) ? toLocalInput(emailSentDate) : detectedTime || '';
        const receivedLine = lines.find((line) => /^(Received|Alert received|Mail received|TG nhận mail)\s*:/i.test(line));
        const receivedLocalMatch = receivedLine && receivedLine.match(/(?:(\d{1,2}:\d{2})\s+)?(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
        const receivedDate = receivedLine && !receivedLocalMatch ? new Date(receivedLine.replace(/^[^:]+:\s*/, '')) : null;
        const alertReceivedTime = receivedLocalMatch
            ? `${receivedLocalMatch[4]}-${String(receivedLocalMatch[3]).padStart(2, '0')}-${String(receivedLocalMatch[2]).padStart(2, '0')}T${receivedLocalMatch[1] || '00:00'}`
            : receivedDate && !Number.isNaN(receivedDate.getTime()) ? toLocalInput(receivedDate) : '';
        const commentMatch = whole.match(/Comment\s+from\s+([^|\n<]+)(?:\s*\|\s*Facebook)?/i);
        const postFromMatch = whole.match(/^\s*Post\s+from\s+([^|\n<]+)/im);
        const nameMatch = commentMatch || postFromMatch || whole.match(/(?:From|Sender|Author|Tên|Name|Họ tên|Customer|Khách hàng)\s*[:\-]?\s*([^\n<]+)/i);
        const customerName = nameMatch ? normalizeText(nameMatch[1]).replace(/\s*\|\s*Facebook.*$/i, '').replace(/\s*\|.*$/, '').trim() : '';
        const profileMatch = whole.match(/(?:Profile|URL Profile|Facebook Profile)\s*[:：]\s*(https?:\/\/[^\s]+)/i);
        const customerProfile = profileMatch ? profileMatch[1].replace(/[.,;]+$/, '') : (emailMatches[0] ? emailMatches[0][0] : '');
        const isProfileUrl = (url) => /facebook\.com\/(?:profile\.php|[A-Za-z0-9.]+\/?(?:\?.*)?$)/i.test(url);
        const profileUrl = customerProfile || urls.find(isProfileUrl) || '';
        const postUrl = urls.find((url) => !isProfileUrl(url) && /facebook|x\.com|twitter|instagram|zalo|linkedin|youtu|fpt/i.test(url))
            || urls.find((url) => !isProfileUrl(url)) || '';
        const srMatch = whole.match(/\b(?:Mã\s*SR|SR\s*[:#-]?|SR\s*ID)\s*[:\-]?\s*([A-Za-z0-9-]+)/i) || whole.match(/\b(SHI-[A-Z0-9-]+)\b/i);
        const complaintLines = lines.filter((line) => !/^ALERT\b/i.test(line)
            && !/^Comment\s+from\b/i.test(line)
            && !/^Post\s+from\b/i.test(line)
            && !/^(Created|Published|Date|Sent|Received|Alert received|Mail received|TG nhận mail)\s*:/i.test(line)
            && !/^\d{1,2}[/-]\d{1,2}[/-]\d{4}$/.test(line)
            && !/^(View post|View article)\b/i.test(line));
        const complaintContent = complaintLines.join('\n').trim() || whole;
        result.detected = {
            source, customerComplaintTime: complaintTime, alertReceivedTime, customerName,
            customerProfileUrl: profileUrl || (emailMatches[0] ? emailMatches[0][0] : ''), customerEmail: emailMatches[0] ? emailMatches[0][0] : '',
            postUrl, srCode: srMatch ? (srMatch[1] || srMatch[0]).trim() : '', complaintContent
        };
        result.confidence = {
            source: source === 'Other social media channels' ? 'low' : 'high',
            customerComplaintTime: complaintTime ? 'high' : 'low',
            alertReceivedTime: alertReceivedTime ? 'high' : 'low',
            customerName: customerName ? (commentMatch || postFromMatch ? 'high' : 'medium') : 'low',
            customerProfileUrl: profileUrl ? 'high' : 'low',
            postUrl: postUrl ? 'high' : 'low', srCode: srMatch ? 'high' : 'low',
            complaintContent: complaintContent ? 'high' : 'low'
        };
        return result;
    }

    function extractProcessingDetails(note) {
        const text = String(note || '');
        const workflow = getWorkflowSettings();
        const identifiers = typeof window.extractMonitoringIdentifiers === 'function'
            ? window.extractMonitoringIdentifiers(text) : { contractNo: '', phone: '', srCode: '' };
        const labeledContract = text.match(/(?:contract(?:\s*(?:no|number))?|hợp đồng|số hợp đồng|SHĐ)\s*[:#-]?\s*([A-Z0-9-]{6,20})/i);
        const contractMatch = text.match(/\b([A-Z]{2}[A-Z]{3}\d{4})\b/i);
        const contractNo = ((labeledContract && labeledContract[1]) || (contractMatch && contractMatch[1]) || identifiers.contractNo || '').toUpperCase();
        let phone = '';
        if (!contractNo) {
            const labeledPhone = text.match(/(?:phone|mobile|sđt|điện thoại)\s*[:#-]?\s*([+\d()\s.-]{9,})/i);
            const rawPhone = labeledPhone ? labeledPhone[1] : (text.match(/(?:\+?84|0)[\d\s().-]{8,16}/) || [''])[0];
            phone = normalizePhone(rawPhone);
            if (!/^0\d{9,10}$/.test(phone)) phone = '';
        }
        const regions = Array.isArray(workflow.regions) ? workflow.regions : [];
        const explicitRegion = text.match(/(?:region|khu vực|KV)\s*[:：]\s*([^\n,;]+)/i);
        let regionRecord = explicitRegion
            ? regions.find((item) => normalizeText(item.region).toLowerCase() === normalizeText(explicitRegion[1]).toLowerCase())
            : regions.filter((item) => normalizeText(item.region) && text.toLowerCase().includes(normalizeText(item.region).toLowerCase())).sort((a, b) => normalizeText(b.region).length - normalizeText(a.region).length)[0];
        if (!regionRecord && contractNo) regionRecord = regions.find((item) => normalizeText(item.provinceCode).toUpperCase() === contractNo.slice(0, 2));
        if (!regionRecord) regionRecord = regions.find((item) => (item.branches || []).some((branchName) => text.toLowerCase().includes(normalizeText(branchName).toLowerCase())));
        const region = regionRecord ? normalizeText(regionRecord.region) : 'CXD';
        const explicitBranch = text.match(/(?:branch|chi nhánh|CN)\s*[:：]\s*([^\n,;]+)/i);
        const branchList = regionRecord && Array.isArray(regionRecord.branches) ? regionRecord.branches : [];
        const branch = (explicitBranch && branchList.find((item) => normalizeText(item).toLowerCase() === normalizeText(explicitBranch[1]).toLowerCase()))
            || branchList.filter((item) => normalizeText(item) && text.toLowerCase().includes(normalizeText(item).toLowerCase())).sort((a, b) => normalizeText(b).length - normalizeText(a).length)[0]
            || 'CXD';
        const customerEmail = (text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i) || [''])[0];
        return { contractNo, phone, customerIdentifier: contractNo || phone, customerEmail, region, branch, srCode: identifiers.srCode || '' };
    }

    function updatePostLinkDisplay() {
        const input = document.getElementById('complaint-post-url');
        const link = document.getElementById('complaint-post-link-display');
        const empty = document.getElementById('complaint-post-link-empty');
        if (!input || !link || !empty) return;
        const url = normalizeText(input.value);
        const safeUrl = /^https?:\/\//i.test(url) ? url : '';
        link.href = safeUrl || '#';
        link.style.display = safeUrl ? 'inline-flex' : 'none';
        empty.style.display = safeUrl ? 'none' : 'inline';
    }

    function setComplaintStage(stage) {
        complaintState.stage = stage;
        const initial = document.getElementById('complaint-stage-initial');
        const processing = document.getElementById('complaint-stage-processing');
        const next = document.getElementById('btn-complaint-stage-next');
        const back = document.getElementById('btn-complaint-stage-back');
        const save = document.getElementById('btn-save-complaint');
        const isProcessing = stage === 'processing';
        if (initial) initial.style.display = isProcessing ? 'none' : 'block';
        if (processing) processing.style.display = isProcessing ? 'block' : 'none';
        if (next) next.style.display = !isProcessing && complaintState.editingId ? 'inline-flex' : 'none';
        if (back) back.style.display = isProcessing ? 'inline-flex' : 'none';
        if (save) save.innerHTML = isProcessing
            ? '<i class="bx bx-save"></i> Lưu thông tin xử lý'
            : `<i class="bx bx-save"></i> ${complaintState.editingId ? 'Lưu thông tin khiếu nại' : 'Tạo khiếu nại'}`;
    }

    function updateProcessingDetection(note, scanned) {
        if (!normalizeText(note)) {
            const previous = complaintState.detected || {};
            complaintState.detected = null;
            if (scanned) {
                const regionField = document.getElementById('complaint-kv');
                const branchField = document.getElementById('complaint-cn');
                const phoneField = document.getElementById('complaint-phone');
                const emailField = document.getElementById('complaint-customer-profile');
                const srField = document.getElementById('complaint-sr-code');
                if (phoneField && previous.customerIdentifier && phoneField.value === previous.customerIdentifier) phoneField.value = '';
                if (emailField && previous.customerEmail && emailField.value === previous.customerEmail) emailField.value = '';
                if (srField && previous.srCode && srField.value === previous.srCode) srField.value = '';
                if (regionField && (!regionField.value || regionField.value === previous.region || regionField.value === 'CXD')) regionField.value = 'CXD';
                if (branchField && (!branchField.value || branchField.value === previous.branch || branchField.value === 'CXD')) {
                    updateRelatedDropdowns();
                    branchField.value = 'CXD';
                }
            }
            return;
        }

        const detected = extractProcessingDetails(note);
        const previous = complaintState.detected || {};
        complaintState.detected = detected;
        const phoneField = document.getElementById('complaint-phone');
        const phoneIsAutomatic = phoneField && (!phoneField.value || phoneField.value === previous.customerIdentifier);
        const contractTakesPriority = detected.contractNo && phoneField && /^0\d{9,10}$/.test(phoneField.value);
        if (phoneField && (phoneIsAutomatic || contractTakesPriority)) {
            phoneField.value = detected.customerIdentifier;
        }
        const emailField = document.getElementById('complaint-customer-profile');
        if (emailField && detected.customerEmail && (!emailField.value || emailField.value === previous.customerEmail)) {
            emailField.value = detected.customerEmail;
        }
        const regionField = document.getElementById('complaint-kv');
        const branchField = document.getElementById('complaint-cn');
        const branchInput = document.getElementById('complaint-cn-search');
        if (regionField && (!regionField.value || regionField.value === 'CXD' || regionField.value === previous.region)) {
            const priorRegion = regionField.value;
            if (![...regionField.options].some((option) => option.value === detected.region)) regionField.add(new Option(detected.region, detected.region));
            regionField.value = detected.region;
            if (priorRegion !== detected.region && branchInput?.value && !getCNOptionsByKV(detected.region).includes(branchInput.value)) {
                setComboValue(branchField, branchInput, '');
                const branchOrigin = document.getElementById('complaint-branch-origin');
                if (branchOrigin) branchOrigin.textContent = 'Khu vực đã đổi · chọn chi nhánh';
            }
        }
        const currentBranch = branchInput?.value || branchField?.value || '';
        if (branchField && (!currentBranch || currentBranch === 'CXD' || currentBranch === previous.branch)) {
            updateRelatedDropdowns();
            if ([...branchField.options].some((option) => option.value === detected.branch)) {
                branchField.value = detected.branch;
                if (branchInput) branchInput.value = detected.branch || '';
            }
            const branchOrigin = document.getElementById('complaint-branch-origin');
            if (branchOrigin) branchOrigin.textContent = detected.branch && branchField.value === detected.branch ? 'Đã tự phát hiện' : 'Chọn theo khu vực';
        }
        if (detected.srCode && !document.getElementById('complaint-sr-code').value) {
            document.getElementById('complaint-sr-code').value = detected.srCode;
        }
    }

    function formatShortDateTime(value) {
        if (!value) return '—';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return value;
        return date.toLocaleString('vi-VN', { hour12: false });
    }

    function buildComplaintRowFromForm() {
        const info = {
            source: normalizeText(document.getElementById('complaint-source').value),
            kv: normalizeText(document.getElementById('complaint-kv').value),
            cn: normalizeText(document.getElementById('complaint-cn-search')?.value || document.getElementById('complaint-cn').value),
            phone: normalizeText(document.getElementById('complaint-phone').value),
            nickFtel: normalizeText(document.getElementById('complaint-ftel-search')?.value || document.getElementById('complaint-ftel').value),
            customer: normalizeText(document.getElementById('complaint-customer').value),
            postUrl: normalizeText(document.getElementById('complaint-post-url').value),
            complaintText: normalizeText(document.getElementById('complaint-content').value),
            level: normalizeText(document.getElementById('complaint-level').value),
            complaintTime: normalizeText(document.getElementById('complaint-customer-time').value),
            alertReceivedTime: normalizeText(document.getElementById('complaint-alert-time').value),
            firstReplyTime: normalizeText(document.getElementById('complaint-first-reply').value),
            handlingCompletedTime: normalizeText(document.getElementById('complaint-complete-time').value),
            accountReceive: normalizeText(document.getElementById('complaint-account-receive').value),
            accountLead: normalizeText(document.getElementById('complaint-account-lead').value),
            accountLast: normalizeText(document.getElementById('complaint-account-last').value),
            requestType1: normalizeText(document.getElementById('complaint-request-type-1').value),
            requestType2: normalizeText(document.getElementById('complaint-request-type-2').value),
            serviceType: normalizeText(document.getElementById('complaint-service-type').value),
            srCode: normalizeText(document.getElementById('complaint-sr-code').value),
            handlingUnit: normalizeText(document.getElementById('complaint-handling-unit').value),
            voucher: normalizeText(document.getElementById('complaint-voucher-search')?.value || document.getElementById('complaint-voucher').value),
            result: normalizeText(document.getElementById('complaint-result').value),
            note: normalizeText(document.getElementById('complaint-note').value),
            rawText: normalizeText(document.getElementById('complaint-paste-text').value)
        };

        const hasContent = Object.values(info).some((value) => Boolean(value));
        if (hasContent) {
            info.accountReceive = info.accountReceive || DEFAULT_ACCOUNT;
            info.accountLead = info.accountLead || DEFAULT_ACCOUNT;
            info.accountLast = info.accountLast || DEFAULT_ACCOUNT;
        }

        const noteDetection = complaintState.detected || extractProcessingDetails(info.note);
        const enteredValue = info.phone.toUpperCase();
        const contractNo = /^[A-Z]{2}[A-Z]{3}\d{4}$/.test(enteredValue) || /^[A-Z]{2}\d{7,8}$/.test(enteredValue)
            ? enteredValue : (noteDetection.contractNo || '');
        const phoneValue = contractNo ? '' : (normalizePhone(info.phone) || noteDetection.phone || '');

        return {
            id: complaintState.editingId || ('complaint_' + Date.now() + '_' + Math.random().toString(16).slice(2, 8)),
            source: info.source,
            status: normalizeText(document.getElementById('complaint-status')?.value) || 'In Process',
            kv: info.kv,
            cn: info.cn,
            phone: phoneValue,
            contractNo,
            nickFtel: info.nickFtel,
            customer: info.customer,
            customerInfo: info.customer,
            customerProfile: normalizeText(document.getElementById('complaint-customer-profile')?.value),
            postUrl: info.postUrl,
            complaintText: info.complaintText || info.rawText,
            level: info.level,
            complaintTime: info.complaintTime,
            alertReceivedTime: info.alertReceivedTime,
            firstReplyTime: info.firstReplyTime,
            handlingCompletedTime: info.handlingCompletedTime,
            accountReceive: info.accountReceive,
            accountLead: info.accountLead,
            accountLast: info.accountLast,
            requestType1: info.requestType1,
            requestType2: info.requestType2,
            serviceType: info.serviceType,
            srCode: info.srCode,
            handlingUnit: info.handlingUnit,
            voucher: info.voucher,
            result: info.result,
            note: info.note,
            rawText: info.rawText,
            createdAt: new Date().toISOString()
        };
    }

    function addOrUpdateComplaintRow(keepOpen) {
        const record = buildComplaintRowFromForm();
        const rows = complaintState.records;
        const index = rows.findIndex((item) => item.id === record.id);

        if (index >= 0) rows[index] = record;
        else rows.unshift(record);

        rows.forEach((item, idx) => {
            item.stt = idx + 1;
        });

        saveComplaintState();
        renderComplaintTable();
        if (!keepOpen) closeComplaintModal();
        return record;
    }

    function validateComplaintRecord(record) {
        const errors = [];
        if (!record.source) errors.push('Nguồn không được để trống.');
        if (!record.complaintText && !record.rawText) errors.push('Nội dung khiếu nại không được để trống.');
        if (record.phone && !/^0\d{9,10}$/.test(record.phone)) errors.push('SĐT không hợp lệ.');
        if (record.srCode && !/^[A-Za-z0-9-]+$/.test(record.srCode)) errors.push('Mã SR không hợp lệ.');
        if (record.postUrl && !/^https?:\/\//i.test(record.postUrl)) errors.push('Link URL bài post không hợp lệ.');
        return errors;
    }

    function saveComplaintState() {
        const state = { records: complaintState.records };
        safeLocalSet(TABLE_KEY, state);
        if (window.GPORTAL_FOLDERS && typeof window.saveJsonToDrive === 'function' && AppState && AppState.isLoggedIn) {
            window.saveJsonToDrive('complaints.json', state, window.GPORTAL_FOLDERS.settings).catch((err) => {
                console.warn('[Complaint] Không thể lưu lên Drive:', err);
            });
        }
    }

    function complaintSheetIdFromInput(value) {
        const text = normalizeText(value);
        const match = text.match(/\/spreadsheets\/d\/([\w-]+)/);
        return match ? match[1] : text;
    }

    function setComplaintSheetStatus(message, isError) {
        const status = document.getElementById('complaint-sheet-status');
        if (!status) return;
        status.textContent = message;
        status.classList.toggle('is-error', Boolean(isError));
    }

    function googleSheetsReady() {
        return Boolean(window.AppState?.isLoggedIn && window.gapi?.client?.sheets?.spreadsheets?.values &&
            typeof window.gapi.client.getToken === 'function' && window.gapi.client.getToken());
    }

    function columnName(number) {
        let value = number;
        let name = '';
        while (value > 0) {
            const remainder = (value - 1) % 26;
            name = String.fromCharCode(65 + remainder) + name;
            value = Math.floor((value - 1) / 26);
        }
        return name;
    }

    async function ensureComplaintSheet() {
        if (!googleSheetsReady()) throw new Error('Đăng nhập Google để bật đồng bộ Sheets.');
        let spreadsheetId = complaintSheetIdFromInput(document.getElementById('complaint-sheet-id')?.value || '') || localStorage.getItem(SHEET_ID_KEY) || '';
        if (!spreadsheetId) {
            const found = await gapi.client.drive.files.list({
                q: `name='${SHEET_NAME}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
                spaces: 'drive', fields: 'files(id,name)', pageSize: 20
            });
            const files = found.result.files || [];
            if (files.length === 1) spreadsheetId = files[0].id;
            else if (files.length > 1) throw new Error('Có nhiều Sheet tên Complaint Management. Hãy dán URL/ID Sheet cần dùng.');
        }
        if (!spreadsheetId) {
            const created = await gapi.client.sheets.spreadsheets.create({
                resource: { properties: { title: SHEET_NAME }, sheets: [{ properties: { title: SHEET_TAB } }] }
            });
            spreadsheetId = created.result.spreadsheetId;
        }
        const metadata = await gapi.client.sheets.spreadsheets.get({
            spreadsheetId, fields: 'spreadsheetId,sheets.properties(title,sheetId)'
        });
        const sheetList = metadata.result.sheets || [];
        let tab = sheetList.find((sheet) => sheet.properties.title === SHEET_TAB) || sheetList[0];
        if (!tab) {
            const added = await gapi.client.sheets.spreadsheets.batchUpdate({
                spreadsheetId, resource: { requests: [{ addSheet: { properties: { title: SHEET_TAB } } }] }
            });
            tab = added.result.replies[0].addSheet;
        }
        const range = `'${String(tab.properties.title).replace(/'/g, "''")}'!A1:ZZ1`;
        const values = await gapi.client.sheets.spreadsheets.values.get({ spreadsheetId, range });
        let headers = (values.result.values && values.result.values[0] || []).map((value) => String(value || '').trim());
        if (!headers.some(Boolean)) {
            await gapi.client.sheets.spreadsheets.values.update({
                spreadsheetId, range: `'${String(tab.properties.title).replace(/'/g, "''")}'!A1`, valueInputOption: 'RAW',
                resource: { values: [SHEET_HEADERS] }
            });
            headers = SHEET_HEADERS.slice();
        }
        const missing = SHEET_HEADERS.filter((header) => !headers.includes(header));
        if (missing.length) throw new Error(`Hàng tiêu đề Sheet chưa khớp. Thiếu cột: ${missing.join(' | ')}`);
        localStorage.setItem(SHEET_ID_KEY, spreadsheetId);
        const input = document.getElementById('complaint-sheet-id');
        if (input) input.value = spreadsheetId;
        return { spreadsheetId, tab: tab.properties.title, headers };
    }

    function complaintSheetRow(record, headers, stt) {
        const profile = normalizeText(record.customerProfile || record.customerEmail);
        const customer = [normalizeText(record.customer || record.customerInfo), profile].filter(Boolean).join('\n');
        const valuesByHeader = {
            'STT': stt,
            'Nguồn': record.source,
            'KV': record.kv,
            'CN': record.cn,
            'SHĐ/SĐT': record.contractNo || record.phone,
            'Nick FTel': record.nickFtel,
            'Tên Nick KH & Link URL Profile cá nhân hoặc Email KH': customer,
            'Link URL bài post (Chỉ có khi là MXH)': record.postUrl,
            'Nội dung bài viết MXH/ Email': record.complaintText,
            'Cấp độ': record.level,
            'TG KH p/anh (FB: time post bài - Email: time KH gửi)': record.complaintTime,
            'TG nhận mail (Alert)': record.alertReceivedTime,
            'TG phản hồi KH lần đầu tiên': record.firstReplyTime,
            'TG xử lý HT': record.handlingCompletedTime,
            'Account Tiếp nhận': record.accountReceive,
            'Acount Chủ trì': record.accountLead,
            'Account XL cuối cùng': record.accountLast,
            'Loại YC SR (cấp 1)': record.requestType1,
            'Loại YC SR (cấp 2)': record.requestType2,
            'Loại dịch vụ KH khiếu nại': record.serviceType,
            'Ghi chú': record.note,
            'Đơn vị xử lý (- SOC HTTC - Phối hợp đơn vị)': record.handlingUnit,
            'Voucher': record.voucher,
            'KQ': record.result,
            'SR': record.srCode
        };
        return headers.map((header) => valuesByHeader[header] == null ? '' : String(valuesByHeader[header]));
    }

    function complaintSheetFingerprint(record) {
        return [
            record.source,
            [normalizeText(record.customer || record.customerInfo), normalizeText(record.customerProfile || record.customerEmail)].filter(Boolean).join('\n'),
            record.postUrl, record.complaintText, record.complaintTime
        ].map((value) => normalizeText(value)).join('\u001f');
    }

    function sheetRowFingerprint(row, headers) {
        const index = (name) => headers.indexOf(name);
        const customer = row[index('Tên Nick KH & Link URL Profile cá nhân hoặc Email KH')] || '';
        return [
            row[index('Nguồn')] || '', customer,
            row[index('Link URL bài post (Chỉ có khi là MXH)')] || '',
            row[index('Nội dung bài viết MXH/ Email')] || '',
            row[index('TG KH p/anh (FB: time post bài - Email: time KH gửi)')] || ''
        ].map((value) => normalizeText(value)).join('\u001f');
    }

    async function syncComplaintRecord(record) {
        const sheet = await ensureComplaintSheet();
        const safeTab = `'${sheet.tab.replace(/'/g, "''")}'`;
        const savedRows = safeLocalGet(SHEET_ROWS_KEY) || {};
        const previousSync = savedRows[record.id];
        let rowNumber = previousSync && previousSync.spreadsheetId === sheet.spreadsheetId ? Number(previousSync.row) || 0 : 0;
        const sheetColumn = columnName(sheet.headers.length);
        if (rowNumber > 1) {
            const existing = await gapi.client.sheets.spreadsheets.values.get({
                spreadsheetId: sheet.spreadsheetId, range: `${safeTab}!A${rowNumber}:${sheetColumn}${rowNumber}`, valueRenderOption: 'UNFORMATTED_VALUE'
            });
            const actualFingerprint = sheetRowFingerprint((existing.result.values || [])[0] || [], sheet.headers);
            if (previousSync.fingerprint && previousSync.fingerprint === actualFingerprint) {
                await gapi.client.sheets.spreadsheets.values.update({
                    spreadsheetId: sheet.spreadsheetId, range: `${safeTab}!A${rowNumber}:${sheetColumn}${rowNumber}`,
                    valueInputOption: 'RAW', resource: { values: [complaintSheetRow(record, sheet.headers, rowNumber - 1)] }
                });
                savedRows[record.id] = { spreadsheetId: sheet.spreadsheetId, row: rowNumber, fingerprint: complaintSheetFingerprint(record) };
                safeLocalSet(SHEET_ROWS_KEY, savedRows);
                setComplaintSheetStatus(`Đã đồng bộ · dòng ${rowNumber}`, false);
                return;
            }
            rowNumber = 0;
        }
        if (!rowNumber) {
            const current = await gapi.client.sheets.spreadsheets.values.get({
                spreadsheetId: sheet.spreadsheetId, range: `${safeTab}!A2:${sheetColumn}`, valueRenderOption: 'UNFORMATTED_VALUE'
            });
            const existingRows = current.result.values || [];
            const nextStt = existingRows.reduce((maximum, row) => Math.max(maximum, Number(row[0]) || 0), 0) + 1;
            const fallbackRowNumber = existingRows.length + 2;
            const response = await gapi.client.sheets.spreadsheets.values.append({
                spreadsheetId: sheet.spreadsheetId, range: `${safeTab}!A:${sheetColumn}`, valueInputOption: 'RAW',
                insertDataOption: 'INSERT_ROWS', resource: { values: [complaintSheetRow(record, sheet.headers, nextStt)] }
            });
            const updatedRange = response.result.updatedRange || '';
            const matchedRow = updatedRange.match(/![A-Z]+(\d+):/i);
            rowNumber = matchedRow ? Number(matchedRow[1]) : fallbackRowNumber;
            savedRows[record.id] = { spreadsheetId: sheet.spreadsheetId, row: rowNumber, fingerprint: complaintSheetFingerprint(record) };
            safeLocalSet(SHEET_ROWS_KEY, savedRows);
        }
        setComplaintSheetStatus(`Đã đồng bộ · dòng ${rowNumber}`, false);
    }

    async function syncComplaintRecords() {
        const records = complaintState.records.slice().reverse();
        if (!records.length) return;
        for (const record of records) await syncComplaintRecord(record);
    }

    async function loadComplaintState() {
        let state = safeLocalGet(TABLE_KEY);
        if (state && Array.isArray(state.records)) complaintState.records = state.records;
        else complaintState.records = [];

        if (window.GPORTAL_FOLDERS && AppState && AppState.isLoggedIn && typeof window.getJsonFromDrive === 'function') {
            try {
                const remote = await window.getJsonFromDrive('complaints.json', window.GPORTAL_FOLDERS.settings);
                if (remote && Array.isArray(remote.records)) {
                    complaintState.records = remote.records;
                    safeLocalSet(TABLE_KEY, { records: complaintState.records });
                }
            } catch (err) {
                console.warn('[Complaint] Không tải được dữ liệu từ Drive:', err);
            }
        }
        renderComplaintTable();
    }

    function clearComplaintForm() {
        const formIds = [
            'complaint-source', 'complaint-kv', 'complaint-cn', 'complaint-cn-search', 'complaint-phone', 'complaint-ftel', 'complaint-ftel-search', 'complaint-customer', 'complaint-customer-profile', 'complaint-post-url', 'complaint-content',
            'complaint-level', 'complaint-customer-time', 'complaint-alert-time', 'complaint-first-reply', 'complaint-complete-time', 'complaint-account-receive', 'complaint-account-lead', 'complaint-account-last',
            'complaint-request-type-1', 'complaint-request-type-2', 'complaint-service-type', 'complaint-sr-code', 'complaint-handling-unit', 'complaint-voucher', 'complaint-voucher-search', 'complaint-result', 'complaint-note', 'complaint-paste-text'
        ];
        formIds.forEach((id) => {
            const node = document.getElementById(id);
            if (node) {
                if (node.tagName === 'SELECT') node.value = '';
                else node.value = '';
            }
        });
        document.getElementById('complaint-detection-summary').textContent = 'Chưa phân tích';
        complaintState.lastParsed = null;
        complaintState.detected = null;
        const status = document.getElementById('complaint-status');
        if (status) status.value = 'In Process';
        const statusBadge = document.getElementById('complaint-status-badge');
        if (statusBadge) statusBadge.textContent = 'In Process';
        const postUrl = document.getElementById('complaint-post-url');
        if (postUrl) postUrl.style.display = 'none';
        fillSelect(document.getElementById('complaint-request-type-2'), [], '');
        updatePostLinkDisplay();
        updateProcessingDetection('', false);
        const branchOrigin = document.getElementById('complaint-branch-origin');
        const ftelOrigin = document.getElementById('complaint-ftel-origin');
        if (branchOrigin) branchOrigin.textContent = 'Chọn thủ công hoặc dùng gợi ý';
        if (ftelOrigin) ftelOrigin.textContent = 'Chọn hoặc nhập tài khoản';
        setComplaintStage('initial');
    }

    const FILTER_FIELDS = {
        source: 'complaint-filter-source', kv: 'complaint-filter-kv', cn: 'complaint-filter-cn',
        nickFtel: 'complaint-filter-ftel', level: 'complaint-filter-level', status: 'complaint-filter-status',
        requestType1: 'complaint-filter-request1', requestType2: 'complaint-filter-request2',
        serviceType: 'complaint-filter-service', handlingUnit: 'complaint-filter-unit',
        voucher: 'complaint-filter-voucher', result: 'complaint-filter-result'
    };

    function refreshComplaintFilterOptions() {
        Object.entries(FILTER_FIELDS).forEach(([field, id]) => {
            const select = document.getElementById(id);
            if (!select) return;
            const selected = select.value;
            const options = unique(complaintState.records.map((record) => record[field]).filter(Boolean)).sort((a, b) => String(a).localeCompare(String(b), 'vi'));
            select.innerHTML = '<option value="">Tất cả</option>' + options.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('');
            select.value = options.includes(selected) ? selected : '';
        });
    }

    function applyComplaintColumnVisibility() {
        const visible = safeLocalGet(COLUMN_VISIBILITY_KEY) || {};
        const table = document.querySelector('#view-complaint .complaint-table');
        if (!table) return;
        table.querySelectorAll('tr').forEach((row) => {
            Array.from(row.children).forEach((cell, index) => {
                if (row.children.length === 1 && cell.colSpan > 1) return;
                cell.hidden = visible[index] === false;
            });
        });
        document.querySelectorAll('#complaint-column-options input[data-column-index]').forEach((checkbox) => {
            checkbox.checked = visible[Number(checkbox.dataset.columnIndex)] !== false;
        });
    }

    function setupComplaintColumnVisibility() {
        const options = document.getElementById('complaint-column-options');
        if (!options || options.dataset.ready === '1') return;
        options.dataset.ready = '1';
        options.innerHTML = COMPLAINT_COLUMN_LABELS.map((label, index) => `
            <label><input type="checkbox" data-column-index="${index}" checked><span>${escapeHtml(label)}</span></label>
        `).join('');
        options.querySelectorAll('input[data-column-index]').forEach((checkbox) => {
            checkbox.addEventListener('change', () => {
                const visible = safeLocalGet(COLUMN_VISIBILITY_KEY) || {};
                visible[Number(checkbox.dataset.columnIndex)] = checkbox.checked;
                safeLocalSet(COLUMN_VISIBILITY_KEY, visible);
                applyComplaintColumnVisibility();
            });
        });
        document.getElementById('btn-complaint-columns-reset')?.addEventListener('click', () => {
            safeLocalSet(COLUMN_VISIBILITY_KEY, {});
            applyComplaintColumnVisibility();
        });
        applyComplaintColumnVisibility();
    }

    function applyComplaintSearch() {
        const query = normalizeText(document.getElementById('complaint-search')?.value || '').toLowerCase();
        const rows = complaintState.records.filter((item) => {
            const categoryMatches = Object.entries(FILTER_FIELDS).every(([field, id]) => {
                const value = document.getElementById(id)?.value || '';
                return !value || String(item[field] || '') === value;
            });
            const dateField = document.getElementById('complaint-filter-date-field')?.value || 'complaintTime';
            const complaintDate = String(item[dateField] || '').slice(0, 10);
            const from = document.getElementById('complaint-filter-from')?.value || '';
            const to = document.getElementById('complaint-filter-to')?.value || '';
            if (!categoryMatches || (from && (!complaintDate || complaintDate < from)) || (to && (!complaintDate || complaintDate > to))) return false;
            const identifier = normalizeText(document.getElementById('complaint-filter-identifier')?.value || '').toLowerCase();
            const account = normalizeText(document.getElementById('complaint-filter-account')?.value || '').toLowerCase();
            const sr = normalizeText(document.getElementById('complaint-filter-sr')?.value || '').toLowerCase();
            if (identifier && !String(item.contractNo || item.phone || '').toLowerCase().includes(identifier)) return false;
            if (account && ![item.accountReceive, item.accountLead, item.accountLast].join(' ').toLowerCase().includes(account)) return false;
            if (sr && !String(item.srCode || '').toLowerCase().includes(sr)) return false;
            if (!query) return true;
            const haystack = [
                item.source, item.status, item.customerProfile, item.kv, item.cn, item.phone, item.contractNo, item.nickFtel, item.customer, item.customerInfo, item.postUrl, item.complaintText,
                item.level, item.complaintTime, item.alertReceivedTime, item.firstReplyTime, item.handlingCompletedTime, item.accountReceive,
                item.accountLead, item.accountLast, item.requestType1, item.requestType2, item.serviceType, item.note, item.handlingUnit,
                item.voucher, item.result, item.srCode
            ].join(' ').toLowerCase();
            return haystack.includes(query);
        });
        const tbody = document.getElementById('complaint-tbody');
        if (!tbody) return;
        if (!rows.length) {
            tbody.innerHTML = '<tr><td colspan="26" style="text-align:center; padding:42px; color:var(--text-muted);">Không tìm thấy Complaint phù hợp.</td></tr>';
            return;
        }
        tbody.innerHTML = rows.map((item) => `
            <tr data-id="${item.id}" style="cursor:pointer;">
                <td>${escapeHtml(item.stt || '')}</td>
                <td>${escapeHtml(item.source || '—')}</td>
                <td><span class="complaint-table-status">${escapeHtml(item.status || 'In Process')}</span></td>
                <td>${escapeHtml(item.kv || '—')}</td>
                <td>${escapeHtml(item.cn || '—')}</td>
                <td>${escapeHtml(item.phone || item.contractNo || '—')}</td>
                <td>${escapeHtml(item.nickFtel || '—')}</td>
                <td><span class="complaint-cell-truncate" title="${escapeHtml([item.customer || item.customerInfo, item.customerProfile].filter(Boolean).join(' · '))}">${escapeHtml(item.customer || item.customerInfo || '—')}</span>${item.customerProfile ? `<span class="complaint-cell-truncate" title="${escapeHtml(item.customerProfile)}">${/^https?:\/\//i.test(item.customerProfile) ? `<a href="${escapeHtml(item.customerProfile)}" target="_blank" rel="noopener" class="mon-link">Profile ↗</a>` : escapeHtml(item.customerProfile)}</span>` : ''}</td>
                <td>${item.postUrl ? `<a href="${escapeHtml(item.postUrl)}" target="_blank" rel="noopener" class="mon-link" title="${escapeHtml(item.postUrl)}">Xem bài viết ↗</a>` : '—'}</td>
                <td>${item.complaintText ? `<details class="complaint-note-preview"><summary title="${escapeHtml(item.complaintText)}">${escapeHtml(item.complaintText.slice(0, 110))}${item.complaintText.length > 110 ? '…' : ''}</summary><div>${escapeHtml(item.complaintText)}</div></details>` : '—'}</td>
                <td>${escapeHtml(item.level || '—')}</td>
                <td>${escapeHtml(item.complaintTime ? formatShortDateTime(item.complaintTime) : '—')}</td>
                <td>${escapeHtml(item.alertReceivedTime ? formatShortDateTime(item.alertReceivedTime) : '—')}</td>
                <td>${escapeHtml(item.firstReplyTime ? formatShortDateTime(item.firstReplyTime) : '—')}</td>
                <td>${escapeHtml(item.handlingCompletedTime ? formatShortDateTime(item.handlingCompletedTime) : '—')}</td>
                <td>${escapeHtml(item.accountReceive || '—')}</td>
                <td>${escapeHtml(item.accountLead || '—')}</td>
                <td>${escapeHtml(item.accountLast || '—')}</td>
                <td>${escapeHtml(item.requestType1 || '—')}</td>
                <td>${escapeHtml(item.requestType2 || '—')}</td>
                <td>${escapeHtml(item.serviceType || '—')}</td>
                <td>${item.note ? `<details class="complaint-note-preview"><summary>${escapeHtml(item.note.slice(0, 90))}${item.note.length > 90 ? '…' : ''}</summary><div>${escapeHtml(item.note)}</div></details>` : '—'}</td>
                <td>${escapeHtml(item.handlingUnit || '—')}</td>
                <td>${escapeHtml(item.voucher || '—')}</td>
                <td>${escapeHtml(item.result || '—')}</td>
                <td>${item.srCode ? `<a href="http://sr.fpt.net/sr/ServiceRequest/detail?code=${encodeURIComponent(item.srCode)}" target="_blank" rel="noopener" class="mon-link" title="Service Request ${escapeHtml(item.srCode)}">${escapeHtml(item.srCode)}</a>` : '—'}</td>
            </tr>
        `).join('');

        tbody.querySelectorAll('tr[data-id]').forEach((row) => {
            row.addEventListener('click', (event) => {
                const targetId = row.getAttribute('data-id');
                const found = complaintState.records.find((item) => item.id === targetId);
                if (event.target.closest('a, details, button')) return;
                if (found) showComplaintModal('edit', found);
            });
        });
        applyComplaintColumnVisibility();
        refreshComplaintFilterOptions();
    }

    function renderComplaintTable() {
        const tbody = document.getElementById('complaint-tbody');
        const badge = document.getElementById('complaint-count-badge');
        if (badge) badge.textContent = `${complaintState.records.length} bản ghi`;
        if (!tbody) return;
        if (!complaintState.records.length) {
            tbody.innerHTML = '<tr><td colspan="26" style="text-align:center; padding:42px; color:var(--text-muted);">Chưa có dữ liệu Complaint — bấm <strong>+ Thêm khiếu nại</strong> để bắt đầu.</td></tr>';
            return;
        }
        applyComplaintSearch();
    }

    function parseAndPopulate() {
        const text = document.getElementById('complaint-paste-text')?.value || '';
        if (!text.trim()) {
            alert('Vui lòng dán nội dung email/alert trước khi phân tích.');
            return;
        }
        const parsed = parseComplaintEmail(text);
        complaintState.lastParsed = parsed;

        const summary = document.getElementById('complaint-detection-summary');
        if (summary) summary.textContent = `Phân tích: ${Object.keys(parsed.detected).filter((key) => parsed.detected[key]).length} trường được gợi ý`;

        const confidenceRank = { low: 0, medium: 1, high: 2 };
        const fieldPairs = [
            ['complaint-source', parsed.detected.source, 'source'],
            ['complaint-customer', parsed.detected.customerName, 'customerName'],
            ['complaint-customer-profile', parsed.detected.customerProfileUrl, 'customerProfileUrl'],
            ['complaint-post-url', parsed.detected.postUrl, 'postUrl'],
            ['complaint-customer-time', toLocalInput(parsed.detected.customerComplaintTime || ''), 'customerComplaintTime'],
            ['complaint-alert-time', toLocalInput(parsed.detected.alertReceivedTime || ''), 'alertReceivedTime'],
            ['complaint-content', parsed.detected.complaintContent || text, 'complaintContent']
        ];
        const eligiblePairs = fieldPairs.filter(([, value, confidenceKey]) => value && (confidenceRank[parsed.confidence[confidenceKey] || 'low'] >= confidenceRank.medium));
        const conflicts = eligiblePairs.filter(([id, value]) => document.getElementById(id)?.value.trim())
            .filter(([id, value]) => document.getElementById(id).value.trim() !== value);
        const replaceExisting = conflicts.length && window.confirm(`Phân tích phát hiện ${conflicts.length} trường đã có dữ liệu. Ghi đè các trường này? Chọn Hủy để chỉ điền trường còn trống.`);

        const setIfValue = (elementId, value) => {
            if (elementId && value) {
                const element = document.getElementById(elementId);
                if (element && element.value.trim() && element.value.trim() !== value && !replaceExisting) return;
                if (element && element.tagName === 'SELECT') {
                    if (Array.from(element.options).some((option) => option.value === value)) element.value = value;
                    else {
                        const opt = new Option(value, value);
                        element.add(opt);
                        element.value = value;
                    }
                } else if (element) element.value = value;
            }
        };

        eligiblePairs.forEach(([id, value]) => setIfValue(id, value));

        updateRelatedDropdowns();
        updatePostLinkDisplay();
    }

    function bindComplaintEvents() {
        if (document.body.dataset.complaintEventsBound === '1') return;
        document.body.dataset.complaintEventsBound = '1';

        const addBtn = document.getElementById('btn-complaint-add');
        const refreshBtn = document.getElementById('btn-complaint-refresh');
        const modalCloseBtn = document.getElementById('btn-close-complaint-modal');
        const stageNextBtn = document.getElementById('btn-complaint-stage-next');
        const stageBackBtn = document.getElementById('btn-complaint-stage-back');
        const postLinkEditBtn = document.getElementById('btn-edit-complaint-post-link');
        const parseBtn = document.getElementById('btn-parse-complaint');
        const saveBtn = document.getElementById('btn-save-complaint');
        const clearBtn = document.getElementById('btn-clear-complaint');
        const deleteBtn = document.getElementById('btn-delete-complaint');
        const searchInput = document.getElementById('complaint-search');

        if (addBtn) addBtn.addEventListener('click', () => { clearComplaintForm(); showComplaintModal('new', null); });
        if (refreshBtn) refreshBtn.addEventListener('click', () => loadComplaintState());
        if (modalCloseBtn) modalCloseBtn.addEventListener('click', closeComplaintModal);
        if (stageNextBtn) stageNextBtn.addEventListener('click', () => {
            setComplaintStage('processing');
            updateProcessingDetection(document.getElementById('complaint-note').value, Boolean(document.getElementById('complaint-note').value.trim()));
        });
        if (stageBackBtn) stageBackBtn.addEventListener('click', () => setComplaintStage('initial'));
        if (postLinkEditBtn) postLinkEditBtn.addEventListener('click', () => {
            const input = document.getElementById('complaint-post-url');
            input.style.display = input.style.display === 'none' ? 'block' : 'none';
            if (input.style.display === 'block') input.focus();
        });
        document.getElementById('complaint-post-url')?.addEventListener('input', updatePostLinkDisplay);
        if (parseBtn) parseBtn.addEventListener('click', parseAndPopulate);
        if (clearBtn) clearBtn.addEventListener('click', clearComplaintForm);
        if (deleteBtn) deleteBtn.addEventListener('click', () => {
            if (!complaintState.editingId) return;
            if (!confirm('Bạn có chắc chắn muốn xóa khiếu nại này?')) return;
            complaintState.records = complaintState.records.filter((item) => item.id !== complaintState.editingId);
            saveComplaintState();
            renderComplaintTable();
            closeComplaintModal();
        });
        if (saveBtn) saveBtn.addEventListener('click', async () => {
            if (complaintState.stage === 'processing') {
                updateProcessingDetection(document.getElementById('complaint-note').value, true);
            }
            const record = buildComplaintRowFromForm();
            const errors = validateComplaintRecord(record);
            if (errors.length) {
                alert(errors.join('\n'));
                return;
            }
            if (complaintState.stage === 'initial' && !complaintState.editingId) {
                const created = addOrUpdateComplaintRow(true);
                complaintState.editingId = created.id;
                try { await syncComplaintRecord(created); }
                catch (error) { setComplaintSheetStatus(`Đã lưu nội bộ · Sheet chưa đồng bộ: ${error.message}`, true); }
                document.getElementById('complaint-account-receive').value = created.accountReceive || DEFAULT_ACCOUNT;
                document.getElementById('complaint-account-lead').value = created.accountLead || DEFAULT_ACCOUNT;
                document.getElementById('complaint-account-last').value = created.accountLast || DEFAULT_ACCOUNT;
                const title = document.getElementById('complaint-modal-title');
                if (title) title.textContent = 'Khiếu nại đã tạo · Bổ sung thông tin xử lý';
                setComplaintStage('processing');
                updateProcessingDetection(document.getElementById('complaint-note').value, false);
            } else {
                const saved = addOrUpdateComplaintRow(false);
                try { await syncComplaintRecord(saved); }
                catch (error) { setComplaintSheetStatus(`Đã lưu nội bộ · Sheet chưa đồng bộ: ${error.message}`, true); }
            }
        });
        if (searchInput) searchInput.addEventListener('input', applyComplaintSearch);

        const filterToggle = document.getElementById('btn-complaint-filters');
        const columnToggle = document.getElementById('btn-complaint-columns');
        const togglePanel = (button, panelId) => button?.addEventListener('click', () => {
            const panel = document.getElementById(panelId);
            if (!panel) return;
            panel.hidden = !panel.hidden;
            button.setAttribute('aria-expanded', String(!panel.hidden));
        });
        togglePanel(filterToggle, 'complaint-filter-panel');
        togglePanel(columnToggle, 'complaint-columns-panel');
        setupComplaintColumnVisibility();
        Object.values(FILTER_FIELDS).forEach((id) => document.getElementById(id)?.addEventListener('change', applyComplaintSearch));
        document.getElementById('complaint-filter-date-field')?.addEventListener('change', applyComplaintSearch);
        ['complaint-filter-from', 'complaint-filter-to', 'complaint-filter-identifier', 'complaint-filter-account', 'complaint-filter-sr'].forEach((id) => {
            document.getElementById(id)?.addEventListener('input', applyComplaintSearch);
            document.getElementById(id)?.addEventListener('change', applyComplaintSearch);
        });
        document.getElementById('btn-complaint-filter-clear')?.addEventListener('click', () => {
            Object.values(FILTER_FIELDS).forEach((id) => { const input = document.getElementById(id); if (input) input.value = ''; });
            ['complaint-filter-from', 'complaint-filter-to', 'complaint-filter-identifier', 'complaint-filter-account', 'complaint-filter-sr'].forEach((id) => {
                const input = document.getElementById(id); if (input) input.value = '';
            });
            applyComplaintSearch();
        });

        const sheetInput = document.getElementById('complaint-sheet-id');
        if (sheetInput) sheetInput.value = localStorage.getItem(SHEET_ID_KEY) || '';
        document.getElementById('btn-complaint-sheet-save')?.addEventListener('click', () => {
            const id = complaintSheetIdFromInput(sheetInput?.value || '');
            if (!id) { alert('Dán URL hoặc ID Google Sheet trước khi lưu.'); return; }
            localStorage.setItem(SHEET_ID_KEY, id);
            if (sheetInput) sheetInput.value = id;
            setComplaintSheetStatus('Đã lưu cấu hình Sheet', false);
        });
        document.getElementById('btn-complaint-sheet-sync')?.addEventListener('click', async () => {
            setComplaintSheetStatus('Đang đồng bộ…', false);
            try { await syncComplaintRecords(); }
            catch (error) { setComplaintSheetStatus(`Đồng bộ thất bại: ${error.message}`, true); }
        });

        document.getElementById('complaint-kv')?.addEventListener('change', () => {
            const branchInput = document.getElementById('complaint-cn-search');
            const branchSelect = document.getElementById('complaint-cn');
            const currentBranch = branchInput?.value || branchSelect?.value || '';
            const allowedBranches = getCNOptionsByKV(document.getElementById('complaint-kv').value);
            if (currentBranch && !allowedBranches.includes(currentBranch)) {
                setComboValue(branchSelect, branchInput, '');
                const branchOrigin = document.getElementById('complaint-branch-origin');
                if (branchOrigin) branchOrigin.textContent = 'Khu vực đã đổi · chọn chi nhánh';
            }
            updateRelatedDropdowns();
        });
        const branchInput = document.getElementById('complaint-cn-search');
        const branchMenu = document.getElementById('complaint-cn-menu');
        const openBranchMenu = () => {
            if (!branchMenu) return;
            renderBranchOptions();
            branchMenu.hidden = false;
            branchInput?.setAttribute('aria-expanded', 'true');
            document.getElementById('complaint-cn-filter')?.focus();
        };
        document.getElementById('complaint-cn-toggle')?.addEventListener('click', openBranchMenu);
        branchInput?.addEventListener('click', openBranchMenu);
        branchInput?.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') { event.preventDefault(); openBranchMenu(); }
        });
        document.getElementById('complaint-cn-filter')?.addEventListener('input', renderBranchOptions);
        document.getElementById('complaint-cn-filter')?.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                branchMenu.hidden = true;
                branchInput?.setAttribute('aria-expanded', 'false');
                branchInput?.focus();
            }
        });
        document.addEventListener('pointerdown', (event) => {
            const picker = document.querySelector('.complaint-branch-picker');
            if (branchMenu && !branchMenu.hidden && picker && !picker.contains(event.target)) {
                branchMenu.hidden = true;
                branchInput?.setAttribute('aria-expanded', 'false');
            }
        });
        document.getElementById('complaint-ftel-search')?.addEventListener('input', (event) => {
            setComboValue(document.getElementById('complaint-ftel'), event.target, event.target.value);
            const origin = document.getElementById('complaint-ftel-origin');
            if (origin) origin.textContent = 'Đã nhập/chọn thủ công';
        });
        document.getElementById('complaint-voucher-search')?.addEventListener('input', (event) => {
            setComboValue(document.getElementById('complaint-voucher'), event.target, event.target.value);
        });
        document.getElementById('complaint-source')?.addEventListener('change', () => {
            const sourceValue = document.getElementById('complaint-source').value;
            if (sourceValue && !document.getElementById('complaint-content').value.trim()) {
                const summary = document.getElementById('complaint-detection-summary');
                if (summary) summary.textContent = `Nguồn đã chọn: ${sourceValue}`;
            }
        });
        document.getElementById('complaint-request-type-1')?.addEventListener('change', () => {
            const requestType1 = document.getElementById('complaint-request-type-1').value;
            const requestType2 = document.getElementById('complaint-request-type-2');
            fillSelect(requestType2, getSRType2Options(requestType1), '');
        });

        document.getElementById('complaint-note')?.addEventListener('input', (event) => updateProcessingDetection(event.target.value, true));
        document.getElementById('complaint-status')?.addEventListener('change', (event) => {
            document.getElementById('complaint-status-badge').textContent = event.target.value || 'In Process';
        });

        const dataEntryIds = ['complaint-source', 'complaint-kv', 'complaint-cn', 'complaint-phone', 'complaint-ftel', 'complaint-customer', 'complaint-customer-profile', 'complaint-post-url', 'complaint-content', 'complaint-level', 'complaint-customer-time', 'complaint-alert-time', 'complaint-first-reply', 'complaint-complete-time', 'complaint-request-type-1', 'complaint-request-type-2', 'complaint-service-type', 'complaint-sr-code', 'complaint-handling-unit', 'complaint-voucher', 'complaint-result', 'complaint-note'];
        const fillAccountsIfRowHasData = () => {
            if (!dataEntryIds.some((fieldId) => normalizeText(document.getElementById(fieldId)?.value))) return;
            ['complaint-account-receive', 'complaint-account-lead', 'complaint-account-last'].forEach((accountId) => {
                const input = document.getElementById(accountId);
                if (input && !input.value) input.value = DEFAULT_ACCOUNT;
            });
        };
        dataEntryIds.forEach((id) => {
            document.getElementById(id)?.addEventListener('input', fillAccountsIfRowHasData);
            document.getElementById(id)?.addEventListener('change', fillAccountsIfRowHasData);
        });

        document.getElementById('complaint-paste-text')?.addEventListener('paste', () => {
            setTimeout(parseAndPopulate, 150);
        });

        document.getElementById('complaint-modal')?.addEventListener('click', (event) => {
            if (event.target && event.target.id === 'complaint-modal') closeComplaintModal();
        });
    }

    function setupComplaintStyles() {
        if (document.getElementById('complaint-style')) return;
        const style = document.createElement('style');
        style.id = 'complaint-style';
        style.textContent = `
            #view-complaint { --complaint-muted: var(--text-muted); --complaint-border: var(--border-color); }
            #view-complaint .complaint-form-grid { display:grid; grid-template-columns: repeat(2, minmax(220px, 1fr)); gap: 14px; }
            #view-complaint .complaint-form-grid .span-2 { grid-column: span 2; }
            #view-complaint .complaint-modal-card { overflow: hidden; }
            #view-complaint .modal-body .input-group-col { display:flex; flex-direction:column; gap:6px; }
            #view-complaint .modal-body label { font-size:12.5px; color: var(--complaint-muted); font-weight:600; line-height:1.4; }
            #view-complaint .mon-link { color: var(--accent); }
            #view-complaint .complaint-processing-card { display:flex; flex-direction:column; gap:14px; padding:18px; }
            #view-complaint .complaint-processing-heading { display:flex; align-items:center; justify-content:space-between; gap:12px; }
            #view-complaint .complaint-processing-heading > div { display:flex; align-items:center; gap:10px; }
            #view-complaint .complaint-processing-heading h4 { font-size:16px; }
            #view-complaint .complaint-status-badge, #view-complaint .complaint-table-status { display:inline-flex; align-items:center; border-radius:999px; padding:4px 10px; color:var(--accent); background:var(--accent-glow); font-size:12px; font-weight:600; }
            #view-complaint .complaint-status-field { max-width:320px; }
            #view-complaint .complaint-detection-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:10px; }
            #view-complaint .complaint-detection-grid > div { min-width:0; padding:12px; border:1px solid var(--border-color); border-radius:10px; background:var(--bg-primary); display:flex; flex-direction:column; gap:6px; }
            #view-complaint .complaint-detection-grid span { color:var(--text-muted); font-size:11px; }
            #view-complaint .complaint-detection-grid strong { overflow-wrap:anywhere; font-size:13px; }
            #view-complaint .complaint-more-processing { margin-top:14px; padding:16px; border:1px solid var(--complaint-border); border-radius:12px; background:var(--bg-secondary); }
            #view-complaint .complaint-field-origin { display:inline-block; margin-left:5px; color:#475569; font-size:11px; font-weight:500; }
            #view-complaint .complaint-post-link-row { display:flex; align-items:center; gap:10px; min-height:40px; flex-wrap:wrap; color:var(--text-muted); font-size:13px; }
            #view-complaint textarea.form-input { min-height:72px; line-height:1.45; }
            #view-complaint .complaint-more-processing { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; }
            #view-complaint .complaint-field-group { min-width:0; padding:12px; border:1px solid #d7dfeb; border-radius:10px; background:#f8fafc; }
            #view-complaint .complaint-field-group h5 { margin:0 0 10px; color:#334155; font-size:12px; font-weight:700; letter-spacing:.01em; }
            #view-complaint .complaint-field-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px 10px; }
            #view-complaint .complaint-field-grid .input-group-col { min-width:0; gap:3px; }
            #view-complaint .complaint-field-grid label { min-height:17px; font-size:11.5px; }
            #view-complaint .complaint-field-grid .form-input, #view-complaint .complaint-field-grid .form-select { padding:8px 9px; min-height:36px; }
            #view-complaint .complaint-field-origin { display:block; margin:1px 0 0; line-height:1.2; }
            #view-complaint .complaint-filter-panel { display:grid; gap:12px; margin-top:-8px; padding:16px; }
            #view-complaint .complaint-filter-panel[hidden] { display:none; }
            #view-complaint .complaint-filter-grid { display:grid; grid-template-columns:repeat(4,minmax(145px,1fr)); gap:12px; }
            #view-complaint .complaint-filter-grid label { display:block; color:var(--text-main); font-size:12px; }
            #view-complaint .complaint-sheet-config { margin:8px 0 12px; padding:8px 12px; border:1px solid var(--complaint-border); border-radius:10px; background:var(--bg-secondary); color:var(--text-main); font-size:12px; }
            #view-complaint .complaint-sheet-config > summary { cursor:pointer; color:#475569; font-weight:600; }
            #view-complaint .complaint-sheet-config-controls { display:flex; align-items:center; gap:8px; flex-wrap:wrap; padding-top:10px; }
            #view-complaint .complaint-sheet-config .form-input { max-width:460px; margin-top:0; background:var(--bg-secondary); }
            #view-complaint #complaint-sheet-status { color:#166534; }
            #view-complaint #complaint-sheet-status.is-error { color:#b91c1c; }
            #view-complaint .complaint-table thead th { color:#334155; background:#e9eef7; border-right:1px solid #d6deea; border-bottom:1px solid #cbd5e1; font-size:10.5px; line-height:1.25; white-space:normal; vertical-align:middle; padding:8px 7px; }
            #view-complaint .complaint-table tbody td { border-right:1px solid #e2e8f0; border-bottom:1px solid #dbe2ec; line-height:1.45; }
            #view-complaint .complaint-table tbody tr:nth-child(even) { background:rgba(148,163,184,.06); }
            #view-complaint .complaint-table tbody tr:hover { background:rgba(2,132,199,.08); }
            #view-complaint .complaint-note-preview { max-width:250px; }
            #view-complaint .complaint-note-preview summary { overflow:hidden; text-overflow:ellipsis; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; cursor:pointer; color:var(--text-main); }
            #view-complaint .complaint-note-preview > div { max-width:330px; max-height:180px; margin-top:6px; overflow:auto; white-space:pre-wrap; overflow-wrap:anywhere; padding:8px; background:var(--bg-primary); border:1px solid var(--complaint-border); border-radius:8px; }
            #view-complaint .complaint-cell-truncate { display:block; max-width:160px; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
            #view-complaint .complaint-cell-truncate + .complaint-cell-truncate { margin-top:3px; color:#475569; font-size:11px; }
            #view-complaint .complaint-columns-panel { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; margin-top:-8px; padding:14px; }
            #view-complaint .complaint-columns-panel[hidden] { display:none; }
            #view-complaint .complaint-column-options { display:grid; grid-template-columns:repeat(6,minmax(110px,1fr)); gap:7px 12px; flex:1; }
            #view-complaint .complaint-column-options label { display:flex; align-items:center; gap:7px; color:#334155; font-size:11.5px; cursor:pointer; }
            #view-complaint .complaint-column-options input { accent-color:#0284c7; }
            #view-complaint .complaint-table [hidden] { display:none; }
            #view-complaint .form-input, #view-complaint .form-select { border-color:#cbd5e1; background:#fff; color:#0f172a; min-height:40px; }
            #view-complaint .form-input::placeholder { color:#64748b; opacity:1; }
            #view-complaint .form-input:focus, #view-complaint .form-select:focus { border-color:#0284c7; box-shadow:0 0 0 3px rgba(2,132,199,.14); }
            #view-complaint .form-input:disabled, #view-complaint .form-select:disabled { color:#475569; background:#e2e8f0; opacity:1; }
            :root[data-theme="light"] #view-complaint .complaint-detection-grid > div { background:#fff; border-color:#cbd5e1; }
            :root[data-theme="light"] #view-complaint .complaint-detection-grid span { color:#475569; }
            :root[data-theme="light"] #view-complaint .complaint-status-badge, :root[data-theme="light"] #view-complaint .complaint-table-status { color:#075985; background:#e0f2fe; }
            :root[data-theme="dark"] #view-complaint .complaint-field-origin { color:#b6c2d9; }
            :root[data-theme="dark"] #view-complaint .form-input, :root[data-theme="dark"] #view-complaint .form-select { border-color:var(--border-color); background:var(--bg-primary); color:var(--text-main); }
            :root[data-theme="dark"] #view-complaint .complaint-table thead th { color:var(--text-main); background:var(--bg-elevated); border-color:var(--border-color); }
            :root[data-theme="dark"] #view-complaint .complaint-table tbody td { border-color:var(--border-color); }
            :root[data-theme="dark"] #view-complaint .complaint-field-group { background:var(--bg-card); border-color:var(--border-color); }
            :root[data-theme="dark"] #view-complaint .complaint-field-group h5, :root[data-theme="dark"] #view-complaint .complaint-column-options label { color:var(--text-main); }
            :root[data-theme="dark"] #view-complaint .complaint-cell-truncate + .complaint-cell-truncate { color:var(--text-muted); }
            :root[data-theme="dark"] #view-complaint #complaint-sheet-status { color:#86efac; }
            :root[data-theme="dark"] #view-complaint #complaint-sheet-status.is-error { color:#fca5a5; }
            :root[data-theme="dark"] #view-complaint .complaint-sheet-config > summary { color:var(--text-main); }
            /* Complaint entry workspace: scope these layout rules to the modal form only. */
            #view-complaint .complaint-modal-card { width:min(96vw,1440px); max-width:1440px; }
            #view-complaint .complaint-modal-body { max-height:82vh !important; padding:16px 18px; }
            #view-complaint .complaint-initial-grid { grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px 16px; }
            #view-complaint .complaint-initial-grid .span-all { grid-column:1 / -1; }
            #view-complaint .complaint-paste-card { padding:12px !important; margin-bottom:12px !important; }
            #view-complaint #complaint-paste-text { min-height:76px; max-height:150px; resize:vertical; }
            #view-complaint .complaint-processing-card { gap:10px; padding:14px; }
            #view-complaint .complaint-note-row { display:grid; grid-template-columns:minmax(180px,240px) minmax(0,1fr); gap:12px; align-items:start; }
            #view-complaint .complaint-note-row .complaint-status-field { max-width:none; }
            #view-complaint .complaint-helper { display:block; margin-top:2px; color:#475569; font-size:11px; font-weight:500; }
            #view-complaint #complaint-note { min-height:54px; max-height:150px; overflow:auto; resize:vertical; transition:min-height .16s ease; }
            #view-complaint #complaint-note:focus { min-height:112px; }
            #view-complaint .complaint-more-processing { margin-top:10px; padding:12px; gap:10px; grid-template-columns:repeat(3,minmax(0,1fr)); background:#f1f5f9; }
            #view-complaint .complaint-field-group { padding:11px; background:#fff; border-color:#cbd5e1; }
            #view-complaint .complaint-field-group h5 { margin-bottom:8px; font-size:12.5px; }
            #view-complaint .complaint-field-grid { gap:8px; }
            #view-complaint .complaint-branch-picker { position:relative; display:flex; align-items:stretch; }
            #view-complaint .complaint-branch-picker > .form-input { padding-right:42px; cursor:pointer; }
            #view-complaint .complaint-branch-toggle { position:absolute; top:2px; right:2px; bottom:2px; min-width:36px; padding:0 8px; border:0; background:transparent; color:#334155; }
            #view-complaint .complaint-branch-menu { position:absolute; z-index:20; top:calc(100% + 5px); left:0; right:0; padding:8px; border:1px solid #94a3b8; border-radius:9px; background:#fff; box-shadow:0 12px 28px rgba(15,23,42,.16); }
            #view-complaint .complaint-branch-menu[hidden] { display:none; }
            #view-complaint .complaint-branch-menu > .form-input { min-height:36px; padding:7px 9px; }
            #view-complaint .complaint-branch-options { max-height:210px; overflow:auto; margin-top:6px; }
            #view-complaint .complaint-branch-option { display:block; width:100%; padding:8px 10px; border:0; border-radius:6px; background:#fff; color:#0f172a; text-align:left; cursor:pointer; }
            #view-complaint .complaint-branch-option:hover, #view-complaint .complaint-branch-option:focus-visible { outline:none; background:#e0f2fe; }
            #view-complaint .complaint-branch-option[aria-selected="true"] { background:#dbeafe; color:#075985; font-weight:700; }
            #view-complaint .complaint-branch-empty { padding:10px; color:#475569; font-size:12px; }
            #view-complaint .complaint-modal-body .form-input:hover, #view-complaint .complaint-modal-body .form-select:hover { border-color:#94a3b8; }
            @media (max-width: 900px) { #view-complaint .complaint-form-grid { grid-template-columns: 1fr; } #view-complaint .complaint-form-grid .span-2 { grid-column: span 1; } }
            @media (max-width: 1100px) { #view-complaint .complaint-initial-grid { grid-template-columns:repeat(2,minmax(0,1fr)); } #view-complaint .complaint-initial-grid .span-all { grid-column:1 / -1; } }
            @media (max-width: 900px) { #view-complaint .complaint-filter-grid { grid-template-columns:repeat(2,minmax(130px,1fr)); } }
            @media (max-width: 1100px) { #view-complaint .complaint-more-processing { grid-template-columns:repeat(2,minmax(0,1fr)); } #view-complaint .complaint-column-options { grid-template-columns:repeat(4,minmax(100px,1fr)); } }
            @media (max-width: 640px) { #view-complaint .complaint-detection-grid { grid-template-columns:repeat(2,minmax(0,1fr)); } #view-complaint .complaint-processing-heading { align-items:flex-start; flex-direction:column; } #view-complaint .complaint-filter-grid { grid-template-columns:1fr; } #view-complaint .complaint-more-processing { grid-template-columns:1fr; padding:10px; } #view-complaint .complaint-columns-panel { flex-direction:column; } #view-complaint .complaint-column-options { grid-template-columns:repeat(2,minmax(0,1fr)); width:100%; } #view-complaint .complaint-sheet-config > * { max-width:100%; } }
            @media (max-width: 480px) { #view-complaint .complaint-field-grid { grid-template-columns:1fr; } }
            @media (max-width: 900px) { #view-complaint .complaint-initial-grid { grid-template-columns:repeat(2,minmax(0,1fr)); } #view-complaint .complaint-note-row { grid-template-columns:1fr; } }
            @media (max-width: 640px) { #view-complaint .complaint-modal-body { padding:10px; } #view-complaint .complaint-initial-grid { grid-template-columns:1fr; } #view-complaint .complaint-initial-grid .span-all { grid-column:1; } #view-complaint .complaint-more-processing { grid-template-columns:1fr; } }
        `;
        document.head.appendChild(style);
    }

    function initComplaintPage() {
        setupComplaintStyles();
        collectWorkflowOptions();
        bindComplaintEvents();
        loadComplaintState();
    }

    window.loadComplaintPage = async function () {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initComplaintPage, { once: true });
            return;
        }
        setupComplaintStyles();
        collectWorkflowOptions();
        bindComplaintEvents();
        await loadComplaintState();
    };

    document.addEventListener('DOMContentLoaded', initComplaintPage, { once: true });
})();

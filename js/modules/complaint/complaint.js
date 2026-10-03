/**
 * complaint.js - Module Complaint Management
 *
 * ============================================================================
 * BẢN CẬP NHẬT: TRẠNG THÁI TỰ ĐỘNG THEO KQ + MÀU DÒNG THEO TRẠNG THÁI
 * ============================================================================
 * - "Trạng thái" KHÔNG còn chọn tay: luôn được suy ra từ ô KQ (deriveStatus).
 *   Đổi KQ -> Trạng thái đổi ngay; xóa KQ -> về "In Process". Nội dung KQ gốc
 *   không bao giờ bị sửa.
 * - Mỗi lần tải / hiển thị bảng, Trạng thái của MỌI bản ghi (kể cả bản ghi cũ)
 *   được tính lại từ KQ nên F5 luôn đúng. Không xóa/đổi dữ liệu nào khác.
 * - Cả dòng trong bảng được tô màu pastel theo Trạng thái (CSS: css/complaint.css,
 *   class st-*).
 * - Muốn đổi cách nhận diện KQ -> sửa bảng STATUS_RULES bên dưới (từ khóa viết
 *   KHÔNG DẤU, chữ thường).
 *
 * Giữ nguyên toàn bộ phần còn lại: cấu trúc dữ liệu bản ghi, lưu local/Drive,
 * đồng bộ Google Sheets, parse email, nhận diện hợp đồng/SĐT/SR, bộ lọc, ẩn/hiện
 * cột, combobox KV -> CN.
 * ============================================================================
 */
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
    const CXD = 'CXD';
    const CSS_HREF = 'css/complaint.css';

    // ======================================================================
    // TRẠNG THÁI TỰ ĐỘNG THEO KQ
    // ======================================================================
    const DEFAULT_STATUS = 'In Process';
    // Thứ tự hiển thị trong bộ lọc
    const STATUS_LIST = [
        'In Process', 'Đang phối hợp PB', 'Chờ KH phản hồi',
        'KH không phản hồi', 'Đã xử lý', 'Đã xử lý, KH thanh lý'
    ];
    // Trạng thái -> hậu tố class màu (st-xxx trong CSS)
    const STATUS_KEY = {
        'In Process': 'inprocess',
        'Đang phối hợp PB': 'coordinating',
        'Chờ KH phản hồi': 'waiting',
        'KH không phản hồi': 'noresponse',
        'Đã xử lý': 'done',
        'Đã xử lý, KH thanh lý': 'terminated'
    };
    // Từ khóa nhận diện KQ (đã bỏ dấu, chữ thường). Sửa tại đây khi danh mục KQ thay đổi.
    const STATUS_RULES = {
        notDone: /chua\s*(xu\s*ly|hoan|giai\s*quyet)|khong\s*xu\s*ly/,
        done: /da\s*xu\s*ly|xu\s*ly\s*xong|hoan\s*(tat|thanh)|da\s*giai\s*quyet|completed|resolved|\bclosed\b/,
        terminated: /thanh\s*ly/,
        noReply: /khong\s*(phan\s*hoi|nghe\s*may|lien\s*lac|tra\s*loi|bat\s*may)|\ban\s*link\b|\blink\s*an\b|\bkh\s*an\b/,
        waiting: /(cho|doi)\s*(kh|khach\s*hang|khach)?\s*phan\s*hoi|inbox|\bib\b/,
        coordinating: /phoi\s*hop|chuyen\s*(pb|bo\s*phan|phong)|dang\s*xu\s*ly|\bcho\s*(pb|bo\s*phan)|dieu\s*phoi/
    };

    function foldText(value) {
        return String(value === undefined || value === null ? '' : value)
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/đ/g, 'd').replace(/Đ/g, 'd')
            .toLowerCase().replace(/\s+/g, ' ').trim();
    }

    /**
     * KQ -> Trạng thái. Ưu tiên: Đã xử lý, KH thanh lý -> Đã xử lý -> Chờ KH phản hồi
     * -> KH không phản hồi -> Đang phối hợp PB -> In Process.
     * Riêng KQ có cụm phủ định rõ ràng ("không phản hồi", "không nghe máy"...) thì
     * không bị xếp vào "Chờ KH phản hồi" dù có chữ IB/Inbox.
     */
    function deriveStatus(kq) {
        const text = foldText(kq);
        if (!text) return DEFAULT_STATUS;
        const R = STATUS_RULES;
        const done = R.done.test(text) && !R.notDone.test(text);
        if (done && R.terminated.test(text)) return 'Đã xử lý, KH thanh lý';
        if (done) return 'Đã xử lý';
        const noReply = R.noReply.test(text);
        if (!noReply && R.waiting.test(text)) return 'Chờ KH phản hồi';
        if (noReply) return 'KH không phản hồi';
        if (R.coordinating.test(text)) return 'Đang phối hợp PB';
        return DEFAULT_STATUS;
    }
    window.deriveComplaintStatus = deriveStatus;

    function statusKeyOf(status) { return STATUS_KEY[status] || STATUS_KEY[DEFAULT_STATUS]; }

    const complaintState = {
        records: [],
        editingId: null,
        lastParsed: null,
        detected: null
    };

    // Tính lại Trạng thái của mọi bản ghi từ KQ (không đụng tới KQ hay trường khác)
    function syncStatuses() {
        complaintState.records.forEach((record) => { record.status = deriveStatus(record.result); });
    }

    // ======================================================================
    // TIỆN ÍCH
    // ======================================================================
    const $ = (id) => document.getElementById(id);

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

    function getWorkflowSettings() {
        return window.workflowSettings || { regions: [], sources: [], requestTypes: [], srTypes: [], fbAccounts: [], levels: [], handlingUnits: [], vouchers: [], results: [], complaintServices: [] };
    }

    // ======================================================================
    // NGUỒN DỮ LIỆU DROPDOWN (Workflow Setting)
    // ======================================================================
    function getComplaintSourceOptions() {
        const setting = getWorkflowSettings();
        const fromWorkflow = (setting.sources || []).map((item) => item && item.name ? item.name : item).filter(Boolean);
        const fallback = ['Facebook', 'Email', 'X', 'Zalo', 'Other social media channels'];
        return unique(fromWorkflow.concat(fallback));
    }

    function getKVOptions() {
        const regions = Array.isArray(getWorkflowSettings().regions) ? getWorkflowSettings().regions : [];
        return unique(regions.map((item) => item && item.region ? item.region : '').concat(CXD));
    }

    /**
     * FIX KV -> CN: dữ liệu Vùng miền là danh sách TỈNH, mỗi tỉnh có "region" và
     * "branches". Một khu vực có NHIỀU tỉnh => phải gộp chi nhánh của tất cả
     * tỉnh cùng khu vực (bản cũ chỉ lấy tỉnh đầu tiên do dùng .find()).
     * Chưa chọn KV => trả về mọi chi nhánh (kèm khu vực để tự điền KV khi chọn).
     */
    function branchChoices(kv) {
        const regions = Array.isArray(getWorkflowSettings().regions) ? getWorkflowSettings().regions : [];
        const key = normalizeText(kv).toLowerCase();
        if (key === CXD.toLowerCase()) return [];
        const seen = new Set();
        const out = [];
        regions.forEach((item) => {
            const region = normalizeText(item && item.region);
            if (key && region.toLowerCase() !== key) return;
            (item.branches || []).forEach((branch) => {
                const name = normalizeText(branch);
                const id = name.toLowerCase();
                if (!name || seen.has(id)) return;
                seen.add(id);
                out.push({ name, region, province: normalizeText(item.provinceName) });
            });
        });
        return out.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
    }

    function getCNOptionsByKV(kv) {
        return unique(branchChoices(kv).map((item) => item.name).concat(CXD));
    }

    function getFTelOptionsByKV(kv) {
        const list = Array.isArray(getWorkflowSettings().fbAccounts) ? getWorkflowSettings().fbAccounts : [];
        if (!kv) return unique(list.map((item) => item && item.name ? item.name : item).filter(Boolean));
        const matched = list.filter((item) => {
            const name = normalizeText(item && item.name ? item.name : item);
            const kvName = normalizeText(item && item.kv ? item.kv : '');
            return !kvName || kvName === kv || name.toLowerCase().includes(kv.toLowerCase());
        });
        return unique(matched.map((item) => item && item.name ? item.name : item).filter(Boolean));
    }

    function getLevelOptions() {
        const values = Array.isArray(getWorkflowSettings().levels) ? getWorkflowSettings().levels : [];
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
        const values = Array.isArray(getWorkflowSettings()[key]) ? getWorkflowSettings()[key] : [];
        const out = values.map((item) => item && item.name ? item.name : item).filter(Boolean);
        return unique(out.length ? out : fallback);
    }

    // Giữ lại giá trị đã lưu dù không còn trong danh mục (dữ liệu cũ) để không mất dữ liệu.
    function fillSelect(select, options, selectedValue) {
        if (!select) return;
        const before = select.value;
        const wanted = selectedValue || before;
        select.innerHTML = '<option value="">-- Chọn --</option>' + options.map((option) => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`).join('');
        if (wanted && !options.includes(wanted) && selectedValue) select.add(new Option(wanted, wanted));
        select.value = (wanted && (options.includes(wanted) || selectedValue)) ? wanted : '';
    }

    function fillDatalist(list, options) {
        if (!list) return;
        list.innerHTML = unique(options).map((value) => `<option value="${escapeHtml(value)}"></option>`).join('');
    }

    function setComboValue(select, input, value) {
        const clean = normalizeText(value);
        if (select && clean) {
            if (![...select.options].some((option) => option.value === clean)) select.add(new Option(clean, clean));
            select.value = clean;
        } else if (select) select.value = '';
        if (input) input.value = clean;
    }

    function autoGrow(el) {
        if (!el) return;
        const max = Number(el.dataset.maxHeight) || 220;
        el.style.height = 'auto';
        const needed = el.scrollHeight + 2;
        el.style.height = Math.min(needed, max) + 'px';
        el.style.overflowY = needed > max ? 'auto' : 'hidden';
    }

    function autoGrowAll() {
        ['complaint-paste-text', 'complaint-content', 'complaint-note'].forEach((id) => autoGrow($(id)));
    }

    // ======================================================================
    // DỰNG MODAL (thay cho markup cũ trong index.html)
    // ======================================================================
    function ensureStylesheet() {
        const has = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).some((l) => /complaint\.css/.test(l.getAttribute('href') || ''));
        if (has) return;
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = CSS_HREF;
        document.head.appendChild(link);
    }

    const fld = (span, id, label, control, hintId) =>
        `<div class="cm-field s${span}"><label class="cm-label" for="${id}">${label}${hintId ? `<span class="cm-hint" id="${hintId}"></span>` : ''}</label>${control}</div>`;
    const inp = (id, type, ph, extra) => `<input id="${id}" type="${type || 'text'}" class="cm-input" ${ph ? `placeholder="${ph}"` : ''} ${extra || ''}>`;
    const sel = (id) => `<select id="${id}" class="cm-input"></select>`;

    function modalMarkup() {
        return `
        <div class="cm-dialog" role="dialog" aria-modal="true" aria-labelledby="complaint-modal-heading" data-pane="info">
            <header class="cm-head">
                <div class="cm-title"><h3 id="complaint-modal-heading">Complaint Management</h3><p id="complaint-modal-title">Thêm khiếu nại mới</p></div>
                <span id="complaint-status-badge" class="cm-badge st-inprocess">In Process</span>
                <button type="button" id="btn-close-complaint-modal" class="cm-icon-btn" aria-label="Đóng"><i class='bx bx-x'></i></button>
            </header>
            <nav class="cm-tabs" role="tablist" aria-label="Chuyển ngăn">
                <button type="button" class="cm-tab is-active" data-pane="info" role="tab">1 · Khiếu nại</button>
                <button type="button" class="cm-tab" data-pane="proc" role="tab">2 · Xử lý</button>
            </nav>
            <div class="cm-body">
                <section class="cm-pane cm-pane-info">
                    <div class="cm-card cm-paste">
                        <div class="cm-card-title"><i class='bx bx-paste'></i> Dán email / alert <span class="cm-card-aside">Tự nhận diện khi dán</span></div>
                        <textarea id="complaint-paste-text" class="cm-input" rows="2" data-max-height="130" placeholder="Dán toàn bộ email alert / nội dung khiếu nại từ MXH..."></textarea>
                        <div class="cm-paste-actions">
                            <div id="complaint-detection-summary" class="cm-detect"><span class="cm-chip is-muted">Chưa phân tích</span></div>
                            <button type="button" id="btn-parse-complaint" class="cm-btn cm-btn-primary cm-btn-sm"><i class='bx bx-magic-wand'></i> Phân tích</button>
                            <button type="button" id="btn-clear-complaint" class="cm-btn cm-btn-sm"><i class='bx bx-eraser'></i> Xóa</button>
                        </div>
                    </div>
                    <div class="cm-card">
                        <div class="cm-card-title"><i class='bx bx-message-square-detail'></i> Thông tin khiếu nại</div>
                        <div class="cm-grid">
                            ${fld(6, 'complaint-source', 'Nguồn', sel('complaint-source'))}
                            ${fld(6, 'complaint-customer-time', 'TG KH phản ánh', inp('complaint-customer-time', 'datetime-local'))}
                            ${fld(6, 'complaint-customer', 'Tên / nickname KH', inp('complaint-customer'))}
                            ${fld(6, 'complaint-customer-profile', 'Profile URL / email KH', inp('complaint-customer-profile', 'text', 'Email hoặc link Facebook'))}
                            <div class="cm-field s12"><label class="cm-label" for="complaint-post-url">Link bài viết / bài báo</label>
                                <div class="cm-url-row">${inp('complaint-post-url', 'url', 'Dán link bài viết (nếu có)')}
                                <a id="complaint-post-link-display" class="cm-btn cm-btn-sm" href="#" target="_blank" rel="noopener" style="display:none;" title="Mở liên kết"><i class='bx bx-link-external'></i> Mở</a></div></div>
                            <div class="cm-field s12"><label class="cm-label" for="complaint-content">Nội dung khiếu nại</label>
                                <textarea id="complaint-content" class="cm-input" rows="4" data-max-height="260" placeholder="Dán hoặc nhập nội dung phản ánh của khách hàng"></textarea></div>
                        </div>
                    </div>
                </section>

                <section class="cm-pane cm-pane-proc">
                    <div class="cm-card">
                        <div class="cm-card-title"><i class='bx bx-user-pin'></i> Khách hàng &amp; dịch vụ</div>
                        <div class="cm-grid">
                            ${fld(3, 'complaint-phone', 'SHĐ / SĐT', inp('complaint-phone'))}
                            ${fld(3, 'complaint-ftel-search', 'Nick FTel', `${inp('complaint-ftel-search', 'search', 'Tìm hoặc nhập', 'list="complaint-ftel-options" autocomplete="off"')}<datalist id="complaint-ftel-options"></datalist><select id="complaint-ftel" class="cm-input" hidden aria-hidden="true" tabindex="-1"></select>`, 'complaint-ftel-origin')}
                            ${fld(3, 'complaint-kv', 'KV', sel('complaint-kv'))}
                            ${fld(3, 'complaint-cn-search', 'CN', `<div class="cm-combo complaint-branch-picker">
                                <input id="complaint-cn-search" type="text" class="cm-input" role="combobox" aria-expanded="false" aria-controls="complaint-cn-options" autocomplete="off" placeholder="Chọn / tìm chi nhánh">
                                <button id="complaint-cn-toggle" type="button" class="cm-combo-btn" aria-label="Mở danh sách chi nhánh" tabindex="-1"><i class='bx bx-chevron-down'></i></button>
                                <div id="complaint-cn-menu" class="cm-menu" hidden><div id="complaint-cn-options" class="cm-options" role="listbox" aria-label="Chi nhánh"></div></div>
                                <select id="complaint-cn" class="cm-input" hidden aria-hidden="true" tabindex="-1"></select></div>`, 'complaint-branch-origin')}
                        </div>
                    </div>
                    <div class="cm-card">
                        <div class="cm-card-title"><i class='bx bx-time-five'></i> Mốc thời gian</div>
                        <div class="cm-grid">
                            ${fld(4, 'complaint-alert-time', 'TG nhận mail (Alert)', inp('complaint-alert-time', 'datetime-local'))}
                            ${fld(4, 'complaint-first-reply', 'TG phản hồi KH lần đầu', inp('complaint-first-reply', 'datetime-local'))}
                            ${fld(4, 'complaint-complete-time', 'TG xử lý HT', inp('complaint-complete-time', 'datetime-local'))}
                        </div>
                    </div>
                    <div class="cm-card">
                        <div class="cm-card-title"><i class='bx bx-group'></i> Phân công</div>
                        <div class="cm-grid">
                            ${fld(3, 'complaint-account-receive', 'Account tiếp nhận', inp('complaint-account-receive', 'text', '', 'autocomplete="username"'))}
                            ${fld(3, 'complaint-account-lead', 'Account chủ trì', inp('complaint-account-lead', 'text', '', 'autocomplete="username"'))}
                            ${fld(3, 'complaint-account-last', 'Account XL cuối', inp('complaint-account-last', 'text', '', 'autocomplete="username"'))}
                            ${fld(3, 'complaint-handling-unit', 'Đơn vị xử lý', sel('complaint-handling-unit'))}
                        </div>
                    </div>
                    <div class="cm-card">
                        <div class="cm-card-title"><i class='bx bx-category'></i> Phân loại &amp; kết quả</div>
                        <div class="cm-grid">
                            ${fld(3, 'complaint-level', 'Cấp độ', sel('complaint-level'))}
                            ${fld(3, 'complaint-request-type-1', 'Loại YC SR (cấp 1)', sel('complaint-request-type-1'))}
                            ${fld(3, 'complaint-request-type-2', 'Loại YC SR (cấp 2)', sel('complaint-request-type-2'))}
                            ${fld(3, 'complaint-service-type', 'Dịch vụ KH khiếu nại', sel('complaint-service-type'))}
                            ${fld(3, 'complaint-sr-code', 'Mã SR', inp('complaint-sr-code'))}
                            ${fld(3, 'complaint-voucher-search', 'Voucher', `${inp('complaint-voucher-search', 'search', 'Tìm hoặc nhập', 'list="complaint-voucher-options" autocomplete="off"')}<datalist id="complaint-voucher-options"></datalist><select id="complaint-voucher" class="cm-input" hidden aria-hidden="true" tabindex="-1"></select>`)}
                            ${fld(3, 'complaint-result', 'Kết quả', sel('complaint-result'))}
                            ${fld(3, 'complaint-status', 'Trạng thái <span class="cm-hint">tự động theo KQ</span>', `<input id="complaint-status" type="text" class="cm-input" value="${DEFAULT_STATUS}" readonly tabindex="-1" aria-readonly="true">`)}
                        </div>
                    </div>
                    <div class="cm-card">
                        <div class="cm-card-title"><i class='bx bx-notepad'></i> Ghi chú xử lý <span class="cm-card-aside">Hợp đồng, SĐT, SR trong ghi chú được tự nhận diện</span></div>
                        <textarea id="complaint-note" class="cm-input" rows="3" data-max-height="200" placeholder="Nhập ghi chú, mã hợp đồng hoặc số điện thoại..."></textarea>
                    </div>
                </section>
            </div>
            <footer class="cm-foot">
                <button type="button" id="btn-delete-complaint" class="cm-btn cm-btn-danger" style="display:none;"><i class='bx bx-trash'></i> Xóa</button>
                <span class="cm-foot-hint">Ctrl + Enter để lưu</span>
                <button type="button" id="btn-complaint-cancel" class="cm-btn">Hủy</button>
                <button type="button" id="btn-save-complaint-next" class="cm-btn"><i class='bx bx-plus-circle'></i> Lưu &amp; thêm mới</button>
                <button type="button" id="btn-save-complaint" class="cm-btn cm-btn-primary"><i class='bx bx-save'></i> Lưu</button>
            </footer>
        </div>`;
    }

    function buildComplaintModal() {
        ensureStylesheet();
        let modal = $('complaint-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'complaint-modal';
            modal.className = 'modal-overlay';
            modal.style.display = 'none';
            document.body.appendChild(modal);
        }
        if (modal.dataset.cmBuilt === '3') return;
        modal.innerHTML = modalMarkup(); // thay thế hoàn toàn markup cũ (không trùng ID)
        modal.dataset.cmBuilt = '3';
    }

    // Cập nhật ô Trạng thái + badge theo KQ đang chọn (ô Trạng thái chỉ đọc)
    function refreshComplaintStatusField() {
        const status = deriveStatus($('complaint-result') ? $('complaint-result').value : '');
        const field = $('complaint-status');
        if (field) field.value = status;
        const badge = $('complaint-status-badge');
        if (badge) {
            badge.textContent = status;
            badge.className = 'cm-badge st-' + statusKeyOf(status);
        }
        return status;
    }

    function setPane(pane) {
        const dialog = document.querySelector('#complaint-modal .cm-dialog');
        if (!dialog) return;
        dialog.dataset.pane = pane;
        dialog.querySelectorAll('.cm-tab').forEach((tab) => tab.classList.toggle('is-active', tab.dataset.pane === pane));
    }

    function setDetectionSummary(labels) {
        const box = $('complaint-detection-summary');
        if (!box) return;
        box.innerHTML = labels && labels.length
            ? `<span class="cm-chip is-muted">Đã nhận diện</span>` + labels.map((l) => `<span class="cm-chip">${escapeHtml(l)}</span>`).join('')
            : '<span class="cm-chip is-muted">Chưa phân tích</span>';
    }

    // ======================================================================
    // DROPDOWN PHỤ THUỘC (KV -> CN, SR cấp 1 -> cấp 2)
    // ======================================================================
    function updateRelatedDropdowns() {
        const kv = $('complaint-kv') ? $('complaint-kv').value : '';
        const cnSelect = $('complaint-cn');
        const cnInput = $('complaint-cn-search');
        const fTelSelect = $('complaint-ftel');
        const fTelInput = $('complaint-ftel-search');
        const srType1 = $('complaint-request-type-1') ? $('complaint-request-type-1').value : '';

        if (cnSelect) fillSelect(cnSelect, getCNOptionsByKV(kv), cnInput?.value || cnSelect.value || '');
        if (fTelSelect) {
            fillSelect(fTelSelect, getFTelOptionsByKV(kv), fTelInput?.value || fTelSelect.value || '');
            fillDatalist($('complaint-ftel-options'), getFTelOptionsByKV(kv));
        }
        const request2 = $('complaint-request-type-2');
        if (request2) fillSelect(request2, getSRType2Options(srType1), request2.value || '');
        renderBranchOptions();
    }

    function collectWorkflowOptions() {
        fillSelect($('complaint-source'), getComplaintSourceOptions(), '');
        fillSelect($('complaint-kv'), getKVOptions(), '');
        fillSelect($('complaint-level'), getLevelOptions(), '');
        fillSelect($('complaint-request-type-1'), getSRType1Options(), '');
        fillSelect($('complaint-ftel'), getFTelOptionsByKV(''), '');
        fillSelect($('complaint-service-type'), getSimpleOptions('complaintServices', ['Internet', 'TV', 'Phone', 'Di động', 'Data', 'Khác']), '');
        fillSelect($('complaint-handling-unit'), getSimpleOptions('handlingUnits', ['SOC HTTC', 'Phối hợp đơn vị']), '');
        fillSelect($('complaint-voucher'), getSimpleOptions('vouchers', []), '');
        fillDatalist($('complaint-voucher-options'), getSimpleOptions('vouchers', []));
        fillSelect($('complaint-result'), getSimpleOptions('results', ['Đã xử lý', 'Đang xử lý', 'Chưa xử lý', 'Khác']), '');
        fillSelect($('complaint-cn'), getCNOptionsByKV(''), '');
        fillSelect($('complaint-request-type-2'), [], '');
        refreshComplaintStatusField();
    }

    // ---------- Combobox chi nhánh ----------
    let branchActive = -1;

    function branchMenuOpen() { const m = $('complaint-cn-menu'); return !!(m && !m.hidden); }

    function openBranchMenu(showAll) {
        const menu = $('complaint-cn-menu');
        const input = $('complaint-cn-search');
        if (!menu) return;
        input.dataset.filtering = showAll ? '0' : '1';
        renderBranchOptions();
        menu.hidden = false;
        input.setAttribute('aria-expanded', 'true');
    }

    function closeBranchMenu(restore) {
        const menu = $('complaint-cn-menu');
        const input = $('complaint-cn-search');
        if (menu) menu.hidden = true;
        if (input) {
            input.setAttribute('aria-expanded', 'false');
            input.dataset.filtering = '0';
            if (restore) input.value = $('complaint-cn').value || '';
        }
        branchActive = -1;
    }

    function renderBranchOptions() {
        const list = $('complaint-cn-options');
        const input = $('complaint-cn-search');
        if (!list || !input) return;
        const selected = $('complaint-cn').value;
        const kv = $('complaint-kv').value;
        const query = input.dataset.filtering === '1' ? normalizeText(input.value).toLowerCase() : '';
        const choices = branchChoices(kv).concat([{ name: CXD, region: CXD, province: '' }]).filter((c, i, arr) => arr.findIndex((x) => x.name === c.name) === i)
            .filter((c) => !query || c.name.toLowerCase().includes(query) || c.province.toLowerCase().includes(query));
        list.replaceChildren();
        branchActive = -1;
        if (!choices.length) {
            const empty = document.createElement('div');
            empty.className = 'cm-empty';
            empty.textContent = 'Không có chi nhánh phù hợp';
            list.appendChild(empty);
            return;
        }
        choices.forEach((choice) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'cm-option';
            btn.setAttribute('role', 'option');
            btn.setAttribute('aria-selected', String(choice.name === selected));
            btn.dataset.name = choice.name;
            btn.dataset.region = choice.region;
            const label = document.createElement('span');
            label.textContent = choice.name;
            btn.appendChild(label);
            if (!kv && choice.region && choice.region !== CXD) {
                const small = document.createElement('small');
                small.textContent = choice.region;
                btn.appendChild(small);
            }
            btn.addEventListener('mousedown', (e) => e.preventDefault()); // giữ focus ở ô tìm kiếm
            btn.addEventListener('click', () => pickBranch(choice));
            list.appendChild(btn);
        });
    }

    function pickBranch(choice) {
        const kvSelect = $('complaint-kv');
        // Chưa chọn KV mà chọn chi nhánh => tự điền KV theo chi nhánh đó
        if (!kvSelect.value && choice.region && choice.region !== CXD) {
            if (![...kvSelect.options].some((o) => o.value === choice.region)) kvSelect.add(new Option(choice.region, choice.region));
            kvSelect.value = choice.region;
            updateRelatedDropdowns();
        }
        setComboValue($('complaint-cn'), $('complaint-cn-search'), choice.name);
        const origin = $('complaint-branch-origin');
        if (origin) origin.textContent = complaintState.detected?.branch === choice.name ? 'Tự nhận diện' : '';
        closeBranchMenu(false);
        renderBranchOptions();
    }

    function moveBranchActive(step) {
        const items = Array.from(document.querySelectorAll('#complaint-cn-options .cm-option'));
        if (!items.length) return;
        branchActive = (branchActive + step + items.length) % items.length;
        items.forEach((item, i) => item.classList.toggle('is-active', i === branchActive));
        items[branchActive].scrollIntoView({ block: 'nearest' });
    }

    function onKVChange() {
        const kv = $('complaint-kv').value;
        const input = $('complaint-cn-search');
        const current = input.value || $('complaint-cn').value || '';
        // Chi nhánh hiện tại không thuộc KV mới => xóa để chọn lại
        if (current && current !== CXD && kv && !getCNOptionsByKV(kv).includes(current)) {
            setComboValue($('complaint-cn'), input, '');
            const origin = $('complaint-branch-origin');
            if (origin) origin.textContent = 'KV đã đổi · chọn lại';
        }
        updateRelatedDropdowns();
    }

    // ======================================================================
    // MỞ / ĐÓNG MODAL + ĐỔ DỮ LIỆU
    // ======================================================================
    function showComplaintModal(mode, row) {
        const modal = $('complaint-modal');
        if (!modal) return;
        $('complaint-modal-title').textContent = mode === 'edit' ? 'Chỉnh sửa khiếu nại' : 'Thêm khiếu nại mới';
        $('btn-delete-complaint').style.display = mode === 'edit' ? 'inline-flex' : 'none';
        $('btn-save-complaint-next').style.display = mode === 'edit' ? 'none' : 'inline-flex';
        complaintState.editingId = row && row.id ? row.id : null;
        populateComplaintForm(row || {});
        modal.style.display = 'flex';
        modal.classList.add('active');
        requestAnimationFrame(() => {
            autoGrowAll();
            if (mode !== 'edit') $('complaint-paste-text')?.focus();
        });
    }

    function closeComplaintModal() {
        const modal = $('complaint-modal');
        if (modal) {
            modal.classList.remove('active');
            modal.style.display = 'none';
        }
        closeBranchMenu(false);
        complaintState.editingId = null;
        complaintState.lastParsed = null;
    }

    function isModalOpen() {
        const modal = $('complaint-modal');
        return !!(modal && modal.classList.contains('active'));
    }

    function populateComplaintForm(row) {
        const values = row || {};
        const F = (id) => $(id);

        fillSelect(F('complaint-source'), getComplaintSourceOptions(), values.source || '');
        fillSelect(F('complaint-kv'), getKVOptions(), values.kv || '');
        fillSelect(F('complaint-level'), getLevelOptions(), values.level || '');
        fillSelect(F('complaint-request-type-1'), getSRType1Options(), values.requestType1 || '');
        fillSelect(F('complaint-request-type-2'), getSRType2Options(values.requestType1 || ''), values.requestType2 || '');
        fillSelect(F('complaint-service-type'), getSimpleOptions('complaintServices', ['Internet', 'TV', 'Phone', 'Di động', 'Data', 'Khác']), values.serviceType || '');
        fillSelect(F('complaint-handling-unit'), getSimpleOptions('handlingUnits', ['SOC HTTC', 'Phối hợp đơn vị']), values.handlingUnit || '');
        fillSelect(F('complaint-result'), getSimpleOptions('results', ['Đã xử lý', 'Đang xử lý', 'Chưa xử lý', 'Khác']), values.result || '');

        const voucherOptions = getSimpleOptions('vouchers', []);
        fillSelect(F('complaint-voucher'), voucherOptions, values.voucher || '');
        fillDatalist(F('complaint-voucher-options'), voucherOptions);
        setComboValue(F('complaint-voucher'), F('complaint-voucher-search'), values.voucher || '');

        fillSelect(F('complaint-cn'), getCNOptionsByKV(values.kv || ''), values.cn || '');
        setComboValue(F('complaint-cn'), F('complaint-cn-search'), values.cn || '');
        fillSelect(F('complaint-ftel'), getFTelOptionsByKV(values.kv || ''), values.nickFtel || '');
        setComboValue(F('complaint-ftel'), F('complaint-ftel-search'), values.nickFtel || '');
        updateRelatedDropdowns();
        closeBranchMenu(false);

        const branchOrigin = F('complaint-branch-origin');
        const ftelOrigin = F('complaint-ftel-origin');
        if (branchOrigin) branchOrigin.textContent = '';
        if (ftelOrigin) ftelOrigin.textContent = '';

        // Trạng thái luôn suy ra từ KQ (ô chỉ đọc)
        refreshComplaintStatusField();

        F('complaint-phone').value = values.phone || values.contractNo || '';
        F('complaint-customer').value = values.customer || values.customerInfo || '';
        F('complaint-customer-profile').value = values.customerProfile || values.customerEmail || '';
        F('complaint-post-url').value = values.postUrl || '';
        F('complaint-content').value = values.complaintText || '';
        F('complaint-customer-time').value = toLocalInput(values.complaintTime || values.customerComplaintTime || '');
        F('complaint-alert-time').value = toLocalInput(values.alertReceivedTime || '');
        F('complaint-first-reply').value = toLocalInput(values.firstReplyTime || '');
        F('complaint-complete-time').value = toLocalInput(values.handlingCompletedTime || '');
        F('complaint-account-receive').value = values.accountReceive || '';
        F('complaint-account-lead').value = values.accountLead || '';
        F('complaint-account-last').value = values.accountLast || '';
        F('complaint-sr-code').value = values.srCode || '';
        F('complaint-note').value = values.note || '';
        F('complaint-paste-text').value = values.rawText || values.complaintText || '';
        updatePostLinkDisplay();

        complaintState.detected = null;
        updateProcessingDetection(F('complaint-note').value, false);

        if (Object.keys(values).some((key) => key !== 'id' && key !== 'createdAt' && Boolean(normalizeText(values[key])))) {
            ['complaint-account-receive', 'complaint-account-lead', 'complaint-account-last'].forEach((id) => { if (!F(id).value) F(id).value = DEFAULT_ACCOUNT; });
        }

        setDetectionSummary(values.rawText ? ['Đã phân tích từ nội dung dán'] : []);
        setPane('info');
        autoGrowAll();
    }

    // ======================================================================
    // PARSE EMAIL / ALERT (giữ nguyên logic)
    // ======================================================================
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

    // ======================================================================
    // NHẬN DIỆN TỪ GHI CHÚ XỬ LÝ (giữ nguyên logic)
    // ======================================================================
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
        const region = regionRecord ? normalizeText(regionRecord.region) : CXD;
        const explicitBranch = text.match(/(?:branch|chi nhánh|CN)\s*[:：]\s*([^\n,;]+)/i);
        // Chi nhánh được dò trong TOÀN BỘ tỉnh của khu vực (không chỉ tỉnh khớp đầu tiên)
        const branchList = region !== CXD ? branchChoices(region).map((c) => c.name) : [];
        const branch = (explicitBranch && branchList.find((item) => normalizeText(item).toLowerCase() === normalizeText(explicitBranch[1]).toLowerCase()))
            || branchList.filter((item) => normalizeText(item) && text.toLowerCase().includes(normalizeText(item).toLowerCase())).sort((a, b) => normalizeText(b).length - normalizeText(a).length)[0]
            || CXD;
        const customerEmail = (text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i) || [''])[0];
        return { contractNo, phone, customerIdentifier: contractNo || phone, customerEmail, region, branch, srCode: identifiers.srCode || '' };
    }

    function updatePostLinkDisplay() {
        const input = $('complaint-post-url');
        const link = $('complaint-post-link-display');
        if (!input || !link) return;
        const url = normalizeText(input.value);
        const safeUrl = /^https?:\/\//i.test(url) ? url : '';
        link.href = safeUrl || '#';
        link.style.display = safeUrl ? 'inline-flex' : 'none';
    }

    function updateProcessingDetection(note, scanned) {
        if (!normalizeText(note)) {
            const previous = complaintState.detected || {};
            complaintState.detected = null;
            if (scanned) {
                const regionField = $('complaint-kv');
                const phoneField = $('complaint-phone');
                const emailField = $('complaint-customer-profile');
                const srField = $('complaint-sr-code');
                if (phoneField && previous.customerIdentifier && phoneField.value === previous.customerIdentifier) phoneField.value = '';
                if (emailField && previous.customerEmail && emailField.value === previous.customerEmail) emailField.value = '';
                if (srField && previous.srCode && srField.value === previous.srCode) srField.value = '';
                if (regionField && (!regionField.value || regionField.value === previous.region || regionField.value === CXD)) regionField.value = CXD;
                const branchSelect = $('complaint-cn');
                const branchInput = $('complaint-cn-search');
                const cur = branchInput?.value || branchSelect?.value || '';
                if (!cur || cur === previous.branch || cur === CXD) {
                    updateRelatedDropdowns();
                    setComboValue(branchSelect, branchInput, CXD);
                }
            }
            return;
        }

        const detected = extractProcessingDetails(note);
        const previous = complaintState.detected || {};
        complaintState.detected = detected;
        const phoneField = $('complaint-phone');
        const phoneIsAutomatic = phoneField && (!phoneField.value || phoneField.value === previous.customerIdentifier);
        const contractTakesPriority = detected.contractNo && phoneField && /^0\d{9,10}$/.test(phoneField.value);
        if (phoneField && (phoneIsAutomatic || contractTakesPriority)) phoneField.value = detected.customerIdentifier;
        const emailField = $('complaint-customer-profile');
        if (emailField && detected.customerEmail && (!emailField.value || emailField.value === previous.customerEmail)) emailField.value = detected.customerEmail;

        const regionField = $('complaint-kv');
        const branchField = $('complaint-cn');
        const branchInput = $('complaint-cn-search');
        if (regionField && (!regionField.value || regionField.value === CXD || regionField.value === previous.region)) {
            const priorRegion = regionField.value;
            if (![...regionField.options].some((option) => option.value === detected.region)) regionField.add(new Option(detected.region, detected.region));
            regionField.value = detected.region;
            if (priorRegion !== detected.region && branchInput?.value && branchInput.value !== CXD && !getCNOptionsByKV(detected.region).includes(branchInput.value)) {
                setComboValue(branchField, branchInput, '');
                const origin = $('complaint-branch-origin');
                if (origin) origin.textContent = 'KV đã đổi · chọn lại';
            }
        }
        updateRelatedDropdowns();
        const currentBranch = branchInput?.value || branchField?.value || '';
        if (branchField && (!currentBranch || currentBranch === CXD || currentBranch === previous.branch)) {
            if ([...branchField.options].some((option) => option.value === detected.branch)) {
                setComboValue(branchField, branchInput, detected.branch);
            }
            const origin = $('complaint-branch-origin');
            if (origin) origin.textContent = detected.branch && detected.branch !== CXD && branchField.value === detected.branch ? 'Tự nhận diện' : '';
        }
        if (detected.srCode && !$('complaint-sr-code').value) $('complaint-sr-code').value = detected.srCode;
    }

    function formatShortDateTime(value) {
        if (!value) return '—';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return value;
        return date.toLocaleString('vi-VN', { hour12: false });
    }

    // ======================================================================
    // GOM DỮ LIỆU FORM -> BẢN GHI (giữ nguyên cấu trúc)
    // ======================================================================
    function buildComplaintRowFromForm() {
        const v = (id) => normalizeText($(id)?.value);
        const info = {
            source: v('complaint-source'),
            kv: v('complaint-kv'),
            cn: normalizeText($('complaint-cn-search')?.value || $('complaint-cn').value),
            phone: v('complaint-phone'),
            nickFtel: normalizeText($('complaint-ftel-search')?.value || $('complaint-ftel').value),
            customer: v('complaint-customer'),
            postUrl: v('complaint-post-url'),
            complaintText: v('complaint-content'),
            level: v('complaint-level'),
            complaintTime: v('complaint-customer-time'),
            alertReceivedTime: v('complaint-alert-time'),
            firstReplyTime: v('complaint-first-reply'),
            handlingCompletedTime: v('complaint-complete-time'),
            accountReceive: v('complaint-account-receive'),
            accountLead: v('complaint-account-lead'),
            accountLast: v('complaint-account-last'),
            requestType1: v('complaint-request-type-1'),
            requestType2: v('complaint-request-type-2'),
            serviceType: v('complaint-service-type'),
            srCode: v('complaint-sr-code'),
            handlingUnit: v('complaint-handling-unit'),
            voucher: normalizeText($('complaint-voucher-search')?.value || $('complaint-voucher').value),
            result: v('complaint-result'),
            note: v('complaint-note'),
            rawText: v('complaint-paste-text')
        };

        if (Object.values(info).some((value) => Boolean(value))) {
            info.accountReceive = info.accountReceive || DEFAULT_ACCOUNT;
            info.accountLead = info.accountLead || DEFAULT_ACCOUNT;
            info.accountLast = info.accountLast || DEFAULT_ACCOUNT;
        }

        const noteDetection = complaintState.detected || extractProcessingDetails(info.note);
        const enteredValue = info.phone.toUpperCase();
        const contractNo = /^[A-Z]{2}[A-Z]{3}\d{4}$/.test(enteredValue) || /^[A-Z]{2}\d{7,8}$/.test(enteredValue)
            ? enteredValue : (noteDetection.contractNo || '');
        const phoneValue = contractNo ? '' : (normalizePhone(info.phone) || noteDetection.phone || '');
        const existing = complaintState.editingId ? complaintState.records.find((r) => r.id === complaintState.editingId) : null;

        return {
            id: complaintState.editingId || ('complaint_' + Date.now() + '_' + Math.random().toString(16).slice(2, 8)),
            source: info.source,
            status: deriveStatus(info.result), // luôn suy ra từ KQ, không lấy từ ô nhập
            kv: info.kv,
            cn: info.cn,
            phone: phoneValue,
            contractNo,
            nickFtel: info.nickFtel,
            customer: info.customer,
            customerInfo: info.customer,
            customerProfile: v('complaint-customer-profile'),
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
            createdAt: (existing && existing.createdAt) || new Date().toISOString()
        };
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

    function storeComplaintRecord(record) {
        const rows = complaintState.records;
        record.status = deriveStatus(record.result);
        const index = rows.findIndex((item) => item.id === record.id);
        if (index >= 0) rows[index] = record;
        else rows.unshift(record);
        rows.forEach((item, idx) => { item.stt = idx + 1; });
        syncStatuses();
        saveComplaintState();
        renderComplaintTable();
        return record;
    }

    // ======================================================================
    // LƯU LOCAL / DRIVE
    // ======================================================================
    function saveComplaintState() {
        const state = { records: complaintState.records };
        safeLocalSet(TABLE_KEY, state);
        if (window.GPORTAL_FOLDERS && typeof window.saveJsonToDrive === 'function' && window.AppState && window.AppState.isLoggedIn) {
            window.saveJsonToDrive('complaints.json', state, window.GPORTAL_FOLDERS.settings).catch((err) => {
                console.warn('[Complaint] Không thể lưu lên Drive:', err);
            });
        }
    }

    async function loadComplaintState() {
        const state = safeLocalGet(TABLE_KEY);
        complaintState.records = state && Array.isArray(state.records) ? state.records : [];
        syncStatuses();
        renderComplaintTable();

        if (window.GPORTAL_FOLDERS && window.AppState && window.AppState.isLoggedIn && typeof window.getJsonFromDrive === 'function') {
            try {
                const remote = await window.getJsonFromDrive('complaints.json', window.GPORTAL_FOLDERS.settings);
                if (remote && Array.isArray(remote.records)) {
                    complaintState.records = remote.records;
                    syncStatuses();
                    safeLocalSet(TABLE_KEY, { records: complaintState.records });
                }
            } catch (err) {
                console.warn('[Complaint] Không tải được dữ liệu từ Drive:', err);
            }
        }
        renderComplaintTable();
    }

    // ======================================================================
    // GOOGLE SHEETS (giữ nguyên logic)
    // ======================================================================
    function complaintSheetIdFromInput(value) {
        const text = normalizeText(value);
        const match = text.match(/\/spreadsheets\/d\/([\w-]+)/);
        return match ? match[1] : text;
    }

    function setComplaintSheetStatus(message, isError) {
        const status = $('complaint-sheet-status');
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
        let spreadsheetId = complaintSheetIdFromInput($('complaint-sheet-id')?.value || '') || localStorage.getItem(SHEET_ID_KEY) || '';
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
        const input = $('complaint-sheet-id');
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

    // Hàng đợi tuần tự: lưu liên tục nhiều khiếu nại không làm 2 lần đồng bộ chạy song song
    let sheetQueue = Promise.resolve();
    function queueSheetSync(record) {
        setComplaintSheetStatus('Đang đồng bộ…', false);
        sheetQueue = sheetQueue.then(() => syncComplaintRecord(record)).catch((error) => {
            setComplaintSheetStatus(`Đã lưu nội bộ · Sheet chưa đồng bộ: ${error.message}`, true);
        });
        return sheetQueue;
    }

    // ======================================================================
    // FORM: XÓA / PARSE / LƯU
    // ======================================================================
    function clearComplaintForm() {
        const textIds = [
            'complaint-cn-search', 'complaint-phone', 'complaint-ftel-search', 'complaint-customer', 'complaint-customer-profile',
            'complaint-post-url', 'complaint-content', 'complaint-customer-time', 'complaint-alert-time', 'complaint-first-reply',
            'complaint-complete-time', 'complaint-account-receive', 'complaint-account-lead', 'complaint-account-last',
            'complaint-sr-code', 'complaint-voucher-search', 'complaint-note', 'complaint-paste-text'
        ];
        const selectIds = [
            'complaint-source', 'complaint-kv', 'complaint-cn', 'complaint-ftel', 'complaint-level', 'complaint-request-type-1',
            'complaint-request-type-2', 'complaint-service-type', 'complaint-handling-unit', 'complaint-voucher', 'complaint-result'
        ];
        textIds.concat(selectIds).forEach((id) => { const node = $(id); if (node) node.value = ''; });
        setDetectionSummary([]);
        complaintState.lastParsed = null;
        complaintState.detected = null;
        refreshComplaintStatusField(); // KQ đã xóa -> In Process
        fillSelect($('complaint-request-type-2'), [], '');
        updateRelatedDropdowns();
        updatePostLinkDisplay();
        ['complaint-branch-origin', 'complaint-ftel-origin'].forEach((id) => { if ($(id)) $(id).textContent = ''; });
        closeBranchMenu(false);
        setPane('info');
        autoGrowAll();
    }

    function parseAndPopulate() {
        const text = $('complaint-paste-text')?.value || '';
        if (!text.trim()) {
            alert('Vui lòng dán nội dung email/alert trước khi phân tích.');
            return;
        }
        const parsed = parseComplaintEmail(text);
        complaintState.lastParsed = parsed;

        const confidenceRank = { low: 0, medium: 1, high: 2 };
        const fieldPairs = [
            ['complaint-source', parsed.detected.source, 'source', 'Nguồn'],
            ['complaint-customer', parsed.detected.customerName, 'customerName', 'Khách hàng'],
            ['complaint-customer-profile', parsed.detected.customerProfileUrl, 'customerProfileUrl', 'Profile/Email'],
            ['complaint-post-url', parsed.detected.postUrl, 'postUrl', 'Link bài viết'],
            ['complaint-customer-time', toLocalInput(parsed.detected.customerComplaintTime || ''), 'customerComplaintTime', 'TG phản ánh'],
            ['complaint-alert-time', toLocalInput(parsed.detected.alertReceivedTime || ''), 'alertReceivedTime', 'TG nhận mail'],
            ['complaint-content', parsed.detected.complaintContent || text, 'complaintContent', 'Nội dung']
        ];
        const eligiblePairs = fieldPairs.filter(([, value, confidenceKey]) => value && (confidenceRank[parsed.confidence[confidenceKey] || 'low'] >= confidenceRank.medium));
        const conflicts = eligiblePairs.filter(([id]) => $(id)?.value.trim()).filter(([id, value]) => $(id).value.trim() !== value);
        const replaceExisting = conflicts.length && window.confirm(`Phân tích phát hiện ${conflicts.length} trường đã có dữ liệu. Ghi đè các trường này? Chọn Hủy để chỉ điền trường còn trống.`);

        const applied = [];
        eligiblePairs.forEach(([id, value, , label]) => {
            const element = $(id);
            if (!element) return;
            if (element.value.trim() && element.value.trim() !== value && !replaceExisting) return;
            if (element.tagName === 'SELECT') {
                if (!Array.from(element.options).some((option) => option.value === value)) element.add(new Option(value, value));
            }
            element.value = value;
            applied.push(label);
        });

        setDetectionSummary(applied);
        updateRelatedDropdowns();
        updatePostLinkDisplay();
        autoGrowAll();
    }

    async function saveComplaint(addNext) {
        const record = buildComplaintRowFromForm();
        const errors = validateComplaintRecord(record);
        if (errors.length) {
            alert(errors.join('\n'));
            return;
        }
        storeComplaintRecord(record);
        queueSheetSync(record); // đồng bộ nền, không chặn thao tác kế tiếp
        if (typeof window.showToast === 'function') window.showToast('Đã lưu khiếu nại');

        if (addNext) {
            complaintState.editingId = null;
            clearComplaintForm();
            showComplaintModal('new', null);
        } else {
            closeComplaintModal();
        }
    }

    // ======================================================================
    // BẢNG DANH SÁCH: BỘ LỌC / CỘT / RENDER
    // ======================================================================
    const FILTER_FIELDS = {
        source: 'complaint-filter-source', kv: 'complaint-filter-kv', cn: 'complaint-filter-cn',
        nickFtel: 'complaint-filter-ftel', level: 'complaint-filter-level', status: 'complaint-filter-status',
        requestType1: 'complaint-filter-request1', requestType2: 'complaint-filter-request2',
        serviceType: 'complaint-filter-service', handlingUnit: 'complaint-filter-unit',
        voucher: 'complaint-filter-voucher', result: 'complaint-filter-result'
    };

    function refreshComplaintFilterOptions() {
        Object.entries(FILTER_FIELDS).forEach(([field, id]) => {
            const select = $(id);
            if (!select) return;
            const selected = select.value;
            let options = unique(complaintState.records.map((record) => record[field]).filter(Boolean)).sort((a, b) => String(a).localeCompare(String(b), 'vi'));
            // Bộ lọc Trạng thái: luôn theo thứ tự cố định, chỉ hiện trạng thái đang có dữ liệu
            if (field === 'status') options = STATUS_LIST.filter((status) => options.includes(status));
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
        const options = $('complaint-column-options');
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
        $('btn-complaint-columns-reset')?.addEventListener('click', () => {
            safeLocalSet(COLUMN_VISIBILITY_KEY, {});
            applyComplaintColumnVisibility();
        });
        applyComplaintColumnVisibility();
    }

    function applyComplaintSearch() {
        syncStatuses(); // đảm bảo Trạng thái luôn khớp KQ trước khi lọc / hiển thị
        const query = normalizeText($('complaint-search')?.value || '').toLowerCase();
        const rows = complaintState.records.filter((item) => {
            const categoryMatches = Object.entries(FILTER_FIELDS).every(([field, id]) => {
                const value = $(id)?.value || '';
                return !value || String(item[field] || '') === value;
            });
            const dateField = $('complaint-filter-date-field')?.value || 'complaintTime';
            const complaintDate = String(item[dateField] || '').slice(0, 10);
            const from = $('complaint-filter-from')?.value || '';
            const to = $('complaint-filter-to')?.value || '';
            if (!categoryMatches || (from && (!complaintDate || complaintDate < from)) || (to && (!complaintDate || complaintDate > to))) return false;
            const identifier = normalizeText($('complaint-filter-identifier')?.value || '').toLowerCase();
            const account = normalizeText($('complaint-filter-account')?.value || '').toLowerCase();
            const sr = normalizeText($('complaint-filter-sr')?.value || '').toLowerCase();
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
        const tbody = $('complaint-tbody');
        if (!tbody) return;
        if (!rows.length) {
            tbody.innerHTML = '<tr><td colspan="26" style="text-align:center; padding:42px; color:var(--text-muted);">Không tìm thấy Complaint phù hợp.</td></tr>';
            return;
        }
        tbody.innerHTML = rows.map((item) => {
            const statusKey = statusKeyOf(item.status);
            return `
            <tr data-id="${escapeHtml(item.id)}" class="st-row st-${statusKey}" style="cursor:pointer;">
                <td>${escapeHtml(item.stt || '')}</td>
                <td>${escapeHtml(item.source || '—')}</td>
                <td><span class="complaint-table-status">${escapeHtml(item.status || DEFAULT_STATUS)}</span></td>
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
            </tr>`;
        }).join('');

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
        syncStatuses();
        const tbody = $('complaint-tbody');
        const badge = $('complaint-count-badge');
        if (badge) badge.textContent = `${complaintState.records.length} bản ghi`;
        if (!tbody) return;
        if (!complaintState.records.length) {
            tbody.innerHTML = '<tr><td colspan="26" style="text-align:center; padding:42px; color:var(--text-muted);">Chưa có dữ liệu Complaint — bấm <strong>+ Thêm khiếu nại</strong> để bắt đầu.</td></tr>';
            refreshComplaintFilterOptions();
            return;
        }
        applyComplaintSearch();
    }

    // ======================================================================
    // SỰ KIỆN
    // ======================================================================
    function bindComplaintEvents() {
        if (document.body.dataset.complaintEventsBound === '3') return;
        document.body.dataset.complaintEventsBound = '3';

        $('btn-complaint-add')?.addEventListener('click', () => { clearComplaintForm(); showComplaintModal('new', null); });
        $('btn-complaint-refresh')?.addEventListener('click', () => loadComplaintState());
        $('btn-close-complaint-modal')?.addEventListener('click', closeComplaintModal);
        $('btn-complaint-cancel')?.addEventListener('click', closeComplaintModal);
        $('btn-parse-complaint')?.addEventListener('click', parseAndPopulate);
        $('btn-clear-complaint')?.addEventListener('click', clearComplaintForm);
        $('btn-save-complaint')?.addEventListener('click', () => saveComplaint(false));
        $('btn-save-complaint-next')?.addEventListener('click', () => saveComplaint(true));
        $('btn-delete-complaint')?.addEventListener('click', () => {
            if (!complaintState.editingId) return;
            if (!confirm('Bạn có chắc chắn muốn xóa khiếu nại này?')) return;
            complaintState.records = complaintState.records.filter((item) => item.id !== complaintState.editingId);
            saveComplaintState();
            renderComplaintTable();
            closeComplaintModal();
        });
        $('complaint-search')?.addEventListener('input', applyComplaintSearch);

        // Tab chuyển ngăn (màn hình hẹp)
        document.querySelectorAll('#complaint-modal .cm-tab').forEach((tab) => tab.addEventListener('click', () => setPane(tab.dataset.pane)));

        // Phím tắt: Ctrl+Enter = Lưu, Esc = đóng menu / đóng modal
        document.addEventListener('keydown', (event) => {
            if (!isModalOpen()) return;
            if (event.key === 'Escape') {
                if (branchMenuOpen()) closeBranchMenu(true); else closeComplaintModal();
            } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                saveComplaint(false);
            }
        });
        $('complaint-modal')?.addEventListener('click', (event) => {
            if (event.target && event.target.id === 'complaint-modal') closeComplaintModal();
        });

        // Ô văn bản dài: tự giãn tới mức tối đa
        ['complaint-paste-text', 'complaint-content', 'complaint-note'].forEach((id) => $(id)?.addEventListener('input', (e) => autoGrow(e.target)));

        // Bộ lọc / cột / panel
        const togglePanel = (button, panelId) => button?.addEventListener('click', () => {
            const panel = $(panelId);
            if (!panel) return;
            panel.hidden = !panel.hidden;
            button.setAttribute('aria-expanded', String(!panel.hidden));
        });
        togglePanel($('btn-complaint-filters'), 'complaint-filter-panel');
        togglePanel($('btn-complaint-columns'), 'complaint-columns-panel');
        setupComplaintColumnVisibility();
        Object.values(FILTER_FIELDS).forEach((id) => $(id)?.addEventListener('change', applyComplaintSearch));
        $('complaint-filter-date-field')?.addEventListener('change', applyComplaintSearch);
        ['complaint-filter-from', 'complaint-filter-to', 'complaint-filter-identifier', 'complaint-filter-account', 'complaint-filter-sr'].forEach((id) => {
            $(id)?.addEventListener('input', applyComplaintSearch);
            $(id)?.addEventListener('change', applyComplaintSearch);
        });
        $('btn-complaint-filter-clear')?.addEventListener('click', () => {
            Object.values(FILTER_FIELDS).forEach((id) => { const input = $(id); if (input) input.value = ''; });
            ['complaint-filter-from', 'complaint-filter-to', 'complaint-filter-identifier', 'complaint-filter-account', 'complaint-filter-sr'].forEach((id) => {
                const input = $(id); if (input) input.value = '';
            });
            applyComplaintSearch();
        });

        // Google Sheets
        const sheetInput = $('complaint-sheet-id');
        if (sheetInput) sheetInput.value = localStorage.getItem(SHEET_ID_KEY) || '';
        $('btn-complaint-sheet-save')?.addEventListener('click', () => {
            const id = complaintSheetIdFromInput(sheetInput?.value || '');
            if (!id) { alert('Dán URL hoặc ID Google Sheet trước khi lưu.'); return; }
            localStorage.setItem(SHEET_ID_KEY, id);
            if (sheetInput) sheetInput.value = id;
            setComplaintSheetStatus('Đã lưu cấu hình Sheet', false);
        });
        $('btn-complaint-sheet-sync')?.addEventListener('click', async () => {
            setComplaintSheetStatus('Đang đồng bộ…', false);
            try { await syncComplaintRecords(); }
            catch (error) { setComplaintSheetStatus(`Đồng bộ thất bại: ${error.message}`, true); }
        });

        // KV -> CN
        $('complaint-kv')?.addEventListener('change', onKVChange);
        const branchInput = $('complaint-cn-search');
        branchInput?.addEventListener('focus', () => { branchInput.select(); openBranchMenu(true); });
        branchInput?.addEventListener('click', () => { if (!branchMenuOpen()) openBranchMenu(true); });
        branchInput?.addEventListener('input', () => openBranchMenu(false));
        branchInput?.addEventListener('keydown', (event) => {
            if (event.key === 'ArrowDown') { event.preventDefault(); if (!branchMenuOpen()) openBranchMenu(true); moveBranchActive(1); }
            else if (event.key === 'ArrowUp') { event.preventDefault(); if (branchMenuOpen()) moveBranchActive(-1); }
            else if (event.key === 'Enter' && branchMenuOpen()) {
                event.preventDefault();
                event.stopPropagation();
                const items = Array.from(document.querySelectorAll('#complaint-cn-options .cm-option'));
                const target = branchActive >= 0 ? items[branchActive] : (items.length === 1 ? items[0] : null);
                if (target) target.click();
            } else if (event.key === 'Tab') closeBranchMenu(true);
        });
        $('complaint-cn-toggle')?.addEventListener('click', () => {
            if (branchMenuOpen()) closeBranchMenu(true); else { branchInput?.focus(); openBranchMenu(true); }
        });
        document.addEventListener('pointerdown', (event) => {
            const picker = document.querySelector('#complaint-modal .complaint-branch-picker');
            if (branchMenuOpen() && picker && !picker.contains(event.target)) closeBranchMenu(true);
        });

        $('complaint-ftel-search')?.addEventListener('input', (event) => {
            setComboValue($('complaint-ftel'), event.target, event.target.value);
            const origin = $('complaint-ftel-origin');
            if (origin) origin.textContent = '';
        });
        $('complaint-voucher-search')?.addEventListener('input', (event) => setComboValue($('complaint-voucher'), event.target, event.target.value));
        $('complaint-post-url')?.addEventListener('input', updatePostLinkDisplay);
        $('complaint-request-type-1')?.addEventListener('change', () => {
            fillSelect($('complaint-request-type-2'), getSRType2Options($('complaint-request-type-1').value), '');
        });
        $('complaint-note')?.addEventListener('input', (event) => updateProcessingDetection(event.target.value, true));
        // Đổi KQ -> Trạng thái cập nhật ngay
        $('complaint-result')?.addEventListener('change', refreshComplaintStatusField);
        $('complaint-result')?.addEventListener('input', refreshComplaintStatusField);

        // Có dữ liệu thì tự điền 3 Account mặc định
        const dataEntryIds = ['complaint-source', 'complaint-kv', 'complaint-cn-search', 'complaint-phone', 'complaint-ftel-search', 'complaint-customer', 'complaint-customer-profile', 'complaint-post-url', 'complaint-content', 'complaint-level', 'complaint-customer-time', 'complaint-alert-time', 'complaint-first-reply', 'complaint-complete-time', 'complaint-request-type-1', 'complaint-request-type-2', 'complaint-service-type', 'complaint-sr-code', 'complaint-handling-unit', 'complaint-voucher-search', 'complaint-result', 'complaint-note'];
        const fillAccountsIfRowHasData = () => {
            if (!dataEntryIds.some((fieldId) => normalizeText($(fieldId)?.value))) return;
            ['complaint-account-receive', 'complaint-account-lead', 'complaint-account-last'].forEach((accountId) => {
                const input = $(accountId);
                if (input && !input.value) input.value = DEFAULT_ACCOUNT;
            });
        };
        dataEntryIds.forEach((id) => {
            $(id)?.addEventListener('input', fillAccountsIfRowHasData);
            $(id)?.addEventListener('change', fillAccountsIfRowHasData);
        });

        $('complaint-paste-text')?.addEventListener('paste', () => { setTimeout(parseAndPopulate, 150); });
    }

    function initComplaintPage() {
        buildComplaintModal();
        collectWorkflowOptions();
        bindComplaintEvents();
        loadComplaintState();
    }

    window.loadComplaintPage = async function () {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initComplaintPage, { once: true });
            return;
        }
        buildComplaintModal();
        collectWorkflowOptions(); // nạp lại danh mục (Workflow Setting có thể vừa tải xong từ Drive)
        bindComplaintEvents();
        await loadComplaintState();
    };

    document.addEventListener('DOMContentLoaded', initComplaintPage, { once: true });
})();

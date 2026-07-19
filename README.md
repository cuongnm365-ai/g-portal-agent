# G-Portal (đã gộp thêm module Soạn Email)

Cổng thông tin cá nhân: Lịch làm việc + Năng suất/KPI + **Soạn Email nghiệp vụ** (gộp từ repo `email-template-tool`), dùng chung **một** hệ thống đăng nhập Google và **một** trang Cài Đặt duy nhất.

## Những gì đã thay đổi khi gộp 2 repo

1. **Đăng nhập Google dùng chung duy nhất**
   - Loại bỏ hoàn toàn `JS/google-auth.js` (Google Identity Services / One-Tap riêng của email-template-tool).
   - `js/core/googleSync.js` (của G-Portal) được bổ sung scope `openid email profile`, sau khi đăng nhập sẽ gọi `fetchUserProfile()` để lấy tên/email/ảnh đại diện, lưu vào `AppState.userProfile` và hiển thị ở góc phải Header (`#user-profile-box`).
   - Module Soạn Email (`js/modules/email-tool/engine.js`) đọc `AppState.userProfile` thay vì `authManager.user` như bản cũ — dùng để gợi ý "Tên Agent" và gửi kèm khi ghi nhận thống kê sử dụng mẫu.

2. **Menu mới "Soạn Email"**
   - Thêm mục `Soạn Email` vào sidebar (`data-target="email"`), route bởi `js/core/app.js` như mọi module khác.
   - Bên trong có 2 tab con: **Soạn Email** (chọn mẫu, điền form, xem trước, copy) và **Thống kê sử dụng** (bảng xếp hạng mẫu email dùng nhiều nhất, lấy từ Google Apps Script API như bản gốc).

3. **Trang Cài Đặt gộp làm MỘT**
   - `view-settings` giờ có đủ: Ca làm việc, Ca tăng cường (OT), PCCV, Nhân sự, Tham số KPI (của G-Portal) **và** khối "Cấu hình module Soạn Email" (Email BCC mặc định, Email/Ký tự nhận diện Miền Nam – Miền Bắc) ở cuối trang.
   - Khối cấu hình Soạn Email vẫn bị khoá chỉnh sửa (chỉ Admin cấu hình qua Google Sheet) giống bản gốc — xem `js/modules/email-tool/settings-panel.js`.

4. **CSS được scope lại, không xung đột**
   - `css/email-tool.css` là bản viết lại của `CSS/style.css` gốc, toàn bộ biến (`--accent`, `--bg`...) đã đổi tên và **chỉ áp dụng bên trong `#view-email`**, không còn đè lên theme chính (`--bg-primary`, `--accent`...) của G-Portal.
   - Vẫn cần Tailwind CDN + Font Awesome CDN + DOMPurify (module Soạn Email dùng class tiện ích Tailwind ở nhiều nơi, kể cả trong HTML sinh động của bảng thống kê).

5. **Giữ nguyên toàn bộ nghiệp vụ 12 mẫu email** (`js/modules/email-tool/templates/*.js`) và engine sinh nội dung/QR/CC-BCC theo vùng miền — không đổi logic nghiệp vụ, chỉ đổi đường dẫn file.

## Cấu trúc thư mục

```
index.html
css/
  base.css            (theme + layout chính G-Portal)
  login.css           (màn hình đăng nhập dùng chung)
  components.css      (card, nút, lịch, KPI... của G-Portal)
  email-tool.css      (style riêng module Soạn Email, đã scope dưới #view-email)
js/
  core/
    app.js            (Router + Theme + Login Gate, đã thêm view "email")
    googleSync.js     (Đăng nhập Google DUY NHẤT + Drive/Calendar/Tasks + hồ sơ user)
    drive.js           (Đọc/ghi JSON lên Google Drive)
  modules/
    settings/settings.js         (Ca/OT/PCCV/Nhân sự/KPI)
    schedule/schedule.js          (Lịch làm việc + đồng bộ Google)
    productivity/productivity.js  (Nhập năng suất)
    dashboard/dashboard.js        (Dashboard KPI)
    email-tool/
      region-detector.js   (nhận diện vùng miền + tải cấu hình BCC/CC)
      engine.js             (render form + sinh nội dung email)
      settings-panel.js     (tab con Thống kê + khối Cài đặt Email)
      ui-enhancements.js    (status pill)
      templates/*.js        (12 mẫu email nghiệp vụ)
```

## Validate trước khi triển khai

- `node --check` cho toàn bộ file `.js` — không lỗi cú pháp.
- Kiểm tra Python: không có `id` trùng lặp trong `index.html`.
- Đối chiếu toàn bộ `getElementById()` trong JS với `index.html` — khớp (trừ các `field_*` do `engine.js` sinh động khi chọn mẫu).

## Lưu ý triển khai

- Vẫn dùng chung `CLIENT_ID` OAuth hiện có của G-Portal trong `js/core/googleSync.js` — vì đã thêm scope `openid email profile`, cần đảm bảo OAuth Consent Screen trên Google Cloud Console cho phép các scope này (thường bật sẵn theo mặc định).
- 2 API Google Apps Script của module Soạn Email (`CONFIG_API_URL` trong `region-detector.js`, `STATS_API_URL` trong `engine.js`/`settings-panel.js`) giữ nguyên như bản gốc, không yêu cầu đăng nhập nên không bị ảnh hưởng bởi việc gộp hệ thống auth.
- Nếu muốn đưa cấu hình Email (BCC/Vùng miền) vào lưu trên Google Drive giống các module khác thay vì Google Apps Script, cần bổ sung thêm 1 `folderId` mới trong `FOLDER_IDS` (`js/core/googleSync.js`) và viết lại `region-detector.js`/`settings-panel.js` để gọi `getJsonFromDrive`/`saveJsonToDrive` — hiện tại chưa làm vì chưa có yêu cầu cụ thể.

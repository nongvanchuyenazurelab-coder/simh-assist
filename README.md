# YTCS Multi-Account & Multi-Tab Manager (Quản trị Đa Tài khoản & Đa Tab YTCS HMIS)

Ứng dụng web chuyên dụng cho quản trị viên trang **https://ytcs.hmis.vn/**:
- Giao diện có thanh điều khiển (**Header**) cố định ở trên với danh bạ tài khoản quản trị (Username, Password, Tên trạm/CSYT).
- Thanh **Tab Bar phong cách Chrome / Edge** cho phép mở và làm việc cùng lúc trên **nhiều Tab / nhiều Trạm y tế / nhiều Tài khoản song song** mà không bao giờ bị xung đột phiên làm việc hay mất dữ liệu đang gõ.
- Phần thân hiển thị trang **YTCS HMIS trong Frame** (`iframe`).
- Tự động gọi API đăng nhập, lấy Token mới, tự động thiết lập Khoa & Phòng đầu tiên và chuyển thẳng vào phân hệ Tiếp nhận bệnh nhân mà **không cần phải ra màn login của HIS**.

---

## 🚀 Cách khởi động (Chỉ 1 Click)

1. Mở thư mục `ytcs-multi-account-manager`.
2. Nhấp đúp chuột vào file **`start.bat`**.
3. Cửa sổ dòng lệnh sẽ khởi động máy chủ tại `http://localhost:8888` và **tự động mở trình duyệt web**.

*(Hoặc mở Command Prompt / PowerShell trong thư mục và gõ `node server.js`)*.

---

## 📑 Hướng dẫn tạo & sử dụng nhiều Tab song song

Có **2 CÁCH** để bạn làm việc đa tab cực kỳ tiện lợi:

### Cách 1: Sử dụng thanh Tab Bar ngay trong trang web (In-App Tabs)
1. Trên giao diện `http://localhost:8888`, nhìn xuống thanh màu xám ngay dưới Header (thanh Tab Bar).
2. Nhấn nút **`➕ Thêm Tab`** (hoặc nút **`➕ Mở Tab mới`** màu xanh lá trên Header).
3. Hộp thoại mở ra cho phép bạn:
   - Chọn trạm / tài khoản thứ 2 từ danh bạ đã lưu (hoặc gõ tài khoản mới).
   - Chọn phân hệ bắt đầu (mặc định vào ngay *Tiếp nhận khám bệnh*).
   - Nhấn **`➕ Tạo Tab Trong Trang`**.
4. Một Tab mới sẽ xuất hiện trên thanh Tab Bar (`🏥 [Tên trạm / Tên TK] ✕`).
5. **Chuyển đổi qua lại giữa các Tab**:
   - Nhấp chuột vào Tab bạn muốn xem: Giao diện chuyển đổi tức thì **không reload**, giữ nguyên mọi thông tin, biểu mẫu hoặc danh sách bệnh nhân bạn đang nhập liệu.
   - **Đổi tên Tab**: Nhấp đúp chuột (Double-click) vào tiêu đề Tab để đổi tên theo ý muốn (Ví dụ: *Phòng khám 1*, *Quầy Dược*, *Tiếp đón trạm B*, v.v.).
   - **Đóng Tab**: Nhấp vào dấu **✕** trên Tab.

### Cách 2: Mở nhiều Tab trình duyệt Chrome/Edge độc lập (Browser Tabs)
Nếu bạn muốn chia đôi màn hình máy tính hoặc kéo sang màn hình thứ hai để làm việc đồng thời:
1. Nhấn nút **`↗️ Mở Tab Trình duyệt riêng`** trên thanh Tab Bar.
2. Hoặc bạn có thể gõ trực tiếp trên thanh địa chỉ trình duyệt:
   - Tab trình duyệt 1: `http://localhost:8888`
   - Tab trình duyệt 2: `http://acc1.localhost:8888`
   - Tab trình duyệt 3: `http://acc2.localhost:8888`
   - Tab trình duyệt 4: `http://acc3.localhost:8888`...
3. **Tại sao không bị xung đột tài khoản?**
   - Theo chuẩn quốc tế RFC 6761, Windows và trình duyệt tự động trỏ mọi tên miền `*.localhost` về máy tính của bạn mà không cần cài đặt gì thêm.
   - Trình duyệt Chrome/Edge xem mỗi tên miền `acc1.localhost`, `acc2.localhost` là một trang web riêng biệt hoàn toàn. Do đó, LocalStorage, Cookies và Token của từng tab được cách ly 100%, bạn có thể mở 10 tab cho 10 trạm y tế khác nhau mà không bao giờ bị đá phiên hay đè tài khoản của nhau!

---

## 🌟 Các tính năng chính khác

1. **Bộ công cụ Cấu hình Liên thông Y tế Toàn diện (Tích hợp từ lien_thong_ksk)**:
   - Truy cập ngay bằng nút **`🛠️ Liên thông KSK & ĐTĐT`** trên thanh Tab Bar (hoặc chọn trong menu chuyển phân hệ nhanh).
   - Tự động đồng bộ Token của tài khoản đang chọn từ Header sang màn hình cấu hình.
   - **Tab 1 - KSK**: Quản lý thông tin liên thông Khám sức khỏe lái xe (api.emrhub.vn), tự động đăng nhập `admin.emrhub.vn` để trích xuất cặp khóa RSA Public / Private Key, Test API KSK tức thì.
   - **Tab 2 - Đơn Thuốc ĐT**: Cấu hình Đơn thuốc điện tử Quốc gia (`DON_THUOC_DIEN_TU`, mã liên thông, mật khẩu liên thông, mã CSKCB) và cấu hình đẩy cổng tự động (`KB_CHIDINHTVT`).
   - **Tab 3 - Viện Phí**: Cấu hình hiển thị chữ ký Kế toán viện phí và Người lập bảng kê chi phí KCB (`VPI_BAOHIEM`).
   - **Tab 4 - Mẹ & Bé**: Cấu hình liên thông Sổ theo dõi sức khỏe bà mẹ & trẻ em (`EMCH`).
   - **Tab 5 - Mẫu Bảng Kê**: Quản lý và bật/tắt các mẫu in bảng kê chi phí KCB theo Công văn 697 (`dmcbaocao`).
   - **Tab 6 - Bóc Dữ Liệu**: Trích xuất và giải mã Base64 XML từ cổng in ấn `https://ytcs-gw.hmis.vn/api/common/phieuin/data`.

2. **Tự động thiết lập Khoa/Phòng đầu tiên**:
   - Ngay khi đăng nhập, hệ thống tự động tìm và chọn Khoa & Phòng đầu tiên của đơn vị, gọi cache máy chủ và **chuyển thẳng vào Tiếp nhận khám bệnh**, bỏ qua hoàn toàn màn hình chọn khoa phòng trung gian.
3. **Quản lý danh sách tài khoản (Account Manager)**:
   - Thêm tài khoản mới (Tên trạm, Username, Password, Region Code).
   - Chỉnh sửa, xoá tài khoản.
   - Sao lưu (Xuất file JSON) & Phục hồi (Nhập file JSON) để đồng bộ giữa các máy tính.
4. **Điều hướng phân hệ nhanh**:
   - Chuyển nhanh giữa: *Khám Ngoại trú (Tiếp nhận)*, *Khám Ngoại trú (Tổng quan)*, *Điều trị Nội trú*, *Dược*, *Viện phí*, *Quản trị hệ thống*.
4. **Tối ưu không gian làm việc**:
   - Nút thu gọn thanh Header (▲) để tối đa hoá diện tích màn hình khi làm việc trên phần mềm HIS.
   - Nút làm mới frame (🔄) tải lại nội dung tab nhanh chóng.
5. **Reverse Proxy thông minh & Khắc phục lỗi hiển thị**:
   - Tự động khắc phục lỗi CORS và lỗi ngôn ngữ (tiếng Việt mã thô).
   - Vượt qua rào cản `X-Frame-Options` và `Content-Security-Policy`.
   - Kết nối trực tiếp tới API Gateway `https://ytcs-gw.hmis.vn/`.

---

## 📂 Cấu trúc thư mục

- `server.js`: Máy chủ proxy và backend xử lý đăng nhập, quản lý đa tab và phiên làm việc.
- `accounts.json`: File lưu trữ danh sách tài khoản (đã có sẵn tài khoản mẫu của bạn).
- `public/index.html`: Giao diện Header quản trị, thanh Tab Bar Chrome-style và các khung nhúng HIS.
- `start.bat`: Phím tắt chạy nhanh 1 click trên Windows.

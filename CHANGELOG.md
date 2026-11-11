# Nhật ký thay đổi

Mọi thay đổi đáng chú ý của dự án được ghi ở đây. Định dạng theo [Keep a Changelog](https://keepachangelog.com/vi/1.1.0/), phiên bản theo [Semantic Versioning](https://semver.org/lang/vi/).

## Chưa phát hành

### Thay đổi & Cải tiến

- **Tab Chơi tự do**: xoay Rubik ảo bằng vuốt hàng/cột ngoài, nút xoay hoặc bàn phím; kéo ô tâm/nền để đổi góc nhìn. Có hoàn tác/làm lại, tráo khối, chạy/dừng công thức nhập tay và tự lưu khối cùng lịch sử. Khối tự chơi độc lập với khối đang chụp, lời giải và mẫu bài học.
- **Tab Học chơi riêng**: 15 bài từ cách cầm khối, đọc ký hiệu, giải cơ bản 7 bước đến kết hợp công thức, F2L (hai tầng đầu), OLL (định hướng tầng cuối) và PLL (hoán vị tầng cuối). Có 19 công thức/mẫu với điều kiện áp dụng, chia cụm để ghi nhớ, mô phỏng 3D độc lập, tiến/lùi, tự chạy/dừng, chọn tốc độ và lưu tiến độ học trên trình duyệt. Hỗ trợ màn hình điện thoại và đổi tab bằng bàn phím.
- **Xác nhận chụp theo màu tâm**: khi bấm xác nhận cho mặt có màu tâm đã lưu trước đó, app tự động **cập nhật ảnh mới nhất vào đúng tâm đó** thay vì tạo thêm ảnh mới và làm mất lượt chụp của các mặt còn lại (ví dụ bấm xác nhận 3 lần liên tiếp trên cùng 1 tâm chỉ cập nhật ảnh cuối cùng của tâm đó).
- **Khắc phục nhầm màu Đỏ↔Cam và Vàng↔Xanh lá/Xanh dương**:
  - Mở rộng vùng nhận diện Đỏ dưới ánh sáng vàng ấm (`g/r` thấp), Cam ấm (`h` tới 44°), Vàng ánh chanh (`h` tới 84–90° trên speedcube/đèn LED) và Xanh lá ánh lạnh (`h` tới 182°).
  - Thêm `classifyGrid` tách tương đối Đỏ↔Cam và Vàng↔Xanh lá ngay trong cùng khung hình 9 ô khi có cả hai màu trên một mặt.
  - Bổ sung ràng buộc thứ tự sắc độ/độ sáng tương đối trong không gian Lab cho `classifyAll` để không bao giờ đảo cụm Đỏ↔Cam hay Vàng↔Xanh lá/Xanh dương.
- **Chọn lại màu trực tiếp sau khi chụp**:
  - Ở Bước 1: chạm trực tiếp vào ô màu ngay trên khung ảnh camera (`#camera-canvas`), khung xem trước (`#capture-preview-grid`) hoặc hình mặt bên phải (`#current-preview`) để mở bảng chọn lại màu.
  - Ở Bước 2: hỗ trợ cả 2 cách sửa màu — chạm trực tiếp vào ô sai trên lưới để mở bảng chọn màu, hoặc bấm chọn một màu ở thanh bảng màu (`#palette`) làm cọ vẽ rồi chạm liên tiếp vào các ô cần tô.
- **Chụp và xác nhận màu từng mặt (Bước 1)**:
  - Thêm khung **Xem trước & xác nhận màu** (`#face-preview-box`) ngay dưới khung camera: hiển thị trực tiếp 9 ô màu đang nhận diện, cho phép bấm **✅ Xác nhận màu** ngay khi thấy màu đã đúng, hoặc bấm **📸 Chụp mặt này** để dừng hình, kiểm tra preview 9 ô màu (có thể chạm trực tiếp vào ô bất kỳ trên preview để đổi màu hoặc xoay 90°) rồi chọn **✅ Xác nhận màu mặt này** hoặc **🔄 Chụp lại**.
  - Tắt mặc định chế độ **🎥 Tự chụp khi giữ yên** để app không tự ý chụp và nhảy mặt liên tục khi người dùng chưa xác nhận; khi bật tùy chọn này, giữ yên 1 giây sẽ dừng hình vào chế độ xem trước chờ người dùng xác nhận.
  - **Chống nhảy màu khi bấm chụp**: làm mượt RGB theo thời gian khi giữ yên, lọc nhiễu 1 khung hình (hysteresis 2 mẫu liên tiếp) và chốt mẫu ổn định (`lastStable`) ngay trước khi ngón tay chạm nút làm rung điện thoại (không lấy mẫu lại khung hình bị rung lúc `click`).
  - Giữ nguyên 100% các màu người dùng đã xem và xác nhận ở từng mặt nếu chúng đã ghép được thành khối hợp lệ, tránh việc phân loại toàn cục (`classifyAll`) làm nhảy màu sau khi chụp mặt thứ 6.

### Sửa lỗi

- Có ảnh chụp trùng chưa xử lý thì huỷ lời giải cũ, kể cả khi màu các ô không đổi.
- Chụp lại một mặt không làm mất các ô đã sửa tay ở mặt khác (ô sửa tay đi cùng ảnh khi app ghép/xoay).
- Chụp thiếu mặt rồi tô tay mặt còn lại: khi app xoay cả khối, cờ "đã chụp" đi cùng ảnh; trước đây chụp nốt mặt cuối làm lỗi JS và mất ảnh.
- Vòng vẽ camera không còn dừng hẳn khi gặp ngoại lệ.
- Camera không còn tự bật lại đè lên ảnh vừa chọn; lượt bật camera hoặc đọc ảnh cũ xong muộn thì bị bỏ qua; ảnh hỏng không làm tắt camera đang chạy; ghi chú "đang xin quyền" không còn bị kẹt; lượt bật bị huỷ do đổi bước thì quay lại vẫn tự bật.
- Nút "Tự sắp xếp & xoay mặt" báo rõ khi số ô mỗi màu chưa đủ 9; hai tâm trùng màu vẫn được báo kèm nút chụp lại.
- Tráo/Khối đã giải/Xoá hết đưa bước 1 về ảnh 1.
- Khoá giữ màn hình ở bước 3 không còn bị mất khi đổi bước nhanh hoặc khi quay lại trang.
- Lời giải xong khi đang ở bước 3 thì hiện ngay; đang ở bước 1 thì chỉ báo, không kéo sang bước 3.
- Vòng "Tự chạy" cũ không chạy chồng lên lượt mới.
- "Giải ngay" vẽ lại lưới ngay sau khi tự ghép, tránh chạm nhầm ô trong lúc đang tính.
- Tự chụp hoạt động khi chọn chụp lại một ảnh trong danh sách.
- Gợi ý sửa 2 ô có giới hạn thời gian (trước đây có thể làm đứng giao diện ~2 giây trở lên); bỏ qua tìm kiếm khi số ô mỗi màu chưa đủ 9.
- Worker nạp `cube.js`/`solver.js` cùng tham số phiên bản; chạy dự phòng trên luồng chính thì rút ngắn thời gian tìm lời giải.
- `scripts/serve.js`: trả 400 cho đường dẫn có ký tự NUL hoặc mã hoá lỗi thay vì làm dừng tiến trình; chặn symlink trỏ ra ngoài thư mục gốc hoặc vào file ẩn; trả 405 cho phương thức khác GET/HEAD.
- Kiểm thử trình duyệt: dùng cổng điều khiển Chrome ngẫu nhiên (không nối nhầm Chrome cũ), không treo khi Chrome đóng, mỗi bộ có giới hạn thời gian và dọn cả Chrome khi quá giờ; CI đặt `timeout-minutes` và lưu ảnh cả khi job bị huỷ.

## 0.1.0 - 2026-11-06

Bản phát hành công khai đầu tiên.

### Tính năng

- Chụp 6 mặt bằng camera điện thoại, tự chụp khi giữ yên khoảng 1 giây; hỗ trợ chụp tay, chụp bằng app camera và chọn ảnh có sẵn.
- Nhận màu dùng 6 ô tâm làm mốc, ép mỗi màu đúng 9 ô (phép gán Hungarian trên khoảng cách màu kiểu LCh).
- Tự đổi chỗ và xoay các ảnh chụp nhầm thứ tự/chiều cho thành khối hợp lệ, rồi đưa về cách cầm chuẩn (tâm trắng trên, xanh lá trước).
- Phát hiện hai ảnh chụp trùng một mặt dựa trên màu ảnh gốc, chỉ ra mặt còn thiếu và cho chụp lại.
- Đánh dấu ô nghi nhận sai màu; tìm cặp 2 ô bị nhận nhầm cho nhau và gợi ý sửa bằng một chạm.
- Bộ giải hai pha Kociemba chạy trong Web Worker, lời giải khoảng 20 bước.
- Hướng dẫn từng bước bằng tiếng Việt với mô phỏng 3D, chế độ "Tự chạy".
- Tab đang mở tự phát hiện phiên bản mới của trang.
- Kiểm thử Node (bước xoay, kiểm tra hợp lệ, bộ giải, nhận màu, tự ghép/xoay) và kiểm thử trình duyệt với camera giả.

### Sửa lỗi trước khi phát hành

- Kiểm tra viên góc đối chiếu đủ cả 3 màu (trước đây khối sai màu, ví dụ đổi U9↔D3, vẫn bị báo hợp lệ).
- Lời giải bị huỷ khi màu đầu vào thay đổi, kể cả khi thay đổi trong lúc đang tính.
- Kiểm thử trình duyệt trả mã lỗi khi có điều kiện không đạt.
- Phát hiện chụp trùng thì chặn giải cho tới khi chụp lại (hoặc người dùng xác nhận hai ảnh là hai mặt khác nhau); trước đây ảnh trùng bị nhận thành màu còn thiếu và vẫn cho giải.
- Hoạt ảnh của lời giải cũ không còn làm lời giải mới tự nhảy bước.
- Quay lại bước chụp rồi sang lại bước 2 không còn ghi đè màu đã sửa tay (chỉ phân loại lại khi có ảnh mới).
- Tự cập nhật không tải lại trang khi người dùng đã tô/sửa màu thủ công.

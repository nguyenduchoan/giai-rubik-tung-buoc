# Nhật ký thay đổi

Mọi thay đổi đáng chú ý của dự án được ghi ở đây. Định dạng theo [Keep a Changelog](https://keepachangelog.com/vi/1.1.0/), phiên bản theo [Semantic Versioning](https://semver.org/lang/vi/).

## Chưa phát hành

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

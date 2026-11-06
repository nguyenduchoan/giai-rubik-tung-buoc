# Nhật ký thay đổi

Mọi thay đổi đáng chú ý của dự án được ghi ở đây. Định dạng theo [Keep a Changelog](https://keepachangelog.com/vi/1.1.0/), phiên bản theo [Semantic Versioning](https://semver.org/lang/vi/).

## Chưa phát hành

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

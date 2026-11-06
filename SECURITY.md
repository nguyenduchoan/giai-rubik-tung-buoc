# Chính sách bảo mật

## Phạm vi

Đây là trang web tĩnh chạy hoàn toàn trong trình duyệt: không có máy chủ ứng dụng, không lưu hay gửi ảnh camera đi đâu. Các vấn đề đáng báo gồm ví dụ:

- Mã trong repo có thể bị lợi dụng để chạy script lạ (XSS) hoặc rò rỉ dữ liệu camera.
- `scripts/serve.js` phục vụ file ngoài thư mục dự án hoặc file ẩn.
- Script trong `scripts/` có thể gây hại khi chạy theo hướng dẫn trong README.

## Phiên bản được hỗ trợ

Chỉ nhánh `main` (bản mới nhất) được sửa lỗi bảo mật.

## Cách báo cáo

**Đừng tạo issue công khai cho lỗ hổng bảo mật.** Hãy dùng tính năng báo cáo riêng của GitHub: tab **Security** → **Report a vulnerability** của repo này.

Vui lòng mô tả lỗ hổng, cách tái hiện, mức độ ảnh hưởng, và (nếu có) đề xuất cách sửa. Người duy trì sẽ phản hồi trong vòng 7 ngày, và báo cho bạn khi bản sửa được phát hành. Nếu bạn muốn, tên bạn sẽ được ghi công trong CHANGELOG.

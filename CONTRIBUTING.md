# Đóng góp cho "Giải Rubik từng bước"

Cảm ơn bạn đã quan tâm! Dự án nhận báo lỗi, đề xuất và pull request bằng **tiếng Việt hoặc tiếng Anh**.

Khi tham gia, bạn đồng ý tuân theo [Quy tắc ứng xử](CODE_OF_CONDUCT.md).

## Báo lỗi

Trước khi tạo issue, hãy tìm xem lỗi đã được báo chưa. Một báo cáo tốt gồm:

- Thiết bị, hệ điều hành, trình duyệt và phiên bản (ví dụ iPhone 13, iOS 18, Safari).
- Các bước tái hiện và kết quả mong đợi/thực tế.
- **Ảnh chụp màn hình bước 2 (lưới màu)** và thông báo lỗi hiện trên trang. Với lỗi nhận màu, ảnh từng mặt (hoặc ảnh chụp màn hình khung camera) giúp tái hiện nhanh hơn nhiều.

Lỗ hổng bảo mật: **đừng tạo issue công khai**, xem [SECURITY.md](SECURITY.md).

## Chuẩn bị môi trường

Không có bước cài đặt hay build. Chỉ cần:

- Node.js 22 trở lên (để chạy test và máy chủ tĩnh).
- Google Chrome/Chromium (chỉ cho kiểm thử trình duyệt).

```bash
npm start           # http://127.0.0.1:8000/
npm test            # kiểm thử Node
npm run test:e2e    # kiểm thử trình duyệt với camera giả
```

Camera trực tiếp cần `https://` hoặc `localhost`. Để thử trên điện thoại thật, bạn có thể dùng một đường hầm HTTPS (ví dụ Cloudflare Tunnel, ngrok) hoặc triển khai lên một dịch vụ web tĩnh có HTTPS.

## Quy ước mã nguồn

- **JavaScript thuần, không phụ thuộc, không build.** Mỗi file trong `js/` là một IIFE gắn vào `window.Rubik` (và `globalThis` khi chạy test bằng Node). Đừng thêm thư viện ngoài nếu chưa thảo luận trong issue.
- Thụt lề 2 dấu cách, dấu chấm phẩy, nháy đơn (xem `.editorconfig`).
- Chú thích và chuỗi giao diện bằng tiếng Việt có dấu. Chú thích để giải thích *vì sao*, không lặp lại mã.
- Phần logic (mô hình khối, nhận màu, bộ giải) đặt ở `js/cube.js`, `js/vision.js`, `js/solver.js` để kiểm thử được bằng Node; `js/app.js` chỉ lo giao diện.
- Nếu đổi JS/CSS, hãy cập nhật tham số `?v=` trong `index.html` và `js/app.js` khi phát hành để trình duyệt không dùng bản cũ.

## Pull request

1. Fork, tạo nhánh từ `main` (ví dụ `fix/nhan-mau-do-cam`).
2. Thêm hoặc sửa test cho thay đổi của bạn: logic thì thêm vào `tests/*.test.js`; luồng camera thì thêm điều kiện `check(...)` trong `tests/e2e-camera.js`; ca trạng thái giao diện (thao tác xen kẽ, dữ liệu đổi giữa chừng…) thì thêm vào `tests/e2e-state.js`.
3. Chạy `npm test` (và `npm run test:e2e` nếu đụng tới giao diện/camera), đảm bảo đều đạt.
4. Ghi thay đổi đáng chú ý vào mục "Chưa phát hành" trong [CHANGELOG.md](CHANGELOG.md).
5. Mô tả PR: vấn đề, cách sửa, cách bạn đã kiểm tra; kèm ảnh chụp màn hình nếu đổi giao diện.

Mỗi PR nên tập trung vào một việc. Thay đổi lớn (thuật toán mới, đổi cấu trúc) nên mở issue thảo luận trước.

## Giấy phép

Đóng góp của bạn được phát hành theo [giấy phép MIT](LICENSE) của dự án.

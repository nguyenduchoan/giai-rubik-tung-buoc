# Kế hoạch phòng thi đấu Rubik — bản tinh giản

- **Ngày:** 13/11/2026.
- **Trạng thái:** đã triển khai, kiểm chứng và đưa lên Hub tại `/rubik/`, phiên bản tài nguyên `e5c773230c`.
- **Quan hệ với bản cũ:** phương án độc lập; không sửa hoặc thay thế `docs/ke-hoach-phong-thi-dau-online.md` đang được giữ trong vùng làm việc của nhánh `feature/online-room-plan`.
- **Mã nền đã đối chiếu:** `main` tại `558314f`, đã có sân chơi toàn màn hình, cử chỉ hai ngón và nút Hướng dẫn giải.

**Phạm vi người dùng chốt:** tạo phòng, mời vào bằng mã, lưu số bước xoay và thời gian hoàn thành để so với nhau. Ưu tiên làm nhanh, chấp nhận số liệu bị giả ở client (trình duyệt người chơi). Máy chủ nhận và lưu kết quả trình duyệt gửi; không xác minh quá trình giải.

## 1. Luồng sử dụng tối thiểu

Mặc định để triển khai gọn: **mỗi phòng là một đề Rubik cố định; mỗi người có một kết quả trong phòng đó**. Muốn đổi đề hoặc thi lượt mới thì tạo phòng mới. Giữ yêu cầu cùng khối tráo và biệt danh không cần tài khoản đã nêu trong kế hoạch cũ.

1. **Tạo phòng:** nhập biệt danh, bấm Tạo phòng. Máy chủ sinh mã mời 6 ký tự chữ/số và một chuỗi tráo 20 nước bằng bộ sinh sẵn có. Nếu chuỗi làm khối trở về trạng thái đã giải thì sinh lại. Người tạo vào phòng luôn và có nút Sao chép mã.
2. **Vào phòng:** nhập mã và biệt danh. Mã bỏ khoảng trắng đầu/cuối, không phân biệt hoa thường. Tên dài 1–24 ký tự sau khi bỏ khoảng trắng đầu/cuối; tên đã dùng trong phòng thì yêu cầu chọn tên khác.
3. **Chơi:** mọi người nhận cùng chuỗi tráo nhưng tự bắt đầu khi muốn; không phải đợi nhau. Bấm Bắt đầu để mở khối đã tráo. Đồng hồ chạy từ nước xoay hợp lệ đầu tiên, dừng khi trình duyệt nhận biết khối đã giải.
4. **Lưu kết quả:** trình duyệt gửi số bước và thời gian hoàn thành. Chỉ hiện “Đã lưu” khi máy chủ ghi thành công; lỗi mạng hoặc lỗi ghi thì giữ kết quả trên màn hình, có nút Gửi lại.
5. **So sánh:** bảng trong phòng gồm **Tên | Thời gian | Số bước**, mặc định sắp theo thời gian tăng dần. Người chưa gửi kết quả hiện “Chưa có kết quả”. Không cần tính điểm hay quy tắc chia hạng.

Không có vai trò quản trị sau khi tạo phòng: người tạo cũng chỉ là một người chơi. Một người có thể thử luồng một mình; người khác vào sau vẫn giải cùng đề. Trong phòng đang mở, bảng được tải lại mỗi 2 giây và có nút Làm mới; khi trang bị ẩn thì dừng hỏi lại, quay lại trang thì tải ngay.

Trình duyệt lưu mã phòng và thông tin nhận diện của mình bằng khóa riêng, không dùng chung bản lưu Chơi tự do. Mở lại cùng trình duyệt thì xem được kết quả đã lưu. Chưa khôi phục lượt giải đang dở: tải lại trang trước khi lưu kết quả thì bắt đầu lại từ đề của phòng. Xóa dữ liệu trình duyệt sẽ mất nhận diện người chơi; chưa có cơ chế khôi phục bằng tài khoản.

## 2. Quy ước đếm bước và đo thời gian

| Thao tác | Số bước cộng thêm |
| --- | --- |
| Xoay một mặt hoặc lớp giữa, 90° hay 180°, ví dụ `R`, `R2`, `M` | 1 |
| Xoay hai lớp cùng nhau bằng ký hiệu như `Rw` | 1 |
| Hai ngón xoay hai lớp song song độc lập, ví dụ `R L'` | 2 |
| Đổi góc nhìn, đặt lại góc nhìn, cử chỉ bị hủy | 0 |
| Các nước dùng để dựng khối tráo ban đầu | 0 |

- Dùng bộ đếm cộng dồn riêng, tăng khi nước xoay được chốt vào trạng thái khối. Không lấy `past.length`: lịch sử hiện chỉ giữ tối đa 200 lượt và một lượt có thể chứa hai nước.
- Dùng `performance.now()` — đồng hồ đo khoảng thời gian của trình duyệt. Ghi mốc đầu ngay trước hoạt ảnh của nước hợp lệ đầu tiên; ghi mốc cuối khi nước cuối được chốt và khối đã giải. Thời gian bao gồm hoạt ảnh, không dừng khi chuyển sang ứng dụng khác.
- Lưu `durationMs` là số mili giây nguyên; hiển thị thời gian tới phần trăm giây. Lưu `moveCount` là số bước nguyên, không suy ra từ bảng lịch sử.
- Trong sân chơi của phòng chỉ giữ điều khiển xoay và góc nhìn. Không mở Hoàn tác/Làm lại, Tráo riêng, Về khối đã giải, Chạy công thức hoặc Hướng dẫn giải; tránh phải định nghĩa cách tính kết quả cho các thao tác này. Chơi tự do giữ nguyên các chức năng hiện có.
- Khi hoàn thành thì khóa lượt và giữ nguyên số liệu để gửi lại nếu cần. Trình duyệt tự nhận biết hoàn thành; không có bước chờ máy chủ chứng nhận khối.

## 3. Phần kỹ thuật nhỏ nhất cần làm

### Giao diện và máy chủ

- Thêm lối vào **Phòng thi đấu** với hai lựa chọn Tạo phòng / Nhập mã, màn hình phòng và bảng kết quả. Tái sử dụng khối 3D, mô hình và điều khiển hiện tại; trạng thái phòng tách khỏi khối tự chơi, bài học và dữ liệu camera.
- Một tiến trình Node.js (môi trường chạy JavaScript trên máy chủ), dùng thư viện sẵn có, bổ sung API (giao diện gọi máy chủ) vào máy chủ hiện tại. Chỉ gửi yêu cầu khi tạo/vào phòng, đọc bảng và lưu kết quả; không gửi từng nước xoay, không cần kết nối hai chiều liên tục.
- Máy chủ sinh và lưu đề khi tạo phòng, trả lại đúng đề đó cho mọi người. Tái sử dụng cách tráo ngẫu nhiên hiện có; không xây bộ sinh đề theo chuẩn giải đấu.

### Dữ liệu và các lời gọi

| Dữ liệu | Trường cần giữ |
| --- | --- |
| Phòng | `code`, `scramble` (chuỗi tráo), `createdAt` (lúc tạo) |
| Người chơi | `playerId` (mã người chơi), `nickname` (biệt danh), `playerToken` (mã bí mật để gửi kết quả của mình) |
| Kết quả, gắn với phòng và người chơi | `moveCount`, `durationMs`, `finishedAt` (lúc máy chủ nhận kết quả) |

Mỗi phòng lưu danh sách người chơi và tối đa một kết quả cho mỗi người. Không lưu chuỗi nước xoay, ảnh, nhật ký đồng bộ hay trạng thái khối đang giải. Mã nhận diện và mã bí mật được máy chủ cấp khi tạo/vào phòng; mã bí mật chỉ trả cho đúng người đó, không đưa vào bảng kết quả.

| Lời gọi API | Nội dung |
| --- | --- |
| `POST /api/rooms` | Nhận biệt danh, tạo phòng và người tạo; trả mã phòng, đề và thông tin nhận diện của người tạo |
| `POST /api/rooms/:code/join` | Nhận biệt danh, thêm người; trả đề và thông tin nhận diện của người vừa vào |
| `GET /api/rooms/:code` | Nhận lại đề, danh sách người chơi và kết quả để hiển thị; ai có mã mời đều đọc được |
| `POST /api/rooms/:code/result` | Nhận mã người chơi, mã bí mật, số bước và thời gian; ghi kết quả của người đó |

Máy chủ chỉ kiểm tra phòng/người chơi tồn tại, mã bí mật khớp, tên đúng độ dài, số bước và thời gian là số nguyên dương hữu hạn. Gửi lại kết quả đã lưu trả về bản đã lưu, không thêm dòng hoặc sửa số liệu. Không kiểm tra thời gian tối thiểu, phát lại nước xoay hay xác minh khối đã giải. Mã bí mật chỉ giúp tránh ghi nhầm kết quả của nhau; số liệu vẫn có thể bị giả theo phạm vi đã chấp nhận.

### Lưu bền vững và chạy thực tế

- Để làm nhanh, lưu phòng/người chơi/kết quả trong một tệp JSON (tệp dữ liệu có cấu trúc), chưa thêm cơ sở dữ liệu hay thư viện ngoài. Phù hợp bản dùng thử nhóm nhỏ, một tiến trình ghi dữ liệu.
- Mọi thay đổi được xử lý ghi lần lượt, ghi tệp tạm rồi đổi tên thay tệp chính; chỉ trả thành công sau khi ghi xong. Ghi thất bại thì giữ bản trước và trả lỗi để thử lại. Khi mở dịch vụ, đọc dữ liệu cũ; tệp hỏng thì báo lỗi, không tự ghi đè bằng dữ liệu rỗng.
- Thư mục dữ liệu cấu hình qua `ROOM_DATA_DIR`, nằm ngoài vùng phục vụ tệp công khai và được giữ lại qua các lần phát hành. Khi chạy trên máy phát triển có thể dùng `.local/room-data/`. Kết quả đã lưu phải còn sau khi khởi động lại dịch vụ. Bản đầu chưa tự xóa phòng hoặc đặt hạn lưu.
- `scripts/serve.js` phục vụ cả trang và API tương đối dưới `/api/`. Trên Hub, dịch vụ phòng chạy ở cổng nội bộ `3002`, API Hub có sẵn chuyển tiếp `/api/rubik/` đến dịch vụ này; HTML triển khai có cấu hình đường dẫn API riêng. Cách này hoạt động với quyền vận hành hiện tại, không cần sửa nginx. `scripts/deploy-hub.sh` cài dịch vụ, giữ dữ liệu ngoài vùng công khai và triển khai giao diện `/rubik/`. Tệp tĩnh đơn thuần chưa tạo/vào phòng hay lưu kết quả chung được.

## 4. Những phần cắt khỏi phương án cũ

| Phần của kế hoạch cũ | Quyết định trong bản này |
| --- | --- |
| Máy chủ áp dụng và xác minh từng nước | Nhận số bước và thời gian cuối từ trình duyệt |
| Phòng chờ, sẵn sàng, quan sát, đếm ngược, cùng giờ bắt đầu | Mỗi người tự bắt đầu trên cùng đề |
| Nhiều ván trong phòng, hết giờ, bỏ cuộc, hủy ván, cộng điểm | Một phòng một đề; chỉ ghi kết quả đã hoàn thành |
| Chủ phòng, chuyển chủ, loại thành viên, khán giả | Chưa làm |
| Đồng bộ khối, nối lại lượt đang thi, xử lý tranh quyền giữa các tab | Chưa làm; tải lại thì bắt đầu lượt lại nếu chưa có kết quả |
| Chuỗi nước lưu trên máy chủ, cơ sở dữ liệu, thử tải quy mô lớn | Tệp kết quả chung; kiểm tra luồng nhóm nhỏ |
| Tài khoản, ghép đối thủ, xếp hạng công khai, giải đấu, trò chuyện | Chưa làm |

Các quy tắc và điều kiện cần duyệt trong bản cũ không trở thành điều kiện chặn thực hiện phương án tinh giản này. Các mặc định bổ sung ở bản này phục vụ việc triển khai nhanh, không được ghi thành yêu cầu người dùng đã xác nhận.

## 5. Thứ tự làm và điều kiện nghiệm thu

Thực hiện theo một luồng ngắn:

1. **Tạo/vào và lưu:** bổ sung xử lý phòng, bốn lời gọi API và tệp dữ liệu; kiểm tra hai trình duyệt vào cùng mã, nhận cùng đề, đọc lại được sau khi khởi động dịch vụ.
2. **Chơi và gửi:** tích hợp sân chơi tách biệt, bộ đếm, đồng hồ, nhận biết hoàn thành, gửi kết quả và nút Gửi lại. Bảo vệ lượt đang chơi khỏi cơ chế tự tải lại khi có phiên bản mới trong `js/app.js`.
3. **So sánh và chạy thử:** bảng tên/thời gian/số bước, tải lại định kỳ; nối API vào cách chạy trên Hub và kiểm tra hai trình duyệt độc lập, gồm bố cục điện thoại mô phỏng.

Các ca nghiệm thu; chỉ đánh dấu khi đã có kết quả kiểm tra:

- [x] Hai trình duyệt tạo/vào cùng phòng bằng mã; mã sai và tên trùng có thông báo rõ. Vào lúc khác nhau vẫn nhận cùng đề.
- [x] Không tính nước tráo và đổi góc nhìn; xoay 180° tính một bước; hai ngón độc lập tính hai bước; quá 200 lượt vẫn đếm đủ.
- [x] Đồng hồ bắt đầu/dừng đúng quy ước; gửi kết quả của hai người và hiển thị đúng cả hai cột, đúng thứ tự thời gian.
- [x] Mất mạng lúc gửi rồi Gửi lại chỉ có một kết quả; thử ghi dữ liệu thất bại không hiện “Đã lưu”.
- [x] Khởi động lại dịch vụ vẫn đọc được phòng và kết quả đã lưu; tệp dữ liệu và mã bí mật không bị phục vụ công khai.
- [x] Chấp nhận số bước/thời gian hợp lệ về kiểu dữ liệu do trình duyệt tự gửi, không yêu cầu bằng chứng chống gian lận.
- [x] Chơi tự do, học và giải bằng camera hoạt động như trước; bản lưu khối tự chơi không bị phòng ghi đè; không tự tải lại giữa lượt.
- [x] Khi có mã: kiểm thử phần phòng/lưu trữ bằng Node, chạy `npm test`, kiểm tra luồng hai trình duyệt và cách gọi API khi trang nằm dưới `/rubik/`.

Bằng chứng kiểm chứng: `npm test` đạt; `npm run test:e2e` đạt toàn bộ bốn kịch bản camera, trạng thái, học, Chơi tự do và phòng; `node tests/e2e-rooms.js` bổ sung kiểm tra không tự tải lại giữa lượt cũng đạt. Bố cục điện thoại được mô phỏng trong Chrome, chưa thử thiết bị thật.

Kiểm chứng sau triển khai: `RUBIK_ROOM_URL=http://127.0.0.1/rubik/ node tests/e2e-rooms.js .e2e-out/rooms-live` đạt trên Hub thật. Khởi động lại tiến trình `rubik-rooms` rồi đọc lại cùng phòng: hai kết quả giữ nguyên. Kiểm tra HTTP (giao thức truy cập web) xác nhận tệp dữ liệu và bản sao mã Hub bị từ chối truy cập; API Hub vẫn hoạt động. Bộ kiểm tra API Hub gồm 15 ca cũng đạt khi cài tuyến mới. Kế hoạch cũ được đối chiếu mã băm trước/sau và giữ nguyên.

**Hoàn thành bản tinh giản khi:** nhóm bạn tạo/vào bằng mã, giải cùng đề theo thời điểm riêng và xem lại số bước/thời gian đã lưu của nhau. Không lấy việc chống gian lận hoặc tổ chức thi đồng bộ làm tiêu chí hoàn thành.

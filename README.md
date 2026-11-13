# Giải Rubik từng bước

[![CI](https://github.com/nguyenduchoan/giai-rubik-tung-buoc/actions/workflows/ci.yml/badge.svg)](https://github.com/nguyenduchoan/giai-rubik-tung-buoc/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Web giải khối Rubik 3×3 cho người mới: **chụp 6 mặt bằng camera điện thoại → app tự nhận màu, tự ghép và xoay các ảnh cho khớp → hướng dẫn giải từng bước bằng mô phỏng 3D**, toàn bộ bằng tiếng Việt.

Giao diện viết bằng HTML/CSS/JavaScript thuần: **không cần build, không phụ thuộc thư viện ngoài, không gửi ảnh lên máy chủ**. Nhận màu, giải và mô phỏng chạy trong trình duyệt; phòng thi đấu dùng thêm máy chủ Node.js để chia sẻ đề và lưu kết quả.

> **English:** A zero-dependency, client-side web app that scans a 3×3 Rubik's cube with the phone camera, auto-detects colors, fixes faces captured in the wrong order/orientation, solves it with Kociemba's two-phase algorithm and walks you through each move with a 3D animation. UI and docs are in Vietnamese.

<p align="center">
  <img src="docs/images/1-chup.png" alt="Bước 1: chụp từng mặt" width="250">
  <img src="docs/images/2-kiem-tra.png" alt="Bước 2: kiểm tra màu, app tự xoay ảnh" width="250">
  <img src="docs/images/tu-chay.gif" alt="Bước 3: hướng dẫn giải bằng mô phỏng 3D" width="250">
</p>

## Tính năng

1. **Chụp các mặt**: mở trên điện thoại, app tự hỏi quyền camera. Đưa từng mặt vào khung 3×3:
   - App nhận diện và làm mượt 9 ô màu theo thời gian thực ngay bên dưới camera. Khi thấy màu đã nhận đúng, bạn có thể bấm **✅ Xác nhận màu** ngay, hoặc bấm **📸 Chụp mặt này** để dừng hình và mở khung **Xem trước màu vừa chụp** (có thể chạm trực tiếp vào từng ô trên ảnh camera, khung xem trước hoặc hình mặt bên phải để sửa màu, xoay 90°, rồi bấm **✅ Xác nhận màu mặt này** / **🔄 Chụp lại**).
   - **Xác nhận theo màu tâm**: nếu bạn bấm xác nhận nhiều lần trên cùng một tâm để lấy ảnh chuẩn nhất, app chỉ cập nhật ảnh cuối cùng vào đúng tâm đó, không tạo thêm ảnh trùng tâm và không làm mất lượt chụp của các mặt còn lại.
   - Chốt mẫu màu ổn định ngay trước thao tác chạm nút để tránh rung tay làm nhảy màu khi bấm chụp.
   - Tùy chọn **🎥 Tự chụp khi giữ yên** (mặc định tắt) giúp tự dừng hình vào khung xem trước khi giữ yên khối Rubik khoảng 1 giây. Vẫn hỗ trợ "Chụp bằng app camera" và "Chọn ảnh có sẵn".
2. **Kiểm tra màu**:
   - Chụp nhầm thứ tự (ví dụ đổi chỗ Phải/Trái) hoặc cầm lệch hướng (ảnh bị xoay 90°/180°): app **tự đổi chỗ và xoay các ảnh** cho thành khối hợp lệ, rồi đưa về cách cầm chuẩn.
   - Chụp trùng một mặt: app chỉ ra hai ảnh bị trùng và mặt còn thiếu, kèm nút chụp lại.
   - Có ô bị nhận sai màu: **chạm vào ô đó để chọn lại màu**. Ô đáng ngờ có dấu `?`. Khi tìm ra 2 ô bị nhận nhầm cho nhau (đỏ↔cam, trắng↔vàng…), app đánh dấu `!` và có nút "Áp dụng gợi ý".
3. **Hướng dẫn giải**: lời giải khoảng 20 bước (thuật toán hai pha Kociemba), mô phỏng 3D có hoạt ảnh, mô tả từng bước bằng tiếng Việt kèm màu tâm của mặt cần xoay. Bấm **Tiếp** để đi từng bước, hoặc **Tự chạy** để xem hết một lượt. Cũng mở được từ nút **💡 Hướng dẫn giải** của Chơi tự do (xem mục 5).
4. **Học chơi**: tab riêng, không cần chụp hay nhập màu. Có 15 bài theo 4 mức: làm quen, giải cơ bản 7 bước, kết hợp công thức/F2L (giải đồng thời hai tầng đầu), và nhập môn OLL/PLL (định hướng/hoán vị tầng cuối). Mỗi công thức có điều kiện áp dụng, cách chia cụm để nhớ và khối mẫu 3D riêng để tiến/lùi, tự chạy, đổi tốc độ. Đánh dấu bài đã tự làm được; bài đang học và tiến độ được lưu trên trình duyệt. Khi trình duyệt chặn lưu trữ, vẫn học bình thường trong lần mở hiện tại.
5. **Chơi tự do**: chọn tab này để mở sân chơi phủ kín màn hình. Trình duyệt cho phép thì vào toàn màn hình luôn; nếu bị từ chối hoặc không hỗ trợ (Safari trên iPhone) thì sân chơi vẫn phủ kín trang và có nút ⛶ để thử lại. Điều khiển cảm ứng theo **số ngón đặt cùng lúc rồi kéo**:
   - **1 ngón**: xoay một hàng/cột, kể cả lớp giữa `M/E/S` (kéo qua ô tâm). Đặt ngón thì viên dưới ngón sáng lên; kéo rõ hướng thì cả hàng/cột sẽ xoay sáng lên. Ngón đặt ở vùng nền không xoay khối và không đổi góc nhìn.
   - **2 ngón**: đặt mỗi ngón lên một hàng hoặc một cột của hai lớp song song khác nhau (được dùng cả lớp giữa). Mỗi ngón kéo theo chiều riêng nên hai lớp có thể xoay cùng chiều hoặc ngược chiều, ví dụ cột trái kéo xuống và cột phải kéo lên là `L R`. Hai lớp chuyển động cùng lúc; lịch sử ghi hai nước trong một lượt, **Hoàn tác/Làm lại** một lần cho cả lượt. Hai ngón cùng một lớp, một ngón kéo hàng còn ngón kia kéo cột, một ngón ở ngoài khối hoặc một ngón không kéo thì không xoay và có gợi ý.
   - **3 ngón**: cách duy nhất để đổi góc nhìn bằng cảm ứng; không đổi khối, lịch sử hay nhánh làm lại.

   Chuột kéo theo chế độ **1 lớp / 2 lớp / Góc nhìn** trong bảng **Điều khiển** (chế độ 2 lớp vẫn là `Rw`, `Uw`…), kéo vùng nền để nhìn quanh. Bảng này còn có nút chọn lớp (6 mặt và `M/E/S`), xoay 90°/ngược/180°, tráo 20 nước, về khối đã giải, chạy công thức (nhận `M E S`, `Rw` hoặc chữ thường `r`) và lịch sử. Phím R/L/U/D/F/B/M/E/S (Shift để xoay ngược), Ctrl+Z/Ctrl+Y. Khối và tối đa 200 lượt hoàn tác được tự lưu (bản lưu cũ được chuyển sang tự động); nút **Quay lại** về tab trước đó. Rời sân chơi hoặc ẩn trang sẽ hủy cử chỉ đang dở và dừng phần công thức chưa chạy.

   Khi khối chưa giải, dưới khối có nút **💡 Hướng dẫn giải**: bấm vào sẽ mang nguyên khối đang chơi (đúng màu, đúng hướng cầm, kể cả khi lớp giữa/hai lớp đã làm tâm đổi chỗ) sang tab **3. Hướng dẫn giải**, tự tính lời giải và hướng dẫn từng bước. Khối đang chơi không bị đổi; khối mang sang thay cho màu ở bước 2 (nếu đã có ảnh chụp thì app hỏi trước).

6. **Phòng thi đấu**: nhập biệt danh để tạo phòng hoặc vào bằng mã mời 6 ký tự, không cần tài khoản. Mỗi phòng có một khối tráo chung; mỗi người bấm Bắt đầu rồi tự giải, đồng hồ chạy từ nước xoay đầu tiên. Giải xong tự lưu thời gian và số bước vào bảng chung, có Gửi lại khi lỗi mạng; kết quả đã lưu còn sau khi mở lại trang hoặc khởi động lại máy chủ. Một người có một kết quả/phòng, muốn thi lượt mới thì tạo phòng mới. Một nước 180° hoặc hai lớp `Rw` tính một bước; hai ngón xoay hai lớp độc lập tính hai bước. Kết quả giao hữu do trình duyệt tự báo, chấp nhận có thể bị giả; chưa có đồng bộ bắt đầu hay chống gian lận. Phần này cần chạy `npm start` hoặc dịch vụ phòng trên Hub.

## Chạy trên máy

Dùng Node.js để có đủ các tính năng, bao gồm phòng thi đấu:

```bash
npm start                      # = node scripts/serve.js, mở http://127.0.0.1:8000/
# Chỉ dùng tính năng không có phòng thì có thể chạy máy chủ tĩnh khác:
python3 -m http.server 8000     # không hỗ trợ tạo/vào phòng hoặc lưu kết quả chung
```

- Trình duyệt chỉ cho dùng **camera trực tiếp** khi trang mở qua `https://` hoặc `localhost`.
- Mở bằng `http://<ip-LAN>` trên điện thoại thì camera bị chặn. Khi đó dùng nút **📸 Chụp bằng app camera** hoặc **🖼️ Chọn ảnh có sẵn**.
- Mở thẳng `index.html` (file://) vẫn dùng được chức năng chọn ảnh và tô màu thủ công.

**Thử nhanh không cần khối Rubik:** thư mục [`test-images/`](test-images/) có 6 ảnh mặt của một khối thật, trong đó 2 ảnh bị chụp lệch chiều. Chọn lần lượt từng ảnh bằng **🖼️ Chọn ảnh có sẵn** rồi bấm **Chụp mặt này**, giữ nguyên khung lưới mặc định. App sẽ tự xoay 2 ảnh lệch và cho lời giải 8 bước.

## Cách chụp

Chỉ cần chụp đủ 6 mặt, **thứ tự và chiều cầm tuỳ ý**. App tự ghép, xoay các ảnh cho khớp rồi đưa về cách cầm chuẩn (tâm trắng ở trên, tâm xanh lá ở trước, nếu khối dùng bảng màu phổ biến). Ở bước giải, app ghi rõ cầm khối thế nào và mỗi bước xoay mặt có tâm màu gì. Bảng dưới chỉ là cách chụp gợi ý:

| Thứ tự | Mặt | Cạnh trên của ảnh |
| --- | --- | --- |
| 1 | Trước (F) | mặt Trên |
| 2 | Phải (R): xoay cả khối sang trái 90° | mặt Trên |
| 3 | Sau (B): xoay tiếp sang trái | mặt Trên |
| 4 | Trái (L): xoay tiếp sang trái | mặt Trên |
| 5 | Trên (U): về lại mặt Trước, lật khối về phía mình | mặt Sau (mặt Trước ở cạnh dưới) |
| 6 | Dưới (D): lật tiếp 180° | mặt Trước |

Mẹo: chụp nơi đủ sáng, tránh lóa, đặt mặt Rubik vừa khít khung 3×3.

## Cách hoạt động

| Bước | Cách làm |
| --- | --- |
| Lấy màu | Lấy trung vị màu ở giữa mỗi ô. Chỉ tự chụp khi màu trong từng ô đồng đều và khối đứng yên; mặt chỉ có một màu thì phải thấy rõ khe tối giữa các ô (tránh chụp nhầm tường/bàn). |
| Nhận màu | Dùng 6 ô tâm làm mốc, ép mỗi màu đúng 9 ô bằng phép gán Hungarian trên khoảng cách màu kiểu LCh, nên chịu được ánh sáng lệch màu. Trước đó kiểm tra ảnh chụp trùng mặt trên màu ảnh gốc. |
| Ghép/xoay ảnh | Tìm kiếm quay lui trên mọi cách gán 6 ảnh vào 6 vị trí × 4 hướng xoay, cắt nhánh sớm bằng ràng buộc cạnh/góc, chọn cách ít thay đổi nhất. |
| Kiểm tra hợp lệ | Chuyển sang dạng cubie và kiểm tra đủ 8 góc/12 cạnh, tổng hướng góc/cạnh và tính chẵn lẻ của hoán vị. |
| Giải | Thuật toán hai pha của Herbert Kociemba, bảng tra dựng lúc chạy (~1 giây), chạy trong Web Worker. |

## Cấu trúc

| Đường dẫn | Vai trò |
| --- | --- |
| `index.html`, `css/style.css` | Giao diện 3 bước giải, tab học chơi và Rubik tự chơi |
| `js/cube.js` | Mô hình sticker, bước xoay, chuyển sang dạng cubie, kiểm tra hợp lệ, tự ghép/xoay ảnh |
| `js/solver.js` | Bộ giải hai pha Kociemba |
| `js/solver-worker.js` | Chạy bộ giải trong Web Worker (tự quay về luồng chính nếu bị chặn) |
| `js/vision.js` | Lấy mẫu màu từ ảnh, phân loại màu, phát hiện chụp trùng, đánh dấu ô đáng ngờ |
| `js/cube3d.js` | Khối 3D bằng CSS transform + hoạt ảnh xoay |
| `js/app.js` | Điều khiển giao diện và luồng 3 bước |
| `js/lessons.js`, `js/learn.js` | Nội dung lộ trình, công thức, mô phỏng học độc lập và lưu tiến độ |
| `js/play-moves.js` | Ký hiệu và phép xoay của Chơi tự do: lớp ngoài, lớp giữa `M/E/S`, hai lớp `Rw/Uw…` |
| `js/play-gesture.js` | Bộ nhận cử chỉ 1/2/3 ngón (không dùng DOM): ghép ngón, đo từng ngón, tô viên đang chạm, hai lớp song song mỗi ngón một chiều, hủy, chốt lượt |
| `js/play-state.js`, `js/play.js` | Trạng thái khối tự chơi, lịch sử hoàn tác/làm lại, lưu khối; sân chơi toàn màn hình, nút, bàn phím và công thức |
| `js/room-attempt.js`, `js/rooms.js` | Lượt giải có bộ đếm riêng; tạo/vào phòng, đồng hồ, gửi kết quả và bảng so sánh |
| `scripts/rooms.js`, `scripts/serve.js` | API phòng (giao diện gọi máy chủ), lưu tệp dữ liệu và phục vụ trang khi chạy bằng Node |
| `tests/` | Kiểm thử Node và kiểm thử trình duyệt (camera giả) |
| `test-images/` | 6 ảnh mặt mẫu để thử thủ công |
| `scripts/` | Máy chủ tĩnh, chạy kiểm thử trình duyệt, script triển khai |

## Kiểm thử

```bash
npm test            # Node >= 22: bước xoay, kiểm tra hợp lệ, bộ giải, nhận màu, tự ghép/xoay
npm run test:e2e    # cần Google Chrome: giả lập điện thoại + camera (4 kịch bản chụp) và các ca trạng thái
```

| Lệnh | Nội dung |
| --- | --- |
| `node tests/solver.test.js` | Bước xoay, kiểm tra hợp lệ (gồm mọi cách đổi 2 ô), giải 40 trạng thái ngẫu nhiên |
| `node tests/vision.test.js` | Nhận màu dưới ánh sáng/nhiễu mô phỏng, phát hiện chụp trùng mặt |
| `node tests/arrange.test.js` | Tự đổi chỗ/xoay các mặt chụp nhầm, gợi ý sửa 2 ô nhận nhầm màu (có giới hạn thời gian) |
| `node tests/serve.test.js` | Máy chủ chạy thử: trả đúng file, từ chối đường dẫn xấu (NUL, `..`, file ẩn, symlink ra ngoài) mà không dừng |
| `node tests/rooms.test.js` | Bộ đếm vượt 200 lượt, hai nước/lượt, đồng hồ; cùng đề, ghi đồng thời, gửi lại, lỗi ghi và dữ liệu qua khởi động lại |
| `node tests/e2e-rooms.js` | Hai trình duyệt riêng tạo/vào và giải, mất mạng rồi gửi lại, bảo toàn khối tự chơi, mở lại kết quả và bố cục 320–390 px; chạy dưới `/rubik/` qua tuyến API Hub |
| `node tests/lessons.test.js` | Tác dụng và điều kiện khối mẫu của từng công thức, bảo toàn các phần đã giải, kiểm tra hướng góc và hoán vị cạnh |
| `node tests/e2e-learn.js` | Tab học: tiến/lùi, tự chạy/dừng, đổi bài/công thức giữa hoạt ảnh, giữ nguyên lời giải thật, lưu tiến độ, lưu trữ bị chặn và bố cục điện thoại |
| `node tests/play.test.js` | 45 kiểu nước đối chiếu phép biến đổi độc lập (`Rw = R M'`, `M' = L R' x`…), lượt hai lớp song song và hoàn tác cả lượt, lịch sử/lưu/chuyển bản lưu cũ, từ chối ảnh gương, suy ra lớp/chiều từ hướng vuốt và các ca của bộ nhận cử chỉ (tô viên/lớp, hai ngón ngược chiều, cùng lớp, khác trục, ngón ngoài khối, ghép/thêm/nhấc ngón, 4 ngón, hủy) |
| `node tests/e2e-play.js` | Toàn màn hình (mở bằng thao tác thật, bị từ chối, thoát, Quay lại), nút/bàn phím/công thức, chuột, chạm 1/2/3/4 ngón thật qua giao thức Chrome (tô sáng khi chạm, hai lớp ngược chiều, kiểm tra ảnh chụp không có ô bị tối), lưu khối và bản lưu cũ, bảo toàn bài học/lời giải, bố cục 320–390 px dọc/ngang và máy tính |
| `npm run test:e2e` | Chrome headless + camera giả: tự chụp, sửa màu, giải hết, huỷ lời giải khi dữ liệu đổi, chuyển qua lại giữa camera và ảnh (kể cả ảnh hỏng, quyền camera trả về chậm). Kịch bản `MISTAKES=0` chụp đúng; `1` nhầm thứ tự/hướng; `2` thứ tự và chiều hoàn toàn tuỳ ý; `3` thêm 2 ô đỏ/cam bị nhận nhầm. Chạy riêng một kịch bản: `MISTAKES=2 npm run test:e2e`. |
| `node tests/e2e-state.js` | Nhập ảnh qua "Chọn ảnh có sẵn": chụp trùng thì chặn giải và huỷ lời giải cũ, giải lại khi hình 3D đang xoay, chụp lại/quay lại bước chụp không mất màu đã sửa, chụp thiếu mặt + tô tay, lời giải xong khi đang ở bước khác, khoá giữ màn hình, tự cập nhật không mất dữ liệu nhập tay (mất ~2 phút vì phải chờ chu kỳ kiểm tra bản mới). |

Nếu lệnh `google-chrome` không có trên PATH (ví dụ macOS), đặt biến `CHROME_BIN`:

```bash
CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run test:e2e
```

## Triển khai

Các tính năng chụp/giải/học/Chơi tự do chỉ cần chép `index.html`, `css/` và `js/` lên dịch vụ web tĩnh có **HTTPS**. Phòng thi đấu cần thêm dịch vụ Node để các máy chia sẻ phòng và lưu kết quả.

`npm start` phục vụ cả trang và API phòng tại `/api/`; dữ liệu mặc định nằm trong `.local/room-data/rooms.json`. Đặt `ROOM_DATA_DIR` để chọn thư mục riêng, giữ lại thư mục này qua các lần phát hành và chỉ chạy một tiến trình ghi. Không đưa thư mục dữ liệu vào vùng phục vụ tệp công khai. Máy chủ không tự xóa phòng; sao lưu tệp dữ liệu khi dịch vụ đã dừng.

- Nếu máy chủ cache JS/CSS lâu, hãy đổi tham số `?v=` trong `index.html` và `js/app.js` mỗi lần phát hành để điện thoại không dùng bản cũ.
- Tab đã mở sẵn sẽ tự phát hiện bản mới khi người dùng quay lại tab: tự tải lại nếu chưa chụp/giải gì, nếu đang dở thì hiện nút **↻ Tải lại**.
- `scripts/deploy-hub.sh` triển khai lên Server Hub: chạy kiểm thử, cài dịch vụ `rubik-rooms` bằng PM2 (công cụ giữ tiến trình chạy nền) trên `127.0.0.1:3002`, lưu dữ liệu dưới `$HUB_ROOT/data/rubik-rooms`, rồi đặt phiên bản tài nguyên và chép giao diện vào `/rubik/`. Dịch vụ được lưu trong cấu hình PM2 để chạy lại khi máy khởi động.
- Hub chuyển `/api/rubik/` tới dịch vụ phòng thông qua bộ chuyển tiếp nhỏ gắn trước phần đọc dữ liệu của API Hub; không cần sửa nginx. Tệp HTML trên Hub được thêm `rubik-api-base=/api/rubik/`; chạy riêng vẫn dùng API tương đối. Bộ cài giữ bản mã API Hub trước thay đổi tại `data/rubik-room-service/hub-app.before-rubik.js` và kiểm thử API Hub trước khi khởi động lại.

## Đóng góp

Mọi đóng góp đều được hoan nghênh: báo lỗi, đề xuất tính năng, cải thiện nhận màu, dịch giao diện… Xem [CONTRIBUTING.md](CONTRIBUTING.md) và [Quy tắc ứng xử](CODE_OF_CONDUCT.md). Báo lỗ hổng bảo mật theo [SECURITY.md](SECURITY.md).

## Ghi công

- Thuật toán hai pha giải Rubik: [Herbert Kociemba](https://kociemba.org/cube.htm). Mã trong `js/solver.js` là bản cài đặt riêng của dự án.
- Quy tắc ứng xử dựa trên [Contributor Covenant 2.1](https://www.contributor-covenant.org/version/2/1/code_of_conduct/).

## Giấy phép

[MIT](LICENSE)

# Kế hoạch Chơi tự do: toàn màn hình và điều khiển bằng 1/2/3 ngón tay

- Trạng thái: đã triển khai trên bản làm việc (chưa commit, chưa đưa lên Server Hub). Kiểm thử tự động đạt; còn chờ kiểm tra trên thiết bị thật (mục 9).
- Ngày cập nhật: 11/11/2026.
- Mã nguồn đã khảo sát: `b3d9f7b`.
- Phạm vi hiện tại: triển khai theo kế hoạch đã chỉnh; kết quả kiểm chứng ghi ở mục 9.

## 1. Yêu cầu đã xác nhận

Khi chọn tab **Chơi tự do**, mở khu vực chơi toàn màn hình, tăng diện tích thao tác và giảm việc kéo nhầm ra ngoài khối Rubik.

Điều khiển dựa trên **số ngón tay đặt đồng thời rồi kéo**, không đếm số lần chạm liên tiếp:

| Số ngón | Chức năng | Thay đổi khối | Ghi lịch sử |
| --- | --- | --- | --- |
| 1 | Chọn và xoay một hàng hoặc một cột, gồm cả lớp giữa | Có | Một nước |
| 2 | Chọn và xoay hai hàng hoặc hai cột liền nhau, cùng trục và cùng chiều | Có | Một nước cho cả hai lớp |
| 3 | Xoay tự do góc quan sát để nhìn các mặt | Không | Không |

Người dùng đã xác nhận ba ngón chỉ đổi góc nhìn. Thao tác này không tạo công thức xoay toàn khối, không làm mất nhánh làm lại và không thay đổi trạng thái đã giải hay chưa giải.

Hai lớp liền nhau trên khối 3×3 được hiểu là một lớp ngoài và lớp giữa kề nó.

## 2. Hiện trạng và các điểm phải sửa đồng bộ

| Vị trí | Hành vi hiện tại | Thay đổi cần có |
| --- | --- | --- |
| [js/cube3d.js](../js/cube3d.js) | Chỉ nhận con trỏ chính; suy ra lớp ngoài; ô tâm dùng đổi góc nhìn | Theo dõi đồng thời tối đa ba ngón, hỗ trợ lớp giữa/hai lớp, ba ngón đổi góc nhìn |
| [js/cube3d.js](../js/cube3d.js) | Tô sáng và hoạt ảnh chỉ chọn một lớp ngoài | Dùng cùng mô tả trục và tập lớp cho tô sáng, chuyển động và kết quả |
| [js/play-state.js](../js/play-state.js) | Chỉ nhận ký hiệu sáu mặt; dữ liệu lưu yêu cầu màu tâm cố định | Thêm lớp giữa/hai lớp, nhận các hướng tâm hợp lệ và giữ dữ liệu sau tải lại |
| [js/play.js](../js/play.js) | Điều khiển, công thức và lịch sử phụ thuộc nước xoay mặt ngoài | Kết nối mô hình mở rộng, bộ nhận cử chỉ mới và chế độ toàn màn hình |
| [js/app.js](../js/app.js) | Chuyển tab thông thường | Mở/đóng sân chơi toàn màn hình và dọn thao tác khi rời tab |
| [index.html](../index.html), [css/style.css](../css/style.css) | Khối nằm trong bố cục trang có cuộn | Sân chơi phủ vùng hiển thị, thanh công cụ gọn, điều khiển mở khi cần |

Đã kiểm tra bằng các phép xoay sẵn có: bộ kiểm tra màu hiện tại vẫn chấp nhận trạng thái tương đương `M`, `E`, `S`, `Rw` nhờ ánh xạ màu theo tâm. Điểm làm mất trạng thái khi khôi phục là điều kiện riêng buộc tâm cố định trong `PlayState`. Cần thay điều kiện này có kiểm chứng, không bỏ kiểm tra tính hợp lệ của khối.

## 3. Toàn màn hình khi vào Chơi tự do

### 3.1. Luồng vào và thoát

1. Người dùng chạm hoặc bấm tab **Chơi tự do**.
2. Hiện ngay sân chơi phủ vùng hiển thị của trang và khóa cuộn nền.
3. Trong chính sự kiện người dùng vừa thao tác, gọi `requestFullscreen()` — chức năng yêu cầu trình duyệt mở toàn màn hình — cho vùng chứa sân chơi cùng thanh điều khiển.
4. Khi thành công, khối tự căn lại theo kích thước màn hình. Không đổi dữ liệu khối hoặc lịch sử.
5. Luôn có nút **Thoát toàn màn hình** và **Quay lại**. Nút Quay lại rời sân chơi về tab đang mở trước khi vào Chơi tự do (mặc định **1. Chụp các mặt**), khôi phục cuộn nền và đặt tiêu điểm lên nút của tab đó.
6. Khi sân chơi mở, phần đầu trang và thanh tab bị che được đặt `inert` — không nhận tiêu điểm và thao tác — để bàn phím không đi vào các nút không nhìn thấy. Tiêu điểm chuyển vào sân chơi.
7. Khi người dùng thoát bằng Esc hoặc thao tác của trình duyệt, cập nhật giao diện theo trạng thái thực tế; không tự ép mở lại toàn màn hình.

### 3.2. Trường hợp trình duyệt không cho phép

Trình duyệt yêu cầu một thao tác trực tiếp của người dùng để mở toàn màn hình. Vì vậy có thể tự yêu cầu ngay khi người dùng chọn tab, nhưng không bảo đảm tự mở lại sau tải trang hoặc khi khôi phục tab bằng chương trình. Quy tắc này được mô tả trong [chuẩn Fullscreen của WHATWG](https://fullscreen.spec.whatwg.org/#dom-element-requestfullscreen).

Nếu chức năng không được hỗ trợ hoặc yêu cầu bị từ chối:

- Giữ sân chơi phủ vùng hiển thị của trang, dùng được ngay.
- Hiện nút **Toàn màn hình** để người dùng thử lại bằng một thao tác trực tiếp khi chức năng khả dụng.
- Thông báo ngắn đúng tình trạng; không báo đã mở toàn màn hình trình duyệt khi chỉ đang phủ vùng hiển thị của trang.
- Không chặn việc chơi hoặc làm mất khối vì lỗi mở toàn màn hình.
- Safari trên iPhone không hỗ trợ toàn màn hình cho phần tử thường (chỉ cho video), vì vậy trên iPhone chế độ phủ kín trang là hành vi chính thức. Safari trên iPad đời cũ cần tên hàm có tiền tố `webkit`; mã phải thử cả hai dạng.
- Phần tử nằm ngoài vùng toàn màn hình không được hiển thị; mọi thông báo của sân chơi phải nằm trong vùng chứa đó.

### 3.3. Bố cục và vùng thao tác

- Khối Rubik ở giữa vùng chơi lớn, có khoảng trống quanh khối để đặt thêm ngón tay.
- Thanh gọn chứa Quay lại, trạng thái cử chỉ, Hoàn tác, Làm lại và nút mở Điều khiển.
- Công thức, nút chọn lớp, tráo khối và lịch sử nằm trong bảng điều khiển có thể mở/đóng.
- Điều chỉnh theo vùng hiển thị động, vùng tai thỏ và thanh hệ thống; kiểm tra cả màn hình dọc và ngang.
- Khi bàn phím ảo mở để nhập công thức, ô nhập và nút đóng vẫn tiếp cận được.
- Khóa cuộn và các cử chỉ phóng to mặc định trong sân chơi. Bảng điều khiển, ô nhập và nội dung trợ giúp giữ cách tương tác phù hợp của chúng.
- Khi rời Chơi tự do, khôi phục cuộn và cách chạm của các tab khác.

Toàn màn hình không thay thế việc giữ quyền nhận con trỏ khi kéo. Cử chỉ bắt đầu trên khối phải tiếp tục được theo dõi khi ngón tay trượt ra vùng nền. Các thao tác sát mép do hệ điều hành quản lý vẫn có thể được hệ điều hành ưu tiên.

## 4. Cách dùng 1/2/3 ngón tay

### 4.1. Một ngón: xoay một lớp

1. Đặt ngón lên một ô của khối.
2. Kéo theo hướng muốn xoay. Ô bắt đầu là mốc; hướng kéo xác định hàng hoặc cột theo góc nhìn hiện tại.
3. Khi hướng đủ rõ, tô sáng lớp đã chọn và hiện tên lớp.
4. Nhấc tay để thực hiện một nước 90° theo hướng kéo. Vuốt quá ngắn hoặc hướng không rõ thì giữ nguyên khối.

Hỗ trợ mọi lớp ngoài và cả ba lớp giữa. Kéo qua ô tâm trong chế độ này được dùng chọn lớp giữa, thay cho hành vi đổi góc nhìn hiện tại.

Chiều xoay tính theo vị trí lúc nhấc tay so với điểm đầu: kéo ngược về gần điểm đầu thì bỏ lượt. Một ngón bắt đầu ở vùng nền ngoài khối vẫn đổi góc nhìn như hiện nay; đây là đường dự phòng không đổi khối khi máy dành cử chỉ ba ngón cho hệ thống (nhiều máy Android vuốt ba ngón để chụp màn hình, iOS dùng ba ngón cho hoàn tác và trợ năng).

### 4.2. Hai ngón: xoay hai lớp

1. Đặt một ngón lên hàng/cột ngoài làm mốc, đặt thêm ngón thứ hai trong sân chơi trước khi bắt đầu kéo. Ngón mốc là ngón chạm sớm nhất **nằm trên khối**; nếu cả hai ngón đều ở vùng nền thì không xoay và hiện hướng dẫn.
2. Kéo hai ngón theo cùng hướng; ngón thứ hai xác định kiểu xoay hai lớp, không cần đặt chính xác trên lớp giữa.
3. Hệ thống chọn lớp ngoài theo mốc và hướng kéo, lấy thêm lớp giữa kề nó, rồi tô sáng cả hai lớp.
4. Khi kết thúc lượt kéo hợp lệ, hai lớp chuyển động cùng lúc, cùng góc và cùng chiều.

Ví dụ, khi nhìn mặt trước: đặt ngón mốc ở hàng trên rồi kéo ngang sẽ xoay lớp trên và lớp giữa; đặt ở cột phải rồi kéo dọc sẽ xoay lớp phải và lớp giữa.

Nếu ngón mốc nằm trên lớp giữa và chưa xác định được lớp ngoài đi kèm, hiển thị hướng dẫn đặt lại ngón mốc ở phía ngoài và giữ nguyên khối. Không tự đoán giữa hai phía.

### 4.3. Ba ngón: đổi góc nhìn

- Đặt ba ngón đồng thời trong sân chơi rồi kéo để xoay góc quan sát liên tục, không giới hạn theo nấc 90°.
- Có thể bắt đầu trên khối hoặc vùng trống của sân chơi.
- Không đổi màu/vị trí trong mô hình, không thêm lịch sử, không xóa nhánh Làm lại.
- Giữ góc nhìn trong phiên mở trang. Nút **Đặt lại góc nhìn** đưa về góc quan sát mặc định, không đặt lại khối đang chơi.

### 4.4. Chuột và điều khiển thay thế

- Giữ các nút chọn **1 lớp**, **2 lớp**, **Góc nhìn** để thao tác bằng chuột và trên thiết bị không nhận đủ ba ngón.
- Chuột và bút kéo theo lựa chọn đang hiển thị. Trên màn hình cảm ứng, số ngón trong cử chỉ là nguồn xác định chế độ.
- Giữ các nút chọn lớp (sáu mặt và `M/E/S`) và xoay 90°/ngược/180° cho người dùng muốn điều khiển chính xác bằng nút. Khi đang chọn **2 lớp**, nút xoay mặt ngoài chạy nước hai lớp như `Rw`; nhãn nút hiện đúng ký hiệu sẽ chạy.
- Hiện hướng dẫn ngắn: **1 ngón: một lớp · 2 ngón: hai lớp · 3 ngón: nhìn quanh**.
- Các nút điều khiển thay thế cũng phục vụ thiết bị hoặc công cụ hỗ trợ tiếp cận đang dành cử chỉ nhiều ngón cho chức năng hệ thống.

## 5. Quy tắc nhận cử chỉ để tránh xoay nhầm

### 5.1. Vòng đời một lượt kéo

`Chờ → Nhận các ngón → Khóa chế độ và hướng → Theo dõi kéo → Kết thúc hoặc hủy → Chờ nhấc hết tay`.

| Giai đoạn | Quy tắc |
| --- | --- |
| Nhận các ngón | Theo dõi từng `pointerId` — mã riêng của từng ngón; cho phép đặt thêm ngón trong một khoảng ngắn trước khi kéo rõ ràng |
| Khóa chế độ | Chốt số ngón, ô mốc và trục xoay khi số ngón đã ổn định và chuyển động đủ rõ |
| Theo dõi kéo | Dùng độ dịch chuyển trung bình tính từ vị trí đầu của các ngón đã khóa; kiểm tra các ngón có kéo cùng hướng |
| Kết thúc bình thường | Ngón đầu tiên trong nhóm đã khóa được nhấc lên sẽ kết thúc lượt; một/hai lớp chỉ chốt một nước nếu đạt điều kiện. Nếu ngón nhấc lên khi chưa khóa (vuốt nhanh), chốt theo số ngón đang đặt và tổng độ dịch chuyển |
| Chờ nhấc hết tay | Các ngón còn lại không tạo thêm nước và không đổi từ hai lớp sang một lớp hoặc từ ba ngón sang hai ngón |
| Hủy | Dọn con trỏ, phần tô sáng và dữ liệu tạm; lượt xoay lớp chưa chốt không thay đổi mô hình |

Khoảng nhận thêm ngón, ngưỡng dịch chuyển và độ đồng hướng là tham số cần đo trên thiết bị thật. Giá trị khởi đầu đề xuất: khoảng 120–180 ms để ghép nhóm ngón và khoảng 12–18 px để xác nhận hướng. Đây là giá trị thử nghiệm, chưa phải tiêu chí đã kiểm chứng.

### 5.2. Các trường hợp cần xử lý rõ

- Thêm ngón trước khi khóa: cập nhật nhóm ngón và mốc đo, không làm khối nhảy hoặc phát sinh nước xoay sớm.
- Thêm ngón sau khi khóa: hủy lượt hiện tại và chờ nhấc hết tay để chọn lại; không đổi loại xoay giữa lượt.
- Khi ba ngón chuyển động lệch hướng như chụm/phóng to, giữ nguyên khối và không chuyển thành thao tác xoay lớp.
- Bốn ngón trở lên: không nhận thành nước xoay; chờ kết thúc lượt chạm.
- Chạm vào nút, ô nhập hoặc bảng điều khiển: xử lý điều khiển đó, không cộng vào nhóm ngón xoay khối.
- Với một/hai ngón, ngón làm mốc phải bắt đầu trên khối. Chạm vùng nền không tự chọn lớp.
- Giữ quyền nhận sự kiện của từng ngón bằng `setPointerCapture()` — tiếp tục nhận thao tác sau khi ngón rời ô/khối.
- `pointercancel`, mất quyền nhận con trỏ, đổi kích thước màn hình, chuyển tab hoặc ẩn trang: hủy cử chỉ đang dở. Với đổi góc nhìn bị hủy bất thường, đưa góc nhìn về đầu cử chỉ.
- Nếu nước xoay đã được thả và đang chạy hoạt ảnh, hoàn tất đúng nước đó; không bắt đầu nước tiếp theo khi rời tab.
- Khi đang chạy hoạt ảnh hoặc công thức, khóa thao tác xoay lớp; vẫn giữ khả năng thoát và dừng công thức.
- Không để cùng một thao tác chạm phát sinh cả sự kiện xoay và một lần bấm nút ngoài ý muốn.

Chính sách cử chỉ phải được khai báo trước khi ngón bắt đầu chạm; không đợi đến lúc phát hiện ngón thứ hai mới chặn cuộn/phóng to. Hành vi này được mô tả trong tài liệu [MDN về `touch-action`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/touch-action).

## 6. Mô hình xoay, hoạt ảnh và ký hiệu

Tạo mô-đun xử lý nước xoay riêng cho Chơi tự do, dự kiến `js/play-moves.js`. Một mô tả chung chứa trục, tập lớp và góc xoay sẽ được dùng cho tính màu, tô sáng và hoạt ảnh. Giữ cách gọi hiện có của Học chơi và Hướng dẫn giải khi mở rộng phần dựng hình dùng chung.

| Loại | Ký hiệu | Quy tắc |
| --- | --- | --- |
| Lớp ngoài | `U D L R F B` | Giữ cách hiểu hiện tại |
| Lớp giữa | `M E S` | Chiều `M` theo `L`, `E` theo `D`, `S` theo `F` |
| Hai lớp | `Uw Dw Lw Rw Fw Bw` | Lớp ngoài và lớp giữa liền kề, chuyển động đồng thời |

Tất cả nhận dấu `'` để xoay ngược và `2` để xoay 180°. Ô công thức nhận thêm chữ thường như `r`, `u` và chuẩn hóa lịch sử thành `Rw`, `Uw`. Quy ước lớp giữa/chữ thường tham chiếu [J Perm](https://jperm.net/3x3/moves); quy ước hai lớp tham chiếu [WCA, Điều 12](https://www.worldcubeassociation.org/regulations/#article-12-notation).

Ba ngón chỉ tác động lên góc dựng hình; không thêm `x/y/z` vào mô hình hoặc lịch sử cho cử chỉ này.

Ví dụ công thức hỗn hợp cần chạy được:

```text
R U R' U' M2 Rw U2 Rw'
```

Kiểm tra toàn bộ công thức trước khi chạy; ký hiệu sai không làm chạy dở một phần. Giữ phím xoay sáu mặt hiện tại và bổ sung `M/E/S`; phím tắt không hoạt động khi người dùng đang nhập văn bản. Hai lớp có thể điều khiển bằng nút hoặc công thức.

## 7. Lưu khối và nhận biết hoàn thành

- Giữ mảng 54 ô màu và hai ngăn Hoàn tác/Làm lại, tối đa tổng cộng 200 nước.
- Một nước hai lớp là một phần tử lịch sử. Ba ngón không tạo phần tử lịch sử.
- Dùng định dạng lưu phiên bản mới; khi chưa có bản mới thì đọc bản cũ, kiểm tra rồi chuyển sang. Giữ bản cũ làm bản phục hồi, không xóa trước khi chuyển thành công.
- Kiểm tra đủ 54 ô, đúng sáu màu, mỗi màu chín ô; các màu tâm phải thuộc một trong 24 hướng hợp lệ của khối ban đầu. Tiếp tục dùng kiểm tra tính hợp lệ của các viên theo tâm.
- Màu và tên tâm trên nút chọn mặt lấy từ trạng thái hiện tại vì xoay giữa/hai lớp có thể làm tâm đổi vị trí trong mô hình.
- Nhận biết khối đã giải khi mỗi mặt đồng màu với tâm của nó; không buộc màu trên/phải/trước phải trùng hướng ban đầu.
- Góc quan sát và thông tin các ngón đang chạm tách khỏi trạng thái khối. Không lưu cử chỉ chưa hoàn tất để khôi phục sau tải lại.
- Không tự yêu cầu toàn màn hình từ dữ liệu lưu; yêu cầu này gắn với thao tác vào sân chơi của người dùng.
- Nếu bộ nhớ trình duyệt không khả dụng, tiếp tục chơi trong phiên hiện tại và thông báo không lưu được.
- Khối tự chơi tiếp tục độc lập với màu chụp camera, tiến độ học và bộ giải.

## 8. Phạm vi tệp dự kiến khi triển khai

| Tệp | Trách nhiệm |
| --- | --- |
| `js/play-moves.js` mới | Đọc/chuẩn hóa ký hiệu, mô tả và áp dụng các kiểu xoay |
| `js/play-gesture.js` mới | Bộ nhận cử chỉ thuần (không dùng DOM): nhóm ngón, khóa chế độ, hủy, chốt nước; kiểm thử được bằng Node |
| `js/play-state.js` | Trạng thái, hoàn tác/làm lại, kiểm tra và chuyển dữ liệu lưu |
| `js/cube3d.js` | Nhận nhiều ngón, chọn lớp, tô sáng, hoạt ảnh và đổi góc nhìn |
| `js/play.js` | Điều khiển sân chơi, trạng thái cử chỉ, công thức và nút thay thế |
| `js/app.js` | Luồng vào/ra Chơi tự do và liên kết toàn màn hình |
| `index.html`, `css/style.css` | Bố cục toàn màn hình, thanh công cụ, bảng điều khiển và hướng dẫn; nạp hai tệp mới và tăng mã phiên bản `?v=` |
| `tests/play.test.js`, `tests/e2e-play.js` | Kiểm tra mô hình và thao tác trên trình duyệt |
| `package.json`, `scripts/deploy-hub.sh` | Bổ sung kiểm tra cần thiết nếu tách bộ kiểm tra mới |
| `README.md`, `CHANGELOG.md` | Cách dùng và hành vi đã triển khai thực tế |

Nếu cấu trúc nhận cử chỉ hoặc toàn màn hình cần tách mô-đun để dễ kiểm tra, cập nhật phạm vi tệp trong kế hoạch trước khi thực hiện phần mở rộng đó.

## 9. Tiêu chí nghiệm thu

Kết quả ngày 11/11/2026 trên Chrome headless (giả lập chuột, màn hình cảm ứng 5 điểm chạm). `[x]` là đã kiểm chứng tự động; `[ ]` là chưa kiểm chứng được, có ghi lý do.

- [x] Vào Chơi tự do bằng thao tác người dùng tự yêu cầu toàn màn hình; không cần bấm thêm nếu trình duyệt cho phép.
- [x] Khi yêu cầu toàn màn hình bị từ chối/không hỗ trợ, sân chơi vẫn phủ vùng hiển thị và dùng được. (Nhánh "không hỗ trợ" như Safari trên iPhone chỉ kiểm tra qua mã, chưa chạy trên iPhone.)
- [x] Thoát bằng nút, Esc và thao tác hệ thống không bị tự mở lại; rời sân chơi khôi phục cuộn nền và tiêu điểm. (Esc/thao tác hệ thống được mô phỏng bằng `document.exitFullscreen()`, cùng đường xử lý sự kiện `fullscreenchange`; chưa gửi phím Esc thật.)
- [x] Một ngón xoay đúng mọi lớp ngoài và cả `M/E/S`, ở nhiều góc quan sát (234 hướng trên các mặt nhìn rõ ở 7 góc nhìn; chạm thật: `U`, `R`, `M`, `E`). Mặt nghiêng gần song song hướng nhìn trả "hướng chưa rõ", không đoán.
- [x] Hai ngón xoay đúng sáu cặp lớp liền nhau; hai lớp chuyển động đồng thời, hoàn tác bằng một lần bấm.
- [x] Ba ngón chỉ đổi góc nhìn. Màu khối, lịch sử, nhánh làm lại và trạng thái hoàn thành giữ nguyên.
- [x] Đặt thêm ngón trước khi khóa không phát sinh xoay sớm; thêm ngón sau khi khóa hủy lượt an toàn.
- [x] Nhấc từng ngón của cử chỉ hai/ba ngón không tạo thêm nước một lớp/hai lớp.
- [x] Kéo ra ngoài khối vẫn được theo dõi; chạm nút/ô nhập không bị tính nhầm vào cử chỉ.
- [x] Vuốt quá ngắn, hướng mơ hồ, các ngón lệch hướng, bốn ngón và ngắt chạm không tạo nước sai.
- [x] Kết quả các phép xoay đối chiếu được với phép biến đổi độc lập, chẳng hạn `Rw = R M'` và xoay bốn lần 90° trả về ban đầu.
- [x] Chuỗi hỗn hợp, xoay ngược, 180°, hoàn tác/làm lại và giới hạn 200 nước giữ trạng thái chính xác.
- [x] Tải lại sau `M/E/S` hoặc hai lớp không mất khối; bản lưu cũ chuyển được; dữ liệu hỏng được xử lý.
- [ ] Giao diện dùng được ở chiều rộng 320/375/390 px, máy tính, màn hình dọc/ngang và khi mở bàn phím ảo. Đã đạt: 320×640, 375×812, 390×844, 844×390 và 1280×800 không tràn ngang; thanh công cụ, bảng điều khiển và ô công thức tiếp cận được. Chưa kiểm chứng: bàn phím ảo thật (Chrome headless không mô phỏng được bàn phím ảo; mã chừa khoảng trống theo `visualViewport`).
- [x] Chạy kiểm tra tự động bằng chuột và chạm nhiều ngón thực sự qua trình duyệt, không chỉ gọi trực tiếp hàm xử lý.
- [ ] Kiểm tra thực tế cử chỉ ba ngón và toàn màn hình trên thiết bị Android/iPhone/iPad khả dụng; ghi rõ thiết bị đã kiểm tra và phần chưa kiểm tra. Mô phỏng Chrome không thay thế kết luận trên Safari hoặc hệ điều hành thật. **Chưa thực hiện**: chưa có thiết bị thật trong lần triển khai này.
- [x] `npm test` và `npm run test:e2e` đều đạt; Học chơi, Hướng dẫn giải và camera tiếp tục hoạt động.

Ảnh chụp từ kiểm thử trình duyệt nằm ở `.e2e-out/play/` (không đưa vào git): `two-fingers.png` (đang kéo hai ngón, tô sáng hai lớp), `three-fingers.png` (đang đổi góc nhìn), `mobile.png`, `mobile-panel.png`, `landscape.png`, `desktop.png`. Chưa quay video.

Tham số cử chỉ đang dùng (cần chỉnh lại sau khi thử trên thiết bị thật): ghép ngón 150 ms, xác nhận hướng 14 px, chạm chọn mặt dưới 8 px, hai ngón cùng hướng khi cos góc ≥ 0,6 và ngón kéo ít đi được ≥ 35% ngón kia.

## 10. Thứ tự thực hiện sau khi kế hoạch được duyệt

1. **Mô hình xoay:** thêm lớp giữa/hai lớp, chuẩn hóa ký hiệu và kiểm tra phép biến đổi độc lập.
2. **Trạng thái:** hoàn tác/làm lại, chuyển dữ liệu lưu, kiểm tra tâm và nhận biết hoàn thành.
3. **Cử chỉ và dựng hình:** nhóm ngón, khóa chế độ, suy ra hàng/cột, tô sáng, hoạt ảnh và ba ngón đổi góc nhìn.
4. **Toàn màn hình và giao diện:** vào/thoát, trường hợp trình duyệt từ chối, bố cục, bảng điều khiển và cách dùng thay thế.
5. **Kiểm chứng:** kiểm tra tự động, thiết bị thật khả dụng, ghi lại bằng chứng và các giới hạn còn lại.
6. **Bàn giao:** bản chạy thử cùng ảnh/video cho thao tác một lớp, hai lớp và đổi góc nhìn; đối chiếu tiêu chí trước khi đưa lên Server Hub.

Bước 1–5 đã làm trên bản làm việc. Bước 6 còn lại: kiểm tra trên thiết bị thật, chỉnh tham số cử chỉ nếu cần, rồi mới đưa lên Server Hub.

## 11. Ghi chú rà soát trước khi triển khai

Các điểm chỉnh dưới đây lấp chỗ còn bỏ ngỏ, không đổi lựa chọn đã xác nhận ở mục 1:

1. Ngón mốc của hai ngón là ngón sớm nhất nằm trên khối, không phải ngón chạm đầu tiên: hai ngón đặt gần như cùng lúc nên thứ tự chạm không ổn định.
2. Một ngón kéo từ vùng nền tiếp tục đổi góc nhìn, làm đường dự phòng khi hệ điều hành chiếm cử chỉ ba ngón.
3. Vuốt nhanh hơn khoảng ghép nhóm vẫn được chốt khi nhấc tay; chiều xoay tính theo vị trí lúc nhấc.
4. iPhone chỉ có chế độ phủ kín trang; thêm dạng `webkit` cho Safari trên iPad đời cũ.
5. Nút Quay lại về tab trước đó; đầu trang đặt `inert` khi sân chơi mở; thông báo nằm trong vùng toàn màn hình.
6. Tách bộ nhận cử chỉ thành `js/play-gesture.js` để kiểm thử các ca thời gian và số ngón bằng Node.
7. Đã thử trên Chrome headless: chạm nhiều ngón qua giao thức điều khiển Chrome sinh `pointerId` riêng cho từng ngón và nhấc được riêng từng ngón; `requestFullscreen()` thành công với cú bấm thật và bị từ chối khi gọi bằng script. Vì vậy kiểm thử tự động bao được cả hai nhánh.

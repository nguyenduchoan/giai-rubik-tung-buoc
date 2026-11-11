# Kế hoạch Chơi tự do: chỉnh cử chỉ 1/2/3 ngón, tô sáng khi chạm và sửa ô bị đen trên iPhone

- Trạng thái: **đã triển khai và deploy**. Người dùng duyệt kế hoạch ngày 11/11/2026. Kiểm thử tự động đạt; còn chờ xác nhận lỗi ô đen trên iPhone (mục 9).
- Ngày lập: 11/11/2026.
- Mã nguồn đã khảo sát: `af0f6f7` (nhánh `feature/choi-tu-do-toan-man-hinh`).
- Kế hoạch trước: `ke-hoach-choi-tu-do-toan-man-hinh.md`. Tài liệu này thay đổi mục 4.1, 4.2, 5.2 và ghi chú 11.2 của kế hoạch đó; các phần khác giữ nguyên.

## 1. Yêu cầu đã xác nhận với người dùng

| # | Yêu cầu | Lựa chọn đã chốt |
| --- | --- | --- |
| 1 | Chỉ **3 ngón** mới đổi góc nhìn | 1 ngón kéo từ vùng nền **không** đổi góc nhìn nữa (bỏ đường dự phòng ở ghi chú 11.2 cũ) |
| 2 | **1 ngón** chỉ chọn một hàng hoặc một cột để xoay | Giữ cách chọn lớp theo ô mốc và hướng kéo, gồm cả lớp giữa M/E/S |
| 3 | Sau khi xoay xong, vài ô bị **đen**; xoay tiếp hoặc đổi góc nhìn thì bình thường | Chỉ mới thấy trên **iPhone (Safari/WebKit)**, chưa thử máy khác |
| 4 | Chạm 1 hoặc 2 ngón phải **tô sáng** hàng/cột đang chạm | Vừa đặt ngón: tô sáng **ô (viên) đang chạm**; khi kéo rõ hướng: mở rộng thành **cả hàng hoặc cột** sẽ xoay |
| 5 | **2 ngón** chỉ cho chọn **2 hàng hoặc 2 cột** | Hai lớp phải **song song** (cùng trục); hai ngón trên cùng một hàng/cột thì **từ chối** và báo gợi ý |
| 6 | Hai lớp đó xoay **ngược chiều nhau tuỳ hướng kéo của mỗi ngón** | Mỗi ngón quyết định chiều của lớp mình; cùng chiều hay ngược chiều đều được |
| 7 | Lịch sử và hoàn tác cho lượt 2 ngón | Ghi **2 nước riêng** (ví dụ `R L'`), **Hoàn tác/Làm lại một lần lùi cả hai**; công thức nhập tay vẫn từng nước |

Các giả định do tôi tự chốt (nói rõ để người dùng bác nếu muốn khác):

- **Chuột/bút giữ nguyên** ba chế độ 1 lớp / 2 lớp / Góc nhìn trong bảng Điều khiển, vì một con trỏ không kéo được hai hướng. Chế độ 2 lớp bằng chuột vẫn ra nước `Rw`, `Uw`… như hiện tại. Chỉ cảm ứng đổi theo yêu cầu này.
- Hai ngón: **cả hai ngón phải đặt trên khối**. Một ngón ngoài khối thì từ chối, không tự đoán lớp cho ngón đó.
- Hai ngón: nếu lúc nhấc tay một ngón **chưa kéo đủ xa hoặc hướng chưa rõ** thì **bỏ cả lượt** và báo gợi ý, không xoay nửa vời một lớp. Lý do: tránh xoay nhầm, đúng tinh thần mục 5 của kế hoạch trước.
- Hai ngón cùng chiều trên hai lớp kề nhau (ví dụ `R` và `M'`) vẫn ghi hai nước riêng, không gộp thành `Rw`, để lịch sử nhất quán.
- Lượt kéo kết thúc khi **ngón đầu tiên nhấc lên** (giữ như hiện tại); chiều của từng lớp lấy theo vị trí hai ngón lúc đó.

## 2. Hiện trạng và điểm phải đổi

| Vị trí | Hành vi hiện tại | Thay đổi |
| --- | --- | --- |
| `js/play-gesture.js` | 1 ngón ở vùng nền → đổi góc nhìn; 2 ngón → một ngón làm mốc, hai lớp kề nhau cùng chiều (`Rw`); đo độ dịch chuyển **trung bình** các ngón; chỉ tô sáng sau khi khóa hướng | 1 ngón ở nền → từ chối kèm gợi ý; 2 ngón → **mỗi ngón một lớp, một chiều**; đo **từng ngón** cho 1–2 ngón (trung bình chỉ dùng cho 3 ngón); báo ô chạm ngay khi đặt ngón |
| `js/cube3d.js` | `pickLayer` chọn một lớp theo một mốc; `animateMove` xoay một nhóm lớp một chiều; `.sticker` là phần tử con của `.cubie-face` | Dùng `pickLayer` cho từng ngón; `animateMove` nhận **mảng** mô tả (mỗi lớp một chiều) trong một vòng khung hình; thêm `setTouched` tô sáng viên đang chạm; đổi cách vẽ ô màu để sửa lỗi đen trên WebKit |
| `js/play-state.js` | Mỗi mục lịch sử là một ký hiệu; `move(token)` một nước | Mỗi mục lịch sử là **một lượt** gồm 1–2 ký hiệu cách nhau bằng dấu cách; `move` nhận mảng; `undo`/`redo` xử lý cả lượt; bản lưu phiên bản 3, vẫn đọc phiên bản 2 |
| `js/play.js` | `perform` chạy một ký hiệu; `onTurn(token)` | `perform` chạy một lượt (1–2 ký hiệu) và hoạt ảnh đồng thời; `onTurn(tokens)`; chữ hướng dẫn và nhãn mới |
| `css/style.css` | `.sticker` con của `.cubie-face` (nền `#111`), tô sáng `active-layer`/`preview-layer` | Màu ô vẽ trực tiếp trên `.cubie-face`; thêm kiểu `touch-cubie`; chỉnh các kiểu tô sáng theo cấu trúc mới |
| `index.html`, `README.md`, `CHANGELOG.md` | Hướng dẫn "1 ngón: một lớp · 2 ngón: hai lớp · 3 ngón: nhìn quanh", chuột "kéo nền để nhìn quanh" | Cập nhật chữ, `aria-label`, tham số chống bộ đệm `?v=`; ghi thay đổi |
| `tests/play.test.js`, `tests/e2e-play.js` | Kiểm thử theo hành vi cũ (`Vw`, 1 ngón nền đổi góc nhìn, hai ngón lệch hướng bị từ chối) | Sửa các ca cũ theo hành vi mới và thêm ca mới (mục 8) |

## 3. Cử chỉ cảm ứng sau khi sửa

### 3.1. Một ngón: xoay một lớp

1. Đặt ngón lên một ô: tô sáng **viên** chứa ô đó (chưa biết hàng hay cột).
2. Kéo: khi độ dịch chuyển của ngón đạt ngưỡng xác nhận hướng (hiện 14 px) và khớp rõ một trục, chọn hàng hoặc cột như hiện tại; tô sáng **cả lớp**, thay cho tô viên.
3. Nhấc tay: chiều xoay theo vị trí lúc nhấc (giữ như hiện tại). Chưa đủ xa thì bỏ lượt.
4. Chạm nhẹ không kéo (dưới 8 px): vẫn là chọn mặt cho bảng Điều khiển (giữ như hiện tại).
5. **Một ngón đặt ở vùng nền rồi kéo: không làm gì với khối và góc nhìn.** Hiện gợi ý "Đặt ngón lên khối để xoay một hàng/cột. Dùng 3 ngón để đổi góc nhìn." rồi chờ nhấc tay.

### 3.2. Hai ngón: hai lớp song song, mỗi ngón một chiều

1. Đặt hai ngón, mỗi ngón lên một ô của khối, trong khoảng ghép ngón (150 ms). Tô sáng **hai viên** đang chạm. Nếu một ngón ở vùng nền: từ chối, gợi ý "Đặt cả hai ngón lên khối, mỗi ngón một hàng hoặc một cột."
2. Kéo: lượt được khóa khi **một trong hai ngón** đi đủ ngưỡng (không dùng trung bình, vì hai ngón kéo ngược nhau có trung bình gần 0). Với **từng ngón**, khi ngón đó đi đủ xa và hướng rõ, gọi `pickLayer(ô của ngón, dx, dy, 1)` để lấy lớp của riêng ngón đó; tô sáng lớp đó ngay (viên → lớp).
3. Khi cả hai lớp đã chọn, kiểm tra:
   - Khác **trục** (một ngón chọn hàng, ngón kia chọn cột): từ chối, gợi ý "Hai ngón phải kéo hai hàng hoặc hai cột song song nhau."
   - Cùng trục, **cùng lớp**: từ chối, gợi ý "Đặt hai ngón lên hai hàng hoặc hai cột khác nhau."
   - Cùng trục, khác lớp: hợp lệ. Hai ngón có thể ở hai mặt khác nhau miễn là lớp song song. Lớp giữa được phép (ví dụ `M'` và `R`); hai lớp ngoài đối nhau cũng được (ví dụ `R` và `L'`).
4. Nhấc ngón đầu tiên: chiều của **mỗi lớp** = dấu của độ dịch chuyển ngón đó chiếu lên hướng dương của lớp đó. Cả hai phải rõ chiều; nếu một ngón chưa đủ xa hoặc hướng mơ hồ thì bỏ cả lượt, gợi ý "Kéo cả hai ngón đủ xa theo hàng/cột của mình."
5. Chốt **một lượt gồm hai ký hiệu**, ví dụ `R L'`, `U E`, `F' S'`; hai lớp chuyển động **đồng thời**, mỗi lớp một chiều.
6. Các ca cũ bị thay đổi: "hai ngón lệch hướng" không còn bị từ chối (đó chính là ngược chiều hợp lệ); kiểm tra cos góc và tỉ lệ quãng đường (`sameDirection`, `minShare`) **bỏ**, thay bằng kiểm tra từng ngón ở bước 3–4.

### 3.3. Ba ngón: chỉ đổi góc nhìn

Giữ như hiện tại: độ dịch chuyển trung bình ba ngón, chụm/phóng không xoay, hủy thì trả góc nhìn về đầu cử chỉ. Không tô sáng viên khi đã có ba ngón; nếu ngón thứ ba đặt xuống khi hai viên đang tô sáng thì xóa tô sáng.

### 3.4. Các trường hợp giữ nguyên

Thêm ngón trước khi khóa (đo lại từ đầu), thêm ngón sau khi khóa (hủy lượt), bốn ngón trở lên, `pointercancel`, đổi kích thước, ẩn trang, đang chạy hoạt ảnh/công thức, vuốt nhanh nhấc tay trước khoảng ghép ngón: giữ nguyên quy tắc mục 5 của kế hoạch trước.

## 4. Thiết kế bộ nhận cử chỉ (`js/play-gesture.js`)

- `handler` thêm `touch(facelets)`: mảng số ô đang chạm (0–2 phần tử) để tô sáng viên; gọi khi đặt/nhấc ngón trong giai đoạn thu nhận, gọi `touch([])` khi khóa, từ chối, hủy hoặc chuyển sang ba ngón.
- `handler.commit(tokens)` nhận **mảng** 1–2 ký hiệu thay cho một chuỗi.
- Trạng thái mới: `sel` đổi từ một đối tượng thành `Map<pointerId, pick>` cho kiểu `layer1`/`layer2` cảm ứng; `pick` là kết quả `pickLayer` của riêng ngón đó.
- Đo dịch chuyển:
  - `displacement()` (trung bình) chỉ dùng cho `view` (3 ngón) và chuột.
  - `displacementOf(p)` cho từng ngón; điều kiện khóa với 1–2 ngón cảm ứng: `max` độ dịch chuyển của các ngón ≥ `lockPx`.
- `lock()`: với cảm ứng 1 ngón không có ô → `reject` (không chuyển sang `view` nữa); 2 ngón mà có ngón không có ô → `reject`. Chuột giữ `mode`.
- `track()`: với mỗi ngón chưa có `pick` và đã đi ≥ `lockPx`, gọi `pick(ô, dx, dy, 1)`; có `error` → `reject`; có kết quả → lưu, cập nhật `preview` bằng **hợp** các `spec` đã chọn (mảng spec). Khi đủ hai `pick`: kiểm tra trục/lớp (mục 3.2 bước 3), sai → `reject`.
- `finish()`: `view` như cũ; 1 ngón như cũ nhưng dùng dịch chuyển riêng của ngón; 2 ngón: cả hai phải có `pick` và chiều ≠ 0, ngược lại `reject`; `commit([tokenA, tokenB])` theo thứ tự ngón đặt xuống.
- `status()`: chữ trạng thái cho hai ngón hiện cả hai ký hiệu khi đã rõ, ví dụ `2 ngón · R L'`; một ngón rõ, một ngón chưa: `2 ngón · R · kéo ngón kia`.
- Chuột chế độ `layer2` vẫn gọi `pick(ô, dx, dy, 2)` và `commit([Rw])`.
- Tham số: giữ `groupMs` 150, `lockPx` 14, `tapPx` 8, `maxFingers` 3; xóa `sameDirection`, `minShare`.

## 5. Dựng hình (`js/cube3d.js`, `css/style.css`)

### 5.1. Tô sáng ba mức

| Lớp CSS | Khi nào | Kiểu dự kiến |
| --- | --- | --- |
| `touch-cubie` trên `.cubie` | Ngón đang đặt, chưa rõ hướng (1–2 viên) | Viền trắng mờ trong ô + sáng nhẹ, nhận ra ngay nhưng nhẹ hơn lớp đang kéo |
| `preview-layer` trên `.cubie` | Lớp đã chọn khi kéo (1 lớp hoặc hợp 2 lớp) | Giữ kiểu hiện tại (viền trắng đậm + quầng xanh) |
| `active-layer` trên `.cubie` | Lớp đang chọn trong bảng Điều khiển | Giữ; vẫn ẩn khi đang kéo (`gesturing`) |

- `setTouched(facelets)`: bật/tắt `touch-cubie` theo viên chứa các ô.
- `markLayers` nhận **mảng spec** hoặc một spec: một viên được tô nếu thuộc bất kỳ spec nào. `setPreview` dùng cách này cho hai lớp.
- Khi khóa hướng của một ngón, viên của ngón đó chuyển từ `touch-cubie` sang `preview-layer`; ngón kia vẫn giữ `touch-cubie` cho đến khi rõ hướng.

### 5.2. Hoạt ảnh nhiều lớp, mỗi lớp một chiều

- `animateMove(moves, duration, onDone)`: `moves` là một mô tả như cũ **hoặc mảng** mô tả `{ axis, layers, dir, power }`. Mỗi mô tả tạo một nhóm viên với trục và góc riêng; một vòng `requestAnimationFrame` cập nhật tất cả nhóm; kết thúc đặt lại transform mọi nhóm, gọi `onDone` một lần.
- Hai lớp song song không chia sẻ viên nên không có xung đột; vẫn kiểm tra và từ chối nếu hai mô tả có viên trùng (phòng gọi sai).
- Thời lượng: như một nước (240 ms, 1,5× cho nước 180°); cả lượt coi là một hoạt ảnh (`animating` một lần).

### 5.3. Sửa ô bị đen trên iPhone (WebKit)

Hiện tượng: ngay sau khi hoạt ảnh kết thúc (đặt lại transform của viên và đổi màu ô trong cùng một khung hình), vài ô hiện màu gần đen; tương tác tiếp theo buộc vẽ lại nên hết. Màu đen trùng với nền `#111` của `.cubie-face`, vì vậy giả thuyết chính là **lớp hợp thành của `.sticker` (phần tử con) không được vẽ lại** trong WebKit sau khi phần tử cha có `backface-visibility: hidden` thay đổi transform; phần nền của mặt viên lộ ra. Không có iPhone trong môi trường phát triển nên không thể tự tái hiện; cần người dùng kiểm tra từng phương án theo thứ tự.

Phương án theo thứ tự ưu tiên, mỗi phương án là một thay đổi nhỏ, kiểm tra xong mới sang phương án sau:

1. **Vẽ màu ô trực tiếp trên `.cubie-face`**, bỏ phần tử `.sticker`: màu qua `style.background` (hoặc biến `--sticker`) của mặt viên, viền tối bằng `box-shadow: inset 0 0 0 3px #111` và `border-radius`. `data-facelet` chuyển lên mặt viên; các kiểu tô sáng (`active-layer`, `preview-layer`, `touch-cubie`) đổi bộ chọn sang `.cubie-face[data-facelet]`. Mặt trong (không có ô) giữ nền `#111`. Giảm một nửa số lớp hợp thành (từ 324 xuống 162 phần tử có transform 3D); các tab Học chơi và Hướng dẫn giải dùng cùng `Cube3D` nên phải kiểm tra lại hiển thị.
2. Nếu vẫn đen: thêm `will-change: transform` (hoặc `-webkit-transform: translateZ(0)`) cho `.cubie` để WebKit giữ lớp hợp thành ổn định thay vì tạo/hủy sau mỗi hoạt ảnh.
3. Nếu vẫn đen: sau `onDone`, ép vẽ lại một lần ở khung hình kế tiếp (đổi `opacity` của `.cube3d` từ `0.999` về `1` hoặc bật/tắt một lớp CSS rỗng), chỉ áp dụng khi phát hiện WebKit (`'webkitRequestFullscreen' in Element.prototype` hoặc kiểm tra `navigator.vendor`), để không ảnh hưởng trình duyệt khác.

**Đã làm khi triển khai:** người dùng không kiểm tra được từng phương án giữa chừng, nên làm luôn phương án 1 và phương án 3, chưa làm phương án 2:

- Phương án 1: mặt viên mang lớp `sticker` và `data-facelet`, màu đặt bằng `style.background` của mặt viên, viền tối là `box-shadow: inset 0 0 0 3px #111`. Thêm tiền tố `-webkit-backface-visibility`. Các bộ chọn `.sticker` cũ vẫn trỏ đúng ô màu.
- Phương án 3: `Cube3D.refresh()` lệch góc nhìn 0,01° trong một khung hình rồi trả về, chạy sau mỗi hoạt ảnh xoay. Cách này mô phỏng đúng thao tác đổi góc nhìn mà người dùng thấy làm hết lỗi. Áp dụng cho mọi trình duyệt vì không nhìn thấy được và để Chrome headless kiểm chứng được đường mã; không dò WebKit.
- Phương án 2 (`will-change`) để dành nếu trên iPhone vẫn còn ô đen.

Kiểm chứng tự động (Chrome headless): sau một nước, chụp ảnh và lấy mẫu màu ở tâm từng ô nhìn thấy, không ô nào có màu `#111`±8; bảo đảm phương án không làm hỏng hiển thị trên Chrome. Kiểm chứng trên iPhone (người dùng): xoay 20 nước liên tiếp bằng 1 ngón và 2 ngón, không còn ô đen; ghi mẫu máy và phiên bản iOS vào mục 9.

## 6. Mô hình và lịch sử (`js/play-state.js`, `js/play-moves.js`, `js/play.js`)

- Mục lịch sử = **một lượt**: chuỗi 1–2 ký hiệu chuẩn hóa, cách nhau một dấu cách, ví dụ `"R"`, `"R L'"`.
- `playMoves` thêm `parseEntry(text)` → mảng 1–2 nước, lỗi nếu 0 hoặc >2 nước hoặc ký hiệu sai; `entryToString(moves)`.
- `PlayState.move(entry)`: nhận chuỗi lượt hoặc mảng ký hiệu; áp dụng lần lượt; ghi một mục; xóa nhánh Làm lại. `undo()`: lấy mục cuối, áp dụng nghịch đảo theo thứ tự ngược. `redo()`: áp dụng lại theo thứ tự thuận. Hai lớp song song giao hoán nên thứ tự không đổi kết quả, nhưng vẫn làm đúng thứ tự để tổng quát.
- Bản lưu: `VERSION = 3`; đọc được `version` 2 (mọi mục một ký hiệu) và 3; mục nào không qua `parseEntry` thì bỏ cả bản lưu như hiện tại (giữ khối mặc định). Giới hạn 200 **lượt**.
- `play.js`:
  - `perform(action, entry)`: `moves = parseEntry(entry)`; undo → nghịch đảo và đảo thứ tự; hoạt ảnh `view.animateMove(moves.map(P.describe), …)`; sau khi xong áp dụng vào mô hình như hiện tại. `selected` lấy theo ký hiệu đầu của lượt.
  - `onTurn(tokens)` từ `Cube3D` → `manual(tokens)`; nút, bàn phím và công thức vẫn tạo lượt một ký hiệu.
  - Lịch sử hiển thị mỗi lượt một dòng, `R L'` trong một ô mã; "Nước vừa đi: R L'".
  - `#play-undo`/`#play-redo` không đổi giao diện; một lần bấm lùi/tiến một lượt.

## 7. Giao diện và chữ

- Dòng gợi ý dưới khối: `1 ngón: một hàng/cột · 2 ngón: hai hàng/cột, mỗi ngón một chiều · 3 ngón: nhìn quanh`.
- `aria-label` của `#play-cube` và `README.md` cập nhật tương ứng.
- Gợi ý chuột (máy không cảm ứng): giữ "kéo theo chế độ 1 lớp / 2 lớp / Góc nhìn trong Điều khiển"; bỏ "kéo nền để nhìn quanh" nếu quyết định bỏ cả với chuột, còn theo giả định hiện tại thì giữ cho chuột.
- Tăng tham số chống bộ đệm `?v=` cho `css/style.css` và `js/*` được tải trong `index.html`.
- `CHANGELOG.md`: mục mới cho thay đổi cử chỉ, tô sáng và sửa lỗi đen trên iPhone.
- Kế hoạch trước: thêm ghi chú đầu các mục 4.1, 4.2, 11.2 trỏ sang tài liệu này.

## 8. Kiểm thử

### 8.1. Node (`tests/play.test.js`, chạy bằng `npm test`)

Sửa ca cũ:

- "Hai ngón: ngón mốc là ngón sớm nhất nằm trên khối" (`Vw`) → đổi thành hai ngón cùng chiều trên hai lớp kề nhau cho ra hai ký hiệu riêng.
- "Hai ngón lệch hướng: không xoay" → đổi thành ngược chiều hợp lệ cho ra hai ký hiệu ngược chiều.
- "Một ngón từ vùng nền đổi góc nhìn" → một ngón từ vùng nền bị từ chối, không có `orbit`, có gợi ý "3 ngón".
- Bộ ghi (`recorder`) mô phỏng `pick` trả `axis`/`layer` theo ô để kiểm tra điều kiện trục/lớp; thêm ghi `touch`.

Ca mới cho cử chỉ:

- Đặt 1 ngón: `touch([ô])`; khóa hướng: `touch([])` và `preview([spec])`; nhấc/hủy: xóa hết.
- Đặt 2 ngón: `touch([ôA, ôB])`; ngón A rõ hướng trước: `preview([specA])`, `touch([ôB])`; cả hai rõ: `preview([specA, specB])`.
- Hai ngón ngược chiều, cùng trục, khác lớp → `commit(['R', "L'"])` (theo mô phỏng), trạng thái `2 ngón · R L'`.
- Hai ngón cùng lớp → từ chối, gợi ý "hai hàng hoặc hai cột khác nhau".
- Hai ngón khác trục → từ chối, gợi ý "song song".
- Một ngón ngoài khối trong lượt hai ngón → từ chối.
- Một ngón chưa đủ xa lúc nhấc → bỏ cả lượt, không `commit`.
- Hai ngón kéo ngược nhau có trung bình gần 0 vẫn được khóa (kiểm tra đo từng ngón).
- Ngón thứ ba đặt xuống khi hai viên đang tô → `touch([])`, chuyển sang đổi góc nhìn.
- Ba ngón và chuột: các ca cũ vẫn đạt.

Ca mới cho hình học (`Cube3D` trong Node với vùng chứa giả như hiện có): ở góc nhìn mặc định, hai ngón trên cột phải và cột trái mặt trước kéo lên/xuống ngược nhau → `R` và `L'` (hoặc `R'` và `L`), dùng `pickLayer` thật cho từng ngón; hai ngón trên hàng trên và hàng giữa kéo ngang cùng chiều → `U` và `E'`.

Ca mới cho mô hình: `move(['R', "L'"])` ghi `"R L'"`, `undo()` một lần về khối trước, `redo()` trở lại; bản lưu phiên bản 3 đọc lại đúng; bản lưu phiên bản 2 đọc được; mục có 3 ký hiệu hoặc ký hiệu sai làm bỏ bản lưu; 200 lượt giữ đúng giới hạn; `animateMove` với mảng hai mô tả gọi `onDone` một lần và đặt lại transform cả hai nhóm (kiểm tra bằng DOM giả nếu hạ tầng hiện có cho phép, nếu không thì chuyển sang e2e).

### 8.2. Trình duyệt (`tests/e2e-play.js`, chạy bằng `npm run test:e2e`)

- Hai ngón thật qua giao thức điều khiển Chrome (`multiDrag` với vectơ riêng từng ngón) trên cột phải và cột trái kéo ngược nhau → lịch sử một mục hai ký hiệu, khối đổi đúng theo `P.applyAll`; một lần Hoàn tác trả về khối trước; Làm lại trở lại.
- Hai ngón trên cùng cột → không có nước, gợi ý đúng.
- Một ngón kéo từ vùng nền → góc nhìn (`view.view`) không đổi, không có nước.
- Ba ngón vẫn đổi góc nhìn.
- Chụp ảnh khi đang đặt 2 ngón chưa kéo (`touch-highlight.png`) và khi đã rõ hai lớp (`two-layers-opposite.png`).
- Sau một nước, lấy mẫu màu tâm các ô nhìn thấy trong ảnh chụp: không ô nào gần `#111`.
- Học chơi và Hướng dẫn giải (`tests/e2e-learn.js`, `tests/e2e-state.js`) vẫn đạt sau khi đổi cấu trúc ô màu.

### 8.3. Thiết bị thật (người dùng, iPhone)

Danh sách kiểm tra gửi kèm bản chạy thử:

1. Xoay 20 nước bằng 1 ngón, 20 lượt bằng 2 ngón: không còn ô đen sau khi hoạt ảnh kết thúc.
2. Đặt 1 ngón thấy viên sáng; kéo thấy cả hàng/cột sáng; nhấc tay tắt.
3. Đặt 2 ngón thấy hai viên sáng; kéo ngược nhau thấy hai lớp sáng và xoay ngược chiều.
4. 1 ngón kéo ở nền không đổi góc nhìn; 3 ngón đổi góc nhìn.
5. Hoàn tác một lần lùi cả lượt hai ngón.

Ghi mẫu máy, phiên bản iOS và phương án sửa đen (1/2/3 ở mục 5.3) đã có hiệu quả vào mục 9.

## 9. Tiêu chí nghiệm thu

Kết quả ngày 11/11/2026 trên Chrome headless (chuột và màn hình cảm ứng giả lập 5 điểm chạm) và Node. `[x]` là đã kiểm chứng tự động; `[ ]` là chưa kiểm chứng được, có ghi lý do.

- [x] Chỉ 3 ngón đổi góc nhìn; 1 ngón ở nền không đổi góc nhìn và có gợi ý "Dùng 3 ngón để đổi góc nhìn" (Node và chạm thật).
- [x] 1 ngón xoay đúng mọi lớp ngoài và M/E/S như trước: quét 234 hướng ở 7 góc nhìn vẫn đạt; chạm thật `U`, `R`, `M`, `E`.
- [x] Đặt 1–2 ngón tô sáng viên đang chạm (1 và 2 viên khi chạm thật); kéo rõ hướng chuyển thành tô sáng cả hàng/cột (9 và 18 viên); 3 ngón và 4 ngón không tô.
- [x] 2 ngón chỉ chấp nhận hai lớp song song khác nhau. Cùng lớp, khác trục, ngón ngoài khối, ngón không kéo và ngón kéo chéo mơ hồ đều không xoay và có gợi ý đúng (Node; chạm thật cho bốn ca đầu và ngón không kéo).
- [x] 2 ngón xoay hai lớp đồng thời (18 viên chuyển động trong cùng hoạt ảnh), mỗi lớp theo chiều kéo của ngón mình. Chạm thật: `L R` (ngược chiều), `U D'`, `U E`; hình học thật trong Node: thêm `L' R'` và `M' R`. Kết quả khớp `P.applyAll`.
- [x] Lịch sử ghi lượt hai ký hiệu; Hoàn tác/Làm lại một lần cho cả lượt; công thức nhập tay vẫn từng nước.
- [x] Bản lưu phiên bản 2 và bản cũ không có phiên bản đọc được, chuyển lên phiên bản 3; tải lại không mất khối; lượt sai (ví dụ `R U`) làm bỏ bản lưu hỏng.
- [x] Chuột giữ ba chế độ như cũ; kéo vùng nền bằng chuột vẫn đổi góc nhìn.
- [ ] Không còn ô đen sau khi xoay trên iPhone. **Chưa kiểm chứng**: không có iPhone trong môi trường phát triển; cần người dùng chạy danh sách ở mục 8.3. Trên Chrome: ảnh chụp sau nước một ngón và sau lượt hai ngón có 27 ô nhìn thấy, không ô nào tối; góc nhìn trở về đúng giá trị cũ sau bước dựng lại.
- [x] Học chơi và Hướng dẫn giải hiển thị khối bình thường sau khi đổi cấu trúc ô màu (`tests/e2e-learn.js`, `tests/e2e-camera.js`, `tests/e2e-state.js`).
- [x] `npm test` và `npm run test:e2e` đạt.

Ảnh chụp từ kiểm thử trình duyệt nằm ở `.e2e-out/play/` (không đưa vào git): `touch-highlight.png` (đặt hai ngón, hai viên sáng), `two-layers-opposite.png` (kéo ngược chiều, hai cột sáng, trạng thái `2 ngón · L R`).

Thay đổi phát sinh khi kiểm thử: đoạn hướng dẫn cảm ứng trong bảng Điều khiển dài hơn nên ô công thức ở màn hình 320×640 nằm sát mép dưới. Thêm `scroll-margin-bottom` cho ô công thức và cho kiểm tra bố cục sai số 1px như các kiểm tra khác.

Sửa kèm: trước đây lớp đang chọn trong bảng Điều khiển (`active-layer`) có quy tắc CSS mạnh hơn tô sáng khi kéo, nên viên nằm ở chỗ giao hai lớp mất tô sáng. Quy tắc nay bỏ qua viên đang được tô sáng.

## 10. Thứ tự thực hiện

1. **Mô hình và lịch sử:** `parseEntry`, `PlayState` lượt 1–2 ký hiệu, bản lưu phiên bản 3, kiểm thử Node.
2. **Hoạt ảnh nhiều lớp:** `animateMove` nhận mảng; `perform` trong `play.js` chạy lượt; nút/bàn phím/công thức vẫn một ký hiệu.
3. **Bộ nhận cử chỉ:** đo từng ngón, hai ngón độc lập, điều kiện trục/lớp, một ngón ở nền bị từ chối, `touch`/`commit(tokens)`; sửa và thêm kiểm thử Node.
4. **Tô sáng:** `setTouched`, `markLayers` nhiều spec, CSS ba mức.
5. **Sửa ô đen:** phương án 1 (màu trên `.cubie-face`), kiểm tra Chrome và hai tab dùng chung `Cube3D`; gửi bản thử cho người dùng kiểm tra trên iPhone; cần thì làm phương án 2, 3.
6. **Chữ, tài liệu:** `index.html`, `README.md`, `CHANGELOG.md`, ghi chú trong kế hoạch trước, tăng `?v=`.
7. **Kiểm thử trình duyệt:** sửa và thêm ca trong `tests/e2e-play.js`; chạy toàn bộ `npm test`, `npm run test:e2e`.
8. **Bàn giao:** commit trên nhánh `feature/choi-tu-do-toan-man-hinh` sau khi người dùng xác nhận trên iPhone; cập nhật mục 9 với kết quả.

Ước lượng: bước 1–4 và 6–7 làm được hoàn toàn trong môi trường hiện tại; bước 5 phụ thuộc kết quả kiểm tra trên iPhone của người dùng, có thể lặp 1–3 lần.

## 11. Rủi ro và điểm mở

- Không có iPhone để tái hiện lỗi đen: phương án 1 là suy luận từ triệu chứng (màu đen trùng nền mặt viên), chưa phải nguyên nhân đã chứng minh. Vì vậy chia nhỏ ba phương án và kiểm tra lần lượt.
- Đổi `.sticker` thành vẽ trên `.cubie-face` ảnh hưởng ba tab dùng `Cube3D`; phải chạy lại toàn bộ e2e, không chỉ Chơi tự do.
- Hai ngón đặt rất gần nhau trên cùng một viên dễ rơi vào ca "cùng lớp"; gợi ý phải nói rõ cách đặt lại. Có thể chỉnh `lockPx` riêng cho hai ngón sau khi thử trên máy thật.
- Nếu người dùng muốn một ngón kéo ở nền vẫn đổi góc nhìn với **chuột**, giả định hiện tại đã giữ điều đó; nếu muốn bỏ luôn cả với chuột thì chỉ cần đổi một nhánh trong `lock()` và một dòng chữ gợi ý.

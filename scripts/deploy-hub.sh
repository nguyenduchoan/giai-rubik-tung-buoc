#!/usr/bin/env bash
# Đưa trang "Giải Rubik" lên Server Hub của máy này rồi build lại thư mục public/ của hub.
#
#   bash scripts/deploy-hub.sh            # mặc định HUB_ROOT=/var/www/html
#   HUB_ROOT=/duong/dan/hub bash scripts/deploy-hub.sh
#
# Kết quả: <HUB_ROOT>/rubik/ (nguồn) và <HUB_ROOT>/public/rubik/ (bản build), truy cập tại /rubik/.
# Dịch vụ phòng (Thi tự do giờ + Thi trực tiếp) chạy bằng PM2 tên rubik-rooms ở 127.0.0.1:3002, dữ liệu ở
# <HUB_ROOT>/data/rubik-rooms (rooms.json và online/online.sqlite), ngoài vùng công khai. Khởi động lại dịch vụ
# làm các ván Thi trực tiếp đang chạy thành VOID (luật BR-25); chạy lúc không có ván.
set -euo pipefail

HUB_ROOT="${HUB_ROOT:-/var/www/html}"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$HUB_ROOT/rubik"

[ -f "$HUB_ROOT/scripts/build-public.js" ] || { echo "Không thấy Server Hub tại $HUB_ROOT" >&2; exit 1; }
[ -f "$HUB_ROOT/api-server/src/app.js" ] || { echo "Không thấy API Hub để gắn tuyến phòng." >&2; exit 1; }
command -v pm2 >/dev/null || { echo "Cần PM2 để giữ dịch vụ phòng chạy sau khi đóng terminal." >&2; exit 1; }

echo "==> Chạy test"
npm test --prefix "$SRC" >/dev/null

echo "==> Cài dịch vụ phòng và dữ liệu riêng"
ROOM_SERVICE="$HUB_ROOT/data/rubik-room-service"
ROOM_STORE="$HUB_ROOT/data/rubik-rooms"
HUB_PROXY_BEFORE="$(sha256sum "$ROOM_SERVICE/hub-proxy.js" 2>/dev/null | cut -d' ' -f1 || true)"
install -d -m 0700 "$ROOM_SERVICE/scripts" "$ROOM_SERVICE/js" "$ROOM_SERVICE/server/online" "$ROOM_STORE"
install -m 0600 "$SRC/scripts/serve.js" "$SRC/scripts/rooms.js" "$ROOM_SERVICE/scripts/"
install -m 0600 "$SRC/js/cube.js" "$SRC/js/play-moves.js" "$SRC/js/solver.js" "$SRC/js/online-protocol.js" "$ROOM_SERVICE/js/"
install -m 0600 "$SRC"/server/online/*.js "$ROOM_SERVICE/server/online/"
install -m 0600 "$SRC/scripts/hub-proxy.js" "$ROOM_SERVICE/hub-proxy.js"
for file in "$ROOM_SERVICE"/scripts/*.js "$ROOM_SERVICE"/server/online/*.js "$ROOM_SERVICE/hub-proxy.js"; do node --check "$file"; done
if pm2 describe rubik-rooms >/dev/null 2>&1; then
  ROOM_DATA_DIR="$ROOM_STORE" HOST=127.0.0.1 PORT=3002 pm2 restart rubik-rooms --update-env >/dev/null
else
  ROOM_DATA_DIR="$ROOM_STORE" HOST=127.0.0.1 PORT=3002 pm2 start "$ROOM_SERVICE/scripts/serve.js" --name rubik-rooms --cwd "$ROOM_SERVICE" >/dev/null
fi
for _attempt in $(seq 1 50); do
  if curl --fail --silent http://127.0.0.1:3002/api/health >/dev/null; then break; fi
  sleep 0.2
done
curl --fail --silent --show-error http://127.0.0.1:3002/api/health >/dev/null

echo "==> Gắn tuyến phòng (HTTP + WebSocket) vào API Hub"
HUB_BEFORE="$(cat "$HUB_ROOT/api-server/src/app.js" "$HUB_ROOT/api-server/server.js" | sha256sum | cut -d' ' -f1)$HUB_PROXY_BEFORE"
cp -p "$HUB_ROOT/api-server/src/app.js" "$ROOM_SERVICE/hub-app.deploy-before.js"
cp -p "$HUB_ROOT/api-server/server.js" "$ROOM_SERVICE/hub-server.deploy-before.js"
node "$SRC/scripts/install-hub-proxy.js" "$HUB_ROOT"
node --check "$HUB_ROOT/api-server/src/app.js"
node --check "$HUB_ROOT/api-server/server.js"
HUB_AFTER="$(cat "$HUB_ROOT/api-server/src/app.js" "$HUB_ROOT/api-server/server.js" | sha256sum | cut -d' ' -f1)$(sha256sum "$ROOM_SERVICE/hub-proxy.js" | cut -d' ' -f1)"
if [ "$HUB_BEFORE" != "$HUB_AFTER" ]; then
  if ! npm test --prefix "$HUB_ROOT/api-server" >/dev/null; then
    install -m 0644 "$ROOM_SERVICE/hub-app.deploy-before.js" "$HUB_ROOT/api-server/src/app.js"
    install -m 0644 "$ROOM_SERVICE/hub-server.deploy-before.js" "$HUB_ROOT/api-server/server.js"
    echo "Kiểm tra API Hub không đạt; đã phục hồi mã API Hub trước lần cài này." >&2
    exit 1
  fi
  # API Hub nạp hub-proxy.js khi khởi động nên cần khởi động lại khi tệp này hoặc điểm gắn thay đổi.
  pm2 restart api-server >/dev/null
fi
for _attempt in $(seq 1 50); do
  if curl --fail --silent http://127.0.0.1/api/rubik/health >/dev/null; then break; fi
  sleep 0.2
done
curl --fail --silent --show-error http://127.0.0.1/api/rubik/health >/dev/null
curl --fail --silent --show-error http://127.0.0.1/api/rubik/online/health >/dev/null
# WebSocket qua nginx → API Hub → dịch vụ: không có cookie phiên phải bị chính dịch vụ phòng từ chối 401.
WS_STATUS="$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 5 --http1.1 \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' \
  -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' http://127.0.0.1/api/rubik/online/ws || true)"
[ "$WS_STATUS" = "401" ] || { echo "Đường WebSocket Thi trực tiếp chưa thông (mã $WS_STATUS)." >&2; exit 1; }
# Có cookie phiên và Origin cùng trang thì phải nâng cấp được (101): kiểm tra nguồn trang khớp Host đi qua nginx.
COOKIE_JAR="$(mktemp)"
curl --fail --silent --show-error -c "$COOKIE_JAR" -H 'Origin: http://127.0.0.1' -H 'Content-Type: application/json' \
  -d '{}' http://127.0.0.1/api/rubik/online/session >/dev/null
WS_STATUS="$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 2 --http1.1 -b "$COOKIE_JAR" \
  -H 'Origin: http://127.0.0.1' -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' \
  -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' http://127.0.0.1/api/rubik/online/ws || true)"
rm -f "$COOKIE_JAR"
[ "$WS_STATUS" = "101" ] || { echo "WebSocket Thi trực tiếp từ chối trang hợp lệ (mã $WS_STATUS)." >&2; exit 1; }
pm2 save >/dev/null
chmod 0600 "$HOME/.pm2/dump.pm2"

echo "==> Chuẩn bị bản mới"
STAGE="$(mktemp -d "$HUB_ROOT/.rubik-next-XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/css" "$STAGE/js"
install -m 0644 "$SRC/index.html" "$STAGE/index.html"
sed -i 's|<head>|<head>\n  <meta name="rubik-api-base" content="/api/rubik/">|' "$STAGE/index.html"
install -m 0644 "$SRC"/css/*.css "$STAGE/css/"
install -m 0644 "$SRC"/js/*.js "$STAGE/js/"
chmod 0755 "$STAGE" "$STAGE/css" "$STAGE/js"

# Mã phiên bản theo nội dung để điện thoại không dùng JS/CSS cũ trong cache.
VERSION="$(cat "$STAGE"/index.html "$STAGE"/css/*.css "$STAGE"/js/*.js | sha256sum | cut -c1-10)"
sed -i -E "s/\?v=[0-9A-Za-z]+/?v=$VERSION/g" "$STAGE/index.html" "$STAGE/js/app.js"

echo "==> Tráo vào $DEST"
rm -rf "$DEST.previous"
if [ -d "$DEST" ]; then mv "$DEST" "$DEST.previous"; fi
mv "$STAGE" "$DEST"
trap - EXIT
rm -rf "$DEST.previous"

echo "==> Build lại public/ của hub"
(cd "$HUB_ROOT" && node scripts/build-public.js)

echo "Xong: phiên bản $VERSION -> /rubik/"
curl --fail --silent --show-error http://127.0.0.1/rubik/ >/dev/null
curl --fail --silent --show-error http://127.0.0.1/api/rubik/health >/dev/null
curl --fail --silent --show-error http://127.0.0.1/api/rubik/online/meta >/dev/null

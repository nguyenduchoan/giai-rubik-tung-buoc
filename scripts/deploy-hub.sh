#!/usr/bin/env bash
# Đưa trang "Giải Rubik" lên Server Hub của máy này rồi build lại thư mục public/ của hub.
#
#   bash scripts/deploy-hub.sh            # mặc định HUB_ROOT=/var/www/html
#   HUB_ROOT=/duong/dan/hub bash scripts/deploy-hub.sh
#
# Kết quả: <HUB_ROOT>/rubik/ (nguồn) và <HUB_ROOT>/public/rubik/ (bản build), truy cập tại /rubik/.
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
install -d -m 0700 "$ROOM_SERVICE/scripts" "$ROOM_SERVICE/js" "$ROOM_STORE"
install -m 0600 "$SRC/scripts/serve.js" "$SRC/scripts/rooms.js" "$ROOM_SERVICE/scripts/"
install -m 0600 "$SRC/js/cube.js" "$ROOM_SERVICE/js/"
install -m 0600 "$SRC/scripts/hub-proxy.js" "$ROOM_SERVICE/hub-proxy.js"
node --check "$ROOM_SERVICE/scripts/serve.js"
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

echo "==> Gắn tuyến phòng vào API Hub"
HUB_APP_BEFORE="$(sha256sum "$HUB_ROOT/api-server/src/app.js" | cut -d' ' -f1)"
node "$SRC/scripts/install-hub-proxy.js" "$HUB_ROOT"
node --check "$HUB_ROOT/api-server/src/app.js"
if [ "$HUB_APP_BEFORE" != "$(sha256sum "$HUB_ROOT/api-server/src/app.js" | cut -d' ' -f1)" ]; then
  if ! npm test --prefix "$HUB_ROOT/api-server" >/dev/null; then
    install -m 0644 "$ROOM_SERVICE/hub-app.before-rubik.js" "$HUB_ROOT/api-server/src/app.js"
    echo "Kiểm tra API Hub không đạt; đã phục hồi mã trước khi cài tuyến Rubik." >&2
    exit 1
  fi
  pm2 restart api-server >/dev/null
fi
for _attempt in $(seq 1 50); do
  if curl --fail --silent http://127.0.0.1/api/rubik/health >/dev/null; then break; fi
  sleep 0.2
done
curl --fail --silent --show-error http://127.0.0.1/api/rubik/health >/dev/null
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

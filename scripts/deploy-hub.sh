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

echo "==> Chạy test"
node "$SRC/tests/solver.test.js" >/dev/null
node "$SRC/tests/vision.test.js" >/dev/null
node "$SRC/tests/arrange.test.js" >/dev/null

echo "==> Chuẩn bị bản mới"
STAGE="$(mktemp -d "$HUB_ROOT/.rubik-next-XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/css" "$STAGE/js"
install -m 0644 "$SRC/index.html" "$STAGE/index.html"
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

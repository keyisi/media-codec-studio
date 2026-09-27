#!/usr/bin/env bash
# 在 macOS 上从 build/icon.png 生成 build/icon.icns
# 用法: bash scripts/make-mac-icon.sh
set -euo pipefail

cd "$(dirname "$0")/.."

SRC="build/icon.png"
ICONSET="build/icon.iconset"

if [ ! -f "$SRC" ]; then
  echo "找不到 $SRC" >&2
  exit 1
fi

rm -rf "$ICONSET"
mkdir -p "$ICONSET"

# 需要的尺寸: 16, 32, 128, 256, 512 (各 1x 和 2x)
sips -z 16 16     "$SRC" --out "$ICONSET/icon_16x16.png"        >/dev/null
sips -z 32 32     "$SRC" --out "$ICONSET/icon_16x16@2x.png"     >/dev/null
sips -z 32 32     "$SRC" --out "$ICONSET/icon_32x32.png"        >/dev/null
sips -z 64 64     "$SRC" --out "$ICONSET/icon_32x32@2x.png"     >/dev/null
sips -z 128 128   "$SRC" --out "$ICONSET/icon_128x128.png"      >/dev/null
sips -z 256 256   "$SRC" --out "$ICONSET/icon_128x128@2x.png"   >/dev/null
sips -z 256 256   "$SRC" --out "$ICONSET/icon_256x256.png"      >/dev/null
sips -z 512 512   "$SRC" --out "$ICONSET/icon_256x256@2x.png"   >/dev/null
sips -z 1024 1024 "$SRC" --out "$ICONSET/icon_512x512@2x.png"   >/dev/null

iconutil -c icns "$ICONSET" -o "build/icon.icns"
rm -rf "$ICONSET"

echo "已生成 build/icon.icns"

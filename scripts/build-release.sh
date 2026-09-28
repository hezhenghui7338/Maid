#!/usr/bin/env bash
# Build a self-contained Maid.app for end users (system WebKit, no Node/Rust required).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> Syncing release identity (package, Tauri, Cargo)…"
if [[ -n "${MAID_VERSION:-}" ]]; then
  python3 "$ROOT/scripts/sync-release-identity.py" --version "$MAID_VERSION"
else
  python3 "$ROOT/scripts/sync-release-identity.py"
fi
VERSION="$(python3 "$ROOT/scripts/sync-release-identity.py" --print-version)"

DIST="$ROOT/dist"
MAX_APP_MB=200
MAX_DMG_MB=120

assert_max_dir_mb() {
  local path="$1"
  local max_mb="$2"
  local label="$3"
  local size_mb
  size_mb=$(du -sm "$path" | cut -f1)
  if (( size_mb > max_mb )); then
    echo "ERROR: $label too large: ${size_mb}MB (max ${max_mb}MB): $path" >&2
    exit 1
  fi
}

assert_max_file_mb() {
  local path="$1"
  local max_mb="$2"
  local label="$3"
  local size_mb
  size_mb=$(($(stat -f%z "$path") / 1024 / 1024))
  if (( size_mb > max_mb )); then
    echo "ERROR: $label too large: ${size_mb}MB (max ${max_mb}MB): $path" >&2
    exit 1
  fi
}

echo "==> Maid release build v${VERSION}"

# --- 0. Release tests (must pass before build) ---
echo "==> Running release tests (must pass)…"
cd "$ROOT"
if [[ ! -d node_modules ]]; then
  echo "==> Installing npm dependencies…"
  npm install
fi
npm test

# --- 1. Build Maid.app ---
echo "==> Building Maid.app (release)…"
npx tauri build --bundles app

APP="$ROOT/src-tauri/target/release/bundle/macos/Maid.app"
if [[ ! -d "$APP" ]]; then
  echo "ERROR: Tauri build failed — $APP not found" >&2
  exit 1
fi

# --- 2. Ad-hoc re-sign ---
# Optional: CODESIGN_IDENTITY="Developer ID Application: …" for real distribution.
echo "==> Ad-hoc codesign…"
CODESIGN_IDENTITY="${CODESIGN_IDENTITY:--}"
codesign --force --deep --options runtime --sign "$CODESIGN_IDENTITY" "$APP"
codesign --verify --deep --strict "$APP"

# --- 3. Stage release artifacts ---
echo "==> Staging release artifacts…"
mkdir -p "$DIST"
RELEASE_APP="$DIST/Maid.app"
rm -rf "$RELEASE_APP"
ditto "$APP" "$RELEASE_APP"
codesign --verify --deep --strict "$RELEASE_APP"

ZIP="$DIST/Maid-${VERSION}-macOS.zip"
rm -f "$ZIP"
ditto -c -k --sequesterRsrc --keepParent "$RELEASE_APP" "$ZIP"

DMG="$DIST/Maid-${VERSION}-macOS.dmg"
rm -f "$DMG"
STAGE="$DIST/dmg-stage"
rm -rf "$STAGE"
mkdir -p "$STAGE"
ditto "$RELEASE_APP" "$STAGE/Maid.app"
ln -s /Applications "$STAGE/Applications"
cat > "$STAGE/开始使用.txt" <<EOF
Maid ${VERSION} — macOS

1. 将 Maid.app 拖入 Applications（应用程序）文件夹
2. 打开 Maid，选择一个项目文件夹，在 Markdown 里书写
3. 分析需要本机 Ollama（免费本地 AI）：https://ollama.com/download
   安装后执行：ollama pull llama3.2
   也可在应用的「模型」里改用其他 OpenAI 兼容接口

无需安装 Node、Rust 或 Xcode。
EOF

hdiutil create -volname "Maid ${VERSION}" -srcfolder "$STAGE" -ov -format UDZO "$DMG"
rm -rf "$STAGE"

assert_max_dir_mb "$RELEASE_APP" "$MAX_APP_MB" "Maid.app"
assert_max_file_mb "$DMG" "$MAX_DMG_MB" "DMG"

echo ""
echo "✅ Release ready:"
echo "   App:  $RELEASE_APP ($(du -sh "$RELEASE_APP" | cut -f1))"
echo "   ZIP:  $ZIP ($(du -sh "$ZIP" | cut -f1))"
echo "   DMG:  $DMG ($(du -sh "$DMG" | cut -f1))"
echo ""
echo "Upload DMG/ZIP to GitHub Releases for users to download."

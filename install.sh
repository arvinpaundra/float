#!/usr/bin/env bash
# float installer — downloads a release, verifies its SHA-256, installs float.
#
#   curl -fsSL https://raw.githubusercontent.com/arvinpaundra/float/master/install.sh | bash
#   curl -fsSL …/install.sh | bash -s -- 0.2.0        # a specific version
#   curl -fsSL …/install.sh | bash -s -- --uninstall
#
# macOS: float.app → ~/Applications.   Linux: an AppImage → ~/.local/bin plus a desktop entry.
# Env overrides: FLOAT_INSTALL_DIR, FLOAT_RELEASES (release base URL).
set -euo pipefail

REPO="arvinpaundra/float"
RELEASES="${FLOAT_RELEASES:-https://github.com/$REPO/releases}"
MIN_MACOS=14

VERSION="latest"
UNINSTALL=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --uninstall) UNINSTALL=1; shift ;;
    --help|-h)
      echo "Usage: install.sh [latest|VERSION] [--uninstall]"
      exit 0
      ;;
    latest|[0-9]*.[0-9]*.[0-9]*) VERSION="${1#v}"; shift ;;
    v[0-9]*) VERSION="${1#v}"; shift ;;
    *) echo "Unknown argument: $1 (see --help)" >&2; exit 2 ;;
  esac
done

red="" reset=""
if [[ -t 2 ]]; then red=$'\033[31m'; reset=$'\033[0m'; fi
die() { echo "${red}Error: $*${reset}" >&2; exit 1; }

# ---- platform ----
arch="$(uname -m)"
case "$(uname -s)" in
  Darwin)
    os="darwin"
    platform="darwin-universal" # one build for Apple Silicon and Intel
    INSTALL_DIR="${FLOAT_INSTALL_DIR:-$HOME/Applications}"
    TARGET="$INSTALL_DIR/float.app"
    macos_major="$(sw_vers -productVersion | cut -d. -f1)"
    (( macos_major >= MIN_MACOS )) || die "float needs macOS $MIN_MACOS or newer (this Mac has $(sw_vers -productVersion))."
    ;;
  Linux)
    os="linux"
    [[ "$arch" == "x86_64" ]] || die "no Linux build for $arch yet (x86_64 only)."
    platform="linux-$arch"
    INSTALL_DIR="${FLOAT_INSTALL_DIR:-$HOME/.local/bin}"
    TARGET="$INSTALL_DIR/float"
    DESKTOP="$HOME/.local/share/applications/float.desktop"
    ICON="$HOME/.local/share/icons/hicolor/128x128/apps/float.png"
    ;;
  *) die "float supports macOS and Linux." ;;
esac
command -v curl >/dev/null || die "curl is required."
sha_tool() { if [[ "$os" == "darwin" ]]; then shasum -a 256 "$1"; else sha256sum "$1"; fi; }

# Quit a float running from the install location (never touches other copies, e.g. dev builds).
quit_running() {
  if [[ "$os" == "darwin" ]]; then
    pkill -f "$TARGET/Contents/MacOS/float" 2>/dev/null && sleep 1 || true
  else
    pkill -f "^$TARGET" 2>/dev/null && sleep 1 || true
  fi
}

if [[ "$UNINSTALL" == "1" ]]; then
  [[ -e "$TARGET" ]] || { echo "float is not installed in $INSTALL_DIR"; exit 0; }
  quit_running
  rm -rf "$TARGET"
  if [[ "$os" == "linux" ]]; then rm -f "${DESKTOP:-}" "${ICON:-}"; fi
  echo "==> Removed $TARGET"
  echo "    Your sign-in, lyrics cache and settings are kept in:"
  if [[ "$os" == "darwin" ]]; then
    echo "    ~/Library/Application Support/dev.float.lyrics (delete it to remove everything)"
  else
    echo "    ~/.local/share/dev.float.lyrics and ~/.config/dev.float.lyrics (delete them to remove everything)"
  fi
  exit 0
fi

# ---- manifest: version, asset name, checksum ----
if [[ "$VERSION" == "latest" ]]; then
  base="$RELEASES/latest/download"
else
  base="$RELEASES/download/v$VERSION"
fi
manifest="$(curl -fsSL "$base/manifest.json")" || die "could not download $base/manifest.json"

# jq when available, otherwise a small bash extractor. Both read the per-platform block, falling back
# to the flat fields (manifests before multi-platform support were macOS-only).
field() {
  local key="$1" json block re
  if command -v jq >/dev/null; then
    jq -r --arg p "$platform" --arg k "$key" '(.platforms[$p][$k] // .[$k]) // empty' <<<"$manifest"
    return 0
  fi
  json="$(tr -d '\n\r\t' <<<"$manifest")"
  block=""
  if [[ "$json" == *"\"$platform\""* ]]; then
    block="${json#*\"$platform\"}"
    block="${block%%\}*}"
  fi
  re="\"$key\"[[:space:]]*:[[:space:]]*\"?([^\",}]*)"
  if [[ -n "$block" && "$block" =~ $re ]]; then
    echo "${BASH_REMATCH[1]}"
  elif [[ "$json" =~ $re ]]; then # keys that live at the top level (version), or older flat manifests
    echo "${BASH_REMATCH[1]}"
  fi
  return 0
}
version="$(field version)"
asset="$(field asset)"
checksum="$(field sha256)"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+ ]] || die "manifest has no valid version (got: ${version:-nothing})."
[[ -n "$asset" ]] || die "this release has no build for $platform."
[[ "$asset" =~ ^[A-Za-z0-9._-]+$ ]] || die "manifest has an invalid asset name."
[[ "$checksum" =~ ^[a-f0-9]{64}$ ]] || die "manifest has no valid SHA-256 for $platform."

# ---- download + verify ----
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
echo "==> Downloading float $version ($platform)"
curl -fL --progress-bar -o "$tmp/$asset" "$base/$asset" || die "download failed: $base/$asset"
actual="$(sha_tool "$tmp/$asset" | cut -d' ' -f1)"
[[ "$actual" == "$checksum" ]] || die "checksum verification failed (expected $checksum, got $actual)."
echo "==> Checksum verified"

# ---- install ----
mkdir -p "$INSTALL_DIR"
quit_running
if [[ "$os" == "darwin" ]]; then
  ditto -x -k "$tmp/$asset" "$tmp/unpacked"
  [[ -d "$tmp/unpacked/float.app" ]] || die "archive does not contain float.app."
  codesign --verify --deep "$tmp/unpacked/float.app" 2>/dev/null || die "float.app signature is broken."
  rm -rf "$TARGET"
  ditto "$tmp/unpacked/float.app" "$TARGET"
else
  install -m 755 "$tmp/$asset" "$TARGET"
  # desktop entry so float shows up in the launcher (icon is optional)
  mkdir -p "$(dirname "$DESKTOP")" "$(dirname "$ICON")"
  icon_name="float"
  if ! curl -fsSL -o "$ICON" "$base/float-icon-128.png" 2>/dev/null || [[ ! -s "$ICON" ]]; then
    rm -f "$ICON"
    icon_name="" # no icon shipped with this release: the launcher falls back to a generic one
  fi
  cat > "$DESKTOP" <<EOF
[Desktop Entry]
Type=Application
Name=float
Comment=Floating synced lyrics for Spotify
Exec=$TARGET
Icon=$icon_name
Terminal=false
Categories=AudioVideo;Audio;Player;
EOF
  command -v update-desktop-database >/dev/null && update-desktop-database "$(dirname "$DESKTOP")" 2>/dev/null || true
fi
echo "==> Installed float $version to $TARGET"

echo ""
if [[ "$os" == "darwin" ]]; then
  echo "✅ Installation complete! Open it with:  open \"$TARGET\""
else
  echo "✅ Installation complete! Run it with:  float   (or find it in your launcher)"
  case ":$PATH:" in *":$INSTALL_DIR:"*) ;; *) echo "   Add $INSTALL_DIR to your PATH to run it by name." ;; esac
fi
echo "   It lives in the menu bar / tray (no Dock or taskbar icon). Hover the card and click Connect to sign in to Spotify."

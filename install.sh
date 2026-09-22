#!/usr/bin/env bash
# float installer — downloads a release, verifies its SHA-256, installs float.app.
#
#   curl -fsSL https://raw.githubusercontent.com/arvinpaundra/float/master/install.sh | bash
#   curl -fsSL …/install.sh | bash -s -- 0.1.0        # a specific version
#   curl -fsSL …/install.sh | bash -s -- --uninstall
#
# Env overrides: FLOAT_INSTALL_DIR (default ~/Applications), FLOAT_RELEASES (release base URL).
set -euo pipefail

REPO="arvinpaundra/float"
RELEASES="${FLOAT_RELEASES:-https://github.com/$REPO/releases}"
INSTALL_DIR="${FLOAT_INSTALL_DIR:-$HOME/Applications}"
APP="$INSTALL_DIR/float.app"
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

# Everything goes under $HOME; with sudo it would land in root's home instead of yours.
if [[ "$(id -u)" -eq 0 && -n "${SUDO_USER:-}" && "$SUDO_USER" != "root" ]]; then
  die "do not run this installer with sudo — float installs into your home folder ($INSTALL_DIR)."
fi

# Quit a float that runs from the install location (never touches other copies, e.g. dev builds).
quit_running() {
  pkill -f "$APP/Contents/MacOS/float" 2>/dev/null && sleep 1 || true
}

if [[ "$UNINSTALL" == "1" ]]; then
  [[ -d "$APP" ]] || { echo "float is not installed in $INSTALL_DIR"; exit 0; }
  quit_running
  rm -rf "$APP"
  echo "==> Removed $APP"
  echo "    Your sign-in, lyrics cache and settings are kept in:"
  echo "    ~/Library/Application Support/dev.float.lyrics (delete it to remove everything)"
  exit 0
fi

# ---- platform ----
[[ "$(uname -s)" == "Darwin" ]] || die "float is a macOS app."
case "$(uname -m)" in
  arm64|x86_64) ;;
  *) die "unsupported architecture: $(uname -m)" ;;
esac
macos_major="$(sw_vers -productVersion | cut -d. -f1)"
(( macos_major >= MIN_MACOS )) || die "float needs macOS $MIN_MACOS or newer (this Mac has $(sw_vers -productVersion))."
command -v curl >/dev/null || die "curl is required."
command -v shasum >/dev/null || die "shasum is required."

# ---- manifest: version, asset name, checksum ----
if [[ "$VERSION" == "latest" ]]; then
  base="$RELEASES/latest/download"
else
  base="$RELEASES/download/v$VERSION"
fi

manifest="$(curl -fsSL "$base/manifest.json")" || die "could not download $base/manifest.json"

# jq when available, otherwise a small bash extractor (flat JSON written by scripts/release.sh)
field() {
  if command -v jq >/dev/null; then
    jq -r --arg k "$1" '.[$k] // empty' <<<"$manifest"
  else
    local json re
    json="$(tr -d '\n\r\t' <<<"$manifest")"
    re="\"$1\"[[:space:]]*:[[:space:]]*\"?([^\",}]*)"
    [[ "$json" =~ $re ]] && echo "${BASH_REMATCH[1]}"
  fi
}
version="$(field version)"
asset="$(field asset)"
checksum="$(field sha256)"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+ ]] || die "manifest has no valid version (got: ${version:-nothing})."
[[ "$asset" =~ ^[A-Za-z0-9._-]+\.zip$ ]] || die "manifest has no valid asset name."
[[ "$checksum" =~ ^[a-f0-9]{64}$ ]] || die "manifest has no valid SHA-256."

# ---- download + verify ----
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
echo "==> Downloading float $version"
curl -fL --progress-bar -o "$tmp/$asset" "$base/$asset" || die "download failed: $base/$asset"
actual="$(shasum -a 256 "$tmp/$asset" | cut -d' ' -f1)"
[[ "$actual" == "$checksum" ]] || die "checksum verification failed (expected $checksum, got $actual)."
echo "==> Checksum verified"

ditto -x -k "$tmp/$asset" "$tmp/unpacked"
[[ -d "$tmp/unpacked/float.app" ]] || die "archive does not contain float.app."
codesign --verify --deep "$tmp/unpacked/float.app" 2>/dev/null || die "float.app signature is broken."

# ---- install ----
mkdir -p "$INSTALL_DIR"
quit_running
rm -rf "$APP"
ditto "$tmp/unpacked/float.app" "$APP"
echo "==> Installed float $version to $APP"

echo ""
echo "✅ Installation complete! Open it with:  open \"$APP\""
echo "   It lives in the menu bar (no Dock icon). Hover the card and click Connect to sign in to Spotify."

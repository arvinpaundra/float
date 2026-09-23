#!/usr/bin/env bash
# Write the release manifest install.sh reads: scripts/manifest.sh <version> <file>... > manifest.json
#
# The platform of each file comes from its name (…darwin-universal.zip, …linux-x86_64.AppImage).
# The darwin entry is also repeated as flat top-level fields, so installers from before multi-platform
# support keep updating.
set -euo pipefail

version="${1:?usage: manifest.sh <version> <file>...}"
shift
[[ $# -gt 0 ]] || { echo "manifest.sh: no files given" >&2; exit 2; }

sha_of() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
size_of() { if stat -f%z "$1" >/dev/null 2>&1; then stat -f%z "$1"; else stat -c%s "$1"; fi; }

entries=""
darwin=""
for f in "$@"; do
  name="$(basename "$f")"
  case "$name" in
    *darwin-universal.zip) platform="darwin-universal" ;;
    *linux-x86_64.AppImage) platform="linux-x86_64" ;;
    *) continue ;; # dmg, icons and anything else are published but not installed from
  esac
  sha="$(sha_of "$f")"
  size="$(size_of "$f")"
  entries+="${entries:+,}
    \"$platform\": { \"asset\": \"$name\", \"sha256\": \"$sha\", \"size\": $size }"
  [[ "$platform" == "darwin-universal" ]] && darwin="\"asset\": \"$name\",
  \"sha256\": \"$sha\",
  \"size\": $size,
"
done
[[ -n "$entries" ]] || { echo "manifest.sh: none of the files look like a float build" >&2; exit 1; }

cat <<EOF
{
  "version": "$version",
  ${darwin}"minimumSystemVersion": "14.0",
  "platforms": {${entries}
  }
}
EOF

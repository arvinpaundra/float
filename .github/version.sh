#!/usr/bin/env bash
# The release version: the tag that triggered the run, else the latest tag (manual runs).
# Nothing in the repo stores a version — tauri.conf.json, package.json and Cargo.toml hold 0.0.0.
set -euo pipefail
version="${GITHUB_REF_NAME:-}"
case "$version" in
  v[0-9]*) ;;                                  # tag run
  *) version="$(git describe --tags --abbrev=0 2>/dev/null || echo v0.0.0)" ;;
esac
version="${version#v}"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+ ]] || { echo "not a version: $version" >&2; exit 1; }
echo "$version"

# float — dev workflow. Plain `make` = build the UI bundle, then run the app.
SHELL := /bin/bash

UI  := ui
APP := tauri

.PHONY: run build ui-build check-env test typecheck watch install clean

## Default: UI bundle + cargo run.
run: ui-build
	cd $(APP) && cargo run

## UI bundle + app binary (no launch).
build: ui-build
	cd $(APP) && cargo build

## The Spotify Client ID is inlined into the bundle from .env (see .env.example).
check-env:
	@grep -qE '^SPOTIFY_CLIENT_ID=.+' .env 2>/dev/null || \
		{ echo "Missing SPOTIFY_CLIENT_ID in .env — copy .env.example to .env and fill it in."; exit 1; }

## Bundle ui/ts → ui/src/js/main.js.
ui-build: check-env
	cd $(UI) && bun run build

## Rebuild the bundle on every change.
watch: check-env
	cd $(UI) && bun run watch

test:
	cd $(UI) && bun test ts

typecheck:
	cd $(UI) && bun run typecheck

install:
	cd $(UI) && bun install

clean:
	rm -rf $(APP)/target $(UI)/node_modules $(UI)/src/js

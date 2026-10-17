# KeyCount (Tauri agent)

A small desktop agent that counts keystrokes and mouse clicks (never what you type), keeps the numbers in a local SQLite file, and syncs them to the KeyCount backend. It sits in the tray, can start at login, and has a lightweight window for signing in and checking status.

It reads and writes the same database as the Python agent (`agent.py`), so an existing registration and history carry over. **Do not run both agents at the same time:** counts would double and both want port 8787.

## What it does

- Counts key presses by key name and app, mouse clicks, and mouse distance, in one-minute buckets.
- Syncs every 60 seconds once signed in.
- Serves per-key counts on `127.0.0.1:8787` for the dashboard (access code shown in the window).
- Closing the window hides it to the tray. Quit from the tray menu.
- "Start when I sign in" is off until you switch it on.

## Permissions

- macOS: Input Monitoring (System Settings, Privacy & Security). Turn it on, then quit and reopen the app.
- Windows: none needed.

## Develop

    cd src-tauri
    cargo test            # core logic
    cargo tauri dev       # needs: cargo install tauri-cli --version "^2" --locked
    cargo tauri build     # installers in src-tauri/target/release/bundle

Layout: `src-tauri/src/` holds the Rust code (`tracker`, `store`, `sync`, `keys_server`, `hooks/` for the per-OS listeners, `appdetect`), and `src/index.html` is the whole window UI.

Releases are built by `.github/workflows/release-tauri.yml` when a `v*` tag is pushed, producing `KeyCount_vX.Y.Z.exe` and `KeyCount_vX.Y.Z.dmg`.

# KeyCount

A keystroke/activity tracker: a background agent that tracks your typing
locally, a backend that syncs and stores it, and a monkeytype-style
dashboard to look at it. This file covers **running the whole thing
together** — see `backend/README.md`, `web/README.md`, and
`tauri/README.md` for the deeper docs on each piece.

## The pieces

| Piece | What it is | Command | Where |
|---|---|---|---|
| **Agent (Python)** | The original agent. Tracks keystrokes/clicks locally, optionally syncs them | `python3 agent.py` | this folder |
| **Agent (Tauri/Rust)** | Newer agent, same local DB/API, tray + autostart instead of a terminal window | `cargo tauri dev` | `tauri/src-tauri/` |
| **Backend** | Go API + Postgres — stores synced data, serves stats | `go run .` | `backend/` |
| **Dashboard** | The web UI (Today/History/Keys views) | `npm run dev` | `web/` |

These are separate, long-running processes — you run each in its own
terminal tab, and they talk to each other over HTTP on `localhost`. None
of them starts the others automatically.

## Two agents, pick one

KeyCount has two agent implementations. **Run only one at a time** — they
share the same local SQLite file and schema (registration, token, and
history carry over between them) and both bind `127.0.0.1:8787`, so
running both at once double-counts your keystrokes and fights over that
port.

- **`agent.py` (Python)** — the original, most-tested agent. Runs in a
  terminal window, prints a live count. This is the one the rest of this
  README defaults to, and the one with packaged release builds (see
  "Get a packaged build" below).
- **`tauri/` (Rust/Tauri)** — the newer agent: lives in the tray
  instead of a terminal, has an actual window for sign-in/status, and can
  start at login. Same tracking logic and local API underneath. As of
  now it's verified on Linux (build, tests, local API) and type-checks
  against the real macOS APIs, but real keyboard/mouse hooks, the tray
  icon, autostart, and installers haven't been verified on an actual Mac
  or Windows machine yet — treat it as the one to develop against, not
  yet the one to rely on day to day.

If you just want KeyCount working reliably right now, use `agent.py`
below. If you're working on the agent itself, use the Tauri one.

## Running everything (first time)

Open three terminal tabs in this folder.

**Terminal 1 — backend** (must be running before the agent syncs or the
dashboard loads any data):

```bash
cd backend
cp .env.example .env          # first time only
# edit .env: set JWT_SECRET (openssl rand -hex 32) and DATABASE_URL
set -a; source .env; set +a
go mod tidy                   # first time only
go run .
```

Leave this running. You should see `KeyCount backend listening on :8080`.
Full Postgres setup steps are in `backend/README.md` if you haven't
created the database yet.

**Terminal 2 — dashboard:**

```bash
cd web
npm install                   # first time only
npm run dev
```

Leave this running too. It prints a URL (usually `http://localhost:5173`)
— open that in your browser. You'll land on a sign-in screen; sign up
there the first time (this creates the same kind of account
`agent.py --register` would).

**Terminal 3 — agent.** Pick one of the two:

Python agent:

```bash
python3 agent.py --register   # first time only, links this machine
python3 agent.py              # normal run: tracks + auto-syncs every 60s
```

Tauri agent (needs Rust and the Tauri CLI — see `tauri/README.md`):

```bash
cd tauri/src-tauri
cargo tauri dev
```

It opens a small window to sign in (same account, same `--register`
flow but through the UI), then minimizes to the tray and keeps tracking
in the background.

`--register` (or the Tauri sign-in window) asks for the email/password of
the account you just signed up with in the browser, or creates a new one,
and links this machine to it. After that, the agent tracks your activity
and pushes it to the backend automatically — refresh the dashboard after
a few minutes (or, for the Python agent, run `python3 agent.py --sync-now`
in a spare terminal to push immediately) and it should show up.

## Do you need all three every time?

No — depends on what you're doing:

- **Just want to see the tracker work, no dashboard:** `python3 agent.py`
  (or `cargo tauri dev`) alone. The Python agent prints your live count
  to the terminal; the Tauri one shows it in its window. No backend
  needed.
- **Want to browse your stats in the dashboard:** you need the backend
  and the dashboard running (terminals 1 and 2). The agent only needs to
  be running when you actually want new data collected/synced — old
  synced data stays in Postgres and the dashboard will show it regardless
  of whether the agent is currently running.
- **Just poking at the API with curl:** backend alone (terminal 1).

Once everything's registered, day-to-day is usually: leave the backend
running (or start it when you sit down to work), run the agent while you
work, and open the dashboard whenever you want to look at it.

## What the agent does

- Hooks global keyboard + mouse events (Python agent via `pynput`; Tauri
  agent via its own per-OS listeners — see `tauri/README.md`).
- **Never logs actual key characters** — only counts, coarse categories
  (letter / digit / symbol / modifier / backspace / enter), and timing.
- Buckets events per minute into a local SQLite DB (`keycount.db`).
- Detects idle periods (default 60s of no input) and opens/closes
  `sessions` rows accordingly.
- Best-effort foreground-app detection, so the dashboard can break totals
  down by app. Falls back to `"unknown"` where it isn't available.
- Serves per-key counts over a tiny local-only HTTP API on
  `127.0.0.1:8787` (gated behind a per-device access code) for the
  dashboard's Keys tab.

## Get a packaged build

Prebuilt macOS and Windows binaries of the **Python agent** are published
on the [GitHub Releases page](https://github.com/Yonugy/KeyCount/releases),
and linked from the website's `/download` page
(`web/src/components/DownloadPage.tsx`). Built by
`.github/workflows/release.yml` from `keycount-agent.spec` (PyInstaller)
whenever a `v*` tag is pushed — no Python install needed, just download
and run. They're unsigned/not notarized, so your OS will warn before
opening one the first time.

No packaged Linux build for the Python agent — running from source
(below) is the only path there for now.

The **Tauri agent** is built by `.github/workflows/release-tauri.yml`
whenever a `tauri-v*` tag is pushed (or run manually from the Actions
tab). It produces Windows and macOS (Apple silicon and Intel) installers
and attaches them to a pre-release on the Releases page, so it never
replaces the "latest" Python agent downloads. To build locally instead,
use `cargo tauri build` (installers land in
`tauri/src-tauri/target/release/bundle/`).

## Requirements

**For the backend and dashboard (needed either way):**
- Go 1.22+ and Postgres (for the backend — see `backend/README.md`)
- Node 18+ (for the dashboard — see `web/README.md`)

**For the Python agent:**
- Python 3.9+, `pip install pynput`
- macOS, for per-app detection: `pip install pyobjc-framework-Quartz`
  (skip it and app detection just always reports `"unknown"` — keystroke/
  click counting still works fine without it)
- Windows, for per-app detection: `pip install pywin32` (same deal —
  optional, skip it and apps just show as `"unknown"`)

**For the Tauri agent:**
- Rust (stable) and `cargo install tauri-cli --version "^2" --locked`
- See `tauri/README.md` for per-OS build dependencies

**Either agent, on macOS:** the first run will prompt for **Accessibility**
and/or **Input Monitoring** permission (for your terminal/VS Code with the
Python agent, or for the KeyCount app itself with the Tauri agent) —
required for the global input hook to work. After granting Input
Monitoring for the Tauri agent, quit and reopen it.

## Running the agent alone

If you just want to validate tracking with no backend/dashboard:

```bash
pip install pynput
python3 agent.py
```

Ctrl+C to stop (flushes the current bucket and closes the open session
before exiting). The Tauri agent works the same way standalone, just
`cargo tauri dev` from `tauri/src-tauri/` with no backend running
— it'll just fail to sync, which is fine for trying out local tracking.

## Per-key stats (local-only, opt-in)

The agent also tracks **which physical key** was pressed and how many
times (e.g. "a: 4201, space: 3890, backspace: 512...") — beyond the
letter/digit/symbol categories the base design doc calls for.

This is a deliberate exception to the design doc's default stance ("never
store which key was pressed"), so it comes with extra guardrails:

- Stored in its own `key_counts` table in `keycount.db`, separate from
  `events_buffer`.
- **Local-only.** It is never marked `synced`, never part of the sync
  schema, and must not be wired into the ingest job.
- No sequence or word is ever reconstructable from it — just per-key
  totals.
- Python agent: turn it off by setting `TRACK_PER_KEY = False` near the
  top of `agent.py`.

View your local key leaderboard any time without starting the tracker
(Python agent):

```bash
python3 agent.py --show-keys          # top 10
python3 agent.py --show-keys --top 25 # top 25
```

The Python tracker also prints your top 10 keys automatically when you
stop it with Ctrl+C.

**Or see it in the dashboard's "Keys" tab.** While either agent is
running, it serves this same data over the local-only HTTP server on
`http://localhost:8787` — bound to `127.0.0.1`, so it's never reachable
over the network, only from a browser on this same machine, and gated
behind a random per-device access code so no other local webpage can
quietly read it either. Get your code with (Python agent):

```bash
python3 agent.py --show-local-token
```

(The Tauri agent shows its code in its window.) Paste it into the Keys
tab once; the dashboard remembers it after that (stored in your browser,
not synced anywhere). This is also why the Keys tab only ever shows
*this* device's data, on purpose — if you open the same dashboard on a
machine with no agent running, or a different computer's agent, that tab
just won't have anything to show.

## Syncing to the backend

Covered above in "Running everything," but in short: `python3 agent.py
--register` (or the Tauri agent's sign-in window) links this machine once
(asks for email/password, saves a device token — never your password —
in `keycount.db`). The Python agent targets `http://localhost:8080` by
default; pass `--url` to point elsewhere.

Once registered, the Python agent auto-syncs every 60 seconds (change
`SYNC_INTERVAL_S` near the top of `agent.py` for a different cadence) and
once more on shutdown. It's safe to interrupt or lose network mid-sync —
re-sending an already-ingested bucket is a no-op on the backend, so
nothing double-counts. The Tauri agent syncs on the same 60-second cadence
once signed in.

```bash
python3 agent.py --sync-now   # push right now without waiting
```

`key_counts` (the per-key breakdown) is never part of what gets synced —
see the "Per-key stats" section above.

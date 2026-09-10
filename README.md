# KeyCount

A keystroke/activity tracker: a background agent that tracks your typing
locally, a backend that syncs and stores it, and a monkeytype-style
dashboard to look at it. This file covers **running the whole thing
together** — see `backend/README.md` and `web/README.md` for the deeper
docs on each piece.

## The three pieces

| Piece | What it is | Command | Where |
|---|---|---|---|
| **Agent** | Tracks your keystrokes/clicks locally, optionally syncs them | `python3 agent.py` | this folder |
| **Backend** | Go API + Postgres — stores synced data, serves stats | `go run .` | `backend/` |
| **Dashboard** | The web UI (Today/History views) | `npm run dev` | `web/` |

They're three separate, long-running processes — you run each in its own
terminal tab, and they talk to each other over HTTP on `localhost`. None
of them starts the others automatically.

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
there the first time (this creates the same kind of account `agent.py
--register` would).

**Terminal 3 — agent:**

```bash
python3 agent.py --register   # first time only, links this machine
python3 agent.py              # normal run: tracks + auto-syncs every 60s
```

`--register` asks for the email/password of the account you just signed
up with in the browser (or creates a new one) and links this Mac to it.
After that, plain `python3 agent.py` tracks your activity and pushes it to
the backend automatically — refresh the dashboard after a few minutes (or
run `python3 agent.py --sync-now` in a spare terminal to push
immediately) and it should show up.

## Do you need all three every time?

No — depends on what you're doing:

- **Just want to see the tracker work, no dashboard:** `python3 agent.py`
  alone. It prints your live count to the terminal. No backend needed.
- **Want to browse your stats in the dashboard:** you need the backend
  and the dashboard running (terminals 1 and 2). The agent only needs to
  be running when you actually want new data collected/synced — old
  synced data stays in Postgres and the dashboard will show it regardless
  of whether `agent.py` is currently running.
- **Just poking at the API with curl:** backend alone (terminal 1).

Once everything's registered, day-to-day is usually: leave the backend
running (or start it when you sit down to work), run `agent.py` while you
work, and open the dashboard whenever you want to look at it.

## What it does (the agent)

- Hooks global keyboard + mouse events (via `pynput`).
- **Never logs actual key characters** — only counts, coarse categories
  (letter / digit / symbol / modifier / backspace / enter), and timing.
- Buckets events per minute into a local SQLite DB (`keycount.db`).
- Detects idle periods (default 60s of no input) and opens/closes
  `sessions` rows accordingly.
- Best-effort foreground-app detection on macOS (via `pyobjc`/Quartz --
  queries the window server directly rather than AppKit's
  `NSWorkspace.frontmostApplication`, which needs an active Cocoa run
  loop to stay up to date and this script doesn't run one; an earlier
  version used that and it froze on whichever app was frontmost around
  startup), falls back to `"unknown"` elsewhere.
- Prints a live "today" keystroke/click count to the terminal every 5s.

## Requirements

- Python 3.9+, `pip install pynput`
- macOS, for per-app detection: `pip install pyobjc-framework-Quartz`
  (skip it and app detection just always reports `"unknown"` -- keystroke/
  click counting still works fine without it)
- Go 1.22+ and Postgres (for the backend — see `backend/README.md`)
- Node 18+ (for the dashboard — see `web/README.md`)
- macOS: the agent's first run will prompt for **Accessibility** and/or
  **Input Monitoring** permission for your terminal / VS Code — required
  for the global input hook to work.

## Running the agent alone

If you just want to validate tracking with no backend/dashboard:

```bash
pip install pynput
python3 agent.py
```

Ctrl+C to stop (flushes the current bucket and closes the open session
before exiting).

## Next steps

- Swap the terminal print for a real tray icon (`rumps` on macOS, or move
  the whole agent to the Tauri/Rust stack the design doc recommends for
  cross-platform).
- Add the excluded-apps list and a pause toggle.
- Phase 4: friendships, opt-in public profiles, leaderboards — see
  `ROADMAP.md`.

## Per-key stats (local-only, opt-in)

`agent.py` also tracks **which physical key** was pressed and how many
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
- Turn it off by setting `TRACK_PER_KEY = False` near the top of
  `agent.py`.

View your local key leaderboard any time without starting the tracker:

```bash
python3 agent.py --show-keys          # top 10
python3 agent.py --show-keys --top 25 # top 25
```

The tracker also prints your top 10 keys automatically when you stop it
with Ctrl+C.

**Or see it in the dashboard's "Keys" tab.** While `python3 agent.py` is
running, it also serves this same data over a tiny local-only HTTP server
on `http://localhost:8787` -- bound to `127.0.0.1`, so it's never reachable
over the network, only from a browser on this same machine. It's also
gated behind a random per-device access code so no other local webpage can
quietly read it either. Get your code with:

```bash
python3 agent.py --show-local-token
```

Paste it into the Keys tab once; the dashboard remembers it after that
(stored in your browser, not synced anywhere). This is also why the Keys
tab only ever shows *this* device's data, on purpose -- if you open the
same dashboard on a machine with no agent running, or a different
computer's agent, that tab just won't have anything to show.

## Syncing to the backend

Covered above in "Running everything," but in short: `python3 agent.py
--register` links this machine once (asks for email/password, saves a
device token — never your password — in `keycount.db`). By default it
targets `http://localhost:8080`; pass `--url` to point elsewhere.

Once registered, normal `python3 agent.py` runs auto-sync every 60 seconds
(change `SYNC_INTERVAL_S` near the top of `agent.py` if you want a different
cadence)
and once more on shutdown. It's safe to interrupt or lose network
mid-sync — re-sending an already-ingested bucket is a no-op on the
backend, so nothing double-counts.

```bash
python3 agent.py --sync-now   # push right now without waiting
```

`key_counts` (the per-key breakdown) is never part of what gets synced —
see the "Per-key stats" section above.

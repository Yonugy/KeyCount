#!/usr/bin/env python3
"""
KeyCount Agent -- MVP starter.

Validates the riskiest piece of the KeyCount system design (global OS-level
input hooks) with a minimal, privacy-respecting local tracker. Matches the
SQLite schema described in architecture/keycount-system-design.md so this
can grow into the real agent later.

Never logs actual key characters as TEXT/content (no words, no sequences).
The `events_buffer` table (the one that syncs to the backend, see the
"Syncing to the backend" section in README.md) only ever stores counts and
coarse categories.

PRIVACY NOTE -- per-key frequency tracking (`key_counts` table below) is a
deliberate exception, added on top of the design doc's stricter default.
It records which physical key was pressed and how many times, but:
  - it is LOCAL-ONLY, stored in this machine's SQLite file only
  - it is intentionally NOT part of events_buffer/sessions/settings
  - it must NEVER be wired into the sync/ingest call to the backend
Keep this separation if you extend the sync job further.

The one exception to "local-only never leaves this file" is the local
keys API below (`start_local_keys_server`), which serves this same data
over HTTP -- but only to a browser running on this same machine (bound to
127.0.0.1, never the network), and only if it presents this device's
random access token. See the "Per-key stats" section in README.md.
"""

import argparse
import getpass
import json
import ntpath
import platform
import re
import secrets
import sqlite3
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

try:
    from pynput import keyboard, mouse
except ImportError:
    sys.exit("Missing dependency. Install it with:\n\n    pip install pynput\n")

# --- config -----------------------------------------------------------

# Where the agent lives, for the DB file to sit next to. Not simply
# Path(__file__).parent -- under a PyInstaller onefile build (sys.frozen),
# __file__ points into a fresh temp extraction folder that gets deleted
# when the process exits, so a DB there would silently reset on every
# run. sys.executable is the actual binary's stable path in that case;
# __file__ stays correct for running the script directly from source.
if getattr(sys, "frozen", False):
    _APP_DIR = Path(sys.executable).parent
else:
    _APP_DIR = Path(__file__).parent
DB_PATH = _APP_DIR / "keycount.db"
FLUSH_INTERVAL_S = 60          # roll the in-memory bucket to disk every minute
PRINT_INTERVAL_S = 5           # refresh the terminal "today" count this often
IDLE_THRESHOLD_S = 60          # no input for this long ends the session
SYNC_INTERVAL_S = 60           # how often to push unsynced buckets to the backend
TRACK_PER_KEY = True           # local-only per-key counts -- see PRIVACY NOTE above
DEBUG_PRINT_KEYS = True        # print each (key, app) live to the terminal -- flip off once you're done debugging, it's noisy
APP_SAMPLE_MIN_INTERVAL_S = 0.1  # per-key app sampling throttle -- see Agent._sample_app
LOCAL_API_PORT = 8787          # dashboard's "Keys" tab talks to this, localhost-only


# --- foreground app detection (best-effort: macOS via pyobjc, Windows
# via pywin32, added 2026-09-14 -- falls back to "unknown" everywhere
# else, e.g. Linux, same as it always has for a platform with no branch
# here yet) -------------------------------------------------------------

def get_foreground_app() -> str:
    """Which app currently has focus, best-effort. Dispatches to a
    per-OS helper below -- see each one's own docstring for the
    platform-specific mechanics. A platform with no branch here (Linux,
    for now) just gets "unknown", the same fallback both branches
    themselves use if their own OS-specific call fails for any reason
    (missing optional dependency, permissions, anything else).
    """
    if sys.platform == "darwin":
        return _foreground_app_macos()
    if sys.platform == "win32":
        return _foreground_app_windows()
    return "unknown"


def _foreground_app_macos() -> str:
    """Deliberately NOT NSWorkspace.frontmostApplication() (an earlier
    version used that) -- that property is kept fresh by macOS sending
    app-activation notifications, which requires an active Cocoa run loop
    to receive. This script never runs one (it's a plain `while: sleep`
    loop, no NSApplication), so that property likely only ever reflects
    whatever was frontmost around process startup and then stays frozen
    -- which is exactly the "everything shows as whatever app I started
    the agent from" symptom this replaces.

    Asking the window server directly (Quartz) instead is a synchronous,
    one-shot query with no caching to go stale: walk the on-screen window
    list (already frontmost-to-backmost order) and take the owner of the
    first real app window (layer 0 -- skips the menu bar, Dock, etc).

    Requires pyobjc-framework-Quartz (`pip install pyobjc-framework-
    Quartz`) -- optional: keystroke/click counting works fine without
    it, this just returns "unknown" if the import fails.
    """
    try:
        import Quartz
        windows = Quartz.CGWindowListCopyWindowInfo(
            Quartz.kCGWindowListOptionOnScreenOnly | Quartz.kCGWindowListExcludeDesktopElements,
            Quartz.kCGNullWindowID,
        )
        for w in windows:
            if w.get("kCGWindowLayer", -1) == 0:
                return w.get("kCGWindowOwnerName") or "unknown"
        return "unknown"
    except Exception:
        return "unknown"


def _foreground_app_windows() -> str:
    """Added 2026-09-14 -- this used to be macOS-only (see the web app's
    Download page, which documented that gap until this shipped).

    GetForegroundWindow() is a synchronous, always-current query, the
    same "no caching to go stale" property the macOS Quartz path above
    relies on, just via the Win32 API instead of the window server:
    the HWND currently holding input focus, its owning process id via
    GetWindowThreadProcessId, then that process's own executable path
    resolved through OpenProcess + GetModuleFileNameEx. Only the file's
    base name is kept, without the .exe extension, to read the same way
    macOS's app names do -- "chrome", not the full
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" path.

    Requires pywin32 (`pip install pywin32`) -- optional, same deal as
    pyobjc-framework-Quartz on macOS: keystroke/click counting works
    fine without it, this just returns "unknown" if the import or any
    step of the lookup fails.

    Uses `ntpath.basename` rather than `os.path.basename` on purpose --
    this always parses a Windows-style backslash path (that's what
    GetModuleFileNameEx returns), regardless of which OS the interpreter
    itself is running on, `os.path` only behaves that way when the
    interpreter is actually on Windows. Since this function only ever
    runs from the `sys.platform == "win32"` branch above, the two are
    equivalent in real use, but the explicit `ntpath` import is what let
    this get a real logic test (mocked win32 modules, real path parsing)
    in this project's Linux sandbox rather than just an import-error
    fallback check.

    Written against the documented Win32 API and exercised that way --
    mocked win32api/win32con/win32gui/win32process modules standing in
    for the real ones -- but not yet run against a real Windows machine
    end to end. Flagged here deliberately rather than silently assumed
    correct. Worth a real test pass on actual Windows hardware before
    leaning on it.
    """
    try:
        import win32api
        import win32con
        import win32gui
        import win32process

        hwnd = win32gui.GetForegroundWindow()
        if not hwnd:
            return "unknown"
        _, pid = win32process.GetWindowThreadProcessId(hwnd)
        if not pid:
            return "unknown"
        handle = win32api.OpenProcess(
            win32con.PROCESS_QUERY_INFORMATION | win32con.PROCESS_VM_READ, False, pid
        )
        try:
            exe_path = win32process.GetModuleFileNameEx(handle, 0)
        finally:
            win32api.CloseHandle(handle)
        name = ntpath.basename(exe_path)
        if name.lower().endswith(".exe"):
            name = name[:-4]
        return name or "unknown"
    except Exception:
        return "unknown"


# --- key classification (never the actual TEXT content) ----------------

def classify_key(key) -> str:
    try:
        char = key.char
    except AttributeError:
        char = None

    if char is not None:
        if char.isalpha():
            return "letter"
        if char.isdigit():
            return "digit"
        return "symbol"

    name = getattr(key, "name", "")
    if name == "backspace":
        return "backspace"
    if name == "enter":
        return "enter"
    return "modifier"


def key_identity(key) -> str:
    """A stable, physical-key label -- e.g. 'a', '1', '/', 'space', 'shift'.
    Still not "content": no sequence or word is ever reconstructable from
    this, just which single key was pressed. Letters are lowercased so
    Shift+A and A count as the same physical key."""
    try:
        char = key.char
    except AttributeError:
        char = None

    if char is not None:
        return char.lower()

    return getattr(key, "name", str(key))


# --- backend HTTP client (stdlib only -- no extra dependency) -----------

def http_post_json(url, payload, token=None, timeout=10):
    """POST JSON, return (status_code, parsed_body). status_code is None on
    a connection-level failure (backend unreachable), in which case
    parsed_body is {"error": "..."}."""
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")

    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8")
            return resp.status, (json.loads(body) if body else {})
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(body)
        except json.JSONDecodeError:
            parsed = {"error": body}
        return e.code, parsed
    except urllib.error.URLError as e:
        return None, {"error": str(e.reason)}


def register_with_backend(store, backend_url):
    """Interactively sign in (or sign up) and register this machine as a
    device, storing the resulting device_token locally so future runs can
    sync automatically. Never stores the password."""
    print(f"Registering with backend at {backend_url}\n")
    has_account = input("Do you already have an account on this backend? [y/N]: ").strip().lower() == "y"
    email = input("Email: ").strip()
    password = getpass.getpass("Password: ")

    if has_account:
        status, resp = http_post_json(f"{backend_url}/v1/auth/login",
                                       {"email": email, "password": password})
    else:
        username = input("Choose a username: ").strip()
        status, resp = http_post_json(f"{backend_url}/v1/auth/signup",
                                       {"email": email, "username": username, "password": password})

    if status is None:
        sys.exit(f"Could not reach {backend_url}: {resp.get('error')}")
    if status not in (200, 201):
        sys.exit(f"Login/signup failed ({status}): {resp.get('error', resp)}")

    token = resp["token"]
    print(f"Signed in as {resp.get('username')}.")

    device_name = platform.node() or "unnamed device"
    status, resp = http_post_json(
        f"{backend_url}/v1/agent/register-device",
        {"name": device_name, "platform": sys.platform},
        token=token,
    )
    if status != 201:
        sys.exit(f"Device registration failed ({status}): {resp.get('error', resp)}")

    device_token = resp["device_token"]
    store.set_setting("backend_url", backend_url)
    store.set_setting("device_token", device_token)
    print(f"\nRegistered device '{device_name}'. Syncing is now enabled.")
    print("Run `python3 agent.py` normally to start tracking + syncing.")


def sync_once(store, backend_url, device_token, limit=500):
    """One sync pass: push unsynced events_buffer rows to /v1/ingest/batch.
    Returns (count_synced, error_message_or_None). key_counts is
    deliberately never touched here -- see the PRIVACY NOTE at the top."""
    rows = store.unsynced_batch(limit)
    if not rows:
        return 0, None

    payload = [
        {
            "bucket_start_ts": r[1],
            "app_name": r[2],
            "keystrokes": r[3],
            "backspaces": r[4],
            "mouse_clicks": r[5],
            "mouse_distance_px": r[6],
            # This machine's own local calendar day for this bucket, not
            # UTC's. Without this, the backend used to derive the day by
            # converting bucket_start_ts to UTC (ingest.go), which is wrong
            # for anyone at a positive UTC offset: the first |offset| hours
            # of your local day are still "yesterday" in UTC, so activity
            # right after your local midnight got filed a day early. Only
            # this agent knows the real local clock it ran on, so it has to
            # be the one computing this -- datetime.fromtimestamp() (no tz
            # arg) converts using the system's local timezone rules,
            # including DST, same as every other local-day computation in
            # this codebase (see toLocalISODate() in web/src/utils.ts for
            # the frontend's equivalent fix to the same underlying problem).
            "local_date": datetime.fromtimestamp(r[1]).date().isoformat(),
        }
        for r in rows
    ]
    ids = [r[0] for r in rows]

    status, resp = http_post_json(f"{backend_url}/v1/ingest/batch", payload, token=device_token)
    if status == 200:
        store.mark_synced(ids)
        return resp.get("inserted", len(ids)), None

    err = resp.get("error", resp) if isinstance(resp, dict) else resp
    return 0, f"sync failed ({status}): {err}"


# --- local keys API (per-key stats, served ONLY to this same machine) ---

LOCAL_TOKEN_SETTING = "local_api_token"
# Only a browser on this machine is allowed to read the response -- never
# '*'. Extend this if you ever host the dashboard somewhere other than
# localhost.
_ALLOWED_ORIGIN_RE = re.compile(r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$")
# Loose validation for /local/apps?date= (added 2026-09-02) -- just enough
# to reject garbage before it reaches a SQL parameter, not a real calendar
# check (Feb 30 passes and simply matches zero rows, which is fine).
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def get_or_create_local_token(store) -> str:
    token = store.get_setting(LOCAL_TOKEN_SETTING)
    if not token:
        token = secrets.token_hex(16)
        store.set_setting(LOCAL_TOKEN_SETTING, token)
    return token


class LocalKeysHandler(BaseHTTPRequestHandler):
    """Serves GET /local/keys and GET /local/apps -- and nothing else --
    from key_counts. Reads self.server.store / self.server.token, set by
    start_local_keys_server() before the server starts accepting
    connections."""

    def log_message(self, *a):
        pass  # keep the terminal output to the tracker's own prints

    def _cors_headers(self):
        origin = self.headers.get("Origin", "")
        if _ALLOWED_ORIGIN_RE.match(origin):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Headers", "X-Local-Token, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors_headers()
        self.end_headers()

    def _write_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self._cors_headers()
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urllib.parse.urlsplit(self.path)
        if parsed.path not in ("/local/keys", "/local/apps"):
            self.send_response(404)
            self._cors_headers()
            self.end_headers()
            return

        if self.headers.get("X-Local-Token") != self.server.token:
            self._write_json(401, {"error": "invalid or missing local token"})
            return

        if parsed.path == "/local/apps":
            # No `top` param -- unlike /local/keys this is already a
            # per-app summary, and there are only ever as many rows as
            # there are distinct apps you've typed in (never hundreds).
            #
            # Optional ?date=YYYY-MM-DD (added 2026-09-02) -- scopes the
            # breakdown to one local calendar day instead of all time.
            # Anything that doesn't look like a real date is treated as
            # "no filter" rather than erroring, since the whole point is a
            # graceful fallback to the existing all-time behavior.
            qs = urllib.parse.parse_qs(parsed.query)
            date_param = (qs.get("date", [""])[0] or "").strip() or None
            if date_param and not _DATE_RE.match(date_param):
                date_param = None
            rows = self.server.store.app_totals(date=date_param)
            self._write_json(200, {
                "device_name": platform.node() or "this device",
                "apps": [{"app_name": a, "keystrokes": c} for a, c in rows],
            })
            return

        qs = urllib.parse.parse_qs(parsed.query)
        try:
            top_n = max(1, min(100, int(qs.get("top", ["25"])[0])))
        except ValueError:
            top_n = 25
        # Optional ?app=<name> -- filters to just that app's key counts.
        # Omitted (or empty) means "all apps combined," matching the
        # pre-app-filter behavior. `apps` is always the full distinct list
        # (regardless of the filter in effect) so the frontend can build a
        # dropdown without a second request.
        app_filter = (qs.get("app", [""])[0] or "").strip() or None
        # Optional ?date=YYYY-MM-DD (added 2026-09-02), same validation and
        # same "no filter" fallback as /local/apps above.
        date_filter = (qs.get("date", [""])[0] or "").strip() or None
        if date_filter and not _DATE_RE.match(date_filter):
            date_filter = None

        rows = self.server.store.top_keys(top_n, app=app_filter, date=date_filter)
        apps = self.server.store.known_apps()
        self._write_json(200, {
            "device_name": platform.node() or "this device",
            "apps": apps,
            "keys": [{"key": k, "count": c} for k, c in rows],
        })


def start_local_keys_server(store):
    """Bound to 127.0.0.1 ONLY -- never 0.0.0.0 -- so this is unreachable
    over the network no matter what; only a browser running on this same
    machine can even open a connection to it. The per-device token on top
    of that stops an unrelated local webpage from quietly reading it too.
    Returns the server (already running in a background thread), or None
    if the port couldn't be bound (e.g. another agent instance already
    has it)."""
    token = get_or_create_local_token(store)
    try:
        server = ThreadingHTTPServer(("127.0.0.1", LOCAL_API_PORT), LocalKeysHandler)
    except OSError as e:
        print(f"[local-keys] couldn't start local server on port {LOCAL_API_PORT}: {e}")
        return None
    server.store = store
    server.token = token
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server


# --- storage ------------------------------------------------------------

class Store:
    def __init__(self, path: Path):
        self.conn = sqlite3.connect(path, check_same_thread=False)
        self.lock = threading.Lock()
        self._migrate()

    def _migrate(self):
        with self.lock, self.conn:
            self.conn.execute("""
                CREATE TABLE IF NOT EXISTS events_buffer (
                    id INTEGER PRIMARY KEY,
                    bucket_start_ts INTEGER,
                    app_name TEXT,
                    window_title TEXT,
                    keystrokes INTEGER,
                    backspaces INTEGER,
                    mouse_clicks INTEGER,
                    mouse_distance_px INTEGER,
                    synced BOOLEAN DEFAULT 0
                )
            """)
            self.conn.execute("""
                CREATE TABLE IF NOT EXISTS sessions (
                    id INTEGER PRIMARY KEY,
                    started_at INTEGER,
                    ended_at INTEGER,
                    idle_gap_threshold_s INTEGER
                )
            """)
            self.conn.execute("""
                CREATE TABLE IF NOT EXISTS settings (
                    key TEXT PRIMARY KEY,
                    value TEXT
                )
            """)
            # Local-only. Deliberately outside the events_buffer/sessions
            # schema -- never given a `synced` column, never touched by the
            # sync job. See the PRIVACY NOTE at the top of this file.
            #
            # key_counts gained an app_name column on 2026-08-31 (each key
            # is now tagged with whichever app had focus at the moment it
            # was pressed, sampled per-keystroke -- not once a minute like
            # events_buffer -- so switching apps mid-minute doesn't smear
            # keys into the wrong app). Older installs still have the
            # key-only schema; migrate them in place rather than dropping
            # history, tagging everything collected before this change as
            # app_name='unknown' since no app was ever recorded for it.
            cols = [r[1] for r in self.conn.execute("PRAGMA table_info(key_counts)")]
            if cols and "app_name" not in cols:
                self.conn.execute("ALTER TABLE key_counts RENAME TO key_counts_old")
                self.conn.execute("""
                    CREATE TABLE key_counts (
                        key_name TEXT NOT NULL,
                        app_name TEXT NOT NULL,
                        count INTEGER NOT NULL DEFAULT 0,
                        PRIMARY KEY (key_name, app_name)
                    )
                """)
                self.conn.execute("""
                    INSERT INTO key_counts (key_name, app_name, count)
                    SELECT key_name, 'unknown', count FROM key_counts_old
                """)
                self.conn.execute("DROP TABLE key_counts_old")
                cols = [r[1] for r in self.conn.execute("PRAGMA table_info(key_counts)")]
            elif not cols:
                # Brand new install -- go straight to the current full
                # shape below rather than creating the old 3-column one
                # just to immediately re-migrate it.
                self.conn.execute("""
                    CREATE TABLE key_counts (
                        key_name TEXT NOT NULL,
                        app_name TEXT NOT NULL,
                        local_date TEXT NOT NULL,
                        count INTEGER NOT NULL DEFAULT 0,
                        PRIMARY KEY (key_name, app_name, local_date)
                    )
                """)
                cols = [r[1] for r in self.conn.execute("PRAGMA table_info(key_counts)")]

            # key_counts gained a local_date column on 2026-09-02 -- each
            # key is now tagged with the local calendar day it was pressed
            # on ("YYYY-MM-DD", from time.strftime() at press time -- this
            # agent already IS the viewer's own machine, so unlike the
            # backend's local_date/timezone split there's no separate
            # "whose clock" question here), so the Keys tab's "By app"
            # breakdown can be scoped to a specific day instead of only
            # ever an all-time sum. Older installs still have the
            # (key_name, app_name, count) shape from the app_name
            # migration above; migrate them in place, tagging everything
            # collected before this change with local_date='unknown' since
            # no day was ever recorded for it -- same tradeoff app_name's
            # own migration made for app attribution. That old data still
            # counts fully in the all-time total (Store.app_totals() with
            # no date filter); it just can't be attributed to one day.
            if cols and "local_date" not in cols:
                self.conn.execute("ALTER TABLE key_counts RENAME TO key_counts_old")
                self.conn.execute("""
                    CREATE TABLE key_counts (
                        key_name TEXT NOT NULL,
                        app_name TEXT NOT NULL,
                        local_date TEXT NOT NULL,
                        count INTEGER NOT NULL DEFAULT 0,
                        PRIMARY KEY (key_name, app_name, local_date)
                    )
                """)
                self.conn.execute("""
                    INSERT INTO key_counts (key_name, app_name, local_date, count)
                    SELECT key_name, app_name, 'unknown', count FROM key_counts_old
                """)
                self.conn.execute("DROP TABLE key_counts_old")

    def insert_bucket(self, bucket_start_ts, app_name, keystrokes, backspaces,
                       mouse_clicks, mouse_distance_px):
        if keystrokes == 0 and mouse_clicks == 0 and mouse_distance_px == 0:
            return
        with self.lock, self.conn:
            self.conn.execute(
                """INSERT INTO events_buffer
                   (bucket_start_ts, app_name, keystrokes, backspaces,
                    mouse_clicks, mouse_distance_px, synced)
                   VALUES (?, ?, ?, ?, ?, ?, 0)""",
                (bucket_start_ts, app_name, keystrokes, backspaces,
                 mouse_clicks, mouse_distance_px),
            )

    def bump_keys(self, counts: dict):
        """Local-only per-(key, app, day) upsert. `counts` is
        {(key_name, app_name, local_date): increment}."""
        if not counts:
            return
        with self.lock, self.conn:
            self.conn.executemany(
                """INSERT INTO key_counts (key_name, app_name, local_date, count) VALUES (?, ?, ?, ?)
                   ON CONFLICT(key_name, app_name, local_date) DO UPDATE SET count = count + excluded.count""",
                [(key_name, app_name, local_date, n) for (key_name, app_name, local_date), n in counts.items()],
            )

    def top_keys(self, n=10, app=None, date=None):
        """Totals per key, most-pressed first. `app`, when given, narrows
        to keys pressed while that app had focus. `date` ("YYYY-MM-DD",
        added 2026-09-02), when given, narrows to that local calendar day
        -- same day-scoping app_totals() has, same 'unknown' caveat for
        data recorded before local_date existed (see app_totals()'s own
        note). The two filters are independent and can combine (e.g. "keys
        pressed in Editor today"). Always SUM()/GROUP BY key_name: with no
        app filter, key_counts can have several rows per key (one per app,
        or one per day) that need collapsing into one total; with an app
        filter but no date, same thing across days. Only with both filters
        given is there already at most one row per key -- SUM() over a
        single row is still correct, just a no-op, so one query shape
        covers every combination without a special case."""
        where = []
        params: list = []
        if app:
            where.append("app_name = ?")
            params.append(app)
        if date:
            where.append("local_date = ?")
            params.append(date)
        where_clause = f"WHERE {' AND '.join(where)}" if where else ""
        params.append(n)
        with self.lock:
            return self.conn.execute(
                f"""SELECT key_name, SUM(count) AS total FROM key_counts
                    {where_clause} GROUP BY key_name ORDER BY total DESC LIMIT ?""",
                params,
            ).fetchall()

    def app_totals(self, date=None):
        """Total keystrokes per app, most-active first -- the local,
        per-keypress-accurate cousin of the backend's "By app" breakdown
        (see the "By app" note in web/README.md for why that one's still
        hidden: it's built on events_buffer's once-a-minute app snapshot,
        which drops any app you weren't in right when the timer fired.
        This one instead sums key_counts, which agent.py has tagged with
        the actual foreground app on every single keypress since
        2026-08-31 -- see the migration note above -- so a quick alt-tab
        mid-minute is counted correctly instead of silently smeared onto
        whichever app happened to be focused at the sample instant.

        `date` ("YYYY-MM-DD", added 2026-09-02), when given, scopes the
        sum to just that local calendar day instead of all time.
        Keystrokes recorded before local_date existed are tagged
        'unknown' (see the migration note above) and so never match a
        specific-day filter -- they only ever show up when date is
        omitted."""
        with self.lock:
            if date:
                return self.conn.execute(
                    """SELECT app_name, SUM(count) AS total FROM key_counts
                       WHERE local_date = ? GROUP BY app_name ORDER BY total DESC""",
                    (date,),
                ).fetchall()
            return self.conn.execute(
                """SELECT app_name, SUM(count) AS total FROM key_counts
                   GROUP BY app_name ORDER BY total DESC"""
            ).fetchall()

    def known_apps(self):
        """Distinct apps with at least one tracked keypress, most-active
        first -- powers the Keys tab's app filter dropdown."""
        return [app for app, _total in self.app_totals()]

    def start_session(self, started_at, idle_threshold):
        with self.lock, self.conn:
            cur = self.conn.execute(
                "INSERT INTO sessions (started_at, idle_gap_threshold_s) VALUES (?, ?)",
                (started_at, idle_threshold),
            )
            return cur.lastrowid

    def end_session(self, session_id, ended_at):
        with self.lock, self.conn:
            self.conn.execute(
                "UPDATE sessions SET ended_at = ? WHERE id = ?",
                (ended_at, session_id),
            )

    def today_totals(self, day_start_ts):
        with self.lock:
            row = self.conn.execute(
                """SELECT COALESCE(SUM(keystrokes), 0), COALESCE(SUM(mouse_clicks), 0)
                   FROM events_buffer WHERE bucket_start_ts >= ?""",
                (day_start_ts,),
            ).fetchone()
        return row

    def get_setting(self, key):
        with self.lock:
            row = self.conn.execute(
                "SELECT value FROM settings WHERE key = ?", (key,)
            ).fetchone()
        return row[0] if row else None

    def set_setting(self, key, value):
        with self.lock, self.conn:
            self.conn.execute(
                """INSERT INTO settings (key, value) VALUES (?, ?)
                   ON CONFLICT(key) DO UPDATE SET value = excluded.value""",
                (key, value),
            )

    def unsynced_batch(self, limit=500):
        with self.lock:
            return self.conn.execute(
                """SELECT id, bucket_start_ts, app_name, keystrokes, backspaces,
                          mouse_clicks, mouse_distance_px
                   FROM events_buffer WHERE synced = 0
                   ORDER BY bucket_start_ts LIMIT ?""",
                (limit,),
            ).fetchall()

    def mark_synced(self, ids):
        if not ids:
            return
        with self.lock, self.conn:
            placeholders = ",".join("?" * len(ids))
            self.conn.execute(
                f"UPDATE events_buffer SET synced = 1 WHERE id IN ({placeholders})",
                ids,
            )


# --- agent ---------------------------------------------------------------

class Agent:
    def __init__(self):
        self.store = Store(DB_PATH)
        self.counts = defaultdict(int)  # keystrokes, backspaces, mouse_clicks, mouse_distance_px
        # Per-app sub-totals within the current (not-yet-flushed) bucket --
        # added 2026-09-02 for the SYNCED per-app keystroke accuracy fix.
        # {app_name: {"keystrokes": N, "backspaces": N}}. Keyed by the same
        # per-keypress app sample _sample_app() already computes for
        # key_counts below, so a sub-minute app switch is attributed
        # correctly at sync time too, not just locally. See flush_bucket().
        self.app_counts = defaultdict(lambda: defaultdict(int))
        self.key_counts = defaultdict(int)  # local-only, per (physical key, app)
        self.bucket_lock = threading.Lock()
        self.bucket_start = self._minute_start(time.time())
        self.last_event_ts = time.time()
        self.session_id = None
        self.session_active = False
        self._last_mouse_pos = None
        self._last_app_sample = (0.0, "unknown")  # see Agent._sample_app
        self._stop = threading.Event()

        self.backend_url = self.store.get_setting("backend_url")
        self.device_token = self.store.get_setting("device_token")

    @staticmethod
    def _minute_start(ts):
        return int(ts // 60 * 60)

    @staticmethod
    def _day_start(ts):
        t = time.localtime(ts)
        return int(time.mktime((t.tm_year, t.tm_mon, t.tm_mday, 0, 0, 0, 0, 0, -1)))

    def _touch(self):
        now = time.time()
        self.last_event_ts = now
        if not self.session_active:
            self.session_id = self.store.start_session(now, IDLE_THRESHOLD_S)
            self.session_active = True

    # --- pynput callbacks ---

    def _sample_app(self):
        """get_foreground_app() sampled per keypress, not once a minute
        like the events_buffer bucket -- so alt-tabbing mid-minute doesn't
        smear one app's keys onto another. Throttled to at most 10
        queries/sec (APP_SAMPLE_MIN_INTERVAL_S) as a safety margin against
        OS-call cost during key-repeat bursts (holding a key down fires
        on_press far faster than anyone actually types); reusing the last
        sampled app for that window still resolves far better than the
        old once-a-minute snapshot.
        """
        now = time.monotonic()
        last_ts, last_app = self._last_app_sample
        if now - last_ts < APP_SAMPLE_MIN_INTERVAL_S:
            return last_app
        app = get_foreground_app()
        self._last_app_sample = (now, app)
        return app

    def on_press(self, key):
        with self.bucket_lock:
            self._touch()
            category = classify_key(key)
            self.counts["keystrokes"] += 1
            if category == "backspace":
                self.counts["backspaces"] += 1

            # Per-app sub-attribution for the SYNCED bucket data (added
            # 2026-09-02) -- reuses the same throttled per-keypress app
            # sample that has made the local key_counts table accurate
            # since 2026-08-31, so flush_bucket() can split one minute's
            # keystrokes across every app that actually had focus during
            # it, instead of crediting the whole minute to a single
            # once-a-minute snapshot. Unconditional (not gated on
            # TRACK_PER_KEY): that flag only controls local per-KEY-
            # IDENTITY tracking, which is the privacy-sensitive piece (see
            # the PRIVACY NOTE at the top of this file) -- this is
            # per-app keystroke COUNTS, no key identity involved, and
            # counts-by-app already sync to the backend today, just
            # inaccurately. This makes that existing sync more accurate,
            # it doesn't add a new category of data leaving the device.
            app_name = self._sample_app()
            self.app_counts[app_name]["keystrokes"] += 1
            if category == "backspace":
                self.app_counts[app_name]["backspaces"] += 1

            if TRACK_PER_KEY:
                # Local calendar day at the moment of the keypress (this
                # agent runs on the viewer's own machine, so time.strftime()
                # with no explicit timestamp is already "their" clock --
                # nothing to convert, unlike the backend's local_date).
                local_date = time.strftime("%Y-%m-%d")
                self.key_counts[(key_identity(key), app_name, local_date)] += 1
                if DEBUG_PRINT_KEYS:
                    # Debug aid, e.g. for tracking down why some app comes
                    # through as "unknown" (see get_foreground_app). Same
                    # info already stored in key_counts -- just the single
                    # physical key label, never reconstructable text --
                    # printed live instead of only visible via sqlite3
                    # afterward. \n first so it doesn't run together with
                    # the \r-updating "Today: N keystrokes" status line.
                    print(f"\n[key] {key_identity(key)!r:12} app={app_name!r}")

    def on_click(self, x, y, button, pressed):
        if pressed:
            with self.bucket_lock:
                self._touch()
                self.counts["mouse_clicks"] += 1

    def on_move(self, x, y):
        with self.bucket_lock:
            self._touch()
            if self._last_mouse_pos is not None:
                dx = x - self._last_mouse_pos[0]
                dy = y - self._last_mouse_pos[1]
                self.counts["mouse_distance_px"] += int((dx * dx + dy * dy) ** 0.5)
            self._last_mouse_pos = (x, y)

    # --- bucket flushing ---

    def flush_bucket(self):
        """Writes this minute's counts to events_buffer -- as one row per
        app that had keystrokes during it (added 2026-09-02), rather than
        always exactly one row for whichever app happened to be
        foreground when this timer fired. That old behavior is exactly
        why the backend's "By app" breakdown had to be hidden (see
        TodayView.tsx's note): a brief mid-minute app switch got zero
        representation, not just imprecise credit. app_counts (bumped
        per-keypress in on_press via the same throttled _sample_app()
        that already makes the local key_counts table accurate) fixes
        that for keystrokes/backspaces specifically.

        Mouse activity (clicks, distance) deliberately keeps the OLD
        once-a-minute foreground-sample behavior -- per explicit product
        decision, keystroke accuracy was the priority and click coarseness
        was fine as-is. It's folded entirely into whichever app-row
        matches `flush_app` (creating a zero-keystroke row for it if that
        app had no keystrokes this minute), so a mouse-only minute still
        produces exactly one row, unchanged from before this change.

        In the common case -- one app the whole minute -- app_counts has
        exactly one entry, it matches flush_app, and this produces the
        exact same single row as the old code did: no regression for the
        overwhelming majority of minutes.
        """
        with self.bucket_lock:
            flush_app = get_foreground_app()
            app_counts = {app: dict(counts) for app, counts in self.app_counts.items()}
            app_counts.setdefault(flush_app, {})

            for app_name, counts in app_counts.items():
                is_flush_app = app_name == flush_app
                self.store.insert_bucket(
                    self.bucket_start,
                    app_name,
                    counts.get("keystrokes", 0),
                    counts.get("backspaces", 0),
                    self.counts["mouse_clicks"] if is_flush_app else 0,
                    self.counts["mouse_distance_px"] if is_flush_app else 0,
                )

            self.counts.clear()
            self.app_counts.clear()
            self.bucket_start = self._minute_start(time.time())

            if self.key_counts:
                self.store.bump_keys(dict(self.key_counts))
                self.key_counts.clear()

    def check_idle(self):
        if self.session_active and (time.time() - self.last_event_ts) > IDLE_THRESHOLD_S:
            self.store.end_session(self.session_id, self.last_event_ts)
            self.session_active = False

    def print_today(self):
        keystrokes, clicks = self.store.today_totals(self._day_start(time.time()))
        pending = self.counts.get("keystrokes", 0)
        status = "active" if self.session_active else "idle"
        print(f"\rToday: {keystrokes + pending} keystrokes, {clicks} clicks  [{status}]   ",
              end="", flush=True)

    def print_top_keys(self, n=10):
        rows = self.store.top_keys(n)
        if not rows:
            print("No per-key data yet.")
            return
        print(f"\nTop {len(rows)} keys (local-only, never synced):")
        for key_name, count in rows:
            print(f"  {key_name!r:>10}  {count}")

    # --- syncing ---

    def sync_pass(self):
        if not (self.backend_url and self.device_token):
            return
        count, error = sync_once(self.store, self.backend_url, self.device_token)
        if error:
            print(f"\n[sync] {error}")
        elif count:
            print(f"\n[sync] synced {count} bucket(s) to {self.backend_url}")

    def run(self):
        kb_listener = keyboard.Listener(on_press=self.on_press)
        mouse_listener = mouse.Listener(on_click=self.on_click, on_move=self.on_move)
        kb_listener.start()
        mouse_listener.start()

        local_server = None
        if TRACK_PER_KEY:
            local_server = start_local_keys_server(self.store)

        print(f"KeyCount agent running. DB: {DB_PATH}")
        print("Never logs actual key characters as text -- counts and timing only.")
        if TRACK_PER_KEY:
            print("Per-key frequency tracking is ON (local-only, never synced).")
            if local_server:
                print(f"Local key-stats API on http://localhost:{LOCAL_API_PORT} "
                      "(for the dashboard's Keys tab -- run --show-local-token for the access code).")
        if self.backend_url and self.device_token:
            print(f"Syncing enabled -- backend: {self.backend_url}")
        else:
            print("Syncing disabled -- run `python3 agent.py --register` to link this device to a backend.")
        print("Press Ctrl+C to stop.\n")

        last_flush = time.time()
        last_print = time.time()
        last_sync = time.time()
        try:
            while not self._stop.is_set():
                time.sleep(1)
                self.check_idle()
                now = time.time()
                if now - last_flush >= FLUSH_INTERVAL_S:
                    self.flush_bucket()
                    last_flush = now
                if now - last_print >= PRINT_INTERVAL_S:
                    self.print_today()
                    last_print = now
                if now - last_sync >= SYNC_INTERVAL_S:
                    self.sync_pass()
                    last_sync = now
        except KeyboardInterrupt:
            pass
        finally:
            print("\nStopping, flushing last bucket...")
            self.flush_bucket()
            if self.session_active:
                self.store.end_session(self.session_id, time.time())
            kb_listener.stop()
            mouse_listener.stop()
            if local_server:
                local_server.shutdown()
            self.sync_pass()  # one last push so nothing sits unsynced on exit
            if TRACK_PER_KEY:
                self.print_top_keys()


def main():
    parser = argparse.ArgumentParser(description="KeyCount agent MVP")
    parser.add_argument("--show-keys", action="store_true",
                         help="Print the local per-key leaderboard from keycount.db and exit "
                              "(does not start tracking).")
    parser.add_argument("--top", type=int, default=10,
                         help="How many keys to show with --show-keys (default 10).")
    parser.add_argument("--show-local-token", action="store_true",
                         help="Print this device's access code for the dashboard's Keys tab, "
                              "and exit (creates one if it doesn't exist yet).")
    parser.add_argument("--register", action="store_true",
                         help="Interactively sign in / sign up and link this device to a "
                              "KeyCount backend for syncing, then exit.")
    parser.add_argument("--url", default="http://localhost:8080",
                         help="Backend base URL to use with --register (default: http://localhost:8080).")
    parser.add_argument("--sync-now", action="store_true",
                         help="Run one manual sync pass against the configured backend and exit.")
    args = parser.parse_args()

    if args.register:
        register_with_backend(Store(DB_PATH), args.url)
        return

    if args.sync_now:
        store = Store(DB_PATH)
        backend_url = store.get_setting("backend_url")
        device_token = store.get_setting("device_token")
        if not (backend_url and device_token):
            sys.exit("Not registered with a backend yet. Run `python3 agent.py --register` first.")
        count, error = sync_once(store, backend_url, device_token)
        if error:
            sys.exit(error)
        print(f"Synced {count} bucket(s) to {backend_url}.")
        return

    if args.show_keys:
        Agent().print_top_keys(args.top)
        return

    if args.show_local_token:
        token = get_or_create_local_token(Store(DB_PATH))
        print(token)
        return

    Agent().run()


if __name__ == "__main__":
    main()

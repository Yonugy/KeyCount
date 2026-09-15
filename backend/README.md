# KeyCount Backend — Phase 2

A small Go API implementing Phase 2 of the roadmap: auth, device
registration, and ingest for the data `agent.py` collects locally.
Written against the stdlib `net/http` (Go 1.22+ method/path routing, no
external router) plus `database/sql` + `lib/pq` for Postgres, `bcrypt` for
password hashing, and `golang-jwt/jwt/v5` for login tokens.

## Endpoints

| Method | Path                        | Auth               | What it does |
|---|---|---|---|
| GET  | `/v1/healthz`                | none               | Liveness check |
| POST | `/v1/auth/signup`            | none               | Create a user, returns a JWT |
| POST | `/v1/auth/login`              | none               | Returns a JWT |
| POST | `/v1/agent/register-device`  | user JWT           | Registers a device, returns a device token |
| POST | `/v1/ingest/batch`            | device token       | Accepts an array of `agent.py`'s per-minute buckets |
| GET  | `/v1/me/stats?range=`         | user JWT           | `today` / `week` / `month` / `all` totals + streak + per-day averages (see 2026-09-07 note) |
| GET  | `/v1/me/history?days=`        | user JWT           | Daily rollup rows for the dashboard's History chart + heatmap. `days` defaults to 30, max 366. Only returns days with activity — the frontend zero-fills gaps. |
| GET  | `/v1/me/apps-breakdown?range=`| user JWT           | Per-app keystroke/click totals for `today` / `week` / `month` / `all`, ordered by keystrokes descending. Its `range=today` window is UTC-midnight-relative, not the caller's local day -- fine for week/month/all, but see `day-apps` below for browsing one specific local day accurately. |
| GET  | `/v1/me/day-buckets?since=&until=` | user JWT     | Per-minute activity totals (all apps summed) for an exact `since`/`until` unix-second window -- the caller computes that window as one local calendar day (see `day_buckets.go`'s handler comment for the full contract). Powers the dashboard's intraday timeline. Added 2026-09-01. |
| GET  | `/v1/me/day-apps?since=&until=` | user JWT       | Same since/until contract as `day-buckets`, grouped by `app_name` instead of by minute -- per-app keystroke/click totals for one exact local day. Added 2026-09-02, see the dated section below. |
| POST | `/v1/auth/refresh`            | none (refresh token in body) | Rotates a refresh token: revokes it and returns a fresh (access, refresh) pair. Added 2026-09-02, see the dated section below. |
| GET  | `/v1/me/settings`             | user JWT           | Returns `{username, public_profile, member_since}`. `member_since` was added so the frontend's authenticated Profile tab always has it, regardless of `public_profile` -- see the dated section below. |
| PATCH | `/v1/me/settings`            | user JWT           | Body `{public_profile: bool}` -- toggles the opt-in public profile page. |
| GET  | `/v1/leaderboards/keystrokes?window=&scope=` | user JWT | Top 50 by total keystrokes. `window` is `daily` / `weekly` / `alltime`, defaults to `daily`. `scope` is `global` (default) or `friends` (you + your accepted friends only), added 2026-09-11. Users with zero activity in the window are omitted. |
| GET  | `/v1/leaderboards/streak?scope=` | user JWT       | Top 50 by all-time longest streak (not current streak). `scope` is `global` (default) or `friends`, added 2026-09-11. |
| GET  | `/v1/users/{username}/public-profile` | none       | No auth required -- the point of a shareable link. 404s identically for a nonexistent username and an existing-but-private one. |
| GET  | `/v1/friends`                 | user JWT           | Returns `{friends, incoming_requests, outgoing_requests}` -- see the 2026-09-11 dated section below. |
| POST | `/v1/friends/request`         | user JWT           | Body `{username}` -- sends a friend request. 409s on self, duplicate, already-friends, or a reverse pending request. |
| POST | `/v1/friends/{username}/accept` | user JWT         | Accepts an incoming request. |
| POST | `/v1/friends/{username}/decline` | user JWT        | Declines an incoming request, or cancels one you sent -- works from either side. |
| DELETE | `/v1/friends/{username}`    | user JWT           | Removes an existing friendship. |

Two separate token types on purpose: your browser/CLI logs in as a *user*
(JWT), but each installed agent authenticates ingest calls with its own
*device token* from `register-device` — so revoking one machine doesn't
touch your login, and the ingest endpoint never needs your password.

## CORS

The dashboard (`../web`) runs on a different origin (`localhost:5173` in
dev) than this API (`localhost:8080`), so `main.go` wraps the router in
`corsMiddleware`. Until 2026-09-02 this was a flat `Access-Control-Allow-Origin: *`
-- fine while the only browser ever talking to this API was one
developer's own localhost frontend, but no longer true once leaderboards
and public profiles meant other people's browsers would hit it too. It's
now a configurable allowlist: set `ALLOWED_ORIGINS` (comma-separated) in
`.env`, defaulting to `http://localhost:5173` if unset so local dev keeps
working with zero config. The middleware echoes back the request's
`Origin` header only when it's in the allowlist (plus `Vary: Origin`, so a
cache doesn't serve one origin's preflight response to another) --
same pattern `agent.py`'s own local CORS handling already used. `OPTIONS`
preflight still gets a 204.

## Database schema

Everything below is created automatically the first time you run the
server (`RunMigrations` in `db.go` runs `CREATE TABLE IF NOT EXISTS` for
each of these on startup) -- there's no separate migration step. This is
based on section 4.4 of the system design doc, trimmed to what auth +
ingest + stats actually need. A `friendships` table was added
2026-09-11 -- see the dated section below.

Five tables:

### `users`
One row per account.

| column | type | meaning |
|---|---|---|
| `id` | integer, auto-incrementing | primary key, referenced by every other table |
| `email` | text, unique | login identifier |
| `username` | text, unique | display name |
| `password_hash` | text | your password, never stored in plain text -- run through `bcrypt` before saving |
| `created_at` | timestamp | when you signed up |
| `public_profile` | boolean | reserved for Phase 4's opt-in public profile pages; unused for now |

### `devices`
One row per machine you've registered with `agent.py --register`.

| column | type | meaning |
|---|---|---|
| `id` | integer, auto-incrementing | primary key |
| `user_id` | integer | which user this device belongs to (points at `users.id`) |
| `name` | text | your hostname, e.g. `Yongs-MacBook-Neo.local` |
| `platform` | text | e.g. `darwin` |
| `device_token` | text, unique | the secret `agent.py` uses to authenticate ingest calls -- separate from your login password on purpose, so a leaked device token can't log in as you |
| `last_seen_at` | timestamp | updated every time this device successfully calls `/v1/ingest/batch` |

### `activity_buckets`
The raw data -- one row per minute of activity per app, per device. This is
what `agent.py`'s local `events_buffer` rows turn into once synced.

The schema has always allowed several rows for the same minute (the
uniqueness rule below is keyed on `app_name` too, not just
`bucket_start`), but until 2026-09-02 the agent only ever produced one:
`flush_bucket()` sampled the foreground app once, at the moment the
once-a-minute timer fired, and credited the whole minute to it. As of
2026-09-02 (see the dated section further down) it instead samples the
app on every keypress, so a minute where you typed in two apps now
correctly arrives as two rows -- one per app, each with its own share of
that minute's keystrokes. Mouse activity (clicks, distance) still lands on
a single row (whichever app was foreground when the minute's timer fired)
-- that part was a deliberate scope decision, not an oversight.

| column | type | meaning |
|---|---|---|
| `id` | bigint, auto-incrementing | primary key |
| `user_id` | integer | owner |
| `device_id` | integer | which machine this activity came from |
| `bucket_start` | timestamp | the minute this row covers |
| `app_name` | text | foreground app during that minute (e.g. "VS Code") |
| `keystrokes` | integer | count for that minute |
| `backspaces` | integer | count for that minute |
| `clicks` | integer | mouse clicks that minute |
| `mouse_distance` | integer | mouse travel in pixels that minute |

There's also a uniqueness rule on `(user_id, bucket_start, device_id,
app_name)` -- it's what makes re-syncing the same bucket a safe no-op
instead of double-counting.

### `daily_rollups`
Pre-summed totals per user per day, so `/v1/me/stats` doesn't have to
re-sum every `activity_buckets` row on every request (per design doc
section 4.1). One row per `(user, date)`, updated incrementally every time
a new bucket is ingested.

| column | type | meaning |
|---|---|---|
| `user_id` | integer | owner |
| `date` | date | which day this row summarizes |
| `total_keystrokes` | integer | running sum for the day |
| `total_clicks` | integer | running sum for the day |
| `active_minutes` | integer | how many of that day's minutes had any activity |

### `streaks`
One row per user, tracking your current and longest "active day" streak
(a day counts as active if it has at least one minute of activity).

| column | type | meaning |
|---|---|---|
| `user_id` | integer | primary key -- one row per user |
| `current_streak` | integer | consecutive active days, ending today or yesterday |
| `longest_streak` | integer | best streak ever recorded |
| `last_active_date` | date | the most recent day counted -- used to decide whether a new active day extends the streak or resets it |

### `refresh_tokens`
Added 2026-09-02 for the real refresh-token flow (see the dated section
below) -- one row per issued refresh token.

| column | type | meaning |
|---|---|---|
| `id` | bigint, auto-incrementing | primary key |
| `user_id` | integer | owner |
| `token_hash` | text, unique | SHA-256 of the raw refresh token -- never the raw value itself, same reasoning as `password_hash`/`device_token` |
| `created_at` | timestamp | when this token was issued |
| `expires_at` | timestamp | 30 days after issuance |
| `revoked_at` | timestamp, nullable | set the moment this token is used (rotation) or could be set by a future explicit "sign out other devices" endpoint -- not built yet |

### `friendships`
Added 2026-09-11. One row per friend pair, not two -- see the dated
section further down for why.

| column | type | meaning |
|---|---|---|
| `requester_id` | integer | who sent the request (points at `users.id`) |
| `addressee_id` | integer | who received it |
| `status` | text | `pending` or `accepted` -- flipped in place on accept, never a second row |
| `created_at` | timestamp | when the request was sent |
| `responded_at` | timestamp, nullable | when it was accepted (still null while pending) |

Primary key is `(requester_id, addressee_id)`, and a functional unique
index on `(LEAST(requester_id, addressee_id), GREATEST(requester_id,
addressee_id))` stops the same pair from having rows in both directions
at once. A `CHECK (requester_id <> addressee_id)` blocks self-friending
at the DB level. Declining or unfriending deletes the row outright --
no tombstone -- so the same pair can request again later.

### How a row actually gets written where

1. `agent.py` syncs a bucket -> `POST /v1/ingest/batch` -> a new row in
   `activity_buckets` (unless that exact bucket already exists, in which
   case nothing happens).
2. Right after that insert, in the same transaction: `daily_rollups` for
   that user+day gets incremented by that bucket's numbers. `active_minutes`
   specifically only increments the first time a given `bucket_start` (for
   this user+device) is seen with any activity across the whole request --
   see the 2026-09-02 note below for why that dedup exists.
3. If the bucket had any activity, `streaks` gets checked/updated for that
   user (extend if yesterday was also active, otherwise reset to 1). This
   check runs for every activity-bearing row, not just the one that
   incremented `active_minutes` -- `updateStreak` is idempotent per
   *calendar day* (it no-ops once `last_active_date` already equals
   today), so calling it more than once for the same day is harmless, and
   decoupling it from the active-minutes dedup keeps the two concerns
   separate.

`/v1/me/stats` only ever reads from `daily_rollups` and `streaks` -- never
`activity_buckets` directly -- which is why it stays fast no matter how
much raw history piles up.

### 2026-09-02: per-app keystroke accuracy, without syncing key identity

Before this date, the "By app" breakdown (`apps-breakdown`, and the
now-added `day-apps`) was hidden on the frontend -- see the note in
`../web/README.md` and in `TodayView.tsx` -- because it was built on a
once-a-minute foreground-app snapshot. A quick alt-tab into another app
for 10 seconds mid-minute got zero credit; the whole minute's keystrokes
went to whichever app happened to be focused the instant the flush timer
fired. That made per-app numbers actively misleading, not just imprecise.

The fix is entirely on the "which app gets credit" side, not the "what
data leaves the device" side -- **no new category of data syncs to the
backend**. `agent.py` already synced per-app keystroke *counts* (just
inaccurately attributed); it still never syncs which physical key was
pressed (`key_counts`, the local per-key table, remains local-only -- see
the PRIVACY NOTE at the top of `agent.py`). Concretely:

- `agent.py`'s `flush_bucket()` now samples the foreground app on every
  keypress (reusing `_sample_app()`, the same throttled sampler that's
  made the local Keys tab's per-app filter accurate since 2026-08-31)
  instead of once per minute, and emits one `events_buffer` row per app
  that had keystrokes during that minute. Mouse clicks/distance still use
  the old once-a-minute sample, folded into whichever app-row matches it
  -- a deliberate scope decision (keystroke accuracy was the priority).
- This requires **no schema change** here -- `activity_buckets`'s
  `UNIQUE (user_id, bucket_start, device_id, app_name)` already supported
  multiple app-rows per minute, it just was never exercised until now.
- `handleIngestBatch` (`ingest.go`) gained a dedup step so a minute that
  now arrives as several app-rows doesn't inflate `active_minutes`: before
  the insert loop, it queries which `bucket_start` values (for this
  user+device) already have an activity-bearing row -- from a prior sync
  *or* an earlier row in this same batch -- and only counts a
  `bucket_start` as newly-active once. `total_keystrokes`/`total_clicks`
  still sum every row normally; only the per-minute "was this minute
  active" bit is deduped.
- New endpoint `GET /v1/me/day-apps?since=&until=` (see the table above)
  is what actually surfaces this: per-app totals for one exact local day,
  used by the Day view's restored "By app" section.

Tested against a real local Postgres + this real Go binary (not mocked):
single-app-per-minute regression case, a minute split across two apps
(active_minutes counted once, not twice), a resynced/duplicate batch
(no double-count), and a third app-row for the same minute arriving in a
*separate* later sync call (exercises the cross-batch, not just in-batch,
side of the dedup).

### 2026-09-02: multi-user + leaderboards -- refresh tokens, CORS lockdown, ingest rate limiting, global leaderboards, opt-in public profiles

This is the phase where other people's browsers and devices started
talking to this API for the first time -- everything up to this point was
built and tested against exactly one user's own localhost dashboard. That
changed several things that were fine as an MVP shortcut but not once
strangers' requests are in the mix:

- **Refresh tokens.** `issueToken` (one flat 7-day JWT) became
  `issueTokenPair`: a 15-minute access token plus a 30-day, rotating
  refresh token (new `refresh_tokens` table, see above). Every
  `POST /v1/auth/refresh` call revokes the token it was given and issues a
  brand new pair -- reusing an already-rotated refresh token is rejected
  with "refresh token already used," the standard signal that a token has
  leaked. A stolen-but-unused access token now has a 15-minute blast
  radius instead of 7 days.
- **CORS lockdown.** See the CORS section above -- `*` became a
  configurable `ALLOWED_ORIGINS` allowlist.
- **Ingest rate limiting** (`ratelimit.go`). A per-device in-memory token
  bucket (stdlib only, no new Go module) guards `/v1/ingest/batch`: 20
  requests, refilling at 1/3s (~20/min sustained) -- generous relative to
  the agent's actual ~once-a-minute sync cadence, meant to stop a flood
  (compromised device token, buggy retry loop) rather than police normal
  usage. Keyed per-device, so one compromised/misbehaving device doesn't
  affect your other devices.
- **Leaderboards** (`leaderboards.go`) -- `GET
  /v1/leaderboards/keystrokes?window=daily|weekly|alltime` and `GET
  /v1/leaderboards/streak`, top 50, descending. Global by default; both
  endpoints also take `scope=friends` as of 2026-09-11 (you + your
  accepted friends only) -- see that dated section below.
  Users with zero activity in the window are excluded rather than shown
  at the bottom with a zero. Ranked by `longest_streak` (best ever), not
  current streak, on the streak board -- rewards all-time consistency
  over whoever happens to be mid-streak right now.
- **Opt-in public profile pages.** The `users.public_profile` column
  existed in the schema since Phase 2 but was unused until now. New
  `GET`/`PATCH /v1/me/settings` toggles it; new
  `GET /v1/users/{username}/public-profile` serves the page's data with
  **no auth required** (the entire point of a shareable link) and 404s
  identically for a nonexistent username and an existing-but-private one,
  so the endpoint can't be used to enumerate valid usernames by response
  shape. Each leaderboard entry carries its own `public_profile` bool so
  the frontend knows which rows actually have a profile page to link to.

**Follow-up the same day:** `GET /v1/me/settings` gained `member_since`
(see the endpoint table above) once it became clear there was no way for
a user to see their own username/member-since/stats while
`public_profile` was off -- `handlePublicProfile` deliberately 404s while
private (that's the point of the flag), so it can't be the source for an
authenticated "this is MY profile" view. Settings already returns your
own account-identity fields, so `member_since` grew there instead of a
new one-off endpoint. Paired with a new frontend-only "Profile" tab (see
`../web/README.md`) that reads this plus the existing `GET
/v1/me/stats?range=all` -- no other backend change needed.

Tested with a 32-check functional suite against a real local Postgres +
this real compiled Go binary (not mocked): refresh rotation and reuse
rejection, CORS allow/deny by origin, settings toggle + public-profile
visibility transitions, per-device rate-limit capacity and independence
between two devices on the same account, and leaderboard ranking order
and rank numbers with a seeded second user.

## 1. Install Postgres (Homebrew)

```bash
brew install postgresql@16
brew services start postgresql@16

# create a role + database for KeyCount
createuser keycount --pwprompt      # set the password to "keycount", or your own
createdb keycount --owner=keycount
```

If you used a different user/password/db name, update `DATABASE_URL`
below to match.

## 2. Configure

```bash
cd backend
cp .env.example .env
# edit .env: set DATABASE_URL to match step 1, and JWT_SECRET to
# `openssl rand -hex 32`
```

Go doesn't load `.env` files itself, so load it into your shell before
running the server:

```bash
set -a
source .env
set +a
```

(`source` respects the `#` comments in `.env.example`; the shorter
`export $(cat .env | xargs)` trick people often reach for does **not** --
it tries to export the comment text too and errors out. Alternatively
just `export DATABASE_URL=... JWT_SECRET=...` directly, one at a time.)

## 3. Run

```bash
go mod tidy   # first time only, downloads dependencies
go run .
```

Tables are created automatically on startup (`CREATE TABLE IF NOT
EXISTS`, see `db.go`) — no separate migration step needed for this MVP.

You should see:
```
KeyCount backend listening on :8080
```

## 4. Try it

```bash
# sign up, capture the token
curl -s -X POST localhost:8080/v1/auth/signup -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","username":"you","password":"a-real-password"}'

# register a device, capture the device_token
curl -s -X POST localhost:8080/v1/agent/register-device \
  -H "Authorization: Bearer <token from signup>" -H "Content-Type: application/json" \
  -d '{"name":"my-macbook","platform":"darwin"}'

# push a fake bucket of activity
curl -s -X POST localhost:8080/v1/ingest/batch \
  -H "Authorization: Bearer <device_token>" -H "Content-Type: application/json" \
  -d '[{"bucket_start_ts": '"$(date +%s)"', "app_name": "VS Code", "keystrokes": 120, "backspaces": 5, "mouse_clicks": 8, "mouse_distance_px": 400}]'

# read your stats back
curl -s "localhost:8080/v1/me/stats?range=today" -H "Authorization: Bearer <token from signup>"
```

Re-posting the exact same bucket is a safe no-op (`"inserted":0`) — the
ingest endpoint is idempotent per `(user, bucket_start, device, app)`, so
a retried sync after a dropped connection can't double-count.

This has been run end-to-end (signup → register-device → ingest →
re-ingest → stats → auth-rejection checks) against a real local Postgres
during development, not just compiled.

## What's deliberately out of scope

- **`key_counts`** from the agent's local per-key tracking — intentionally
  never sent here, and never will be. See `../ROADMAP.md` and the PRIVACY
  NOTE at the top of `agent.py`.
- **Multi-instance rate limiting.** The ingest limiter (`ratelimit.go`) is
  in-memory per process -- fine for a single instance, but would
  under/over-count across a load-balanced deployment. Nothing in this repo
  runs more than one instance yet.
- **Device token revocation / refresh.** Only the user-facing access/refresh
  token pair rotates (2026-09-02). Device tokens from `register-device` are
  still a single long-lived opaque token with no rotation or expiry.

### 2026-09-07: per-day averages on `/v1/me/stats`

Frontend request: the Week/Month/All-time tabs wanted a "daily average"
next to the totals, but only averaged over days that actually have
activity, not the range's full calendar length -- e.g. 3 active days
inside a 30-day month range should average over 3, not 30.

`statsResponse` grew `active_days` (day count, a shared definition: any
day with nonzero keystrokes, clicks, OR active minutes) and
`avg_keystrokes` / `avg_clicks` / `avg_active_minutes` (the existing sums
divided by that count, 0 when active_days is 0 -- guarded so a brand new
user gets a clean 0 instead of a NaN/Inf from a 0/0 divide). One extra
`COUNT(*) FILTER (...)` on the same `daily_rollups` query `/v1/me/stats`
already ran -- no new query, no new endpoint.

Also the occasion for a frontend-only reshuffle of where the two streak
fields show up (current_streak off Week/Month/All-time entirely, onto
the Day view instead; longest_streak dropped from Week/Month, kept only
on All-time) -- no backend change for that part, see the web README's
matching note.

### 2026-09-11: friendships and friends-only leaderboards

Request/accept friendships (design doc section 4.4, previously deferred
-- see the now-removed out-of-scope bullet above). One `friendships` row
per pair, flipped from `pending` to `accepted` in place rather than
mirrored into a second row -- see the `friendships` table doc above for
the exact constraints that keep a pair from ending up in both states at
once.

New file `friends.go`: `handleSendFriendRequest`, `handleAcceptFriendRequest`,
`handleDeclineFriendRequest` (doubles as "cancel" for the requester --
same 409/404 semantics either direction), `handleRemoveFriend`, and
`handleListFriends` (three queries: friends, incoming requests, outgoing
requests). New routes are in the endpoint table above.

Both leaderboard endpoints gained a `scope` query param (`global`, the
default, or `friends`) via a shared `friendsScopeClause` SQL helper --
`friends` scope always includes the viewer themselves alongside their
accepted friends, so you can see your own rank on a friends-only board
even with just one friend.

Tested with a 27-check functional suite against a real local Postgres +
this real compiled Go binary (request/accept/decline/unfriend and both
leaderboard endpoints' scope filtering), plus a two-browser-context
Playwright run against the real frontend (see `../web/README.md`).

## Next: wire the agent to this

`agent.py` still only writes to its local SQLite file. To connect it, the
sync job would need to: call `/v1/agent/register-device` once (save the
device token, e.g. into the `settings` table), then periodically `SELECT
* FROM events_buffer WHERE synced = 0`, POST them here as `ingest_bucket`
objects (map `bucket_start_ts` from `bucket_start_ts`, `mouse_clicks` from
`mouse_clicks`, etc.), and mark rows `synced = 1` on a 200 response. Say
the word and I'll add that.

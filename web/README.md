# KeyCount Dashboard — Phase 3

The monkeytype-style web dashboard: a Today view (live stats, streak,
per-app breakdown) and a History view (90-day chart + activity calendar
heatmap), per section 5 of the system design doc. React + TypeScript +
Vite, `@tanstack/react-query` for data fetching, Recharts for the chart.

## 1. Install

```bash
cd web
npm install
```

## 2. Point it at your backend

By default it talks to `http://localhost:8080` (the Phase 2 Go backend).
If yours runs somewhere else:

```bash
cp .env.example .env.local
# edit .env.local: VITE_API_URL=http://your-backend-host:port
```

## 3. Run

Make sure the backend (`cd ../backend && go run .`) is running first, then:

```bash
npm run dev
```

Open the URL it prints (usually `http://localhost:5173`). Sign in with the
same account you created with `curl` or that `agent.py --register` set up
— it's the same `users` table either way.

## What's on each view

(Layout note, 2026-08-31: the app's content column widened from 720px to
1100px, and the History chart got taller -- 220px to 340px -- since the
old sizing left a lot of empty margin unused on larger screens. See
`App.tsx`'s wrapping div and `HistoryChart.tsx`'s `ResponsiveContainer`
if either needs tuning further.)

**Today** — the "Today" range tab is a fitness-app-style single-day
navigator now (`DayView.tsx`, added 2026-08-31), not just a fixed "today"
snapshot: prev/next arrows step one calendar day at a time, bounded by
today on one side and the oldest day in the fetched history window on the
other, with a "Jump to today" shortcut once you've stepped away from it.
Three stat tiles (keystrokes, clicks, active minutes) per day. It reuses
`GET /v1/me/history?days=90` -- the same call and React Query cache key
(`["history", 90]`) as the History tab below -- rather than a new
endpoint, since `daily_rollups` already had exactly the per-day rows a
day-picker needs; switching between Today and History doesn't refetch.
Week / Month / All time still show the original five stat tiles
(keystrokes, clicks, active minutes, current streak, longest streak) for
that aggregate range, backed by `GET /v1/me/stats`.

Streaks are deliberately *not* shown on the Today/day view -- current and
longest streak are inherently "as of right now" numbers, not "as of the
day you're browsing," so they'd either sit frozen while you paged through
history (confusing) or need their own separate historical definition (not
worth it here). They stay on Week/Month/All time, where "streak" as a
concept actually belongs.

The day view got three more pieces later the same day (2026-08-31), all
computed client-side from the same already-fetched 90-day history array
-- no new backend calls:

- **A week strip** below the day label -- 7 bars for the Sun-Sat week
  containing the selected day, scaled to that week's own max, with the
  selected day highlighted in accent color. Tap a bar to jump to that
  day. Sized up (2026-08-31, later still) after the initial version came
  out tiny and pinned to a fixed width regardless of screen size -- bars
  now flex to fill the full row width and are ~5x taller, so it actually
  reads as a chart instead of a decoration. **Replaced (2026-09-01)** by
  the intraday timeline described below -- see that section for why, and
  for where the week-at-a-glance idea moved to instead.
- **Comparison chips** ("+18% vs yesterday", "-9% vs 7-day avg") under
  the header, based on keystrokes (the app's primary metric elsewhere).
  The "N-day avg" label always reflects how many prior days were
  actually averaged -- "vs 3-day avg" near the edge of the fetched
  window -- rather than silently averaging fewer days under a fixed
  "7-day" label. A comparison is hidden entirely when there's no honest
  baseline (no prior day fetched yet, or the baseline day was zero)
  instead of showing a nonsensical infinite-percent change -- same
  reasoning as why the old "By app" number got hidden rather than left
  showing something technically-computed-but-misleading.
  This row is always rendered (visibility toggled, not conditionally
  mounted) so the stat tiles below stay at a fixed vertical position
  regardless of which day has a baseline to compare against -- an
  earlier version unmounted it entirely when hidden, which made the
  tiles jump up a day at a time. The sync-lag caption that used to sit
  above this row (see below) was removed from the day view entirely
  (2026-08-31, still later) rather than reserving space for it, per
  direct request -- it was pure vertical padding on every day but
  today.
- **A "Best day" badge** next to the day label when the selected day has
  the most keystrokes anywhere in the fetched 90-day window.

**An intraday timeline (2026-09-01)** replaced the week strip above:
24 hourly bars from 12am to midnight showing when during the selected
day you were actually active, `DayTimeline.tsx`. This is the piece the
week strip and the 90-day history fetch could never answer -- "when" as
opposed to "how much" -- so it needed real new data: a `GET
/v1/me/day-buckets?since=<unix>&until=<unix>` endpoint
(`backend/day_buckets.go`) reading raw `activity_buckets` rows (not
`daily_rollups`, which only has daily totals) for an arbitrary UTC
instant window, summed per minute across every device and app. The
frontend computes since/until as the unix-second bounds of ONE LOCAL
CALENDAR DAY (`localDayBoundsUnix()` in `src/utils.ts`, this local
midnight to the next) and then folds the returned per-minute points into
24 local-hour totals (`bucketByLocalHour()`) by reading each point's
`.getHours()` on the browser's own clock. The backend does zero
timezone math -- it just returns whatever raw points fall in the exact
window it's given -- which is the same split of responsibility the
`local_date` timezone fix settled for `daily_rollups` (see the timezone
note above): only the client actually knows the viewer's clock, so only
the client computes anything timezone-dependent. Verified across UTC,
`Asia/Singapore`, `America/Los_Angeles`, and the two most extreme real
UTC offsets (`Pacific/Kiritimati` at +14, `Pacific/Niue` at -11), plus
both 2026 US DST transition dates (a 23-hour and a 25-hour local day) to
confirm the day-boundary math and hour-bucketing hold up regardless of
timezone or DST. Re-fetches every 30s only while viewing today -- a past
day's buckets are already final, so there's nothing to poll for.

**The Week tab (2026-09-01)** gained its own 7-bar chart
(`WeekChart.tsx`) -- the trailing 7 local days ending today, the same
90-day history fetch DayView and HistoryView already use (same query
key, so switching tabs doesn't re-request it), sliced to the last 7
entries. This intentionally reuses the exact rolling-7-day window the
backend's own `range=week` stat total already sums (`rangeStart()` in
`backend/stats.go`), so the chart's 7 bars visually add up to the number
in the "Keystrokes" stat tile shown right above them.

**Bars are clickable (2026-09-01, later same day)** -- picking one
switches the range tab back to Today and opens the Day view directly on
that date, the same click-to-drill-in behavior the old day-view week
strip had, just crossing a tab boundary now that the chart lives on
its own tab. This needed no backend or data changes, just wiring
between `TodayView.tsx` and `DayView.tsx`:

- `WeekChart` takes an `onSelectDay(date)` callback and renders each bar
  as a real `<button>` (was a plain `<div>`) so it's keyboard-accessible
  too, not just a mouse target.
- `TodayView` holds a one-shot `dayViewJumpDate` piece of state -- not
  the Day view's regular selected-date state, which `DayView` still
  fully owns itself, just "the date to open on the next mount." A bar
  click sets it and flips `range` to `"today"`.
- `DayView` accepts that as an optional `initialDate` prop (via a lazy
  `useState` initializer, so a jumped-to mount renders the right day
  immediately -- no flash of "today" first) and calls a
  `onInitialDateConsumed` callback right after applying it, which
  `TodayView` uses to clear its own state back to `undefined`. That's
  what stops the jump from "sticking": switching back to the Today tab
  normally afterward (clicking the tab itself, not a chart bar) opens on
  today again rather than re-showing whatever day you last jumped to.
  Verified with an end-to-end test covering exactly that sequence (jump
  to a day, use the day switcher's own prev/next from there, then leave
  and return to Today via the tab directly) against a real backend and
  Postgres.

Both the day view and the aggregate ranges auto-refetch every 30s
(`SYNC_LAG_REFETCH_MS`, now in both `TodayView.tsx` and `DayView.tsx`)
rather than requiring a manual Refresh click. That said, this is still
Postgres data, and Postgres is only ever as fresh as the agent's own
pipeline: `FLUSH_INTERVAL_S` (60s, rolls the in-memory bucket to disk)
plus `SYNC_INTERVAL_S` (60s, pushes it to the backend) means just-typed
keystrokes can take a minute or two to actually show up here even with
the auto-refresh. On Week/Month/All time there's a caption saying so
(`TodayView.tsx`). The day view (`DayView.tsx`) had the identical caption
on "today" only, but it's commented out as of 2026-08-31 (still later) --
see the day view's own note above. The Keys tab, by contrast, talks
directly to the agent's local server, so it has no such lag.

**`RefreshStatus` shows the last real sync, not the last fetch attempt**
(2026-08-31, later still). It used to display react-query's
`dataUpdatedAt` -- the time of the last fetch that *completed*, whether
or not it returned anything new. Since the backend only actually has new
numbers roughly once a minute (the agent's flush + sync cycle above),
that made mashing the refresh button pointless in a misleading way: the
timestamp cheerfully jumped forward on every click regardless, so it
looked like something happened even when it hadn't. `RefreshStatus.tsx`
now takes the query's `data` (not just `dataUpdatedAt`) and only moves
the displayed "Last sync" time when a fetch's payload actually differs
from the last one it saw (compared via `JSON.stringify`, tracked in a
ref). The button is relabeled "Check for updates," and a manual click
that comes back with unchanged data shows "No new sync yet" for a few
seconds instead of silently doing nothing -- tracked via a ref set right
before a manual `onRefresh()` call and read once that fetch settles, so
the message only ever fires for an explicit click, never for one of the
silent 30s background auto-refetches (which hit the "nothing changed"
case constantly and would just be noise). All four call sites
(`TodayView.tsx`, `DayView.tsx`, `HistoryView.tsx`, `KeysView.tsx`) pass
both `data` and `dataUpdatedAt` from their respective queries.

**"By app" was hidden** (2026-08-31) -- commented out in `TodayView.tsx`,
`AppsBreakdown` import included, rather than deleted. It was built on
`events_buffer`'s once-a-minute bucket flush, which samples the
foreground app a single time per 60s window and credits the *entire*
minute's activity to it -- so a brief app switch within that minute
(glance at Slack for 10s, switch back) got zero representation, not "too
short to count," just never sampled at all. That made the number actively
misleading rather than merely imprecise, and no amount of frontend
refresh interval could fix it, since the problem was what data got synced
to Postgres in the first place, not how often the dashboard asked for it.

**Fixed and restored -- in `DayView.tsx`, not `TodayView.tsx` (2026-09-02).**
The accuracy fix landed exactly as sketched above: `agent.py`'s
`flush_bucket()` now samples the foreground app on every keypress
(reusing `_sample_app()`, the same throttled sampler that already made
the Keys tab's app filter accurate) and emits one `events_buffer`/
`activity_buckets` row per app touched during that minute, instead of one
row for whichever app the once-a-minute timer happened to catch. Mouse
clicks/distance deliberately kept the old once-a-minute sample -- an
explicit scope decision (keystroke accuracy was the priority, not
clicks), not an oversight. `backend/ingest.go`'s `handleIngestBatch`
correspondingly gained the `daily_rollups.active_minutes` dedup this note
called for, so a minute split across several app-rows still only counts
as one active minute -- see `../backend/README.md`'s own 2026-09-02
section for the full mechanism.

The restored UI lives in `DayView.tsx` (a new "By app" section below the
intraday timeline, backed by a new `GET /v1/me/day-apps?since=&until=`
endpoint -- `fetchDayApps` in `api.ts`), **not** in `TodayView.tsx`'s
Week/Month/All-time tabs -- that commented-out section up top is still
commented out. The ask this restoration was built for was specifically
"which app did I type in the most on each day," which is what DayView
already exists to answer one day at a time; the coarser Week/Month/All
aggregate view wasn't part of that ask, so it's left alone (still safe to
uncomment later using the now-fixed data, if wanted -- just prefer a
`day-apps`-style exact-window fetch over `fetchAppsBreakdown`'s
`range=today` for any single-local-day use, since that param resolves
"today" as UTC midnight, not the caller's local day).

Verified against a real local Postgres + the real Go binary (not mocked):
the single-app-per-minute case produces the same result as before this
change (no regression to the common case), a minute split across two apps
counts as one active minute rather than two, a resynced duplicate batch
doesn't double-count, and a third app-row for the same minute arriving in
a *separate* later sync exercises the cross-batch dedup specifically.
Then end-to-end through Playwright against the built frontend: signed in,
landed on the Today tab, and confirmed the "By app" section shows the
correct per-app split with the stat tiles' totals matching (keystrokes
summed across every app-row, active minutes deduped to the true count).

**History** — an area chart of the last 90 days for whichever metric you
pick (keystrokes / clicks / active minutes), and a GitHub-style activity
calendar below it, colored by how that day compares to your own max in the
window. Backed by `GET /v1/me/history?days=90`. The backend only returns
rows for days that had activity; the frontend zero-fills the gaps
(`src/utils.ts`) so the chart shows real dips instead of connecting across
missing days.

Note: the area chart animates in from left to right over about a second
when the History tab first loads — if you catch it mid-load it can look
like the data's in the wrong place. Give it a second to settle.

Hovering a day in the activity calendar shows a styled tooltip (date +
value, GitHub/WakaTime-style) instead of the plain browser tooltip.

**Timezone note:** "today" is always computed from your browser's local
calendar day (`toLocalISODate()` in `src/utils.ts`), not UTC — an earlier
version used `.toISOString()`, which silently reports "today" as
"yesterday" for anyone with a positive UTC offset.

The backend used to bucket raw activity by *UTC* calendar day
(`bucket_start_ts` → `.UTC()` in `backend/ingest.go`), which had the same
problem one level deeper: for anyone at a positive UTC offset, the first
`|your UTC offset|` hours of your local day were still "yesterday" in
UTC, so activity right after your local midnight got permanently filed
under the wrong date in `daily_rollups` (and streaks). This is now fixed
(2026-09-01) at the source: `agent.py`'s `sync_once()` sends its own
`local_date` per bucket (`datetime.fromtimestamp(bucket_start_ts).date()`
— the agent's machine's local timezone, DST included, since only the
agent actually knows what that is), and `handleIngestBatch` in
`backend/ingest.go` uses that field directly instead of re-deriving the
day from UTC, falling back to the old UTC-derived day only if a bucket
arrives without it (older agent builds) or with something unparseable.
Verified against a real local Postgres instance: a bucket whose UTC
timestamp falls on one calendar day but whose `local_date` says the next
day rolls up under the *next* day, exactly as intended, and the
no-`local_date`/malformed-`local_date` fallback paths were checked too.

Note this only fixes it going forward — `daily_rollups` rows already
written under the old UTC-day boundary keep whatever date they were
filed under; there's no backfill/migration for that yet.

**Keys** — a ranked bar list of your most-pressed physical keys. This tab
is different from the other two: it does **not** talk to this backend at
all. Per-key counts are local-only by design (see the "Privacy decision"
section in `../ROADMAP.md`), so instead the browser fetches directly from
a tiny server `agent.py` runs on `http://localhost:8787`, bound to this
same machine only. The first time you open this tab you'll need to paste
in an access code -- get it with `python3 ../agent.py --show-local-token`
-- after that it's remembered in your browser. If you open the dashboard
on a machine with no agent running, this tab just shows nothing to fetch,
by design.

It has three view modes, toggled with the List/Keyboard/By app buttons:
the same ranked-bar-list treatment as the app's other breakdowns, a
QWERTY-shaped heatmap (`KeyboardHeatmap.tsx`) using the same sequential
blue ramp as the History tab's activity calendar, or a per-app keystroke
breakdown (see below). The keyboard view is a generic US layout matched
to pynput's key names -- a key you've never pressed just renders as "0
presses," there's no per-user layout detection.

The keyboard is authored once at a fixed 620px width (every key height,
gap, border and font-size is sized for that), then scaled up or down as
one block via a single CSS `transform: scale()` to fill however much
width `KeysView` actually gives it -- a `ResizeObserver` on the wrapper
recomputes the scale factor whenever that width changes. This replaced
two earlier, both-wrong attempts on 2026-08-31/09-01: first, each key was
a flex item with no explicit width, so widening `App.tsx`'s `maxWidth` to
1100 stretched every key into a squashed-looking wide rectangle (width
grew, height stayed fixed at 34px -- the two dimensions scaled
independently); then, over-correcting, it was pinned to a fixed 620px
`maxWidth` so it stopped growing at all, which fixed the distortion but
also stopped it from using the wider page. The `transform: scale()`
version scales width *and* height together by the same factor, so a key
that's roughly square at 620px stays exactly as square at any other
width -- it can fill the full column on a wide screen, or shrink on a
narrow one, without ever distorting.

An "All apps" dropdown next to the List/Keyboard toggle (shown only once
you've used the tracked keyboard in more than one app) filters either view
down to just the keys pressed while that app had focus. This is powered by
`agent.py` sampling the foreground app on *every keypress* (throttled to
at most 10 queries/sec, `APP_SAMPLE_MIN_INTERVAL_S`) rather than once a
minute like the `events_buffer`/app-breakdown bucket does -- so switching
apps mid-minute doesn't smear one app's keystrokes onto another the way it
would with bucket-level sampling. Per-key data collected before this
feature shipped (2026-08-31) has no app attached and shows up filed under
`unknown`.

**"By app" mode (2026-09-01)** is the accurate, local-only version of the
backend's "By app" breakdown that's still hidden on the Today tab -- see
that section's own note above for why the backend one can't be trusted
(once-a-minute app sampling drops any app you weren't in right when the
timer fired). This one instead hits a new `agent.py` endpoint,
`GET /local/apps`, which sums `key_counts` -- the same per-keypress
app-tagged table the "All apps" filter above already reads from --
grouped by app (`Store.app_totals()`), so a quick alt-tab mid-minute is
counted correctly instead of smeared onto whichever app happened to be
focused at a once-a-minute sample instant. It renders through the same
`AppsBreakdown.tsx` component the backend version would have used --
that component was loosened to accept a plain `{app_name, keystrokes}[]`
shape instead of importing the backend-specific `AppStat` type, so both
versions can share one bar-list implementation. One real difference from
the backend version, not just an accuracy fix: this is keystrokes-only.
`key_counts` never tracked mouse clicks per app (only per key), so
there's no local click count to show here even though the hidden backend
version had one.

**"By app" mode gained a day switcher (2026-09-02)** -- prev/next arrows
plus an "All time" reset, same interaction shape as the Today tab's day
switcher on `DayView.tsx`, so it reads as the same control rather than a
new one. The very first prev click from "All time" lands on Today rather
than skipping straight to yesterday (naively shifting `todayIso` back by
one day would do exactly that, since "All time" isn't "today," it's "no
day picked yet" -- worth calling out because it's the one part of this
feature that's easy to get subtly wrong and only notice by actually
clicking through it, which is how it was caught here).

This needed a real schema change, not just a new query: `key_counts` had
never recorded *when* a keystroke happened, only a running lifetime total
per `(key_name, app_name)`, so there was no day to filter by even in
principle. It gained a `local_date` column (`"YYYY-MM-DD"`, from
`time.strftime()` at the moment of the keypress -- `agent.py` already runs
on the viewer's own machine, so unlike the backend's `local_date` there's
no separate "whose clock" question to solve), and its primary key widened
to `(key_name, app_name, local_date)`. Existing installs migrate in place
the same way the `app_name` migration did: old rows get tagged
`local_date='unknown'` since no day was ever recorded for them, rather
than being dropped. That old data still counts fully in "All time" -- it
just can't be attributed to any single day, and never will be able to,
since the day genuinely wasn't captured. Migration safety got extra
scrutiny here specifically because it rewrites a table real accumulated
data already lives in: it was run against an actual copy of a live
`keycount.db` (not synthetic data) and checked row-for-row, byte-for-byte
before shipping, and confirmed idempotent (running it again on an
already-migrated file is a no-op).

`GET /local/apps` gained an optional `?date=YYYY-MM-DD`, loosely validated
(anything that doesn't look like a real date is treated as "no filter"
rather than erroring) and passed through to `Store.app_totals(date=...)`.
List/Keyboard modes initially stayed all-time only -- see the dated
update just below for why that changed the same day. One related fix
caught while making this change: `Store.top_keys()`'s app-filtered branch
used to return one row per `(key, app)` directly, which was only ever
correct because `key_counts` had exactly one row per `(key, app)` before
this migration; now that there's one row per `(key, app, day)`, that
branch needed an explicit `SUM()`/`GROUP BY key_name` too, or an
app-filtered key list would have started showing duplicate rows split
across days instead of one combined total per key.

**Day filtering extended to List/Keyboard (2026-09-02, later same day)**
-- the day switcher was initially "By app"-only, deliberately, on the
assumption day-filtering was only wanted for "which app did I use most
today." That turned out wrong: List/Keyboard wanted it too, for the
mirror question ("which key did I press most today"), so rather than
duplicate a second switcher, the existing one moved up a level -- one
`selectedDate` in `KeysView.tsx`, shared by all three modes, instead of
an apps-only one. Switching between List/Keyboard/By app now keeps
whatever day you had selected rather than resetting it, since it's one
shared control, not per-mode state.

On the agent side, `Store.top_keys()` gained the same optional `date`
parameter `app_totals()` has, and the two filters compose independently
-- `top_keys(app="Editor", date="2026-09-01")` answers "keys pressed in
Editor today," each filter narrowing the SQL `WHERE` clause on its own.
`GET /local/keys` gained the matching `?date=`, same loose validation and
same fallback-to-unfiltered behavior as `/local/apps`. Verified against a
real `agent.py` local server across every filter combination (date alone,
app alone, both together, and a day/app pairing with zero matching data)
before touching the frontend, then end-to-end through Playwright driving
the actual day switcher across mode switches -- including confirming the
selected day survives a switch from List to Keyboard mode rather than
quietly resetting, and that the app dropdown and day switcher combine
correctly rather than one silently overriding the other.

**Leaderboards** (`LeaderboardsView.tsx`, added 2026-09-02) — rankings
with a Global / Friends scope toggle (friends-only added 2026-09-11, see
that dated section below -- Global was the only option before then). Two
metrics as sub-tabs: Keystrokes (with a Today / This week / All time
window selector) and Longest streak (all-time best, no window -- a
streak's "window" is inherently its own history). Your own row is
highlighted and labeled "(you)" if you're on the board. A
`public_profile` entry's username links to `/u/<username>` (a real
`<a href>`, not client routing -- see `App.tsx`'s note on why); an entry
without a public profile renders as plain, unlinked text.

**Friends** (`FriendsView.tsx`, added 2026-09-11) — a standalone
top-level tab (not folded into Leaderboards) for the whole request/accept
lifecycle: search-by-username to send a request, "Requests waiting on
you" (Accept / Decline) and "Requests you sent" (Cancel), and your
current friends list (Remove). One `["friends"]` React Query key backs
all three lists; every mutation just invalidates it rather than
hand-patching each list in place -- see the dated section below.

**Settings** (`SettingsView.tsx`, added 2026-09-02) — currently just the
public-profile opt-in toggle (off by default, matching the backend's own
default). Turning it on reveals your shareable `/u/<username>` URL with a
copy button. Deliberately minimal for now, but the natural home for
future account settings rather than inventing a new tab each time one
shows up -- same reasoning as the backend's `handleGetSettings` comment.

**Public profile page** (`PublicProfilePage.tsx`, added 2026-09-02) — not
a tab; a standalone page at `/u/<username>`, reachable with nobody signed
in. `App.tsx` checks `window.location.pathname` against a `/^\/u\/([^/]+)$/`
regex *before* anything else in the component (including the login gate)
and renders this instead of the normal app shell when it matches -- this
app has no router (see `main.tsx`), so a plain regex on the current path
is the whole routing story for the one URL that needs to exist outside
the tab shell. Shows username, member-since date, and three stat tiles
(total keystrokes, current streak, longest streak) -- nothing else; no
app-by-app or per-key breakdown is ever exposed here, matching what the
Settings tab's own copy tells you before you turn this on. A private or
nonexistent username both render the same "Profile not found" state,
mirroring the backend's identical-404 behavior (see its own comment on
why: no username enumeration via response shape).

**Profile** (`MyProfileView.tsx`, added 2026-09-02, same day as the two
views above) — an authenticated tab showing your OWN username,
member-since date, and full all-time stat set (keystrokes, clicks, active
minutes, current + longest streak). Added after realizing the only
existing way to see "your own profile" was `/u/<username>` -- but that
page 404s while `public_profile` is off, so there was no way to check it,
or just glance at your own headline numbers, without going public first.
This tab sidesteps that entirely: it's authenticated, not gated by the
toggle, so it always works whether or not anyone else can see the public
version. It reads `GET /v1/me/settings` (which grew a `member_since`
field the same day specifically for this -- see the backend README's
matching note) and the same `GET /v1/me/stats?range=all` every other tab
already uses -- no new backend surface beyond that one field. A small
status line at the bottom says whether you're currently public or
private, with a "Manage visibility" button that jumps straight to the
Settings tab (`App.tsx` passes a `setTab` callback down as
`onManageVisibility` -- same one-way data flow the rest of the tab
switching already uses, nothing new).

**Follow-up the same day, later still:** the tab shipped with just the
five stat tiles and felt sparse, so it gained the same 90-day activity
calendar (`Heatmap.tsx`) HistoryView already has -- same component, same
`GET /v1/me/history?days=90` call and query key, so switching between
Profile and History doesn't refetch. Purely additive on the frontend --
no backend change, no new endpoint.
Profile and History doesn't refetch. Purely additive on the frontend --
no backend change, no new endpoint.

**Follow-up the same day, later still again:** the calendar got moved
above the stat tiles (it reads better as the tab's lead than an
afterthought under five tiles), sized up (`cellSize`/`gap` props added
to `Heatmap.tsx`, defaulting to History's original 11px/3px so that
view is pixel-identical to before), wrapped in the same bordered card
style the visibility-status block already used, and centered inside
that card. The card alone wasn't enough -- 90 fixed calendar days is a
narrow, fixed-width grid regardless of how wide the card around it is,
so a bigger card by itself just left it sitting in the top-left corner
of a lot of empty padding. Centering it in the card is what actually
stopped it reading as parked in a corner. Purely additive/frontend
again -- no backend change, no new endpoint, no restart needed for
either agent or backend, and Vite's dev server picks it up on its own
(HMR).

**Follow-up the same day, later still again, again:** the card's border
was reported as flat-out invisible in dark mode (fair -- it was: the
identical `--border` token, at its normal 0.1 opacity, is fine on small
tightly-packed cards like the stat tiles but reads as basically nothing
across a large, mostly-empty panel with nothing beside it to contrast
against). Added a new `--border-strong` token (`index.css`, both
dark and light) at 0.32 opacity and bumped this one card's border to 2px
of it, leaving `--border` and every other card on this and every other
page untouched. Confirmed visible (screenshot + pixel check) in both
dark and light mode before shipping. Frontend-only, no restart needed.

**Follow-up the same day, once more:** turned out that fixed the card's
own outline but not what was actually meant -- the individual day cells
had no border at all, so a zero-activity cell (rendered in `--seq-0`,
which is just `--surface-1`, the same color as the card behind it) was
invisible, and the calendar read as a handful of floating colored
squares with no grid rather than a GitHub-style calendar where every
day -- filled or empty -- is a visible cell. `Heatmap.tsx` now puts a
`1px solid var(--border)` outline on every past/current-day cell (and
the legend swatches); the still-to-come tail end of the current week
stays borderless since those aren't real days yet. This is shared by
both History and Profile (same component), so History's smaller
calendar picked up the same grid outline -- confirmed it still looks
right at that size too. Frontend-only, no restart needed.

## Building for production

```bash
npm run build   # outputs to dist/
npm run preview # serve the production build locally to sanity-check it
```

There's no deploy step wired up yet — that's a later decision (static host
vs. serving `dist/` from the Go backend itself).

## Design notes

- Dark-first CSS tokens in `src/index.css`, with a real light theme (not
  an inverted hack) behind `prefers-color-scheme: light`.
- Colors and chart specs follow the dataviz skill's validated palette —
  single accent hue throughout (this is one person's data, not a
  multi-series comparison), sequential blue ramp for the heatmap.
- No component library — plain inline styles, since the surface area here
  is small enough that a design system would be more overhead than it's
  worth.

## What's deliberately out of scope for this MVP

- **Filtering the chart by app** (design doc mentions this as a stretch
  goal for the History view) — not built yet.
- **Mobile layout** — works down to a phone-ish width by luck of using
  flexbox, but hasn't been deliberately tested/tuned.
- **A "remember me" toggle, or signing out other devices remotely.**
  Session persistence itself works properly as of 2026-09-02 -- both the
  15-minute access token and the 30-day rotating refresh token live in
  `localStorage` (see `api.ts`), and `request()` transparently exchanges
  an expired access token for a new pair before retrying, so a long-lived
  session just works without a special toggle. What's still missing is
  control over it: no "sign out everywhere" button, even though the
  backend's `refresh_tokens.revoked_at` column is already shaped to
  support one.

## 2026-09-02: multi-user + leaderboards phase

Global leaderboards and opt-in public profile pages (both described
above) shipped this phase, alongside backend hardening that had to land
alongside them now that other people's browsers are actually talking to
this API: refresh-token rotation (`api.ts`'s `request()` handles it
silently, see its own comment), a CORS origin allowlist, and per-device
ingest rate limiting. See the backend README's matching dated section for
the full breakdown of those.

Deliberately NOT built this phase: friendships (the leaderboards are
global-only, not friends-only -- a real scope decision, not a placeholder
for "friends-only leaderboards" specifically), and any way to sign out
other devices remotely (see the out-of-scope note above).

## 2026-09-07: daily averages, and a streak reshuffle across Day/Week/Month/All-time

Direct request: a "daily average" row on the Week/Month/All-time tabs,
averaged only over days that actually have recorded activity (backend's
new `active_days` / `avg_*` fields on `/v1/me/stats` -- see that
README's matching note), not the range's full calendar length. Renders
as a second stat-tile row under the totals (`TodayView.tsx`), captioned
with the actual day count ("Averaged over 3 days with recorded
activity.") so the denominator isn't left implicit.

Same request bundled a reshuffle of where the two streak fields live:

- **Current streak** moved off Week/Month/All-time entirely and onto the
  Day view instead (`DayView.tsx`) -- it's inherently an "as of right
  now" number, which fits a single day better than a range. It only
  renders there when the day being browsed IS today though, not on a
  past day: paging to yesterday and still seeing "current streak: 4
  days" would just be the same frozen number every past day showed,
  which is exactly the confusion this component's own top-of-file
  comment used to cite as the reason streaks were kept off this view
  altogether (before this change, current streak lived only on
  Week/Month/All-time). DayView fetches it via a new `["stats",
  "today"]` query -- a small extra request, since current_streak isn't
  part of the 90-day history fetch this view already had.
- **Longest streak** dropped from Week and Month (kept on All-time only)
  -- over a short window it rarely differs from what the totals above it
  already imply, so it stayed only where "longest ever" is actually a
  distinct number: All-time.

No backend change for the streak reshuffle -- `/v1/me/stats` already
returned both fields on every range; this is purely which tab chooses to
render which field.

**Follow-up the same day:** Month got its own bar chart (`MonthChart.tsx`,
direct request: "a graph for the month view similar to week view") --
same hand-rolled bar treatment and click-a-bar-to-open-that-day-in-Day-
view behavior as `WeekChart.tsx`, just 30 bars instead of 7, with day-of-
month numbers under each bar instead of weekday letters (30 repeating
"Sun Mon Tue..." labels would mean nothing at a glance). Deliberately a
separate component rather than a parameterized WeekChart -- duplicating
the ~60 lines keeps Week's already-shipped, already-tested chart
untouched rather than risking it in a refactor for this. `TodayView.tsx`
broadened its 90-day history fetch to also stay enabled for `range ===
"month"` (previously "week" only) and slices the last 30 days off the
same cached fetch, same tradeoff Week's own last-7-days slice already
accepted (a fixed day-count slice vs. the backend's actual calendar-month
range, close enough for a chart). No new backend endpoint. The old
`handleSelectWeekDay` callback was renamed to `handleSelectDay` since
both charts now share it.

## 2026-09-07: "By app" moved to the bottom of the Day view

Direct request, after the daily-average/streak-reshuffle work above went
out: on the Day view specifically, the intraday chart should be
followed immediately by the stat tiles, with "By app" as the last thing
on the page rather than sitting between the timeline and the numbers it
explains. `DayView.tsx`'s section order is now: DayTimeline -> comparison
chips (vs yesterday / vs week avg) -> stat tiles (Keystrokes, Clicks,
Active minutes, and Current streak when the day being browsed is today)
-> the "no activity recorded" message -> "By app" at the very bottom.
Previously "By app" sat directly under the timeline, above everything
else -- that ordering dated back to 2026-09-02, when the section was
first added, and wasn't something touched by this week's other changes.

Frontend-only reorder, no backend or query changes -- same data, same
hooks (`dayAppsQuery` etc.), just moved lower in the returned JSX.

## 2026-09-10: fixed the Day view's "vs 7-day avg" to only count active days

Direct request, after noticing the comparison chip could show today as an
increase over the trailing average while today was still below the Week
tab's own average for the same days. Root cause: `DayView.tsx`'s
`trailingWeekAvg` divided the trailing window's total keystrokes by the
plain count of days in that window (up to 7), including days with zero
activity -- unlike every other average in this app, which only divides by
days that actually had something recorded (`active_days` on the backend,
see `stats.go`'s 2026-09-07 note; and the Week/Month tabs' own "Avg
keystrokes/day"). A quiet day sitting in the trailing window dragged the
average down without anyone noticing, so a below-average day could still
clear that lowered bar and get shown as a gain.

Fixed by filtering the trailing window to days where total_keystrokes,
total_clicks, or active_minutes is nonzero before averaging -- same
"active day" rule the backend already uses. The window itself didn't
change (still up to 7 calendar days strictly before the day being
viewed), just what gets included in the average. The "vs N-day avg"
label right next to it originally switched to showing the number of
active days actually averaged (e.g. "vs 3-day avg"), instead of the raw
window size.

**Follow-up the same day:** that dynamic number in the label got reverted
to a fixed "vs past week avg" instead, per direct request -- a label that
jumps between "vs 3-day avg" and "vs 5-day avg" depending on how many
days happened to have activity was more distracting than clarifying. The
underlying calculation is unchanged (still active-days-only, see above);
only the label went back to static wording.

Frontend-only, no backend change -- `/v1/me/stats` wasn't involved in
this calculation at all, it's purely `DayView.tsx`'s own client-side
math over the 90-day history fetch it already had.

## 2026-09-11: friendships and a friends-only leaderboard scope

Request/accept friendships (`FriendsView.tsx`, new top-level tab -- a
direct choice over folding this into Leaderboards, so the management UI
doesn't crowd a view that's about rankings, not relationships). Add a
friend by username, accept/decline incoming requests, cancel outgoing
ones, remove an existing friend -- see `api.ts`'s new
`fetchFriends`/`sendFriendRequest`/`acceptFriendRequest`/
`declineFriendRequest` (also doubles as cancel)/`removeFriend` calls and
the backend README's matching dated note for the API side.

One `["friends"]` React Query key backs all three lists (friends,
incoming, outgoing); every mutation (`sendMutation`, `acceptMutation`,
`declineMutation`, `removeMutation`) just calls
`invalidateQueries({queryKey: ["friends"]})` on success rather than
hand-patching each list -- this tab isn't expected to see enough traffic
for the extra round trip to matter, and it's a lot less code to get wrong
than reproducing the backend's request/accept/decline logic three times
on the client.

`LeaderboardsView.tsx` gained a Global/Friends scope toggle (new
`LeaderboardScope` type in `api.ts`, `scope` param on both leaderboard
fetch functions) sitting between the metric selector and the window
selector. Friends scope always includes you alongside your friends, so
you can see your own rank even on a friends-only board with just one
friend on it.

Tested with a clean `tsc`/`npm run build` and an 8-check Playwright run
using two separate browser contexts (genuinely separate signed-in
sessions, not one page juggling two accounts) to drive the full
request -> accept -> friends-scoped-leaderboard flow end to end.

## 2026-09-13: routing phase 1 -- a real router, no new pages yet

First step of a bigger plan (public landing/features/download pages in
front of the dashboard, see the project's own notes on that): added
`react-router-dom` and split what used to be one big `App.tsx` -- login
gate, header, tab nav, all seven views, plus a hand-rolled regex check
for `/u/:username` -- into real routes. Deliberately scoped to change
nothing a visitor can see yet, just to get the plumbing right before
building anything new on top of it.

`Dashboard.tsx` now holds the signed-in shell (header, tab nav, the seven
views), moved out of `App.tsx` unchanged. `RequireAuth.tsx` guards
`/app`, redirecting to `/login` when there's no token -- this is the one
place that decision gets made now, replacing the old top-of-`App.tsx`
"if (!token) show Login" check. `LoginRoute.tsx` wraps `Login.tsx`
(itself untouched) with navigation: on success it goes to `/app`, or
back to wherever `RequireAuth` originally redirected from, via router
state. `/u/:username` is a real route now, reading `useParams` instead
of matching `window.location.pathname` against a regex by hand.

`/` is a placeholder for now, `RootRedirect` sends a signed-in visitor to
`/app` and everyone else to `/login` -- the exact behavior the old
gate had, just expressed as a redirect. That placeholder is what the
actual landing page replaces in the next phase.

Tested with a 19-check Playwright run: signed-out visits to `/` and
`/app` both land on `/login`, all seven tabs still work after signing
in, visiting `/login` while already signed in bounces back to `/app`,
an unknown path doesn't dead-end, sign-out re-guards `/app`, and
`/u/:username` still works for both a real public profile and a
nonexistent one, including a hard refresh on each route (Vite's SPA
fallback still serves `index.html` for all of them, same as before).

No backend change, no `.env` change -- this is entirely a `web/`
restructure.

## 2026-09-13: routing phase 2 -- landing, features, and download pages

Second step of the plan phase 1 set up for. "/" is the real landing page
now, replacing phase 1's RootRedirect placeholder -- it renders for
every visitor, signed in or not. A signed-in visitor doesn't get
redirected away from it; PublicNav and the hero both show a "go to your
dashboard" link instead. `/features` and `/download` are new public
pages alongside it, all three sharing a new `PublicNav.tsx`.

Content on `/features` is pulled from the root README and the design
doc, not invented -- tracking behavior, dashboard views, the social
features, and the privacy posture, grouped the same way this README
already describes them.

`/download` is deliberately honest rather than aspirational: there are
no packaged installers yet, that's a later phase (PyInstaller builds +
a GitHub Actions release workflow). Until then it's a "run from source"
quick start per OS (macOS and Windows), sourced from the root README's
own requirements section. The Windows tab also flags plainly that
per-app detection is macOS-only for now, keystroke/click counting works
fully on Windows already, the per-app breakdown doesn't yet.

One layout bug caught during testing, not by inspection: `PublicNav`'s
`<nav>` sits inside a `display: flex; flexDirection: column` wrapper on
the landing page (not on `/features` or `/download`, which don't wrap it
in a flex container), and a flex item with `margin: auto` set on the
cross axis loses the default stretch-to-fill behavior, shrinking to
content width instead of reaching its `maxWidth: 1100` cap. Fixed with
an explicit `width: "100%"` on the nav so it actually stretches before
`margin: auto` centers it, same fix pattern as any other centered-column
component in this app that happens to live inside a flex parent.

Tested with a 19-check Playwright run: the landing page renders (not a
redirect) for both signed-out and signed-in visitors, the nav's Sign
in/Go to dashboard link reflects auth state correctly, Features and
Download both load with their expected content, the Windows tab shows
the per-app caveat and hides the macOS-only pyobjc step, sign-in still
lands on `/app`, and sign-out now lands on the real `/` landing page
instead of jumping straight to `/login` (an intentional behavior change
from phase 1, where `/` was still just a redirect placeholder).

No backend change, no `.env` change -- this is entirely a `web/`
restructure, same as phase 1.

## 2026-09-14: Download page follows agent.py's Windows support

Phase 3 of the plan landed on the agent side (`agent.py`'s
`get_foreground_app` gained a Windows branch via `pywin32` -- see the
root README's own note). This is the small matching update on the web
side: `/download`'s Windows tab no longer carries the "per-app detection
is macOS-only" caveat it shipped with in phase 2, and its "run from
source" steps now mirror the macOS tab's exactly, `pip install pywin32`
in place of `pip install pyobjc-framework-Quartz`, both marked optional
the same way.

No routing change, no new page, just `DownloadPage.tsx` catching up to
what the agent can actually do now. Re-ran the phase 2 Playwright suite
with its two Windows-tab checks updated to match (caveat gone, pywin32
step present instead of the macOS one) -- all 19 checks still pass.

## 2026-09-14: packaged downloads -- PyInstaller + a GitHub Actions release workflow

Phase 4 of the project plan: `/download`'s buttons are real now. Each OS
tab links to
`https://github.com/Yonugy/KeyCount/releases/latest/download/<asset>`,
GitHub's URL that always resolves to whatever the newest release
publishes -- built by `.github/workflows/release.yml` (macOS + Windows
PyInstaller builds via `keycount-agent.spec`, triggered by pushing a
`v*` tag) and updated automatically each time a new tag ships, no
`DownloadPage.tsx` change required per release.

The "run from source" instructions stay underneath as a secondary path
-- both for people who'd rather not run someone else's unsigned binary,
and as the only thing that works before a first release has ever been
tagged (the release-asset links 404 until then; the page's own caveat
text says so).

Re-ran the phase 2 Playwright suite (still 19/19, one selector updated
for the new "Prefer to run from source?" heading text) plus 10 new
checks for the download links/asset names/caveat copy -- all pass.

## Next

Cut the first real release (`git tag v0.1.0 && git push origin v0.1.0`)
to actually populate `/download`'s buttons -- until a release exists,
they 404 and visitors fall through to "run from source". After that,
phase 5 (the space-background/animated-button visual pass) from the
project plan, or whatever `../ROADMAP.md` calls out next.

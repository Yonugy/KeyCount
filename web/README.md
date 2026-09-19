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

## 2026-09-16: phase 5 -- space background and arcade buttons on the landing hero

Scope decided up front rather than guessed at: starfield only (not the
flying-letters idea from the original pitch -- picked as the single
background effect so the hero text stays legible over it), click sound
off by default with a visible toggle to turn it on, and all of this
confined to the landing page's hero -- Features, Download, and
everything below the hero on `/` itself keep the plain existing look.

Three new pieces:

- `Starfield.tsx` -- a canvas-drawn field of slowly drifting, gently
  twinkling stars behind the hero. Respects `prefers-reduced-motion`:
  drawn once and left static for anyone with that preference set,
  instead of just slowing the animation down.
- `clickSound.ts` -- no audio file shipped. Two very short Web Audio API
  blips synthesized on the fly, a higher "tik" on press and a lower
  "tak" on release, the same mechanical-switch idea as a real arcade
  button. Muted by default, `SoundToggle.tsx` is the only way a visitor
  turns it on.
- `ArcadeButton.tsx` -- swaps in for the hero's two CTAs (Download, See
  what it does). Presses down and pops back up on mouse/touch, calling
  the click sound functions above when sound is on.

The hero gets a fixed dark background regardless of the site's own
light/dark theme -- a space scene doesn't read as one rendered on a
white background -- while `PublicNav` and everything below the hero
keep using the normal theme tokens untouched.

Known gap, flagged rather than left quiet: the press animation and
click sound fire on mouse/touch events, not on keyboard activation
(Enter/Space on a focused link fires a plain click, no mousedown/mouseup
either side of it). Navigation itself still works fine by keyboard,
it's only this decorative flourish that's mouse/touch-only for now.

Verified with Playwright: the starfield canvas renders only on `/` (not
Features/Download), the sound toggle flips state correctly, a real
mousedown/mouseup on the Download button produces the expected
translateY + inset-shadow "pressed" look (checked via computed style,
not just eyeballing a screenshot), the page still loads cleanly under
`prefers-reduced-motion: reduce`, and there are no console/page errors
on load. Screenshotted at desktop and phone widths and in light mode to
confirm the rest of the page (nav, highlight cards, footer) still themes
normally.

## 2026-09-16: typewriter headline + a softer hero-to-content seam

Two small follow-ups to the same day's phase 5 work, both suggested as
"what's still missing" feedback after seeing it live:

- `Typewriter.tsx` -- the hero headline now types itself out one
  character at a time on load, with a blinking terminal-style cursor
  that keeps going once it's done. Ties the page's one animation to
  what the product actually does (typing), instead of being separate
  from it. Skips straight to the full headline, no animation, under
  `prefers-reduced-motion`, same as `Starfield.tsx` and `ArcadeButton`.
- A gradient div at the bottom of the hero fades the dark space
  background into `var(--plane)`, the same page-background token the
  section below it already sits on, in whichever theme is active.
  Replaces what used to be a hard line where the hero met the content
  below.

The phase 2 Playwright suite's headline check now waits for the type-out
to finish (`page.wait_for_function` polling the rendered text) rather
than reading the headline the instant the page loads, since the full
string isn't there immediately anymore, that's the point. All 19 checks
still pass, plus new checks confirming the headline is genuinely partial
partway through, complete shortly after, immediate under reduced
motion, and that the gradient div is actually present.

## 2026-09-16: quieter dashboard link, key sounds, and a big animated cursor

Three more requests against the same phase 5 hero, all landed together:

- **The "Already tracking, go to your dashboard" link no longer sits
  under a permanent underline.** It picked up the browser's default
  underline by accident (no `textDecoration` was ever set on it) and
  read as visually heavier than intended next to the arcade buttons.
  New `.kc-quiet-link` utility class in `index.css`: no underline at
  rest, underline back on hover/focus so it's still legible as a link
  and keyboard focus stays visible (`:focus-visible`, not just
  `:hover`).
- **A key-tap sound**, via a new `playKeySound()` in `clickSound.ts` --
  a shorter, higher, quieter blip than the button press/release sounds,
  with a little pitch jitter so a fast run of taps doesn't sound like
  the same note on a loop. Wired in two places, both gated behind the
  existing sound-on preference (`SoundToggle`, off by default):
  - `Typewriter.tsx` plays it once per character as the headline types
    itself out.
  - `LandingPage.tsx` also listens for real `keydown` events on the
    page and plays it for an actual keystroke (modifier-only presses --
    Shift, Control, Alt, Meta, CapsLock -- are filtered out so resting a
    hand on a modifier doesn't sound). **Deliberately scoped to just the
    landing page**, not sitewide -- a listener that reacts to every
    keystroke has no business being active anywhere near a future page
    with a password field, so this doesn't extend to `/login`.
- **A big animated cursor**, `CustomCursor.tsx`, new. A glowing ring
  trails the real pointer with a little lag (lerp/spring easing, not a
  rigid 1:1 follow) and grows and brightens over links/buttons, plus a
  short canvas-drawn particle trail spawned as the pointer moves. It
  layers on top of the real system cursor rather than replacing it --
  `cursor: none` is never set anywhere -- since hiding the OS cursor
  would be a real accessibility regression (precise pointing, screen
  magnifiers, and OS cursor accommodations all depend on it being
  there). Fully skipped -- no listeners attached, nothing drawn -- under
  `prefers-reduced-motion` and on any device without a real mouse
  (`(hover: hover) and (pointer: fine)` fails on touch/coarse-pointer
  devices). Mounted once inside `PublicNav.tsx`, the one component
  already shared across exactly Landing/Features/Download, so it
  reaches all three without each page wiring it up. **Also deliberately
  scoped**: it does not reach `/login` (outside `PublicNav`) or the
  authenticated dashboard app (its own separate nav) -- Login for the
  same reason as the key sound above, and the dashboard because it's a
  working tool someone uses all day, not a themed marketing page.

New Playwright checks (`phase5b_test.py`, not yet folded into the main
suite file) cover: no underline at rest / underline on hover for the
quiet link; the typewriter firing oscillator-level key sounds while
sound is on; real `a`/`b` keydowns firing additional sounds while
`Shift` alone doesn't; no sounds at all with the pref left at its
off-by-default state; the cursor ring and particle canvas present on
all three public pages; the real cursor never hidden; and, on `/login`
specifically, neither the cursor nor the keydown sound listener present.
All 19 checks in the main phase 2 suite still pass unchanged.

## 2026-09-16: click sounds everywhere, an orange re-theme, and a real cursor

Three more requests against the same phase 5 hero, this round widened to
the whole app rather than just the public marketing pages:

- **Click sound on every real button, sitewide.** A new
  `playClickSound()` in `clickSound.ts`, and a new
  `GlobalClickSound.tsx` mounted once at the app root in `App.tsx` (so
  it's active on every route, not just the three public pages) that
  delegates a single `click` listener to any `<button>` or
  `[role="button"]` on the page and plays the sound, skipping disabled
  buttons. This now covers the Login submit button and everything in the
  signed-in Dashboard (tabs, sign out, settings toggles) in addition to
  the public pages. It's deliberately scoped to real buttons, not every
  clickable thing -- the arcade CTAs on the landing hero render as an
  `<a>`, not a `<button>`, and already have their own press/release
  sound from `ArcadeButton.tsx`'s own `mousedown`/`mouseup` handlers, so
  the two never double up. Still gated by the existing sound-on
  preference, off by default.
- **The whole site's accent color moved from blue to orange**, at
  request, including the dashboard's charts and keyboard heatmap, not
  just the marketing pages. Turns out the entire app already draws from
  one CSS custom property (`--accent` in `index.css`, plus its
  `--seq-1..5` sequential ramp for the heatmap) rather than scattered
  hardcoded hex values, so this was a token swap rather than a
  file-by-file hunt. The new orange values were picked and checked with
  the same contrast tooling the dataviz skill ships
  (`validate_palette.js`'s `contrast()` and `validateOrdinal()`),
  targeting the outgoing blue palette's own numbers as the bar to clear
  rather than an arbitrary new standard -- see the comments directly
  above `--accent` and the `--seq-*` block in `index.css` for the exact
  before/after contrast ratios and why a brighter orange than the one
  chosen would have looked great as text but made white button labels
  unreadable.
- **The cursor effect was rebuilt from scratch** after direct feedback
  that the old glowing ring read as "a circle following the mouse," not
  a mouse, and that the particle trail looked messy. `CustomCursor.tsx`
  now renders a real arrow-cursor glyph (an SVG, not a canvas shape),
  sized well above a normal pointer, tightly spring-follows the real
  cursor so its tip sits right on top of the actual pointer position
  instead of trailing behind, grows and glows on hover the same as
  before, and now also reacts to clicks: a quick squish on press and an
  expanding fading ring burst on release, which is the "click animation"
  that was missing entirely before. The trail is a tapered comet-style
  stroke plus a few small drifting sparkles rather than a scatter of
  flat dots, meant to read as intentional and to echo the hero's
  starfield rather than looking bolted on. The glyph's fill uses
  `var(--accent)` directly so it always matches the live theme color
  (including light/dark) without this component needing to track the
  current hex itself; the canvas-drawn trail and burst read the
  resolved color once via `getComputedStyle` and refresh it if the OS
  color scheme changes while the page is open. Scope is unchanged from
  before (Landing/Features/Download only, via `PublicNav.tsx`, not Login
  or the Dashboard) -- that wasn't part of this round's request, so it
  wasn't touched.

New Playwright checks (`phase5c_test.py`) cover: the new orange
`--accent` value in both light and dark color-scheme emulation, the old
ring being gone and the new arrow glyph present and tracking the mouse,
the click burst actually drawing non-transparent pixels on its canvas,
the Login submit button and the Dashboard "Sign out" button both firing
a click sound, and the arcade CTA still firing exactly its own two
press/release sounds rather than three (confirming the new global
listener doesn't double up with it). All checks in the earlier phase 2
and phase 5b suites still pass unchanged.

## 2026-09-16: hover sounds, and the navigation links finally make noise

A same-day follow-up to the click-sound-everywhere and orange re-theme
work above, after feedback that hovering was silent and that PublicNav's
own links (Features, Download, Sign in / Go to dashboard) never made a
sound at all.

The root cause for the second one: `GlobalClickSound.tsx`'s delegated
listener only ever matched real `<button>` elements (and
`role="button"`), and PublicNav's links are plain `<a>` tags, so they
were never in scope. Rather than just adding them to the same bucket,
this became three distinct sound "voices" so a hover/click actually
tells you what kind of control you're on, per the "give special buttons
a different tune" ask:

- **Generic buttons** (dashboard tabs, sign out, settings toggles, the
  sound toggle, the login submit button) -- unchanged click tune, plus a
  new soft sine-wave `playHoverSound()` for hovering them.
- **Nav links** (`PublicNav.tsx`'s own Features/Download/logo/Sign-in-or-
  dashboard-pill) -- a new triangle-wave `playNavClickSound()` /
  `playNavHoverSound()` pair, pitched higher and airier than the generic
  buttons specifically so it reads as a different kind of control, not
  just a quieter version of the same click.
- **CTA-style accent buttons** (the arcade hero buttons, and the
  Download page's actual accent-colored Download button, which was the
  other reported gap -- it's a plain `<a>` too, not the ArcadeButton
  component, so it never had sound either) -- kept their own bespoke
  handlers rather than going through the delegated listener, so the
  sound stays exactly in sync with the press animation. `ArcadeButton.tsx`
  and `DownloadPage.tsx` both gained a matching `onMouseEnter` ->
  `playCtaHoverSound()`, a new quiet blip in the same square-wave family
  as the existing press/release tones (`clickSound.ts`), pitched between
  them so hover -> press -> release reads as one three-note gesture on
  the same "instrument."

`GlobalClickSound.tsx`'s selector grew from `'button, [role="button"]'`
to `'button, [role="button"], nav a'`, plus a `mouseover`-based delegated
hover handler alongside the existing click one (mouseenter/mouseleave
don't bubble, so it tracks the last-matched element itself and only
fires when that match actually changes). The three voices don't collide
with each other by construction, not by an explicit exclusion list: the
CTA buttons are `<a>` tags that sit outside any `<nav>` and aren't real
`<button>`s either, so neither of the delegated selectors ever matches
them in the first place.

New Playwright checks (`phase5d_test.py`) confirm: hovering and clicking
the Features nav link both make sound now, the nav tune is genuinely the
triangle-wave family (not the generic click reused at a different
volume), the sound toggle button gets a generic hover sound, the arcade
CTA's hover stays on the square-wave family rather than picking up the
nav tune, and the Download page's real Download button now fires
hover+press+release. All earlier suites (`routing_phase2_test.py`,
`phase5b_test.py`, `phase5c_test.py`) still pass unchanged -- `phase5b`
had its now-obsolete "ring cursor" shape check removed since `phase5c`
already covers the current arrow-glyph shape.

## 2026-09-16: buttons actually move on hover, and a volume rebalance

Same-day follow-up after feedback that hovering played a sound but
nothing visually reacted, that the navigation sounds were noticeably
quieter than everything else, and that the typewriter's key-taps felt
loud with no real priority between any of these -- three separate but
related balance issues.

**Visual hover, added globally.** Almost every button in the app is
styled with inline `style` objects, which can't express a `:hover`
pseudo-class, so there was previously no way for most controls to react
visually to a hover at all. Rather than hand-wire hover state into every
component, `index.css` gained one shared rule covering `button`,
`[role="button"]`, and `nav a`: a small lift (`translateY(-1px)`) plus a
touch more brightness on hover, a slight press-down on `:active`, skipped
under `prefers-reduced-motion` (falls back to a brightness-only change,
no transform). That covers dashboard tabs, sign out, settings toggles,
the login submit button, and PublicNav's own links in one place. The
arcade hero CTAs and the Download page's real Download button are
deliberately excluded from that shared rule -- they already have their
own JS-driven hover lift (`ArcadeButton.tsx`'s `hovered` state, mirrored
directly in `DownloadPage.tsx`) that has to compose with a *press*
animation too (hover lifts 2px, press pushes 3px past that), which a
plain CSS rule can't coordinate.

**Volume rebalance**, with an explicit three-tier priority now
documented at the top of `clickSound.ts` itself:
- Tier 1, real clicks (CTA press/release, generic buttons, nav links) --
  the nav click was quietly under-volumed at 0.11 gain against the
  generic click's 0.13; it's 0.13 now, matching it, since following a
  nav link is just as deliberate an action as clicking a button.
- Tier 2, hover previews -- same story for nav hover, bumped from a
  barely-audible 0.05 up to 0.07 to match the generic hover.
- Tier 3, ambient/decorative (the typewriter's per-character key-tap) --
  cut from 0.09 down to 0.045. This one isn't like the others: it fires
  once every ~45ms while the headline types out, so even a modest
  per-blip gain compounds into something that reads as loud in
  aggregate. It needed to start well below the click/hover tiers, not
  just a little under them, to land at a comparable perceived loudness.

**A separate, softer click tune for the signed-in dashboard.** Reported
directly: switching dashboard tabs, signing out, and toggling settings
happens far more often per session than clicking a button anywhere else
in the app, and the sharp square-wave generic click got grating under
that much repetition. `GlobalClickSound.tsx` now checks
`window.location.pathname.startsWith('/app')` and routes real-button
clicks there to a new `playDashboardClickSound()` -- lower-pitched (480Hz
vs 780Hz) and on a gentler sine wave rather than square, still Tier 1
loudness. The login submit button (a one-off action, not repeated
clicking) stays on the ordinary generic click tune; only the dashboard
itself gets the softer one.

New Playwright checks (`phase5e_test.py`) instrument both the oscillator
type/frequency and the gain envelope's actual peak value (not just which
tune played) to confirm: hovering a nav link and a generic button both
now move the element (and don't under reduced motion), the nav
hover/click peaks now clear the same floor as the generic tiers, the
typewriter's peak stays well below a real click's, dashboard tab clicks
use the new sine/480Hz tune, and the login submit button still uses the
ordinary square/780Hz one. All earlier suites still pass unchanged.

## 2026-09-16: the landing page actually has something to scroll to now

Direct feedback: the landing page "kinda lack something... in terms of
information... maybe some graphics like icon and stuff," and had
"nothing to even scroll." Fair -- the hero was the whole page. Three
things landed, all below the hero, none of it touching the hero itself:

**A real product screenshot**, not a mockup. Rather than hand-draw a
fake dashboard, a throwaway backend + frontend pair was spun up, a test
account seeded with ~21 days of generated sample activity via
`POST /v1/ingest/batch` (a realistic workday shape: ramp-up, a lunch
dip, an evening taper, a couple of skipped rest days so the streak looks
like a person's, not a script's), and the actual Today view screenshotted
with Playwright against that seeded account. The image lives at
`public/dashboard-preview.png` and is captioned "Sample dashboard shown
with seeded demo data" directly under it -- explicit, not fine print,
since letting a demo account's numbers pass as real user activity would
be the same kind of dishonesty as a fabricated testimonial. (No
testimonials, reviews, or social-proof numbers were added anywhere on
this page, same as before -- there are no real users yet to attribute
those to.) The screenshot sits in a small rounded frame with a
three-dot "window chrome" strip on top, mostly so it reads as "a
picture of the app" rather than part of the page's own layout.

**Icons on the three highlight cards.** `Local-first`, `Streaks and
history`, and `Leaderboards, global or friends` previously had no visual
distinction beyond their text. Each now gets a small inline SVG
(shield / flame / trophy) on an accent-colored tile above its heading --
plain stroke-style icons sharing one visual language (24x24 viewbox,
`currentColor`, 1.75 stroke), hand-written directly in
`LandingPage.tsx` rather than pulling in an icon library for three
glyphs.

**A three-step "How it works" strip** (install -> runs quietly in the
background -> check your dashboard), each step in a numbered circle in
the accent color. Added mainly for scroll depth and to spell out "what
actually happens" in plain language, since the hero's copy alone doesn't
walk through the actual flow.

Together these took the landing page from one screen-height with
nothing below the fold to a real page with four distinct sections after
the hero. `phase6_test.py` checks: the screenshot section's heading and
caption are present, the preview image actually loads
(`naturalWidth > 0`), at least three inline SVGs render, all three
how-it-works steps are present by name, the page's `scrollHeight` now
clears 1.5x a normal viewport height (the literal "nothing to scroll to"
complaint), and all three original highlight cards are still intact.
All five earlier suites (62 checks) still pass unchanged.

## 2026-09-16: the sound toggle reaches the dashboard too

Direct request: "add the mute unmute button in the logged in dashboard
also" -- until now `SoundToggle.tsx` only ever rendered on the landing
page hero, so there was no way to turn dashboard click sounds on/off
without signing out first.

`SoundToggle` gained a `variant` prop (`"hero" | "subtle"`, default
`"hero"` so the landing page is untouched). The hero variant keeps its
original look, built for sitting directly on the hero's fixed dark
background regardless of the site's own theme. The new `"subtle"`
variant uses the same theme tokens (`var(--border)`, `var(--text-
secondary)`) the dashboard's own `Sign out` button already uses, so it
reads correctly in both light and dark mode instead of rendering
near-invisible white-on-white. `Dashboard.tsx` now renders
`<SoundToggle variant="subtle" />` in its header, immediately to the
left of `Sign out`. Its label also changed from "Click sound: on/off"
to just "Sound: on/off" now that it controls sound in two different
places, not only click sound on one page.

No new plumbing was needed beyond that: the toggle button is a plain
`<button>`, so it automatically inherits the sitewide hover animation
and the dashboard's own softer click tune from the existing global
rules, same as every other control in the header.

Verified manually (seeded test account, light + dark screenshots of the
header) that the toggle sits correctly next to Sign out, flips
`keycount:soundEnabled` in localStorage on click, and that state
persists across tab switches within the dashboard. All existing suites
still pass.

## 2026-09-16: fixed a silent click on the day switcher's Next button

Reported directly, and precisely: "when i click the right button in
yesterday view, there is no sound effect, but other day all got sound
effect... i want to go to next day (today view), there is no button
clicked sound effect." Confirmed with a Playwright repro before touching
anything -- clicking Next from any other day correctly played hover then
click notes, but the one click that landed exactly on Today played only
the hover note, silently dropping the click.

The cause: `DayView.tsx`'s Next button (`canGoNext = selectedDate <
todayIso`) disables itself once you're on Today, since there's no
further day to go to. Clicking Next from Yesterday both navigates to
Today *and*, as a side effect of that same click, disables the very
button that was just clicked. `GlobalClickSound.tsx`'s delegated click
listener was registered on the bubble phase, same as everything else
sound-related in the app -- but React 18 flushes state updates from a
native event synchronously before that event finishes bubbling past the
app root up to a plain `document` listener. So by the time this handler
ran and checked `isDisabled(el)`, the button's real `disabled` attribute
had already flipped to `true` (set by React a moment earlier in the same
event), and the click sound got skipped as if the button had been
disabled all along -- even though it was a completely ordinary, enabled
click. Nothing else in the app hits this, since the day switcher's
Next/Previous buttons are the only controls whose own click can disable
themselves.

Fixed by switching just the click listener (`document.addEventListener
("click", handleClick, true)`) to the capture phase, which runs on the
way *down* to the clicked element, before its own `onClick` (and
therefore before React's re-render) fires -- so `isDisabled` always
reads the button's state as it actually was at the moment of the click.
`mouseover` stays on the bubble phase unchanged; hovering never changes
a button's disabled state, so it was never affected.

`phase7_test.py` (new) seeds a 3-day test account and checks: the exact
reported case (Next from Yesterday, landing on Today) now plays its
click note; an ordinary Next click that doesn't land on Today still did
and still does; hovering the button still sounds; and no console errors
from repeatedly hitting the boundary (clicking Previous again once
already on the oldest available day). All earlier suites still pass
unchanged.

## 2026-09-16: clicks nudged louder, and the starfield now covers the whole landing page

Two small, unrelated requests handled together:

**Click sounds, slightly louder.** Direct request: "make it slightly
more noticeable." `playClickSound()` (generic buttons) and
`playNavClickSound()` went 0.13 -> 0.15 gain, `playDashboardClickSound()`
went 0.10 -> 0.12 -- all three Tier 1 click sounds, proportionally, so
the documented balance between them (dashboard clicks softer than
generic, nav matching generic) holds exactly as before, just a bit
louder across the board. Hover (Tier 2) and the typewriter (Tier 3)
were untouched -- the request was specifically about clicks.

**Starfield now backs the entire landing page, not just the hero.**
Direct feedback: "the star effect only on top tho. dont u think it
should cover the whole page?" Confirmed the direction first (whole
landing page dark, vs. the whole site always-dark, vs. a
theme-aware version everywhere) since going wider than "just the hero"
means picking one of those, and they're meaningfully different asks --
landed on: the entire landing page goes permanently dark, Features/
Download/the signed-in Dashboard stay exactly as they are, still
following the visitor's own light/dark theme.

`Starfield` now renders once in a `position: fixed` layer behind the
whole page (`zIndex: 0`, with the real content in a `zIndex: 1` wrapper
on top) instead of living inside just the hero's `<main>`. Fixed rather
than sized to the page's scroll height -- it just covers the viewport
as you scroll, no resize math needed for "how tall is this page today."
Every section below the old hero (the screenshot, the three highlight
cards, how-it-works, the footer) switched from the theme-reactive
`var(--text-primary)` / `var(--surface-1)` / `var(--border)` tokens to
the same hardcoded light-on-dark colors the hero always used -- those
tokens flip with the visitor's system theme, which would have put dark
text on this now-permanently-dark page for anyone in light mode.
`var(--accent)` was left alone (the icon tiles, the how-it-works step
circles), matching how `ArcadeButton` already uses it inside the hero.

`PublicNav.tsx` gained a `variant` prop (`"auto" | "dark"`, default
`"auto"`) for the same reason -- it's shared with Features and Download,
which still need their normal theme-reactive nav colors, so only the
landing page passes `variant="dark"` to get hardcoded white/rgba-white
text instead.

`phase5_test.py`'s three oldest starfield-scope checks got fixed rather
than left stale: they were asserting `main canvas` specifically (the
canvas moved out of `<main>` in this change) and `canvas count() == 0`
on Features/Download (already inaccurate before this change too, since
CustomCursor's own canvas mounts on those pages -- an earlier-phase
addition that check predated). New `phase8_test.py` covers this round
directly: the starfield canvas sits outside `<main>` in a fixed-position
wrapper, the landing page's outer background is the fixed dark color,
a highlight card's title renders as literal white text (not a
theme-reactive token), the landing nav logo is forced white, and
Features/Download still show exactly one canvas (cursor only, no
starfield) with their nav unaffected. All eight other suites still pass
unchanged.

## 2026-09-16: the sound toggle's own click went silent (a side effect of the earlier capture-phase fix)

Reported directly, bluntly, and accurately: "i literally didnt hear a
sound anymore in the logged in page anymore." Reproduced first --
turning sound ON via the toggle played nothing on that click, while
every click afterward (tab switches, etc.) worked completely normally.
That first silent click is exactly the kind of thing that reads as
"sound is broken" rather than "one specific click is quiet," especially
if nothing else gets clicked right after.

The cause: a direct side effect of the capture-phase fix from earlier
today (the one that fixed the day switcher's Next button). That fix made
`GlobalClickSound.tsx`'s delegated listener check `isSoundEnabled()` on
its way *down* to the clicked element, before that element's own
`onClick` runs. For the sound toggle specifically, that means the
delegated listener always reads the sound preference from *before* this
click, which for the one click that turns sound on is always "off" --
so it correctly (per its own logic) stays silent, even though the
visitor just turned sound on with that exact click. Turning sound back
off was never affected: sound is still genuinely on at the moment that
click is captured, so the delegated listener plays its confirming click
correctly, same as always.

Fixed in `SoundToggle.tsx` itself rather than in the delegated listener:
its own `onClick` now plays a confirming click directly right after
calling `setSoundEnabled(true)`, using the same tune the delegated
listener would have played (the dashboard's softer tune on `/app`, the
ordinary one everywhere else) so it's indistinguishable from any other
click's sound. No risk of double-firing -- the delegated listener still
runs first (capture phase) and still correctly stays silent since sound
was off a moment earlier, so exactly one click plays, not two. The
off-to-on direction was the only one needing this; the on-to-off
direction was already correct and untouched.

`phase9_test.py` (new) checks: turning sound on in the dashboard plays
exactly one confirming click (the dashboard's softer sine tune, not the
sharp generic one), turning it back off still plays exactly one click,
an ordinary tab click afterward still fires its normal hover+click pair
with no double-count, and the same "confirming click on enable" behavior
holds on the landing page too, using its own ordinary click tune rather
than the dashboard one. All nine other suites still pass unchanged.

## Next

The site itself still isn't hosted anywhere public -- that's the main
gap before any of this reaches someone other than whoever's running the
dev server. Also still open: a `v0.1.1` agent release, once the
local-database bug found after `v0.1.0` shipped (see `agent.py` and the
root README) has been retested on real hardware, since that fix hasn't
been tested outside this project's Linux dev sandbox yet. Otherwise,
whatever `../ROADMAP.md` calls out next.

import type { DayStat, DayBucketPoint } from "./api";

// A Date's LOCAL calendar day as "YYYY-MM-DD" -- never .toISOString(),
// which always serializes in UTC. For anyone not exactly on UTC, that
// silently shifts every date by a day: at any positive UTC offset, local
// midnight "today" converts to a UTC timestamp still on the *previous*
// day, so .toISOString() reports "today" as "yesterday" -- systematically,
// every single day, not just near the boundary. This is what made the
// history chart and activity calendar appear to stop at yesterday.
export function toLocalISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Add (or subtract, with a negative deltaDays) whole days to a
// "YYYY-MM-DD" string, staying in local-calendar terms throughout --
// parses via the local Date constructor (not `new Date(iso)`, which
// treats a bare date string as UTC midnight and reintroduces the same
// off-by-one-day risk toLocalISODate exists to avoid).
export function shiftLocalDate(iso: string, deltaDays: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + deltaDays);
  return toLocalISODate(date);
}

// Conversational day label for a date picker (DayView) -- "Today" /
// "Yesterday" where they apply, otherwise a short weekday+date. Distinct
// from Heatmap.tsx's own formatDateLabel (always the short weekday+date
// form, no "Today"/"Yesterday" special-casing) since a grid of 90 cells
// reads worse with two of them singled out, but a single day-at-a-time
// picker reads much better with them.
export function formatDayLabel(iso: string, todayIso: string): string {
  if (iso === todayIso) return "Today";
  if (iso === shiftLocalDate(todayIso, -1)) return "Yesterday";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: new Date(y, m - 1, d).getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}

// The 7 local-calendar dates (Sun..Sat) of the week containing `iso`, as
// "YYYY-MM-DD" strings. Not currently called from anywhere -- it powered
// DayView's week strip, which was replaced by an intraday timeline
// (2026-09-01) and moved to the Week tab in a different form (see
// DayView.tsx's own note). Left here rather than deleted; still exactly
// what a week-at-a-glance view would need if one comes back.
export function getWeekDates(iso: string): string[] {
  const [y, m, d] = iso.split("-").map(Number);
  const dow = new Date(y, m - 1, d).getDay(); // 0 (Sun) .. 6 (Sat)
  const start = shiftLocalDate(iso, -dow);
  return Array.from({ length: 7 }, (_, i) => shiftLocalDate(start, i));
}

// The backend only returns a daily_rollups row for days with activity
// (sparse). The line/area chart needs one point per day -- including
// zeros -- so gaps in activity render as dips, not as missing/skipped
// points that make the line jump across the gap.
export function fillDays(sparse: DayStat[], count: number): DayStat[] {
  const byDate = new Map(sparse.map((d) => [d.date, d]));
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const result: DayStat[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const iso = toLocalISODate(d);
    result.push(
      byDate.get(iso) ?? {
        date: iso,
        total_keystrokes: 0,
        total_clicks: 0,
        active_minutes: 0,
      },
    );
  }
  return result;
}

// The unix-second instants bounding ONE LOCAL CALENDAR DAY (this local
// midnight to the next), for the Day view's intraday timeline
// (`GET /v1/me/day-buckets`). Built with the local `Date` constructor
// (never `new Date(iso)` -- a bare "YYYY-MM-DD" string parses as UTC
// midnight, the exact footgun toLocalISODate exists to avoid, see its own
// comment above), so this is genuinely the viewer's own midnight-to-
// midnight regardless of their offset or DST. `d + 1` is deliberate, not
// `d` plus a separate day-add step -- the Date constructor normalizes an
// out-of-range day field itself (Jan 31 + 1 becomes Feb 1), same trick
// shiftLocalDate already relies on.
export function localDayBoundsUnix(iso: string): { since: number; until: number } {
  const [y, m, d] = iso.split("-").map(Number);
  const since = new Date(y, m - 1, d, 0, 0, 0, 0);
  const until = new Date(y, m - 1, d + 1, 0, 0, 0, 0);
  return { since: Math.floor(since.getTime() / 1000), until: Math.floor(until.getTime() / 1000) };
}

// "1,234 (54%)"-style share label, shared by AppsBreakdown and KeysView's
// per-key list (2026-09-02) -- both are ranked bar lists where "how much
// of the whole does this one row account for" is the natural companion to
// the raw count already shown. `total` is the sum of whatever list is
// currently on screen (the filtered/ranged set, not some separate
// all-time figure neither component has on hand), so the percentages
// shown always add up to ~100% across the visible rows. Rounds to a whole
// percent like the rest of this app's numbers (no decimals anywhere
// else), but a nonzero count that rounds down to 0% shows "<1%" instead
// of a flat "0%" -- "3 (0%)" reads as "this didn't count," which isn't
// true.
export function formatShare(value: number, total: number): string {
  if (total <= 0) return "0%";
  const pct = (value / total) * 100;
  const rounded = Math.round(pct);
  if (rounded === 0 && value > 0) return "<1%";
  return `${rounded}%`;
}

export interface HourlyPoint {
  hour: number; // 0-23, LOCAL hour of day
  keystrokes: number;
  clicks: number;
}

// Folds the day-buckets endpoint's sparse per-minute points into 24
// local-hour totals. "Local" here falls out for free: as long as the
// points were fetched with localDayBoundsUnix() for this exact day, every
// bucket_start_ts in the response already falls somewhere in that one
// local day, so reading .getHours() off it (the browser's own clock, not
// UTC) lands each point in the right 0-23 slot with no further timezone
// handling needed -- see day_buckets.go's handler comment for why the
// backend deliberately stays out of this entirely.
export function bucketByLocalHour(points: DayBucketPoint[]): HourlyPoint[] {
  const hours: HourlyPoint[] = Array.from({ length: 24 }, (_, hour) => ({ hour, keystrokes: 0, clicks: 0 }));
  for (const p of points) {
    const hour = new Date(p.bucket_start_ts * 1000).getHours();
    hours[hour].keystrokes += p.keystrokes;
    hours[hour].clicks += p.clicks;
  }
  return hours;
}

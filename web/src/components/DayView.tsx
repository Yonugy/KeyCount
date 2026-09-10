import { useState, useEffect, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchHistory, fetchDayBuckets, fetchDayApps, fetchStats, type DayStat } from "../api";
import { fillDays, toLocalISODate, shiftLocalDate, formatDayLabel, localDayBoundsUnix, bucketByLocalHour } from "../utils";
import StatTile from "./StatTile";
import RefreshStatus from "./RefreshStatus";
import DayTimeline from "./DayTimeline";
import AppsBreakdown from "./AppsBreakdown";

// Same 90-day window (and query key) as HistoryView -- switching between
// Day and History reuses the same cached fetch rather than re-requesting.
const HISTORY_WINDOW_DAYS = 90;
const SYNC_LAG_REFETCH_MS = 30_000; // see TodayView's own note on why 30s

const arrowButtonStyle = (enabled: boolean): CSSProperties => ({
  background: "var(--surface-1)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  width: 32,
  height: 32,
  color: enabled ? "var(--text-secondary)" : "var(--text-muted)",
  fontSize: 16,
  lineHeight: 1,
  cursor: enabled ? "pointer" : "default",
  opacity: enabled ? 1 : 0.4,
});

// Percent change of `current` vs `baseline`, or null when there's no
// meaningful baseline to compare against (no prior data, or the baseline
// itself is zero -- a "+infinity%" reading off a zero baseline would be
// more misleading than showing nothing, in the same spirit as why the
// "By app" breakdown got hidden elsewhere in this app: don't show a
// number that looks precise but isn't honestly comparable).
function compareToBaseline(current: number, baseline: number | null): { text: string; tone: "up" | "down" | "flat" } | null {
  if (!baseline) return null;
  const pct = Math.round(((current - baseline) / baseline) * 100);
  if (pct === 0) return { text: "on par", tone: "flat" };
  return { text: `${Math.abs(pct)}%`, tone: pct > 0 ? "up" : "down" };
}

function deltaColor(tone: "up" | "down" | "flat"): string {
  return tone === "up" ? "var(--success)" : "var(--text-muted)";
}

function deltaArrow(tone: "up" | "down" | "flat"): string {
  return tone === "up" ? "▲" : tone === "down" ? "▼" : "–";
}

// Fitness-app-style single-day view: step backward/forward one day at a
// time (bounded to the fetched history window on one side, today on the
// other) instead of only ever being able to see "today" or a whole
// week/month lump sum. Longest streak stays off this view entirely --
// it's an all-time record, not something that belongs to any one day.
//
// Current streak (2026-09-07, direct request) moved here FROM the
// Week/Month/All-time tabs -- "kinda irrelevant" there, and it's this
// view's single-day nature that actually fits it: unlike a range view, a
// specific day is either "today" (streak is live and meaningful) or a
// day in the past (the streak as of right now says nothing about that
// day specifically). So the streak tile below only renders when
// selectedDate is today -- exactly the "frozen/confusing while paging"
// problem this same comment used to cite as the reason to exclude
// streaks altogether, just resolved by conditioning on today rather than
// by keeping it off this view.
//
// Added 2026-08-31 (later same day): comparison chips (vs yesterday / vs
// trailing average) and a "Best day" badge -- computed client-side from
// the same 90-day history fetch, no new backend calls.
//
// Added 2026-09-01: an intraday timeline (DayTimeline, 24 hourly bars)
// replaces what used to sit here -- a 7-bar "week strip" showing the
// surrounding Sun-Sat week. That visualization moved to the Week tab
// instead (TodayView.tsx), which is where a week's worth of days
// actually belongs; a single-day view showing a week of context bars
// never quite fit, and "when during THIS day was I active" is a much
// more natural fit for a page that's already about one specific day. The
// week-strip code is commented out below rather than deleted, in case
// it's wanted back in some form.
//
// Added 2026-09-01 (later same day): accepts an optional starting date
// from its parent (TodayView) -- lets the Week tab's chart open this view
// on the specific day you clicked, rather than always defaulting to
// today. `initialDate` is a one-shot hand-off, not a controlled prop:
// once applied, onInitialDateConsumed tells the parent to clear it, so
// the day switcher's own prev/next/jump-to-today buttons stay in charge
// afterward, and an ordinary switch back to this tab (via the range
// tabs, not a bar click) still opens on today rather than re-applying a
// stale jumped-to date.
//
// Added 2026-09-02: a "By app" breakdown for the selected day (which app
// did I type in the most today, down to sub-minute switches). This is
// the restoration of the feature TodayView.tsx's own "By app" section
// used to have before it got hidden on 2026-08-31 -- it was hidden
// because it was built on a single once-a-minute foreground snapshot per
// bucket, which silently dropped any app you weren't in right when the
// timer fired. That's now fixed at the source: agent.py's flush_bucket()
// tags keystrokes with the actual per-keypress-sampled app (see its own
// comment), and ingest.go dedupes active_minutes so a minute split across
// several app-rows still only counts once. This view fetches the result
// via fetchDayApps -- a new endpoint using the same exact-instant
// since/until window as the intraday timeline below, not
// fetchAppsBreakdown's `range` param (that one resolves "today" as UTC
// midnight, which is wrong for browsing a specific LOCAL day -- the same
// class of bug the local_date fix addressed elsewhere in this app).
interface DayViewProps {
  initialDate?: string;
  onInitialDateConsumed?: () => void;
}

export default function DayView({ initialDate, onInitialDateConsumed }: DayViewProps) {
  const todayIso = toLocalISODate(new Date());
  // Lazy initializer so a fresh mount triggered by a WeekChart bar click
  // opens directly on the right day -- no flash of "today" before an
  // effect corrects it a tick later.
  const [selectedDate, setSelectedDate] = useState(() => initialDate ?? todayIso);

  useEffect(() => {
    if (initialDate) {
      setSelectedDate(initialDate);
      onInitialDateConsumed?.();
    }
    // Deliberately only depends on initialDate -- onInitialDateConsumed
    // is a fresh function identity from the parent on every render, and
    // re-running this because of that (rather than an actual new date)
    // would fight the day switcher's own state right after a jump.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialDate]);

  const historyQuery = useQuery({
    queryKey: ["history", HISTORY_WINDOW_DAYS],
    queryFn: () => fetchHistory(HISTORY_WINDOW_DAYS),
    refetchInterval: SYNC_LAG_REFETCH_MS,
  });

  // Just for current_streak (see this component's own top-of-file note on
  // why it lives here now) -- the range param doesn't affect that field
  // on the backend (streaks is a separate table, not derived from the
  // summed range), so "today" is fetched purely because it's the
  // cheapest range to sum. Query key ["stats", "today"] was previously
  // unused: TodayView.tsx only ever fetches "week"/"month"/"all" (it
  // hands "today" off to this component entirely), so there's no
  // competing fetch to collide with here.
  const streakQuery = useQuery({
    queryKey: ["stats", "today"],
    queryFn: () => fetchStats("today"),
    refetchInterval: SYNC_LAG_REFETCH_MS,
  });

  // Separate query from historyQuery above -- different backend endpoint
  // (/v1/me/day-buckets, raw activity_buckets rather than daily_rollups),
  // different granularity, and it has to re-fetch every time the selected
  // day changes (the query key includes selectedDate) rather than once
  // for the whole 90-day window. Only auto-refetches for today -- a past
  // day's buckets are already final, so there's nothing to poll for.
  const dayTimelineQuery = useQuery({
    queryKey: ["day-buckets", selectedDate],
    queryFn: () => {
      const { since, until } = localDayBoundsUnix(selectedDate);
      return fetchDayBuckets(since, until);
    },
    refetchInterval: selectedDate === todayIso ? SYNC_LAG_REFETCH_MS : false,
  });
  const hourly = dayTimelineQuery.data ? bucketByLocalHour(dayTimelineQuery.data) : undefined;

  // Same since/until window as dayTimelineQuery above, same day-buckets
  // endpoint family, same refetch-only-for-today rule -- a past day's
  // per-app totals are already final. Deliberately a separate query (not
  // folded into dayTimelineQuery) since it hits its own endpoint
  // (/v1/me/day-apps) and has its own loading/error state independent of
  // the timeline's.
  const dayAppsQuery = useQuery({
    queryKey: ["day-apps", selectedDate],
    queryFn: () => {
      const { since, until } = localDayBoundsUnix(selectedDate);
      return fetchDayApps(since, until);
    },
    refetchInterval: selectedDate === todayIso ? SYNC_LAG_REFETCH_MS : false,
  });

  const filled = historyQuery.data ? fillDays(historyQuery.data, HISTORY_WINDOW_DAYS) : undefined;
  const byDate = new Map<string, DayStat>((filled ?? []).map((d) => [d.date, d]));
  const day = byDate.get(selectedDate);
  const oldestAvailable = filled?.[0]?.date;

  const canGoPrev = !oldestAvailable || selectedDate > oldestAvailable;
  const canGoNext = selectedDate < todayIso;
  // Was the week strip's own clickable-bar bounds check -- see the note
  // near weekDates/weekMax below.
  // const inBounds = (iso: string) => iso <= todayIso && (!oldestAvailable || iso >= oldestAvailable);

  // Comparisons: trailing days strictly before the selected one, so
  // browsing to a past day always compares against *its own* recent
  // history, not today's.
  const selectedIndex = filled?.findIndex((d) => d.date === selectedDate) ?? -1;
  const previousDay = filled && selectedIndex > 0 ? filled[selectedIndex - 1] : undefined;
  const trailingWeek = filled && selectedIndex > 0 ? filled.slice(Math.max(0, selectedIndex - 7), selectedIndex) : [];
  // Only average over days that actually had recorded activity (2026-09-10,
  // direct request) -- same "active day" definition the backend uses for
  // avg_keystrokes/etc on /v1/me/stats (total_keystrokes/clicks/active_minutes,
  // any one of them nonzero). Before this, a quiet day in the trailing window
  // still counted as a full day in the denominator, which silently dragged
  // this average down below the Week tab's own (already active-days-only)
  // average -- so "today" could show as an increase against this number while
  // still being below that one. Window itself is unchanged: still the up-to-7
  // calendar days strictly before the day being viewed, just no longer padded
  // by the empty ones.
  const activeTrailingDays = trailingWeek.filter(
    (d) => d.total_keystrokes > 0 || d.total_clicks > 0 || d.active_minutes > 0
  );
  const trailingWeekAvg = activeTrailingDays.length
    ? Math.round(activeTrailingDays.reduce((sum, d) => sum + d.total_keystrokes, 0) / activeTrailingDays.length)
    : null;

  const vsYesterday = day && previousDay ? compareToBaseline(day.total_keystrokes, previousDay.total_keystrokes) : null;
  const vsWeekAvg = day && trailingWeekAvg !== null ? compareToBaseline(day.total_keystrokes, trailingWeekAvg) : null;

  // "Best day" within the fetched window, by keystrokes (the primary
  // metric everywhere else in this app). Guarded against an all-zero
  // window so an empty history doesn't make every day "the best."
  const maxKeystrokes = filled ? Math.max(0, ...filled.map((d) => d.total_keystrokes)) : 0;
  const isBestDay = !!day && maxKeystrokes > 0 && day.total_keystrokes === maxKeystrokes;

  // Week strip -- replaced by the intraday timeline below, see the note
  // above. getWeekDates() still lives in utils.ts if this comes back.
  // const weekDates = getWeekDates(selectedDate);
  // const weekMax = Math.max(1, ...weekDates.map((iso) => byDate.get(iso)?.total_keystrokes ?? 0));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            onClick={() => canGoPrev && setSelectedDate((d) => shiftLocalDate(d, -1))}
            disabled={!canGoPrev}
            aria-label="Previous day"
            style={arrowButtonStyle(canGoPrev)}
          >
            ‹
          </button>
          <div
            data-testid="day-label"
            style={{ minWidth: 150, textAlign: "center", fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}
          >
            {formatDayLabel(selectedDate, todayIso)}
          </div>
          <button
            onClick={() => canGoNext && setSelectedDate((d) => shiftLocalDate(d, 1))}
            disabled={!canGoNext}
            aria-label="Next day"
            style={arrowButtonStyle(canGoNext)}
          >
            ›
          </button>
          {isBestDay && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "var(--success)",
                border: "1px solid var(--success)",
                borderRadius: 999,
                padding: "2px 8px",
              }}
            >
              Best day
            </span>
          )}
          {selectedDate !== todayIso && (
            <button
              onClick={() => setSelectedDate(todayIso)}
              style={{
                background: "none",
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "5px 10px",
                color: "var(--text-secondary)",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              Jump to today
            </button>
          )}
        </div>
        <RefreshStatus
          data={{ history: historyQuery.data, timeline: dayTimelineQuery.data, apps: dayAppsQuery.data, streak: streakQuery.data }}
          dataUpdatedAt={Math.max(historyQuery.dataUpdatedAt, dayTimelineQuery.dataUpdatedAt, dayAppsQuery.dataUpdatedAt, streakQuery.dataUpdatedAt)}
          isFetching={historyQuery.isFetching || dayTimelineQuery.isFetching || dayAppsQuery.isFetching || streakQuery.isFetching}
          onRefresh={() => {
            historyQuery.refetch();
            dayTimelineQuery.refetch();
            dayAppsQuery.refetch();
            streakQuery.refetch();
          }}
        />
      </div>

      {/* Week strip -- replaced by the intraday timeline below (2026-09-01,
          see this component's own top-of-file note for why). Left here,
          commented rather than deleted, along with weekDates/weekMax and
          inBounds above and WEEKDAY_LETTERS at the top of the file, in
          case a week-at-a-glance view belongs back on this page somehow.
      {filled && (
        <div data-testid="week-strip" style={{ display: "flex", gap: 16 }}>
          {weekDates.map((iso, i) => {
            const stat = byDate.get(iso);
            const clickable = inBounds(iso) && !!stat;
            const value = stat?.total_keystrokes ?? 0;
            const barHeight = value > 0 ? Math.max(10, (value / weekMax) * 190) : 4;
            const isSelected = iso === selectedDate;
            return (
              <button
                key={iso}
                data-testid={`week-bar-${iso}`}
                onClick={() => clickable && setSelectedDate(iso)}
                disabled={!clickable}
                title={stat ? `${formatDayLabel(iso, todayIso)}: ${stat.total_keystrokes.toLocaleString()} keystrokes` : undefined}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 8,
                  background: "none",
                  border: "none",
                  padding: "0 4px",
                  cursor: clickable ? "pointer" : "default",
                  opacity: stat ? 1 : 0.35,
                  flex: "1 1 0",
                  minWidth: 0,
                }}
              >
                <div style={{ width: "100%", height: 200, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
                  <div
                    style={{
                      width: "60%",
                      maxWidth: 56,
                      height: barHeight,
                      borderRadius: 6,
                      background: isSelected ? "var(--accent)" : "var(--baseline)",
                    }}
                  />
                </div>
                <span
                  style={{
                    fontSize: 14,
                    color: isSelected ? "var(--text-primary)" : "var(--text-muted)",
                    fontWeight: isSelected ? 700 : 400,
                  }}
                >
                  {WEEKDAY_LETTERS[i]}
                </span>
              </button>
            );
          })}
        </div>
      )}
      */}

      {hourly && <DayTimeline hours={hourly} />}
      {dayTimelineQuery.isLoading && <div style={{ color: "var(--text-muted)" }}>Loading...</div>}
      {dayTimelineQuery.isError && <div style={{ color: "#e34948" }}>Couldn't load the day's timeline.</div>}

      {/* Sync-lag caption -- hidden as of 2026-08-31 (commented out, not
          deleted) per direct request: it was taking up vertical space
          the user didn't want spent here. When it did render, it was
          always mounted with visibility toggled (not conditionally
          rendered) so the stat tiles below wouldn't jump between days
          that do/don't show it -- keep that pattern if this comes back,
          same reasoning applies to the comparison row just below.
      <p
        style={{
          margin: 0,
          fontSize: 12,
          color: "var(--text-muted)",
          lineHeight: 1.5,
          visibility: selectedDate === todayIso ? "visible" : "hidden",
        }}
      >
        Updates automatically every 30s, but reflects your agent's last
        sync to the backend -- keys you just typed can take a minute or
        two to actually show up here. For truly live stats on this
        device specifically, see the Keys tab.
      </p>
      */}

      {historyQuery.isLoading && <div style={{ color: "var(--text-muted)" }}>Loading...</div>}
      {historyQuery.isError && <div style={{ color: "#e34948" }}>Couldn't load history.</div>}

      <div
        style={{
          display: "flex",
          gap: 18,
          fontSize: 12,
          color: "var(--text-muted)",
          minHeight: 17,
          visibility: vsYesterday || vsWeekAvg ? "visible" : "hidden",
        }}
      >
        {vsYesterday && (
          <span>
            <span style={{ color: deltaColor(vsYesterday.tone), fontWeight: 600 }}>
              {deltaArrow(vsYesterday.tone)} {vsYesterday.text}
            </span>{" "}
            vs yesterday
          </span>
        )}
        {vsWeekAvg && (
          <span>
            <span style={{ color: deltaColor(vsWeekAvg.tone), fontWeight: 600 }}>
              {deltaArrow(vsWeekAvg.tone)} {vsWeekAvg.text}
            </span>{" "}
            vs past week avg
          </span>
        )}
      </div>

      {day && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <StatTile label="Keystrokes" value={day.total_keystrokes.toLocaleString()} accent />
          <StatTile label="Clicks" value={day.total_clicks.toLocaleString()} />
          <StatTile label="Active minutes" value={day.active_minutes.toLocaleString()} />
          {/* Only on today -- see this file's top-of-file note. A past
              day would show the SAME "as of right now" number no matter
              which day you paged to, which is exactly the confusing
              frozen-value case this view used to avoid by leaving streaks
              out entirely. */}
          {selectedDate === todayIso && streakQuery.data && (
            <StatTile
              label="Current streak"
              value={`${streakQuery.data.current_streak} day${streakQuery.data.current_streak === 1 ? "" : "s"}`}
            />
          )}
        </div>
      )}

      {day && day.total_keystrokes === 0 && day.total_clicks === 0 && day.active_minutes === 0 && (
        <div style={{ color: "var(--text-muted)", fontSize: 14 }}>No activity recorded this day.</div>
      )}

      {/* "By app" for this specific day -- added 2026-09-02, moved to the
          bottom (below the stat tiles, was above them) on 2026-09-07 per
          direct request: stats belong right under the graph, with the
          app breakdown as the last thing on the page rather than sitting
          between the timeline and the numbers it explains. Still fetches
          by exact since/until rather than reusing fetchAppsBreakdown's
          `range` param -- see this component's own top-of-file note on
          why. */}
      <div>
        <h2 style={{ fontSize: 15, color: "var(--text-secondary)", fontWeight: 600, margin: "0 0 12px" }}>
          By app
        </h2>
        {dayAppsQuery.isLoading && <div style={{ color: "var(--text-muted)" }}>Loading...</div>}
        {dayAppsQuery.isError && <div style={{ color: "#e34948" }}>Couldn't load the day's app breakdown.</div>}
        {dayAppsQuery.data && <AppsBreakdown apps={dayAppsQuery.data} />}
      </div>
    </div>
  );
}

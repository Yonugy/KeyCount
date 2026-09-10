import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchStats, fetchHistory, type Range } from "../api";
// fetchAppsBreakdown, AppsBreakdown: see the "By app" section below --
// commented out, not removed, as of 2026-08-31.
// import { fetchAppsBreakdown } from "../api";
import { fillDays } from "../utils";
import StatTile from "./StatTile";
import RangeTabs from "./RangeTabs";
// import AppsBreakdown from "./AppsBreakdown";
import RefreshStatus from "./RefreshStatus";
import DayView from "./DayView";
import WeekChart from "./WeekChart";
import MonthChart from "./MonthChart";

// Same 90-day window (and query key) as DayView/HistoryView -- reuses
// whichever of those already has it cached rather than re-requesting.
const HISTORY_WINDOW_DAYS = 90;

// Everything on this view comes from Postgres, which is only ever as
// fresh as the agent's own pipeline: it samples/flushes a bucket once a
// minute (FLUSH_INTERVAL_S in agent.py), then syncs it up once a minute
// (SYNC_INTERVAL_S) -- so just-typed keystrokes can take up to ~2 minutes
// to show up here even in the best case. Auto-refetching can't shrink
// that underlying lag, only remove the extra "did I forget to click
// Refresh" confusion on top of it -- 30s is a reasonable middle ground
// against that ~60-120s pipeline, not an attempt to make this feel
// instant (it isn't, and the caption below says so).
const SYNC_LAG_REFETCH_MS = 30_000;

export default function TodayView() {
  const [range, setRange] = useState<Range>("today");

  // One-shot hand-off for "clicked a WeekChart/MonthChart bar, jump to
  // that day in Day view" (2026-09-01, later same day; shared by
  // MonthChart since 2026-09-07 -- both charts jump the same way, so one
  // handler covers either) -- not the Day view's regular selected-date
  // state (DayView still owns that itself), just the date to open on the
  // next time it mounts on "today". DayView clears this via
  // onInitialDateConsumed right after applying it, so navigating back to
  // the Today tab normally (not via a bar click) still opens on today.
  const [dayViewJumpDate, setDayViewJumpDate] = useState<string | undefined>(undefined);
  const handleSelectDay = (date: string) => {
    setDayViewJumpDate(date);
    setRange("today");
  };

  // "today" is handled entirely by DayView now (single-day, navigable --
  // see the 2026-08-31 "add a day switcher" feature). This query only
  // runs for the aggregate ranges (week/month/all), which still work the
  // way they always did.
  const statsQuery = useQuery({
    queryKey: ["stats", range],
    queryFn: () => fetchStats(range),
    refetchInterval: SYNC_LAG_REFETCH_MS,
    enabled: range !== "today",
  });

  // Backs the Week tab's 7-bar chart (2026-09-01) and the Month tab's
  // 30-bar chart (2026-09-07, direct request: "a graph for the month view
  // similar to week view") -- same query key as DayView/HistoryView's
  // 90-day fetch, so switching between Week/Month/History reuses
  // whichever of those already ran rather than firing a new request. Only
  // enabled for week/month themselves; All time doesn't have a chart
  // (a 90+ day bar chart stops being readable at a glance, and it's not
  // what was asked for here).
  const historyQuery = useQuery({
    queryKey: ["history", HISTORY_WINDOW_DAYS],
    queryFn: () => fetchHistory(HISTORY_WINDOW_DAYS),
    refetchInterval: SYNC_LAG_REFETCH_MS,
    enabled: range === "week" || range === "month",
  });
  // "week" matches the backend's own rolling-7-day window (rangeStart()
  // in stats.go) close enough for a chart: the last 7 entries of the
  // (zero-filled) 90-day history are exactly the trailing 7 local days
  // ending today, which is what statsQuery's own "week" total already
  // sums -- so the chart's bars visually add up to the number in the
  // stat tile above them. Same reasoning for the last 30 entries against
  // the backend's "month" range (`now.AddDate(0, -1, 0)`, which is 28-31
  // days depending on the current month) -- a fixed 30-day slice is
  // close enough for a chart, same tradeoff Week already accepted.
  const last7Days = historyQuery.data ? fillDays(historyQuery.data, HISTORY_WINDOW_DAYS).slice(-7) : undefined;
  const last30Days = historyQuery.data ? fillDays(historyQuery.data, HISTORY_WINDOW_DAYS).slice(-30) : undefined;

  // "By app" is hidden (not deleted) as of 2026-08-31 -- it was built on
  // top of events_buffer's once-a-minute bucket flush, which snapshots
  // the foreground app a single time per 60s window and credits that
  // whole minute's activity to it. That means a brief app switch within
  // a minute (check WhatsApp for 10s, switch back) gets zero
  // representation -- not "not enough time," it's just never sampled at
  // all -- which made this number actively misleading rather than just
  // imprecise. Reinstating it needs a real fix: the agent tracking
  // per-app sub-totals within each bucket (reusing the same per-keypress
  // app sampling that already makes the Keys tab's app filter accurate)
  // plus a backend change so "active minutes" doesn't get inflated by
  // counting one physical minute multiple times when it touched more
  // than one app. Until that's built, don't just re-enable this --
  // it'll look fixed (30s refresh, no visible bug) while still being
  // wrong at the source.
  //
  // const appsQuery = useQuery({
  //   queryKey: ["apps-breakdown", range],
  //   queryFn: () => fetchAppsBreakdown(range),
  //   refetchInterval: SYNC_LAG_REFETCH_MS,
  // });

  const stats = statsQuery.data;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <RangeTabs value={range} onChange={setRange} />

      {range === "today" ? (
        <DayView
          initialDate={dayViewJumpDate}
          onInitialDateConsumed={() => setDayViewJumpDate(undefined)}
        />
      ) : (
        <>
          <RefreshStatus
            data={{ stats: statsQuery.data, history: historyQuery.data }}
            dataUpdatedAt={Math.max(statsQuery.dataUpdatedAt, historyQuery.dataUpdatedAt)}
            isFetching={statsQuery.isFetching || historyQuery.isFetching}
            onRefresh={() => {
              statsQuery.refetch();
              if (range === "week" || range === "month") historyQuery.refetch();
            }}
          />

          {/* <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
            Updates automatically every 30s, but reflects your agent's last
            sync to the backend -- keys you just typed can take a minute or
            two to actually show up here. For truly live stats on this
            device specifically, see the Keys tab.
          </p> */}

          {range === "week" && last7Days && <WeekChart days={last7Days} onSelectDay={handleSelectDay} />}
          {range === "month" && last30Days && <MonthChart days={last30Days} onSelectDay={handleSelectDay} />}

          {statsQuery.isLoading && (
            <div style={{ color: "var(--text-muted)" }}>Loading...</div>
          )}
          {statsQuery.isError && (
            <div style={{ color: "#e34948" }}>Couldn't load stats.</div>
          )}

          {/* Current streak moved to the Day view (2026-09-07, direct
              request) -- it's inherently an "as of right now" number, so
              it fits a single-day view better than a range one; see
              DayView.tsx's own note on why it only shows there when
              browsing today specifically. Longest streak dropped from
              Week/Month too (same request) -- over a short window it
              rarely differs from what you'd guess from the totals above
              it, so it stayed only on All time, where "longest ever" is
              actually a distinct, meaningful number. */}
          {stats && (
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <StatTile label="Keystrokes" value={stats.total_keystrokes.toLocaleString()} accent />
              <StatTile label="Clicks" value={stats.total_clicks.toLocaleString()} />
              <StatTile label="Active minutes" value={stats.active_minutes.toLocaleString()} />
              {range === "all" && (
                <StatTile label="Longest streak" value={`${stats.longest_streak} day${stats.longest_streak === 1 ? "" : "s"}`} />
              )}
            </div>
          )}

          {/* Daily average (2026-09-07) -- averaged only over days that
              actually have recorded activity (stats.active_days), not the
              full length of the range: a Month view with only 3 active
              days averages over 3, not 30, per direct request. The
              caption below states that denominator explicitly since
              "daily average" would otherwise read as "divided by every
              day in the range," which it deliberately isn't. */}
          {stats && (
            <div>
              {/* <h2 style={{ fontSize: 15, color: "var(--text-secondary)", fontWeight: 600, margin: "0 0 12px" }}>
                Daily average
              </h2> */}
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <StatTile label="Avg keystrokes/day" value={Math.round(stats.avg_keystrokes).toLocaleString()} accent />
                <StatTile label="Avg clicks/day" value={Math.round(stats.avg_clicks).toLocaleString()} />
                <StatTile label="Avg active min/day" value={Math.round(stats.avg_active_minutes).toLocaleString()} />
              </div>
              <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--text-muted)" }}>
                {stats.active_days > 0
                  ? `Averaged over ${stats.active_days} day${stats.active_days === 1 ? "" : "s"} with recorded activity.`
                  : "No activity recorded in this range yet."}
              </p>
            </div>
          )}

          {/*
          <div>
            <h2 style={{ fontSize: 15, color: "var(--text-secondary)", fontWeight: 600, margin: "0 0 12px" }}>
              By app
            </h2>
            {appsQuery.isLoading && <div style={{ color: "var(--text-muted)" }}>Loading...</div>}
            {appsQuery.data && <AppsBreakdown apps={appsQuery.data} />}
          </div>
          */}
        </>
      )}
    </div>
  );
}

import type { DayStat } from "../api";
import { toLocalISODate, formatDayLabel } from "../utils";

interface WeekChartProps {
  days: DayStat[]; // exactly 7, oldest first, trailing -- see TodayView's own note
  onSelectDay?: (date: string) => void;
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// A 7-bar chart for the Week tab -- what used to be DayView's week strip,
// moved here (2026-09-01) since a week's worth of days belongs on the
// tab literally named "Week," not wedged into a single-day view. Same
// single-accent-hue bar treatment as everywhere else in this app.
//
// Bars are clickable (2026-09-01, later same day) -- picking one jumps to
// the Today tab's Day view opened on that exact date, the same
// click-to-drill-in behavior the old week strip had, just crossing a tab
// boundary now that the chart lives here. See TodayView.tsx for the
// handler that flips the range tab, and DayView.tsx for how it accepts a
// starting date from its parent.
export default function WeekChart({ days, onSelectDay }: WeekChartProps) {
  const todayIso = toLocalISODate(new Date());
  const max = Math.max(1, ...days.map((d) => d.total_keystrokes));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <h2 style={{ fontSize: 15, color: "var(--text-secondary)", fontWeight: 600, margin: 0 }}>
        Last 7 days
      </h2>
      <div style={{ display: "flex", gap: 16 }}>
        {days.map((d) => {
          const value = d.total_keystrokes;
          const barHeight = value > 0 ? Math.max(10, (value / max) * 150) : 4;
          const isToday = d.date === todayIso;
          // Local Date(y, m-1, day) constructor, not `new Date(d.date)` --
          // a bare "YYYY-MM-DD" string parses as UTC midnight, which is
          // the exact footgun toLocalISODate (utils.ts) exists to avoid.
          const [y, m, day] = d.date.split("-").map(Number);
          const dow = new Date(y, m - 1, day).getDay();
          return (
            <button
              key={d.date}
              type="button"
              data-testid={`week-chart-bar-${d.date}`}
              onClick={() => onSelectDay?.(d.date)}
              title={`${formatDayLabel(d.date, todayIso)}: ${value.toLocaleString()} keystrokes`}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 8,
                flex: "1 1 0",
                minWidth: 0,
                background: "none",
                border: "none",
                padding: 0,
                font: "inherit",
                cursor: onSelectDay ? "pointer" : "default",
              }}
            >
              <div style={{ width: "100%", height: 150, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
                <div
                  style={{
                    width: "60%",
                    maxWidth: 48,
                    height: barHeight,
                    borderRadius: 6,
                    background: isToday ? "var(--accent)" : "var(--baseline)",
                  }}
                />
              </div>
              <span
                style={{
                  fontSize: 12,
                  color: isToday ? "var(--text-primary)" : "var(--text-muted)",
                  fontWeight: isToday ? 700 : 400,
                }}
              >
                {WEEKDAY_LABELS[dow]}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

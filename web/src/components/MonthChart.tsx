import type { DayStat } from "../api";
import { toLocalISODate, formatDayLabel } from "../utils";

interface MonthChartProps {
  days: DayStat[]; // exactly 30, oldest first, trailing -- see TodayView's own note
  onSelectDay?: (date: string) => void;
}

// A 30-bar chart for the Month tab (2026-09-07, direct request: "a graph
// for the month view similar to week view") -- same hand-rolled bar
// treatment and click-to-drill-in-to-Day-view behavior as WeekChart.tsx,
// just 30 bars instead of 7. Deliberately its own component rather than a
// parameterized version of WeekChart: the label scheme has to change (30
// weekday letters would repeat 4x and mean nothing at a glance -- day-of-
// month numbers instead), and duplicating the ~60 lines here keeps
// WeekChart's already-shipped, already-tested behavior untouched rather
// than risking it in a refactor for this.
export default function MonthChart({ days, onSelectDay }: MonthChartProps) {
  const todayIso = toLocalISODate(new Date());
  const max = Math.max(1, ...days.map((d) => d.total_keystrokes));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <h2 style={{ fontSize: 15, color: "var(--text-secondary)", fontWeight: 600, margin: 0 }}>
        Last 30 days
      </h2>
      <div style={{ display: "flex", gap: 4 }}>
        {days.map((d) => {
          const value = d.total_keystrokes;
          const barHeight = value > 0 ? Math.max(10, (value / max) * 150) : 4;
          const isToday = d.date === todayIso;
          // Day-of-month, no leading zero -- "7" not "07". 30 bars is too
          // many to label with anything longer (weekday letters, full
          // dates) without the labels overlapping or getting truncated.
          const dayOfMonth = Number(d.date.slice(-2));
          return (
            <button
              key={d.date}
              type="button"
              data-testid={`month-chart-bar-${d.date}`}
              onClick={() => onSelectDay?.(d.date)}
              title={`${formatDayLabel(d.date, todayIso)}: ${value.toLocaleString()} keystrokes`}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 6,
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
                    maxWidth: 16,
                    height: barHeight,
                    borderRadius: 3,
                    background: isToday ? "var(--accent)" : "var(--baseline)",
                  }}
                />
              </div>
              <span
                style={{
                  fontSize: 10,
                  color: isToday ? "var(--text-primary)" : "var(--text-muted)",
                  fontWeight: isToday ? 700 : 400,
                }}
              >
                {dayOfMonth}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

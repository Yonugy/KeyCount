import type { HourlyPoint } from "../utils";

interface DayTimelineProps {
  hours: HourlyPoint[]; // exactly 24, index 0 = 12am-1am .. index 23 = 11pm-12am
}

// Labeled ticks every 3 hours -- matching the dataviz guidance of
// selective direct labels rather than one under every one of the 24 bars,
// which would be illegible at this width. 12am/12pm spelled out rather
// than "0am"/"12am" twice, same convention every fitness/screen-time app
// uses.
const LABELED_HOURS = new Set([0, 3, 6, 9, 12, 15, 18, 21]);

function hourLabel(hour: number): string {
  if (hour === 0) return "12am";
  if (hour === 12) return "12pm";
  return hour < 12 ? `${hour}am` : `${hour - 12}pm`;
}

function hourRangeLabel(hour: number): string {
  const start = hourLabel(hour);
  const end = hourLabel((hour + 1) % 24);
  return `${start}–${end}`;
}

// A 24-bar intraday timeline -- "when during the day was I active," the
// thing a single point-in-time total or a multi-day chart can't show.
// Same visual language as DayView's week strip (which this sits in place
// of, see DayView.tsx's own note): single accent hue, a tiny sliver
// instead of a bar at zero activity so the row never looks broken/empty,
// native `title` tooltips rather than a custom hover layer (matching
// every other bar/list component in this app).
export default function DayTimeline({ hours }: DayTimelineProps) {
  const max = Math.max(1, ...hours.map((h) => h.keystrokes));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 110 }}>
        {hours.map((h) => {
          const barHeight = h.keystrokes > 0 ? Math.max(6, (h.keystrokes / max) * 100) : 3;
          return (
            <div
              key={h.hour}
              title={`${hourRangeLabel(h.hour)}: ${h.keystrokes.toLocaleString()} keystroke${h.keystrokes === 1 ? "" : "s"}`}
              style={{
                flex: "1 1 0",
                minWidth: 0,
                height: barHeight,
                borderRadius: 3,
                background: h.keystrokes > 0 ? "var(--accent)" : "var(--baseline)",
              }}
            />
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 3 }}>
        {hours.map((h) => (
          <div
            key={h.hour}
            style={{
              flex: "1 1 0",
              minWidth: 0,
              textAlign: "center",
              fontSize: 10,
              color: "var(--text-muted)",
            }}
          >
            {LABELED_HOURS.has(h.hour) ? hourLabel(h.hour) : ""}
          </div>
        ))}
      </div>
    </div>
  );
}

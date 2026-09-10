import { useState } from "react";
import type { DayStat } from "../api";
import { toLocalISODate } from "../utils";

interface HeatmapProps {
  days: DayStat[];
  metric: "total_keystrokes" | "total_clicks" | "active_minutes";
  // Both optional, default to History's original 11px/3px sizing so that
  // view's appearance is unchanged. Added 2026-09-02 (fifth time the same
  // day) so the Profile tab could size its own copy up -- at History's
  // size it read as a tiny cluster in the corner of Profile's much wider
  // column, with a lot of unused space around it and nothing else on the
  // page competing for room the way History's chart+heatmap pairing does.
  cellSize?: number;
  gap?: number;
}

const SEQ_STEPS = ["var(--seq-0)", "var(--seq-1)", "var(--seq-2)", "var(--seq-3)", "var(--seq-4)", "var(--seq-5)"];

const METRIC_UNIT: Record<HeatmapProps["metric"], string> = {
  total_keystrokes: "keystrokes",
  total_clicks: "clicks",
  active_minutes: "active min",
};

function formatDateLabel(iso: string): string {
  // Parse as a local date (not UTC) so the label always matches the cell
  // it's attached to, regardless of the viewer's timezone.
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

interface HoverState {
  date: string;
  value: number;
  x: number;
  y: number;
}

// GitHub-contributions-style calendar heatmap (system design doc, section
// 5.1). Sequential single-hue ramp by magnitude, relative to this user's
// own max in the window -- not a fixed absolute scale. A styled hover
// tooltip (date + value), positioned off the hovered cell's own screen
// rect (fixed positioning, so it's never clipped by this container's own
// horizontal scrollbar) -- mirrors the line chart's tooltip instead of
// relying on the browser's plain native title tooltip.
export default function Heatmap({ days, metric, cellSize = 11, gap = 3 }: HeatmapProps) {
  const [hover, setHover] = useState<HoverState | null>(null);
  const byDate = new Map(days.map((d) => [d.date, d[metric]]));

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayIso = toLocalISODate(today);
  const WINDOW_DAYS = 90;
  const start = new Date(today);
  start.setDate(start.getDate() - (WINDOW_DAYS - 1));
  // back up to the most recent Sunday so full weeks line up as columns
  start.setDate(start.getDate() - start.getDay());

  const cells: { date: string; value: number }[] = [];
  const cursor = new Date(start);
  while (cursor <= today) {
    const iso = toLocalISODate(cursor);
    cells.push({ date: iso, value: byDate.get(iso) ?? 0 });
    cursor.setDate(cursor.getDate() + 1);
  }

  const max = Math.max(...cells.map((c) => c.value), 1);
  const stepFor = (value: number) => {
    if (value === 0) return 0;
    return Math.min(5, Math.max(1, Math.ceil((value / max) * 5)));
  };

  const weeks: { date: string; value: number }[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }

  return (
    <div style={{ overflowX: "auto", position: "relative" }}>
      <div style={{ display: "flex", gap }}>
        {weeks.map((week, wi) => (
          <div key={wi} style={{ display: "flex", flexDirection: "column", gap }}>
            {week.map((cell) => {
              const inFuture = cell.date > todayIso;
              return (
                <div
                  key={cell.date}
                  data-testid="heatmap-cell"
                  data-date={cell.date}
                  onMouseEnter={(e) => {
                    if (inFuture) return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    setHover({ date: cell.date, value: cell.value, x: rect.left + rect.width / 2, y: rect.top });
                  }}
                  onMouseLeave={() => setHover(null)}
                  style={{
                    width: cellSize,
                    height: cellSize,
                    borderRadius: Math.max(2, Math.round(cellSize / 5)),
                    background: inFuture ? "transparent" : SEQ_STEPS[stepFor(cell.value)],
                    // Every real day gets an outline, not just the ones with
                    // activity -- added 2026-09-03 per direct report/request
                    // ("should be like the github one where all of the small
                    // boxes will have border no matter there is progress or
                    // not"). Without this, a zero-activity cell (seq-0) is
                    // the exact same color as the card surface behind it and
                    // just disappears, so the calendar read as a scatter of
                    // floating colored squares with no grid. Future dates
                    // (the tail of the last, not-yet-complete week) stay
                    // borderless -- they aren't real days yet.
                    border: inFuture ? "none" : "1px solid var(--border)",
                    cursor: inFuture ? "default" : "pointer",
                  }}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          marginTop: 8,
          color: "var(--text-muted)",
          fontSize: 11,
        }}
      >
        <span>Less</span>
        {SEQ_STEPS.map((color, i) => (
          <div key={i} style={{ width: cellSize, height: cellSize, borderRadius: Math.max(2, Math.round(cellSize / 5)), background: color, border: "1px solid var(--border)" }} />
        ))}
        <span>More</span>
      </div>

      {hover && (
        <div
          style={{
            position: "fixed",
            left: hover.x,
            top: hover.y,
            transform: "translate(-50%, calc(-100% - 8px))",
            background: "var(--surface-1)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: "8px 10px",
            fontSize: 13,
            pointerEvents: "none",
            whiteSpace: "nowrap",
            zIndex: 50,
            boxShadow: "0 2px 8px rgba(0, 0, 0, 0.25)",
          }}
        >
          <div style={{ color: "var(--text-muted)", marginBottom: 2 }}>{formatDateLabel(hover.date)}</div>
          <div style={{ color: "var(--text-primary)", fontWeight: 600 }}>
            {hover.value.toLocaleString()} {METRIC_UNIT[metric]}
            {/* {hover.date === todayIso ? " (so far)" : ""} */}
            {hover.date === todayIso}
          </div>
        </div>
      )}
    </div>
  );
}

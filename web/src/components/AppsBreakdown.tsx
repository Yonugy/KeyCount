import { formatShare } from "../utils";

// Deliberately NOT typed against api.ts's `AppStat` -- this component only
// ever reads app_name/keystrokes, so it works for both the backend's "By
// app" breakdown (AppStat, currently hidden -- see TodayView.tsx) and the
// local, per-keypress-accurate one (localApi.ts's `LocalAppStat`, used by
// KeysView.tsx). Keeping the prop shape minimal instead of importing
// either type is what lets the same bar-list rendering serve both.
interface AppsBreakdownProps {
  apps: { app_name: string; keystrokes: number }[];
}

// A ranked bar list: one measure (keystrokes) across categories (apps).
// Single hue throughout -- color here would encode "which app" redundantly
// with the label already beside each bar, so per the dataviz skill this
// stays one accent color rather than a categorical rainbow.
export default function AppsBreakdown({ apps }: AppsBreakdownProps) {
  if (apps.length === 0) {
    return (
      <div style={{ color: "var(--text-muted)", fontSize: 14 }}>
        No activity in this range yet.
      </div>
    );
  }

  const max = Math.max(...apps.map((a) => a.keystrokes), 1);
  // Share of THIS list's own total, not some separate grand total the
  // caller might have -- apps is already the full breakdown for whatever
  // range/day is currently selected (unlike KeysView's key list, this one
  // is never capped), so summing it back up gives an exact 100% split
  // across the bars shown here.
  const total = apps.reduce((sum, a) => sum + a.keystrokes, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {apps.map((app) => {
        const pct = Math.max((app.keystrokes / max) * 100, 2);
        return (
          <div key={app.app_name}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 13,
                color: "var(--text-secondary)",
                marginBottom: 4,
              }}
            >
              <span>{app.app_name}</span>
              <span className="tabular">
                {app.keystrokes.toLocaleString()} ({formatShare(app.keystrokes, total)})
              </span>
            </div>
            <div
              style={{
                background: "var(--gridline)",
                borderRadius: 4,
                height: 10,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${pct}%`,
                  height: "100%",
                  background: "var(--accent)",
                  borderRadius: 4,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

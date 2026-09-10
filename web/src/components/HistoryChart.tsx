import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { TooltipContentProps } from "recharts";
import type { ValueType, NameType } from "recharts/types/component/DefaultTooltipContent";
import type { DayStat } from "../api";

interface HistoryChartProps {
  days: DayStat[];
  metric: "total_keystrokes" | "total_clicks" | "active_minutes";
  label: string;
}

function makeTooltip(metricLabel: string) {
  // Returns a Recharts tooltip renderer closing over the metric's display
  // name (e.g. "Keystrokes"); Recharts itself supplies `label` (the date
  // for the hovered point) and `payload` (the value) per hover.
  return function ChartTooltip({
    active,
    payload,
    label: date,
  }: TooltipContentProps<ValueType, NameType>) {
    if (!active || !payload || payload.length === 0) return null;
    return (
      <div
        style={{
          background: "var(--surface-1)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          padding: "8px 10px",
          fontSize: 13,
        }}
      >
        <div style={{ color: "var(--text-muted)", marginBottom: 2 }}>{date}</div>
        <div style={{ color: "var(--text-primary)", fontWeight: 600 }}>
          {Number(payload[0].value).toLocaleString()} {metricLabel.toLowerCase()}
        </div>
      </div>
    );
  };
}

// Single series over time -> no legend needed (dataviz skill: "a single
// series needs no legend box, the title already says what's plotted").
// 2px line, ~10% opacity area wash, hairline solid gridlines, hover
// tooltip -- per the skill's mark specs and interaction defaults.
export default function HistoryChart({ days, metric, label }: HistoryChartProps) {
  if (days.every((d) => d[metric] === 0)) {
    return (
      <div style={{ color: "var(--text-muted)", fontSize: 14, padding: "40px 0" }}>
        No activity in this range yet.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={340}>
      <AreaChart data={days} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--gridline)" strokeDasharray="0" />
        <XAxis
          dataKey="date"
          tickFormatter={(d: string) => d.slice(5)}
          stroke="var(--baseline)"
          tick={{ fill: "var(--text-muted)", fontSize: 12 }}
          tickLine={false}
        />
        <YAxis
          stroke="var(--baseline)"
          tick={{ fill: "var(--text-muted)", fontSize: 12 }}
          tickLine={false}
          width={44}
        />
        <Tooltip content={makeTooltip(label)} />
        <Area
          type="monotone"
          dataKey={metric}
          stroke="var(--accent)"
          strokeWidth={2}
          fill="var(--accent)"
          fillOpacity={0.1}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

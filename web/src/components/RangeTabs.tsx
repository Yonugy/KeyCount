import type { Range } from "../api";

const RANGES: { value: Range; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "all", label: "All time" },
];

interface RangeTabsProps {
  value: Range;
  onChange: (range: Range) => void;
}

export default function RangeTabs({ value, onChange }: RangeTabsProps) {
  return (
    <div style={{ display: "flex", gap: 6 }}>
      {RANGES.map((r) => {
        const active = r.value === value;
        return (
          <button
            key={r.value}
            onClick={() => onChange(r.value)}
            style={{
              background: active ? "var(--accent)" : "var(--surface-1)",
              color: active ? "#ffffff" : "var(--text-secondary)",
              border: "1px solid " + (active ? "var(--accent)" : "var(--border)"),
              borderRadius: 6,
              padding: "6px 12px",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            {r.label}
          </button>
        );
      })}
    </div>
  );
}

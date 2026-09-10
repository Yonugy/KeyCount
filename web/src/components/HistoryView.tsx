import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchHistory } from "../api";
import { fillDays } from "../utils";
import HistoryChart from "./HistoryChart";
import Heatmap from "./Heatmap";
import RefreshStatus from "./RefreshStatus";

type Metric = "total_keystrokes" | "total_clicks" | "active_minutes";

const METRICS: { value: Metric; label: string }[] = [
  { value: "total_keystrokes", label: "Keystrokes" },
  { value: "total_clicks", label: "Clicks" },
  { value: "active_minutes", label: "Active minutes" },
];

export default function HistoryView() {
  const [metric, setMetric] = useState<Metric>("total_keystrokes");
  const days = 90;

  const historyQuery = useQuery({
    queryKey: ["history", days],
    queryFn: () => fetchHistory(days),
  });

  const metricLabel = METRICS.find((m) => m.value === metric)!.label;
  const filledDays = historyQuery.data ? fillDays(historyQuery.data, days) : undefined;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", gap: 6 }}>
          {METRICS.map((m) => {
            const active = m.value === metric;
            return (
              <button
                key={m.value}
                onClick={() => setMetric(m.value)}
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
                {m.label}
              </button>
            );
          })}
        </div>
        <RefreshStatus
          data={historyQuery.data}
          dataUpdatedAt={historyQuery.dataUpdatedAt}
          isFetching={historyQuery.isFetching}
          onRefresh={() => historyQuery.refetch()}
        />
      </div>

      <div>
        <h2 style={{ fontSize: 15, color: "var(--text-secondary)", fontWeight: 600, margin: "0 0 12px" }}>
          {metricLabel} over the last {days} days
        </h2>
        {historyQuery.isLoading && <div style={{ color: "var(--text-muted)" }}>Loading...</div>}
        {historyQuery.isError && <div style={{ color: "#e34948" }}>Couldn't load history.</div>}
        {filledDays && (
          <HistoryChart days={filledDays} metric={metric} label={metricLabel} />
        )}
      </div>

      <div>
        <h2 style={{ fontSize: 15, color: "var(--text-secondary)", fontWeight: 600, margin: "0 0 12px" }}>
          Activity calendar
        </h2>
        {filledDays && <Heatmap days={filledDays} metric={metric} />}
      </div>
    </div>
  );
}

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchLeaderboardKeystrokes,
  fetchLeaderboardStreak,
  getUsername,
  type LeaderboardEntry,
  type LeaderboardWindow,
} from "../api";
import RefreshStatus from "./RefreshStatus";

type Metric = "keystrokes" | "streak";

const METRICS: { value: Metric; label: string }[] = [
  { value: "keystrokes", label: "Keystrokes" },
  { value: "streak", label: "Longest streak" },
];

const WINDOWS: { value: LeaderboardWindow; label: string }[] = [
  { value: "daily", label: "Today" },
  { value: "weekly", label: "This week" },
  { value: "alltime", label: "All time" },
];

// Same 30s cadence TodayView/HistoryView use for anything backed by the
// synced (not live-local) data -- see SYNC_LAG_REFETCH_MS's own comment in
// TodayView.tsx. A leaderboard is even less latency-sensitive than your own
// stats, but there's no reason to pick a different number.
const REFETCH_MS = 30_000;

// Global leaderboard: every user with a public_profile has a link to their
// profile page here (entries with public_profile: false render as plain
// text -- there's nowhere to send that click, see api.ts's own note on the
// field). This is a real <a href>, not client-side routing -- there's no
// router in this app (see main.tsx), and App.tsx's own path check on load
// is what renders PublicProfilePage.tsx for a /u/:username URL.
export default function LeaderboardsView() {
  const [metric, setMetric] = useState<Metric>("keystrokes");
  const [window, setWindowValue] = useState<LeaderboardWindow>("daily");
  const myUsername = getUsername();

  const query = useQuery({
    queryKey: metric === "keystrokes" ? ["leaderboard", "keystrokes", window] : ["leaderboard", "streak"],
    queryFn: () => (metric === "keystrokes" ? fetchLeaderboardKeystrokes(window) : fetchLeaderboardStreak()),
    refetchInterval: REFETCH_MS,
  });

  const entries = query.data;
  const valueLabel = metric === "keystrokes" ? "Keystrokes" : "Longest streak";

  function formatValue(entry: LeaderboardEntry) {
    if (metric === "keystrokes") return entry.value.toLocaleString();
    return `${entry.value} day${entry.value === 1 ? "" : "s"}`;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
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
          data={query.data}
          dataUpdatedAt={query.dataUpdatedAt}
          isFetching={query.isFetching}
          onRefresh={() => query.refetch()}
        />
      </div>

      {metric === "keystrokes" && (
        <div style={{ display: "flex", gap: 6 }}>
          {WINDOWS.map((w) => {
            const active = w.value === window;
            return (
              <button
                key={w.value}
                onClick={() => setWindowValue(w.value)}
                style={{
                  background: active ? "var(--surface-1)" : "none",
                  color: active ? "var(--text-primary)" : "var(--text-muted)",
                  border: "1px solid " + (active ? "var(--border)" : "transparent"),
                  borderRadius: 6,
                  padding: "5px 10px",
                  fontSize: 13,
                  fontWeight: active ? 600 : 400,
                  cursor: "pointer",
                }}
              >
                {w.label}
              </button>
            );
          })}
        </div>
      )}

      {query.isLoading && <div style={{ color: "var(--text-muted)" }}>Loading...</div>}
      {query.isError && <div style={{ color: "#e34948" }}>Couldn't load the leaderboard.</div>}

      {entries && entries.length === 0 && (
        <div style={{ color: "var(--text-muted)", fontSize: 14 }}>
          No one's on the board yet.
        </div>
      )}

      {entries && entries.length > 0 && (
        <div
          style={{
            background: "var(--surface-1)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "48px 1fr auto",
              padding: "10px 16px",
              fontSize: 12,
              color: "var(--text-muted)",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <span>#</span>
            <span>User</span>
            <span>{valueLabel}</span>
          </div>
          {entries.map((entry) => {
            const isMe = entry.username === myUsername;
            return (
              <div
                key={entry.username}
                style={{
                  display: "grid",
                  gridTemplateColumns: "48px 1fr auto",
                  alignItems: "center",
                  padding: "10px 16px",
                  fontSize: 14,
                  borderBottom: "1px solid var(--gridline)",
                  background: isMe ? "var(--plane)" : "transparent",
                }}
              >
                <span style={{ color: "var(--text-muted)" }} className="tabular">
                  {entry.rank}
                </span>
                <span style={{ color: "var(--text-primary)", fontWeight: isMe ? 600 : 400 }}>
                  {entry.public_profile ? (
                    <a
                      href={`/u/${encodeURIComponent(entry.username)}`}
                      style={{ color: "inherit", textDecoration: "none" }}
                      onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
                      onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
                    >
                      {entry.username}
                    </a>
                  ) : (
                    entry.username
                  )}
                  {isMe && <span style={{ color: "var(--text-muted)", fontWeight: 400 }}> (you)</span>}
                </span>
                <span className="tabular" style={{ color: "var(--text-secondary)" }}>
                  {formatValue(entry)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

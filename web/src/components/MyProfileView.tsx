import { useQuery } from "@tanstack/react-query";
import { fetchSettings, fetchStats, fetchHistory } from "../api";
import { fillDays } from "../utils";
import StatTile from "./StatTile";
import RefreshStatus from "./RefreshStatus";
import Heatmap from "./Heatmap";

interface MyProfileViewProps {
  onManageVisibility: () => void;
}

// Same 30s cadence as everything else backed by the synced (not
// live-local) data -- see TodayView.tsx's SYNC_LAG_REFETCH_MS comment.
const REFETCH_MS = 30_000;

// Same 90-day window (and query key) HistoryView/DayView already use --
// added 2026-09-02 (fourth time the same day) so the tab had more than
// five stat tiles and a status line on it. Reusing the query key means
// this reuses whichever of HistoryView/DayView's own fetch already ran
// instead of firing a second request for the same data.
const HISTORY_WINDOW_DAYS = 90;

// Added 2026-09-02 (third time the same day) -- until now the only place
// to see "your own profile" was /u/:username, but that page 404s while
// public_profile is off, so there was no way to check what it'll look
// like, or just see your own headline numbers, without going public
// first. This tab is authenticated instead: it reads your own
// username/member_since (now on GET /v1/me/settings regardless of the
// toggle -- see that endpoint's own comment) and your all-time stats
// (the same GET /v1/me/stats?range=all every other tab already uses), so
// it always works for you whether or not anyone else can see it. It's
// deliberately NOT just an embedded preview of PublicProfilePage --
// unlike that page (which intentionally shows only the four public-safe
// fields), this one is your own dashboard, so it shows the same full
// all-time stat set as the Today tab's "All time" range rather than the
// public page's narrower slice.
export default function MyProfileView({ onManageVisibility }: MyProfileViewProps) {
  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: fetchSettings,
  });

  const statsQuery = useQuery({
    queryKey: ["stats", "all"],
    queryFn: () => fetchStats("all"),
    refetchInterval: REFETCH_MS,
  });

  const historyQuery = useQuery({
    queryKey: ["history", HISTORY_WINDOW_DAYS],
    queryFn: () => fetchHistory(HISTORY_WINDOW_DAYS),
    refetchInterval: REFETCH_MS,
  });

  const settings = settingsQuery.data;
  const stats = statsQuery.data;
  const filledDays = historyQuery.data ? fillDays(historyQuery.data, HISTORY_WINDOW_DAYS) : undefined;
  const loading = settingsQuery.isLoading || statsQuery.isLoading;
  const error = settingsQuery.isError || statsQuery.isError;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
        <div>
          {settings ? (
            <>
              <h1 style={{ fontSize: 22, margin: "0 0 4px", color: "var(--text-primary)" }}>
                {settings.username}
              </h1>
              <div style={{ color: "var(--text-muted)", fontSize: 13 }}>
                Member since {settings.member_since}
              </div>
            </>
          ) : (
            <h1 style={{ fontSize: 22, margin: 0, color: "var(--text-primary)" }}>Profile</h1>
          )}
        </div>
        <RefreshStatus
          data={stats}
          dataUpdatedAt={statsQuery.dataUpdatedAt}
          isFetching={statsQuery.isFetching}
          onRefresh={() => statsQuery.refetch()}
        />
      </div>

      {loading && <div style={{ color: "var(--text-muted)" }}>Loading...</div>}
      {error && <div style={{ color: "#e34948" }}>Couldn't load your profile.</div>}

      {/* Calendar first, stats below -- moved up (2026-09-02, sixth time
          the same day) per direct request: the calendar is the more
          visually substantial piece and reads better as the page's lead
          than as an afterthought under five small tiles. Sized up
          (cellSize/gap, both larger than Heatmap's History-tab defaults)
          AND wrapped in a bordered card (2026-09-02, seventh time) -- the
          size bump alone still left it reading as a small cluster stuck
          in the corner of Profile's much wider column, with a lot of
          open space around it. A full-width card gives it a defined,
          intentional boundary instead of floating in that whitespace.
          Uses --border-strong, not the plain --border the other cards on
          this page use (2026-09-03, eighth time -- direct report that
          the card was invisible): --border's normal 0.1 opacity is easy
          to miss on a lone, mostly-empty panel with nothing beside it to
          contrast against, even though it's the identical color that
          reads fine on the small, tightly packed stat tiles below. */}
      <div
        style={{
          background: "var(--surface-1)",
          border: "2px solid var(--border-strong)",
          borderRadius: 10,
          padding: "18px 20px",
        }}
      >
        <h2 style={{ fontSize: 15, color: "var(--text-secondary)", fontWeight: 600, margin: "0 0 16px" }}>
          Activity calendar
        </h2>
        {historyQuery.isLoading && <div style={{ color: "var(--text-muted)" }}>Loading...</div>}
        {historyQuery.isError && <div style={{ color: "#e34948" }}>Couldn't load your activity calendar.</div>}
        {/* 90 fixed calendar days is a narrow, fixed-width grid no matter
            how big the card around it is -- History gets away with it
            sitting flush left because it's paired with a full-width line
            chart above it. Profile has nothing beside it, so centering it
            in the card (rather than leaving it flush left) is what
            actually stops it reading as parked in a corner. */}
        {filledDays && (
          <div style={{ display: "flex", justifyContent: "center" }}>
            <Heatmap days={filledDays} metric="total_keystrokes" cellSize={20} gap={6} />
          </div>
        )}
      </div>

      {stats && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <StatTile label="Total keystrokes" value={stats.total_keystrokes.toLocaleString()} accent />
          <StatTile label="Total clicks" value={stats.total_clicks.toLocaleString()} />
          <StatTile label="Active minutes" value={stats.active_minutes.toLocaleString()} />
          <StatTile label="Current streak" value={`${stats.current_streak} day${stats.current_streak === 1 ? "" : "s"}`} />
          <StatTile label="Longest streak" value={`${stats.longest_streak} day${stats.longest_streak === 1 ? "" : "s"}`} />
        </div>
      )}

      {settings && (
        <div
          style={{
            background: "var(--surface-1)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            padding: "14px 16px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            {settings.public_profile
              ? "Your profile is public -- anyone with the link can view this page."
              : "Your profile is private -- only you can see this page right now."}
          </div>
          <button
            onClick={onManageVisibility}
            style={{
              background: "none",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "6px 12px",
              color: "var(--text-secondary)",
              fontSize: 13,
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            Manage visibility
          </button>
        </div>
      )}
    </div>
  );
}

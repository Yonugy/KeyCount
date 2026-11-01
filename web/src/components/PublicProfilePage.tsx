import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "react-router-dom";
import { fetchPublicProfile, ApiError } from "../api";
import StatTile from "./StatTile";
import Heatmap from "./Heatmap";
import { fillDays } from "../utils";

// Same window the Heatmap draws (see its WINDOW_DAYS).
const CALENDAR_DAYS = 90;

// Equal-width tiles per row, dropping to fewer columns on narrow screens.
const tileRowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
  gap: 16,
};

interface PublicProfilePageProps {
  username: string;
}

// Standalone page for a shared /u/:username URL -- reachable with nobody
// signed in (fetchPublicProfile sends no auth header at all), rendered by
// App.tsx *instead of* the normal signed-in app shell when the URL matches
// that path (see App.tsx's own comment on why there's a bespoke path check
// here rather than a router: this app has never needed one for anything
// else). A private or nonexistent username both 404 identically on the
// backend (see public-profile's own handler comment -- no username
// enumeration via response shape), so this page can't and doesn't try to
// tell those two cases apart either.
export default function PublicProfilePage({ username }: PublicProfilePageProps) {
  // Set by the Friends / Leaderboards links (router state), so the back
  // link returns to that dashboard tab. Opened directly (shared link, new
  // tab), there is no "from" and it goes to the landing page as before.
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  const query = useQuery({
    queryKey: ["public-profile", username],
    queryFn: () => fetchPublicProfile(username),
    retry: false,
  });

  const p = query.data;
  const notFound = query.isError && query.error instanceof ApiError && query.error.status === 404;

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "48px 32px" }}>
      <div style={{ marginBottom: 32 }}>
        <Link to={from ?? "/"} data-click-sound style={{ color: "var(--text-muted)", fontSize: 13, textDecoration: "none" }}>
          &larr; {from ? "Back" : "KeyCount"}
        </Link>
      </div>

      {query.isLoading && <div style={{ color: "var(--text-muted)" }}>Loading...</div>}

      {notFound && (
        <div style={{ color: "var(--text-secondary)" }}>
          <h1 style={{ fontSize: 22, margin: "0 0 8px" }}>Profile not found</h1>
          <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 14 }}>
            This user doesn't exist, or hasn't made their profile public.
          </p>
        </div>
      )}

      {query.isError && !notFound && (
        <div style={{ color: "#e34948" }}>Couldn't load this profile.</div>
      )}

      {p && (
        <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
          <div>
            <h1 style={{ fontSize: 26, margin: "0 0 4px", color: "var(--text-primary)" }}>
              {p.username}
            </h1>
            <div style={{ color: "var(--text-muted)", fontSize: 13 }}>
              Member since {p.member_since}
            </div>
          </div>

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
            {/* Narrow viewports: the grid is fixed-width, so let the card
                scroll sideways instead of overflowing the page. */}
            <div style={{ display: "flex", justifyContent: "center", overflowX: "auto" }}>
              <Heatmap
                days={fillDays(
                  (p.activity ?? []).map((a) => ({
                    date: a.date,
                    total_keystrokes: a.total_keystrokes,
                    total_clicks: 0,
                    active_minutes: 0,
                  })),
                  CALENDAR_DAYS,
                )}
                metric="total_keystrokes"
                cellSize={18}
                gap={5}
              />
            </div>
          </div>

          {/* Same five all-time tiles as the dashboard's Profile tab, split
              into two even rows (totals, then streaks). Five tiles in one
              wrapping row left Longest streak stranded alone on a second
              line. The ?? 0 keeps the page working against an older
              backend that doesn't send clicks / active minutes yet. */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={tileRowStyle}>
              <StatTile label="Total keystrokes" value={(p.total_keystrokes ?? 0).toLocaleString()} accent />
              <StatTile label="Total clicks" value={(p.total_clicks ?? 0).toLocaleString()} />
              <StatTile label="Active minutes" value={(p.active_minutes ?? 0).toLocaleString()} />
            </div>
            <div style={tileRowStyle}>
              <StatTile label="Current streak" value={`${p.current_streak} day${p.current_streak === 1 ? "" : "s"}`} />
              <StatTile label="Longest streak" value={`${p.longest_streak} day${p.longest_streak === 1 ? "" : "s"}`} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

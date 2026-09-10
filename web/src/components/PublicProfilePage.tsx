import { useQuery } from "@tanstack/react-query";
import { fetchPublicProfile, ApiError } from "../api";
import StatTile from "./StatTile";

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
  const query = useQuery({
    queryKey: ["public-profile", username],
    queryFn: () => fetchPublicProfile(username),
    retry: false,
  });

  const notFound = query.isError && query.error instanceof ApiError && query.error.status === 404;

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "48px 32px" }}>
      <div style={{ marginBottom: 32 }}>
        <a href="/" style={{ color: "var(--text-muted)", fontSize: 13, textDecoration: "none" }}>
          &larr; KeyCount
        </a>
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

      {query.data && (
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div>
            <h1 style={{ fontSize: 26, margin: "0 0 4px", color: "var(--text-primary)" }}>
              {query.data.username}
            </h1>
            <div style={{ color: "var(--text-muted)", fontSize: 13 }}>
              Member since {query.data.member_since}
            </div>
          </div>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <StatTile label="Total keystrokes" value={query.data.total_keystrokes.toLocaleString()} accent />
            <StatTile label="Current streak" value={`${query.data.current_streak} day${query.data.current_streak === 1 ? "" : "s"}`} />
            <StatTile label="Longest streak" value={`${query.data.longest_streak} day${query.data.longest_streak === 1 ? "" : "s"}`} />
          </div>
        </div>
      )}
    </div>
  );
}

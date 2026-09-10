import { useState } from "react";
import { getToken, getUsername, setSession, clearSession } from "./api";
import Login from "./components/Login";
import TodayView from "./components/TodayView";
import HistoryView from "./components/HistoryView";
import KeysView from "./components/KeysView";
import LeaderboardsView from "./components/LeaderboardsView";
import MyProfileView from "./components/MyProfileView";
import SettingsView from "./components/SettingsView";
import PublicProfilePage from "./components/PublicProfilePage";

type Tab = "today" | "history" | "keys" | "leaderboards" | "profile" | "settings";

const TAB_LABELS: Record<Tab, string> = {
  today: "Today",
  history: "History",
  keys: "Keys",
  leaderboards: "Leaderboards",
  profile: "Profile",
  settings: "Settings",
};

// /u/:username is a standalone shareable page (see PublicProfilePage.tsx),
// reachable with nobody signed in -- checked before anything else in this
// component so it bypasses the login gate entirely. This app has no router
// (see main.tsx); a plain regex on the current path is enough for the one
// route that needs to exist outside the normal tab shell. Vite's default
// history-fallback (appType: "spa", both `npm run dev` and `vite preview`)
// is what makes a hard refresh on /u/alice serve this same index.html
// rather than 404ing.
const PUBLIC_PROFILE_PATH = /^\/u\/([^/]+)$/;

export default function App() {
  const [token, setToken] = useState<string | null>(getToken());
  const [username, setUsername] = useState<string | null>(getUsername());
  const [tab, setTab] = useState<Tab>("today");

  const publicProfileMatch = window.location.pathname.match(PUBLIC_PROFILE_PATH);
  if (publicProfileMatch) {
    return <PublicProfilePage username={decodeURIComponent(publicProfileMatch[1])} />;
  }

  function handleAuthed(newToken: string, newRefreshToken: string, newUsername: string) {
    setSession(newToken, newRefreshToken, newUsername);
    setToken(newToken);
    setUsername(newUsername);
  }

  function handleLogout() {
    clearSession();
    setToken(null);
    setUsername(null);
  }

  if (!token) {
    return <Login onAuthed={handleAuthed} />;
  }

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 32px" }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 32,
        }}
      >
        <div>
          <h1 style={{ fontSize: 20, margin: 0 }}>KeyCount</h1>
          <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
            Signed in as {username}
          </div>
        </div>
        <button
          onClick={handleLogout}
          style={{
            background: "none",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: "6px 12px",
            color: "var(--text-secondary)",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          Sign out
        </button>
      </header>

      <nav style={{ display: "flex", gap: 4, marginBottom: 28, borderBottom: "1px solid var(--border)" }}>
        {(["today", "history", "keys", "leaderboards", "profile", "settings"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              background: "none",
              border: "none",
              borderBottom: "2px solid " + (tab === t ? "var(--accent)" : "transparent"),
              color: tab === t ? "var(--text-primary)" : "var(--text-muted)",
              padding: "10px 4px",
              marginRight: 20,
              fontSize: 14,
              fontWeight: tab === t ? 600 : 400,
              cursor: "pointer",
            }}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </nav>

      {tab === "today" && <TodayView />}
      {tab === "history" && <HistoryView />}
      {tab === "keys" && <KeysView />}
      {tab === "leaderboards" && <LeaderboardsView />}
      {tab === "profile" && <MyProfileView onManageVisibility={() => setTab("settings")} />}
      {tab === "settings" && <SettingsView />}
    </div>
  );
}

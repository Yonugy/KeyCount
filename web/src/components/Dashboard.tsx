import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { getUsername, clearSession } from "../api";
import TodayView from "./TodayView";
import HistoryView from "./HistoryView";
import KeysView from "./KeysView";
import LeaderboardsView from "./LeaderboardsView";
import MyProfileView from "./MyProfileView";
import SettingsView from "./SettingsView";
import FriendsView from "./FriendsView";

type Tab = "today" | "history" | "keys" | "leaderboards" | "friends" | "profile" | "settings";

const TAB_LABELS: Record<Tab, string> = {
  today: "Today",
  history: "History",
  keys: "Keys",
  leaderboards: "Leaderboards",
  friends: "Friends",
  profile: "Profile",
  settings: "Settings",
};

// The signed-in app shell -- lifted out of App.tsx unchanged (2026-09-13,
// routing phase 1) when a router took over deciding *whether* this shell
// renders at all (see RequireAuth.tsx). Nothing about the tabs, the views,
// or the sign-out button changed here, only where the auth check itself
// lives moved to RequireAuth, one level up.
export default function Dashboard() {
  const [username] = useState<string | null>(getUsername());
  const [tab, setTab] = useState<Tab>("today");
  const navigate = useNavigate();

  function handleLogout() {
    clearSession();
    // Phase 1 sends a signed-out visitor to "/", which for now (before the
    // Phase 2 landing page exists) itself redirects on to "/login" -- see
    // App.tsx's root route. Once the real landing page lands, this still
    // does the right thing unchanged: "/" becomes a real page to land on
    // instead of an immediate bounce.
    navigate("/");
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
        {(["today", "history", "keys", "leaderboards", "friends", "profile", "settings"] as Tab[]).map((t) => (
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
      {tab === "friends" && <FriendsView />}
      {tab === "profile" && <MyProfileView onManageVisibility={() => setTab("settings")} />}
      {tab === "settings" && <SettingsView />}
    </div>
  );
}

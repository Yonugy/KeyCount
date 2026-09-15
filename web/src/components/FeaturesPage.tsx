import PublicNav from "./PublicNav";

// Specs page (2026-09-13 phase 2). Content here is pulled from the root
// README and the design doc, not invented -- see each section's grouping
// below for what it maps to (agent behavior, dashboard views, privacy
// posture). Keep this in sync with the root README if either changes;
// they're describing the same underlying behavior from two angles.
export default function FeaturesPage() {
  return (
    <div style={{ minHeight: "100vh" }}>
      <PublicNav />

      <main style={{ maxWidth: 760, margin: "0 auto", padding: "24px 32px 64px" }}>
        <h1 style={{ fontSize: 30, margin: "0 0 12px", color: "var(--text-primary)" }}>
          What KeyCount does
        </h1>
        <p style={{ fontSize: 15, margin: "0 0 40px", color: "var(--text-secondary)", lineHeight: 1.6 }}>
          Three pieces working together: a small background agent on your
          machine, a backend that stores what it syncs, and a dashboard to
          look at it.
        </p>

        <FeatureSection title="Tracking">
          <FeatureItem
            title="Keystrokes and clicks, counted locally"
            body="A background agent hooks your keyboard and mouse and buckets activity per minute. It never logs the actual characters you type, only counts and coarse categories like letter, digit, symbol, modifier, and backspace."
          />
          <FeatureItem
            title="Idle detection"
            body="A stretch with no input (60 seconds by default) closes out the current session automatically, so idle time doesn't get counted as activity."
          />
          <FeatureItem
            title="Per-app awareness"
            body={
              'On macOS, the agent detects which app is in the foreground and attributes each minute\'s activity to it, powering the dashboard\'s per-app breakdown. Falls back to "unknown" where that detection isn\'t available.'
            }
          />
        </FeatureSection>

        <FeatureSection title="Dashboard">
          <FeatureItem
            title="Streaks and daily history"
            body="A running streak for consecutive active days, plus a full history chart and calendar heatmap so you can see the trend over weeks and months, not just today."
          />
          <FeatureItem
            title="Today, week, month, all time"
            body="Every view can be sliced by range, with per-day averages that only count days you actually had activity on, not a diluted average over quiet days too."
          />
        </FeatureSection>

        <FeatureSection title="Social">
          <FeatureItem
            title="Leaderboards, global or friends-only"
            body="Rank by total keystrokes or longest streak, against every registered user or just the friends you've added, with a toggle to switch between the two."
          />
          <FeatureItem
            title="Friend requests"
            body="Send a request by username, accept or decline incoming ones, and manage your friends list from its own tab."
          />
          <FeatureItem
            title="Opt-in public profile"
            body="Turn on a shareable /u/yourname page with your totals and streaks, off by default. Nothing about you is visible to anyone else until you turn it on."
          />
        </FeatureSection>

        <FeatureSection title="Privacy">
          <FeatureItem
            title="What actually leaves your machine"
            body="Counts, categories, and timing, synced to your own account. The specific keys you pressed never leave your machine, and never get reconstructed into words or sequences anywhere."
          />
          <FeatureItem
            title="Per-key stats stay local"
            body="The agent can optionally track which physical key you pressed most (for your own curiosity, viewable in the dashboard's Keys tab), but that breakdown is stored locally only and is never part of what syncs to the backend. Turn it off entirely if you'd rather not track it at all."
          />
        </FeatureSection>
      </main>
    </div>
  );
}

function FeatureSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 36 }}>
      <h2
        style={{
          fontSize: 13,
          textTransform: "uppercase",
          letterSpacing: 0.6,
          color: "var(--text-muted)",
          margin: "0 0 16px",
        }}
      >
        {title}
      </h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>{children}</div>
    </section>
  );
}

function FeatureItem({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <h3 style={{ margin: "0 0 4px", fontSize: 16, color: "var(--text-primary)" }}>{title}</h3>
      <p style={{ margin: 0, fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.55 }}>{body}</p>
    </div>
  );
}

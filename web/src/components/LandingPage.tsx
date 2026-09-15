import { Link } from "react-router-dom";
import { getToken } from "../api";
import PublicNav from "./PublicNav";

// The public homepage (2026-09-13 phase 2). Always renders here at "/",
// signed in or not -- per direct decision, a signed-in visitor gets a
// "Go to dashboard" link (in PublicNav, and again in the hero below)
// instead of being auto-redirected away from it. Phase 1's RootRedirect
// placeholder used to own this path; this replaces it outright.
//
// Deliberately plain for this phase, no space background or animated
// buttons yet -- that's its own later pass on top of this once the page
// structure itself is settled. See phase 5 in the project plan.
export default function LandingPage() {
  const signedIn = !!getToken();

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <PublicNav />

      <main style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 32px" }}>
        <div style={{ maxWidth: 640, textAlign: "center", display: "flex", flexDirection: "column", gap: 20 }}>
          <h1 style={{ fontSize: 40, margin: 0, color: "var(--text-primary)", lineHeight: 1.15 }}>
            Watch your typing add up.
          </h1>
          <p style={{ fontSize: 17, margin: 0, color: "var(--text-secondary)", lineHeight: 1.5 }}>
            KeyCount tracks your keystrokes and clicks in the background,
            keeps a streak going, and shows you the trend, without ever
            logging what you actually typed.
          </p>

          <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 12, flexWrap: "wrap" }}>
            <Link to="/download" style={primaryButtonStyle}>
              Download
            </Link>
            <Link to="/features" style={secondaryButtonStyle}>
              See what it does
            </Link>
          </div>

          {signedIn && (
            <div style={{ marginTop: 8 }}>
              <Link to="/app" style={{ color: "var(--text-muted)", fontSize: 13 }}>
                Already tracking, go to your dashboard &rarr;
              </Link>
            </div>
          )}
        </div>
      </main>

      <section
        style={{
          borderTop: "1px solid var(--border)",
          padding: "40px 32px",
        }}
      >
        <div
          style={{
            maxWidth: 1100,
            margin: "0 auto",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 24,
          }}
        >
          <HighlightCard
            title="Local-first"
            body="Every keystroke is counted on your own machine. Only totals and categories ever leave it, never the actual characters you typed."
          />
          <HighlightCard
            title="Streaks and history"
            body="A daily streak, a full history chart, and per-app breakdowns so you can see where your typing actually happens."
          />
          <HighlightCard
            title="Leaderboards, global or friends"
            body="Compare keystroke totals and streaks against everyone, or just the friends you've added, your call."
          />
        </div>
      </section>

      <footer style={{ borderTop: "1px solid var(--border)", padding: "20px 32px", textAlign: "center" }}>
        <span style={{ color: "var(--text-muted)", fontSize: 12 }}>KeyCount</span>
      </footer>
    </div>
  );
}

function HighlightCard({ title, body }: { title: string; body: string }) {
  return (
    <div
      style={{
        background: "var(--surface-1)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: 20,
      }}
    >
      <h3 style={{ margin: "0 0 8px", fontSize: 15, color: "var(--text-primary)" }}>{title}</h3>
      <p style={{ margin: 0, fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.5 }}>{body}</p>
    </div>
  );
}

const primaryButtonStyle: React.CSSProperties = {
  background: "var(--accent)",
  color: "#ffffff",
  textDecoration: "none",
  fontSize: 15,
  fontWeight: 600,
  padding: "12px 24px",
  borderRadius: 8,
};

const secondaryButtonStyle: React.CSSProperties = {
  background: "none",
  color: "var(--text-primary)",
  border: "1px solid var(--border)",
  textDecoration: "none",
  fontSize: 15,
  fontWeight: 600,
  padding: "12px 24px",
  borderRadius: 8,
};

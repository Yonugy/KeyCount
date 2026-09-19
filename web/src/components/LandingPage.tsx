import { useEffect } from "react";
import { Link } from "react-router-dom";
import { getToken } from "../api";
import { playKeySound } from "../lib/clickSound";
import PublicNav from "./PublicNav";
import Starfield from "./Starfield";
import ArcadeButton from "./ArcadeButton";
import SoundToggle from "./SoundToggle";
import Typewriter from "./Typewriter";

// The public homepage (2026-09-13 phase 2). Always renders here at "/",
// signed in or not -- per direct decision, a signed-in visitor gets a
// "Go to dashboard" link (in PublicNav, and again in the hero below)
// instead of being auto-redirected away from it. Phase 1's RootRedirect
// placeholder used to own this path; this replaces it outright.
//
// Space background + clicky buttons landed 2026-09-16 (phase 5), at
// first scoped to just the hero -- see Starfield.tsx, ArcadeButton.tsx,
// and clickSound.ts, and the phase 5 section of web/README.md for the
// original scope decisions (starfield only, sound off by default,
// landing page only).
//
// Widened to cover the WHOLE landing page, same day, direct feedback
// ("the star effect only on top tho... shouldn't it cover the whole
// page"). Explicitly NOT extended to Features/Download/the dashboard --
// those stay on the site's normal light/dark theme, unchanged; this
// page alone is permanently dark, since a starfield doesn't really work
// on a light background and there's no in-between. Starfield itself now
// renders once in a `position: fixed` layer behind everything (so it
// covers the full viewport as you scroll, rather than needing to match
// the page's total scrollable height), and every section below the hero
// switched from the theme-reactive var(--text-primary)/var(--surface-1)/
// var(--border) tokens to the same hardcoded light-on-dark colors the
// hero already used -- those tokens flip with the visitor's system
// theme, which would have put dark text on this now-permanently-dark
// page in light mode. PublicNav grew a "dark" variant for the same
// reason (see PublicNav.tsx) since it's shared with Features/Download,
// which still need their normal theme-reactive colors.
//
// Typewriter headline followed shortly after the original hero-only
// version (same day), see that dated follow-up entry in web/README.md.
// Modifier keys fire their own keydown when pressed alone (e.g. tapping
// Shift by itself) -- skipped so the sound only plays for an actual key
// press, not for someone resting a hand on Shift/Ctrl.
const SILENT_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "AltGraph", "CapsLock", "OS"]);

export default function LandingPage() {
  const signedIn = !!getToken();

  // Reacts to the visitor's real keyboard, not just the typewriter's own
  // typing (added 2026-09-16, same follow-up as the typewriter's own key
  // sound). Deliberately scoped to just this page rather than sitewide:
  // it's a landing-page flourish, and a real-keydown listener has no
  // business being active on a future page with a password field.
  // Gated by the same sound-on preference as everything else audio on
  // this page, so it's silent unless the visitor opted in via
  // SoundToggle.
  useEffect(() => {
    function handleKeydown(e: KeyboardEvent) {
      if (SILENT_KEYS.has(e.key)) return;
      playKeySound();
    }
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, []);

  return (
    <div style={{ position: "relative", minHeight: "100vh", background: "#05070f" }}>
      {/* Starfield now backs the entire page, not just the hero -- fixed
          to the viewport (not the page's scrollable height) so it stays
          full-bleed behind everything as you scroll, no resize math
          needed for the page's total height. zIndex:0 with the actual
          content wrapper below at zIndex:1 keeps it behind every section
          regardless of each section's own static/positioned layout. */}
      <div aria-hidden="true" style={{ position: "fixed", inset: 0, zIndex: 0 }}>
        <Starfield />
      </div>

      <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", minHeight: "100vh" }}>
        <PublicNav variant="dark" />

        <main
          style={{
            flex: 1,
            position: "relative",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "40px 32px",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "relative",
              maxWidth: 640,
              textAlign: "center",
              display: "flex",
              flexDirection: "column",
              gap: 20,
            }}
          >
          <h1 style={{ fontSize: 40, margin: 0, color: "#ffffff", lineHeight: 1.15 }}>
            <Typewriter text="Watch your typing add up." />
          </h1>
          <p style={{ fontSize: 17, margin: 0, color: "rgba(255,255,255,0.75)", lineHeight: 1.5 }}>
            KeyCount tracks your keystrokes and clicks in the background,
            keeps a streak going, and shows you the trend, without ever
            logging what you actually typed.
          </p>

          <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 12, flexWrap: "wrap" }}>
            <ArcadeButton to="/download" variant="primary">
              Download
            </ArcadeButton>
            <ArcadeButton to="/features" variant="secondary">
              See what it does
            </ArcadeButton>
          </div>

          <div style={{ marginTop: 4 }}>
            <SoundToggle />
          </div>

          {signedIn && (
            <div style={{ marginTop: 8 }}>
              <Link
                to="/app"
                className="kc-quiet-link"
                style={{ color: "rgba(255,255,255,0.6)", fontSize: 13 }}
              >
                Already tracking, go to your dashboard &rarr;
              </Link>
            </div>
          )}
          </div>
        </main>

        {/* Product screenshot, added 2026-09-16 (phase 6) after direct
            feedback that the page felt thin and had nothing to even
            scroll to. This is a real screenshot of the actual dashboard
            (Today view) -- captured against a test account seeded with
            generated sample data, NOT a mockup. The caption says so
            explicitly: it would be dishonest to let a demo account's
            numbers read as real user activity, the same reasoning
            that's kept this page free of fabricated testimonials or
            social-proof numbers. Colors hardcoded light-on-dark (not
            var(--text-primary) etc) now that the starfield backs the
            whole page -- see the file-level note above. */}
        <section style={{ borderTop: "1px solid rgba(255,255,255,0.1)", padding: "56px 32px 40px" }}>
          <div style={{ maxWidth: 900, margin: "0 auto", textAlign: "center" }}>
            <h2 style={{ fontSize: 24, margin: "0 0 8px", color: "#ffffff" }}>
              See your activity at a glance
            </h2>
            <p style={{ fontSize: 14.5, margin: "0 0 28px", color: "rgba(255,255,255,0.75)", lineHeight: 1.55 }}>
              A daily chart, streak, and per-app breakdown as soon as you sign in.
            </p>
            <div
              style={{
                background: "#0d0d0d",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 12,
                overflow: "hidden",
                boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
              }}
            >
              <div
                aria-hidden="true"
                style={{ display: "flex", gap: 6, padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}
              >
                <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#5f5a54" }} />
                <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#5f5a54" }} />
                <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#5f5a54" }} />
              </div>
              <img
                src="/dashboard-preview.png"
                alt="KeyCount dashboard Today view, showing a keystroke chart, streak, and per-app breakdown"
                style={{ display: "block", width: "100%", height: "auto" }}
                loading="lazy"
              />
            </div>
            <p style={{ fontSize: 12, margin: "10px 0 0", color: "rgba(255,255,255,0.55)" }}>
              Sample dashboard shown with seeded demo data.
            </p>
          </div>
        </section>

        <section
          style={{
            borderTop: "1px solid rgba(255,255,255,0.1)",
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
              icon={<IconShield />}
              title="Local-first"
              body="Every keystroke is counted on your own machine. Only totals and categories ever leave it, never the actual characters you typed."
            />
            <HighlightCard
              icon={<IconFlame />}
              title="Streaks and history"
              body="A daily streak, a full history chart, and per-app breakdowns so you can see where your typing actually happens."
            />
            <HighlightCard
              icon={<IconTrophy />}
              title="Leaderboards, global or friends"
              body="Compare keystroke totals and streaks against everyone, or just the friends you've added, your call."
            />
          </div>
        </section>

        {/* Short "how it works" strip, added alongside the screenshot
            above for the same reason (scroll depth + "what actually
            happens" clarity) -- three steps, no more, since the product
            genuinely is this simple to get running. */}
        <section style={{ borderTop: "1px solid rgba(255,255,255,0.1)", padding: "40px 32px" }}>
          <div style={{ maxWidth: 1100, margin: "0 auto" }}>
            <h2 style={{ fontSize: 20, margin: "0 0 24px", color: "#ffffff", textAlign: "center" }}>
              How it works
            </h2>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: 24,
              }}
            >
              <HowItWorksStep
                n={1}
                title="Install the agent"
                body="Grab the packaged build for macOS or Windows, no Python setup required."
              />
              <HowItWorksStep
                n={2}
                title="It runs quietly in the background"
                body="Keystrokes and clicks are counted per app, per minute, locally. Nothing you type is ever logged."
              />
              <HowItWorksStep
                n={3}
                title="Check your dashboard anytime"
                body="Sign in on the web to see your streak, trend, and where your typing actually happens."
              />
            </div>
          </div>
        </section>

        <footer style={{ borderTop: "1px solid rgba(255,255,255,0.1)", padding: "20px 32px", textAlign: "center" }}>
          <span style={{ color: "rgba(255,255,255,0.55)", fontSize: 12 }}>KeyCount</span>
        </footer>
      </div>
    </div>
  );
}

function HighlightCard({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div
      style={{
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 10,
        padding: 20,
      }}
    >
      <div
        aria-hidden="true"
        style={{
          width: 34,
          height: 34,
          borderRadius: 8,
          background: "var(--accent)",
          color: "#ffffff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 12,
        }}
      >
        {icon}
      </div>
      <h3 style={{ margin: "0 0 8px", fontSize: 15, color: "#ffffff" }}>{title}</h3>
      <p style={{ margin: 0, fontSize: 13.5, color: "rgba(255,255,255,0.75)", lineHeight: 1.5 }}>{body}</p>
    </div>
  );
}

function HowItWorksStep({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <div>
      <div
        aria-hidden="true"
        style={{
          width: 28,
          height: 28,
          borderRadius: "50%",
          border: "1.5px solid var(--accent)",
          color: "var(--accent)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 13,
          fontWeight: 700,
          marginBottom: 10,
        }}
      >
        {n}
      </div>
      <h3 style={{ margin: "0 0 6px", fontSize: 14.5, color: "#ffffff" }}>{title}</h3>
      <p style={{ margin: 0, fontSize: 13.5, color: "rgba(255,255,255,0.75)", lineHeight: 1.5 }}>{body}</p>
    </div>
  );
}

// Small inline icon set for the highlight cards, added 2026-09-16 (phase
// 6) as part of giving the landing page "some graphics like icon and
// stuff." Plain stroke-style SVGs sharing one visual language (24x24,
// currentColor, 1.75 stroke) rather than pulling in an icon library for
// three glyphs.
function IconShield() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l7 3v6c0 4.5-3 8-7 9-4-1-7-4.5-7-9V6l7-3z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

function IconFlame() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3c1 3-3 4-3 7.5a3 3 0 006 0c0-1-.5-2-1-2.5.5 2.5 2.5 3 2.5 5.5a4.5 4.5 0 01-9 0c0-4 2-5 2-8.5C9.5 4.5 10.5 3.5 12 3z" />
    </svg>
  );
}

function IconTrophy() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 4h10v5a5 5 0 01-10 0V4z" />
      <path d="M7 5H4v2a3 3 0 003 3M17 5h3v2a3 3 0 01-3 3" />
      <path d="M12 14v3M9 20h6M9.5 17h5l.5 3H9l.5-3z" />
    </svg>
  );
}

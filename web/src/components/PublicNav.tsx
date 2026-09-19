import { Link } from "react-router-dom";
import { getToken } from "../api";
import CustomCursor from "./CustomCursor";

// Shared nav for the three public pages (Landing/Features/Download,
// 2026-09-13 phase 2). Deliberately separate from Dashboard.tsx's own nav
// -- that one is the signed-in tab bar, this one is a plain marketing
// nav, and the two are never shown together (RequireAuth keeps /app
// behind sign-in, and these pages are outside RequireAuth entirely).
//
// Also mounts CustomCursor (2026-09-16) -- since this component is the
// one thing shared across exactly those three pages, mounting the big
// animated cursor here gets it onto all three without touching each
// page. Deliberately NOT sitewide: Login (outside this nav) and the
// authenticated Dashboard app (its own separate nav) don't get it --
// Login because a decorative cursor effect has no business anywhere near
// a password field, and Dashboard because it's a working tool someone
// uses all day, not a themed marketing page.
type PublicNavProps = {
  // "auto" (default) follows the visitor's own light/dark theme via the
  // usual var(--text-primary)/var(--text-secondary) tokens -- unchanged
  // behavior, still what Features and Download use. "dark" (added
  // 2026-09-16, when the landing page's starfield grew from just the
  // hero to the whole page) hardcodes light-on-dark colors instead, the
  // same way the hero's own copy already does, so the nav reads
  // correctly sitting directly on the now-full-page space background
  // regardless of the visitor's system theme.
  variant?: "auto" | "dark";
};

export default function PublicNav({ variant = "auto" }: PublicNavProps) {
  const signedIn = !!getToken();
  const dark = variant === "dark";

  return (
    <>
    <CustomCursor />
    <nav
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "20px 32px",
        maxWidth: 1100,
        width: "100%",
        margin: "0 auto",
        boxSizing: "border-box",
      }}
    >
      <Link
        to="/"
        style={{
          color: dark ? "#ffffff" : "var(--text-primary)",
          textDecoration: "none",
          fontSize: 18,
          fontWeight: 700,
        }}
      >
        KeyCount
      </Link>
      <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
        <Link to="/features" style={dark ? navLinkStyleDark : navLinkStyle}>
          Features
        </Link>
        <Link to="/download" style={dark ? navLinkStyleDark : navLinkStyle}>
          Download
        </Link>
        <Link
          to={signedIn ? "/app" : "/login"}
          style={{
            color: "#ffffff",
            background: "var(--accent)",
            textDecoration: "none",
            fontSize: 13,
            fontWeight: 600,
            padding: "8px 16px",
            borderRadius: 6,
          }}
        >
          {signedIn ? "Go to dashboard" : "Sign in"}
        </Link>
      </div>
    </nav>
    </>
  );
}

const navLinkStyle: React.CSSProperties = {
  color: "var(--text-secondary)",
  textDecoration: "none",
  fontSize: 14,
};

const navLinkStyleDark: React.CSSProperties = {
  color: "rgba(255,255,255,0.75)",
  textDecoration: "none",
  fontSize: 14,
};

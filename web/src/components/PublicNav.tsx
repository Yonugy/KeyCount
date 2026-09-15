import { Link } from "react-router-dom";
import { getToken } from "../api";

// Shared nav for the three public pages (Landing/Features/Download,
// 2026-09-13 phase 2). Deliberately separate from Dashboard.tsx's own nav
// -- that one is the signed-in tab bar, this one is a plain marketing
// nav, and the two are never shown together (RequireAuth keeps /app
// behind sign-in, and these pages are outside RequireAuth entirely).
export default function PublicNav() {
  const signedIn = !!getToken();

  return (
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
        style={{ color: "var(--text-primary)", textDecoration: "none", fontSize: 18, fontWeight: 700 }}
      >
        KeyCount
      </Link>
      <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
        <Link to="/features" style={navLinkStyle}>
          Features
        </Link>
        <Link to="/download" style={navLinkStyle}>
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
  );
}

const navLinkStyle: React.CSSProperties = {
  color: "var(--text-secondary)",
  textDecoration: "none",
  fontSize: 14,
};

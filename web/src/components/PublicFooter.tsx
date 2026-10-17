import { useState } from "react";
import { Link } from "react-router-dom";
import { getToken } from "../api";

// Shared footer for the three public pages (Landing/Features/Download).
// Same "auto" / "dark" split as PublicNav: "auto" follows the visitor's
// light/dark theme tokens (Features, Download), "dark" hardcodes
// light-on-dark colors for the landing page's space background.
//
// The link columns sit inside a <nav>, which is what makes
// GlobalClickSound.tsx give them the same nav hover/click sounds as the
// header links, with no extra wiring.
//
// Only links that point somewhere real are listed. There is no contact
// email, privacy policy or terms page yet, so none are shown. Add them to
// PROJECT_LINKS (or a new column) once they exist.
// Project column removed for now. To bring it back, uncomment REPO_URL,
// projectLinks and the second FooterColumn below.
// const REPO_URL = "https://github.com/Yonugy/KeyCount";

type FooterLinkItem = { label: string; to?: string; href?: string };

type PublicFooterProps = {
  variant?: "auto" | "dark";
};

export default function PublicFooter({ variant = "auto" }: PublicFooterProps) {
  const signedIn = !!getToken();
  const dark = variant === "dark";

  const colors = dark
    ? {
        border: "rgba(255,255,255,0.1)",
        brand: "#ffffff",
        heading: "rgba(255,255,255,0.45)",
        text: "rgba(255,255,255,0.7)",
        hover: "#ffffff",
        muted: "rgba(255,255,255,0.5)",
      }
    : {
        border: "var(--border)",
        brand: "var(--text-primary)",
        heading: "var(--text-muted)",
        text: "var(--text-secondary)",
        hover: "var(--text-primary)",
        muted: "var(--text-muted)",
      };

  const productLinks: FooterLinkItem[] = [
    { label: "Features", to: "/features" },
    { label: "Download", to: "/download" },
    signedIn ? { label: "Go to dashboard", to: "/app" } : { label: "Sign in", to: "/login" },
  ];
  // const projectLinks: FooterLinkItem[] = [
  //   { label: "GitHub", href: REPO_URL },
  //   { label: "Releases", href: `${REPO_URL}/releases` },
  //   { label: "Report an issue", href: `${REPO_URL}/issues` },
  // ];

  return (
    <footer style={{ borderTop: `1px solid ${colors.border}`, marginTop: "auto", width: "100%" }}>
      <div
        style={{
          maxWidth: 1100,
          margin: "0 auto",
          padding: "40px 32px 20px",
          boxSizing: "border-box",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: "32px 24px",
        }}
      >
        <div style={{ gridColumn: "span 2", maxWidth: 360 }}>
          <div style={{ color: colors.brand, fontSize: 18, fontWeight: 700 }}>KeyCount</div>
          <p style={{ color: colors.text, fontSize: 14, lineHeight: 1.55, margin: "8px 0 0" }}>
            Counts your keys and clicks. Never what you type.
          </p>
        </div>

        <nav aria-label="Footer" style={{ display: "contents" }}>
          <FooterColumn title="Product" links={productLinks} colors={colors} />
          {/* <FooterColumn title="Project" links={projectLinks} colors={colors} /> */}
        </nav>
      </div>

      <div
        style={{
          maxWidth: 1100,
          margin: "0 auto",
          padding: "16px 32px 28px",
          boxSizing: "border-box",
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          gap: 8,
          fontSize: 12,
          color: colors.muted,
        }}
      >
        <span>&copy; {new Date().getFullYear()} KeyCount</span>
        <span>Local-first. What you type never leaves your computer.</span>
      </div>
    </footer>
  );
}

type FooterColors = { heading: string; text: string; hover: string };

function FooterColumn({ title, links, colors }: { title: string; links: FooterLinkItem[]; colors: FooterColors }) {
  return (
    <div>
      <div
        style={{
          color: colors.heading,
          fontSize: 12,
          textTransform: "uppercase",
          letterSpacing: 0.6,
          marginBottom: 12,
        }}
      >
        {title}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {links.map((l) => (
          <FooterLink key={l.label} item={l} colors={colors} />
        ))}
      </div>
    </div>
  );
}

function FooterLink({ item, colors }: { item: FooterLinkItem; colors: FooterColors }) {
  const [hovered, setHovered] = useState(false);
  const style: React.CSSProperties = {
    color: hovered ? colors.hover : colors.text,
    textDecoration: "none",
    fontSize: 14,
    width: "fit-content",
  };
  const hover = {
    onMouseEnter: () => setHovered(true),
    onMouseLeave: () => setHovered(false),
  };
  if (item.to) {
    return (
      <Link to={item.to} style={style} {...hover}>
        {item.label}
      </Link>
    );
  }
  return (
    <a href={item.href} target="_blank" rel="noopener noreferrer" style={style} {...hover}>
      {item.label}
    </a>
  );
}

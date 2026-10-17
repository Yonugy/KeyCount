import { useEffect, useState } from "react";
import PublicNav from "./PublicNav";
import { playPressSound, playReleaseSound, playCtaHoverSound } from "../lib/clickSound";

type OS = "mac" | "windows";

// Download page. The buttons point at the installers that
// .github/workflows/release-tauri.yml attaches to each version tag:
// KeyCount_v<version>.exe (Windows) and KeyCount_v<version>.dmg (macOS).
//
// The file names contain the version, so GitHub's fixed
// releases/latest/download/<name> link can't be used any more. Instead the
// page asks the GitHub API for the latest release and picks the asset with
// the right extension. If that request fails (offline, rate limited, or the
// latest release has no installer yet) the button falls back to the
// releases page, which always works.
//
// The Python agent is no longer released, so the old zip and bare exe
// names are gone.
const REPO = "Yonugy/KeyCount";
const LATEST_API = `https://api.github.com/repos/${REPO}/releases/latest`;
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;
const ASSET_PATTERN: Record<OS, RegExp> = {
  mac: /^KeyCount_v.+\.dmg$/,
  windows: /^KeyCount_v.+\.exe$/,
};

type Asset = { name: string; url: string };
type ReleaseAsset = { name: string; browser_download_url: string };

export default function DownloadPage() {
  const [os, setOs] = useState<OS>("mac");
  const [assets, setAssets] = useState<Partial<Record<OS, Asset>>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch(LATEST_API, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((release: { assets?: ReleaseAsset[] }) => {
        const found: Partial<Record<OS, Asset>> = {};
        for (const key of ["mac", "windows"] as OS[]) {
          const a = (release.assets ?? []).find((x) => ASSET_PATTERN[key].test(x.name));
          if (a) found[key] = { name: a.name, url: a.browser_download_url };
        }
        setAssets(found);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
    return () => controller.abort();
  }, []);
  const asset = assets[os];
  // Mirrors ArcadeButton.tsx's own hover-lift state -- this button gets
  // the same CTA treatment (accent background, press/release/hover
  // sound) so it needed the same visual hover reaction too (2026-09-16),
  // and a plain CSS `:hover` rule can't compose with a future press
  // animation the way tracked state can.
  const [dlHovered, setDlHovered] = useState(false);
  const reduceMotion =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  return (
    <div style={{ minHeight: "100vh" }}>
      <PublicNav />

      <main style={{ maxWidth: 640, margin: "0 auto", padding: "24px 32px 64px" }}>
        <h1 style={{ fontSize: 30, margin: "0 0 8px", color: "var(--text-primary)" }}>
          Download
        </h1>
        <p style={{ fontSize: 15, margin: "0 0 28px", color: "var(--text-secondary)", lineHeight: 1.55 }}>
          Grab the installer below, nothing else to set up. Prefer to build
          it from source instead? Steps for that are further down.
        </p>

        <div style={{ display: "flex", gap: 6, marginBottom: 24 }}>
          {(
            [
              { value: "mac", label: "macOS" },
              { value: "windows", label: "Windows" },
            ] as { value: OS; label: string }[]
          ).map((o) => {
            const active = o.value === os;
            return (
              <button
                key={o.value}
                onClick={() => setOs(o.value)}
                style={{
                  background: active ? "var(--surface-1)" : "none",
                  color: active ? "var(--text-primary)" : "var(--text-muted)",
                  border: "1px solid " + (active ? "var(--border)" : "transparent"),
                  borderRadius: 6,
                  padding: "6px 14px",
                  fontSize: 14,
                  fontWeight: active ? 600 : 400,
                  cursor: "pointer",
                }}
              >
                {o.label}
              </button>
            );
          })}
        </div>

        <div
          style={{
            background: "var(--surface-1)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            padding: "16px 20px",
            marginBottom: 24,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div>
            <div style={{ fontSize: 14, color: "var(--text-primary)", fontWeight: 600 }}>
              {os === "mac" ? "macOS installer" : "Windows installer"}
            </div>
            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{asset ? asset.name : loaded ? "See the latest release" : "Checking the latest release..."}</div>
          </div>
          <a
            href={asset ? asset.url : RELEASES_PAGE}
            // Same accent-colored CTA treatment as the hero's ArcadeButton,
            // so it gets the same press/release/hover tune (2026-09-16 --
            // this was "the download button" the sound effects were
            // missing from, since it's a plain <a> rather than the
            // ArcadeButton component or a <button>, so neither the arcade
            // click handling nor the generic sitewide one ever reached it).
            onMouseEnter={() => {
              setDlHovered(true);
              playCtaHoverSound();
            }}
            onMouseLeave={() => setDlHovered(false)}
            onMouseDown={() => playPressSound()}
            onMouseUp={() => playReleaseSound()}
            style={{
              background: "var(--accent)",
              border: "1px solid var(--accent)",
              borderRadius: 6,
              padding: "8px 16px",
              color: "#ffffff",
              fontSize: 13,
              fontWeight: 600,
              textDecoration: "none",
              display: "inline-block",
              transform: dlHovered && !reduceMotion ? "translateY(-1px)" : "translateY(0)",
              filter: dlHovered ? "brightness(1.08)" : "none",
              transition: reduceMotion ? "none" : "transform 90ms ease, filter 90ms ease",
            }}
          >
            Download
          </a>
        </div>
        <p style={{ fontSize: 12.5, color: "var(--text-muted)", margin: "-12px 0 24px", lineHeight: 1.5 }}>
          {os === "mac"
            ? "Open the .dmg and drag KeyCount into Applications. Works on Apple silicon and Intel. The first time, right-click the app and choose Open, or allow it in System Settings, Privacy & Security. Then turn on Input Monitoring for KeyCount in Privacy & Security, and quit and reopen the app."
            : "Run the .exe to install. Windows SmartScreen may show a warning the first time, click More info, then Run anyway."}{" "}
          The installer is not code-signed yet, so your OS will likely warn
          before opening it. If the button opens the releases page instead,
          download the file there, or use "Build from source" below.
        </p>

        <h2 style={{ fontSize: 16, margin: "0 0 12px", color: "var(--text-primary)" }}>
          Prefer to build from source?
        </h2>

        <ol style={stepListStyle}>
          <li>
            Install Rust (stable) from rustup.rs, then the Tauri command line
            tool:
            <CodeBlock>cargo install tauri-cli --version "^2" --locked</CodeBlock>
          </li>
          <li>
            Clone the repo and start the agent:
            <CodeBlock>
              {os === "mac"
                ? "git clone https://github.com/Yonugy/KeyCount.git\ncd KeyCount/tauri/src-tauri\ncargo tauri dev"
                : "git clone https://github.com/Yonugy/KeyCount.git\ncd KeyCount\\tauri\\src-tauri\ncargo tauri dev"}
            </CodeBlock>
          </li>
          {os === "mac" ? (
            <li>
              macOS will ask for Input Monitoring permission the first time.
              This is required for the global keyboard and mouse hook to
              work. After turning it on, quit and reopen the app.
            </li>
          ) : (
            <li>
              Windows needs the Microsoft C++ Build Tools and WebView2, which
              Windows 10 and 11 usually already have. See the Tauri
              prerequisites page if the build asks for something.
            </li>
          )}
        </ol>

        <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 20, lineHeight: 1.5 }}>
          To sync to your account and see it in the dashboard, sign in from
          the KeyCount window once the backend is set up, see the project's
          README for the full walkthrough.
        </p>
      </main>
    </div>
  );
}

function CodeBlock({ children }: { children: React.ReactNode }) {
  return (
    <pre
      style={{
        background: "var(--plane)",
        border: "1px solid var(--border)",
        borderRadius: 6,
        padding: "10px 14px",
        fontSize: 13,
        color: "var(--text-primary)",
        overflowX: "auto",
        margin: "6px 0 12px",
      }}
    >
      <code>{children}</code>
    </pre>
  );
}

const stepListStyle: React.CSSProperties = {
  margin: 0,
  paddingLeft: 20,
  display: "flex",
  flexDirection: "column",
  gap: 12,
  fontSize: 14,
  color: "var(--text-secondary)",
  lineHeight: 1.55,
};

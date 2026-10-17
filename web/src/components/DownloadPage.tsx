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
// releases page, which always works. (Superseded: when no installer is found
// the button is now disabled and says "Unavailable".)
//
// The Python agent is no longer released, so the old zip and bare exe
// names are gone.
//
// Layout: both installers side by side (Windows first), a short must-do
// list under each, and the build-from-source steps tucked into a closed
// <details> so they stay out of the way until someone asks for them.
const REPO = "Yonugy/KeyCount";
const LATEST_API = `https://api.github.com/repos/${REPO}/releases/latest`;
// No longer used: the button is disabled instead of falling back to this page.
// const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;
const ASSET_PATTERN: Record<OS, RegExp> = {
  mac: /^KeyCount_v.+\.dmg$/,
  windows: /^KeyCount_v.+\.exe$/,
};

type Asset = { name: string; url: string };
type ReleaseAsset = { name: string; browser_download_url: string };

// Windows first, macOS second.
const OS_ORDER: OS[] = ["windows", "mac"];

const OS_INFO: Record<OS, { title: string; subtitle: string; installer: string; steps: string[] }> = {
  windows: {
    title: "Windows",
    subtitle: "Windows 10 and 11",
    installer: "Windows installer",
    steps: [
      "Run the .exe to install.",
      "If SmartScreen warns, click More info, then Run anyway.",
    ],
  },
  mac: {
    title: "macOS",
    subtitle: "Apple silicon and Intel",
    installer: "macOS installer",
    steps: [
      "Open the .dmg and drag KeyCount into Applications.",
      "First time: right-click the app and choose Open.",
      "Turn on Input Monitoring for KeyCount in Privacy & Security, then reopen the app.",
    ],
  },
};

export default function DownloadPage() {
  const [assets, setAssets] = useState<Partial<Record<OS, Asset>>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch(LATEST_API, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((release: { assets?: ReleaseAsset[] }) => {
        const found: Partial<Record<OS, Asset>> = {};
        for (const key of OS_ORDER) {
          const a = (release.assets ?? []).find((x) => ASSET_PATTERN[key].test(x.name));
          if (a) found[key] = { name: a.name, url: a.browser_download_url };
        }
        setAssets(found);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
    return () => controller.abort();
  }, []);

  return (
    <div style={{ minHeight: "100vh" }}>
      <PublicNav />

      <main style={{ maxWidth: 760, margin: "0 auto", padding: "24px 32px 64px" }}>
        <h1 style={{ fontSize: 30, margin: "0 0 36px", color: "var(--text-primary)" }}>
          Download
        </h1>
        {/* <p style={{ fontSize: 15, margin: "0 0 28px", color: "var(--text-secondary)", lineHeight: 1.55 }}>
          Pick the installer for your computer. Nothing else to set up.
        </p> */}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: 16,
            marginBottom: 16,
          }}
        >
          {OS_ORDER.map((key) => (
            <DownloadCard key={key} os={key} asset={assets[key]} loaded={loaded} />
          ))}
        </div>

        <p style={{ fontSize: 12.5, color: "var(--text-muted)", margin: "0 0 32px", lineHeight: 1.5 }}>
          The installers are not code-signed yet, so your system may warn
          before opening them.
        </p>

        {/* Hidden for now: build-from-source steps.
        <details>
          <summary
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: "var(--text-secondary)",
              cursor: "pointer",
            }}
          >
            Prefer to build from source?
          </summary>

          <ol style={{ ...stepListStyle, marginTop: 14 }}>
            <li>
              Install Rust (stable) from rustup.rs, then the Tauri command line
              tool:
              <CodeBlock>cargo install tauri-cli --version "^2" --locked</CodeBlock>
            </li>
            <li>
              Clone the repo and build the app:
              <CodeBlock>
                {"git clone https://github.com/Yonugy/KeyCount.git\ncd KeyCount/tauri/src-tauri\ncargo tauri build"}
              </CodeBlock>
            </li>
            <li>
              Open the installer it creates in{" "}
              <code>KeyCount/tauri/src-tauri/target/release/bundle</code> and
              install it like the downloads above.
            </li>
            <li>
              If the build asks for more tools, install the Microsoft C++
              Build Tools on Windows, or run <code>xcode-select --install</code>{" "}
              on macOS.
            </li>
          </ol>
        </details>
        */}
      </main>
    </div>
  );
}

function DownloadCard({ os, asset, loaded }: { os: OS; asset?: Asset; loaded: boolean }) {
  const info = OS_INFO[os];
  // Mirrors ArcadeButton.tsx's own hover-lift state -- this button gets
  // the same CTA treatment (accent background, press/release/hover
  // sound) so it needed the same visual hover reaction too (2026-09-16),
  // and a plain CSS `:hover` rule can't compose with a future press
  // animation the way tracked state can.
  const [dlHovered, setDlHovered] = useState(false);
  const reduceMotion =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  return (
    <div
      style={{
        background: "var(--surface-1)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: "20px 22px",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <div>
        <div style={{ fontSize: 17, color: "var(--text-primary)", fontWeight: 600 }}>{info.title}</div>
        <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 2 }}>{info.subtitle}</div>
        {/* <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 2, wordBreak: "break-all" }}>
          {asset ? asset.name : loaded ? "See the latest release" : "Checking the latest release..."}
        </div> */}
      </div>

      {!asset ? (
        // No installer to link to: show a disabled button instead of
        // sending people to the releases page.
        <button
          type="button"
          disabled
          style={{
            background: "var(--surface-2, transparent)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: "9px 16px",
            color: "var(--text-muted)",
            fontSize: 14,
            fontWeight: 600,
            textAlign: "center",
            cursor: "not-allowed",
            opacity: 0.8,
          }}
        >
          {loaded ? "Unavailable" : "Checking..."}
        </button>
      ) : (
        <a
          // href={asset ? asset.url : RELEASES_PAGE}
          href={asset.url}
          aria-label={`Download the ${info.installer}`}
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
            padding: "9px 16px",
            color: "#ffffff",
            fontSize: 14,
            fontWeight: 600,
            textDecoration: "none",
            textAlign: "center",
            transform: dlHovered && !reduceMotion ? "translateY(-1px)" : "translateY(0)",
            filter: dlHovered ? "brightness(1.08)" : "none",
            transition: reduceMotion ? "none" : "transform 90ms ease, filter 90ms ease",
          }}
        >
          {/* {!asset && loaded ? "Open releases page" : "Download"} */}
          Download
        </a>
      )}

      <ol
        style={{
          margin: 0,
          padding: "14px 0 0 18px",
          borderTop: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          gap: 6,
          fontSize: 13,
          color: "var(--text-secondary)",
          lineHeight: 1.5,
        }}
      >
        {info.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </div>
  );
}

// Only used by the hidden build-from-source steps above.
/*
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
*/

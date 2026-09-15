import { useState } from "react";
import PublicNav from "./PublicNav";

type OS = "mac" | "windows";

// Download page (2026-09-13 phase 2, packaged downloads added 2026-09-14
// phase 4). The download buttons below point at
// github.com/Yonugy/KeyCount/releases/latest/download/<asset>, GitHub's
// stable "always the newest release" URL -- built by
// .github/workflows/release.yml (macOS + Windows PyInstaller builds,
// triggered by pushing a version tag) and the exact asset names it
// publishes, see ASSET_NAMES below. If no release has ever been
// published yet, that URL 404s; the "run from source" instructions
// underneath stay as a working fallback either way, not just for people
// who prefer building it themselves.
//
// Windows per-app detection shipped 2026-09-14 (phase 3, see agent.py's
// own note on it) -- the Windows tab used to flag that gap here; now its
// steps mirror the macOS tab's, pywin32 in place of pyobjc-framework-
// Quartz.
const RELEASE_BASE = "https://github.com/Yonugy/KeyCount/releases/latest/download";
const ASSET_NAMES: Record<OS, string> = {
  mac: "keycount-agent-mac.zip",
  windows: "keycount-agent-windows.zip",
};

export default function DownloadPage() {
  const [os, setOs] = useState<OS>("mac");

  return (
    <div style={{ minHeight: "100vh" }}>
      <PublicNav />

      <main style={{ maxWidth: 640, margin: "0 auto", padding: "24px 32px 64px" }}>
        <h1 style={{ fontSize: 30, margin: "0 0 8px", color: "var(--text-primary)" }}>
          Download
        </h1>
        <p style={{ fontSize: 15, margin: "0 0 28px", color: "var(--text-secondary)", lineHeight: 1.55 }}>
          Grab the packaged build below, no Python setup required. Prefer
          to run it from source instead? Steps for that are further down.
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
              {os === "mac" ? "macOS build" : "Windows build"}
            </div>
            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{ASSET_NAMES[os]}</div>
          </div>
          <a
            href={`${RELEASE_BASE}/${ASSET_NAMES[os]}`}
            style={{
              background: "var(--accent)",
              border: "1px solid var(--accent)",
              borderRadius: 6,
              padding: "8px 16px",
              color: "#ffffff",
              fontSize: 13,
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            Download
          </a>
        </div>
        <p style={{ fontSize: 12.5, color: "var(--text-muted)", margin: "-12px 0 24px", lineHeight: 1.5 }}>
          Unsigned build, not notarized/code-signed yet -- your OS will
          likely warn before opening it the first time. If nothing's been
          released yet, that link 404s; use "Run from source" below
          instead.
        </p>

        <h2 style={{ fontSize: 16, margin: "0 0 12px", color: "var(--text-primary)" }}>
          Prefer to run from source?
        </h2>

        {os === "mac" ? (
          <ol style={stepListStyle}>
            <li>
              Make sure you have Python 3.9+, then install the tracker's
              one dependency:
              <CodeBlock>pip install pynput</CodeBlock>
            </li>
            <li>
              For per-app detection, also install:
              <CodeBlock>pip install pyobjc-framework-Quartz</CodeBlock>
              (optional, keystroke/click counting works fine without it,
              apps just show as "unknown")
            </li>
            <li>
              Clone the repo and run the agent:
              <CodeBlock>{"git clone https://github.com/Yonugy/KeyCount.git\ncd KeyCount\npython3 agent.py"}</CodeBlock>
            </li>
            <li>
              macOS will prompt for Accessibility and/or Input Monitoring
              permission the first time, this is required for the global
              keyboard/mouse hook to work.
            </li>
          </ol>
        ) : (
          <ol style={stepListStyle}>
            <li>
              Make sure you have Python 3.9+, then install the tracker's
              one dependency:
              <CodeBlock>pip install pynput</CodeBlock>
            </li>
            <li>
              For per-app detection, also install:
              <CodeBlock>pip install pywin32</CodeBlock>
              (optional, keystroke/click counting works fine without it,
              apps just show as "unknown")
            </li>
            <li>
              Clone the repo and run the agent:
              <CodeBlock>{"git clone https://github.com/Yonugy/KeyCount.git\ncd KeyCount\npython agent.py"}</CodeBlock>
            </li>
          </ol>
        )}

        <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 20, lineHeight: 1.5 }}>
          To sync to your account and see it in the dashboard, run{" "}
          <code style={inlineCodeStyle}>python3 agent.py --register</code> once
          the backend is set up, see the project's README for the full
          walkthrough.
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

const inlineCodeStyle: React.CSSProperties = {
  background: "var(--plane)",
  border: "1px solid var(--border)",
  borderRadius: 4,
  padding: "1px 6px",
  fontSize: 12.5,
};

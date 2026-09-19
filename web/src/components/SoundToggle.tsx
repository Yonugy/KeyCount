import { useState } from "react";
import { isSoundEnabled, playClickSound, playDashboardClickSound, setSoundEnabled } from "../lib/clickSound";

type SoundToggleProps = {
  // "hero" (default) keeps the original look, made for sitting directly
  // on the landing hero's fixed dark background regardless of the site's
  // own light/dark theme. "subtle" was added 2026-09-16 for the signed-in
  // dashboard header, which sits on the normal themed background (light
  // or dark) rather than the hero's own fixed-dark one -- it uses the
  // same theme tokens the dashboard's other header controls (Sign out)
  // already use, so it reads correctly in both themes instead of
  // rendering near-invisible white-on-white in light mode.
  variant?: "hero" | "subtle";
};

// Toggle for the app's button-click sound (2026-09-16, phase 5, landing
// hero only at first; extended to the signed-in dashboard 2026-09-16
// after direct request -- "add the mute unmute button in the logged in
// dashboard also"). Sound defaults to off (see clickSound.ts) -- this is
// the only way a visitor turns it on, nothing plays until they click it.
// Plain text, no icon font/emoji, so it reads the same everywhere
// without depending on font/emoji support.
export default function SoundToggle({ variant = "hero" }: SoundToggleProps) {
  const [enabled, setEnabled] = useState(isSoundEnabled());

  const heroStyle: React.CSSProperties = {
    background: "transparent",
    border: "1px solid rgba(255,255,255,0.25)",
    color: "rgba(255,255,255,0.75)",
  };
  const subtleStyle: React.CSSProperties = {
    background: "none",
    border: "1px solid var(--border)",
    color: "var(--text-secondary)",
  };

  return (
    <button
      type="button"
      onClick={() => {
        const next = !enabled;
        setSoundEnabled(next);
        setEnabled(next);
        // Play a confirming click right here when turning sound ON
        // (2026-09-16 -- fixes a bug introduced the same day by
        // GlobalClickSound.tsx's capture-phase fix: that listener checks
        // isSoundEnabled() on its way DOWN to this button, before this
        // very onClick has flipped it on, so it always reads "off" for
        // the click that turns sound on and stays silent. Turning sound
        // off is unaffected -- sound is still genuinely on at the moment
        // that click is captured, so the delegated listener plays its
        // own confirming click correctly. Only the off -> on direction
        // needed this direct call.). Matches the same tune the delegated
        // listener would have played -- the dashboard's softer tune on
        // /app, the ordinary one everywhere else -- so it's consistent
        // with every other click's sound, not a one-off exception.
        if (next) {
          const inDashboard = typeof window !== "undefined" && window.location.pathname.startsWith("/app");
          if (inDashboard) playDashboardClickSound();
          else playClickSound();
        }
      }}
      aria-pressed={enabled}
      style={{
        ...(variant === "hero" ? heroStyle : subtleStyle),
        borderRadius: 999,
        fontSize: 12.5,
        padding: "6px 14px",
        cursor: "pointer",
      }}
    >
      {enabled ? "Sound: on" : "Sound: off"}
    </button>
  );
}

import { useEffect, useState } from "react";
import { playKeySound } from "../lib/clickSound";

// Types out its text one character at a time on mount, with a blinking
// cursor (2026-09-16, phase 5 follow-up). Used for the landing hero's
// headline -- since the product's whole pitch is "watch your typing add
// up", having the headline type itself out ties the one animation on
// the page directly to what KeyCount actually does, rather than being
// generic space decor. Each revealed character plays a soft key-tap
// (added same day, via playKeySound -- gated by the same sound-on
// preference as the button clicks, off by default).
//
// Respects prefers-reduced-motion: the full text renders immediately,
// no animation, no cursor, no key sound, same as everywhere else motion
// shows up on this page (Starfield, ArcadeButton).
export default function Typewriter({
  text,
  speedMs = 45,
}: {
  text: string;
  speedMs?: number;
}) {
  const reduceMotion =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const [shown, setShown] = useState(reduceMotion ? text.length : 0);

  useEffect(() => {
    if (reduceMotion) return;
    if (shown >= text.length) return;
    const id = window.setTimeout(() => {
      setShown((n) => n + 1);
      playKeySound();
    }, speedMs);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, text, speedMs, reduceMotion]);

  return (
    <>
      {text.slice(0, shown)}
      {/* A persistent blinking caret, terminal-prompt style, once typing
          finishes -- reads as "still listening", which fits a keystroke
          tracker better than the cursor just vanishing. */}
      <span
        aria-hidden="true"
        style={{
          display: "inline-block",
          width: "0.5ch",
          marginLeft: 2,
          borderRight: "3px solid currentColor",
          animation: reduceMotion ? "none" : "keycount-caret-blink 1s step-end infinite",
          opacity: reduceMotion ? 0 : 1,
        }}
      />
    </>
  );
}

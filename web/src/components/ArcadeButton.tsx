import { Link, type LinkProps } from "react-router-dom";
import { useState, type CSSProperties } from "react";
import { playPressSound, playReleaseSound, playCtaHoverSound } from "../lib/clickSound";

// A big, physical-feeling button for the landing page's hero CTAs
// (2026-09-16, phase 5): presses down and pops back up on click, with an
// optional tik/tak sound (silent unless the visitor has turned sound on
// via the page's toggle, see clickSound.ts). Deliberately kept to the
// landing page only -- Features/Download keep their existing plain
// buttons/links, per the phase 5 scope decision.
//
// Known gap: the press animation and sound fire on mouse/touch, not on
// keyboard activation (Enter/Space on a focused link fires a plain click,
// no mousedown/mouseup either side of it). Navigation itself still works
// fine by keyboard, it's only this decorative flourish that's mouse/
// touch-only for now -- flagged rather than quietly left broken for
// keyboard users. See web/README.md's phase 5 section.
type ArcadeButtonProps = LinkProps & {
  variant?: "primary" | "secondary";
};

export default function ArcadeButton({
  variant = "primary",
  style,
  children,
  onMouseDown,
  onMouseUp,
  onMouseLeave,
  onMouseEnter,
  onTouchStart,
  onTouchEnd,
  ...props
}: ArcadeButtonProps) {
  const [pressed, setPressed] = useState(false);
  // Hover lift, added 2026-09-16 alongside the hover sound -- until now
  // this button reacted to hover with sound but no visual movement at
  // all, which read as broken/inconsistent. Tracked as its own bit of
  // state (rather than the global CSS `:hover` rule the rest of the
  // app's buttons now get) because it has to compose with `pressed`
  // below: hover lifts it up 2px, press pushes it down 3px past that,
  // and the two need to combine into one transform rather than fight
  // over it the way a plain CSS `:hover`/`:active` pair would.
  const [hovered, setHovered] = useState(false);
  const reduceMotion =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const base = variant === "primary" ? primaryStyle : secondaryStyle;

  const offsetY = pressed ? 3 : hovered ? -2 : 0;

  return (
    <Link
      {...props}
      onMouseEnter={(e) => {
        setHovered(true);
        playCtaHoverSound();
        onMouseEnter?.(e);
      }}
      onMouseDown={(e) => {
        setPressed(true);
        playPressSound();
        onMouseDown?.(e);
      }}
      onMouseUp={(e) => {
        setPressed(false);
        playReleaseSound();
        onMouseUp?.(e);
      }}
      onMouseLeave={(e) => {
        setPressed(false);
        setHovered(false);
        onMouseLeave?.(e);
      }}
      onTouchStart={(e) => {
        setPressed(true);
        playPressSound();
        onTouchStart?.(e);
      }}
      onTouchEnd={(e) => {
        setPressed(false);
        playReleaseSound();
        onTouchEnd?.(e);
      }}
      style={{
        ...base,
        ...style,
        transform: reduceMotion ? "translateY(0)" : `translateY(${offsetY}px)`,
        boxShadow: pressed
          ? "0 1px 0 rgba(0,0,0,0.3) inset"
          : variant === "primary"
            ? hovered
              ? "0 6px 0 rgba(0,0,0,0.35)"
              : "0 4px 0 rgba(0,0,0,0.35)"
            : hovered
              ? "0 6px 0 rgba(255,255,255,0.12)"
              : "0 4px 0 rgba(255,255,255,0.12)",
        filter: hovered && !pressed ? "brightness(1.08)" : "none",
        transition: reduceMotion ? "none" : "transform 90ms ease, box-shadow 90ms ease, filter 90ms ease",
      }}
    >
      {children}
    </Link>
  );
}

const primaryStyle: CSSProperties = {
  background: "var(--accent)",
  color: "#ffffff",
  textDecoration: "none",
  fontSize: 15,
  fontWeight: 600,
  padding: "12px 24px",
  borderRadius: 8,
  display: "inline-block",
};

const secondaryStyle: CSSProperties = {
  background: "rgba(255,255,255,0.06)",
  color: "#ffffff",
  border: "1px solid rgba(255,255,255,0.25)",
  textDecoration: "none",
  fontSize: 15,
  fontWeight: 600,
  padding: "12px 24px",
  borderRadius: 8,
  display: "inline-block",
};

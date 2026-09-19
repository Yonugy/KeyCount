import { useEffect } from "react";
import {
  playClickSound,
  playDashboardClickSound,
  playHoverSound,
  playNavClickSound,
  playNavHoverSound,
} from "../lib/clickSound";

// Plays a click AND hover sound for the app's ordinary interactive
// controls -- public pages, Login, and the signed-in Dashboard alike
// (2026-09-16, widening the earlier click-only, landing-page-only sound
// work after direct feedback that hovering was silent and that
// PublicNav's own links -- Features, Download, Sign in / Go to
// dashboard -- had no sound at all). One delegated pair of listeners at
// the app root instead of wiring each control individually, so nothing
// gets missed as new buttons are added later.
//
// Three families, matching the different kinds of control this covers,
// each with its own tune per the "give special buttons a different
// tune" request:
//  - real <button> elements (and anything explicitly role="button")
//    INSIDE the signed-in dashboard (/app) -- tabs, sign out, settings
//    toggles -- get a lower, softer click than the same controls
//    elsewhere (playDashboardClickSound, added 2026-09-16 after direct
//    feedback that the sharper generic click got grating under how much
//    more often it fires there than anywhere else in the app).
//  - real <button> elements outside the dashboard (currently just the
//    login submit button) get the ordinary generic click/hover pair.
//  - <a> elements inside a <nav> -- PublicNav's own links -- get a
//    lighter, distinctly-pitched nav click/hover pair instead, since
//    they're a visually different kind of control (plain text/pill
//    links, not buttons).
// The arcade hero CTAs and the Download page's accent-colored Download
// button are deliberately NOT handled here: they're <a> tags outside any
// <nav>, so neither selector below ever matches them, and they already
// have their own bespoke press/release/hover sound (see ArcadeButton.tsx
// and DownloadPage.tsx) tied directly to their own mouse handlers so the
// sound stays exactly in sync with their press animation. That natural
// non-overlap is what keeps all these families from ever double-firing
// on the same element.
//
// Disabled buttons stay silent. Gated by the same sound-on preference as
// everything else audio in the app (off by default), via the sound
// functions themselves.
//
// Bug fixed 2026-09-16: the day switcher's "Next" button in DayView.tsx
// went silent specifically on the one click that lands on today (e.g.
// Yesterday -> Today), while every other day-to-day click kept its sound
// -- reported directly ("just when i am in yesterday view and i want to
// go to next day... no sound effect"). The click handler below used to
// be registered for the bubble phase, same as ever other listener here.
// That click also flips DayView's own canGoNext to false (you can't go
// past today), which disables the real DOM button -- and React 18
// flushes that re-render synchronously before the event finishes
// bubbling up to a plain document-level listener. So by the time this
// handler ran, isDisabled(el) was reading the button's *post-click*
// state and wrongly saw it as disabled, even though it was a perfectly
// normal enabled click a moment earlier. Nothing else here ever hit
// this because it only happens when a click's own side effect disables
// the very element that was clicked -- the Next/Previous day buttons are
// the only controls in the app that do that. Listening on the capture
// phase instead runs this handler on the way *down* to the target,
// before the button's own onClick (and therefore before React's
// re-render) ever fires, so isDisabled(el) always reflects the state the
// element was actually in when the visitor clicked it.
const INTERACTIVE_SELECTOR = 'button, [role="button"], nav a';

function isDisabled(el: Element): boolean {
  if (el instanceof HTMLButtonElement && el.disabled) return true;
  return el.getAttribute("aria-disabled") === "true";
}

function isNavLink(el: Element): boolean {
  return el.tagName === "A" && !!el.closest("nav");
}

// Read fresh on every event rather than cached -- this is an SPA, so the
// route changes under the same mounted listener via history navigation,
// not a remount.
function isDashboardPath(): boolean {
  return typeof window !== "undefined" && window.location.pathname.startsWith("/app");
}

export default function GlobalClickSound() {
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target as Element | null;
      const el = target?.closest(INTERACTIVE_SELECTOR);
      if (!el || isDisabled(el)) return;
      if (isNavLink(el)) {
        playNavClickSound();
      } else if (isDashboardPath()) {
        playDashboardClickSound();
      } else {
        playClickSound();
      }
    }

    // Delegated "hover" via mouseover -- mouseenter/mouseleave don't
    // bubble, so this tracks the last-matched interactive element itself
    // and only fires when that match actually changes, rather than on
    // every pixel of pointer movement within the same control.
    let lastHovered: Element | null = null;
    function handleMouseOver(e: MouseEvent) {
      const target = e.target as Element | null;
      const el = target?.closest(INTERACTIVE_SELECTOR);
      if (el === lastHovered) return;
      lastHovered = el;
      if (!el || isDisabled(el)) return;
      if (isNavLink(el)) {
        playNavHoverSound();
      } else {
        playHoverSound();
      }
    }

    // Capture phase for click (see the note on INTERACTIVE_SELECTOR
    // above) -- mouseover has no equivalent same-event disable race
    // (hovering doesn't change any button's disabled state), so it stays
    // on the bubble phase unchanged.
    document.addEventListener("click", handleClick, true);
    document.addEventListener("mouseover", handleMouseOver);
    return () => {
      document.removeEventListener("click", handleClick, true);
      document.removeEventListener("mouseover", handleMouseOver);
    };
  }, []);

  return null;
}

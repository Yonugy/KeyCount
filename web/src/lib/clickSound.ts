// Synthesized sound effects for the app's buttons and links (2026-09-16,
// phase 5 and its follow-ups). No audio files shipped -- everything
// below is a short Web Audio API blip generated on the fly. Muted by
// default; every function here checks isSoundEnabled() itself, so
// nothing plays until the visitor has explicitly turned sound on via
// SoundToggle.
//
// Volume follows a deliberate three-tier priority, rebalanced 2026-09-16
// after feedback that the navigation sounds were too quiet next to the
// typewriter and that there was no real hierarchy between them:
//   Tier 1 -- an intentional action just happened (a real click: CTA
//     press/release, a generic button, a nav link). Gain ~0.12-0.16, the
//     loudest tier, since this is the sound the visitor is actually
//     asking for by clicking something. The plain click family (generic/
//     dashboard/nav) was nudged up a little further on 2026-09-16, direct
//     request ("make it slightly more noticeable") -- the relative
//     balance from the tier note below is unchanged, every click gained
//     the same proportional bump rather than flattening the hierarchy.
//   Tier 2 -- a hover preview, anticipating an action that hasn't
//     happened yet. Gain ~0.07, softer than a real click so hovering
//     across a busy row of controls doesn't compete with actually
//     clicking one.
//   Tier 3 -- ambient/decorative, fires on its own or very rapidly
//     without a direct per-event user action (the typewriter's one blip
//     per character, ~20 of them in a couple of seconds). Gain ~0.045,
//     deliberately the quietest tier: the same gain as a single click
//     sounds much louder here purely from firing every 45ms, so this
//     tier has to start well below the others to land at a comparable
//     perceived loudness.
const STORAGE_KEY = "keycount:soundEnabled";

let audioCtx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!audioCtx) audioCtx = new Ctor();
  if (audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {
      // Some browsers refuse resume() outside a "trusted" gesture handler
      // even though this itself was called from one -- if it fails, the
      // blip below just won't be audible this time, not worth surfacing.
    });
  }
  return audioCtx;
}

function blip(freq: number, durationMs: number, peakGain = 0.16, type: OscillatorType = "square") {
  const ctx = getContext();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const now = ctx.currentTime;
  const dur = durationMs / 1000;
  // Fast in, fast out -- this is meant to read as a click, not a note.
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(peakGain, now + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + dur + 0.01);
}

// -- Tier 1: real clicks --------------------------------------------------

// The arcade hero CTAs' press/release "tik"/"tak", the loudest sounds in
// the app since a hero CTA click is the single most deliberate action a
// visitor takes on the page.
export function playPressSound() {
  if (!isSoundEnabled()) return;
  blip(920, 35, 0.16);
}

export function playReleaseSound() {
  if (!isSoundEnabled()) return;
  blip(640, 40, 0.16);
}

// The generic click for real buttons outside the signed-in dashboard
// (currently just the login submit button -- most of the app's plain
// buttons live inside the dashboard, see playDashboardClickSound below).
// Gain bumped 0.13 -> 0.15 (2026-09-16, direct request to make the click
// sound "slightly more noticeable").
export function playClickSound() {
  if (!isSoundEnabled()) return;
  blip(780, 30, 0.15);
}

// A lower, softer variant of the generic click, used specifically inside
// the signed-in dashboard (2026-09-16) -- switching tabs, signing out,
// toggling settings happens a lot more often per session there than
// clicking a button anywhere else in the app, and the sharper square-wave
// generic click got grating under that much repetition. Same Tier 1
// "a real click happened" loudness family, just pitched lower and on a
// gentler sine wave rather than square. Gain bumped 0.1 -> 0.12 alongside
// the other Tier 1 clicks (2026-09-16, same "more noticeable" request) --
// kept proportionally under playClickSound's own bump so it's still the
// softer of the two, just less faint than before.
export function playDashboardClickSound() {
  if (!isSoundEnabled()) return;
  // blip(480, 26, 0.12, "sine");
  blip(1100, 26, 0.15, "triangle");
}

// The nav-link click (PublicNav's Features/Download/logo/Sign-in-or-
// dashboard items) -- matches generic-click loudness (Tier 1, not a
// quieter afterthought) since following a nav link is just as much a
// deliberate action as clicking a button, even though the control itself
// is a plain <a>. Kept on its own triangle-wave voice so it's still
// distinguishable by ear, just not by volume. Gain bumped 0.13 -> 0.15
// alongside playClickSound (2026-09-16), keeping the two matched as
// documented above.
export function playNavClickSound() {
  if (!isSoundEnabled()) return;
  blip(1100, 26, 0.15, "triangle");
}

// -- Tier 2: hover previews ------------------------------------------------

// Hovering a CTA-style accent button (the arcade hero buttons, and the
// Download page's real Download button) before it's pressed. Same
// square-wave family as press/release, pitched between them, so hover ->
// press -> release reads as one three-note gesture on the same
// "instrument."
export function playCtaHoverSound() {
  if (!isSoundEnabled()) return;
  blip(760, 16, 0.07);
}

// The hover counterpart to playClickSound(), for the same generic
// buttons -- a soft sine tick rather than the square-wave click family,
// since this one fires a lot as the pointer moves across a busy page
// like the dashboard.
export function playHoverSound() {
  if (!isSoundEnabled()) return;
  blip(500, 18, 0.07, "sine");
}

// The hover counterpart to playNavClickSound(). Matches playHoverSound()'s
// loudness now (it originally landed noticeably quieter, which read as
// broken rather than intentional) -- still its own triangle-wave voice,
// just no longer buried under the other sounds.
export function playNavHoverSound() {
  if (!isSoundEnabled()) return;
  blip(1300, 14, 0.07, "triangle");
}

// -- Tier 3: ambient/decorative ------------------------------------------

// A single, very short key-tap, for keystrokes rather than button
// presses -- the typewriter headline calls this once per revealed
// character, and the landing page calls it on real keydowns too.
// Deliberately the quietest sound in the app (see the tier note at the
// top of this file): firing once every ~45ms while the headline types
// itself out makes even a modest per-blip gain read as loud in
// aggregate, so this needed to start well below the click/hover tiers,
// not just a little under them. The pitch is jittered a little so a fast
// run of keystrokes doesn't sound like the same note looping -- real
// keys don't all sound identical either.
export function playKeySound() {
  if (!isSoundEnabled()) return;
  const freq = 1500 + Math.random() * 400;
  blip(freq, 16, 0.045);
}

export function isSoundEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

export function setSoundEnabled(enabled: boolean) {
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? "on" : "off");
  } catch {
    // localStorage unavailable (private browsing, blocked storage, etc)
    // -- the toggle just won't persist across reloads, not worth failing
    // the click over.
  }
}

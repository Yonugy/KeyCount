import { useLayoutEffect, useRef, useState } from "react";
import type { LocalKeyStat } from "../localApi";

interface KeyboardHeatmapProps {
  keys: LocalKeyStat[];
}

// Same sequential blue ramp as the History tab's activity calendar
// (index.css's --seq-N), relative to this device's own max -- consistent
// single-hue-by-magnitude treatment across the whole app.
const SEQ_STEPS = ["var(--seq-0)", "var(--seq-1)", "var(--seq-2)", "var(--seq-3)", "var(--seq-4)", "var(--seq-5)"];
const SEQ_INK = [
  "var(--seq-0-ink)",
  "var(--seq-1-ink)",
  "var(--seq-2-ink)",
  "var(--seq-3-ink)",
  "var(--seq-4-ink)",
  "var(--seq-5-ink)",
];

interface KeySpec {
  name: string; // matches agent.py's key_identity() label exactly
  label: string; // what's printed on the keycap ("" for space -> just wide+blank)
  width?: number; // flex-grow multiplier, default 1
}

// A generic US QWERTY layout. Names match what agent.py's key_identity()
// actually records: the lowercased character for printable keys, or
// pynput's Key enum member name for everything else (space, backspace,
// enter, tab, caps_lock, shift/shift_r, ctrl/ctrl_r, alt/alt_r, cmd/cmd_r).
// A key you've never pressed just renders at the "0 presses" shade --
// there's no per-user layout detection, this is best-effort.
const ROWS: KeySpec[][] = [
  [
    { name: "`", label: "`" }, { name: "1", label: "1" }, { name: "2", label: "2" },
    { name: "3", label: "3" }, { name: "4", label: "4" }, { name: "5", label: "5" },
    { name: "6", label: "6" }, { name: "7", label: "7" }, { name: "8", label: "8" },
    { name: "9", label: "9" }, { name: "0", label: "0" }, { name: "-", label: "-" },
    { name: "=", label: "=" }, { name: "backspace", label: "delete", width: 2 },
  ],
  [
    { name: "tab", label: "tab", width: 1.5 },
    { name: "q", label: "q" }, { name: "w", label: "w" }, { name: "e", label: "e" },
    { name: "r", label: "r" }, { name: "t", label: "t" }, { name: "y", label: "y" },
    { name: "u", label: "u" }, { name: "i", label: "i" }, { name: "o", label: "o" },
    { name: "p", label: "p" }, { name: "[", label: "[" }, { name: "]", label: "]" },
    { name: "\\", label: "\\", width: 1.5 },
  ],
  [
    { name: "caps_lock", label: "caps", width: 1.75 },
    { name: "a", label: "a" }, { name: "s", label: "s" }, { name: "d", label: "d" },
    { name: "f", label: "f" }, { name: "g", label: "g" }, { name: "h", label: "h" },
    { name: "j", label: "j" }, { name: "k", label: "k" }, { name: "l", label: "l" },
    { name: ";", label: ";" }, { name: "'", label: "'" },
    { name: "enter", label: "return", width: 2.25 },
  ],
  [
    { name: "shift", label: "shift", width: 2.25 },
    { name: "z", label: "z" }, { name: "x", label: "x" }, { name: "c", label: "c" },
    { name: "v", label: "v" }, { name: "b", label: "b" }, { name: "n", label: "n" },
    { name: "m", label: "m" }, { name: ",", label: "," }, { name: ".", label: "." },
    { name: "/", label: "/" },
    { name: "shift_r", label: "shift", width: 2.75 },
  ],
  [
    { name: "ctrl", label: "ctrl", width: 1.25 },
    { name: "alt", label: "opt", width: 1.25 },
    { name: "cmd", label: "cmd", width: 1.5 },
    { name: "space", label: "", width: 6 },
    { name: "cmd_r", label: "cmd", width: 1.5 },
    { name: "alt_r", label: "opt", width: 1.25 },
    { name: "ctrl_r", label: "ctrl", width: 1.25 },
  ],
];

// The keyboard is authored once at this pixel width -- every key height,
// gap, border and font-size below is sized for it -- and then the whole
// block is scaled up or down as ONE unit via a CSS transform to fit
// whatever width the page actually gives it. That's the only way to grow
// or shrink the keyboard without distorting it: scaling width and height
// separately (e.g. a flex row whose keys stretch wider while staying a
// fixed height) is what made every key turn into a squashed rectangle
// when the page widened (2026-08-31) -- a transform scales both together
// by the same factor, so a key that's roughly square at 620px is still
// roughly square at 1000px, just bigger.
const BASE_WIDTH = 620;

export default function KeyboardHeatmap({ keys }: KeyboardHeatmapProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [naturalHeight, setNaturalHeight] = useState(0);

  useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    const inner = innerRef.current;
    if (!wrapper || !inner) return;

    // offsetWidth/offsetHeight reflect the pre-transform box (a CSS
    // transform never changes layout metrics), so `inner.offsetHeight`
    // is always the keyboard's natural height at BASE_WIDTH regardless
    // of whatever scale is currently applied to it.
    setNaturalHeight(inner.offsetHeight);
    setScale(wrapper.offsetWidth / BASE_WIDTH);

    // Runs before the first paint (useLayoutEffect, not useEffect), so
    // there's no flash of the unscaled 620px version before this kicks
    // in -- and it keeps recalculating as the surrounding layout
    // resizes (window resize, sidebar toggle, etc).
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setScale(width / BASE_WIDTH);
    });
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, []);

  const counts = new Map(keys.map((k) => [k.key, k.count]));
  const max = Math.max(...keys.map((k) => k.count), 1);

  const stepFor = (value: number) => {
    if (!value) return 0;
    return Math.min(5, Math.max(1, Math.ceil((value / max) * 5)));
  };

  return (
    <div ref={wrapperRef} style={{ width: "100%", minWidth: 320, height: naturalHeight * scale || undefined }}>
      <div ref={innerRef} style={{ width: BASE_WIDTH, transform: `scale(${scale})`, transformOrigin: "top left" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "4px 0" }}>
          {ROWS.map((row, ri) => (
            <div key={ri} style={{ display: "flex", gap: 4 }}>
              {row.map((k) => {
                const count = counts.get(k.name) ?? 0;
                const step = stepFor(count);
                return (
                  <div
                    key={k.name}
                    title={`${k.label || "space"}: ${count.toLocaleString()}`}
                    style={{
                      flex: k.width ?? 1,
                      minWidth: 0,
                      height: 34,
                      borderRadius: 5,
                      background: SEQ_STEPS[step],
                      border: "1px solid var(--border)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 11,
                      color: SEQ_INK[step],
                      textTransform: "lowercase",
                      userSelect: "none",
                    }}
                  >
                    {k.label}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            marginTop: 10,
            color: "var(--text-muted)",
            fontSize: 11,
          }}
        >
          <span>Less</span>
          {SEQ_STEPS.map((color, i) => (
            <div key={i} style={{ width: 11, height: 11, borderRadius: 2, background: color }} />
          ))}
          <span>More</span>
        </div>
      </div>
    </div>
  );
}

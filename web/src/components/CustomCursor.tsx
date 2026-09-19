import { useEffect, useRef } from "react";

// A decorative "big mouse" cursor effect for the public marketing pages
// (Landing/Features/Download). Redesigned 2026-09-16 from the original
// glowing-ring version after direct feedback: the ring read as "a circle
// following the mouse," not a mouse, and the particle trail looked
// messy. This version is a big arrow-cursor glyph that sits tightly on
// the real pointer (its tip lines up with the actual cursor position, no
// noticeable lag) so it reads as an oversized cursor rather than a
// satellite that trails behind, plus a soft comet-style trail and a
// small burst animation on click/tap so there's finally a reaction to
// clicking, not just hovering.
//
// The arrow is a real DOM element styled with `fill: var(--accent)`,
// not a canvas draw, specifically so it always matches the live theme
// color (including the light/dark accent swap and any future re-theme)
// without this component needing to know the current hex value itself.
// The trail and click bursts run on a canvas underneath it, colored from
// --accent read once via getComputedStyle and refreshed if the OS
// color-scheme changes while the page is open.
//
// Deliberately layered ON TOP of the real system cursor, never replacing
// it (no `cursor: none` anywhere) -- hiding the real cursor would be a
// real accessibility regression (precise pointing, screen magnifiers, and
// OS cursor size/color accommodations all rely on it). This sits visually
// over it, but the OS pointer underneath is still there and still doing
// its job.
//
// Skipped entirely -- no listeners attached, nothing rendered -- for:
//  - prefers-reduced-motion (this is pure motion decoration)
//  - any device without a real mouse (`(hover: hover) and (pointer:
//    fine)` fails on touch/coarse-pointer devices, where there's no
//    hover state to augment and the effect would just be dead weight)
const ARROW_SIZE = 52; // px, the glyph's bounding box at rest
const ARROW_TIP_FRAC = 3 / 24; // the glyph's tip sits at (3,3) in its 24-unit viewBox

export default function CustomCursor() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const arrowRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

    const canvas = canvasRef.current;
    const arrow = arrowRef.current;
    if (!canvas || !arrow) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // The trail/burst canvas draws in a plain hex, not a CSS var, so read
    // --accent's resolved value once and keep it fresh across a live
    // light/dark switch (the arrow glyph itself just uses the CSS var
    // directly and needs none of this).
    let accentColor = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#de5f08";
    const schemeQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const refreshAccent = () => {
      accentColor = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || accentColor;
    };
    schemeQuery.addEventListener("change", refreshAccent);

    function hexToRgb(hex: string): [number, number, number] {
      const m = hex.replace("#", "");
      const n = parseInt(m.length === 3 ? m.split("").map((c) => c + c).join("") : m, 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }

    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas!.width = window.innerWidth * dpr;
      canvas!.height = window.innerHeight * dpr;
      canvas!.style.width = window.innerWidth + "px";
      canvas!.style.height = window.innerHeight + "px";
    }
    resize();
    window.addEventListener("resize", resize);

    let mouseX = window.innerWidth / 2;
    let mouseY = window.innerHeight / 2;
    let arrowX = mouseX;
    let arrowY = mouseY;
    let hovering = false;
    let pressed = false;
    let visible = false;

    // Comet-style trail: a short history of recent positions, drawn as a
    // tapering stroked path (thin/faint tail -> thicker/brighter head)
    // rather than a scatter of dots -- reads as a streak, not confetti.
    type TrailPoint = { x: number; y: number; t: number };
    let trail: TrailPoint[] = [];
    const TRAIL_MAX_AGE = 260; // ms

    // A handful of tiny drifting sparkles along the trail, echoing the
    // hero's starfield rather than looking bolted-on.
    type Sparkle = { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; size: number };
    let sparkles: Sparkle[] = [];

    // Expanding rings on click, the "click animation" that was missing
    // before -- one ring per press, fading out as it grows.
    type Burst = { x: number; y: number; t: number };
    let bursts: Burst[] = [];

    function isInteractive(el: Element | null): boolean {
      let node = el;
      let depth = 0;
      while (node && depth < 6) {
        if (node instanceof HTMLElement && (node.tagName === "A" || node.tagName === "BUTTON")) return true;
        node = node.parentElement;
        depth++;
      }
      return false;
    }

    function handleMove(e: MouseEvent) {
      mouseX = e.clientX;
      mouseY = e.clientY;
      visible = true;
      hovering = isInteractive(e.target as Element);
      trail.push({ x: mouseX, y: mouseY, t: performance.now() });
      if (trail.length > 40) trail.splice(0, trail.length - 40);
      if (Math.random() < 0.5) {
        sparkles.push({
          x: mouseX + (Math.random() - 0.5) * 6,
          y: mouseY + (Math.random() - 0.5) * 6,
          vx: (Math.random() - 0.5) * 0.25,
          vy: (Math.random() - 0.5) * 0.25 - 0.05,
          life: 0,
          maxLife: 450 + Math.random() * 300,
          size: 1 + Math.random() * 1.6,
        });
      }
      if (sparkles.length > 60) sparkles.splice(0, sparkles.length - 60);
    }
    function handleLeave() {
      visible = false;
    }
    function handleDown() {
      pressed = true;
      bursts.push({ x: mouseX, y: mouseY, t: performance.now() });
      if (bursts.length > 12) bursts.splice(0, bursts.length - 12);
    }
    function handleUp() {
      pressed = false;
    }

    window.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseleave", handleLeave);
    window.addEventListener("mousedown", handleDown);
    window.addEventListener("mouseup", handleUp);

    let lastTs = performance.now();
    let rafId: number;
    function frame(ts: number) {
      const dt = Math.min(ts - lastTs, 48);
      lastTs = ts;

      // Tight spring toward the real pointer -- a large fraction of the
      // remaining distance per frame, so it visually sits on the real
      // cursor rather than noticeably trailing it.
      arrowX += (mouseX - arrowX) * 0.6;
      arrowY += (mouseY - arrowY) * 0.6;

      const [r, g, b] = hexToRgb(accentColor);
      if (arrow) {
        const scale = (hovering ? 1.22 : 1) * (pressed ? 0.84 : 1);
        const tipOffset = (ARROW_SIZE * scale) * ARROW_TIP_FRAC;
        arrow.style.transform = `translate(${arrowX - tipOffset}px, ${arrowY - tipOffset}px) scale(${scale})`;
        arrow.style.opacity = visible ? "1" : "0";
        arrow.style.filter = hovering
          ? `drop-shadow(0 0 10px rgba(${r},${g},${b},0.65)) drop-shadow(0 2px 3px rgba(0,0,0,0.35))`
          : "drop-shadow(0 2px 3px rgba(0,0,0,0.35))";
      }

      ctx!.clearRect(0, 0, canvas!.width, canvas!.height);
      ctx!.save();
      ctx!.scale(dpr, dpr);

      // -- comet trail --
      const now = ts;
      trail = trail.filter((p) => now - p.t < TRAIL_MAX_AGE);
      if (trail.length > 1) {
        ctx!.globalCompositeOperation = "lighter";
        for (let i = 1; i < trail.length; i++) {
          const p0 = trail[i - 1];
          const p1 = trail[i];
          const age = (now - p1.t) / TRAIL_MAX_AGE; // 0 = fresh, 1 = old
          const alpha = Math.max(0, 1 - age) * 0.35;
          const width = Math.max(0.5, (1 - age) * 6);
          ctx!.beginPath();
          ctx!.moveTo(p0.x, p0.y);
          ctx!.lineTo(p1.x, p1.y);
          ctx!.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
          ctx!.lineWidth = width;
          ctx!.lineCap = "round";
          ctx!.stroke();
        }
        ctx!.globalCompositeOperation = "source-over";
      }

      // -- drifting sparkles --
      sparkles.forEach((s) => {
        s.life += dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
      });
      sparkles = sparkles.filter((s) => s.life < s.maxLife);
      sparkles.forEach((s) => {
        const t = s.life / s.maxLife;
        const alpha = Math.sin((1 - t) * Math.PI * 0.5) * 0.7;
        ctx!.beginPath();
        ctx!.fillStyle = `rgba(255, 235, 210, ${alpha})`;
        ctx!.arc(s.x, s.y, s.size * (1 - t * 0.4), 0, Math.PI * 2);
        ctx!.fill();
      });

      // -- click bursts --
      bursts = bursts.filter((bu) => now - bu.t < 500);
      bursts.forEach((bu) => {
        const age = (now - bu.t) / 500;
        const radius = 6 + age * 34;
        const alpha = Math.max(0, 1 - age) * 0.55;
        ctx!.beginPath();
        ctx!.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
        ctx!.lineWidth = 2.5 * (1 - age * 0.6);
        ctx!.arc(bu.x, bu.y, radius, 0, Math.PI * 2);
        ctx!.stroke();
      });

      ctx!.restore();
      rafId = window.requestAnimationFrame(frame);
    }
    rafId = window.requestAnimationFrame(frame);

    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseleave", handleLeave);
      window.removeEventListener("mousedown", handleDown);
      window.removeEventListener("mouseup", handleUp);
      schemeQuery.removeEventListener("change", refreshAccent);
      window.cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <>
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        style={{
          position: "fixed",
          inset: 0,
          pointerEvents: "none",
          zIndex: 9998,
        }}
      />
      <svg
        ref={arrowRef}
        aria-hidden="true"
        viewBox="0 0 24 24"
        width={ARROW_SIZE}
        height={ARROW_SIZE}
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          pointerEvents: "none",
          zIndex: 9999,
          opacity: 0,
          transformOrigin: "top left",
          transition: "opacity 0.2s ease, filter 0.15s ease",
          willChange: "transform, opacity",
        }}
      >
        <path
          d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"
          fill="var(--accent)"
          stroke="#ffffff"
          strokeWidth={1.1}
          strokeLinejoin="round"
        />
      </svg>
    </>
  );
}

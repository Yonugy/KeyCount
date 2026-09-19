import { useEffect, useRef } from "react";

// A quiet, canvas-drawn star field for the landing page's hero background
// (2026-09-16, phase 5). Deliberately just stars, not the flying-letters
// idea floated earlier -- picked as the single background effect so hero
// text stays easy to read over it, per the phase 5 scope decision.
//
// Respects prefers-reduced-motion: for anyone with that preference set,
// stars are drawn once and never animated, instead of just slowing the
// animation down. Everyone else gets a slow downward drift and a gentle
// twinkle, nothing fast enough to be distracting behind text.
//
// pointer-events: none (set by the caller) so it never blocks clicks on
// the buttons/links drawn on top of it.
export default function Starfield() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let width = 0;
    let height = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    type Star = { x: number; y: number; r: number; baseAlpha: number; speed: number; twinklePhase: number };
    let stars: Star[] = [];

    function seedStars() {
      const density = 0.00012; // stars per square px, tuned by eye
      const count = Math.max(40, Math.round(width * height * density));
      stars = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        r: Math.random() * 1.2 + 0.3,
        baseAlpha: Math.random() * 0.5 + 0.3,
        speed: Math.random() * 8 + 4, // px/sec downward drift
        twinklePhase: Math.random() * Math.PI * 2,
      }));
    }

    function resize() {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      seedStars();
    }

    function draw(t: number) {
      ctx!.clearRect(0, 0, width, height);
      for (const s of stars) {
        const twinkle = reduceMotion ? 1 : 0.65 + 0.35 * Math.sin(t / 900 + s.twinklePhase);
        ctx!.globalAlpha = s.baseAlpha * twinkle;
        ctx!.fillStyle = "#ffffff";
        ctx!.beginPath();
        ctx!.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx!.fill();
      }
      ctx!.globalAlpha = 1;
    }

    let raf = 0;
    let lastT = 0;
    function frame(t: number) {
      const dt = lastT ? (t - lastT) / 1000 : 0;
      lastT = t;
      for (const s of stars) {
        s.y += s.speed * dt;
        if (s.y > height) {
          s.y = -2;
          s.x = Math.random() * width;
        }
      }
      draw(t);
      raf = requestAnimationFrame(frame);
    }

    resize();
    window.addEventListener("resize", resize);
    if (reduceMotion) {
      draw(0);
    } else {
      raf = requestAnimationFrame(frame);
    }

    return () => {
      window.removeEventListener("resize", resize);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        display: "block",
        pointerEvents: "none",
      }}
    />
  );
}

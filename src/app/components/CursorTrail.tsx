"use client";
import { useEffect, useRef } from "react";
type Star = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  hue: number;
  twinkle: number;
};
export default function CursorTrail() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ctx = el.getContext("2d")!,
      stars: Star[] = [];
    let w = 0,
      h = 0,
      id = 0,
      lx = -99,
      ly = -99,
      last = 0,
      previous = 0;
    const resize = () => {
      w = innerWidth;
      h = innerHeight;
      el.width = w;
      el.height = h;
      el.style.width = w + "px";
      el.style.height = h + "px";
    };
    const move = (e: PointerEvent) => {
      const now = performance.now(),
        dist = Math.hypot(e.clientX - lx, e.clientY - ly);
      if (dist < 7 || now - last < 24) return;
      const count = dist > 35 ? 2 : 1;
      for (let i = 0; i < count; i++) {
        const life = 28 + Math.random() * 22;
        stars.push({
          x: e.clientX + (Math.random() - 0.5) * 8,
          y: e.clientY + (Math.random() - 0.5) * 8,
          vx: (e.clientX - lx) * -0.012 + (Math.random() - 0.5) * 0.35,
          vy: -0.1 - Math.random() * 0.22,
          life,
          max: life,
          size: 0.7 + Math.random() * 1.8,
          hue: Math.random() > 0.72 ? 145 : 48,
          twinkle: Math.random() * 6.28,
        });
      }
      if (stars.length > 70) stars.splice(0, stars.length - 70);
      lx = e.clientX;
      ly = e.clientY;
      last = now;
    };
    const draw = (now: number) => {
      id = requestAnimationFrame(draw);
      if (now - previous < 25) return;
      previous = now;
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";
      for (let i = stars.length - 1; i >= 0; i--) {
        const s = stars[i];
        s.x += s.vx;
        s.y += s.vy;
        s.vx *= 0.98;
        s.life--;
        if (s.life <= 0) {
          stars.splice(i, 1);
          continue;
        }
        const a = Math.pow(s.life / s.max, 1.6),
          r = s.size;
        ctx.fillStyle = `hsla(${s.hue},90%,78%,${a})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
        ctx.fill();
        if (s.size > 2 && a > 0.5) {
          ctx.strokeStyle = `rgba(255,255,235,${a * 0.4})`;
          ctx.beginPath();
          ctx.moveTo(s.x - r * 2.4, s.y);
          ctx.lineTo(s.x + r * 2.4, s.y);
          ctx.moveTo(s.x, s.y - r * 2.4);
          ctx.lineTo(s.x, s.y + r * 2.4);
          ctx.stroke();
        }
      }
      ctx.globalCompositeOperation = "source-over";
    };
    resize();
    addEventListener("resize", resize);
    addEventListener("pointermove", move, { passive: true });
    id = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(id);
      removeEventListener("resize", resize);
      removeEventListener("pointermove", move);
    };
  }, []);
  return <canvas ref={ref} className="star-cursor-trail" aria-hidden="true" />;
}

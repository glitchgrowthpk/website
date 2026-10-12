"use client";

import { useEffect } from "react";

/**
 * One IntersectionObserver for every `[data-reveal]` element on the page.
 *
 * Usage, from any component:
 *   <div data-reveal>…</div>                 fade + rise (default)
 *   <div data-reveal="pop">…</div>           scale in with overshoot
 *   <div data-reveal="glitch">…</div>        sliced RGB glitch in
 *   style={{ "--reveal-delay": "120ms" }}    stagger
 *
 * Nothing is hidden until this has mounted, so the page reads fine without
 * JavaScript, and anything already on screen at mount is marked revealed
 * instantly — no flicker at hydration. Reduced-motion visitors never have
 * anything hidden at all.
 *
 * The animations only define a `from` keyframe and never fill forwards, so an
 * element's own opacity / translate / hover transforms are untouched once the
 * reveal has played.
 */
export default function RevealObserver() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!("IntersectionObserver" in window)) return;

    const root = document.documentElement;
    const pendingSel = "[data-reveal]:not([data-revealed])";

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.setAttribute("data-revealed", "");
          io.unobserve(e.target);
        }
      },
      { rootMargin: "0px 0px -6% 0px", threshold: 0.06 },
    );

    const sweep = () => {
      const H = window.innerHeight;
      document.querySelectorAll<HTMLElement>(pendingSel).forEach((el) => {
        const r = el.getBoundingClientRect();
        // Already visible, or scrolled past: show without animating.
        if (r.top < H * 0.94) el.setAttribute("data-revealed", "instant");
        else io.observe(el);
      });
    };

    sweep();
    root.classList.add("reveal-ready");

    // Pick up elements that mount later (filtered grids, dialogs, etc.).
    let queued = 0;
    const mo = new MutationObserver(() => {
      if (queued) return;
      queued = requestAnimationFrame(() => {
        queued = 0;
        document
          .querySelectorAll<HTMLElement>(pendingSel)
          .forEach((el) => io.observe(el));
      });
    });
    mo.observe(document.body, { childList: true, subtree: true });

    return () => {
      cancelAnimationFrame(queued);
      io.disconnect();
      mo.disconnect();
      root.classList.remove("reveal-ready");
    };
  }, []);

  return null;
}

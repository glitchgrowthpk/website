"use client";

import { useEffect, useRef, useState } from "react";

/** Tracks the user's motion preference and keeps it live. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return reduced;
}

/** Fires once when the element scrolls into view. */
export function useInView<T extends HTMLElement>(
  rootMargin = "-12% 0px -12% 0px",
) {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin, threshold: 0.01 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [rootMargin]);

  return { ref, inView };
}

/** Counts up to `to` once `run` flips true. Respects reduced motion. */
export function useCountUp(to: number, run: boolean, ms = 1100) {
  const reduced = useReducedMotion();
  const [n, setN] = useState(0);

  useEffect(() => {
    if (!run || reduced) return;
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      // easeOutExpo
      const e = p === 1 ? 1 : 1 - Math.pow(2, -10 * p);
      setN(Math.round(to * e));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, run, ms, reduced]);

  // Reduced motion skips straight to the final value — no animation state.
  return reduced && run ? to : n;
}

/** Coarse pointer / touch-first device. */
export function useIsTouch() {
  const [touch, setTouch] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse)");
    const apply = () => setTouch(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return touch;
}

/** Precise pointer (mouse / trackpad) that can hover. False on touch-first devices. */
export function useFinePointer() {
  const [fine, setFine] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(hover: hover) and (pointer: fine)");
    const apply = () => setFine(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return fine;
}

/**
 * Live on-screen tracking (unlike `useInView`, which fires once). Returns a ref
 * object whose `.current` flips as the element enters and leaves the viewport —
 * read it inside rAF loops to pause work that nobody can see, without
 * re-rendering.
 */
export function useOnScreenRef<T extends HTMLElement>(
  target: React.RefObject<T | null>,
  rootMargin = "0px",
) {
  const visible = useRef(false);
  useEffect(() => {
    const el = target.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        visible.current = entry.isIntersecting;
      },
      { rootMargin, threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [target, rootMargin]);
  return visible;
}

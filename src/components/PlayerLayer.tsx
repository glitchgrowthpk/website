"use client";

import { useEffect, useRef } from "react";
import { byId, spriteSrc } from "@/data/characters";
import { useGame } from "@/lib/game-state";
import { useReducedMotion } from "@/lib/hooks";
import { sfx } from "@/lib/audio";

const GRAVITY = 2400; // px/s^2
const RUN = 430; // px/s
const JUMP = 900; // px/s
const FLOOR_PAD = 18;
const SPRITE_H = 92;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * A side-scrolling character that walks the page.
 *
 * In "ambient" mode it reacts to scrolling. Once the visitor takes control it
 * becomes a real platformer whose collision geometry is the page itself:
 * every element tagged `data-solid` is a one-way platform.
 *
 * Arrow keys are only captured while control is active, so normal keyboard
 * scrolling is never hijacked.
 */
export default function PlayerLayer() {
  const { characterId, controlling, setControlling, collect, coins } = useGame();
  const reduced = useReducedMotion();

  const wrapRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const shadowRef = useRef<HTMLDivElement>(null);
  const dustRef = useRef<HTMLDivElement>(null);

  // Mutable refs so the rAF loop never re-subscribes.
  const keys = useRef<Record<string, boolean>>({});
  const controllingRef = useRef(controlling);
  const collectedRef = useRef<Set<string>>(new Set(coins));
  const collectRef = useRef(collect);

  const st = useRef({
    x: 140,
    /** feet position in DOCUMENT coordinates while under control */
    y: 0,
    /** height above the viewport floor while idling ambiently */
    hop: 0,
    vx: 0,
    vy: 0,
    facing: 1,
    grounded: true,
    phase: 0,
    lastScroll: 0,
    scrollVel: 0,
    idleHopAt: 0,
    landFlash: 0,
    wasActive: false,
  });

  const platforms = useRef<Rect[]>([]);
  const platformsStale = useRef(true);

  useEffect(() => {
    controllingRef.current = controlling;
  }, [controlling]);
  useEffect(() => {
    collectedRef.current = new Set(coins);
  }, [coins]);
  useEffect(() => {
    collectRef.current = collect;
  }, [collect]);

  /* ---------------- input ---------------- */
  useEffect(() => {
    const isTypingTarget = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        el.isContentEditable
      );
    };

    const down = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;

      // `G` toggles control from anywhere.
      if (e.key === "g" || e.key === "G") {
        e.preventDefault();
        setControlling(!controllingRef.current);
        return;
      }
      if (e.key === "Escape" && controllingRef.current) {
        setControlling(false);
        return;
      }
      if (!controllingRef.current) return;

      const k = e.key.toLowerCase();
      const mapped =
        k === "arrowleft" || k === "a"
          ? "left"
          : k === "arrowright" || k === "d"
            ? "right"
            : k === "arrowup" || k === "w" || k === " "
              ? "up"
              : k === "arrowdown" || k === "s"
                ? "down"
                : null;
      if (!mapped) return;
      e.preventDefault(); // only while control is active
      keys.current[mapped] = true;
    };

    const up = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === "arrowleft" || k === "a") keys.current.left = false;
      if (k === "arrowright" || k === "d") keys.current.right = false;
      if (k === "arrowup" || k === "w" || k === " ") keys.current.up = false;
      if (k === "arrowdown" || k === "s") keys.current.down = false;
    };

    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [setControlling]);

  // Touch D-pad dispatches these synthetic events.
  useEffect(() => {
    const onPad = (e: Event) => {
      const { dir, down } = (e as CustomEvent<{ dir: string; down: boolean }>)
        .detail;
      keys.current[dir] = down;
    };
    window.addEventListener("glitch:pad", onPad as EventListener);
    return () => window.removeEventListener("glitch:pad", onPad as EventListener);
  }, []);

  /* ---------------- platform cache ---------------- */
  useEffect(() => {
    const invalidate = () => {
      platformsStale.current = true;
    };
    window.addEventListener("scroll", invalidate, { passive: true });
    window.addEventListener("resize", invalidate);
    const t = window.setInterval(invalidate, 400);
    return () => {
      window.removeEventListener("scroll", invalidate);
      window.removeEventListener("resize", invalidate);
      window.clearInterval(t);
    };
  }, []);

  /* ---------------- main loop ---------------- */
  useEffect(() => {
    if (reduced) return; // no ambient motion for reduced-motion users

    const wrap = wrapRef.current;
    const body = bodyRef.current;
    const shadow = shadowRef.current;
    if (!wrap || !body || !shadow) return;

    let raf = 0;
    let last = performance.now();
    let running = true;

    const s = st.current;
    s.hop = 0;
    s.lastScroll = window.scrollY;

    // Platforms are stored in document coordinates so they stay put while the
    // camera scrolls.
    const refreshPlatforms = () => {
      const out: Rect[] = [];
      const H = window.innerHeight;
      const sy = window.scrollY;
      document.querySelectorAll<HTMLElement>("[data-solid]").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.bottom < -400 || r.top > H + 400) return;
        if (r.width < 40) return;
        out.push({ x: r.left, y: r.top + sy, w: r.width, h: r.height });
      });
      platforms.current = out;
      platformsStale.current = false;
    };

    const onVis = () => {
      running = document.visibilityState === "visible";
      if (running) {
        last = performance.now();
        raf = requestAnimationFrame(loop);
      } else {
        cancelAnimationFrame(raf);
      }
    };
    document.addEventListener("visibilitychange", onVis);

    const loop = (now: number) => {
      if (!running) return;
      const dt = Math.min(0.033, (now - last) / 1000);
      last = now;

      const W = window.innerWidth;
      const H = window.innerHeight;
      const active = controllingRef.current;

      if (platformsStale.current && active) refreshPlatforms();

      // scroll velocity feeds the ambient run animation
      const sy = window.scrollY;
      const dScroll = sy - s.lastScroll;
      s.lastScroll = sy;
      s.scrollVel = s.scrollVel * 0.85 + dScroll * 0.15;

      /** feet position in viewport space, whichever mode we are in */
      let viewY: number;

      if (active) {
        /* -------- player controlled (document space) -------- */
        if (!s.wasActive) {
          // Hand over from the ambient walker without a teleport.
          s.y = sy + (H - FLOOR_PAD) - s.hop;
          s.vy = 0;
          s.hop = 0;
          s.wasActive = true;
          refreshPlatforms();
        }

        const docFloor =
          Math.max(
            document.documentElement.scrollHeight,
            document.body.scrollHeight,
          ) - FLOOR_PAD;

        const want = (keys.current.right ? 1 : 0) - (keys.current.left ? 1 : 0);
        s.vx = want * RUN;
        if (want !== 0) s.facing = want;

        if (keys.current.up && s.grounded) {
          s.vy = -JUMP;
          s.grounded = false;
          sfx.jump();
        }

        s.vy += GRAVITY * dt;
        const prevFeet = s.y;
        s.x += s.vx * dt;
        s.y += s.vy * dt;

        // one-way platforms: land on the top edge only, drop through on Down
        const wasGrounded = s.grounded;
        s.grounded = false;
        if (s.vy >= 0 && !keys.current.down) {
          for (const p of platforms.current) {
            if (s.x < p.x - 6 || s.x > p.x + p.w + 6) continue;
            if (prevFeet <= p.y + 4 && s.y >= p.y) {
              s.y = p.y;
              s.vy = 0;
              s.grounded = true;
              if (!wasGrounded) {
                s.landFlash = 1;
                sfx.land();
              }
              break;
            }
          }
        }

        if (!s.grounded && s.y >= docFloor) {
          s.y = docFloor;
          s.vy = 0;
          s.grounded = true;
          if (!wasGrounded) {
            s.landFlash = 1;
            sfx.land();
          }
        }

        s.x = Math.max(24, Math.min(W - 24, s.x));

        // Camera: keep the character inside a comfortable band by scrolling
        // the page, which is what makes the whole document walkable.
        viewY = s.y - window.scrollY;
        const topBand = H * 0.32;
        const botBand = H * 0.86;
        // `behavior: "instant"` matters — the page sets scroll-behavior:smooth
        // for anchor links, which would animate (and fight) every frame.
        if (viewY < topBand)
          window.scrollTo({ top: s.y - topBand, behavior: "instant" });
        else if (viewY > botBand)
          window.scrollTo({ top: s.y - botBand, behavior: "instant" });
        viewY = s.y - window.scrollY;
      } else {
        /* -------- ambient (viewport space) -------- */
        s.wasActive = false;
        const drift = Math.max(-1, Math.min(1, s.scrollVel / 24));
        s.vx = drift * RUN * 0.8;
        if (Math.abs(drift) > 0.08) s.facing = drift > 0 ? 1 : -1;
        s.x += s.vx * dt;

        if (s.x > W - 40) s.x = 40;
        if (s.x < 40) s.x = W - 40;

        // occasional idle hop
        if (Math.abs(drift) < 0.05 && s.grounded && now > s.idleHopAt) {
          s.idleHopAt = now + 2600 + Math.random() * 4200;
          s.vy = -JUMP * 0.42;
          s.grounded = false;
        }
        s.vy += GRAVITY * dt;
        s.hop -= s.vy * dt;
        if (s.hop <= 0) {
          if (!s.grounded) s.landFlash = 1;
          s.hop = 0;
          s.vy = 0;
          s.grounded = true;
        }
        viewY = H - FLOOR_PAD - s.hop;
      }

      /* -------- coin pickups -------- */
      document.querySelectorAll<HTMLElement>("[data-coin]").forEach((el) => {
        const id = el.dataset.coin;
        if (!id || collectedRef.current.has(id)) return;
        const r = el.getBoundingClientRect();
        if (r.bottom < 0 || r.top > H) return;
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const px = s.x;
        const py = viewY - SPRITE_H * 0.45;
        if (Math.abs(cx - px) < 46 && Math.abs(cy - py) < 56) {
          collectedRef.current.add(id);
          collectRef.current(id);
        }
      });

      /* -------- render -------- */
      const moving = Math.abs(s.vx) > 30;
      s.phase += dt * (moving ? 13 : 4.2);

      const airborne = !s.grounded;
      const bob = airborne ? 0 : Math.sin(s.phase) * (moving ? 6 : 3.2);
      const tilt = moving ? s.facing * 5 : Math.sin(s.phase * 0.5) * 1.5;

      let sx = 1;
      let sy2 = 1;
      if (airborne) {
        const stretch = Math.max(-1, Math.min(1, s.vy / 900));
        sy2 = 1 + Math.abs(stretch) * 0.12 * (s.vy < 0 ? 1 : 0.6);
        sx = 1 / sy2;
      }
      if (s.landFlash > 0) {
        s.landFlash = Math.max(0, s.landFlash - dt * 5);
        const k = s.landFlash;
        sy2 *= 1 - 0.22 * k;
        sx *= 1 + 0.22 * k;
      }

      wrap.style.transform = `translate3d(${s.x}px, ${viewY}px, 0)`;
      body.style.transform = `translate(-50%, ${-SPRITE_H + bob}px) rotate(${tilt}deg) scale(${sx * s.facing}, ${sy2})`;

      const airGap = active ? Math.max(0, -s.vy) / 6 : s.hop;
      const shadowScale = Math.max(0.35, 1 - airGap / 220);
      shadow.style.transform = `translate(-50%, -6px) scale(${shadowScale}, ${shadowScale * 0.5})`;
      shadow.style.opacity = String(0.5 * shadowScale);

      if (dustRef.current) {
        dustRef.current.style.opacity = String(s.landFlash);
        dustRef.current.style.transform = `translate(-50%, -4px) scale(${1 + (1 - s.landFlash) * 1.6})`;
      }

      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [reduced]);

  if (reduced) return null;

  const ch = byId(characterId);
  const w = Math.round((ch.w / ch.h) * SPRITE_H);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-40 overflow-hidden"
    >
      <div ref={wrapRef} className="absolute left-0 top-0 will-change-transform">
        <div
          ref={shadowRef}
          className="absolute left-0 top-0 h-6 w-20 rounded-[50%] bg-black blur-[6px]"
        />
        <div
          ref={dustRef}
          className="absolute left-0 top-0 h-3 w-24 rounded-[50%] border border-cyan/50 opacity-0"
        />
        <div
          ref={bodyRef}
          className="absolute left-0 top-0 will-change-transform"
          style={{ width: w, height: SPRITE_H }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={spriteSrc(ch.id)}
            alt=""
            width={w}
            height={SPRITE_H}
            className="sprite block"
            style={{ width: w, height: SPRITE_H, maxWidth: "none" }}
            draggable={false}
          />
        </div>
      </div>
    </div>
  );
}

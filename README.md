# GlitchTech Games — studio site

A marketing site for GlitchTech Games that behaves like one of their games. Built
with Next.js 16 (App Router), React 19, TypeScript and Tailwind v4.

```bash
npm install
npm run dev      # http://localhost:3100
npm run build    # static export into out/
```

The QA scripts drive a real browser, so they need Playwright installed once.
It is deliberately **not** a dependency — otherwise every deploy build would
download ~120MB of Chromium:

```bash
npm i -D playwright && npx playwright install chromium

npm run verify   # platformer/arcade smoke test (13) + interactive layer checks (27)
npm run shots    # screenshots at desktop / mobile / reduced-motion
npm run og       # regenerate public/og.png
npm run deploy   # build + zip for shared hosting
```

## The idea

The page is a normal, accessible, scrollable marketing site. It is *also* a game
level. Both readings are true at once, and neither gets in the other's way.

### 1. A character that walks the page

`src/components/PlayerLayer.tsx` runs a small platformer in a fixed overlay.

- **Ambient** — the chosen character idles at the bottom of the viewport and runs
  in whichever direction you scroll.
- **Under control** — press <kbd>G</kbd> (or the HUD button, or the on-screen
  D-pad on touch) and you drive it. Gravity, jumping, squash-and-stretch, a
  contact shadow and landing dust.
- **The page is the level.** Any element tagged `data-solid` becomes a one-way
  platform: stat tiles, game cards, pipeline nodes, team cards. You can jump from
  card to card and the camera scrolls the document to follow, so the whole page is
  walkable on foot.

Coordinates are kept in **document** space while under control (viewport space
while ambient), which is what lets the character climb rather than run on a
treadmill. Camera scrolls use `behavior: "instant"` because the page sets
`scroll-behavior: smooth` for anchor links.

**Arrow keys are never hijacked until you explicitly take control**, and
<kbd>Esc</kbd> always releases — keyboard scrolling keeps working.

### 2. A playable match-3 boss fight

`src/components/Arcade.tsx` + `src/lib/match3.ts`. A real 7×7 board using the
studio's own character art as the pieces. Match three or more to damage Taurus;
he hits back on a telegraphed timer. Cascades multiply damage, runs of four or
more crit, and a deadlock reshuffles rather than stranding the player.

The rules live in `match3.ts` as pure functions, so the view only handles
animation. The boss timer pauses when the board scrolls off screen or the tab is
hidden — nobody loses a round for reading the portfolio. The charge bar is
written straight to the DOM so a 60fps telegraph never re-renders 49 tiles.

### 3. Choose your fighter

`src/components/Roster.tsx` is a fighting-game select screen over 23 characters
cut out of the studio's Sword Knight cast. Your pick persists to `localStorage`
and follows you across the whole site — hero card, platformer, arcade HUD. It is
an ARIA `radiogroup` with roving tabindex and full arrow-key navigation.

### 4. Small stuff

- 12 coins hidden around the page, registered in `src/data/coins.ts` (the HUD
  total comes from that list, so a new `<Coin>` needs an entry there). Walk into
  one, or just click it — the reward is never locked behind the platformer.
- Sound is **off by default** and entirely synthesised: `src/lib/audio.ts` is a
  tiny WebAudio SFX engine and `src/lib/music.ts` an original 8-bar chiptune
  sequencer. No audio files ship, and no `AudioContext` exists until the
  visitor opts in. The soundtrack setting is never persisted, so a return visit
  never starts playing on its own.
- Konami code spills the roster down the screen. Typing `crash` crashes the
  page for a second.

### 5. The interactive layer

Everything below hangs off one provider, `src/lib/game-state.tsx` (`useGame()`):
character, coins, achievements, XP/level, visited sections, settings, control
mode and the pause menu. It restores progress from `localStorage` after mount
and persists it under `glitch.*` keys.

| Piece | Where | What it does |
| --- | --- | --- |
| Boot screen | `BootScreen.tsx` | ~1.9s CRT boot on the first visit per session. Server-rendered and CSS-driven, skips on any input, never shown again that session or under reduced motion, with CSS failsafes if JS never runs. |
| Pause menu | `PauseMenu.tsx` | Native `<dialog>`: level select (the phone navigation), achievements, settings, controls. `P` or the HUD Menu button. |
| Achievements | `Achievements.tsx`, `data/achievements.ts` | 16 achievements, XP and levels. Console-style popups, bottom-right on desktop, under the HUD on phones. |
| Settings | pause menu | Sound, soundtrack, CRT overlay, reticle cursor, keyboard shortcuts (single-key shortcuts can be turned off, per WCAG 2.1.4), reset progress. |
| Reticle cursor | `Cursor.tsx` | Fine pointers only. Locks onto interactive elements, shows `data-cursor` labels, pulls `data-magnetic` CTAs. Native cursor returns in dialogs, text fields and under reduced motion. |
| Particles | `FxLayer.tsx`, `lib/fx.ts` | One canvas for every burst. Call `fx.burst()` / `fx.burstAt()` from anywhere; it idles at zero cost. |
| Level map | `LevelNav.tsx` | Right-edge rail (lg+), visited tracking (all sizes), first-entry stage banners. |
| Section headings | `Section.tsx` | Titles decode in on first view; the real text stays in the DOM for SEO and screen readers. |
| Scroll reveal | `RevealObserver.tsx` | Opt in with `data-reveal`, `data-reveal="pop"` or `data-reveal="glitch"`, stagger with `--reveal-delay`. Nothing hides before hydration or under reduced motion. |
| Arcade | `Arcade.tsx`, `lib/match3.ts` | Your fighter's PWR/SPD/LCK and the coins you've found change the fight (damage, boss timer, crits, HP). Idle hints, combo callouts, records. |
| Pipeline | `Pipeline.tsx` | Your fighter rides the stage rail as you scroll; stages clear as it passes. |
| Quest dialogue | `Partner.tsx`, `data/dialogue.ts` | RPG dialogue that routes to the right inbox with a pre-filled email. |
| Walker | `PlayerLayer.tsx`, `data/quips.ts` | Coyote time, jump buffering, variable jump and a double jump; companion hints per section; naps when you go idle. |

**Markup conventions** any component can use: `data-solid` (a platform for the
walker), `data-reveal`, `data-cursor="LABEL"`, `data-magnetic`.

**z-index map:** page content < walker 40 < level rail 45 < HUD 50 < touch
controls 55 < toast 60 < achievement popups 65 < particle canvas 66 < Konami 70
< boot screen 80 < CRT overlay 85 < cursor 200. Dialogs use the browser's top
layer above all of these.

## Deploying

The site is **statically exported** (`output: "export"` in `next.config.ts`), so
`npm run build` produces a plain `out/` folder of HTML, CSS, JS and images.
Nothing on the host needs to run Node. That one build works on Vercel and on
ordinary shared hosting alike.

### Vercel

1. Import the repo at [vercel.com/new](https://vercel.com/new). Next.js is
   detected automatically — no build settings to change.
2. Add an environment variable `NEXT_PUBLIC_SITE_URL` set to your live domain
   (e.g. `https://glitchtech.games`, no trailing slash). It drives canonical
   URLs, Open Graph tags, JSON-LD and `sitemap.xml`. Without it the metadata
   falls back to the placeholder domain.
3. Deploy. To attach the domain you bought: Project > Settings > Domains > add
   it, then in your registrar's DNS panel point the records at the values
   Vercel shows (an `A` record for the apex and a `CNAME` for `www`). Vercel
   issues the TLS certificate.

If you later want Vercel's image optimisation or incremental regeneration,
delete the `output: "export"` and `images.unoptimized` lines from
`next.config.ts`. Everything else stays the same — but the `out/` folder, and
therefore shared hosting, goes away.

### Shared hosting (Bluehost / any cPanel)

```bash
npm run deploy      # builds and writes glitchtech-site.zip
```

1. Set `NEXT_PUBLIC_SITE_URL` first — copy `.env.example` to `.env.production`
   and put your domain in it, then run the command above.
2. cPanel > **File Manager** > open `public_html` (for the primary domain; an
   addon domain lives in its own subfolder).
3. Upload `glitchtech-site.zip`, then right-click it > **Extract**. Delete the
   zip afterwards.
4. cPanel > **SSL/TLS Status** > **Run AutoSSL** to get the free certificate.
   Only once that succeeds is the HTTPS redirect in `.htaccess` safe.

`deploy/.htaccess` ships with the bundle and handles the 404 page, HTTPS
forcing, gzip and cache headers. The site works without it — delete it if it
ever misbehaves on your host.

## Accessibility & performance notes

- `prefers-reduced-motion` removes the boot screen, the ambient walker,
  parallax, particles, the reticle cursor, reveals and all transitions. Every
  section still reads, the arcade still plays, and the platformer still works
  once you take control (it's movement you start yourself).
- Semantic landmarks, one `h1`, skip link, visible focus rings, `aria-live` for
  score/coin/board announcements, labelled controls.
- Small text sits at or above 4.5:1 against the background.
- No horizontal overflow at 390px, 768px or 1440px (asserted by `npm run shots`).
- All 23 sprites + 12 game icons total ~390KB as WebP. No animation or audio
  library — everything is CSS, Canvas 2D, WebAudio and `requestAnimationFrame`
  loops that stop when idle, off screen or in a hidden tab. The interactive
  layer adds about 76KB of gzipped JS (278KB total, framework included).
- Statically prerendered; JSON-LD for the organisation and all 12 games.

## Content

Everything is real:

- `src/data/games.ts` — the 12 shipped titles with verified Google Play package
  IDs and App Store IDs, genres, install tiers and store ratings.
- `src/data/studio.ts` — figures from the studio pitch deck (12 shipped, 220K+
  installs, 400+ characters, 42% D1, 11% D7, 23min sessions, $0.01 CPI).
- `src/data/characters.ts` — the 23-strong Sword Knight cast.

Microcopy for the interactive layer lives in data files too, so it can be edited
without touching components: `src/data/achievements.ts` (titles, hints),
`src/data/dialogue.ts` (quest dialogue and email templates), `src/data/quips.ts`
(the walker's hints) and `src/data/coins.ts`.

## Assets

`public/characters/*.webp` were cut from the supplied character sheet with a
flood-fill from the image border, so interior whites (the skeleton, the egg, the
duck) survive and edges stay antialiased. `public/games/*.webp` are the real
store icons pulled at full resolution from the pitch deck PDF.
`src/app/icon.png` and `public/logo-mark.webp` come from the studio's own logo.

# MOBILE & RTP AUDIT

> Author: Cline + Rayhan · Date: 2026-11-19
> Scope: (A) mobile responsiveness of the player web app, (B) RTP / house-edge config
> of all 17 backend game modules. **Nothing was changed** — documentation only.

---

## PART A — Mobile Responsiveness Audit

### A.1 TL;DR

The web app is **already thoroughly mobile-tuned**. It uses a shared frame
(`GameShell`) and one style file (`web/src/index.css` — **no Tailwind, plain CSS**),
with an extensive set of breakpoints and safe-area handling. The "games look bad on
phones" reports very likely come from a small handful of specific issues — chiefly a
couple of sub-44px touch targets and floating support buttons that overlap the dock —
rather than from missing responsive CSS.

### A.2 What already exists (don't regress)

- **Breakpoints present** in `web/src/index.css`: `max-width` 359 / 480 / 520 / 560 /
  620 / 640 / 720 / 767 / 900 / 980 px, plus `max-height:460px` (landscape) and
  `prefers-reduced-motion`.
- **Shared `GameShell`** (~line 8235+) uses `100svh`, a fixed 54px top bar, a fixed
  bottom dock (`--gs-bar-h: 120px + env(safe-area-inset-bottom)`, taller for controls),
  `aspect-ratio`, and `env()` safe-area insets for notched devices.
- **Landscape fallback** (`max-width:767px and max-height:460px`) unpins the dock so the
  page scrolls again.
- **Game containers** already use `width: min(100%, …)`: `.cabinet` 460px, `.fg-cabinet`
  460px, `.bk-ring` 620px → no horizontal overflow.

### A.3 Issues found

| # | Issue | Location (`web/src/index.css`) | Severity |
| --- | --- | --- | --- |
| 1 | `.gs__back` ("Lobby" button) is ~32px tall — **below the 44px touch-target minimum** | line 8268 | Medium |
| 2 | Floating support buttons `.support` (fixed `right:20px; bottom:24px`) likely **overlap** the docked bottom bar (game pages) / bottom nav (Lobby) on ≤767px | line 2688 | Medium |
| 3 | On ≤320px portrait the dock is tight: 4 chips + 96px action button shrink (chips→48px, action→88px at ≤359px) but the frame gets very cramped | line 8572 | Low |
| 4 | `.game-card__art` uses a fixed 108px image height (no `aspect-ratio`) | line 2182 | Low |
| 5 | Roulette/table (`rt__*`), Blackjack and Aviator board CSS were **not fully audited here** — recommended follow-up | `rt__*` / aviator / blackjack sections | Verify |

**Touch-target quick check (already fine):** `.gs-chip` 54×54 (44 in landscape),
`.gs__action` 96×96 (76 landscape), `.chip` 48×48 (44 at ≤520px), `.support__btn` 46×46,
`.bottom-link` full-width — all ≥ 44px.

### A.4 Proposed fix plan (CSS-only, all in `web/src/index.css`)

Target breakpoints to align: **320px, 480px, 768px** (consolidating the current
359/520/560/620/640/720 mix where sensible).

1. **Fix the small tap target** — give `.gs__back` `min-height:44px; min-width:44px`.
2. **Un-overlap the support buttons** — at ≤768px move `.support` above the dock
   (`bottom: calc(96px + env(safe-area-inset-bottom, 0px))`) and lay the three buttons
   out **horizontally** instead of a vertical stack.
3. **At ≤320px hide non-essentials** — e.g. `.rt__fair` (provably-fair caption) and the
   support cluster, to give the board room.
4. **Reinforce `max-width:100%` + `aspect-ratio`** on any remaining fixed-width boards;
   audit the Roulette / Blackjack / Aviator sections next (item A.3 #5).
5. **Guarantee ≥44×44 for every interactive control** at each breakpoint.

### A.5 Files to change (for the fix phase — not yet applied)

- `web/src/index.css` (the single CSS source). No `.tsx`/backend changes required.

---

## PART B — RTP / House-Edge Audit

### B.1 RTP table (all 17 game modules)

RTP/edge are almost always **derived from hard-coded `*.service.ts` constants** and
exposed via each game's `GET /config` endpoint (except where noted).

| # | Game (module) | RTP | House Edge | Config location |
| --- | --- | --- | --- | --- |
| 1 | Roulette "Spin to Win" (`roulette`) | **70.00%** | **30.00%** | `roulette.service.ts:33` `WHEEL_SEGMENTS` (Σ=14/20); `wheelRtp()` :77 |
| 2 | Slots (`slots`) | **70.00%** | **30.00%** | `slots.service.ts:54` `SLOT_PAYTABLE.lineMultiplier=8.4`; `slotsRtp()` :106 |
| 3 | Dice — high (`dice`) | 97.50% | 2.50% | `dice.service.ts:41` `DICE_HOUSE_NUMBER=50`, `=1.95` :44; `diceRtp()` :85 |
| 4 | Dice — low (`dice`) | 95.55% | 4.45% | same (49 winning numbers for "low") |
| 5 | 3D Dice (`dice3d`) | 97.22% | 2.78% | `dice3d.service.ts:63` `SUM_PAYS`; `dice3dRtp()` :124 |
| 6 | Aviator (`aviator`) | **95.00%** | 5.00% | `aviator.service.ts` crash formula (0.95 factor) |
| 7 | Mines (`mines`) | 97.00% | 3.00% | `mines.service.ts:35` `HOUSE_EDGE = 0.03` |
| 8 | Plinko (`plinko`) | 97.00% | 3.00% | `plinko.service.ts:38` `PLINKO_MULTIPLIERS`; `plinkoRtp()` :52 |
| 9 | Keno (`keno`) | ≈97.00% | ≈3.00% | `keno.service.ts:66` `KENO_TARGET_RTP = 0.97` |
| 10 | Baccarat (`baccarat`) | Player 98.71% / Banker 98.99% / **Tie 74.89%** | 1.29% / 1.01% / 25.11% | `baccarat.service.ts:248` `baccaratRtp()` |
| 11 | Dragon Tiger (`dragontiger`) | Dragon/Tiger ≈92.5% (2×, tie loses sides); Tie = P(tie)×payout | ≈7.5% sides | `dragontiger.service.ts:132` `dragonTigerRtp()` |
| 12 | Teen Patti (`teenpatti`) | 97.50% | 2.50% | `teenpatti.service.ts:324` `rakedRtp` (1.95× + 5% rake) |
| 13 | Cascade / Showdown (`cascade`) | 95.72% | 4.28% | `cascade.service.ts:77` `CASCADE_RTP = 0.9572` |
| 14 | Classic Roulette (`classic_roulette`) | 97.30% | 2.70% | `classic_roulette.service.ts:141` `rouletteRtp()` |
| 15 | Fruit Bonanza (`fruit_bonanza`) | 97.22% | 2.78% | `fruit_bonanza.service.ts:120` `fruitBonanzaRtp()` |
| 16 | Blackjack (`blackjack`) | **91.77%** | 8.23% | **no RTP constant / not in config** — only `WIN_MULTIPLIER=2` :37; documented in `verify-blackjack.cjs` + `docs/ARCHITECTURE.md` |
| 17 | Fortune Gems (`fortune_gems`) | 97.78% | 2.22% | `fortune_gems.service.ts:231` `fortuneGemsRtp()`; `FORTUNE_PAYS` :84 |
| 18 | Boxing King (`boxing_king`) | **97.42%** | 2.58% | `boxing_king.service.ts:185` `boxingKingRtp()`; `CLUSTER_PAYS` :74 |

_(Rows 3–4 and 10 are sub-bets of a single module; there are 17 modules total.)_

### B.2 Flags

1. **RTP is hard-coded everywhere.** No game reads RTP from an env var or an admin-panel
   setting — every value is a TS constant (or derived from one) in its `*.service.ts`.
   Changing an edge today requires a code edit + redeploy.
2. **RTP missing from code / config:**
   - **Blackjack** — no RTP/house-edge constant or `config` field; the 91.77% figure
     exists only in `backend/scripts/verify-blackjack.cjs` and the docs.
   - **Slots** — `slotsRtp()` exists but is **not** included in `slotsConfig()`
     ("server-side only").
3. **Below 90% RTP (unusually harsh):**
   - Roulette "Spin to Win" — **70%** (30% house edge).
   - Slots — **70%** (30% house edge).
   - Baccarat **Tie** side bet — **74.89%** (25.11% edge; typical for a high-odds side bet,
     but flagged).
4. **Comment/value drift (non-functional):** `boxing_king.service.ts:184` comment says
   "_0.9726 = 97.26%_" but the real constants compute **97.42%** (`CLUSTER_FREQUENCY`
   × `CLUSTER_PAYS`), matching the frontend fallback (0.974219) and the verifier. Stale comment.
5. **Blackjack 91.77%** is the lowest non-70% game — driven by no double/split, dealer
   stands on 17, and naturals paying even money (2×) instead of 3:2.
6. **Dice asymmetry:** "high" = 97.5%, "low" = 95.55% (the house number 50 gives "low"
   49 winning rolls vs 50 for "high"). Both within range, but asymmetric.

### B.3 Summary of range

- **Reasonable (90–99%):** Dice, 3D Dice, Aviator, Mines, Plinko, Keno, Baccarat (Player/Banker),
  Dragon Tiger (sides), Teen Patti, Cascade, Classic Roulette, Fruit Bonanza, Fortune Gems,
  Boxing King, Blackjack.
- **Out of range (below 90%):** Roulette "Spin to Win" (70%), Slots (70%), Baccarat Tie (74.89%).
- **Above 99%:** none.

---

## Next steps (recommended)

1. **Mobile fixes (Part A)** — apply the CSS-only plan in A.4 (`.gs__back` tap target +
   support-button repositioning), then spot-check Roulette/Blackjack/Aviator boards.
2. **RTP hygiene (Part B)** — decide whether Roulette/Slots at 70% is intentional; if so,
   document it plainly; fix the Boxing King comment; consider exposing RTP/edge uniformly
   from every `config` endpoint (Slots and Blackjack currently omit it).
3. Only **then** consider moving RTP into configuration (env or admin panel) if the
   business wants edges tunable without redeploys.
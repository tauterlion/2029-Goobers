# V1.2.5 — quality of life and reliability

Verified October 5, 2026. This update preserves the V1.2 game flow and scoring; it is not the V1.3 transition overhaul.

## Reliability changes

**Captions:** 3 visible characters minimum, **160 UTF-16 units maximum**, matching native textarea `maxLength`. Client input/paste clamping, the visible counter, centralized validation copy and server validation share that budget. Emoji truncation preserves whole clusters. Typing, paste, deletion and editing at the boundary were exercised in a real browser.

**Image-swapping root cause:** `Game.tsx` previously sent `image_failed` from an image's `onError`. The authoritative handler called `drawImage`, then rewrote matching `assignments` and submitted caption image paths. A temporary load failure on any client could therefore change the image during slideshow, voting or results, including Different Images mode. This was a server-state mutation, not a random render-time picker.

**Exact fix:** `GameImage.tsx` displays the authoritative source and switches locally to IMAGE UNAVAILABLE on failure. It logs the failed source in development and does not submit a replacement command. Remount/refresh may retry the same source. The legacy `image_failed` command remains accepted for old clients but no longer draws, changes assignments, alters captions or advances the image pool. Round-start assignment is the sole source of a caption's image. Library cleanup intentionally never rewrites active assignments/caption/result snapshots.

**Disconnect removal:** explicit leave/pagehide records `disconnectedAt` immediately. A lost network connection is considered disconnected when its existing 25-second lease expires. A further **20-second grace** allows the same session to resume and cancel removal. Expired memberships are removed before authentication/join, freeing capacity. Active browsers request a heartbeat at the next projected lease/grace deadline; regular eight-second heartbeats remain fallback. Empty rooms reconcile at their next request.

**Host transfer:** authority moves to the oldest connected member as soon as a disconnect is recognized, without waiting for the removal grace. A returning former host does not reclaim it automatically.

**Frozen round records:** membership removal preserves captions, valid cast votes, the electorate, assigned sources, score and author metadata. Private session credentials are cleared from departed-player records. Removed eligible voters still receive the existing missed-vote treatment; missing captions can still produce a grave. Departed participants remain identifiable in current-game results/awards but do not enter future round electorates. Rejoining after full removal creates a new identity, pending next round during play. Rematch/lobby reset clears departed-game records. Existing only-host and acknowledged mass-disconnect behavior remains.

**Changing libraries:** the current folder indexed **146 supported images**. User image additions, edits and deletions were preserved. Both `predev` and `prebuild` still scan automatically. Stale deck selections, previous/recent-history entries, pool entries and legacy failure paths are pruned against the manifest on load/projection or the next mutation. Other history survives; new images naturally outrank recent ones. Whitelists that become empty block Start with the existing clear warning. Current-round removed sources keep their original identity and show the stable fallback.

## Interaction and presentation changes

| Change | Implementation |
|---|---|
| Throwable names | All visible tags accept pointer capture for mouse/touch. Ref-held bodies track position, velocity and rotation; `requestAnimationFrame` updates transforms directly. Bounded throw speed, exponential friction and damped boundary bounces settle to zero. No React state update per animation frame. Resize clamps positions; roster changes/reset restore valid placement. |
| Client-only physics | No position/velocity fields or commands are sent to Supabase. RESET LAYOUT works for every player and affects only that browser. Reduced motion removes release inertia. Touch velocity is capped lower, and touch capture is confined to tags so the rest of the page scrolls normally. |
| Player management | Host-only MANAGE PLAYERS panel in the lobby shows names, colors, host/connection status and valid Kick controls. Host cannot kick themselves. Tags have no moderation buttons. Own-profile editing is also available from EDIT MY PROFILE. |
| Desktop reactions | Compact fixed translucent/blurred dock below the game scroll viewport. Its position is independent of newly appearing UI. |
| Mobile reactions | Compact REACTIONS button opens a horizontally scrollable emoji row in the same reserved strip. Close with ×, Escape or a tap outside. Opening does not resize the gameplay viewport or cover its controls. |
| Lightweight spam | Existing outbound 250ms rate limit retained. At most 20 particles; one cleanup interval removes them after 2.5 seconds. Unmount clears the interval. |
| Topography | One fixed SVG with 14 paths and one 65-second transform animation at 5.5% opacity. Theme-aware color, no pointer events, negative stacking order, no WebGL or expensive blur on the background. Reduced motion stops the drift. |
| Decorative star | Ambient graphics sit behind content at low opacity. The bottom star is smaller, moved toward the outer corner, theme-aware and noninteractive. |
| Vibrant | Deep blue/teal surfaces, softer purple, mint and warm coral accents replace dominant neon purple/fluorescent backgrounds. Definitions remain in `src/app/themes.css`. |
| TIE rays | Fixed viewport-inset pseudo-element on the world, instead of a pseudo-element bounded by the result section. Desktop 16:9, ultrawide and phone portrait were checked. Equal winners/scoring stay intact. |
| Podium | Shared `PODIUM` timeline in `src/game/timing.ts`: total **10 → 8.5 seconds** (15% faster), second at 2.55s, first at 5.1s, standings at 6.375s. Visual/audio cues use the same constants; first-place scale impact is stronger without extending duration. Confetti and order remain. |

## Checks actually run

After resuming, the 11 additional images were indexed, bringing the library to 146. The production build, all 73 unit tests and the multiplayer API check were rerun with this library. A fresh Edge check loaded and decoded all 146 images successfully. The full gameplay, grace-period and interaction browser runs below were completed before these latest image-only additions.

| Check | Result |
|---|---|
| `npm test` | **73 passed**, six test files |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed without warnings |
| `npm run build` | Production build passed; 146 images and zero optional audio files indexed |
| Full-library browser image check | All 146 images loaded and decoded successfully in Edge |
| `npm run test:api` against configured Supabase | Passed: 12 concurrent clients, capacity, kicks/rejoining, duplicate-session rejection, epoch guards, anonymous projections, captions/votes/scoring, early completion, host migration, decks, lobby and rematch persistence |
| `npm run test:smoke` against configured Supabase | Passed: four browsers, realtime reactions, independent/persistent themes, empty/small/whitelist deck UI, Different Images, real typing/paste/deletion/editing/emoji limits at 160, failed-image fallback, source stability after theme changes/refresh/slideshow/voting, four-way tie, podium/awards/lobby |
| `npm run test:grace` against configured Supabase | Passed: prompt host transfer, resume during grace, presence before expiry, removal after 20 seconds, expired-session rejection, normal rejoin pending, frozen electorate and retained caption/image |
| `npm run test:interaction` | Passed: twelve tags, laptop/mobile bounds and reset, real touch drag via browser input, reduced-motion behavior, stopped RAF after settling, separate management, fixed dock bounds and particle cap/expiry |
| Browser JavaScript errors | None in completed browser/interaction runs |
| Visual checks | 1366×768 laptop, 1440px desktop, 2560×1080 ultrawide and 390×844 phone; management/tags, caption input, mobile tray, calmer Vibrant voting, full-screen ties, podium and decorations. Screenshots are in ignored `test-results/`. |

New unit coverage includes immutable Same/Different assignments through phases and serialized recovery, error-command nonmutation, 20-second removal/reconnect/host behavior, retained votes/scoring/authors, removed missing-caption graves, pending rejoin, mass-disconnect acknowledgement, stale library references, new-image priority, friction/bounds/reset and shared podium order/duration. Prior V1.2 theme/deck/history/variant/scoring/audio/asset tests remain included.

Visual review prompted two corrections beyond the first passing smoke run: explicit separated tag reset placement, and a reserved reaction strip rather than a mobile popup over Submit. A focused interaction run then found an old centered-flex rule clipping the first emoji in the horizontal tray; `justify-content: flex-start` fixed it. Corrected runs passed. No failed attempt is represented as a pass.

## Changed code and documentation

| Files | Purpose |
|---|---|
| `src/game/caption.ts`, `src/game/copy.ts` | 160 limit and centralized interaction labels |
| `src/game/engine.ts`, `src/app/api/game/route.ts` | Immutable image handling, grace/removal, historical participants, presence deadlines, library normalization |
| `src/components/GameImage.tsx`, `src/components/Game.tsx` | Stable fallback, projected participants, caption UI, integrated new components, bounded particle cleanup |
| `src/game/lobby-physics.ts`, `src/components/LobbyPlayers.tsx` | Local drag/throw physics, reset, resize, touch/reduced motion and separate management |
| `src/components/ReactionTray.tsx`, `src/components/Topography.tsx` | Fixed desktop/mobile reactions and contour layer |
| `src/app/qol.css`, `src/app/themes.css`, `src/app/layout.tsx` | Interaction styling, calmer palette, layering, full-screen rays, reduced motion and podium impact |
| `src/game/timing.ts`, `src/audio/useGameAudio.ts` | Central 15%-faster podium visual/audio timing |
| `src/game/reliability.test.ts`, `src/game/engine.test.ts`, `src/game/update.test.ts`, `src/game/personalization.test.ts` | New reliability/physics coverage and updated caption/failure/removal expectations |
| `scripts/smoke.mjs`, `scripts/api-smoke.mjs`, `scripts/grace-smoke.mjs`, `scripts/interaction-smoke.mjs`, `package.json` | Browser/API regressions, timed grace and interaction checks, script entries |
| `src/generated/assets.json` | Regenerated from the changed image folder; 146 paths |
| `README.md`, `VERIFICATION-V1.2.5.md` | Current behavior, validation and limitations |

## Deployment and known boundaries

- **No Supabase migration required. No Vercel environment changes. No new dependencies.** Added state fits the existing room JSON and the existing compare-and-swap persistence model.
- No Vercel deployment was performed. Rebuild/redeploy through the normal project workflow to publish.
- The grace is 20 seconds **after disconnect detection**, not 20 seconds after an undetectable network interruption. Hard loss first uses the existing 25-second lease. Serverless rooms with nobody connected reconcile when activity resumes; no new background worker/cron was added.
- Rejoining after full removal creates a fresh identity/score. Historical entries from that person's old identity may still appear in that game's results, preserving its evidence.
- Removed/broken assigned assets cannot be restored by code. They retain their original source and show IMAGE UNAVAILABLE; later refresh/remount retries the same source.
- Browser checks used installed Microsoft Edge with emulated viewport/touch/reduced-motion settings. No physical-phone FPS/battery profiling or cross-browser exhaustive audit was performed. The RAF-stop, traffic separation, particle bounds and cleanup behavior were checked.
- No custom audio files were supplied for listening/level evaluation. Optional audio remains silent when absent, with existing playback unit coverage.
- Existing theme storage/hydration and room-expiry behavior remain. Large ties can still require scrolling during the existing result duration; broader choreography remains out of scope.

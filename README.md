# 2029 Goobers

A private, account-free meme-caption party for 4–12 friends. Next.js + React + TypeScript, with Supabase active-room persistence and Realtime Broadcast. Your existing images are preserved; no sample memes or recorded speech are required.

## Run with Supabase

Prerequisites: Node.js 22 or newer, npm, and a Supabase project.

1. Install dependencies: `npm install`.
2. Copy `.env.example` to `.env.local`.
3. In Supabase **Project Settings → API / API Keys**, copy your project URL and legacy anonymous key into `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Copy the **service role** key into `SUPABASE_SERVICE_ROLE_KEY`. Only the first two values are browser-visible. Never prefix the service key with `NEXT_PUBLIC_`.
4. Run `supabase/migrations/202610030001_active_rooms.sql` in the Supabase SQL editor. Alternatively, link the project with the Supabase CLI and run `supabase db push`.
5. Keep `LOCAL_GAME_STORE=false`. Realtime Broadcast must be enabled in the project (the normal default). There is no Postgres Changes publication to configure: the commit function calls `realtime.send` directly.
6. Run `npm run dev`, then open `http://localhost:3000`.

Create a room with a name, then join its five-character code from three other browsers/devices. No accounts and no special room URLs.

## Local test mode

To play/test without Supabase, put `LOCAL_GAME_STORE=true` in `.env.local`. This explicitly selected adapter stores rooms in ignored `.local-rooms/` files and uses a 1.2-second read interval. It is **not** the production multiplayer transport, and remote reactions are not broadcast in this mode. It is disabled whenever `VERCEL` is set. The UI labels local test mode.

## Add your assets

- Images: drop PNG, JPG, JPEG, WebP, GIF, AVIF or SVG files into **`public/game-images/`**. Subfolders and arbitrary filenames are supported. Use browser-safe/trusted SVG files. Existing unsupported files are ignored.
- Optional announcer: **`public/audio/announcer/`**, e.g. `pin_of_shame_01.webm`, `pin_of_shame_08.mp3`. Number suffixes are variants, not part of the cue name. No audio folder or recording is required.
- Available phase cues include `game_start`, `round_intro`, `captioning`, `caption_resolution`, `slideshow`, `voting`, `vote_reveal`, `round_winner`, `round_leaderboard`, `final_podium`, `final_awards`, `game_over`, `urgency_10`, `urgency_5`. Event-specific hooks are in `src/audio/manager.ts` / `src/components/Game.tsx`.
- Optional SFX are discovered in `public/audio/sfx/` and background music in `public/audio/music/`. Matching cues play automatically, with looping music, crossfades, ducking, and the global mute button. See [AUDIO.md](AUDIO.md) for all cue names and the six music filenames. Missing audio is silent and never blocks gameplay.

`npm run assets` generates `src/generated/assets.json`. Development startup and production builds run this automatically. Restart development after adding assets. The browser only requests images needed for the current screen. Images use containment, never forced cropping. No placeholder assets need replacing.

Static images under `public/` are reachable by their asset paths. Rooms and UI are private by code; this is **not authenticated media storage**. The app has no gallery, archive, image index UI, or downloadable meme feature, and tells search engines not to index its pages.

## Checks

Edit most game dialogue in `src/game/copy.ts`. Text is grouped by screen, errors, awards and results. Captions accept 3 visible characters minimum and 160 UTF-16 units maximum, matching native textarea `maxLength`; emoji may use multiple units. The counter uses the same budget, and paste truncation preserves complete emoji clusters.

```sh
npm test
npm run typecheck
npm run lint
npm run build
```

Browser smoke check: start the built app with `LOCAL_GAME_STORE=true`, then run `npm run test:smoke`. It uses installed Microsoft Edge by default, opens four independent browser contexts, completes a game, refreshes a submitted caption, and saves desktop/mobile screenshots in ignored `test-results/`. On another OS, install Chromium with `npx playwright install chromium` and run with `BROWSER_CHANNEL=chromium`. Set `TEST_URL` to test a different local port. Keep these tests against a dedicated test instance.

## Deploy to Vercel

1. Apply the Supabase migration and confirm the three required environment values.
2. Push this project to a private Git repository, or import it with the Vercel CLI. Be aware that the image collection is part of the deployment.
3. Import the repository into Vercel. Framework preset: **Next.js**. Root directory: repository root. Build command: `npm run build`.
4. Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Set `LOCAL_GAME_STORE=false` (or omit it).
5. Deploy. Public environment values are compiled into the browser bundle; redeploy after changing them.
6. On the deployed site, create a room and join from four separate browser profiles/devices. Verify start, captions, reactions, votes, refresh, host disconnect, and rematch over your actual network before a party.

No server is deployed by running this repository's build. Hosting and Supabase credentials must be configured separately.

## Architecture and important files

| Path                                                | Responsibility                                                                                                                             |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/game/engine.ts`                                | Explicit phase machine; validation; image rotation; frozen electorate; scoring; authoritative transitions; sanitized per-player projection |
| `src/game/engine.test.ts`                           | Game-rule and recovery tests                                                                                                               |
| `src/app/api/game/route.ts`                         | Validated, same-origin commands; hashed random session secrets; connection leases                                                          |
| `src/lib/store.ts`                                  | Supabase persistence, compare-and-swap retries, explicit local test adapter                                                                |
| `supabase/migrations/202610030001_active_rooms.sql` | Private room aggregate, expiry index, atomic commit function, broadcast signal, cleanup                                                    |
| `src/components/Game.tsx`                           | All player screens, realtime invalidation, deadlines, recovery, reactions                                                                  |
| `src/app/globals.css`                               | Responsive presentation, transitions, podium, reduced-motion support                                                                       |
| `src/audio/manager.ts`                              | Optional voice hooks and nonblocking synthesized ticks                                                                                     |
| `scripts/generate-assets.mjs`                       | Deterministic asset scanning and safe path encoding                                                                                        |
| `scripts/smoke.mjs`                                 | Four-player browser verification                                                                                                           |

### Persistence and concurrency

One versioned JSON room aggregate stores players, captions, votes, phase, image history, and current-game awards. This intentionally uses one table rather than separate child tables: a conditional database update commits the entire game transition atomically. Each player has at most one caption and one vote through authoritative keyed mutation. Conflicting server requests reload and retry, so scores and round transitions cannot be partially written. Host controls include the current phase epoch; double clicks cannot advance two phases.

RLS denies all anonymous/authenticated direct table access. Only the server service role can load or commit rooms. Browser responses omit session hashes, other votes, hidden image assignments, and anonymous caption authors. Realtime broadcasts contain only an invalidation version; authenticated-by-session API reads supply the projection. Reaction broadcasts are cosmetic and ephemeral on an unguessable room UUID topic; they are not a security boundary and cannot change game state.

### Timers, membership and reconnect

Deadlines are server timestamps. Clients show server-aligned remaining time and request an idempotent transition at expiry. An eight-second heartbeat provides liveness and catches missed broadcasts. The server checks deadlines before accepting commands. With no clients connected, rooms sleep; the next request resumes authoritative progression. No database writes happen each animation frame or timer second.

Local storage remembers the random session token and room code. A separate per-page connection ID claims a 25-second lease. The original active connection wins; a duplicate cannot control it. Normal refresh sends a best-effort release; if the browser/network loses that request, wait for lease expiry. An explicit leave marks the player disconnected immediately; a hard network loss is detected at lease expiry. Host migration follows original join order among connected members without waiting for removal, and a returning host does not take control back automatically.

Disconnected players have a 20-second grace period from the explicit leave or lease expiry. Resuming in time cancels removal. Active clients wake at the projected presence deadline; heartbeats provide fallback. Empty rooms reconcile on the next request. Expired members free their room slots and can rejoin normally with a new identity (pending next round during play). Sanitized departed-player records preserve current-game scores/authors, captions, valid votes and the frozen electorate; future rounds exclude their old identities. Rematch/lobby reset clears those historical participant records.

Expiry is approximately six hours of inactivity. Room creation opportunistically calls `cleanup_stale_rooms`; reads exclude expired rooms. For scheduled housekeeping, enable Supabase pg_cron and schedule `select public.cleanup_stale_rooms();` hourly as an administrative database role. Cleanup is not on the correctness path.

### Troubleshooting

- **Room service needs setup:** check `.env.local`, restart Next.js, and ensure the SQL migration ran in the same project as the URL/key.
- **Changes are delayed:** check Supabase Realtime availability and browser WebSocket access. The heartbeat recovers state after a missed broadcast.
- **Already playing elsewhere:** close the original tab and retry after 25 seconds. Don't clear storage unless you want a different identity.
- **No images:** run `npm run assets` and inspect the generated count. Unsupported extensions are ignored. Once assigned, an image never changes within the round. A load error shows IMAGE UNAVAILABLE for that original source; refresh/remount may retry the same source. No client failure requests a replacement draw.
- **No voices:** expected when no recordings exist. Audio requires a user gesture and is entirely optional.
- **Connection overlay:** restores state when the backend responds again; gameplay writes are blocked while the overlay is visible.

## V1.2 personalization

Edit the friend-group wording in `src/game/copy.ts`. It follows the supplied `2029 Goobers.docx`, including the intentional slang, punctuation and emoji. `src/game/variants.ts` hashes room ID, game instance ID, round, event type and relevant player ID using FNV-1a. All browsers derive the same flavor line for the same event; refresh and heartbeat updates do not reroll it. Critical rules and errors stay stable.

Choose **Original, Light, Dark, Coffee or Vibrant** from the small header selector at any point. Palettes and theme-specific presentation live in `src/app/themes.css`, with shared layout in `globals.css`. The preference is stored under `goobers-theme` in that browser's localStorage. It is never sent as a game action or stored in Supabase. Private browsing or blocked/cleared storage can prevent persistence.

The host can open **EDIT DECK** in the lobby. **USE ALL** enables the generated library; **BLACKLIST** excludes marked images; **WHITELIST** includes only marked images. SELECT ALL and CLEAR SELECTION operate on the entire library, including other thumbnail pages. The server stores `{ mode, images }` on the room and accepts only manifest paths. Empty decks block Start; any nonempty deck works, with a repeat warning when small. Deck, rounds, timer and image mode survive host transfer, rematch and lobby return. No uploads or accounts were added.

The room keeps `recentGames`, up to three completed games of deduplicated image paths, newest first. Completion is archived once when leaving the final round leaderboard for the podium. Aborted games do not enter history. Selection consumes the current pool before repeating, avoids simultaneous duplicate assignments where possible, prefers images absent from recent history, then reuses the oldest historical candidates. Excluded and failed images remain excluded even during exhaustion. History survives deck edits, rematches and lobby return; it expires with the room.

Shared first place now uses a dedicated **TIE** burst, oversized title and equal winner cards within the existing round-winner phase. Scoring, streaks and phase duration remain unchanged. An optional `public/audio/sfx/round_tie.mp3` hook is available; missing files stay silent. See `AUDIO.md`.

No Supabase migration, dependency installation or Vercel environment change is required for V1.2 or V1.2.5. Rebuild/redeploy the app normally. The asset scanner currently indexes **146 images** and continues running before development/build. The current folder contents are authoritative; stored deck/history paths removed from the library are pruned without altering current-round snapshots.

## V1.2.5 interactions and presentation

- Every visible lobby tag can be dragged/thrown locally. Pointer capture supports mouse/touch; bounded velocity, friction and light bounces settle naturally. RESET LAYOUT affects only your browser. No physics engine or Supabase position writes. Reduced motion disables release inertia. Drag on tags; scroll normally elsewhere.
- Host moderation now lives in MANAGE PLAYERS, separate from the tags. Kicking remains lobby-only and permits rejoining. EDIT MY PROFILE is available separately as well as by clicking your own tag without dragging.
- Reactions use a fixed translucent dock in a reserved bottom strip. On phones, a compact button opens a horizontally scrollable emoji tray in that same strip; tap away, Escape or × closes it. Opening it does not resize the gameplay scroll area. Outgoing reactions retain the 250ms limit; at most 20 particles exist and one cleanup timer removes them after 2.5 seconds.
- `src/app/themes.css` contains the calmer blue/teal/coral Vibrant palette. `src/app/qol.css` keeps decorations faint and behind content, styles the fixed tray, and makes tie rays viewport-wide. `Topography.tsx` supplies a single SVG layer with 14 paths and a slow transform animation; reduced motion stops it.
- The podium timeline is centralized in `src/game/timing.ts`: 8.5 seconds total instead of 10, second at 2.55s, first at 5.1s and standings at 6.375s. Audio and visuals share the timeline. First place has a stronger short scale impact.
- Extra checks: `npm run test:grace` exercises actual disconnect timing on the configured server; `npm run test:interaction` checks twelve tags, touch/reduced motion, settled animation frames and reaction bounds. Both honor `TEST_URL` like the other smoke tests.

## Verification status and boundaries

See `VERIFICATION-V1.2.5.md` for current checks, `VERIFICATION-V1.2.md` for V1.2, and `VERIFICATION.md` for V1.1. A local adapter cannot prove a remote Supabase migration, Realtime delivery, or Vercel deployment. Those require a configured project. There are no accounts, permanent histories, public galleries, or uploaded media management.

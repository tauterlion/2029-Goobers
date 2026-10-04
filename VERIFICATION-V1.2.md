# V1.2 verification — October 4, 2026

## Delivered

- Friend-group copy transcribed from `2029 Goobers.docx`, preserving wording, punctuation and emoji. Main source: `src/game/copy.ts`.
- Shared flavor variants for shame, graves, winner/no-winner, unanimous and game-over events. FNV-1a selects from the pool using JSON-encoded room ID, game ID, round, event type and relevant player ID. No browser randomness or wall clock participates.
- Original, Light, Dark, Coffee and Vibrant themes using common CSS variables and layout. Definitions: `src/app/themes.css` (original base colors remain in `globals.css`). The header selector stores only `goobers-theme` in browser localStorage; themes never write room state.
- Host-only lobby thumbnail editor, paginated at 24 images, with All/Blacklist/Whitelist, select all, clear, eligibility labels, active count, empty-deck blocking and small-deck warning. Server representation: `deck: {mode, images}` where images are manifest paths. Inherited on host transfer and preserved through rematch/lobby.
- `recentGames` retains three completed games, newest first, as deduplicated image sets. Final leaderboard-to-podium transition archives once per game ID. Current-game uniqueness and different-image assignment preferences are retained; unseen history is preferred, then oldest history. Exhaustion always terminates and never escapes the active deck. Aborted games are not archived.
- Dedicated TIE presentation within the existing `round_winner` phase: oversized heading, burst background and equal winner cards. Two or more shared-first-place captions qualify. Scoring/streak logic and 3.5-second phase duration are unchanged. Optional `round_tie` SFX; no files required.
- Preserved automatic scanning: **120 indexed images**, zero supplied SFX/music/announcer files. No image renames or manual manifest edits.
- A browser check exposed an existing rapid-setting-change race. Lobby settings now disable briefly while saving so one update cannot overwrite another with stale values.

## Checks actually run

| Check | Result |
|---|---|
| `npm test` | **59 passed**, five files |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed without warnings |
| `npm run build` | Production build passed; 120 images indexed |
| `npm run test:api` on configured Supabase | Passed: 12 concurrent joins/captions/votes, capacity, kick/rejoin, duplicate connection rejection, epoch guards, private projections, early voting, scoring, host transfer, host-only deck writes, empty-deck rejection, whitelist assignments, blacklist one-image play, lobby persistence and rematch settings/deck persistence |
| `npm run test:smoke` on configured Supabase | Passed: four independent browser contexts, create/join, realtime reactions, one-image whitelist UI, empty/small-deck messages, real typing/paste/emoji limits, submitted caption recovery after refresh, host controls, guaranteed four-way tie, leaderboard, podium, awards and return to lobby |
| Theme browser checks | Original default; all five selectable; Coffee restored after refresh and lobby return; other browsers remained independent; theme selection emitted no gameplay writes; selected voting screenshots in every theme; 390px mobile landing screenshots and no horizontal overflow in every theme |
| Browser JavaScript errors | None in completed run |
| Visual inspection | Original deck editor, Coffee mobile caption, Dark/Vibrant selected voting, Vibrant four-way TIE and Dark mobile landing inspected; further screenshots in ignored `test-results/` |
| SQL/environment/dependencies | No changes required |

New unit coverage checks empty/single variant arrays, seed consistency across clients, round/event/player variation, interpolation, all three deck modes, host transfer/edit restrictions, invalid paths, empty/one-image decks, both image modes, exhausted/broken-image fallback, rematch/lobby preservation, three-game history rollover, repeated archive prevention, newest historical occurrence, old-room compatibility, aborted games, unchanged assignments on read, and 2/3/4/12-way tie points/streaks/leaderboards.

Existing caption, anonymous projection, pending-player, voting, unanimous, timeout/randomization, scoring, connection, complete-phase, asset-scanner and audio tests continue passing.

Earlier browser attempts stopped at refresh/reaction waits: the harness was checking generic landing text before the room recovered. It now waits for the actual room and allows the existing connection lease. The expanded API harness also handles intentional stale-epoch rejection when a timed phase expires during a request. These failed attempts are not counted as passes; the corrected complete runs above passed.

## Changed files

| Files | Purpose |
|---|---|
| `src/game/copy.ts`, `src/game/variants.ts` | Document copy, shared deterministic variants and interpolation |
| `src/game/deck.ts`, `src/game/engine.ts` | Deck eligibility/validation, stable game ID, rolling completed history, projected deck counts |
| `src/app/api/game/route.ts` | Deck input validation, deck-aware projections and increased bounded request size for selections |
| `src/components/ThemeSelector.tsx`, `src/app/themes.css`, `src/app/globals.css` | Local preference, five palettes, shared theme variables, deck/tie styles |
| `src/components/DeckEditor.tsx` | Host editor with thumbnail pagination and selection controls |
| `src/components/Game.tsx`, `src/app/layout.tsx` | Copy/variant wiring, theme/deck UI, tie presentation, metadata, save-state guard |
| `src/audio/player.ts`, `src/audio/useGameAudio.ts`, `AUDIO.md` | Optional tie cue |
| `src/game/personalization.test.ts`, `src/game/engine.test.ts` | New coverage and completed-game history expectations |
| `scripts/smoke.mjs`, `scripts/api-smoke.mjs` | Live browser and API verification |
| `README.md`, `VERIFICATION.md`, `VERIFICATION-V1.2.md` | Customization, persistence, validation and boundaries |

## Deployment and limitations

- No Supabase schema/migration or Vercel environment changes. The new fields fit the existing room JSON. Legacy rooms default to All Images and retain their previous-game fallback; they cannot reconstruct older history that was never stored.
- No Vercel deployment was performed. The production build and configured Supabase were tested locally; publishing requires the normal redeployment.
- No custom audio assets were supplied. Playback mechanics have automated coverage, but no listening/level check was possible. Missing audio remains supported.
- Themes persist only where localStorage is available and retained. A restored theme is applied on client mount, so refresh may briefly show Original before hydration.
- History belongs to a room and expires with it (existing approximately six-hour inactivity expiry). It is not a permanent user profile.
- Tiny decks intentionally repeat. If every eligible image fails to load, the existing captionable image-unavailable fallback is used.
- The existing 25-second connection lease remains. A lost/raced pagehide release may need that grace period before reconnect succeeds.
- Tie cards retain the existing result duration. Large ties can extend vertically on phones; no transition retiming was included.
- Automated browser checks used installed Microsoft Edge, not every browser/device combination. No new dependency audit was performed.

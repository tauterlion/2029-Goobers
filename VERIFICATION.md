# V1.1 verification — October 4, 2026

For the completed personalization update, see [V1.2 verification](VERIFICATION-V1.2.md). The results below describe the earlier V1.1 run.

## Update delivered

- Captions: minimum 3 visible characters, maximum 100 native textarea units. Native `maxLength`, controlled input truncation, emoji-safe paste handling, server validation, and a visible counter with a near-limit style.
- Unanimity: checks all frozen eligible non-author voters and requires manual votes. Bonus remains +50%, then +10% for a consecutive win, then rounding.
- Early voting completion: every required vote must target a valid non-self caption. Existing atomic room commits and phase epochs keep simultaneous final votes from scoring twice.
- Most player-facing copy now lives in `src/game/copy.ts`, grouped by screen and errors. Error responses include stable codes so changing the displayed text does not break client recovery.
- Optional SFX and music manifests, event hooks, bounded effect playback, looping music, 500ms crossfades, ducking, and global mute. No audio files are required.
- 120 supported images indexed, including 31 added images. Original filenames and files preserved. Both `predev` and `prebuild` run the scanner.

## Checks actually run

| Check | Result |
|---|---|
| `npm test` | 41 tests passed across four files |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed without warnings |
| `npm run build` | Passed; 120 images, zero optional audio files |
| `npm run test:api` against configured Supabase | Passed: 12 concurrent clients, distinct images, caption/vote submissions, capacity, kick/rejoin, duplicate connection rejection, host transfer, anonymous projections, and exactly one early final-vote transition |
| `npm run test:smoke` against configured Supabase | Passed: four independent browser contexts, room creation/join, realtime reaction delivery, real keyboard/paste limits, emoji paste, submitted caption restoration after refresh, host controls after transfer, complete game, final results and return to lobby |
| Browser JavaScript errors | None in the completed smoke run |
| Desktop/mobile visual inspection | Landing, captioning and voting inspected at 1440×1000 / 390×844; full phase screenshots in ignored `test-results/` |
| Supabase migrations / environment / dependencies | No changes required |

The test harness now follows the authoritative host after refresh; it previously stalled by assuming the original tab still owned the host controls. No host-transfer rewrite was needed.

Game tests also cover pending next-round activation, frozen electorate, image modes/repeat avoidance/exhaustion/failure fallback, editable captions, shame/funeral classification, self-vote rejection, timeout randomization, scoring order, ties, streaks, rematch reset and the complete state machine. Audio tests use a mocked media element to verify missing assets, autoplay rejection, looping/no restart, crossfade, mute/unmute and ducking. Asset tests verify spaces/parentheses, formats, variants and missing folders.

## Changed files

| Files | Purpose |
|---|---|
| `src/game/caption.ts`, `src/game/engine.ts` | Shared caption limits, author-relative eligibility, valid-vote completion |
| `src/game/copy.ts` | Main editable game dialogue |
| `src/components/Game.tsx`, `src/app/globals.css` | Copy references, input enforcement/counter, audio integration |
| `src/app/api/game/route.ts`, `src/lib/store.ts` | Centralized error messages; stable response codes |
| `src/audio/manager.ts`, `src/audio/player.ts`, `src/audio/useGameAudio.ts` | Optional playback, music mixing and game-event hooks |
| `scripts/generate-assets.mjs`, `src/generated/assets.json` | Image, announcer, SFX and music manifests |
| `public/audio/sfx/.gitkeep`, `public/audio/music/.gitkeep` | Drop-in audio directories |
| `src/game/engine.test.ts`, `src/game/update.test.ts`, `src/audio/player.test.ts`, `scripts/assets.test.ts`, `vitest.config.ts` | Regression tests and test alias resolution |
| `scripts/smoke.mjs`, `scripts/api-smoke.mjs` | Browser input/realtime and concurrent final-vote verification |
| `README.md`, `AUDIO.md`, `VERIFICATION.md` | Setup, customization and verification notes |
| `next-env.d.ts` | Next.js-generated production type paths |

## Remaining boundaries

- No Vercel deployment was performed in this update. Existing environment variables and SQL schema remain unchanged; rebuild/redeploy to publish changes.
- Audio playback mechanics were tested with mock media. No custom SFX/music assets were present for listening/level checks. Empty audio folders are fully supported and are not incomplete functionality.
- Caption budgets match HTML `maxLength` (UTF-16 units); many emoji use two or more units. Paste truncation preserves complete emoji clusters.
- Existing connection leases remain 25 seconds. A hard disconnect or lost refresh-release request may require that grace period.
- Local test mode still shows reactions only on their sender. Cross-browser reactions were verified using Supabase.
- The earlier development-only lint dependency advisory remains outside this update; no dependencies were changed. No claim is made that a new dependency audit was run today.

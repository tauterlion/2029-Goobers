# Verification — October 3, 2026

## Passed

- **27 automated tests**: room validation, names and emoji graphemes, capacity, host authority, kicking/rejoining, deterministic host migration, fixed electorate, next-round activation, duplicate phase commands, image shuffling/exhaustion/rematch avoidance, both image modes, failure replacement, caption edits and early closure, shame/funeral distinction, private projections, self-vote rejection, vote replacement, randomized timeout votes, bonus ordering/rounding, streaks, ties, single/zero captions, only-host recovery, complete phase sequence, and deterministic image/audio manifests with absent audio directories.
- **TypeScript**: `npm run typecheck` passed.
- **Lint**: `npm run lint` passed without warnings.
- **Production build**: `npm run build` passed with 89 images and zero announcer files.
- **Four real browser contexts**: a complete Same Image game from room creation to awards and return to lobby; submitted-caption recovery after refresh; no browser JavaScript errors. Desktop 1440×1000 and mobile 390×844 screenshots saved under `test-results/`.
- **Twelve-client API test**: simultaneous joins, captions and votes; room capacity; duplicate connection rejection; kick/rejoin; phase epoch guards; twelve distinct images; anonymous payloads; scoring; host transfer. This exercises the local serialized store, not remote database contention.
- **Visual inspection**: desktop landing/lobby/captioning/voting/podium and mobile landing/captioning/slideshow/voting inspected. Full images remain contained; mobile has no horizontal overflow. Additional phase screenshots are available in `test-results/`.
- **Asset preservation**: all user files retained. 89 supported images indexed; one MP4 ignored as a non-static image.
- **Secrets**: no real environment credentials added. `.env*` ignored except the blank example; sensitive server module uses `server-only`. Source scan found no JWT/private-key/service-secret literals.
- **Production dependency audit**: zero reported vulnerabilities in `npm audit --omit=dev`.

## Not verified against external infrastructure

No Supabase project credentials were present. The SQL migration, remote compare-and-swap behavior, Supabase Realtime delivery/reactions, hosted reconnect behavior, and Vercel deployment have **not** been live-tested. Apply the supplied migration and run the deployment smoke checklist in README before calling the hosted release verified.

The implementation uses a versioned JSON room aggregate rather than separate player/caption/vote tables. Only server code can access it. Atomic compare-and-swap commits enforce game consistency; this needs verification against your configured Supabase project.

Local test mode deliberately uses file persistence and read polling, with reactions shown on the sending client only. Production uses Supabase Broadcast and an eight-second recovery heartbeat. Sudden disconnects without a clean leave use a 25-second lease, so detection and host migration can take roughly 25–33 seconds. A refresh whose release request is lost may need to wait for that lease.

Five development-only npm advisory entries remain in the Next.js ESLint toolchain, tracing to the same `braces` nested-pattern denial-of-service advisory. No production dependency is affected; the offered automatic fix downgrades the framework lint configuration across major versions, so it was not applied blindly.

No placeholders or voice recordings are required. The optional SFX/music folders are extension points; only timer ticks and optional announcer playback are currently wired. No fake speech was generated.

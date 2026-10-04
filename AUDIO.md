# Optional game audio

Drop files into these folders, then restart development or rebuild. `predev` and `prebuild` both regenerate the manifest. Empty or missing folders are supported. No recordings or TTS are required.

## Sound effects

Use `public/audio/sfx/<cue>.mp3`, or numbered variants such as `vote_select_01.ogg` and `vote_select_02.wav`. Supported extensions: `.mp3`, `.ogg`, `.webm`, `.wav`, `.m4a`, `.aac` (playback support depends on the browser).

Available cues:

```text
ui_hover                 ui_click
player_join              player_leave
countdown_tick           countdown_go
round_intro              caption_submit
timer_tick               timer_10_seconds
timer_5_seconds          timer_end
pin_of_shame             disconnect_grave
slideshow_next           reaction
vote_select              vote_change
voting_complete          vote_reveal
score_tick               bonus_awarded
unanimous                streak
round_winner             leaderboard
round_tie
third_place              second_place
first_place_build        first_place_reveal
confetti                 rematch
```

UI hover is throttled, concurrent effects are capped, and important effects temporarily duck music. The existing synthesized urgency tick remains available even without files. To avoid doubling the tick, use that fallback alone or adjust it in `src/audio/manager.ts` when adding a custom `timer_tick`.

## Background music

Use these logical names in `public/audio/music/`:

| Filename | Where it plays |
|---|---|
| `lobby.mp3` | Landing, lobby, countdown |
| `captioning.mp3` | Round intro, image reveal, caption writing |
| `slideshow.mp3` | Anonymous memes |
| `voting.mp3` | Voting |
| `results.mp3` | Vote tally, round winner, leaderboard |
| `final_results.mp3` | Podium, awards, game over |

The other supported audio extensions work too, e.g. `lobby.ogg`. Use one file per logical music name unless you want a random variant when entering that section. Music loops quietly, does not restart on each render or heartbeat, and crossfades over 500ms. Gag screens fade to silence. Music ducks during important effects and announcer playback. The global sound button controls music, effects, voice and synthesized ticks. Playback starts only after user interaction, respecting browser autoplay rules.

## Announcer

Keep optional voice files in `public/audio/announcer/`, e.g. `pin_of_shame_01.webm`. Existing phase cues and special `game_start`, `pin_of_shame`, `disconnect_grave`, `unanimous`, `win_streak`, `urgency_10`, and `urgency_5` hooks remain. Missing cues are silent and never delay a game transition.

Implementation: `src/audio/player.ts` owns playback and levels; `manager.ts` exposes the shared player; `useGameAudio.ts` maps authoritative room updates to phase cues/music. These are presentation effects only; the game engine never waits for audio.

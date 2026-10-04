"use client";
import { useEffect, useRef } from "react";
import type { GameView, Phase } from "@/game/engine";
import { cue, music, sfx, tone } from "./manager";
import type { MusicCue, SfxCue } from "./player";
const tracks: Partial<Record<Phase, MusicCue>> = {
  lobby: "lobby",
  starting: "lobby",
  round_intro: "captioning",
  image_reveal: "captioning",
  captioning: "captioning",
  slideshow: "slideshow",
  voting: "voting",
  vote_reveal: "results",
  round_winner: "results",
  round_leaderboard: "results",
  final_podium: "final_results",
  final_awards: "final_results",
  game_over: "final_results",
};
const phases: Partial<Record<Phase, SfxCue>> = {
  round_intro: "round_intro",
  slideshow: "slideshow_next",
  vote_reveal: "vote_reveal",
  round_winner: "round_winner",
  round_leaderboard: "leaderboard",
};
export function useGameAudio(
  state: GameView | null,
  remaining: number,
  now: number,
) {
  const previous = useRef<GameView | null>(null),
    played = useRef(new Set<string>());
  useEffect(() => {
    music(state ? (tracks[state.phase] ?? null) : "lobby");
    if (!state) return;
    const old = previous.current;
    if (old?.id === state.id) {
      for (const p of state.players) {
        const before = old.players.find((q) => q.id === p.id);
        if (p.online && !before?.online) sfx("player_join");
        if (!p.online && before?.online) sfx("player_leave");
      }
      if (old.players.some((p) => !state.players.some((q) => q.id === p.id)))
        sfx("player_leave");
    }
    if (old?.epoch !== state.epoch) {
      played.current.clear();
      cue(state.phase === "starting" ? "game_start" : state.phase);
      const sound =
        state.phase === "round_winner" &&
        state.results.filter((r) => r.winner).length > 1
          ? "round_tie"
          : phases[state.phase];
      if (sound) sfx(sound, true);
      if (old?.phase === "starting" && state.phase === "round_intro")
        sfx("countdown_go", true);
      if (old?.phase === "voting" && state.phase === "vote_reveal")
        sfx("voting_complete", true);
      if (
        old?.phase === "captioning" &&
        state.phase !== "captioning" &&
        old.deadline !== null &&
        state.started >= old.deadline
      )
        sfx("timer_end", true);
      if (state.phase === "round_winner") {
        if (state.results.some((r) => r.unanimous)) {
          sfx("unanimous", true);
          cue("unanimous");
        }
        if (state.results.some((r) => r.winner && r.streak > 1)) {
          sfx("streak", true);
          cue("win_streak");
        }
        if (
          state.results.some((r) => r.unanimous || (r.winner && r.streak > 1))
        )
          sfx("bonus_awarded", true);
      }
    }
    const once = (key: string, fn: () => void) => {
      if (!played.current.has(key)) {
        played.current.add(key);
        fn();
      }
    };
    if (state.phase === "caption_resolution")
      once(`gag-${state.index}`, () => {
        const name =
          state.gag?.kind === "grave" ? "disconnect_grave" : "pin_of_shame";
        sfx(name, true);
        cue(name);
      });
    if (state.phase === "starting" && remaining > 0)
      once(`count-${remaining}`, () => sfx("countdown_tick"));
    if (state.phase === "captioning" && remaining > 0 && remaining <= 10)
      once(`tick-${remaining}`, () => {
        sfx("timer_tick");
        tone(remaining <= 5);
        if (remaining === 10) {
          sfx("timer_10_seconds", true);
          cue("urgency_10");
        }
        if (remaining === 5) {
          sfx("timer_5_seconds", true);
          cue("urgency_5");
        }
      });
    if (state.phase === "vote_reveal") {
      const count = Math.min(
        Math.max(0, ...state.captions.map((c) => c.count ?? 0)),
        Math.floor((now - state.started) / 350),
      );
      if (count > 0) once(`score-${count}`, () => sfx("score_tick"));
    }
    if (state.phase === "final_podium") {
      for (const [ms, name] of [
        [0, "third_place"],
        [3000, "second_place"],
        [4500, "first_place_build"],
        [6000, "first_place_reveal"],
        [6000, "confetti"],
      ] as const) {
        if (now - state.started >= ms) once(name, () => sfx(name, true));
      }
    }
    previous.current = state;
  }, [state, remaining, now]);
  useEffect(() => () => music(null), []);
}

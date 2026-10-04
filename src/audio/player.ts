export type AudioAssets = {
  sfx: Record<string, string[]>;
  music: Record<string, string[]>;
  announcer: Record<string, string[]>;
};
export const SFX_CUES = [
  "ui_hover",
  "ui_click",
  "player_join",
  "player_leave",
  "countdown_tick",
  "countdown_go",
  "round_intro",
  "caption_submit",
  "timer_tick",
  "timer_10_seconds",
  "timer_5_seconds",
  "timer_end",
  "pin_of_shame",
  "disconnect_grave",
  "slideshow_next",
  "reaction",
  "vote_select",
  "vote_change",
  "voting_complete",
  "vote_reveal",
  "score_tick",
  "bonus_awarded",
  "unanimous",
  "streak",
  "round_winner",
  "leaderboard",
  "third_place",
  "second_place",
  "first_place_build",
  "first_place_reveal",
  "confetti",
  "rematch",
] as const;
export type SfxCue = (typeof SFX_CUES)[number];
export type MusicCue =
  "lobby" | "captioning" | "slideshow" | "voting" | "results" | "final_results";
type Track = { audio: HTMLAudioElement; gain: number };
/** Small optional mixer: bounded effects, 500ms crossfade, temporary music ducking. */
export class AudioPlayer {
  private unlocked = false;
  private muted = false;
  private desired: MusicCue | null = null;
  private current: Track | null = null;
  private tracks = new Set<Track>();
  private effects = new Set<HTMLAudioElement>();
  private voice: HTMLAudioElement | null = null;
  private voiceDucking = false;
  private ducked = false;
  private fades = new Set<ReturnType<typeof setInterval>>();
  private cleanup = new Set<ReturnType<typeof setTimeout>>();
  private duckTimer: ReturnType<typeof setTimeout> | undefined;
  private last = new Map<string, number>();
  constructor(
    private assets: AudioAssets,
    private create: (path: string) => HTMLAudioElement = (p) => new Audio(p),
  ) {}
  private pick(group: Record<string, string[]>, name: string) {
    const paths = group[name];
    return paths?.length
      ? paths[Math.floor(Math.random() * paths.length)]
      : undefined;
  }
  private volume() {
    for (const t of this.tracks)
      t.audio.volume = this.muted
        ? 0
        : t.gain * 0.22 * (this.ducked || this.voiceDucking ? 0.3 : 1);
  }
  private play(audio: HTMLAudioElement) {
    try {
      void audio.play().catch(() => {});
    } catch {}
  }
  unlock() {
    this.unlocked = true;
    if (!this.muted) {
      this.ensureMusic();
      if (this.current?.audio.paused) this.play(this.current.audio);
    }
  }
  setMuted(value: boolean) {
    this.muted = value;
    if (value) {
      this.voice?.pause();
      this.voiceDucking = false;
      for (const a of this.effects) a.pause();
      for (const t of this.tracks) t.audio.pause();
    } else if (this.unlocked) {
      this.ensureMusic();
      if (this.current) this.play(this.current.audio);
    }
    this.volume();
  }
  private duck() {
    this.ducked = true;
    clearTimeout(this.duckTimer);
    this.volume();
    this.duckTimer = setTimeout(() => {
      this.ducked = false;
      this.volume();
    }, 900);
  }
  sfx(name: SfxCue, important = false) {
    if (!this.unlocked || this.muted) return;
    const path = this.pick(this.assets.sfx, name);
    if (!path) return;
    const now = Date.now();
    if (
      now - (this.last.get(name) ?? -Infinity) <
      (name === "ui_hover" ? 90 : 35)
    )
      return;
    this.last.set(name, now);
    try {
      const a = this.create(path);
      a.volume = name === "ui_hover" ? 0.16 : 0.42;
      if (this.effects.size >= 8) {
        const first = this.effects.values().next().value!;
        first.pause();
        this.effects.delete(first);
      }
      this.effects.add(a);
      const timer = setTimeout(done, 15000);
      this.cleanup.add(timer);
      const self = this;
      function done() {
        a.pause();
        self.effects.delete(a);
        clearTimeout(timer);
        self.cleanup.delete(timer);
      }
      a.onended = done;
      a.onerror = done;
      this.play(a);
      if (important) this.duck();
    } catch {}
  }
  announcer(name: string) {
    if (!this.unlocked || this.muted) return;
    const path = this.pick(this.assets.announcer, name);
    if (!path) return;
    try {
      this.voice?.pause();
      const a = this.create(path);
      this.voice = a;
      a.volume = 0.7;
      this.voiceDucking = true;
      this.volume();
      const done = () => {
        if (this.voice === a) {
          this.voiceDucking = false;
          this.volume();
        }
      };
      a.onended = done;
      a.onerror = done;
      void a.play().catch(done);
    } catch {
      this.voiceDucking = false;
      this.volume();
    }
  }
  music(name: MusicCue | null) {
    if (name === this.desired) return;
    this.desired = name;
    this.ensureMusic();
  }
  private ensureMusic() {
    if (!this.unlocked || this.muted) return;
    const path = this.desired
      ? this.pick(this.assets.music, this.desired)
      : undefined;
    if (this.current?.audio.dataset.cue === this.desired) return;
    const old = [...this.tracks];
    for (const timer of this.fades) clearInterval(timer);
    this.fades.clear();
    this.current = null;
    if (path) {
      try {
        const a = this.create(path);
        a.loop = true;
        a.dataset.cue = this.desired!;
        a.volume = 0;
        this.current = { audio: a, gain: 0 };
        this.tracks.add(this.current);
        a.onerror = () => {
          a.pause();
          for (const t of this.tracks) if (t.audio === a) this.tracks.delete(t);
        };
        this.play(a);
      } catch {}
    }
    if (!old.length && !this.current) return;
    const next = this.current,
      start = Date.now(),
      oldGains = old.map((t) => t.gain);
    const timer = setInterval(() => {
      const f = Math.min(1, (Date.now() - start) / 500);
      old.forEach((t, i) => (t.gain = oldGains[i] * (1 - f)));
      if (next) next.gain = f;
      this.volume();
      if (f === 1) {
        for (const t of old) {
          t.audio.pause();
          this.tracks.delete(t);
        }
        clearInterval(timer);
        this.fades.delete(timer);
      }
    }, 25);
    this.fades.add(timer);
  }
  dispose() {
    for (const t of this.fades) clearInterval(t);
    for (const t of this.cleanup) clearTimeout(t);
    clearTimeout(this.duckTimer);
    for (const t of this.tracks) t.audio.pause();
    for (const a of this.effects) a.pause();
    this.voice?.pause();
    this.tracks.clear();
    this.effects.clear();
    this.current = null;
  }
}

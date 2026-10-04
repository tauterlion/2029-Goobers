import { describe, it, expect, vi, afterEach } from "vitest";
import { AudioPlayer, AudioAssets, SFX_CUES } from "./player";
function setup(assets: AudioAssets = { sfx: {}, music: {}, announcer: {} }) {
  const sounds: { path: string; audio: HTMLAudioElement }[] = [];
  const create = vi.fn((path: string) => {
    const audio = {
      volume: 1,
      paused: true,
      loop: false,
      dataset: {},
      play: vi.fn(function (this: { paused: boolean }) {
        this.paused = false;
        return Promise.resolve();
      }),
      pause: vi.fn(function (this: { paused: boolean }) {
        this.paused = true;
      }),
      onended: null,
      onerror: null,
    } as unknown as HTMLAudioElement;
    sounds.push({ path, audio });
    return audio;
  });
  return { player: new AudioPlayer(assets, create), create, sounds };
}
afterEach(() => vi.useRealTimers());
describe("optional audio", () => {
  it("ignores every absent cue, including absent music and voices", () => {
    const { player, create } = setup();
    player.unlock();
    SFX_CUES.forEach((c) => player.sfx(c));
    player.music("lobby");
    player.announcer("anything");
    expect(create).not.toHaveBeenCalled();
    player.dispose();
  });
  it("requires interaction and never restarts the same music on state updates", () => {
    vi.useFakeTimers();
    const { player, sounds } = setup({
      music: { lobby: ["lobby.mp3"], voting: ["vote.ogg"] },
      sfx: {},
      announcer: {},
    });
    player.music("lobby");
    expect(sounds).toHaveLength(0);
    player.unlock();
    player.music("lobby");
    player.unlock();
    vi.advanceTimersByTime(600);
    expect(sounds).toHaveLength(1);
    expect(sounds[0].audio.loop).toBe(true);
    expect(sounds[0].audio.play).toHaveBeenCalledTimes(1);
    player.music("voting");
    vi.advanceTimersByTime(600);
    expect(sounds[0].audio.pause).toHaveBeenCalled();
    expect(sounds[1].audio.volume).toBeCloseTo(0.22);
    player.setMuted(true);
    expect(sounds[1].audio.volume).toBe(0);
    player.setMuted(false);
    expect(sounds).toHaveLength(2);
    expect(sounds[1].audio.play).toHaveBeenCalledTimes(2);
    player.dispose();
  });
  it("ducks music for important effects then restores it", () => {
    vi.useFakeTimers();
    const { player, sounds } = setup({
      music: { lobby: ["lobby.mp3"] },
      sfx: { unanimous: ["win.wav"] },
      announcer: {},
    });
    player.music("lobby");
    player.unlock();
    vi.advanceTimersByTime(600);
    player.sfx("unanimous", true);
    expect(sounds[0].audio.volume).toBeCloseTo(0.066);
    vi.advanceTimersByTime(1000);
    expect(sounds[0].audio.volume).toBeCloseTo(0.22);
    player.dispose();
  });
  it("swallows rejected playback and leaves gameplay independent", async () => {
    vi.useFakeTimers();
    const create = () =>
      ({
        dataset: {},
        play: () => Promise.reject(new Error("autoplay blocked")),
        pause: () => {},
      }) as unknown as HTMLAudioElement;
    const p = new AudioPlayer(
      {
        music: { lobby: ["bad.mp3"] },
        sfx: { ui_click: ["bad.wav"] },
        announcer: { start: ["bad.webm"] },
      },
      create,
    );
    expect(() => {
      p.unlock();
      p.music("lobby");
      p.sfx("ui_click");
      p.announcer("start");
    }).not.toThrow();
    await Promise.resolve();
    p.dispose();
  });
});

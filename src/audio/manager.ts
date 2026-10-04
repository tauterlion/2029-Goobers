import assets from "@/generated/assets.json";
import { AudioPlayer, SfxCue, MusicCue } from "./player";
const player = new AudioPlayer(assets);
let context: AudioContext | null = null;
let muted = false;
export function setMuted(value: boolean) {
  muted = value;
  player.setMuted(value);
}
export function unlock() {
  player.unlock();
  try {
    context ??= new AudioContext();
    void context.resume();
  } catch {}
}
export function tone(urgent = false) {
  if (muted || !context) return;
  try {
    const o = context.createOscillator(),
      g = context.createGain();
    o.type = "sine";
    o.frequency.value = urgent ? 700 : 440;
    g.gain.setValueAtTime(0.045, context.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.12);
    o.connect(g).connect(context.destination);
    o.start();
    o.stop(context.currentTime + 0.13);
  } catch {}
}
export function cue(name: string) {
  player.announcer(name);
}
export const sfx = (name: SfxCue, important = false) =>
  player.sfx(name, important);
export const music = (name: MusicCue | null) => player.music(name);

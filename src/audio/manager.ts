import assets from "@/generated/assets.json";
let context: AudioContext | null = null;
let muted = false;
let voice: HTMLAudioElement | null = null;
export function setMuted(value: boolean) {
  muted = value;
  if (value) voice?.pause();
}
export function unlock() {
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
  if (muted) return;
  const files = (assets.announcer as Record<string, string[]>)[name];
  if (!files?.length) return;
  voice?.pause();
  voice = new Audio(files[Math.floor(Math.random() * files.length)]);
  voice.volume = 0.8;
  void voice.play().catch(() => {});
}

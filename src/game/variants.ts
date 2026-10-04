/** FNV-1a over a stable event identity. No client randomness or clock dependency. */
export function pickVariant(options: readonly string[], seed: string): string {
  if (!options.length) return "";
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return options[(hash >>> 0) % options.length];
}
export function eventCopy(
  options: readonly string[],
  state: { id: string; gameId?: string; epoch: string; round: number },
  event: string,
  player = "",
) {
  return pickVariant(
    options,
    JSON.stringify([
      state.id,
      state.gameId ?? state.epoch,
      state.round,
      event,
      player,
    ]),
  );
}
export function interpolate(
  text: string,
  values: Record<string, string | number>,
) {
  return text.replace(/\[([^\]]+)\]/g, (match, key) =>
    String(values[key] ?? match),
  );
}

export type Deck = {
  mode: "all" | "blacklist" | "whitelist";
  images: string[];
};
export const defaultDeck = (): Deck => ({ mode: "all", images: [] });
export function activeImages(library: string[], deck: Deck = defaultDeck()) {
  const selected = new Set(deck.images);
  return library.filter(
    (image) =>
      deck.mode === "all" ||
      (deck.mode === "whitelist" ? selected.has(image) : !selected.has(image)),
  );
}

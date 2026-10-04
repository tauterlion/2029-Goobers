"use client";
import { useState } from "react";
import assets from "@/generated/assets.json";
import { Deck, activeImages } from "@/game/deck";
import { COPY } from "@/game/copy";
import { interpolate } from "@/game/variants";
export default function DeckEditor({
  deck,
  onChange,
  busy,
}: {
  deck: Deck;
  onChange: (deck: Deck) => void;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false),
    [page, setPage] = useState(0);
  const count = activeImages(assets.images, deck).length,
    pages = Math.max(1, Math.ceil(assets.images.length / 24));
  function toggle(image: string) {
    onChange({
      ...deck,
      images: deck.images.includes(image)
        ? deck.images.filter((i) => i !== image)
        : [...deck.images, image],
    });
  }
  return (
    <section className="deck-editor">
      <div className="deck-summary">
        <b>
          {interpolate(COPY.deck.summary, {
            ACTIVE: count,
            TOTAL: assets.images.length,
          })}
        </b>
        <button className="quiet" onClick={() => setOpen(!open)}>
          {open ? COPY.deck.close : COPY.deck.edit}
        </button>
      </div>
      {open && (
        <>
          <h2>{COPY.deck.title}</h2>
          <div className="deck-toolbar">
            {(["all", "blacklist", "whitelist"] as const).map((mode) => (
              <button
                key={mode}
                disabled={busy}
                aria-pressed={deck.mode === mode}
                onClick={() => onChange({ mode, images: [] })}
              >
                {COPY.deck[mode]}
              </button>
            ))}
            {deck.mode !== "all" && (
              <>
                <button
                  disabled={busy}
                  onClick={() => onChange({ ...deck, images: assets.images })}
                >
                  {COPY.deck.selectAll}
                </button>
                <button
                  disabled={busy}
                  onClick={() => onChange({ ...deck, images: [] })}
                >
                  {COPY.deck.clear}
                </button>
              </>
            )}
          </div>
          <div className="deck-grid">
            {assets.images
              .slice(page * 24, (page + 1) * 24)
              .map((image, index) => {
                const selected = deck.images.includes(image),
                  enabled =
                    deck.mode === "all" ||
                    (deck.mode === "whitelist" ? selected : !selected);
                return (
                  <button
                    key={image}
                    aria-label={`Image ${page * 24 + index + 1}`}
                    aria-pressed={enabled}
                    disabled={busy || deck.mode === "all"}
                    className={enabled ? "enabled" : "excluded"}
                    onClick={() => toggle(image)}
                  >
                    <img
                      src={image}
                      loading="lazy"
                      alt={decodeURIComponent(image.split("/").at(-1) ?? "")}
                    />
                    <span>
                      {enabled ? "✓" : "×"}{" "}
                      {deck.mode === "whitelist"
                        ? selected
                          ? COPY.deck.selected
                          : COPY.deck.disabled
                        : deck.mode === "blacklist" && selected
                          ? COPY.deck.excluded
                          : COPY.deck.enabled}
                    </span>
                  </button>
                );
              })}
          </div>
          <div className="deck-pages">
            <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              {COPY.deck.previous}
            </button>
            <span>
              {interpolate(COPY.deck.page, { PAGE: page + 1, TOTAL: pages })}
            </span>
            <button
              disabled={page === pages - 1}
              onClick={() => setPage((p) => p + 1)}
            >
              {COPY.deck.next}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

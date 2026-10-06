"use client";
import { useEffect, useRef, useState } from "react";
import { COPY } from "@/game/copy";
export default function ReactionTray({
  emojis,
  onReact,
}: {
  emojis: string[];
  onReact: (emoji: string) => void;
}) {
  const [open, setOpen] = useState(false),
    dock = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
        if (!dock.current?.contains(e.target as Node)) setOpen(false);
      },
      escape = (e: KeyboardEvent) => {
        if (e.key === "Escape") setOpen(false);
      };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  return (
    <div className={`reaction-dock ${open ? "open" : ""}`} ref={dock}>
      <button
        className="reaction-toggle"
        aria-expanded={open}
        aria-controls="reaction-tray"
        aria-label={open ? COPY.common.closeReactions : COPY.common.reactions}
        onClick={() => setOpen(!open)}
      >
        {open ? "×" : COPY.common.reactions}
      </button>
      <div
        className="reactions"
        id="reaction-tray"
        aria-label={COPY.common.sendReaction}
      >
        {emojis.map((e) => (
          <button key={e} aria-label={`React ${e}`} onClick={() => onReact(e)}>
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}

"use client";
import { useState } from "react";
import { COPY } from "@/game/copy";
// The key at the call site resets only for a different authoritative source.
export default function GameImage({
  src,
  className = "meme-image",
}: {
  src: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  return src && !failed ? (
    <img
      src={src}
      className={className}
      alt={COPY.common.imageAlt}
      onError={() => {
        setFailed(true);
        if (process.env.NODE_ENV === "development")
          console.warn("Assigned image failed to load:", src);
      }}
    />
  ) : (
    <div className="image-fallback" data-image-source={src} role="status">
      <span aria-hidden="true">🖼️</span>
      <p>
        {COPY.common.fallback}
        <br />
        {COPY.common.fallbackHint}
      </p>
    </div>
  );
}

"use client";
import { useEffect, useRef, useState } from "react";
import type { GameView } from "@/game/engine";
import { COPY } from "@/game/copy";
import {
  Body,
  Bounds,
  clampBody,
  initialBody,
  stepBody,
} from "@/game/lobby-physics";
export default function LobbyPlayers({
  state,
  onEdit,
  onKick,
  busy,
}: {
  state: GameView;
  onEdit: () => void;
  onKick: (id: string) => void;
  busy: boolean;
}) {
  const [manage, setManage] = useState(false),
    cloud = useRef<HTMLDivElement>(null),
    nodes = useRef(new Map<string, HTMLButtonElement>()),
    bodies = useRef(new Map<string, Body>()),
    sizes = useRef(new Map<string, Bounds>()),
    raf = useRef(0),
    last = useRef(0),
    reduce = useRef(false),
    reset = useRef(() => {}),
    suppress = useRef(false);
  const drag = useRef<{
    id: string;
    pointer: number;
    x: number;
    y: number;
    time: number;
    startX: number;
    startY: number;
    touch: boolean;
  } | null>(null);
  const roster = state.players.map((p) => p.id).join("|");
  const paint = (id: string) => {
    const b = bodies.current.get(id),
      node = nodes.current.get(id);
    if (b && node)
      node.style.transform = `translate3d(${b.x}px,${b.y}px,0) rotate(${b.rotation}deg)`;
  };
  const animate = (time: number) => {
    const dt = last.current ? (time - last.current) / 1000 : 1 / 60;
    last.current = time;
    let moving = false;
    bodies.current.forEach((b, id) => {
      if (drag.current?.id !== id && sizes.current.has(id)) {
        stepBody(b, sizes.current.get(id)!, dt);
        paint(id);
        if (b.vx || b.vy) moving = true;
      }
    });
    raf.current = moving ? requestAnimationFrame(animate) : 0;
  };
  useEffect(() => {
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    reduce.current = mq.matches;
    const changed = () => {
      reduce.current = mq.matches;
      if (mq.matches) {
        cancelAnimationFrame(raf.current);
        raf.current = 0;
        bodies.current.forEach((b) => {
          b.vx = 0;
          b.vy = 0;
        });
      }
    };
    mq.addEventListener("change", changed);
    const layout = (resetAll = false) => {
      const el = cloud.current;
      if (!el) return;
      const ids = roster.split("|").filter(Boolean),
        width = el.clientWidth,
        columns = Math.max(1, Math.min(ids.length, Math.floor(width / 170))),
        height = Math.max(270, Math.ceil(ids.length / columns) * 105);
      el.style.height = `${height}px`;
      for (const id of bodies.current.keys())
        if (!ids.includes(id)) {
          bodies.current.delete(id);
          sizes.current.delete(id);
        }
      ids.forEach((id, index) => {
        const node = nodes.current.get(id);
        if (!node) return;
        const bounds = {
          width,
          height,
          tagWidth: node.offsetWidth,
          tagHeight: node.offsetHeight,
        };
        sizes.current.set(id, bounds);
        if (resetAll || !bodies.current.has(id))
          bodies.current.set(id, initialBody(index, ids.length, bounds));
        else clampBody(bodies.current.get(id)!, bounds);
        paint(id);
      });
    };
    reset.current = () => {
      cancelAnimationFrame(raf.current);
      raf.current = 0;
      drag.current = null;
      layout(true);
    };
    const observer = new ResizeObserver(() => layout());
    if (cloud.current) observer.observe(cloud.current);
    layout(true);
    return () => {
      observer.disconnect();
      mq.removeEventListener("change", changed);
      cancelAnimationFrame(raf.current);
      raf.current = 0;
      drag.current = null;
    };
  }, [roster]);
  function release(e: React.PointerEvent<HTMLButtonElement>) {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    const b = bodies.current.get(d.id)!;
    if (
      reduce.current ||
      e.type === "pointercancel" ||
      performance.now() - d.time > 100
    ) {
      b.vx = 0;
      b.vy = 0;
    }
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    if (!raf.current && (b.vx || b.vy)) {
      last.current = 0;
      raf.current = requestAnimationFrame(animate);
    }
  }
  return (
    <>
      <div className="player-cloud throwable-cloud" ref={cloud}>
        {state.players.map((p) => (
          <button
            key={p.id}
            ref={(el) => {
              if (el) nodes.current.set(p.id, el);
              else nodes.current.delete(p.id);
            }}
            className="throwable-tag"
            style={{ "--player": p.color } as React.CSSProperties}
            aria-label={`${COPY.lobby.drag} ${p.name}`}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              const b = bodies.current.get(p.id);
              if (!b) return;
              b.vx = 0;
              b.vy = 0;
              suppress.current = false;
              drag.current = {
                id: p.id,
                pointer: e.pointerId,
                x: e.clientX,
                y: e.clientY,
                time: performance.now(),
                startX: e.clientX,
                startY: e.clientY,
                touch: e.pointerType === "touch",
              };
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (!d || d.id !== p.id || d.pointer !== e.pointerId) return;
              const b = bodies.current.get(p.id)!,
                now = performance.now(),
                dt = Math.max(0.008, (now - d.time) / 1000),
                dx = e.clientX - d.x,
                dy = e.clientY - d.y,
                limit = d.touch ? 500 : 1400;
              b.x += dx;
              b.y += dy;
              b.vx = Math.max(-limit, Math.min(limit, dx / dt));
              b.vy = Math.max(-limit, Math.min(limit, dy / dt));
              if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 5)
                suppress.current = true;
              clampBody(b, sizes.current.get(p.id)!);
              d.x = e.clientX;
              d.y = e.clientY;
              d.time = now;
              paint(p.id);
            }}
            onPointerUp={release}
            onPointerCancel={release}
            onLostPointerCapture={release}
            onClick={() => {
              if (!suppress.current && p.id === state.me) onEdit();
              suppress.current = false;
            }}
          >
            <span>
              {p.id === state.host ? "♛ " : ""}
              {p.name}
            </span>
            <small>
              {p.id === state.me
                ? COPY.lobby.you
                : p.online
                  ? COPY.lobby.online
                  : COPY.lobby.offline}
            </small>
          </button>
        ))}
      </div>
      <div className="lobby-player-actions">
        <button className="quiet" onClick={() => reset.current()}>
          {COPY.lobby.resetLayout}
        </button>
        <button className="quiet" onClick={onEdit}>
          {COPY.lobby.editProfile}
        </button>
        {state.me === state.host && (
          <button
            className="quiet"
            onClick={() => setManage(!manage)}
            aria-expanded={manage}
          >
            {COPY.lobby.manage}
          </button>
        )}
      </div>
      {state.players.length < 4 && (
        <p className="subtle">{COPY.lobby.needed}</p>
      )}
      {manage && state.me === state.host && (
        <section className="player-management" aria-label={COPY.lobby.manage}>
          <h2>{COPY.lobby.manage}</h2>
          {state.players.map((p) => (
            <div key={p.id}>
              <i style={{ background: p.color }} aria-hidden="true" />
              <b>{p.name}</b>
              <small>
                {p.id === state.host
                  ? COPY.lobby.host
                  : p.online
                    ? COPY.lobby.online
                    : COPY.lobby.offline}
              </small>
              {p.id !== state.host && (
                <button
                  disabled={busy}
                  onClick={() => onKick(p.id)}
                  aria-label={`${COPY.lobby.kick} ${p.name}`}
                >
                  {COPY.lobby.kick}
                </button>
              )}
            </div>
          ))}
        </section>
      )}
    </>
  );
}

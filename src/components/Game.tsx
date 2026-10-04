"use client";
import { COPY } from "@/game/copy";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient, RealtimeChannel } from "@supabase/supabase-js";
import { Action, COLORS, GameView, visibleLength } from "@/game/engine";
import { sfx, setMuted, unlock } from "@/audio/manager";
import { useGameAudio } from "@/audio/useGameAudio";
import { CAPTION_MAX, truncateCaption } from "@/game/caption";
type Session = { token: string; connection: string; code: string };
const emojis = ["😂", "💀", "🔥", "😭", "🙏", "🗿", "🤨", "👏"];
export default function Game() {
  const [state, setState] = useState<GameView | null>(null),
    [name, setName] = useState(""),
    [code, setCode] = useState(""),
    [error, setError] = useState(""),
    [errorCode, setErrorCode] = useState(""),
    [busy, setBusy] = useState(false),
    [lost, setLost] = useState(false),
    [local, setLocal] = useState(false),
    [clock, setClock] = useState(0),
    [draft, setDraft] = useState(""),
    [muted, setMute] = useState(false),
    [editing, setEditing] = useState(false),
    [help, setHelp] = useState(false),
    [floats, setFloats] = useState<{ id: string; emoji: string; x: number }[]>(
      [],
    );
  const session = useRef<Session | null>(null),
    current = useRef<GameView | null>(null),
    offset = useRef(0),
    channel = useRef<RealtimeChannel | null>(null),
    inflight = useRef(false),
    realtimeHealthy = useRef(true),
    lastReaction = useRef(0);
  const pushReaction = useCallback((emoji: string) => {
    if (!emojis.includes(emoji)) return;
    const id = crypto.randomUUID();
    setFloats((f) => [
      ...f.slice(-19),
      { id, emoji, x: 5 + Math.random() * 90 },
    ]);
    setTimeout(() => setFloats((f) => f.filter((x) => x.id !== id)), 2500);
  }, []);
  const request = useCallback(
    async (action: Action & { code?: string }, quiet = false) => {
      if (!session.current) return;
      if (!quiet) setBusy(true);
      try {
        const response = await fetch("/api/game", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...session.current, ...action }),
        });
        const data = await response.json();
        if (!response.ok)
          throw Object.assign(new Error(data.error), { code: data.code });
        const s = data.state as GameView;
        offset.current = s.serverTime - Date.now();
        if (
          !current.current ||
          s.id !== current.current.id ||
          s.version >= current.current.version
        ) {
          current.current = s;
          setState(s);
        }
        setLocal(data.local);
        session.current.code = s.code;
        localStorage.setItem(
          "goobers-session",
          JSON.stringify({ token: session.current.token, code: s.code }),
        );
        setLost(!data.local && !realtimeHealthy.current);
        if (action.type === "resume") setError("");
        if (!quiet) setError("");
        if (action.type === "caption") sfx("caption_submit");
        if (action.type === "rematch") sfx("rematch", true);
        return s;
      } catch (e) {
        const msg = e instanceof Error ? e.message : COPY.errors.service;
        const code = (e as { code?: string })?.code ?? "service";
        setErrorCode(code);
        if (["duplicateSession", "session", "notFound"].includes(code)) {
          setError(msg);
          setLost(false);
          if (["session", "notFound"].includes(code) && current.current) {
            current.current = null;
            setState(null);
            session.current.code = "";
            localStorage.removeItem("goobers-session");
          }
        } else if (quiet) setLost(true);
        else setError(msg);
        return null;
      } finally {
        if (!quiet) setBusy(false);
      }
    },
    [],
  );
  useEffect(() => {
    let saved: { token?: string; code?: string } = {};
    try {
      saved = JSON.parse(localStorage.getItem("goobers-session") ?? "{}");
    } catch {}
    session.current ??= {
      token: saved.token ?? crypto.randomUUID(),
      connection: crypto.randomUUID(),
      code: saved.code ?? "",
    };
    if (saved.code) void request({ type: "resume" }, true);
    const timer = setInterval(() => setClock(Date.now()), 200);
    // A hard refresh can race the previous page's best-effort lease release.
    const recovery = setInterval(() => {
      if (!current.current && session.current?.code)
        void request({ type: "resume" }, true);
    }, 8000);
    return () => {
      clearInterval(timer);
      clearInterval(recovery);
    };
  }, [request]);
  useEffect(() => {
    if (!state?.id) return;
    const beat = setInterval(
      () => void request({ type: "heartbeat" }, true),
      8000,
    );
    const handle = () => {
      if (session.current)
        void fetch("/api/game", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...session.current, type: "leave" }),
          keepalive: true,
        });
    };
    window.addEventListener("pagehide", handle);
    return () => {
      clearInterval(beat);
      window.removeEventListener("pagehide", handle);
    };
  }, [state?.id, request]);
  useEffect(() => {
    if (!state?.id) return;
    if (local) {
      const timer = setInterval(
        () => void request({ type: "read" }, true),
        1200,
      );
      return () => clearInterval(timer);
    }
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
      key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) return;
    const client = createClient(url, key);
    const ch = client.channel(`room:${state.id}`);
    channel.current = ch;
    ch.on(
      "broadcast",
      { event: "changed" },
      () => void request({ type: "read" }, true),
    )
      .on("broadcast", { event: "reaction" }, ({ payload }) =>
        pushReaction(payload.emoji),
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          realtimeHealthy.current = true;
          void request({ type: "resume" }, true);
        }
        if (
          status === "CHANNEL_ERROR" ||
          status === "TIMED_OUT" ||
          status === "CLOSED"
        ) {
          realtimeHealthy.current = false;
          setLost(true);
        }
      });
    return () => {
      channel.current = null;
      void client.removeChannel(ch);
    };
  }, [state?.id, local, request, pushReaction]);
  useEffect(() => {
    if (
      !state?.deadline ||
      clock + offset.current < state.deadline ||
      inflight.current
    )
      return;
    inflight.current = true;
    void request({ type: "heartbeat" }, true).finally(() => {
      inflight.current = false;
    });
  }, [clock, state?.deadline, request]);
  useEffect(() => {
    setDraft(truncateCaption(state?.ownCaption ?? ""));
  }, [state?.round, state?.ownCaption]);
  const now = Math.max(state?.started ?? 0, clock + offset.current),
    remaining = state?.deadline
      ? Math.max(0, Math.ceil((state.deadline - now) / 1000))
      : 0;
  useGameAudio(state, remaining, now);
  const send = (a: Action) => {
    unlock();
    void request({ ...a, epoch: state?.epoch }).then((result) => {
      if (result && a.type === "vote")
        sfx(state?.ownVote ? "vote_change" : "vote_select");
    });
  };
  const react = (emoji: string) => {
    if (clock - lastReaction.current < 250) return;
    lastReaction.current = clock;
    sfx("reaction");
    pushReaction(emoji);
    void channel.current?.send({
      type: "broadcast",
      event: "reaction",
      payload: { emoji },
    });
  };
  const me = state?.players.find((p) => p.id === state.me),
    isHost = state?.host === state?.me,
    hostName = state?.players.find((p) => p.id === state.host)?.name;
  const enter = (type: "create" | "join") => {
    unlock();
    void request({ type, name, code: code.toUpperCase() }).then((s) => {
      if (s) window.history.replaceState({}, "", "/play");
    });
  };
  const exit = () => {
    void request({ type: "leave" }).then(() => {
      localStorage.removeItem("goobers-session");
      window.location.replace(new URL("/", window.location.origin).href);
    });
  };
  const standings = state
    ? [...state.players].sort(
        (a, b) => b.score - a.score || a.id.localeCompare(b.id),
      )
    : [];
  function image(src: string, className = "meme-image") {
    return src ? (
      <img
        className={className}
        src={src}
        alt="Your caption challenge"
        onError={() => send({ type: "image_failed", image: src })}
      />
    ) : (
      <div className="image-fallback">
        🖼️
        <p>
          {COPY.common.fallback}
          <br />
          {COPY.common.fallbackHint}
        </p>
      </div>
    );
  }
  function ranks(compact = false) {
    return (
      <div className={compact ? "ranking compact" : "ranking"}>
        {standings.map((p, i) => (
          <div
            className="rank"
            key={p.id}
            style={{ "--player": p.color } as React.CSSProperties}
          >
            <b>{1 + standings.filter((q) => q.score > p.score).length}</b>
            <span>
              {p.name}
              {p.id === state?.me ? " (you)" : ""}
              <small>
                {p.streak > 1
                  ? `🔥 STREAK ×${p.streak}`
                  : i === standings.length - 1
                    ? COPY.leaderboard.consolation
                    : !p.online
                      ? COPY.common.reconnecting
                      : ""}
              </small>
            </span>
            <strong>
              {p.score}
              <small>PTS</small>
            </strong>
          </div>
        ))}
      </div>
    );
  }
  const waiting =
    me?.pending &&
    state?.phase !== "lobby" &&
    !["final_podium", "final_awards", "game_over"].includes(state?.phase ?? "");
  return (
    <div
      className={`world phase-${state?.phase ?? "home"} ${remaining <= 10 && state?.phase === "captioning" ? "urgent" : ""}`}
      onPointerDown={unlock}
      onClickCapture={(e) => {
        if ((e.target as Element).closest("button:not(:disabled)"))
          sfx("ui_click");
      }}
      onPointerOver={(e) => {
        const button = (e.target as Element).closest("button:not(:disabled)");
        if (button && !button.contains(e.relatedTarget as Node | null))
          sfx("ui_hover");
      }}
    >
      <div className="ambient" aria-hidden="true">
        <i />
        <i />
        <i />
        <span className="asterisk">✳</span>
        <span className="orbit">✦</span>
        <span className="scribble">〰</span>
      </div>
      <header>
        <Link
          className="brand"
          href="/"
          onClick={(e) => {
            if (state) e.preventDefault();
          }}
        >
          2029
          <span>
            GOOBERS<span className="brand-dot">®</span>
          </span>
        </Link>
        <div className="header-right">
          {state && (
            <span className="room-tag">
              ROOM <b>{state.code}</b>
            </span>
          )}
          <button
            className="icon-button"
            aria-label={muted ? "Enable sound" : "Mute sound"}
            onClick={() => {
              setMute(!muted);
              setMuted(!muted);
              unlock();
            }}
          >
            {muted ? "♪ OFF" : "♪ ON"}
          </button>
          <button
            className="icon-button"
            onClick={() => setHelp(!help)}
            aria-label="How to play"
          >
            ?
          </button>
        </div>
      </header>
      {help && (
        <aside className="help">
          <button
            onClick={() => setHelp(false)}
            aria-label="Close instructions"
          >
            ×
          </button>
          <h2>{COPY.common.helpTitle}</h2>
          <p>{COPY.common.help}</p>
          <p>{COPY.common.scoring}</p>
        </aside>
      )}
      {error && (
        <div className="error" role="alert">
          {error}
          <button aria-label="Dismiss error" onClick={() => setError("")}>
            ×
          </button>
          {errorCode === "duplicateSession" && (
            <button onClick={() => window.location.reload()}>
              {COPY.common.retrySession}
            </button>
          )}
        </div>
      )}
      {lost && (
        <div className="connection-overlay">
          <div>
            <h2>{COPY.common.lost}</h2>
            <p>{COPY.common.recover}</p>
            <button onClick={() => void request({ type: "resume" }, true)}>
              {COPY.common.retry}
            </button>
            <button
              className="quiet"
              onClick={() => {
                localStorage.removeItem("goobers-session");
                window.location.replace(
                  new URL("/", window.location.origin).href,
                );
              }}
            >
              {COPY.common.leaveSession}
            </button>
          </div>
        </div>
      )}
      {!state ? (
        <main className="landing">
          <section className="hero">
            <div className="eyebrow">
              <span /> {COPY.home.eyebrow}
            </div>
            <h1>
              {COPY.home.title1}
              <br />
              {COPY.home.title2}
              <br />
              <em>{COPY.home.title3}</em>
              <br />
              <em>{COPY.home.title4}</em>
            </h1>
            <p>
              {COPY.home.intro1}
              <br />
              {COPY.home.intro2}
            </p>
            <div className="hero-meta">
              <span>{COPY.home.players}</span>
              <span>{COPY.home.downloads}</span>
              <span>{COPY.home.tag}</span>
            </div>
            <div className="doodle-face" aria-hidden="true">
              <span>× &nbsp; ×</span>
              <b>⌣</b>
            </div>
          </section>
          <section className="entry">
            <div className="entry-top">
              <span>{COPY.home.entryTop}</span>
              <span>↗</span>
            </div>
            <div className="entry-body">
              <span className="sticker">
                {COPY.home.sticker1}
                <br />
                {COPY.home.sticker2}
              </span>
              <h2>
                {COPY.home.entry1}
                <br />
                {COPY.home.entry2}
              </h2>
              <label htmlFor="name">{COPY.home.name}</label>
              <input
                id="name"
                autoComplete="nickname"
                placeholder={COPY.home.namePlaceholder}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && name.trim()) enter("create");
                }}
              />
              <div className="input-hint">
                {COPY.home.nameHint}
                <span>{visibleLength(name)}/14</span>
              </div>
              <button
                className="primary"
                disabled={busy || !name.trim() || visibleLength(name) > 14}
                onClick={() => enter("create")}
              >
                {COPY.home.create} <span>↗</span>
              </button>
              <div className="or">
                <span />
                {COPY.home.or}
                <span />
              </div>
              <div className="join-row">
                <input
                  aria-label="Room code"
                  placeholder={COPY.home.code}
                  maxLength={5}
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") enter("join");
                  }}
                />
                <button
                  disabled={busy || !name.trim() || code.length !== 5}
                  onClick={() => enter("join")}
                >
                  {COPY.home.join}
                </button>
              </div>
              <p className="entry-note">{COPY.home.note}</p>
            </div>
          </section>
          <div className="marquee">
            <span>{COPY.home.marquee} </span>
          </div>
        </main>
      ) : (
        <main className="game-main" aria-live="polite">
          <div className="phase-top">
            <span>
              {state.phase === "lobby"
                ? COPY.lobby.title
                : `ROUND ${state.round || "—"} / ${state.settings.rounds}`}
            </span>
            <span>
              {local ? "LOCAL TEST MODE · " : ""}
              {state.players.filter((p) => p.online).length} GOOBERS ONLINE
            </span>
          </div>
          {waiting ? (
            <section className="moment">
              <div className="mega-emoji">🎟️</div>
              <h1>{COPY.lobby.joining}</h1>
              <p>{COPY.lobby.joiningHint}</p>
            </section>
          ) : (
            <section
              key={`${state.phase}-${state.phase === "slideshow" ? state.index : ""}`}
              className="stage"
            >
              {state.phase === "lobby" && (
                <>
                  <div className="lobby-title">
                    <div>
                      <div className="eyebrow">{COPY.lobby.invite}</div>
                      <h1>
                        {COPY.lobby.assemble}
                        <br />
                        <em>{COPY.lobby.goobers}</em>
                      </h1>
                    </div>
                    <div className="code-display">
                      <small>{COPY.lobby.codeLabel}</small>
                      <strong>{state.code}</strong>
                      <button
                        className="quiet"
                        onClick={() =>
                          void navigator.clipboard.writeText(state.code)
                        }
                      >
                        {COPY.lobby.copy}
                      </button>
                    </div>
                  </div>
                  <div className="player-cloud">
                    {state.players.map((p, i) => (
                      <div
                        className={`player-float player-${i}`}
                        key={p.id}
                        style={
                          {
                            "--player": p.color,
                            "--tilt": `${i % 2 ? 5 : -5}deg`,
                            "--delay": `${i * -0.7}s`,
                          } as React.CSSProperties
                        }
                      >
                        <button
                          onClick={() => {
                            if (p.id === state.me) setEditing(!editing);
                          }}
                        >
                          <span>
                            {p.id === state.host ? "♛ " : ""}
                            {p.name}
                          </span>
                          <small>
                            {p.id === state.me
                              ? COPY.lobby.you
                              : !p.online
                                ? COPY.lobby.offline
                                : COPY.lobby.online}
                          </small>
                        </button>
                        {isHost && p.id !== state.me && (
                          <button
                            className="kick"
                            aria-label={`Kick ${p.name}`}
                            onClick={() => send({ type: "kick", target: p.id })}
                          >
                            ×
                          </button>
                        )}
                      </div>
                    ))}
                    {state.players.length < 4 && (
                      <p className="need-players">
                        {4 - state.players.length} {COPY.lobby.needed}
                      </p>
                    )}
                  </div>
                  {editing && (
                    <div className="customize">
                      <input
                        aria-label="New name"
                        placeholder={me?.name}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                      />
                      <button onClick={() => send({ type: "rename", name })}>
                        {COPY.lobby.rename}
                      </button>
                      <div className="colors">
                        {COLORS.map((c) => (
                          <button
                            key={c}
                            aria-label={`Choose color ${c}`}
                            style={{ background: c }}
                            onClick={() => send({ type: "color", color: c })}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="lobby-controls">
                    <label>
                      {COPY.lobby.rounds}
                      <select
                        aria-label="Rounds"
                        disabled={!isHost}
                        value={state.settings.rounds}
                        onChange={(e) =>
                          send({
                            type: "settings",
                            settings: {
                              ...state.settings,
                              rounds: Number(e.target.value),
                            },
                          })
                        }
                      >
                        {Array.from({ length: 15 }, (_, i) => (
                          <option key={i}>{i + 1}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      {COPY.lobby.timer}
                      <select
                        aria-label="Caption timer"
                        disabled={!isHost}
                        value={state.settings.seconds}
                        onChange={(e) =>
                          send({
                            type: "settings",
                            settings: {
                              ...state.settings,
                              seconds: Number(e.target.value),
                            },
                          })
                        }
                      >
                        {[10, 15, 20, 25, 30, 40, 50, 60].map((n) => (
                          <option value={n} key={n}>
                            {n} SEC
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      {COPY.lobby.mode}
                      <select
                        aria-label="Image mode"
                        disabled={!isHost}
                        value={state.settings.mode}
                        onChange={(e) =>
                          send({
                            type: "settings",
                            settings: {
                              ...state.settings,
                              mode: e.target.value as "same" | "different",
                            },
                          })
                        }
                      >
                        <option value="same">{COPY.lobby.same}</option>
                        <option value="different">
                          {COPY.lobby.different}
                        </option>
                      </select>
                    </label>
                    {isHost ? (
                      <button
                        className="primary"
                        disabled={
                          busy ||
                          state.players.filter((p) => p.online).length < 4
                        }
                        onClick={() => send({ type: "start" })}
                      >
                        {COPY.lobby.start}
                      </button>
                    ) : (
                      <p>Waiting for {hostName} to start…</p>
                    )}
                  </div>
                  <p className="subtle">{COPY.lobby.hint}</p>
                </>
              )}
              {state.phase === "starting" && (
                <div className="moment">
                  <p>{COPY.round.starting}</p>
                  <h1 className="countdown" key={remaining}>
                    {remaining}
                  </h1>
                  <p>{COPY.round.loading}</p>
                </div>
              )}
              {state.phase === "round_intro" && (
                <div className="moment">
                  <p>{COPY.round.intro}</p>
                  <h1>
                    {state.round === state.settings.rounds
                      ? COPY.round.final
                      : COPY.round.round}
                    <br />
                    <em>
                      {state.round === state.settings.rounds
                        ? COPY.round.roundEnd
                        : String(state.round).padStart(2, "0")}
                    </em>
                  </h1>
                </div>
              )}
              {["image_reveal", "captioning"].includes(state.phase) && (
                <div className="caption-stage">
                  <div className="section-title">
                    <h1>
                      {COPY.caption.title} <em>{COPY.caption.titleAccent}</em>
                    </h1>
                    {state.phase === "captioning" && (
                      <div
                        className={`timer ${remaining <= 5 ? "danger" : ""}`}
                        role="timer"
                      >
                        {remaining}
                        <small>{COPY.round.seconds}</small>
                      </div>
                    )}
                  </div>
                  <div className="meme-frame">{image(state.image)}</div>
                  {state.phase === "captioning" && (
                    <form
                      className="caption-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        send({ type: "caption", text: draft });
                      }}
                    >
                      <label className="sr-only" htmlFor="caption">
                        {COPY.caption.label}
                      </label>
                      <textarea
                        id="caption"
                        maxLength={CAPTION_MAX}
                        aria-describedby="caption-counter"
                        placeholder={COPY.caption.placeholder}
                        value={draft}
                        onChange={(e) =>
                          setDraft(truncateCaption(e.target.value))
                        }
                        onPaste={(e) => {
                          e.preventDefault();
                          const field = e.currentTarget;
                          setDraft(
                            truncateCaption(
                              draft.slice(0, field.selectionStart) +
                                e.clipboardData.getData("text") +
                                draft.slice(field.selectionEnd),
                            ),
                          );
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            if (
                              visibleLength(draft.trim()) >= 3 &&
                              draft.trim().length <= CAPTION_MAX
                            )
                              send({ type: "caption", text: draft });
                          }
                        }}
                      />
                      <div className="caption-bottom">
                        <span>
                          <span
                            id="caption-counter"
                            className={
                              draft.length >= 90
                                ? "caption-counter near-limit"
                                : "caption-counter"
                            }
                          >
                            {draft.length} / {CAPTION_MAX}
                          </span>{" "}
                          · {state.submitted}/{state.eligible} SUBMITTED
                        </span>
                        <button
                          className="primary"
                          disabled={
                            busy ||
                            visibleLength(draft.trim()) < 3 ||
                            draft.trim().length > CAPTION_MAX
                          }
                        >
                          {state.ownCaption
                            ? COPY.caption.update
                            : COPY.caption.submit}
                        </button>
                      </div>
                      {state.ownCaption && (
                        <p className="subtle">{COPY.caption.saved}</p>
                      )}
                    </form>
                  )}
                </div>
              )}
              {state.phase === "caption_resolution" && (
                <div className={`moment gag ${state.gag?.kind}`}>
                  <div className="mega-emoji">
                    {state.gag?.kind === "grave" ? "🪦" : "📌"}
                  </div>
                  <p>
                    {state.gag?.kind === "grave"
                      ? COPY.grave.title
                      : COPY.shame.title}
                  </p>
                  <h1>
                    {
                      state.players.find((p) => p.id === state.gag?.player)
                        ?.name
                    }
                  </h1>
                  <p>
                    {state.gag?.kind === "grave"
                      ? COPY.grave.subtitle
                      : COPY.shame.subtitle}
                  </p>
                </div>
              )}
              {state.phase === "slideshow" && (
                <div className="slideshow">
                  <div className="section-title">
                    <p>
                      {COPY.slideshow.exhibit}{" "}
                      {String(state.index + 1).padStart(2, "0")} /{" "}
                      {state.captions.length}
                    </p>
                    <span>{COPY.slideshow.anonymous}</span>
                  </div>
                  <div className="meme-frame">
                    {image(state.captions[state.index]?.image)}
                    <h2 className="meme-caption">
                      {state.captions[state.index]?.text}
                    </h2>
                  </div>
                  {isHost ? (
                    <button
                      className="primary next"
                      disabled={busy || now - state.started < 1500}
                      onClick={() => send({ type: "continue" })}
                    >
                      {state.index === state.captions.length - 1
                        ? COPY.slideshow.vote
                        : COPY.slideshow.next}{" "}
                      →
                    </button>
                  ) : (
                    <p className="subtle">
                      {COPY.slideshow.waiting} {hostName}{" "}
                      {COPY.slideshow.waitingEnd}
                    </p>
                  )}
                </div>
              )}
              {state.phase === "voting" && (
                <div className="voting">
                  <div className="section-title">
                    <div>
                      <p>{COPY.voting.intro}</p>
                      <h1>
                        {COPY.voting.title} <em>{COPY.voting.accent}</em>
                      </h1>
                    </div>
                    <div className="timer">
                      {remaining}
                      <small>{COPY.round.seconds}</small>
                    </div>
                  </div>
                  {state.settings.mode === "same" &&
                    image(state.captions[0]?.image, "voting-image")}
                  <div className={`vote-grid ${state.settings.mode}`}>
                    {state.captions.map((c, i) => (
                      <button
                        key={c.id}
                        className={`vote-card ${state.ownVote === c.id ? "selected" : ""}`}
                        disabled={c.own || busy}
                        onClick={() => send({ type: "vote", target: c.id })}
                      >
                        {state.settings.mode === "different" && image(c.image)}
                        <span className="vote-number">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <strong>{c.text}</strong>
                        <small>
                          {c.own
                            ? COPY.voting.own
                            : state.ownVote === c.id
                              ? COPY.voting.selected
                              : COPY.voting.select}
                        </small>
                      </button>
                    ))}
                  </div>
                  <p className="subtle">{COPY.voting.hint}</p>
                </div>
              )}
              {state.phase === "vote_reveal" && (
                <div className="moment">
                  <p>{COPY.results.intro}</p>
                  <h1>
                    {COPY.results.verdict}
                    <span className="blink">…</span>
                  </h1>
                  {state.captions.length === 0 ? (
                    <p>{COPY.results.empty}</p>
                  ) : state.captions.length === 1 ? (
                    <p>{COPY.results.single}</p>
                  ) : null}
                  <div className="tally-grid">
                    {state.captions.map((c) => (
                      <div className="tally" key={c.id}>
                        <span>{c.text}</span>
                        <b>
                          {Math.min(
                            c.count ?? 0,
                            Math.floor(Math.max(0, now - state.started) / 350),
                          )}
                        </b>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {state.phase === "round_winner" && (
                <div className="moment winner">
                  <p>
                    {state.results.filter((r) => r.winner).length > 1
                      ? COPY.results.tie
                      : COPY.results.winnerIntro}
                  </p>
                  <h1>
                    {state.results.some((r) => r.winner)
                      ? COPY.results.winner
                      : COPY.results.noWinner}
                  </h1>
                  <div className="winner-grid">
                    {state.results
                      .filter((r) => r.winner)
                      .map((r) => {
                        const c = state.captions.find(
                          (c) => c.author === r.player,
                        );
                        return (
                          <div className="winner-card" key={r.player}>
                            {c && image(c.image)}
                            <h2>“{c?.text}”</h2>
                            <h3>
                              {
                                state.players.find((p) => p.id === r.player)
                                  ?.name
                              }
                            </h3>
                            <b>+{r.points} POINTS</b>
                            {r.unanimous && <p>{COPY.results.unanimous}</p>}
                            {r.streak > 1 && (
                              <p>🔥 STREAK ×{r.streak} · +10%</p>
                            )}
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}
              {state.phase === "round_leaderboard" && (
                <div className="leaderboard">
                  <p>{COPY.leaderboard.intro}</p>
                  <h1>
                    {COPY.leaderboard.title} <em>{COPY.leaderboard.accent}</em>
                  </h1>
                  {ranks()}
                  <div className="round-breakdown">
                    {state.results
                      .filter((r) => r.points > 0)
                      .map((r) => (
                        <span key={r.player}>
                          {state.players.find((p) => p.id === r.player)?.name} +
                          {r.points}
                          {r.unanimous ? " ✳ UNANIMOUS" : ""}
                          {r.streak > 1 ? ` 🔥 ×${r.streak}` : ""}
                        </span>
                      ))}
                  </div>
                  {isHost ? (
                    <button
                      className="primary"
                      disabled={busy || now - state.started < 1500}
                      onClick={() => send({ type: "continue" })}
                    >
                      {state.round === state.settings.rounds
                        ? COPY.leaderboard.final
                        : COPY.leaderboard.next}{" "}
                      →
                    </button>
                  ) : (
                    <p>
                      {COPY.leaderboard.waiting} {hostName}.
                    </p>
                  )}
                  <div className="author-reveal">
                    <h2>{COPY.results.authorTitle}</h2>
                    {state.captions.map((c) => (
                      <div key={c.id}>
                        <span>“{c.text}”</span>
                        <b>
                          {state.players.find((p) => p.id === c.author)?.name} ·{" "}
                          {c.count} votes
                        </b>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {state.phase === "final_podium" && (
                <div className="finale">
                  <p>{COPY.podium.intro}</p>
                  <h1>
                    {COPY.podium.title} <em>{COPY.podium.accent}</em>
                  </h1>
                  <div className="podium-layout">
                    <div className="podium">
                      {[2, 1, 3].map((rank) => {
                        const players = standings.filter(
                          (p) =>
                            1 +
                              standings.filter((q) => q.score > p.score)
                                .length ===
                            rank,
                        );
                        const visible =
                          now - state.started >
                          ({ 3: 0, 2: 3000, 1: 6000 }[rank] ?? 0);
                        return (
                          <div
                            className={`podium-place place-${rank} ${visible ? "visible" : ""}`}
                            key={rank}
                          >
                            <span>
                              {rank === 1 ? "👑" : rank === 2 ? "🥈" : "🥉"}
                            </span>
                            <h2>
                              {players.map((p) => p.name).join(" & ") || "—"}
                            </h2>
                            {players.length > 1 && (
                              <small>{COPY.podium.tied}</small>
                            )}
                            <p>{players[0]?.score ?? 0} PTS</p>
                            <b>
                              {rank === 1
                                ? COPY.podium.first
                                : rank === 2
                                  ? COPY.podium.second
                                  : COPY.podium.third}
                            </b>
                          </div>
                        );
                      })}
                    </div>
                    {now - state.started > 7500 && ranks(true)}
                  </div>
                  {now - state.started > 6000 && <Confetti />}
                </div>
              )}
              {state.phase === "final_awards" && (
                <div className="awards">
                  <p>{COPY.awards.intro}</p>
                  <h1>
                    {COPY.awards.title} <em>{COPY.awards.accent}</em>
                  </h1>
                  <div className="awards-grid">
                    {state.best.map((b, i) => (
                      <div className="award best" key={i}>
                        <span>
                          {COPY.awards.best} {b.votes} VOTES
                        </span>
                        {image(b.caption.image)}
                        <h2>“{b.caption.text}”</h2>
                        <p>
                          {
                            state.players.find((p) => p.id === b.caption.player)
                              ?.name
                          }
                        </p>
                      </div>
                    ))}
                    {(
                      [
                        { key: "pins", title: COPY.awards.pins },
                        { key: "longest", title: COPY.awards.fire },
                        { key: "votes", title: COPY.awards.votes },
                        { key: "deaths", title: COPY.awards.deaths },
                        { key: "robbed", title: COPY.awards.robbed },
                      ] as const
                    ).map((a) => {
                      const max = Math.max(
                        ...state.players.map((p) => p.stats[a.key]),
                      );
                      return max > 0 ? (
                        <div className="award" key={a.key}>
                          <p>{a.title}</p>
                          <h2>
                            {state.players
                              .filter((p) => p.stats[a.key] === max)
                              .map((p) => p.name)
                              .join(" & ")}
                          </h2>
                          <b>{max}</b>
                        </div>
                      ) : null;
                    })}
                  </div>
                  {isHost ? (
                    <button
                      className="primary"
                      onClick={() => send({ type: "continue" })}
                      disabled={busy || now - state.started < 1500}
                    >
                      {COPY.awards.continue}
                    </button>
                  ) : (
                    <p>Waiting for {hostName}…</p>
                  )}
                </div>
              )}
              {state.phase === "game_over" && (
                <div className="leaderboard">
                  <p>{COPY.end.intro}</p>
                  <h1>
                    {COPY.end.title} <em>{COPY.end.accent}</em>
                  </h1>
                  {ranks()}
                  {isHost ? (
                    <div className="end-buttons">
                      <button
                        className="primary"
                        disabled={
                          busy ||
                          state.players.filter((p) => p.online).length < 4
                        }
                        onClick={() => send({ type: "rematch" })}
                      >
                        {COPY.end.rematch}
                      </button>
                      <button onClick={() => send({ type: "lobby" })}>
                        {COPY.end.lobby}
                      </button>
                    </div>
                  ) : (
                    <p>{COPY.end.waiting}</p>
                  )}
                </div>
              )}
            </section>
          )}
          {state.halfGone && isHost && (
            <aside className="vanished">
              <h2>{COPY.common.vanished}</h2>
              <button onClick={() => send({ type: "keep" })}>
                {COPY.common.continue}
              </button>
              <button onClick={() => send({ type: "end" })}>
                {COPY.common.end}
              </button>
            </aside>
          )}
          <footer className="game-footer">
            <button className="quiet" onClick={exit}>
              {COPY.common.leave}
            </button>
            <div className="reactions" aria-label="Send a reaction">
              {emojis.map((e) => (
                <button
                  key={e}
                  aria-label={`React ${e}`}
                  onClick={() => react(e)}
                >
                  {e}
                </button>
              ))}
            </div>
            {isHost &&
            state.phase !== "lobby" &&
            state.phase !== "game_over" ? (
              <button
                className="quiet"
                disabled={busy}
                onClick={() => send({ type: "skip" })}
              >
                {COPY.common.skip}
              </button>
            ) : (
              <span className="footer-note">{COPY.common.footer}</span>
            )}
          </footer>
        </main>
      )}
      {!state && (
        <footer className="home-footer">
          <span>{COPY.home.footer1}</span>
          <span>{COPY.home.footer2}</span>
        </footer>
      )}
      <div className="reaction-layer" aria-hidden="true">
        {floats.map((f) => (
          <span key={f.id} style={{ left: `${f.x}%` }}>
            {f.emoji}
          </span>
        ))}
      </div>
    </div>
  );
}
function Confetti() {
  return (
    <div className="confetti" aria-hidden="true">
      {Array.from({ length: 50 }, (_, i) => (
        <i
          key={i}
          style={{
            left: `${i * 2}%`,
            background: COLORS[i % COLORS.length],
            animationDelay: `${(i % 9) * 0.13}s`,
            transform: `rotate(${i * 17}deg)`,
          }}
        />
      ))}
    </div>
  );
}

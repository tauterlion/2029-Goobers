"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient, RealtimeChannel } from "@supabase/supabase-js";
import { Action, COLORS, GameView, visibleLength } from "@/game/engine";
import { cue, setMuted, tone, unlock } from "@/audio/manager";
type Session = { token: string; connection: string; code: string };
const emojis = ["😂", "💀", "🔥", "😭", "🙏", "🗿", "🤨", "👏"];
export default function Game() {
  const [state, setState] = useState<GameView | null>(null),
    [name, setName] = useState(""),
    [code, setCode] = useState(""),
    [error, setError] = useState(""),
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
        if (!response.ok) throw new Error(data.error);
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
        return s;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Connection lost.";
        if (/another tab|session ended|find that room/.test(msg)) {
          setError(msg);
          setLost(false);
          if (/session ended|find that room/.test(msg) && current.current) {
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
    setDraft(state?.ownCaption ?? "");
  }, [state?.round, state?.ownCaption]);
  useEffect(() => {
    if (state) cue(state.phase === "starting" ? "game_start" : state.phase);
  }, [state?.phase]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (state?.phase === "caption_resolution")
      cue(state.gag?.kind === "grave" ? "disconnect_grave" : "pin_of_shame");
    if (state?.phase === "round_winner") {
      if (state.results.some((r) => r.unanimous)) cue("unanimous");
      else if (state.results.some((r) => r.streak > 1 && r.winner))
        cue("win_streak");
    }
  }, [state?.epoch, state?.index]); // eslint-disable-line react-hooks/exhaustive-deps
  const now = Math.max(state?.started ?? 0, clock + offset.current),
    remaining = state?.deadline
      ? Math.max(0, Math.ceil((state.deadline - now) / 1000))
      : 0;
  useEffect(() => {
    if (state?.phase === "captioning" && remaining > 0 && remaining <= 10) {
      tone(remaining <= 5);
      if (remaining === 10) cue("urgency_10");
      if (remaining === 5) cue("urgency_5");
    }
  }, [remaining, state?.phase]);
  const send = (a: Action) => {
    unlock();
    void request({ ...a, epoch: state?.epoch });
  };
  const react = (emoji: string) => {
    if (clock - lastReaction.current < 250) return;
    lastReaction.current = clock;
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
          The image has left the chat.
          <br />
          Caption this extremely expensive blank canvas.
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
                    ? "Emotional support goober"
                    : !p.online
                      ? "Reconnecting…"
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
          <h2>One image. Zero dignity.</h2>
          <p>
            Write a caption. Watch the anonymous slideshow. React irresponsibly.
            Vote for your favorite (except yourself).
          </p>
          <p>
            Each vote = 25 points. All manual votes = +50%. Consecutive wins =
            another +10%. The host runs the show.
          </p>
        </aside>
      )}
      {error && (
        <div className="error" role="alert">
          {error}
          <button aria-label="Dismiss error" onClick={() => setError("")}>
            ×
          </button>
          {/another tab/.test(error) && (
            <button onClick={() => window.location.reload()}>
              Try reconnecting
            </button>
          )}
        </div>
      )}
      {lost && (
        <div className="connection-overlay">
          <div>
            <h2>CONNECTION LOST</h2>
            <p>Trying to reconnect… Your genius is safe.</p>
            <button onClick={() => void request({ type: "resume" }, true)}>
              Retry now
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
              Leave session
            </button>
          </div>
        </div>
      )}
      {!state ? (
        <main className="landing">
          <section className="hero">
            <div className="eyebrow">
              <span /> A VERY UNSERIOUS PARTY GAME
            </div>
            <h1>
              TERRIBLE
              <br />
              CAPTIONS.
              <br />
              <em>EXCELLENT</em>
              <br />
              <em>COMPANY.</em>
            </h1>
            <p>
              Gather your favorite idiots.
              <br />
              Make memes. Question your friendships.
            </p>
            <div className="hero-meta">
              <span>4–12 PLAYERS</span>
              <span>NO DOWNLOADS</span>
              <span>JUST CHAOS</span>
            </div>
            <div className="doodle-face" aria-hidden="true">
              <span>× &nbsp; ×</span>
              <b>⌣</b>
            </div>
          </section>
          <section className="entry">
            <div className="entry-top">
              <span>THE GROUP CHAT, BUT WORSE.</span>
              <span>↗</span>
            </div>
            <div className="entry-body">
              <span className="sticker">
                YOUR BAD IDEAS
                <br />
                BELONG HERE.
              </span>
              <h2>
                LET&apos;S GET
                <br />
                WEIRD.
              </h2>
              <label htmlFor="name">WHAT DO WE CALL YOU?</label>
              <input
                id="name"
                autoComplete="nickname"
                placeholder="Your legendary name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && name.trim()) enter("create");
                }}
              />
              <div className="input-hint">
                Emojis welcome. Ego optional.
                <span>{visibleLength(name)}/14</span>
              </div>
              <button
                className="primary"
                disabled={busy || !name.trim() || visibleLength(name) > 14}
                onClick={() => enter("create")}
              >
                CREATE A ROOM <span>↗</span>
              </button>
              <div className="or">
                <span />
                OR CRASH THE PARTY
                <span />
              </div>
              <div className="join-row">
                <input
                  aria-label="Room code"
                  placeholder="ROOM CODE"
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
                  JOIN →
                </button>
              </div>
              <p className="entry-note">
                One host. One room code. Several questionable decisions.
              </p>
            </div>
          </section>
          <div className="marquee">
            <span>
              WRITE SOMETHING STUPID ✳ MAKE YOUR FRIENDS LAUGH ✳ ABSOLUTELY NO
              TALENT REQUIRED ✳{" "}
            </span>
          </div>
        </main>
      ) : (
        <main className="game-main" aria-live="polite">
          <div className="phase-top">
            <span>
              {state.phase === "lobby"
                ? "THE WAITING ROOM OF BAD DECISIONS"
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
              <h1>YOU&apos;RE IN!</h1>
              <p>Joining next round… Warm up those two brain cells.</p>
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
                      <div className="eyebrow">INVITE YOUR USUAL SUSPECTS</div>
                      <h1>
                        ASSEMBLE THE
                        <br />
                        <em>GOOBERS.</em>
                      </h1>
                    </div>
                    <div className="code-display">
                      <small>THE SECRET HANDSHAKE</small>
                      <strong>{state.code}</strong>
                      <button
                        className="quiet"
                        onClick={() =>
                          void navigator.clipboard.writeText(state.code)
                        }
                      >
                        COPY CODE ↗
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
                              ? "YOU"
                              : !p.online
                                ? "OFFLINE"
                                : "CERTIFIED GOOBER"}
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
                        {4 - state.players.length} more questionable
                        personalities needed ↗
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
                        RENAME
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
                      ROUNDS
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
                      CAPTION TIMER
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
                      FLAVOR OF CHAOS
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
                        <option value="same">SAME IMAGE</option>
                        <option value="different">DIFFERENT IMAGES</option>
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
                        START THE CHAOS ↗
                      </button>
                    ) : (
                      <p>Waiting for {hostName} to start…</p>
                    )}
                  </div>
                  <p className="subtle">
                    Click your name to change your name or color. No ready
                    buttons. We trust you. Mostly.
                  </p>
                </>
              )}
              {state.phase === "starting" && (
                <div className="moment">
                  <p>PLEASE LOWER YOUR EXPECTATIONS.</p>
                  <h1 className="countdown" key={remaining}>
                    {remaining}
                  </h1>
                  <p>THE CHAOS IS LOADING.</p>
                </div>
              )}
              {state.phase === "round_intro" && (
                <div className="moment">
                  <p>FRESH IMAGE. FRESH OPPORTUNITY TO EMBARRASS YOURSELF.</p>
                  <h1>
                    {state.round === state.settings.rounds ? "FINAL" : "ROUND"}
                    <br />
                    <em>
                      {state.round === state.settings.rounds
                        ? "ROUND."
                        : String(state.round).padStart(2, "0")}
                    </em>
                  </h1>
                </div>
              )}
              {["image_reveal", "captioning"].includes(state.phase) && (
                <div className="caption-stage">
                  <div className="section-title">
                    <h1>
                      MAKE IT <em>WORSE.</em>
                    </h1>
                    {state.phase === "captioning" && (
                      <div
                        className={`timer ${remaining <= 5 ? "danger" : ""}`}
                        role="timer"
                      >
                        {remaining}
                        <small>SECONDS</small>
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
                        Your caption
                      </label>
                      <textarea
                        id="caption"
                        placeholder="Your intrusive thoughts go here…"
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            if (
                              visibleLength(draft.trim()) >= 3 &&
                              visibleLength(draft.trim()) <= 72
                            )
                              send({ type: "caption", text: draft });
                          }
                        }}
                      />
                      <div className="caption-bottom">
                        <span>
                          {visibleLength(draft.trim())}/72 · {state.submitted}/
                          {state.eligible} SUBMITTED
                        </span>
                        <button
                          className="primary"
                          disabled={
                            busy ||
                            visibleLength(draft.trim()) < 3 ||
                            visibleLength(draft.trim()) > 72
                          }
                        >
                          {state.ownCaption
                            ? "UPDATE CAPTION ↗"
                            : "SUBMIT GENIUS ↗"}
                        </button>
                      </div>
                      {state.ownCaption && (
                        <p className="subtle">
                          ✓ Submitted. You can keep editing until everyone
                          submits or time runs out.
                        </p>
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
                      ? "GONE TOO SOON"
                      : "PIN OF SHAME"}
                  </p>
                  <h1>
                    {
                      state.players.find((p) => p.id === state.gag?.player)
                        ?.name
                    }
                  </h1>
                  <p>
                    {state.gag?.kind === "grave"
                      ? "Disconnected before submitting. Their Wi-Fi had other plans."
                      : "Couldn't think of three characters. A moment of silence for the brain cell."}
                  </p>
                </div>
              )}
              {state.phase === "slideshow" && (
                <div className="slideshow">
                  <div className="section-title">
                    <p>
                      EXHIBIT {String(state.index + 1).padStart(2, "0")} /{" "}
                      {state.captions.length}
                    </p>
                    <span>AUTHOR: CLASSIFIED</span>
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
                        ? "TIME TO JUDGE"
                        : "NEXT MASTERPIECE"}{" "}
                      →
                    </button>
                  ) : (
                    <p className="subtle">
                      Take it in. {hostName} runs the slideshow.
                    </p>
                  )}
                </div>
              )}
              {state.phase === "voting" && (
                <div className="voting">
                  <div className="section-title">
                    <div>
                      <p>ONE VOTE. ZERO OBJECTIVITY.</p>
                      <h1>
                        PICK YOUR <em>POISON.</em>
                      </h1>
                    </div>
                    <div className="timer">
                      {remaining}
                      <small>SECONDS</small>
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
                            ? "YOUR MASTERPIECE"
                            : state.ownVote === c.id
                              ? "✓ SELECTED"
                              : "CLICK TO VOTE"}
                        </small>
                      </button>
                    ))}
                  </div>
                  <p className="subtle">
                    Change your mind until voting closes. Silence means a random
                    vote. No self-love allowed.
                  </p>
                </div>
              )}
              {state.phase === "vote_reveal" && (
                <div className="moment">
                  <p>THE PEOPLE HAVE QUESTIONABLE TASTE.</p>
                  <h1>
                    THE VERDICT<span className="blink">…</span>
                  </h1>
                  {state.captions.length === 0 ? (
                    <p>
                      …SERIOUSLY? Not a single caption. No points. Incredible.
                    </p>
                  ) : state.captions.length === 1 ? (
                    <p>
                      Only one functioning person. An uncontested masterpiece.
                    </p>
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
                      ? "SHARED BRAIN CELL. SHARED VICTORY."
                      : "WE HAVE A PROBLEM. IT’S TALENT."}
                  </p>
                  <h1>
                    {state.results.some((r) => r.winner)
                      ? "ROUND ROYALTY."
                      : "NOBODY WINS."}
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
                            {r.unanimous && <p>✳ UNANIMOUS! +50%</p>}
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
                  <p>THE SOCIAL HIERARCHY HAS SHIFTED.</p>
                  <h1>
                    CURRENT <em>DAMAGE.</em>
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
                        ? "THE GRAND FINALE"
                        : "NEXT ROUND"}{" "}
                      →
                    </button>
                  ) : (
                    <p>Catch your breath. Waiting for {hostName}.</p>
                  )}
                  <div className="author-reveal">
                    <h2>THE CULPRITS, REVEALED.</h2>
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
                  <p>AN ABSURD AMOUNT OF GLORY.</p>
                  <h1>
                    THE <em>GOOBER ELITE.</em>
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
                            {players.length > 1 && <small>TIED</small>}
                            <p>{players[0]?.score ?? 0} PTS</p>
                            <b>
                              {rank === 1 ? "1ST" : rank === 2 ? "2ND" : "3RD"}
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
                  <p>NO EXTRA POINTS. JUST PERMANENT EMOTIONAL DAMAGE.</p>
                  <h1>
                    VERY SPECIAL <em>AWARDS.</em>
                  </h1>
                  <div className="awards-grid">
                    {state.best.map((b, i) => (
                      <div className="award best" key={i}>
                        <span>🏆 BEST MEME · {b.votes} VOTES</span>
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
                        { key: "pins", title: "📌 Pin Collector" },
                        { key: "longest", title: "🔥 On Fire" },
                        { key: "votes", title: "💖 People Pleaser" },
                        { key: "deaths", title: "🪦 Gone Too Soon" },
                        { key: "robbed", title: "😭 Robbed" },
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
                      TAKE A BOW →
                    </button>
                  ) : (
                    <p>Waiting for {hostName}…</p>
                  )}
                </div>
              )}
              {state.phase === "game_over" && (
                <div className="leaderboard">
                  <p>SAME TIME. WORSE JOKES?</p>
                  <h1>
                    ONE MORE <em>BAD IDEA.</em>
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
                        REMATCH ↗
                      </button>
                      <button onClick={() => send({ type: "lobby" })}>
                        RETURN TO LOBBY
                      </button>
                    </div>
                  ) : (
                    <p>The host decides what happens to your evening.</p>
                  )}
                </div>
              )}
            </section>
          )}
          {state.halfGone && isHost && (
            <aside className="vanished">
              <h2>HALF THE LOBBY HAS VANISHED</h2>
              <button onClick={() => send({ type: "keep" })}>
                CONTINUE GAME
              </button>
              <button onClick={() => send({ type: "end" })}>END GAME</button>
            </aside>
          )}
          <footer className="game-footer">
            <button className="quiet" onClick={exit}>
              LEAVE ROOM
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
                SKIP PHASE ↗
              </button>
            ) : (
              <span className="footer-note">BAD JOKES. GOOD COMPANY.</span>
            )}
          </footer>
        </main>
      )}
      {!state && (
        <footer className="home-footer">
          <span>A GAME FOR YOUR LEAST NORMAL FRIENDS.</span>
          <span>EST. 2029. SOMEHOW.</span>
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

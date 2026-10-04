import { COPY } from "./copy";
import { CAPTION_MIN, CAPTION_MAX } from "./caption";
export const PHASES = [
  "lobby",
  "starting",
  "round_intro",
  "image_reveal",
  "captioning",
  "caption_resolution",
  "slideshow",
  "voting",
  "vote_reveal",
  "round_winner",
  "round_leaderboard",
  "final_podium",
  "final_awards",
  "game_over",
] as const;
export type Phase = (typeof PHASES)[number];
export const COLORS = [
  "#b8ff65",
  "#bda5ff",
  "#ff8cba",
  "#71ddff",
  "#ffcd60",
  "#ff896b",
  "#89f3ce",
  "#efafff",
  "#d4e76a",
  "#8daaff",
  "#ffb991",
  "#ffffff",
];
export interface Player {
  id: string;
  secret: string;
  connection: string;
  seen: number;
  joined: number;
  name: string;
  color: string;
  score: number;
  streak: number;
  pending: boolean;
  stats: {
    pins: number;
    deaths: number;
    votes: number;
    longest: number;
    robbed: number;
  };
}
export interface Caption {
  id: string;
  player: string;
  image: string;
  text: string;
}
export interface Vote {
  caption: string;
  random: boolean;
}
export interface Result {
  player: string;
  votes: number;
  points: number;
  unanimous: boolean;
  streak: number;
  winner: boolean;
}
export interface Room {
  id: string;
  code: string;
  version: number;
  host: string;
  phase: Phase;
  epoch: string;
  started: number;
  deadline: number | null;
  round: number;
  settings: { rounds: number; seconds: number; mode: "same" | "different" };
  players: Player[];
  electorate: string[];
  assignments: Record<string, string>;
  captions: Caption[];
  votes: Record<string, Vote>;
  order: string[];
  index: number;
  gags: { player: string; kind: "pin" | "grave" }[];
  results: Result[];
  used: string[];
  previous: string[];
  pool: string[];
  seenImages: Record<string, string[]>;
  failed: string[];
  best: { caption: Caption; votes: number }[];
  vanishedAcknowledged: boolean;
}
export type Action = {
  type: string;
  epoch?: string;
  name?: string;
  color?: string;
  target?: string;
  text?: string;
  image?: string;
  settings?: Room["settings"];
};
export const visibleLength = (s: string) =>
  [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(s)]
    .length;
export function requireThat(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}
export function nameValid(name: string) {
  const n = name.trim();
  requireThat(visibleLength(n) > 0 && visibleLength(n) <= 14, COPY.errors.name);
  return n;
}
export function captionValid(text: string) {
  const t = text.trim();
  requireThat(
    visibleLength(t) >= CAPTION_MIN && t.length <= CAPTION_MAX,
    COPY.errors.caption,
  );
  return t;
}
export function settingsValid(s: Room["settings"]) {
  requireThat(
    Number.isInteger(s.rounds) &&
      s.rounds >= 1 &&
      s.rounds <= 15 &&
      Number.isInteger(s.seconds) &&
      s.seconds >= 10 &&
      s.seconds <= 60 &&
      ["same", "different"].includes(s.mode),
    COPY.errors.settings,
  );
  return s;
}
export function shuffle<T>(input: T[], random = Math.random): T[] {
  const a = [...input];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
export const connected = (p: Player, now: number) => now - p.seen < 25000;
export function phase(r: Room, p: Phase, now: number, seconds?: number) {
  r.phase = p;
  r.epoch = crypto.randomUUID();
  r.started = now;
  r.deadline = seconds === undefined ? null : now + seconds * 1000;
  r.index = 0;
}
export function newRoom(code: string, now: number): Room {
  return {
    id: crypto.randomUUID(),
    code,
    version: 0,
    host: "",
    phase: "lobby",
    epoch: crypto.randomUUID(),
    started: now,
    deadline: null,
    round: 0,
    settings: { rounds: 5, seconds: 20, mode: "same" },
    players: [],
    electorate: [],
    assignments: {},
    captions: [],
    votes: {},
    order: [],
    index: 0,
    gags: [],
    results: [],
    used: [],
    previous: [],
    pool: [],
    seenImages: {},
    failed: [],
    best: [],
    vanishedAcknowledged: false,
  };
}
export function join(
  r: Room,
  name: string,
  secret: string,
  connection: string,
  now: number,
) {
  requireThat(r.players.length < 12, COPY.errors.full);
  const n = nameValid(name);
  requireThat(
    !r.players.some(
      (p) => p.name.toLocaleLowerCase() === n.toLocaleLowerCase(),
    ),
    COPY.errors.duplicateName,
  );
  const p: Player = {
    id: crypto.randomUUID(),
    secret,
    connection,
    seen: now,
    joined: now,
    name: n,
    color:
      COLORS.find((c) => !r.players.some((p) => p.color === c)) ?? COLORS[0],
    score: 0,
    streak: 0,
    pending: r.phase !== "lobby",
    stats: { pins: 0, deaths: 0, votes: 0, longest: 0, robbed: 0 },
  };
  r.players.push(p);
  r.host ||= p.id;
  return p;
}
export function drawImage(r: Room, player: string, library: string[]) {
  const valid = library.filter((x) => !r.failed.includes(x));
  if (!valid.length) return "";
  if (!r.pool.length) r.pool = shuffle(valid);
  r.pool = r.pool.filter((x) => valid.includes(x));
  if (!r.pool.length) r.pool = shuffle(valid);
  const seen = r.seenImages[player] ?? [];
  const assigned = Object.values(r.assignments);
  // Across pool boundaries, keep this round distinct whenever alternatives remain.
  const available = (x: string) => !assigned.includes(x);
  let i = r.pool.findIndex(
    (x) => available(x) && !seen.includes(x) && !r.previous.includes(x),
  );
  if (i < 0) i = r.pool.findIndex((x) => available(x) && !seen.includes(x));
  if (i < 0) i = r.pool.findIndex((x) => available(x) && x !== seen.at(-1));
  if (i < 0) i = r.pool.findIndex(available);
  if (i < 0) i = r.pool.findIndex((x) => x !== seen.at(-1));
  if (i < 0) i = 0;
  const [img] = r.pool.splice(i, 1);
  r.used.push(img);
  (r.seenImages[player] ??= []).push(img);
  return img;
}
function roundStart(r: Room, now: number, library: string[]) {
  r.round++;
  r.electorate = r.players.filter((p) => connected(p, now)).map((p) => p.id);
  r.players.forEach((p) => {
    if (r.electorate.includes(p.id)) p.pending = false;
  });
  r.assignments = {};
  r.captions = [];
  r.votes = {};
  r.results = [];
  r.gags = [];
  r.order = [];
  r.vanishedAcknowledged = false;
  let shared = "";
  for (const id of r.electorate) {
    if (r.settings.mode === "same") {
      shared ||= drawImage(r, id, library);
      r.assignments[id] = shared;
    } else r.assignments[id] = drawImage(r, id, library);
  }
  phase(r, "round_intro", now, 2);
}
function closeCaptions(r: Room, now: number) {
  r.gags = r.electorate
    .filter((id) => !r.captions.some((c) => c.player === id))
    .map((id) => ({
      player: id,
      kind: connected(
        r.players.find((p) => p.id === id)!,
        now,
      )
        ? "pin"
        : "grave",
    }));
  for (const gag of r.gags) {
    const p = r.players.find((p) => p.id === gag.player)!;
    p.stats[gag.kind === "pin" ? "pins" : "deaths"]++;
  }
  r.order = shuffle(r.captions.map((c) => c.id));
  if (r.gags.length) phase(r, "caption_resolution", now, 2.5);
  else beginSlideshow(r, now);
}
function beginSlideshow(r: Room, now: number) {
  if (r.captions.length) phase(r, "slideshow", now);
  else score(r, now);
}
function beginVoting(r: Room, now: number) {
  if (r.captions.length <= 1) score(r, now);
  else phase(r, "voting", now, 30);
}
export function fillVotes(r: Room) {
  for (const id of r.electorate) {
    if (r.votes[id]) continue;
    const options = r.captions.filter((c) => c.player !== id);
    if (options.length)
      r.votes[id] = {
        caption: options[Math.floor(Math.random() * options.length)].id,
        random: true,
      };
  }
}
export function score(r: Room, now: number) {
  if (r.captions.length > 1) fillVotes(r);
  const counts = r.captions.map((c) => ({
    c,
    count:
      r.captions.length === 1
        ? r.electorate.filter((id) => id !== c.player).length
        : Object.values(r.votes).filter((v) => v.caption === c.id).length,
  }));
  const max = Math.max(0, ...counts.map((x) => x.count));
  r.results = r.players.map((p) => {
    const item = counts.find((x) => x.c.player === p.id);
    const count = item?.count ?? 0;
    const winner =
      !!item && count === max && (max > 0 || r.captions.length === 1);
    const eligible = r.electorate.filter((id) => id !== item?.c.player);
    const unanimous =
      !!item &&
      r.captions.length > 1 &&
      eligible.length > 0 &&
      eligible.every(
        (id) => r.votes[id]?.caption === item.c.id && !r.votes[id].random,
      );
    p.streak = winner ? p.streak + 1 : 0;
    const points = Math.round(
      count * 25 * (unanimous ? 1.5 : 1) * (winner && p.streak > 1 ? 1.1 : 1),
    );
    p.score += points;
    p.stats.votes += count;
    p.stats.longest = Math.max(p.stats.longest, p.streak);
    if (
      !winner &&
      count > 0 &&
      count ===
        Math.max(0, ...counts.filter((x) => x.count < max).map((x) => x.count))
    )
      p.stats.robbed++;
    return {
      player: p.id,
      votes: count,
      points,
      unanimous,
      streak: p.streak,
      winner,
    };
  });
  for (const item of counts) {
    const best = r.best[0]?.votes ?? -1;
    if (item.count > best) r.best = [];
    if (item.count >= best && item.count > 0)
      r.best.push({ caption: item.c, votes: item.count });
  }
  phase(r, "vote_reveal", now, Math.max(3, r.electorate.length * 0.35 + 1));
}
function reset(r: Room) {
  r.players.forEach((p) => {
    p.score = 0;
    p.streak = 0;
    p.pending = false;
    p.stats = { pins: 0, deaths: 0, votes: 0, longest: 0, robbed: 0 };
  });
  r.previous = [...new Set(r.used)];
  r.used = [];
  r.pool = [];
  r.failed = [];
  r.seenImages = {};
  r.round = 0;
  r.best = [];
  r.captions = [];
  r.votes = {};
  r.results = [];
  r.electorate = [];
  r.gags = [];
  r.assignments = {};
}
export function advance(r: Room, now: number, library: string[], skip = false) {
  switch (r.phase) {
    case "starting":
      roundStart(r, now, library);
      break;
    case "round_intro":
      phase(r, "image_reveal", now, 1);
      break;
    case "image_reveal":
      phase(r, "captioning", now, r.settings.seconds);
      break;
    case "captioning":
      closeCaptions(r, now);
      break;
    case "caption_resolution":
      if (!skip && r.index + 1 < r.gags.length) {
        r.index++;
        r.deadline = now + 2500;
      } else beginSlideshow(r, now);
      break;
    case "slideshow":
      if (!skip && r.index + 1 < r.order.length) {
        r.index++;
        r.started = now;
        r.epoch = crypto.randomUUID();
      } else beginVoting(r, now);
      break;
    case "voting":
      score(r, now);
      break;
    case "vote_reveal":
      phase(r, "round_winner", now, 3.5);
      break;
    case "round_winner":
      phase(r, "round_leaderboard", now);
      break;
    case "round_leaderboard":
      if (r.round >= r.settings.rounds) phase(r, "final_podium", now, 10);
      else roundStart(r, now, library);
      break;
    case "final_podium":
      phase(r, "final_awards", now);
      break;
    case "final_awards":
      phase(r, "game_over", now);
      break;
  }
}
export function tick(r: Room, now: number, library: string[]) {
  const online = r.players.filter((p) => connected(p, now));
  if (!online.some((p) => p.id === r.host) && online.length)
    r.host = online.sort(
      (a, b) => a.joined - b.joined || a.id.localeCompare(b.id),
    )[0].id;
  if (
    r.phase !== "lobby" &&
    r.electorate.length >= 2 &&
    online.length === 1 &&
    online[0].id === r.host
  ) {
    reset(r);
    phase(r, "lobby", now);
    return;
  }
  if (r.deadline !== null && now >= r.deadline) advance(r, now, library);
}
export function act(
  r: Room,
  p: Player,
  a: Action,
  now: number,
  library: string[],
) {
  const host = p.id === r.host;
  if (a.type === "heartbeat") return;
  if (a.type === "leave") {
    p.seen = 0;
    p.connection = "";
    return;
  }
  if (a.type === "rename") {
    requireThat(r.phase === "lobby", COPY.errors.nameLocked);
    const n = nameValid(a.name ?? "");
    requireThat(
      !r.players.some(
        (q) => q.id !== p.id && q.name.toLowerCase() === n.toLowerCase(),
      ),
      COPY.errors.duplicateName,
    );
    p.name = n;
    return;
  }
  if (a.type === "color") {
    requireThat(
      r.phase === "lobby" && COLORS.includes(a.color ?? ""),
      COPY.errors.color,
    );
    p.color = a.color!;
    return;
  }
  if (a.type === "kick") {
    requireThat(
      host && r.phase === "lobby" && a.target !== p.id,
      COPY.errors.kick,
    );
    r.players = r.players.filter((q) => q.id !== a.target);
    return;
  }
  if (a.type === "settings") {
    requireThat(host && r.phase === "lobby", COPY.errors.settingsHost);
    r.settings = settingsValid(a.settings!);
    return;
  }
  if (
    ["start", "rematch", "lobby", "continue", "skip", "end", "keep"].includes(
      a.type,
    )
  ) {
    requireThat(host, COPY.errors.host);
    requireThat(a.epoch === r.epoch, COPY.errors.phase);
    if (a.type === "start" || a.type === "rematch") {
      requireThat(
        a.type === "start" ? r.phase === "lobby" : r.phase === "game_over",
        COPY.errors.wait,
      );
      requireThat(
        r.players.filter((q) => connected(q, now)).length >= 4,
        COPY.errors.minimum,
      );
      requireThat(library.length > 0, COPY.errors.images);
      reset(r);
      phase(r, "starting", now, 5);
    } else if (a.type === "lobby") {
      requireThat(r.phase === "game_over", COPY.errors.finish);
      reset(r);
      phase(r, "lobby", now);
    } else if (a.type === "end" || a.type === "keep") {
      requireThat(
        r.electorate.length > 0 &&
          r.electorate.filter(
            (id) =>
              !connected(
                r.players.find((q) => q.id === id)!,
                now,
              ),
          ).length >=
            r.electorate.length / 2,
        COPY.errors.alive,
      );
      if (a.type === "end") {
        reset(r);
        phase(r, "lobby", now);
      } else r.vanishedAcknowledged = true;
    } else {
      requireThat(
        r.phase !== "lobby" && r.phase !== "game_over",
        COPY.errors.skip,
      );
      if (a.type === "continue")
        requireThat(
          ["slideshow", "round_leaderboard", "final_awards"].includes(
            r.phase,
          ) && now - r.started >= 1500,
          COPY.errors.breathe,
        );
      advance(r, now, library, a.type === "skip");
    }
    return;
  }
  if (a.type === "image_failed") {
    requireThat(
      Object.values(r.assignments).includes(a.image ?? "") ||
        r.captions.some((c) => c.image === a.image),
      COPY.errors.image,
    );
    if (!r.failed.includes(a.image!)) r.failed.push(a.image!);
    const replacement = drawImage(r, p.id, library);
    for (const id of Object.keys(r.assignments))
      if (r.assignments[id] === a.image) r.assignments[id] = replacement;
    for (const c of r.captions) if (c.image === a.image) c.image = replacement;
    return;
  }
  requireThat(!p.pending && r.electorate.includes(p.id), COPY.errors.pending);
  requireThat(a.epoch === r.epoch, COPY.errors.phase);
  if (a.type === "caption") {
    requireThat(r.phase === "captioning", COPY.errors.captionClosed);
    const text = captionValid(a.text ?? "");
    const old = r.captions.find((c) => c.player === p.id);
    if (old) old.text = text;
    else
      r.captions.push({
        id: crypto.randomUUID(),
        player: p.id,
        image: r.assignments[p.id],
        text,
      });
    if (r.electorate.every((id) => r.captions.some((c) => c.player === id)))
      closeCaptions(r, now);
    return;
  }
  if (a.type === "vote") {
    requireThat(r.phase === "voting", COPY.errors.votingClosed);
    const c = r.captions.find((c) => c.id === a.target);
    requireThat(c && c.player !== p.id, COPY.errors.selfVote);
    r.votes[p.id] = { caption: c.id, random: false };
    if (
      r.electorate.every(
        (id) =>
          !r.captions.some((c) => c.player !== id) ||
          r.captions.some(
            (c) => c.id === r.votes[id]?.caption && c.player !== id,
          ),
      )
    )
      score(r, now);
    return;
  }
  throw new Error(COPY.errors.unknown);
}
export function view(r: Room, id: string, now: number) {
  const p = r.players.find((p) => p.id === id)!;
  const reveal = [
    "round_winner",
    "round_leaderboard",
    "final_podium",
    "final_awards",
    "game_over",
  ].includes(r.phase);
  const show = [
    "slideshow",
    "voting",
    "vote_reveal",
    ...(reveal ? [r.phase] : []),
  ].includes(r.phase);
  return {
    id: r.id,
    code: r.code,
    version: r.version,
    phase: r.phase,
    epoch: r.epoch,
    started: r.started,
    deadline: r.deadline,
    round: r.round,
    settings: r.settings,
    host: r.host,
    me: id,
    serverTime: now,
    players: r.players.map(
      ({
        id,
        name,
        color,
        score,
        streak,
        pending,
        stats,
        ...privateFields
      }) => ({
        id,
        name,
        color,
        score: reveal ? score : 0,
        streak: reveal ? streak : 0,
        pending,
        stats: reveal
          ? stats
          : { pins: 0, deaths: 0, votes: 0, longest: 0, robbed: 0 },
        online: connected(privateFields as Player, now),
      }),
    ),
    image: r.assignments[id] ?? "",
    ownCaption: r.captions.find((c) => c.player === id)?.text ?? "",
    ownVote: r.votes[id]?.caption ?? "",
    submitted: r.captions.length,
    eligible: r.electorate.length,
    captions: show
      ? r.order
          .map((cid) => r.captions.find((c) => c.id === cid)!)
          .filter(Boolean)
          .map((c) => ({
            id: c.id,
            text: c.text,
            image: c.image,
            own: c.player === id,
            author: reveal ? c.player : undefined,
            count:
              r.phase === "vote_reveal" || reveal
                ? r.results.find((x) => x.player === c.player)?.votes
                : undefined,
          }))
      : [],
    index: r.index,
    gag: r.gags[r.index],
    results: reveal ? r.results : [],
    best: reveal ? r.best : [],
    pending: p.pending,
    halfGone:
      r.phase !== "lobby" &&
      !r.vanishedAcknowledged &&
      r.electorate.length > 0 &&
      r.electorate.filter(
        (id) =>
          !connected(
            r.players.find((p) => p.id === id)!,
            now,
          ),
      ).length >=
        r.electorate.length / 2,
  };
}
export type GameView = ReturnType<typeof view>;

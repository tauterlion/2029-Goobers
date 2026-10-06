import { COPY } from "./copy";
import { CAPTION_MIN, CAPTION_MAX } from "./caption";
import { activeImages, defaultDeck, Deck } from "./deck";
import { PODIUM } from "./timing";
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
  disconnectedAt?: number;
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
  departed?: Player[];
  gameId?: string;
  deck?: Deck;
  recentGames?: string[][];
  archivedGameId?: string;
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
  deck?: Deck;
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
export const CONNECTION_LEASE = 25000;
export const DISCONNECT_GRACE = 20000;
export const connected = (p: Player | undefined, now: number) =>
  !!p &&
  p.disconnectedAt === undefined &&
  p.seen > 0 &&
  now - p.seen < CONNECTION_LEASE;
const participants = (r: Room) => [...r.players, ...(r.departed ?? [])];
export function removalDue(p: Player, now: number) {
  return (
    !connected(p, now) &&
    now - (p.disconnectedAt ?? p.seen + CONNECTION_LEASE) >= DISCONNECT_GRACE
  );
}
export function reconcilePresence(r: Room, now: number) {
  for (const p of r.players) {
    if (!connected(p, now)) p.disconnectedAt ??= p.seen + CONNECTION_LEASE;
  }
  const removed = r.players.filter((p) => removalDue(p, now));
  r.players = r.players.filter((p) => !removed.includes(p));
  // Keep game evidence without a live membership or reusable session credentials.
  if (r.phase !== "lobby")
    for (const p of removed)
      (r.departed ??= []).push({ ...p, secret: "", connection: "" });
  const online = r.players.filter((p) => connected(p, now));
  if (!online.some((p) => p.id === r.host) && online.length)
    r.host = online.sort(
      (a, b) => a.joined - b.joined || a.id.localeCompare(b.id),
    )[0].id;
  else if (!r.players.some((p) => p.id === r.host) && !online.length)
    r.host = "";
}
export function normalizeLibrary(r: Room, library: string[]) {
  const valid = new Set(library),
    prune = (images: string[]) => images.filter((x) => valid.has(x));
  if (r.deck) r.deck.images = prune(r.deck.images);
  if (r.recentGames) r.recentGames = r.recentGames.slice(0, 3).map(prune);
  r.previous = prune(r.previous);
  r.pool = prune(r.pool);
  r.failed = prune(r.failed);
  // Never rewrite current assignments, captions or completed result snapshots.
}
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
    gameId: crypto.randomUUID(),
    deck: defaultDeck(),
    recentGames: [],
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
  reconcilePresence(r, now);
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
  const valid = activeImages(library, r.deck).filter(
    (x) => !r.failed.includes(x),
  );
  if (!valid.length) return "";
  if (!r.pool.length) r.pool = shuffle(valid);
  r.pool = r.pool.filter((x) => valid.includes(x));
  if (!r.pool.length) r.pool = shuffle(valid);
  const seen = r.seenImages[player] ?? [];
  const assigned = Object.values(r.assignments);
  // Across pool boundaries, keep this round distinct whenever alternatives remain.
  const available = (x: string) => !assigned.includes(x);
  const history = r.recentGames ?? (r.previous.length ? [r.previous] : []);
  const recency = (image: string) => {
    const at = history.findIndex((game) => game.includes(image));
    return at < 0 ? 0 : history.length - at;
  };
  // Pool consumption prevents repeats within a cycle; rank candidates without
  // filtering any away permanently, so even a one-image deck always terminates.
  const rank = (image: string) => [
    available(image) ? 0 : 1,
    r.used.includes(image) ? 1 : 0,
    recency(image),
    image === r.used.at(-1) ? 1 : 0,
    seen.includes(image) ? 1 : 0,
    image === seen.at(-1) ? 1 : 0,
  ];
  let i = 0;
  for (let j = 1; j < r.pool.length; j++) {
    const a = rank(r.pool[j]),
      b = rank(r.pool[i]);
    for (let k = 0; k < a.length; k++) {
      if (a[k] !== b[k]) {
        if (a[k] < b[k]) i = j;
        break;
      }
    }
  }
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
        r.players.find((p) => p.id === id),
        now,
      )
        ? "pin"
        : "grave",
    }));
  for (const gag of r.gags) {
    const p = participants(r).find((p) => p.id === gag.player);
    if (p) p.stats[gag.kind === "pin" ? "pins" : "deaths"]++;
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
  r.results = participants(r).map((p) => {
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
  r.departed = [];
  r.players.forEach((p) => {
    p.score = 0;
    p.streak = 0;
    p.pending = false;
    p.stats = { pins: 0, deaths: 0, votes: 0, longest: 0, robbed: 0 };
  });
  // Current-game data resets; completed-game history and deck stay room-wide.
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
      if (r.round >= r.settings.rounds) {
        completeGame(r);
        phase(r, "final_podium", now, PODIUM.duration / 1000);
      } else roundStart(r, now, library);
      break;
    case "final_podium":
      phase(r, "final_awards", now);
      break;
    case "final_awards":
      phase(r, "game_over", now);
      break;
  }
}
export function completeGame(r: Room) {
  const id = r.gameId ?? r.epoch;
  if (r.archivedGameId === id) return;
  r.recentGames = [
    [...new Set(r.used)],
    ...(r.recentGames ?? (r.previous.length ? [r.previous] : [])),
  ].slice(0, 3);
  r.previous = r.recentGames[0];
  r.archivedGameId = id;
}
export function tick(r: Room, now: number, library: string[]) {
  normalizeLibrary(r, library);
  reconcilePresence(r, now);
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
  if (a.type === "deck") {
    requireThat(host && r.phase === "lobby", COPY.errors.deckHost);
    requireThat(
      a.deck &&
        ["all", "blacklist", "whitelist"].includes(a.deck.mode) &&
        Array.isArray(a.deck.images) &&
        a.deck.images.every((image) => library.includes(image)),
      COPY.errors.deckInvalid,
    );
    r.deck = { mode: a.deck.mode, images: [...new Set(a.deck.images)] };
    r.pool = [];
    return;
  }
  if (a.type === "heartbeat") return;
  if (a.type === "leave") {
    p.disconnectedAt = now;
    p.seen = 0;
    p.connection = "";
    reconcilePresence(r, now);
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
      requireThat(
        activeImages(library, r.deck).length > 0,
        COPY.errors.emptyDeck,
      );
      reset(r);
      r.gameId = crypto.randomUUID();
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
    // Backward compatibility for old clients: acknowledge without altering the
    // authoritative source. One browser's network failure is not a new draw.
    if (process.env.NODE_ENV === "development")
      console.warn("Assigned image failed to load:", a.image);
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
export function view(r: Room, id: string, now: number, library: string[] = []) {
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
  const publicPlayer = ({
    id,
    name,
    color,
    score,
    streak,
    pending,
    stats,
    ...privateFields
  }: Player) => ({
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
    removed: !r.players.some((p) => p.id === id),
  });
  return {
    participants: participants(r).map(publicPlayer),
    // Wake active browsers at the next lease/grace boundary instead of waiting
    // up to another heartbeat interval. Empty rooms resume on their next visit.
    presenceDeadline: r.players.reduce<number | null>((next, p) => {
      const due =
        (p.disconnectedAt ?? p.seen + CONNECTION_LEASE) +
        (connected(p, now) ? 0 : DISCONNECT_GRACE);
      return next === null ? due : Math.min(next, due);
    }, null),
    id: r.id,
    gameId: r.gameId ?? r.epoch,
    deck: r.deck ?? defaultDeck(),
    activeImageCount: activeImages(library, r.deck).length,
    imageCount: library.length,
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

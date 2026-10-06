import { describe, it, expect } from "vitest";
import {
  act,
  advance,
  captionValid,
  completeGame,
  drawImage,
  fillVotes,
  join,
  nameValid,
  newRoom,
  phase,
  score,
  settingsValid,
  shuffle,
  tick,
  view,
} from "./engine";
const time = 1_000_000;
const library = Array.from({ length: 100 }, (_, i) => `/image-${i}.jpg`);
function setup(n = 4) {
  const r = newRoom("ABCDE", time);
  for (let i = 0; i < n; i++)
    join(r, `Player ${i}`, `secret-${i}`, `conn-${i}`, time + i);
  r.electorate = r.players.map((p) => p.id);
  return r;
}
function captions(r: ReturnType<typeof setup>, n = r.players.length) {
  r.captions = r.players.slice(0, n).map((p, i) => ({
    id: `caption${i}`,
    player: p.id,
    text: `Caption ${i}`,
    image: library[i],
  }));
  r.order = r.captions.map((c) => c.id);
}
describe("room and identity", () => {
  it("requires names and rejects case-insensitive duplicates", () => {
    const r = setup();
    expect(() => join(r, " player 0 ", "s", "c", time)).toThrow();
    expect(() => nameValid(" ")).toThrow();
    expect(nameValid(" 👨‍👩‍👧‍👦 ")).toBe("👨‍👩‍👧‍👦");
    expect(() => nameValid("x".repeat(15))).toThrow();
  });
  it("caps at twelve and requires four online to start", () => {
    const r = setup(12);
    expect(() => join(r, "Extra", "s", "c", time)).toThrow();
    const small = setup(3);
    expect(() =>
      act(
        small,
        small.players[0],
        { type: "start", epoch: small.epoch },
        time,
        library,
      ),
    ).toThrow();
  });
  it("validates round count and timer", () => {
    for (const rounds of [0, 16, 1.5])
      expect(() =>
        settingsValid({ rounds, seconds: 20, mode: "same" }),
      ).toThrow();
    expect(
      settingsValid({ rounds: 15, seconds: 60, mode: "different" }).rounds,
    ).toBe(15);
  });
  it("kicks only in lobby and permits rejoining", () => {
    const r = setup();
    const p = r.players[1];
    act(r, r.players[0], { type: "kick", target: p.id }, time, library);
    expect(r.players).toHaveLength(3);
    join(r, p.name, p.secret, p.connection, time);
    expect(r.players).toHaveLength(4);
  });
  it("moves host deterministically and never takes it back", () => {
    const r = setup();
    const original = r.host;
    r.players[0].seen = 0;
    r.players[0].disconnectedAt = time;
    tick(r, time, library);
    expect(r.host).toBe(r.players[1].id);
    r.players[0].seen = time;
    delete r.players[0].disconnectedAt;
    tick(r, time, library);
    expect(r.host).not.toBe(original);
  });
  it("freezes electorate and activates late joins next round", () => {
    const r = setup();
    phase(r, "captioning", time, 20);
    const late = join(r, "Late", "s", "c", time);
    expect(late.pending).toBe(true);
    expect(r.electorate).not.toContain(late.id);
    expect(() =>
      act(
        r,
        late,
        { type: "caption", text: "hello", epoch: r.epoch },
        time,
        library,
      ),
    ).toThrow();
    phase(r, "round_leaderboard", time);
    advance(r, time, library);
    expect(late.pending).toBe(false);
    expect(r.electorate).toContain(late.id);
  });
  it("guards double advancement and resets rematch state", () => {
    const r = setup();
    const epoch = r.epoch;
    act(r, r.players[0], { type: "start", epoch }, time, library);
    expect(() =>
      act(r, r.players[0], { type: "start", epoch }, time, library),
    ).toThrow();
    r.players[0].score = 500;
    r.used = ["x"];
    completeGame(r);
    phase(r, "game_over", time);
    act(r, r.players[0], { type: "rematch", epoch: r.epoch }, time, library);
    expect(r.players[0].score).toBe(0);
    expect(r.previous).toEqual(["x"]);
    expect(r.phase).toBe("starting");
  });
});
describe("images", () => {
  it("Fisher–Yates preserves inputs and produces a permutation", () => {
    const input = [1, 2, 3, 4];
    const out = shuffle(input, () => 0);
    expect(out).not.toEqual(input);
    expect(out.toSorted()).toEqual(input);
    expect(input).toEqual([1, 2, 3, 4]);
  });
  it("uses the full pool before repeating and exhausts gracefully", () => {
    const r = setup();
    const picks = Array.from({ length: 100 }, () =>
      drawImage(r, r.players[0].id, library),
    );
    expect(new Set(picks).size).toBe(100);
    expect(drawImage(r, r.players[0].id, library)).not.toBe(picks.at(-1));
    expect(drawImage(r, "p", ["only"])).toBe("only");
    expect(drawImage(r, "p", [])).toBe("");
  });
  it("avoids the previous game while fresh images exist", () => {
    const r = setup();
    r.previous = library.slice(0, 90);
    r.recentGames = [r.previous];
    expect(
      Array.from({ length: 10 }, () => drawImage(r, "p", library)).some((x) =>
        r.previous.includes(x),
      ),
    ).toBe(false);
  });
  it("assigns same and different images", () => {
    for (const mode of ["same", "different"] as const) {
      const r = setup();
      r.settings.mode = mode;
      phase(r, "starting", time);
      advance(r, time, library);
      expect(new Set(Object.values(r.assignments)).size).toBe(
        mode === "same" ? 1 : 4,
      );
    }
  });
  it("preserves a broken shared assignment without drawing a replacement", () => {
    const r = setup();
    r.assignments = Object.fromEntries(
      r.electorate.map((id) => [id, library[0]]),
    );
    act(
      r,
      r.players[0],
      { type: "image_failed", image: library[0] },
      time,
      library,
    );
    expect(new Set(Object.values(r.assignments)).size).toBe(1);
    expect(Object.values(r.assignments).every((x) => x === library[0])).toBe(
      true,
    );
    expect(r.used).toEqual([]);
  });
});
describe("captions and recovery", () => {
  it("checks grapheme length and supports emoji", () => {
    expect(() => captionValid("ab")).toThrow();
    expect(() => captionValid("x".repeat(161))).toThrow();
    expect(captionValid("😀😎🔥")).toBe("😀😎🔥");
    expect(captionValid("x".repeat(159))).toHaveLength(159);
    expect(captionValid("x".repeat(160))).toHaveLength(160);
    expect(captionValid("😀".repeat(80))).toHaveLength(160);
    expect(() => captionValid("😀".repeat(81))).toThrow();
  });
  it("updates one submission and closes on all submitted", () => {
    const r = setup();
    phase(r, "captioning", time, 20);
    const epoch = r.epoch;
    act(
      r,
      r.players[0],
      { type: "caption", text: "first", epoch },
      time,
      library,
    );
    act(
      r,
      r.players[0],
      { type: "caption", text: "second", epoch },
      time,
      library,
    );
    expect(r.captions).toHaveLength(1);
    expect(view(r, r.players[0].id, time).ownCaption).toBe("second");
    for (const p of r.players.slice(1))
      act(r, p, { type: "caption", text: "caption", epoch }, time, library);
    expect(r.phase).toBe("slideshow");
  });
  it("distinguishes missing and disconnected while preserving submitted captions", () => {
    const r = setup();
    captions(r, 1);
    r.players[1].seen = 0;
    phase(r, "captioning", time, 20);
    advance(r, time + 20000, library);
    expect(r.gags.find((g) => g.player === r.players[1].id)?.kind).toBe(
      "grave",
    );
    expect(r.gags.find((g) => g.player === r.players[2].id)?.kind).toBe("pin");
    expect(r.gags.some((g) => g.player === r.players[0].id)).toBe(false);
  });
  it("hides secrets, authors and other submissions before slideshow", () => {
    const r = setup();
    captions(r);
    phase(r, "captioning", time);
    const v = view(r, r.players[0].id, time);
    expect(v.captions).toHaveLength(0);
    expect(JSON.stringify(v)).not.toContain("secret-");
    phase(r, "voting", time);
    expect(
      view(r, r.players[0].id, time).captions.every(
        (c) => c.author === undefined,
      ),
    ).toBe(true);
  });
});
describe("voting and scoring", () => {
  it("rejects self votes and replaces rather than duplicates a vote", () => {
    const r = setup();
    captions(r);
    phase(r, "voting", time, 30);
    expect(() =>
      act(
        r,
        r.players[0],
        { type: "vote", target: "caption0", epoch: r.epoch },
        time,
        library,
      ),
    ).toThrow();
    for (const target of ["caption1", "caption2"])
      act(
        r,
        r.players[0],
        { type: "vote", target, epoch: r.epoch },
        time,
        library,
      );
    expect(Object.keys(r.votes)).toHaveLength(1);
    expect(r.votes[r.players[0].id].caption).toBe("caption2");
  });
  it("randomizes missed votes without self targets or duplicates", () => {
    const r = setup();
    captions(r);
    fillVotes(r);
    fillVotes(r);
    expect(Object.keys(r.votes)).toHaveLength(4);
    for (const [id, v] of Object.entries(r.votes)) {
      expect(r.captions.find((c) => c.id === v.caption)?.player).not.toBe(id);
      expect(v.random).toBe(true);
    }
  });
  it("applies unanimous then streak and rounds once", () => {
    const r = setup(5);
    captions(r);
    r.players[0].streak = 1;
    for (const p of r.players.slice(1))
      r.votes[p.id] = { caption: "caption0", random: false };
    r.votes[r.players[0].id] = { caption: "caption1", random: false };
    score(r, time);
    expect(r.results[0]).toMatchObject({
      votes: 4,
      points: 165,
      unanimous: true,
      streak: 2,
      winner: true,
    });
  });
  it("randomized votes disqualify unanimous", () => {
    const r = setup();
    captions(r);
    for (const p of r.players.slice(1))
      r.votes[p.id] = { caption: "caption0", random: p === r.players[1] };
    r.votes[r.players[0].id] = { caption: "caption1", random: false };
    score(r, time);
    expect(r.results[0]).toMatchObject({ points: 75, unanimous: false });
  });
  it("ties count as wins and non-winners reset streak", () => {
    const r = setup();
    captions(r);
    r.players.forEach((p) => (p.streak = 1));
    r.players.forEach(
      (p, i) =>
        (r.votes[p.id] = {
          caption: i < 2 ? "caption2" : "caption0",
          random: false,
        }),
    );
    score(r, time);
    expect(r.results.filter((x) => x.winner)).toHaveLength(2);
    expect(r.results[0].points).toBe(55);
    expect(r.results[2].streak).toBe(2);
    expect(r.results[1].streak).toBe(0);
  });
  it("one caption earns eligible points with no unanimous or fake votes", () => {
    const r = setup();
    captions(r, 1);
    score(r, time);
    expect(r.results[0]).toMatchObject({
      points: 75,
      unanimous: false,
      winner: true,
    });
    expect(r.votes).toEqual({});
  });
  it("zero captions awards no points and progresses", () => {
    const r = setup();
    score(r, time);
    expect(r.results.every((x) => x.points === 0 && !x.winner)).toBe(true);
    expect(r.phase).toBe("vote_reveal");
  });
  it("all votes ends early and nearest integer handles bonuses", () => {
    const r = setup();
    captions(r);
    r.players[0].streak = 1;
    phase(r, "voting", time, 30);
    const epoch = r.epoch;
    r.players.forEach((p, i) =>
      act(
        r,
        p,
        { type: "vote", target: i === 0 ? "caption1" : "caption0", epoch },
        time,
        library,
      ),
    );
    expect(r.phase).toBe("vote_reveal");
    expect(r.results[0].points).toBe(124);
  });
  it("only host remaining returns to lobby", () => {
    const r = setup();
    phase(r, "captioning", time, 20);
    r.players.slice(1).forEach((p) => (p.seen = 0));
    tick(r, time, library);
    expect(r.phase).toBe("lobby");
  });
  it("completes every phase through awards", () => {
    const r = setup();
    r.settings.rounds = 1;
    phase(r, "starting", time);
    advance(r, time, library);
    advance(r, time, library);
    advance(r, time, library);
    captions(r);
    advance(r, time, library);
    expect(r.phase).toBe("slideshow");
    advance(r, time, library, true);
    expect(r.phase).toBe("voting");
    advance(r, time, library);
    advance(r, time, library);
    advance(r, time, library);
    expect(r.phase).toBe("round_leaderboard");
    advance(r, time, library);
    expect(r.phase).toBe("final_podium");
    advance(r, time, library);
    advance(r, time, library);
    expect(r.phase).toBe("game_over");
  });
});

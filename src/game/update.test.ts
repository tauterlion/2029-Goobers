import { describe, it, expect } from "vitest";
import { act, join, newRoom, phase, score, tick } from "./engine";
import { truncateCaption } from "./caption";
function setup() {
  const r = newRoom("ABCDE", 100000);
  for (let i = 0; i < 4; i++) join(r, `P${i}`, `s${i}`, `c${i}`, 100000 + i);
  r.electorate = r.players.map((p) => p.id);
  r.captions = r.players.map((p, i) => ({
    id: `c${i}`,
    player: p.id,
    image: "img",
    text: "caption",
  }));
  phase(r, "voting", 100000, 30);
  return r;
}
describe("caption input limit", () => {
  it("truncates paste to 100 without splitting emoji", () => {
    expect(truncateCaption("x".repeat(101))).toBe("x".repeat(100));
    expect(truncateCaption("x".repeat(99) + "😀")).toBe("x".repeat(99));
    expect(truncateCaption("😀".repeat(51))).toBe("😀".repeat(50));
    expect(truncateCaption("abc")).toBe("abc");
  });
});
describe("author-relative unanimous bonus", () => {
  it.each([false, true])(
    "excludes author even when their vote is random=%s",
    (random) => {
      const r = setup();
      r.players
        .slice(1)
        .forEach((p) => (r.votes[p.id] = { caption: "c0", random: false }));
      r.votes[r.players[0].id] = { caption: "c1", random };
      score(r, 100000);
      expect(r.results[0]).toMatchObject({
        unanimous: true,
        votes: 3,
        points: 113,
      });
    },
  );
  it("fails unanimity if another eligible voter chooses elsewhere", () => {
    const r = setup();
    r.players.forEach(
      (p, i) =>
        (r.votes[p.id] = {
          caption: i === 0 || i === 3 ? "c1" : "c0",
          random: false,
        }),
    );
    score(r, 100000);
    expect(r.results[0].unanimous).toBe(false);
  });
  it("requires every non-author vote to be manual", () => {
    const r = setup();
    r.players.forEach(
      (p, i) =>
        (r.votes[p.id] = { caption: i === 0 ? "c1" : "c0", random: i === 2 }),
    );
    score(r, 100000);
    expect(r.results[0]).toMatchObject({ unanimous: false, points: 75 });
  });
  it("stacks bonuses before rounding", () => {
    const r = setup();
    r.players[0].streak = 1;
    r.players.forEach(
      (p, i) =>
        (r.votes[p.id] = { caption: i === 0 ? "c1" : "c0", random: false }),
    );
    score(r, 100000);
    expect(r.results[0].points).toBe(Math.round(75 * 1.5 * 1.1));
  });
});
describe("authoritative early voting closure", () => {
  it("keeps the deadline until last required vote, then scores exactly once", () => {
    const r = setup(),
      epoch = r.epoch;
    for (const p of r.players.slice(1))
      act(r, p, { type: "vote", target: "c0", epoch }, 100010, []);
    expect(r.phase).toBe("voting");
    expect(r.deadline).toBe(130000);
    act(r, r.players[0], { type: "vote", target: "c1", epoch }, 100011, []);
    expect(r.phase).toBe("vote_reveal");
    expect(r.started).toBe(100011);
    expect(Object.values(r.votes).every((v) => !v.random)).toBe(true);
    const scores = r.players.map((p) => p.score);
    expect(() =>
      act(r, r.players[0], { type: "vote", target: "c2", epoch }, 100011, []),
    ).toThrow();
    tick(r, 100012, []);
    expect(r.players.map((p) => p.score)).toEqual(scores);
  });
  it("ignores mid-round joiners but includes disconnected frozen voters", () => {
    const r = setup();
    const epoch = r.epoch;
    const late = join(r, "Late", "late", "late", 100000);
    expect(() =>
      act(r, late, { type: "vote", target: "c0", epoch }, 100001, []),
    ).toThrow();
    r.players[3].seen = 0;
    for (const p of r.players.slice(0, 3))
      act(
        r,
        p,
        { type: "vote", target: p === r.players[0] ? "c1" : "c0", epoch },
        100005,
        [],
      );
    expect(r.phase).toBe("voting");
    r.players.slice(0, 3).forEach((p) => (p.seen = 129999));
    tick(r, 130000, []);
    expect(r.phase).toBe("vote_reveal");
    expect(r.votes[r.players[3].id].random).toBe(true);
    expect(r.votes[late.id]).toBeUndefined();
  });
  it("a pending joiner never prevents all manual votes closing early", () => {
    const r = setup(),
      epoch = r.epoch;
    join(r, "Late", "s", "c", 100000);
    r.players
      .slice(0, 4)
      .forEach((p, i) =>
        act(
          r,
          p,
          { type: "vote", target: i === 0 ? "c1" : "c0", epoch },
          100005,
          [],
        ),
      );
    expect(r.phase).toBe("vote_reveal");
    expect(Object.keys(r.votes)).toHaveLength(4);
  });
  it("an invalid stored vote cannot satisfy completion", () => {
    const r = setup(),
      epoch = r.epoch;
    r.votes[r.players[0].id] = { caption: "invalid", random: false };
    r.players
      .slice(1)
      .forEach((p) =>
        act(r, p, { type: "vote", target: "c0", epoch }, 100005, []),
      );
    expect(r.phase).toBe("voting");
  });
});

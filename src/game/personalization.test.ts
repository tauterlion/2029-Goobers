import { describe, it, expect } from "vitest";
import {
  act,
  advance,
  completeGame,
  drawImage,
  join,
  newRoom,
  phase,
  score,
  tick,
  view,
} from "./engine";
import { activeImages } from "./deck";
import { eventCopy, pickVariant, interpolate } from "./variants";
import { COPY } from "./copy";
const now = 1_000_000,
  library = ["a", "b", "c", "d", "e"];
function setup(n = 4) {
  const r = newRoom("ABCDE", now);
  for (let i = 0; i < n; i++) join(r, `P${i}`, `s${i}`, `c${i}`, now + i);
  r.electorate = r.players.map((p) => p.id);
  return r;
}
describe("shared flavor copy", () => {
  it("handles empty/single pools and preserves interpolation", () => {
    expect(pickVariant([], "seed")).toBe("");
    expect(pickVariant(["one"], "seed")).toBe("one");
    expect(interpolate("Waiting for [HOST]. [X]", { HOST: "Sam", X: 2 })).toBe(
      "Waiting for Sam. 2",
    );
  });
  it("is stable across clients, refreshes and non-event updates", () => {
    const r = setup();
    const client = JSON.parse(JSON.stringify(r));
    for (const pool of [
      COPY.shame.subtitle,
      COPY.grave.subtitle,
      COPY.results.winner,
      COPY.results.noWinner,
      COPY.results.unanimous,
      COPY.end.intro,
    ]) {
      const selected = eventCopy(pool, r, "event", "p");
      expect(pool).toContain(selected);
      expect(eventCopy(pool, client, "event", "p")).toBe(selected);
      expect(eventCopy(pool, { ...r, epoch: "changed" }, "event", "p")).toBe(
        selected,
      );
    }
  });
  it("varies over rounds, event types and players", () => {
    const r = setup();
    for (const field of ["round", "event", "player"]) {
      const results = Array.from({ length: 50 }, (_, i) =>
        eventCopy(
          COPY.shame.subtitle,
          { ...r, round: field === "round" ? i : r.round },
          field === "event" ? String(i) : "pin",
          field === "player" ? String(i) : "p",
        ),
      );
      expect(new Set(results).size).toBeGreaterThan(1);
    }
  });
});
describe("authoritative decks", () => {
  it("supports all three eligibility modes", () => {
    expect(activeImages(library)).toEqual(library);
    expect(activeImages(library, { mode: "blacklist", images: ["a"] })).toEqual(
      ["b", "c", "d", "e"],
    );
    expect(
      activeImages(library, { mode: "whitelist", images: ["b", "removed"] }),
    ).toEqual(["b"]);
  });
  it("limits editing to the current host in lobby and validates image paths", () => {
    const r = setup();
    const action = {
      type: "deck",
      deck: { mode: "whitelist" as const, images: ["a"] },
    };
    expect(() => act(r, r.players[1], action, now, library)).toThrow(
      COPY.errors.deckHost,
    );
    expect(() =>
      act(
        r,
        r.players[0],
        { ...action, deck: { mode: "all", images: ["foreign"] } },
        now,
        library,
      ),
    ).toThrow(COPY.errors.deckInvalid);
    act(r, r.players[0], action, now, library);
    r.players[0].seen = 0;
    r.players[0].disconnectedAt = now;
    tick(r, now, library);
    act(
      r,
      r.players[1],
      { ...action, deck: { mode: "blacklist", images: ["b"] } },
      now,
      library,
    );
    expect(r.deck).toEqual({ mode: "blacklist", images: ["b"] });
    phase(r, "captioning", now);
    expect(() => act(r, r.players[1], action, now, library)).toThrow(
      COPY.errors.deckHost,
    );
  });
  it("rejects empty decks but allows one-image games", () => {
    const r = setup();
    r.deck = { mode: "whitelist", images: [] };
    expect(() =>
      act(r, r.players[0], { type: "start", epoch: r.epoch }, now, library),
    ).toThrow(COPY.errors.emptyDeck);
    r.deck.images = ["a"];
    act(r, r.players[0], { type: "start", epoch: r.epoch }, now, library);
    advance(r, now, library);
    expect(Object.values(r.assignments)).toEqual(["a", "a", "a", "a"]);
  });
  it("obeys decks in both modes through exhaustion and broken-image fallback", () => {
    for (const mode of ["same", "different"] as const)
      for (const deck of [
        { mode: "whitelist" as const, images: ["a", "b"] },
        { mode: "blacklist" as const, images: ["c", "d", "e"] },
      ]) {
        const r = setup();
        r.deck = deck;
        r.settings.mode = mode;
        phase(r, "starting", now);
        advance(r, now, library);
        expect(
          Object.values(r.assignments).every((x) => ["a", "b"].includes(x)),
        ).toBe(true);
        for (let i = 0; i < 50; i++)
          expect(["a", "b"]).toContain(drawImage(r, "p", library));
        const broken = r.assignments[r.players[0].id];
        const before = { ...r.assignments };
        act(
          r,
          r.players[0],
          { type: "image_failed", image: broken },
          now,
          library,
        );
        expect(r.assignments).toEqual(before);
        r.failed = ["a", "b"];
        expect(drawImage(r, "p", library)).toBe("");
      }
  });
  it("preserves settings, deck and completed history across rematch and lobby", () => {
    const r = setup();
    r.deck = { mode: "blacklist", images: ["b"] };
    r.used = ["a", "a", "c"];
    completeGame(r);
    const gameId = r.gameId;
    phase(r, "game_over", now);
    act(r, r.players[0], { type: "rematch", epoch: r.epoch }, now, library);
    expect(r.gameId).not.toBe(gameId);
    expect(r.recentGames).toEqual([["a", "c"]]);
    expect(r.deck.images).toEqual(["b"]);
    phase(r, "game_over", now);
    act(r, r.players[0], { type: "lobby", epoch: r.epoch }, now, library);
    expect(r.recentGames).toEqual([["a", "c"]]);
    expect(r.deck.images).toEqual(["b"]);
    act(
      r,
      r.players[0],
      { type: "deck", deck: { mode: "whitelist", images: ["a"] } },
      now,
      library,
    );
    expect(r.recentGames).toEqual([["a", "c"]]);
  });
});
describe("three completed games of image memory", () => {
  it("archives once per game and drops fourth-oldest history", () => {
    const r = setup();
    for (const image of library) {
      r.gameId = image;
      r.used = [image, image];
      completeGame(r);
      completeGame(r);
    }
    expect(r.recentGames).toEqual([["e"], ["d"], ["c"]]);
  });
  it("prefers unseen then oldest history, current-game uniqueness first", () => {
    const r = setup();
    r.recentGames = [["a"], ["b"], ["c"]];
    const picks = Array.from({ length: 5 }, () => drawImage(r, "p", library));
    expect(new Set(picks.slice(0, 2))).toEqual(new Set(["d", "e"]));
    expect(picks.slice(2)).toEqual(["c", "b", "a"]);
    expect(new Set(picks).size).toBe(5);
  });
  it("uses the newest occurrence for images in several history entries", () => {
    const r = setup();
    r.recentGames = [["a"], ["b"], ["a", "c"]];
    expect(drawImage(r, "p", ["a", "b", "c"])).toBe("c");
  });
  it("does not archive aborted games and keeps assignments on read/reconnect", () => {
    const r = setup();
    r.recentGames = [["e"]];
    phase(r, "starting", now);
    advance(r, now, library);
    const assignments = { ...r.assignments };
    view(r, r.players[0].id, now, library);
    tick(r, now, library);
    expect(r.assignments).toEqual(assignments);
    r.players.slice(1).forEach((p) => (p.seen = 0));
    tick(r, now, library);
    expect(r.phase).toBe("lobby");
    expect(r.recentGames).toEqual([["e"]]);
  });
  it("avoids immediate repeats when alternatives exist", () => {
    const r = setup();
    for (let i = 0; i < 20; i++) {
      const last = r.used.at(-1);
      const next = drawImage(r, "p", ["a", "b"]);
      expect(next).not.toBe(last);
    }
  });
  it("reads legacy rooms without deck/game/history fields", () => {
    const r = setup();
    delete r.deck;
    delete r.gameId;
    delete r.recentGames;
    r.previous = ["a", "b", "c", "d"];
    expect(drawImage(r, "p", library)).toBe("e");
    expect(view(r, r.players[0].id, now, library).activeImageCount).toBe(5);
  });
});
describe("shared-first-place results", () => {
  for (const n of [2, 3, 4, 12])
    it(`scores ${n}-way ties equally and continues to leaderboard`, () => {
      const r = setup(Math.max(4, n));
      r.captions = r.players.slice(0, n).map((p, i) => ({
        id: `c${i}`,
        player: p.id,
        text: "caption",
        image: "a",
      }));
      r.electorate = r.players.slice(0, n).map((p) => p.id);
      r.players.forEach((p) => (p.streak = 1));
      r.electorate.forEach(
        (id, i) =>
          (r.votes[id] = { caption: `c${(i + 1) % n}`, random: false }),
      );
      score(r, now);
      const winners = r.results.filter((x) => x.winner);
      expect(winners).toHaveLength(n);
      expect(winners.every((x) => x.streak === 2)).toBe(true);
      expect(new Set(winners.map((x) => x.points)).size).toBe(1);
      expect(winners[0].points).toBe(n === 2 ? 41 : 28);
      advance(r, now, library);
      expect(r.phase).toBe("round_winner");
      advance(r, now, library);
      expect(r.phase).toBe("round_leaderboard");
      expect(
        r.players.slice(0, n).every((p) => p.score === winners[0].points),
      ).toBe(true);
    });
});

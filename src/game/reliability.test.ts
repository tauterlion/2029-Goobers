import { describe, it, expect } from "vitest";
import {
  act,
  advance,
  connected,
  drawImage,
  join,
  newRoom,
  normalizeLibrary,
  phase,
  reconcilePresence,
  score,
  tick,
  view,
  CONNECTION_LEASE,
  DISCONNECT_GRACE,
} from "./engine";
import { activeImages } from "./deck";
import { initialBody, stepBody, clampBody } from "./lobby-physics";
import { PODIUM } from "./timing";
const time = 1_000_000,
  library = ["a", "b", "c", "d", "new"];
function setup() {
  const r = newRoom("ABCDE", time);
  for (let i = 0; i < 4; i++) join(r, `P${i}`, `s${i}`, `c${i}`, time + i);
  return r;
}
describe("immutable round sources", () => {
  it.each(["same", "different"] as const)(
    "%s assignments survive errors, every phase and recovery",
    (mode) => {
      const r = setup();
      r.settings.mode = mode;
      phase(r, "starting", time);
      advance(r, time, library);
      const assigned = { ...r.assignments };
      advance(r, time, library);
      advance(r, time, library);
      const epoch = r.epoch;
      for (const p of r.players)
        act(r, p, { type: "caption", text: "caption", epoch }, time, library);
      const sources = r.captions.map((c) => c.image),
        used = [...r.used];
      for (const targetPhase of [
        "slideshow",
        "voting",
        "vote_reveal",
        "round_winner",
        "round_leaderboard",
      ] as const) {
        phase(r, targetPhase, time);
        for (const image of sources)
          act(r, r.players[0], { type: "image_failed", image }, time, library);
        const restored = structuredClone(r);
        tick(restored, time, library);
        expect(restored.assignments).toEqual(assigned);
        expect(restored.captions.map((c) => c.image)).toEqual(sources);
        expect(restored.used).toEqual(used);
        for (const p of r.players)
          expect(view(restored, p.id, time, library).image).toBe(
            assigned[p.id],
          );
      }
      phase(r, "slideshow", time);
      for (let i = 0; i < 4; i++) {
        advance(r, time, library);
        expect(r.assignments).toEqual(assigned);
        expect(r.captions.map((c) => c.image)).toEqual(sources);
      }
    },
  );
});
describe("disconnect grace and frozen evidence", () => {
  it("keeps explicit leaves for 20 seconds, removes exactly once, frees a slot", () => {
    const r = setup(),
      p = r.players[1];
    act(r, p, { type: "leave" }, time, library);
    expect(view(r, r.players[0].id, time, library).presenceDeadline).toBe(
      time + DISCONNECT_GRACE,
    );
    reconcilePresence(r, time + 19999);
    expect(r.players).toContain(p);
    reconcilePresence(r, time + 20000);
    expect(r.players).not.toContain(p);
    expect(r.departed ?? []).toEqual([]);
    reconcilePresence(r, time + 20001);
    expect(r.players).toHaveLength(3);
    const again = join(r, p.name, p.secret, "new", time + 20002);
    expect(again.id).not.toBe(p.id);
  });
  it("reconnect during grace cancels removal without restoring host", () => {
    const r = setup(),
      old = r.players[0];
    act(r, old, { type: "leave" }, time, library);
    expect(r.host).toBe(r.players[1].id);
    old.seen = time + 19000;
    delete old.disconnectedAt;
    old.connection = "new";
    reconcilePresence(r, time + 20001);
    expect(r.players).toContain(old);
    expect(connected(old, time + 20001)).toBe(true);
    expect(r.host).not.toBe(old.id);
  });
  it("starts a lost-connection grace at lease expiry even when first tick is late", () => {
    const r = setup(),
      p = r.players[1];
    p.seen = time;
    reconcilePresence(r, time + CONNECTION_LEASE + 19999);
    expect(r.players).toContain(p);
    reconcilePresence(r, time + CONNECTION_LEASE + DISCONNECT_GRACE);
    expect(r.players).not.toContain(p);
  });
  it("preserves captions/votes/scores and authors after removal; excludes future rounds", () => {
    const r = setup();
    phase(r, "starting", time);
    advance(r, time, library);
    advance(r, time, library);
    advance(r, time, library);
    const epoch = r.epoch;
    for (const p of r.players)
      act(r, p, { type: "caption", text: "caption", epoch }, time, library);
    const gone = r.players[1],
      electorate = [...r.electorate],
      captions = structuredClone(r.captions),
      goneCaption = r.captions.find((c) => c.player === gone.id)!;
    phase(r, "voting", time, 30);
    act(
      r,
      gone,
      { type: "vote", target: r.captions[0].id, epoch: r.epoch },
      time,
      library,
    );
    act(r, gone, { type: "leave" }, time, library);
    reconcilePresence(r, time + 20000);
    expect(r.players).not.toContain(gone);
    expect(r.electorate).toEqual(electorate);
    expect(r.captions).toEqual(captions);
    expect(r.votes[gone.id].random).toBe(false);
    r.players.forEach(
      (p) => (r.votes[p.id] = { caption: goneCaption.id, random: false }),
    );
    score(r, time + 20001);
    expect(r.results.find((x) => x.player === gone.id)).toMatchObject({
      votes: 3,
      unanimous: true,
      points: 113,
      winner: true,
    });
    phase(r, "round_winner", time + 20001);
    const v = view(r, r.players[0].id, time + 20001, library);
    expect(v.players.some((p) => p.id === gone.id)).toBe(false);
    expect(v.participants.find((p) => p.id === gone.id)).toMatchObject({
      name: gone.name,
      score: 113,
      removed: true,
    });
    expect(JSON.stringify(v)).not.toContain(gone.secret);
    const again = join(r, gone.name, gone.secret, "new", time + 20002);
    expect(again.pending).toBe(true);
    expect(again.id).not.toBe(gone.id);
    phase(r, "round_leaderboard", time + 20002);
    advance(r, time + 20002, library);
    expect(r.electorate).not.toContain(gone.id);
    expect(r.electorate).toContain(again.id);
  });
  it("classifies removed non-submitters as graves without changing electorate", () => {
    const r = setup();
    phase(r, "starting", time);
    advance(r, time, library);
    const gone = r.players[2];
    act(r, gone, { type: "leave" }, time, library);
    reconcilePresence(r, time + 20000);
    phase(r, "captioning", time + 20000);
    advance(r, time + 20000, library);
    expect(r.gags.find((g) => g.player === gone.id)?.kind).toBe("grave");
    expect(r.electorate).toHaveLength(4);
  });
  it("ends safely with only the host and does not repeat acknowledged mass-disconnect prompts", () => {
    const r = setup();
    phase(r, "starting", time);
    advance(r, time, library);
    for (const p of r.players.slice(2))
      act(r, p, { type: "leave" }, time, library);
    act(r, r.players[0], { type: "keep", epoch: r.epoch }, time, library);
    reconcilePresence(r, time + 20000);
    expect(view(r, r.players[0].id, time + 20000, library).halfGone).toBe(
      false,
    );
    act(r, r.players[1], { type: "leave" }, time + 20000, library);
    tick(r, time + 20000, library);
    expect(r.phase).toBe("lobby");
  });
});
describe("changing libraries", () => {
  it.each(["whitelist", "blacklist"] as const)(
    "prunes stale %s and history references without changing active snapshots",
    (mode) => {
      const r = setup();
      r.deck = { mode, images: ["a", "deleted"] };
      r.recentGames = [["a", "deleted"], ["b"], ["deleted"]];
      r.previous = ["a", "deleted"];
      r.pool = ["a", "deleted", "new"];
      r.assignments = { p: "deleted" };
      r.captions = [
        { id: "c", player: "p", image: "deleted", text: "caption" },
      ];
      normalizeLibrary(r, library);
      expect(r.deck.images).toEqual(["a"]);
      expect(r.recentGames).toEqual([["a"], ["b"], []]);
      expect(r.pool).toEqual(["a", "new"]);
      expect(r.assignments.p).toBe("deleted");
      expect(r.captions[0].image).toBe("deleted");
      expect(activeImages(library, r.deck)).not.toContain("deleted");
    },
  );
  it("new images join all/blacklist pools and outrank history", () => {
    const r = setup();
    r.recentGames = [["a", "b", "c", "d"]];
    expect(drawImage(r, "p", library)).toBe("new");
    expect(
      activeImages(library, { mode: "blacklist", images: ["deleted"] }),
    ).toContain("new");
  });
});
describe("bounded lobby motion", () => {
  const bounds = { width: 390, height: 300, tagWidth: 140, tagHeight: 70 };
  it("friction settles motion and clamps/bounces without escaping", () => {
    const b = { x: 249, y: 220, vx: 300, vy: 200, rotation: 0 };
    stepBody(b, bounds, 0.016);
    expect(b.vx).toBeLessThan(0);
    expect(b.x).toBe(250);
    for (let i = 0; i < 200; i++) stepBody(b, bounds, 0.016);
    expect(b.vx).toBe(0);
    expect(b.vy).toBe(0);
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.y).toBeLessThanOrEqual(230);
  });
  it("reset and resize produce valid accessible positions for twelve tags", () => {
    for (let i = 0; i < 12; i++) {
      const b = initialBody(i, 12, { ...bounds, height: 700 });
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x).toBeLessThanOrEqual(250);
      expect(b.vx).toBe(0);
      clampBody(b, { ...bounds, width: 150, height: 100 });
      expect(b.x).toBeLessThanOrEqual(10);
      expect(b.y).toBeLessThanOrEqual(30);
    }
  });
  it("podium retains third/second/first order at 85% duration", () => {
    expect(PODIUM.duration).toBe(8500);
    expect(PODIUM.third).toBeLessThan(PODIUM.second);
    expect(PODIUM.second).toBeLessThan(PODIUM.first);
    expect(PODIUM.first).toBeLessThan(PODIUM.standings);
    expect(PODIUM.standings).toBeLessThan(PODIUM.duration);
  });
});

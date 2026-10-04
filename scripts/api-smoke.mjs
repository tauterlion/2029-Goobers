import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const assets = JSON.parse(
  await readFile(
    new URL("../src/generated/assets.json", import.meta.url),
    "utf8",
  ),
);
const base = process.env.TEST_URL ?? "http://localhost:3000";
const person = () => ({
  token: crypto.randomUUID(),
  connection: crypto.randomUUID(),
  code: "",
});
async function call(p, action, expectedError = false) {
  const response = await fetch(`${base}/api/game`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...p, ...action }),
  });
  const data = await response.json();
  if (expectedError) {
    assert.ok(data.error);
    return data.error;
  }
  assert.ok(response.ok, JSON.stringify(data));
  if (data.state) p.code = data.state.code;
  return data.state;
}
const host = person();
let s = await call(host, { type: "create", name: "Host" });
const all = [host, ...Array.from({ length: 11 }, person)];
all.forEach((p) => (p.code = s.code));
await Promise.all(
  all.slice(1).map((p, i) => call(p, { type: "join", name: `Guest ${i + 1}` })),
);
s = await call(host, { type: "read" });
assert.equal(s.players.length, 12);
const overflow = person();
overflow.code = s.code;
assert.match(
  await call(overflow, { type: "join", name: "Extra" }, true),
  /FULL/,
);
const duplicate = { ...host, connection: crypto.randomUUID() };
assert.match(
  await call(duplicate, { type: "resume" }, true),
  /SESSION ALREADY OPEN/,
);
const victim = s.players.find((p) => p.name === "Guest 11");
await call(host, { type: "kick", target: victim.id });
assert.match(await call(all[11], { type: "heartbeat" }, true), /SESSION ENDED/);
await call(all[11], { type: "join", name: "Returned" });
assert.match(
  await call(
    all[1],
    { type: "deck", deck: { mode: "whitelist", images: [] } },
    true,
  ),
  /host/,
);
s = await call(host, { type: "deck", deck: { mode: "whitelist", images: [] } });
assert.equal(s.activeImageCount, 0);
assert.match(
  await call(host, { type: "start", epoch: s.epoch }, true),
  /at least one image/,
);
const selected = assets.images.slice(0, 12);
s = await call(host, {
  type: "deck",
  deck: { mode: "whitelist", images: selected },
});
assert.equal(s.activeImageCount, 12);
s = await call(host, {
  type: "settings",
  settings: { rounds: 2, seconds: 20, mode: "different" },
});
s = await call(host, { type: "start", epoch: s.epoch });
const old = s.epoch;
s = await call(host, { type: "skip", epoch: s.epoch });
assert.match(
  await call(host, { type: "skip", epoch: old }, true),
  /PHASE ALREADY CLOSED/,
);
s = await call(host, { type: "skip", epoch: s.epoch });
s = await call(host, { type: "skip", epoch: s.epoch });
assert.equal(s.phase, "captioning");
assert.match(
  await call(
    host,
    { type: "caption", text: "x".repeat(101), epoch: s.epoch },
    true,
  ),
  /3–100/,
);
const views = await Promise.all(all.map((p) => call(p, { type: "read" })));
assert.equal(new Set(views.map((v) => v.image)).size, 12);
assert.ok(views.every((v) => selected.includes(v.image)));
assert.equal(
  views.some((v) => JSON.stringify(v).includes("secret")),
  false,
);
await Promise.all(
  all.map((p, i) =>
    call(p, { type: "caption", text: `Genius ${i} 🔥`, epoch: s.epoch }),
  ),
);
s = await call(host, { type: "read" });
assert.equal(s.phase, "slideshow");
assert.equal(s.captions.length, 12);
assert.ok(s.captions.every((c) => !c.author));
s = await call(host, { type: "skip", epoch: s.epoch });
assert.equal(s.phase, "voting");
const votes = await Promise.all(all.map((p) => call(p, { type: "read" })));
const own = votes[0].captions.find((c) => c.own);
assert.match(
  await call(host, { type: "vote", epoch: s.epoch, target: own.id }, true),
  /yourself/,
);
const closingDeadline = s.deadline;
const voteResponses = await Promise.all(
  all.map((p, i) =>
    call(p, {
      type: "vote",
      epoch: s.epoch,
      target: votes[i].captions.find((c) => !c.own).id,
    }),
  ),
);
s = await call(host, { type: "read" });
assert.equal(s.phase, "vote_reveal");
assert.equal(
  voteResponses.filter((v) => v.phase === "vote_reveal").length,
  1,
  "Exactly one final vote closes the phase",
);
assert.ok(s.serverTime < closingDeadline, "Voting closes before timeout");
assert.ok(
  s.players.every((p) => p.score === 0 && p.stats.votes === 0),
  "Tally must not reveal authors via scores",
);
s = await call(host, { type: "skip", epoch: s.epoch });
assert.equal(
  s.results.reduce((n, r) => n + r.votes, 0),
  12,
);
await call(host, { type: "leave" });
s = await call(all[1], { type: "heartbeat" });
assert.notEqual(s.host, views[0].me);
assert.deepEqual(s.deck, { mode: "whitelist", images: selected });
const successor = all[votes.findIndex((v) => v.me === s.host)];
async function finishGame() {
  for (let step = 0; step < 40 && s.phase !== "game_over"; step++) {
    // Timed screens can expire during network latency; advance by heartbeat
    // instead of retrying a stale skip epoch against an uncommitted deadline.
    try {
      s = await call(successor, { type: "skip", epoch: s.epoch });
    } catch (error) {
      if (!error.message.includes('"code":"phase"')) throw error;
      s = await call(successor, { type: "heartbeat" });
    }
  }
  assert.equal(s.phase, "game_over");
}
await Promise.all(all.slice(1).map((p) => call(p, { type: "heartbeat" })));
s = await call(successor, { type: "read" });
await finishGame();
assert.equal(s.phase, "game_over");
s = await call(successor, { type: "lobby", epoch: s.epoch });
assert.deepEqual(s.deck, { mode: "whitelist", images: selected });
s = await call(successor, {
  type: "deck",
  deck: { mode: "blacklist", images: assets.images.slice(1) },
});
assert.equal(s.activeImageCount, 1);
s = await call(successor, {
  type: "settings",
  settings: { rounds: 1, seconds: 20, mode: "same" },
});
s = await call(successor, { type: "start", epoch: s.epoch });
await finishGame();
assert.equal(s.phase, "game_over");
await Promise.all(all.slice(1).map((p) => call(p, { type: "heartbeat" })));
s = await call(successor, { type: "read" });
s = await call(successor, { type: "rematch", epoch: s.epoch });
assert.equal(s.phase, "starting");
assert.deepEqual(s.deck, { mode: "blacklist", images: assets.images.slice(1) });
assert.deepEqual(s.settings, { rounds: 1, seconds: 20, mode: "same" });
s = await call(successor, { type: "skip", epoch: s.epoch });
assert.equal(s.image, assets.images[0]);
console.log(
  "PASS: 12-player concurrent joins/captions/votes, capacity, kick/rejoin, duplicate connection rejection, epoch guards, distinct images, private projections, scoring, host migration, deck permissions/eligibility, empty deck rejection, lobby persistence and rematch.",
);

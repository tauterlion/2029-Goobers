import assert from "node:assert/strict";
const base = process.env.TEST_URL ?? "http://localhost:3000";
const people = Array.from({ length: 5 }, () => ({
  token: crypto.randomUUID(),
  connection: crypto.randomUUID(),
  code: "",
}));
async function call(p, action, error = false) {
  const response = await fetch(`${base}/api/game`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...p, ...action }),
  });
  const data = await response.json();
  if (error) {
    assert.ok(data.error);
    return data;
  }
  assert.ok(response.ok, JSON.stringify(data));
  p.code = data.state.code;
  return data.state;
}
let s = await call(people[0], { type: "create", name: "Grace Host" });
people.forEach((p) => (p.code = s.code));
await Promise.all(
  people
    .slice(1)
    .map((p, i) => call(p, { type: "join", name: `Grace ${i + 1}` })),
);
const online = new Set(people),
  failures = [];
const timer = setInterval(() => {
  for (const p of online)
    void call(p, { type: "heartbeat" }).catch((e) => failures.push(e.message));
}, 6000);
try {
  const original = s.me;
  online.delete(people[0]);
  s = await call(people[0], { type: "leave" });
  assert.notEqual(
    s.host,
    original,
    "Explicit host leave immediately transfers authority",
  );
  await new Promise((r) => setTimeout(r, 1500));
  s = await call(people[1], { type: "heartbeat" });
  assert.equal(s.players.find((p) => p.id === original).online, false);
  people[0].connection = crypto.randomUUID();
  s = await call(people[0], { type: "resume" });
  online.add(people[0]);
  assert.equal(s.me, original);
  assert.notEqual(s.host, original);
  const successor = people[1];
  s = await call(successor, {
    type: "settings",
    settings: { rounds: 1, seconds: 60, mode: "different" },
  });
  s = await call(successor, { type: "start", epoch: s.epoch });
  while (s.phase !== "captioning") {
    try {
      s = await call(successor, { type: "skip", epoch: s.epoch });
    } catch (e) {
      if (!e.message.includes('"code":"phase"')) throw e;
      s = await call(successor, { type: "heartbeat" });
    }
  }
  const own = await call(people[0], { type: "read" }),
    assigned = own.image;
  await call(people[0], {
    type: "caption",
    text: "A caption that outlives its room membership",
    epoch: own.epoch,
  });
  online.delete(people[0]);
  s = await call(people[0], { type: "leave" });
  await new Promise((r) => setTimeout(r, 19000));
  s = await call(successor, { type: "heartbeat" });
  assert.ok(
    s.players.some((p) => p.id === original),
    "Still present before 20-second deadline",
  );
  await new Promise((r) => setTimeout(r, 2200));
  s = await call(successor, { type: "heartbeat" });
  assert.ok(!s.players.some((p) => p.id === original));
  assert.equal(s.eligible, 5);
  const expired = await call(people[0], { type: "resume" }, true);
  assert.equal(expired.code, "session");
  s = await call(people[0], { type: "join", name: "Grace Host" });
  online.add(people[0]);
  assert.notEqual(s.me, original);
  assert.equal(s.pending, true);
  const epoch = s.epoch;
  await Promise.all(
    people
      .slice(1)
      .map((p, i) =>
        call(p, { type: "caption", text: `Still playing ${i}`, epoch }),
      ),
  );
  s = await call(successor, { type: "read" });
  assert.equal(s.phase, "slideshow");
  assert.equal(
    s.captions.find(
      (c) => c.text === "A caption that outlives its room membership",
    ).image,
    assigned,
  );
  assert.equal(failures.length, 0, failures.join("\n"));
  console.log(
    "PASS: immediate host transfer, reconnect cancels removal, 20-second grace, expired session rejection, rejoin pending, frozen electorate and retained caption/image on real Supabase.",
  );
} finally {
  clearInterval(timer);
  await Promise.allSettled([...online].map((p) => call(p, { type: "leave" })));
}

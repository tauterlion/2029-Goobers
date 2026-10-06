import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
const base = process.env.TEST_URL ?? "http://localhost:3001";
const browser = await chromium.launch({
  headless: true,
  channel: process.env.BROWSER_CHANNEL ?? "msedge",
});
const page = await browser.newPage({
  viewport: { width: 1366, height: 768 },
  hasTouch: true,
});
await page.addInitScript(() => {
  window.__frames = 0;
  const raf = window.requestAnimationFrame;
  window.requestAnimationFrame = (callback) =>
    raf.call(window, (time) => {
      window.__frames++;
      callback(time);
    });
});
const people = [];
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const keepalive = setInterval(
  () =>
    people.forEach((p) => {
      void fetch(`${base}/api/game`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...p, type: "heartbeat" }),
      });
    }),
  6000,
);
try {
  await page.goto(base);
  await page.getByLabel("YOUR NAME").fill("UI Host");
  await page.getByRole("button", { name: "CREATE A ROOM" }).click();
  await page.locator(".code-display").waitFor();
  const code = await page.locator(".code-display strong").innerText();
  for (let i = 1; i < 12; i++) {
    const p = {
      code,
      token: crypto.randomUUID(),
      connection: crypto.randomUUID(),
    };
    people.push(p);
    const response = await fetch(`${base}/api/game`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...p, type: "join", name: `UI ${i}` }),
    });
    assert.ok(response.ok);
  }
  await page.waitForFunction(
    () => document.querySelectorAll(".throwable-tag").length === 12,
  );
  await page.getByRole("button", { name: "RESET LAYOUT", exact: true }).click();
  const tag = page.getByRole("button", { name: "Drag UI 3", exact: true }),
    box = await tag.boundingBox();
  await page.mouse.move(box.x + 30, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(box.x + 160, box.y + 80, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(2000);
  const settled = await page.evaluate(() => window.__frames);
  await page.waitForTimeout(400);
  assert.equal(
    await page.evaluate(() => window.__frames),
    settled,
    "Lobby RAF stops after momentum settles",
  );
  await page.getByRole("button", { name: "RESET LAYOUT", exact: true }).click();
  await page
    .getByRole("button", { name: "MANAGE PLAYERS", exact: true })
    .click();
  await page.screenshot({
    path: "test-results/laptop-player-management.png",
    fullPage: true,
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "MANAGE PLAYERS", exact: true })
    .click();
  await page.locator(".throwable-cloud").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "test-results/laptop-twelve-tags.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "RESET LAYOUT", exact: true }).click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await tag.scrollIntoViewIfNeeded();
  const touchBox = await tag.boundingBox(),
    cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: touchBox.x + 40, y: touchBox.y + 35 }],
  });
  for (let step = 1; step <= 6; step++)
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { x: touchBox.x + 40 - step * 6, y: touchBox.y + 35 + step * 5 },
      ],
    });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  const moved = await tag.evaluate((el) => el.style.transform);
  assert.notEqual((await tag.boundingBox()).x, touchBox.x);
  await page.waitForTimeout(250);
  assert.equal(
    await tag.evaluate((el) => el.style.transform),
    moved,
    "Reduced motion has no throw inertia",
  );
  await page
    .getByRole("button", { name: "MANAGE PLAYERS", exact: true })
    .click();
  await page.locator(".player-management").scrollIntoViewIfNeeded();
  assert.equal(await page.locator(".player-management button").count(), 11);
  await page.screenshot({
    path: "test-results/mobile-player-management.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "😂 REACTIONS", exact: true }).click();
  for (let i = 0; i < 25; i++)
    await page.getByRole("button", { name: "React 😂", exact: true }).click();
  assert.ok((await page.locator(".reaction-layer span").count()) <= 20);
  await page.waitForTimeout(2800);
  assert.equal(await page.locator(".reaction-layer span").count(), 0);
  assert.equal(
    await page.evaluate(() => {
      const world = document.querySelector(".world").getBoundingClientRect(),
        dock = document.querySelector(".reaction-dock").getBoundingClientRect();
      return world.bottom <= dock.top;
    }),
    true,
  );
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log(
    "PASS: twelve bounded tags on laptop/mobile, settled RAF, real touch drag with reduced motion, separate management, fixed reaction strip and bounded/expired particles.",
  );
} finally {
  clearInterval(keepalive);
  await browser.close();
  for (const p of people)
    await fetch(`${base}/api/game`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...p, type: "leave" }),
    });
}

import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const base = process.env.TEST_URL ?? "http://localhost:3000";
const browser = await chromium.launch({
  headless: true,
  channel: process.env.BROWSER_CHANNEL ?? "msedge",
});
const contexts = await Promise.all(
  Array.from({ length: 4 }, () =>
    browser.newContext({ viewport: { width: 1440, height: 1000 } }),
  ),
);
const pages = await Promise.all(contexts.map((c) => c.newPage()));
const errors = [];
pages.forEach((p) => p.on("pageerror", (e) => errors.push(e.message)));
await mkdir("test-results", { recursive: true });
async function screenshot(page, name) {
  await page.screenshot({
    path: `test-results/${name}.png`,
    fullPage: true,
    animations: "disabled",
  });
}
try {
  await pages[0].goto(base);
  await screenshot(pages[0], "desktop-home");
  await pages[0].getByLabel("WHAT DO WE CALL YOU?").fill("Alex");
  await pages[0].getByRole("button", { name: "CREATE A ROOM" }).click();
  await pages[0].getByText("THE SECRET HANDSHAKE").waitFor();
  const code = await pages[0].locator(".code-display strong").innerText();
  for (let i = 1; i < 4; i++) {
    await pages[i].goto(base);
    await pages[i]
      .getByLabel("WHAT DO WE CALL YOU?")
      .fill(["", "Sam", "Riley", "Jules"][i]);
    await pages[i].getByLabel("Room code").fill(code);
    await pages[i].getByRole("button", { name: "JOIN →", exact: true }).click();
    await pages[i].getByText("THE SECRET HANDSHAKE").waitFor();
  }
  await pages[0].getByRole("button", { name: "START THE CHAOS" }).waitFor();
  await pages[0].waitForFunction(() =>
    document.querySelector(".player-cloud")?.textContent?.includes("Jules"),
  );
  await screenshot(pages[0], "desktop-lobby");
  await pages[0].getByLabel("Rounds", { exact: true }).selectOption("1");
  await pages[0].getByRole("button", { name: "START THE CHAOS" }).click();
  await pages[0].getByLabel("Your caption").waitFor({ timeout: 20000 });
  await screenshot(pages[0], "desktop-caption");
  await pages[1].setViewportSize({ width: 390, height: 844 });
  await screenshot(pages[1], "mobile-caption");
  await pages[0]
    .getByLabel("Your caption")
    .fill("When the group project has one brain cell");
  await pages[0].getByRole("button", { name: "SUBMIT GENIUS" }).click();
  await pages[0].reload();
  await pages[0].getByLabel("Your caption").waitFor({ timeout: 10000 });
  assert.equal(
    await pages[0].getByLabel("Your caption").inputValue(),
    "When the group project has one brain cell",
  );
  for (let i = 1; i < 4; i++) {
    await pages[i]
      .getByLabel("Your caption")
      .fill(`This meeting could have been a meme ${i}`);
    await pages[i].getByRole("button", { name: "SUBMIT GENIUS" }).click();
  }
  await pages[0].getByText("AUTHOR: CLASSIFIED").waitFor();
  await screenshot(pages[0], "desktop-slideshow");
  for (let i = 0; i < 4; i++) {
    const next = pages[0].getByRole("button", {
      name: i === 3 ? "TIME TO JUDGE" : "NEXT MASTERPIECE",
    });
    await next.click();
  }
  await pages[0].getByText("PICK YOUR").waitFor();
  await screenshot(pages[0], "desktop-voting");
  await pages[1].getByText("PICK YOUR").waitFor();
  await screenshot(pages[1], "mobile-voting");
  for (const p of pages) {
    await p.locator(".vote-card:not([disabled])").first().click();
  }
  await pages[0].getByText("CURRENT").waitFor({ timeout: 15000 });
  await screenshot(pages[0], "desktop-leaderboard");
  await pages[0].getByRole("button", { name: "THE GRAND FINALE" }).click();
  await pages[0].waitForTimeout(8200);
  await screenshot(pages[0], "desktop-podium");
  await pages[0].getByText("VERY SPECIAL").waitFor();
  await screenshot(pages[0], "desktop-awards");
  await pages[0].getByRole("button", { name: "TAKE A BOW" }).click();
  await pages[0].getByRole("button", { name: "REMATCH" }).waitFor();
  await pages[0].getByRole("button", { name: "RETURN TO LOBBY" }).click();
  await pages[0].getByText("THE SECRET HANDSHAKE").waitFor();
  await screenshot(pages[1], "mobile-lobby");
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log(
    "PASS: four independent browsers, complete game, refresh recovery, results and lobby return; desktop/mobile screenshots; no browser errors.",
  );
  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
  });
  await mobile.goto(base);
  await screenshot(mobile, "mobile-home");
  assert.equal(
    await mobile.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
    "Mobile horizontal overflow",
  );
} finally {
  await browser.close();
}

import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { readFile } from "node:fs/promises";
const imageCount = JSON.parse(
  await readFile(
    new URL("../src/generated/assets.json", import.meta.url),
    "utf8",
  ),
).images.length;
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
pages.forEach((p) => p.setDefaultTimeout(20000));
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
  assert.equal(
    await pages[0].getByLabel("Theme", { exact: true }).inputValue(),
    "original",
  );
  await screenshot(pages[0], "desktop-home");
  await pages[0].getByLabel("YOUR NAME").fill("Alex");
  await pages[0].getByRole("button", { name: "CREATE A ROOM" }).click();
  await pages[0].getByText("ROOM CODE").waitFor();
  const code = await pages[0].locator(".code-display strong").innerText();
  for (let i = 1; i < 4; i++) {
    await pages[i].goto(base);
    await pages[i]
      .getByLabel("YOUR NAME")
      .fill(["", "Sam", "Riley", "Jules"][i]);
    await pages[i].getByLabel("Room code").fill(code);
    await pages[i].getByRole("button", { name: "JOIN →", exact: true }).click();
    await pages[i].getByText("ROOM CODE").waitFor();
  }
  await pages[0].getByRole("button", { name: "START GAME" }).waitFor();
  await pages[0].waitForFunction(() =>
    document.querySelector(".player-cloud")?.textContent?.includes("Jules"),
  );
  await screenshot(pages[0], "desktop-lobby");
  // Personal themes never submit a game action and remain independent.
  const themeWrites = [];
  const onRequest = (req) => {
    if (req.url().endsWith("/api/game") && req.method() === "POST") {
      const data = req.postDataJSON();
      if (!["read", "heartbeat"].includes(data.type))
        themeWrites.push(data.type);
    }
  };
  pages[1].on("request", onRequest);
  await pages[1].getByLabel("Theme", { exact: true }).selectOption("coffee");
  assert.equal(
    await pages[0].getByLabel("Theme", { exact: true }).inputValue(),
    "original",
  );
  assert.deepEqual(themeWrites, []);
  pages[1].off("request", onRequest);
  await pages[1].reload();
  await pages[1].locator(".code-display").waitFor({ timeout: 35000 });
  await pages[1].waitForFunction(
    () => !document.querySelector(".connection-overlay"),
  );
  await pages[1].waitForFunction(
    () => document.documentElement.dataset.theme === "coffee",
  );
  await pages[2].getByLabel("Theme", { exact: true }).selectOption("dark");
  await pages[3].getByLabel("Theme", { exact: true }).selectOption("vibrant");
  await pages[0]
    .getByRole("button", { name: "EDIT DECK", exact: true })
    .click();
  await pages[0]
    .getByRole("button", { name: "WHITELIST", exact: true })
    .click();
  await pages[0]
    .getByText(`0 / ${imageCount} IMAGES ACTIVE`, { exact: true })
    .waitFor();
  assert.equal(
    await pages[0].getByRole("button", { name: "START GAME" }).isDisabled(),
    true,
  );
  await pages[0]
    .getByText("Select at least one image before starting.", { exact: true })
    .waitFor();
  await pages[0].getByRole("button", { name: "Image 1", exact: true }).click();
  await pages[0]
    .getByText(`1 / ${imageCount} IMAGES ACTIVE`, { exact: true })
    .waitFor();
  await pages[0]
    .getByText("This deck may repeat images during the game.", { exact: true })
    .waitFor();
  const deckImage = await pages[0]
    .getByRole("button", { name: "Image 1", exact: true })
    .locator("img")
    .getAttribute("src");
  await screenshot(pages[0], "desktop-deck");
  await pages[0]
    .getByRole("button", { name: "CLOSE DECK", exact: true })
    .click();
  const isLocal = await pages[0]
    .getByText("LOCAL TEST MODE", { exact: false })
    .count();
  if (!isLocal) {
    await pages[0]
      .getByRole("button", { name: "React 😂", exact: true })
      .click();
    await pages[1]
      .locator(".reaction-layer span")
      .filter({ hasText: "😂" })
      .waitFor({ timeout: 5000 });
    console.log("PASS: Supabase reaction broadcast reached another browser.");
  }
  await pages[0].getByLabel("Rounds", { exact: true }).selectOption("1");
  await pages[0].waitForFunction(
    () =>
      document.querySelector('select[aria-label="Rounds"]').value === "1" &&
      !document.querySelector("button.primary:disabled"),
  );
  await pages[0].getByLabel("Caption timer").selectOption("60");
  await pages[0].waitForFunction(
    () =>
      document.querySelector('select[aria-label="Caption timer"]').value ===
        "60" && !document.querySelector("button.primary:disabled"),
  );
  await pages[0].getByRole("button", { name: "START GAME" }).click();
  await pages[0].getByLabel("Your caption").waitFor({ timeout: 20000 });
  assert.equal(
    await pages[0].locator(".meme-frame img").getAttribute("src"),
    deckImage,
  );
  const caption = pages[0].getByLabel("Your caption");
  assert.equal(await caption.getAttribute("maxlength"), "100");
  await caption.pressSequentially("x".repeat(105));
  assert.equal(
    await caption.inputValue(),
    "x".repeat(100),
    "Typing must stop at 100",
  );
  await caption.fill("");
  await contexts[0].grantPermissions(["clipboard-read", "clipboard-write"]);
  await pages[0].evaluate(() => navigator.clipboard.writeText("p".repeat(105)));
  await caption.focus();
  await pages[0].keyboard.press("Control+V");
  assert.equal(
    await caption.inputValue(),
    "p".repeat(100),
    "Pasting must truncate to first 100",
  );
  await pages[0].locator("#caption-counter.near-limit").waitFor();
  await caption.fill("");
  await pages[0].evaluate(() => navigator.clipboard.writeText("😀".repeat(51)));
  await caption.focus();
  await pages[0].keyboard.press("Control+V");
  assert.equal(
    await caption.inputValue(),
    "😀".repeat(50),
    "Emoji paste must honor native limit without a split surrogate",
  );
  await caption.fill("");
  await screenshot(pages[0], "desktop-caption");
  await pages[1].setViewportSize({ width: 390, height: 844 });
  await screenshot(pages[1], "mobile-caption");
  await pages[0]
    .getByLabel("Your caption")
    .fill("When the group project has one brain cell");
  await pages[0].getByRole("button", { name: "SUBMIT CAPTION" }).click();
  await pages[0]
    .getByText("Submitted. You can edit until captioning closes.", {
      exact: true,
    })
    .waitFor();
  await pages[0].reload();
  // A lost/raced pagehide release can require the existing 25-second lease.
  await pages[0].getByLabel("Your caption").waitFor({ timeout: 35000 });
  assert.equal(
    await pages[0].getByLabel("Your caption").inputValue(),
    "When the group project has one brain cell",
  );
  for (let i = 1; i < 4; i++) {
    await pages[i]
      .getByLabel("Your caption")
      .fill(`This meeting could have been a meme ${i}`);
    await pages[i].getByRole("button", { name: "SUBMIT CAPTION" }).click();
  }
  await pages[0].getByText("ANONYMOUS").waitFor();
  await screenshot(pages[0], "desktop-slideshow");
  // Refresh releases the old host's connection. Follow the authoritative host.
  let hostPage;
  for (let attempt = 0; attempt < 40 && !hostPage; attempt++) {
    for (const page of pages)
      if (await page.locator(".primary.next").count()) {
        hostPage = page;
        break;
      }
    if (!hostPage) await pages[0].waitForTimeout(250);
  }
  assert.ok(hostPage, "A connected host must control the slideshow");
  for (let i = 0; i < 4; i++) {
    const next = hostPage.getByRole("button", {
      name: i === 3 ? "TIME TO DECIDE…" : "NEXT UP…!",
    });
    await next.click();
  }
  await pages[0].getByText("TIME TO").waitFor();
  await screenshot(pages[0], "desktop-voting");
  await pages[1].getByText("TIME TO").waitFor();
  await screenshot(pages[1], "mobile-voting");
  // Choose cyclic targets: exactly one vote per caption, a guaranteed four-way tie.
  await pages[0]
    .locator(".vote-card")
    .filter({ hasText: "This meeting could have been a meme 1" })
    .click();
  await pages[0].locator(".vote-card.selected").waitFor();
  for (const theme of ["original", "light", "dark", "coffee", "vibrant"]) {
    await pages[0].getByLabel("Theme", { exact: true }).selectOption(theme);
    await screenshot(pages[0], `theme-${theme}-voting`);
    const colors = await pages[0]
      .locator(".vote-card.selected")
      .evaluate((el) => ({
        color: getComputedStyle(el).color,
        background: getComputedStyle(el).backgroundColor,
      }));
    assert.notEqual(colors.color, colors.background);
  }
  for (let i = 1; i < 4; i++)
    await pages[i]
      .locator(".vote-card")
      .filter({
        hasText:
          i === 3
            ? "When the group project has one brain cell"
            : `This meeting could have been a meme ${i + 1}`,
      })
      .click();
  await pages[0].locator(".tie-stage").waitFor({ timeout: 12000 });
  assert.equal(await pages[0].locator(".tie-stage .winner-card").count(), 4);
  await screenshot(pages[0], "desktop-tie");
  await screenshot(pages[1], "mobile-tie");
  await pages[0].getByText("CURRENT").waitFor({ timeout: 15000 });
  await screenshot(pages[0], "desktop-leaderboard");
  await hostPage.getByRole("button", { name: "FINAL RESULTS" }).click();
  await pages[0].waitForTimeout(8200);
  await screenshot(pages[0], "desktop-podium");
  await pages[0].locator(".awards").waitFor();
  await screenshot(pages[0], "desktop-awards");
  await hostPage.getByRole("button", { name: "CONTINUE" }).click();
  await hostPage.getByRole("button", { name: "REMATCH" }).waitFor();
  await hostPage.getByRole("button", { name: "RETURN TO LOBBY" }).click();
  await pages[0].getByText("ROOM CODE").waitFor();
  await hostPage
    .getByRole("button", { name: "EDIT DECK", exact: true })
    .waitFor();
  await pages[0]
    .getByText(`1 / ${imageCount} IMAGES ACTIVE`, { exact: true })
    .waitFor();
  assert.equal(
    await pages[1].getByLabel("Theme", { exact: true }).inputValue(),
    "coffee",
  );
  await screenshot(pages[1], "mobile-lobby");
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log(
    "PASS: four independent browsers, complete game, refresh recovery, results and lobby return; desktop/mobile screenshots; no browser errors.",
  );
  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
  });
  await mobile.goto(base);
  for (const theme of ["original", "light", "dark", "coffee", "vibrant"]) {
    await mobile.getByLabel("Theme", { exact: true }).selectOption(theme);
    await screenshot(mobile, `mobile-home-${theme}`);
    assert.equal(
      await mobile.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      `${theme} mobile overflow`,
    );
  }
  assert.equal(
    await mobile.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
    "Mobile horizontal overflow",
  );
} catch (error) {
  await screenshot(pages[0], "smoke-failure");
  console.error((await pages[0].locator("body").innerText()).slice(0, 2500));
  throw error;
} finally {
  await browser.close();
}

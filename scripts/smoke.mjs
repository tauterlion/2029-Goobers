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
const latest = [];
pages.forEach((page, i) =>
  page.on("response", async (response) => {
    if (response.url().endsWith("/api/game"))
      try {
        const data = await response.json();
        if (
          data.state &&
          (!latest[i] || data.state.version >= latest[i].version)
        )
          latest[i] = data.state;
      } catch {}
  }),
);
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
  const physicsWrites = [];
  const physicsRequest = (req) => {
    if (
      req.url().endsWith("/api/game") &&
      req.method() === "POST" &&
      !["heartbeat", "read", "resume"].includes(req.postDataJSON().type)
    )
      physicsWrites.push(req.postDataJSON().type);
  };
  pages[0].on("request", physicsRequest);
  const tag = pages[0].getByRole("button", { name: "Drag Sam", exact: true });
  const before = await tag.boundingBox();
  await pages[0].mouse.move(before.x + 30, before.y + 30);
  await pages[0].mouse.down();
  await pages[0].mouse.move(before.x + 150, before.y + 120, { steps: 8 });
  await pages[0].mouse.up();
  await pages[0].waitForTimeout(350);
  const thrown = await tag.boundingBox();
  assert.ok(
    Math.abs(thrown.x - before.x) > 30 || Math.abs(thrown.y - before.y) > 30,
  );
  assert.equal(await pages[0].locator(".player-management").count(), 0);
  await pages[0]
    .getByRole("button", { name: "RESET LAYOUT", exact: true })
    .click();
  const reset = await tag.boundingBox();
  assert.ok(Math.abs(reset.x - before.x) < 2);
  const tagBounds = await pages[0]
    .locator(".throwable-tag")
    .evaluateAll((tags) => tags.map((t) => t.getBoundingClientRect().toJSON()));
  for (let i = 0; i < tagBounds.length; i++)
    for (let j = i + 1; j < tagBounds.length; j++)
      assert.ok(
        Math.abs(tagBounds[i].x - tagBounds[j].x) > 140 ||
          Math.abs(tagBounds[i].y - tagBounds[j].y) > 70,
        "Reset separates name tags",
      );
  assert.deepEqual(physicsWrites, []);
  pages[0].off("request", physicsRequest);
  await pages[0]
    .getByRole("button", { name: "MANAGE PLAYERS", exact: true })
    .click();
  assert.equal(await pages[0].locator(".player-management button").count(), 3);
  assert.equal(
    await pages[0]
      .getByRole("button", { name: "KICK Alex", exact: true })
      .count(),
    0,
  );
  await screenshot(pages[0], "desktop-player-management");
  await pages[0]
    .getByRole("button", { name: "MANAGE PLAYERS", exact: true })
    .click();
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
  for (let i = 2; i <= 4; i++) {
    await pages[0]
      .getByRole("button", { name: `Image ${i}`, exact: true })
      .click();
    await pages[0]
      .getByText(`${i} / ${imageCount} IMAGES ACTIVE`, { exact: true })
      .waitFor();
  }
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
  await pages[0].getByLabel("Image mode").selectOption("different");
  await pages[0].waitForFunction(
    () =>
      document.querySelector('select[aria-label="Image mode"]').value ===
        "different" && !document.querySelector("button.primary:disabled"),
  );
  await pages[0].getByRole("button", { name: "START GAME" }).click();
  await pages[0].getByLabel("Your caption").waitFor({ timeout: 20000 });
  await Promise.all(
    pages.map((page) => page.getByLabel("Your caption").waitFor()),
  );
  const assignments = await Promise.all(
    pages.map((page) => page.locator(".meme-frame img").getAttribute("src")),
  );
  assert.equal(new Set(assignments).size, 4);
  assert.ok(assignments.includes(deckImage));
  const caption = pages[0].getByLabel("Your caption");
  assert.equal(await caption.getAttribute("maxlength"), "160");
  await caption.pressSequentially("x".repeat(165));
  assert.equal(
    await caption.inputValue(),
    "x".repeat(160),
    "Typing must stop at 160",
  );
  await caption.press("Backspace");
  assert.equal((await caption.inputValue()).length, 159);
  await caption.pressSequentially("z");
  assert.equal((await caption.inputValue()).length, 160);
  await caption.press("Home");
  await caption.press("Delete");
  await caption.pressSequentially("q");
  assert.equal((await caption.inputValue()).length, 160);
  await caption.fill("");
  await contexts[0].grantPermissions(["clipboard-read", "clipboard-write"]);
  await pages[0].evaluate(() => navigator.clipboard.writeText("p".repeat(165)));
  await caption.focus();
  await pages[0].keyboard.press("Control+V");
  assert.equal(
    await caption.inputValue(),
    "p".repeat(160),
    "Pasting must truncate to first 160",
  );
  await pages[0].locator("#caption-counter.near-limit").waitFor();
  await caption.fill("");
  await pages[0].evaluate(() => navigator.clipboard.writeText("😀".repeat(81)));
  await caption.focus();
  await pages[0].keyboard.press("Control+V");
  assert.equal(
    await caption.inputValue(),
    "😀".repeat(80),
    "Emoji paste must honor native limit without a split surrogate",
  );
  await caption.fill("");
  await screenshot(pages[0], "desktop-caption");
  await pages[1].setViewportSize({ width: 390, height: 844 });
  await screenshot(pages[1], "mobile-caption");
  const mobileForm = await pages[1].locator(".caption-form").boundingBox();
  await pages[1]
    .getByRole("button", { name: "😂 REACTIONS", exact: true })
    .click();
  await pages[1].getByRole("button", { name: "React 🔥", exact: true }).click();
  const withTray = await pages[1].locator(".caption-form").boundingBox();
  assert.deepEqual(withTray, mobileForm);
  assert.equal(
    await pages[1].evaluate(() => {
      const world = document.querySelector(".world").getBoundingClientRect(),
        dock = document.querySelector(".reaction-dock").getBoundingClientRect();
      return world.bottom <= dock.top;
    }),
    true,
    "Mobile dock stays below the gameplay scroll viewport",
  );
  await screenshot(pages[1], "mobile-reaction-tray");
  await pages[1].locator(".section-title h1").click();
  assert.equal(await pages[1].locator(".reactions").isVisible(), false);
  await pages[0].locator(".meme-frame img").dispatchEvent("error");
  await pages[0].locator(".meme-frame .image-fallback").waitFor();
  assert.equal(
    await pages[0].locator(".image-fallback").getAttribute("data-image-source"),
    assignments[0],
  );
  await pages[0].getByLabel("Theme", { exact: true }).selectOption("light");
  assert.equal(
    await pages[0].locator(".image-fallback").getAttribute("data-image-source"),
    assignments[0],
  );
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
    await pages[0].locator(".meme-frame img").getAttribute("src"),
    assignments[0],
  );
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
  const sourceByText = new Map(
    assignments.map((image, i) => [
      i === 0
        ? "When the group project has one brain cell"
        : `This meeting could have been a meme ${i}`,
      image,
    ]),
  );
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
    const shown = await hostPage.locator(".meme-caption").innerText();
    const shownImage = await hostPage
      .locator(".slideshow img")
      .getAttribute("src");
    assert.ok(
      [...sourceByText].some(
        ([text, image]) => shown.includes(text) && image === shownImage,
      ),
      "Slideshow keeps the caption image",
    );
    const next = hostPage.getByRole("button", {
      name: i === 3 ? "TIME TO DECIDE…" : "NEXT UP…!",
    });
    await next.click();
  }
  await pages[0].getByText("TIME TO").waitFor();
  for (const c of latest[0].captions)
    assert.equal(c.image, sourceByText.get(c.text));
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
  for (const size of [
    { width: 1440, height: 810 },
    { width: 2560, height: 1080 },
  ]) {
    await pages[0].setViewportSize(size);
    assert.equal(
      await pages[0].locator(".world").evaluate((el) => {
        const s = getComputedStyle(el, "::before");
        return (
          s.position === "fixed" &&
          s.top === "0px" &&
          s.bottom === "0px" &&
          s.left === "0px" &&
          s.right === "0px"
        );
      }),
      true,
    );
    await screenshot(pages[0], `tie-${size.width}`);
  }
  await pages[0].setViewportSize({ width: 1440, height: 1000 });
  await pages[0].getByText("CURRENT").waitFor({ timeout: 15000 });
  await screenshot(pages[0], "desktop-leaderboard");
  await hostPage.getByRole("button", { name: "FINAL RESULTS" }).click();
  await pages[0].waitForTimeout(6900);
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
    .getByText(`4 / ${imageCount} IMAGES ACTIVE`, { exact: true })
    .waitFor();
  assert.equal(
    await pages[1].getByLabel("Theme", { exact: true }).inputValue(),
    "coffee",
  );
  await screenshot(pages[1], "mobile-lobby");
  await pages[1].emulateMedia({ reducedMotion: "reduce" });
  assert.equal(
    await pages[1]
      .locator(".topography svg")
      .evaluate((el) => getComputedStyle(el).animationName),
    "none",
  );
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

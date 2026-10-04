import { it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
it("indexes safe paths and optional audio variants deterministically", async () => {
  const root = await mkdtemp(join(tmpdir(), "goobers-assets-"));
  try {
    await mkdir(join(root, "public/game-images"), { recursive: true });
    for (const name of [
      "portrait.PNG",
      "a space #?.jpg",
      "landscape.webp",
      "ignore.txt",
    ])
      await writeFile(
        join(root, "public/game-images", name.replace("?", "&")),
        "fixture",
      );
    execFileSync(process.execPath, [resolve("scripts/generate-assets.mjs")], {
      cwd: root,
    });
    const first = await readFile(
      join(root, "src/generated/assets.json"),
      "utf8",
    );
    const data = JSON.parse(first);
    expect(data.images).toHaveLength(3);
    expect(data.images).toContain("/game-images/a%20space%20%23%26.jpg");
    expect(data.announcer).toEqual({});
    execFileSync(process.execPath, [resolve("scripts/generate-assets.mjs")], {
      cwd: root,
    });
    expect(
      await readFile(join(root, "src/generated/assets.json"), "utf8"),
    ).toBe(first);
    await mkdir(join(root, "public/audio/announcer"), { recursive: true });
    for (const name of [
      "pin_of_shame_01.webm",
      "pin_of_shame_08.mp3",
      "pin_of_shame_120.ogg",
    ])
      await writeFile(join(root, "public/audio/announcer", name), "fixture");
    execFileSync(process.execPath, [resolve("scripts/generate-assets.mjs")], {
      cwd: root,
    });
    expect(
      JSON.parse(
        await readFile(join(root, "src/generated/assets.json"), "utf8"),
      ).announcer.pin_of_shame,
    ).toHaveLength(3);
  } finally {
    if (
      resolve(root).startsWith(resolve(tmpdir()) + "\\goobers-assets-") ||
      resolve(root).startsWith(resolve(tmpdir()) + "/goobers-assets-")
    )
      await rm(root, { recursive: true, force: true });
  }
});

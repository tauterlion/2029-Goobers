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
      "new image (2).JPEG",
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
    expect(data.images).toHaveLength(4);
    expect(data.images).toContain("/game-images/new%20image%20(2).JPEG");
    expect(data.sfx).toEqual({});
    expect(data.music).toEqual({});
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
    await mkdir(join(root, "public/audio/sfx"), { recursive: true });
    await mkdir(join(root, "public/audio/music"), { recursive: true });
    await writeFile(
      join(root, "public/audio/sfx/vote_select_02.wav"),
      "fixture",
    );
    await writeFile(join(root, "public/audio/music/lobby.ogg"), "fixture");
    execFileSync(process.execPath, [resolve("scripts/generate-assets.mjs")], {
      cwd: root,
    });
    expect(
      JSON.parse(
        await readFile(join(root, "src/generated/assets.json"), "utf8"),
      ).announcer.pin_of_shame,
    ).toHaveLength(3);
    const audio = JSON.parse(
      await readFile(join(root, "src/generated/assets.json"), "utf8"),
    );
    expect(audio.sfx.vote_select).toEqual(["/audio/sfx/vote_select_02.wav"]);
    expect(audio.music.lobby).toEqual(["/audio/music/lobby.ogg"]);
  } finally {
    if (
      resolve(root).startsWith(resolve(tmpdir()) + "\\goobers-assets-") ||
      resolve(root).startsWith(resolve(tmpdir()) + "/goobers-assets-")
    )
      await rm(root, { recursive: true, force: true });
  }
});

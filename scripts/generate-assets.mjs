import { readdir, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
async function scan(dir, extensions) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const result = [];
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) result.push(...(await scan(p, extensions)));
    else if (extensions.test(e.name))
      result.push(
        "/" +
          path
            .relative("public", p)
            .split(path.sep)
            .map(encodeURIComponent)
            .join("/"),
      );
  }
  return result.sort();
}
const images = await scan(
  "public/game-images",
  /\.(png|jpe?g|webp|gif|avif|svg)$/i,
);
async function audioMap(folder) {
  const result = {};
  for (const file of await scan(folder, /\.(webm|mp3|ogg|wav|m4a|aac)$/i)) {
    const cue = decodeURIComponent(file.split("/").at(-1))
      .replace(/\.[^.]+$/, "")
      .replace(/_\d+$/, "");
    (result[cue] ??= []).push(file);
  }
  return result;
}
const announcer = await audioMap("public/audio/announcer");
const sfx = await audioMap("public/audio/sfx");
const music = await audioMap("public/audio/music");
await mkdir("src/generated", { recursive: true });
await writeFile(
  "src/generated/assets.json",
  JSON.stringify({ images, announcer, sfx, music }, null, 2) + "\n",
);
console.log(
  `Indexed ${images.length} images, ${Object.keys(sfx).length} SFX cues, ${Object.keys(music).length} music tracks and ${Object.keys(announcer).length} optional voice cues.`,
);

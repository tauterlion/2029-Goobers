import { COPY } from "@/game/copy";
import { NextRequest, NextResponse } from "next/server";
import { createHash, randomInt } from "node:crypto";
import { z } from "zod";
import {
  act,
  join,
  newRoom,
  tick,
  view,
  connected,
  reconcilePresence,
  removalDue,
  normalizeLibrary,
  Action,
} from "@/game/engine";
import { create, load, mutate, local } from "@/lib/store";
import assets from "@/generated/assets.json";
export const runtime = "nodejs";
const schema = z.object({
  deck: z
    .object({
      mode: z.enum(["all", "blacklist", "whitelist"]),
      images: z.array(z.string().max(2000)).max(10000),
    })
    .optional(),
  type: z.string().max(30),
  code: z.string().max(8).optional(),
  token: z.string().uuid(),
  connection: z.string().uuid(),
  epoch: z.string().optional(),
  name: z.string().max(200).optional(),
  color: z.string().max(20).optional(),
  target: z.string().max(100).optional(),
  text: z.string().max(1500).optional(),
  image: z.string().max(2000).optional(),
  settings: z
    .object({
      rounds: z.number(),
      seconds: z.number(),
      mode: z.enum(["same", "different"]),
    })
    .optional(),
});
const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export async function POST(req: NextRequest) {
  try {
    if (
      req.headers.get("origin") &&
      req.headers.get("origin") !== req.nextUrl.origin
    )
      return NextResponse.json({ error: COPY.errors.origin }, { status: 403 });
    if (Number(req.headers.get("content-length")) > 1_000_000)
      return NextResponse.json({ error: COPY.errors.large }, { status: 413 });
    const a = schema.parse(await req.json());
    const secret = digest(a.token);
    const now = Date.now();
    if (a.type === "create") {
      const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      for (let i = 0; i < 5; i++) {
        const code = Array.from(
          { length: 5 },
          () => alphabet[randomInt(alphabet.length)],
        ).join("");
        const r = newRoom(code, now);
        const p = join(r, a.name ?? "", secret, a.connection, now);
        try {
          await create(r);
          return NextResponse.json({
            state: view(r, p.id, now, assets.images),
            local,
          });
        } catch (error) {
          if (
            (error as { code?: string }).code === "23505" ||
            (error as { code?: string }).code === "EEXIST"
          )
            continue;
          throw error;
        }
      }
      throw new Error(COPY.errors.create);
    }
    const code = (a.code ?? "").trim().toUpperCase();
    if (a.type === "read") {
      const r = await load(code);
      normalizeLibrary(r, assets.images);
      const p = r.players.find((p) => p.secret === secret);
      if (!p || removalDue(p, now)) throw new Error(COPY.errors.session);
      if (p.connection !== a.connection && connected(p, now))
        throw new Error(COPY.errors.duplicateSession);
      return NextResponse.json({
        state: view(r, p.id, now, assets.images),
        local,
      });
    }
    const { room, result } = await mutate(code, (r) => {
      reconcilePresence(r, now);
      normalizeLibrary(r, assets.images);
      let p = r.players.find((p) => p.secret === secret);
      if (!p) {
        if (a.type !== "join") return null;
        p = join(r, a.name ?? "", secret, a.connection, now);
      } else {
        if (p.connection !== a.connection && connected(p, now))
          throw new Error(COPY.errors.duplicateSession);
        p.connection = a.connection;
        p.seen = now;
        delete p.disconnectedAt;
      }
      tick(r, now, assets.images);
      if (a.type !== "join" && a.type !== "resume")
        act(r, p, a as Action, now, assets.images);
      return p.id;
    });
    if (!result) throw new Error(COPY.errors.session);
    return NextResponse.json({
      state: view(room, result, now, assets.images),
      local,
    });
  } catch (error) {
    const message =
      error instanceof z.ZodError
        ? COPY.errors.invalid
        : error instanceof Error
          ? error.message
          : COPY.errors.service;
    if (process.env.NODE_ENV !== "production") console.error(error);
    const code =
      Object.entries(COPY.errors).find(([, text]) => text === message)?.[0] ??
      "service";
    return NextResponse.json(
      { error: COPY.errors[code as keyof typeof COPY.errors], code },
      { status: 400 },
    );
  }
}

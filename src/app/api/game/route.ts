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
  Action,
} from "@/game/engine";
import { create, load, mutate, local } from "@/lib/store";
import assets from "@/generated/assets.json";
export const runtime = "nodejs";
const schema = z.object({
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
      return NextResponse.json(
        { error: "Please play from this site." },
        { status: 403 },
      );
    if (Number(req.headers.get("content-length")) > 10000)
      return NextResponse.json(
        { error: "That request is too large." },
        { status: 413 },
      );
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
          return NextResponse.json({ state: view(r, p.id, now), local });
        } catch (error) {
          if (
            (error as { code?: string }).code === "23505" ||
            (error as { code?: string }).code === "EEXIST"
          )
            continue;
          throw error;
        }
      }
      throw new Error("Could not create a room. Try again.");
    }
    const code = (a.code ?? "").trim().toUpperCase();
    if (a.type === "read") {
      const r = await load(code);
      const p = r.players.find((p) => p.secret === secret);
      if (!p) throw new Error("Your room session ended. Join again.");
      if (p.connection !== a.connection && connected(p, now))
        throw new Error("You're already playing in another tab or device.");
      return NextResponse.json({ state: view(r, p.id, now), local });
    }
    const { room, result } = await mutate(code, (r) => {
      let p = r.players.find((p) => p.secret === secret);
      if (!p) {
        if (a.type !== "join")
          throw new Error("Your room session ended. Join again.");
        p = join(r, a.name ?? "", secret, a.connection, now);
      } else {
        if (p.connection !== a.connection && connected(p, now))
          throw new Error("You're already playing in another tab or device.");
        p.connection = a.connection;
        p.seen = now;
      }
      tick(r, now, assets.images);
      if (a.type !== "join" && a.type !== "resume")
        act(r, p, a as Action, now, assets.images);
      return p.id;
    });
    return NextResponse.json({ state: view(room, result, now), local });
  } catch (error) {
    const message =
      error instanceof z.ZodError
        ? "That request looks unusual. Please try again."
        : error instanceof Error
          ? error.message
          : "Room service is taking a breather. Try again.";
    if (process.env.NODE_ENV !== "production") console.error(error);
    const safe =
      /^(Use |Give |Choose |Someone |This |We |Add |Only |The |Wait |Let |Nothing |Finish |Your |You|Unknown |Pens |Voting |Names |Room service |Could|That |Please)/.test(
        message,
      )
        ? message
        : "Room service is taking a breather. Try again.";
    return NextResponse.json({ error: safe }, { status: 400 });
  }
}

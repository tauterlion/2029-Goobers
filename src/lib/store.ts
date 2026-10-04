import { COPY } from "@/game/copy";
import "server-only";
import { createClient } from "@supabase/supabase-js";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { Room } from "@/game/engine";
export const local =
  process.env.LOCAL_GAME_STORE === "true" && !process.env.VERCEL;
export function db() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error(COPY.errors.setup);
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
const globals = globalThis as typeof globalThis & {
  roomQueue?: Promise<unknown>;
};
async function serial<T>(fn: () => Promise<T>): Promise<T> {
  const previous = globals.roomQueue ?? Promise.resolve();
  let done!: () => void;
  globals.roomQueue = new Promise<void>((r) => (done = r));
  await previous;
  try {
    return await fn();
  } finally {
    done();
  }
}
const filename = (code: string) => `.local-rooms/${code}.json`;
export async function load(code: string): Promise<Room> {
  if (!/^[A-Z2-9]{5}$/.test(code)) throw new Error(COPY.errors.notFound);
  if (local) {
    try {
      return JSON.parse(await readFile(filename(code), "utf8"));
    } catch {
      throw new Error(COPY.errors.notFound);
    }
  }
  const { data, error } = await db()
    .from("rooms")
    .select("state")
    .eq("code", code)
    .gt("last_activity_at", new Date(Date.now() - 21600000).toISOString())
    .single();
  if (error && error.code !== "PGRST116") throw new Error(COPY.errors.offline);
  if (!data) throw new Error(COPY.errors.notFound);
  return data.state as Room;
}
export async function create(r: Room) {
  if (local) {
    await mkdir(".local-rooms", { recursive: true });
    await writeFile(filename(r.code), JSON.stringify(r), { flag: "wx" });
    return;
  }
  const client = db();
  const { error } = await client
    .from("rooms")
    .insert({ id: r.id, code: r.code, version: r.version, state: r });
  if (error) throw error;
  await client.rpc("cleanup_stale_rooms");
}
async function commit(r: Room, version: number, notify: boolean) {
  r.version = version + 1;
  if (local) {
    await writeFile(filename(r.code) + ".tmp", JSON.stringify(r));
    await rename(filename(r.code) + ".tmp", filename(r.code));
    return true;
  }
  const { data, error } = await db().rpc("commit_room", {
    room_id: r.id,
    expected_version: version,
    new_state: r,
    notify_clients: notify,
  });
  if (error) throw error;
  return data === true;
}
export async function mutate<T>(
  code: string,
  fn: (r: Room) => T,
): Promise<{ room: Room; result: T }> {
  const work = async () => {
    for (let i = 0; i < 20; i++) {
      const r = await load(code);
      const version = r.version;
      const before = publicFingerprint(r);
      const result = fn(r);
      if (await commit(r, version, before !== publicFingerprint(r)))
        return { room: r, result };
      await new Promise((resolve) =>
        setTimeout(resolve, 10 + Math.random() * 30),
      );
    }
    throw new Error(COPY.errors.busy);
  };
  return local ? serial(work) : work();
}

// Lease renewals are persisted without fanning out twelve redundant reads.
// Explicit leaves, host changes and every gameplay mutation still notify.
function publicFingerprint(r: Room) {
  return JSON.stringify(r, (key, value) => {
    if (key === "connection") return undefined;
    if (key === "seen") return value === 0 ? 0 : 1;
    return value;
  });
}

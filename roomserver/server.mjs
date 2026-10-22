// The Build Room server: serves /room over the rooms in ~/FyxerGh/build-room. Started by `/sf:room start`
// (scripts/roomui). Plain Node, no dependencies, no build step.
//
//   node server.mjs [--room <state dir>]...      BUILD_ROOM_PORT (default 7790), BUILD_ROOM_HOST (default 127.0.0.1)
import { createServer } from "node:http";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createBuildRoom, roomDirsFrom } from "./buildroom.mjs";

const CLAUDE = join(homedir(), ".claude");
const SESSIONS = join(CLAUDE, "sessions");
const PROJECTS = join(CLAUDE, "projects");
const PORT = Number(process.env.BUILD_ROOM_PORT || 7790);
const HOST = process.env.BUILD_ROOM_HOST || "127.0.0.1";

const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null; // a registry file mid-write
  }
};

const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

// Claude Code writes one ~/.claude/sessions/<pid>.json per running session; a dead pid's file can linger.
export const listLiveSessions = (dir = SESSIONS) =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((file) => file.endsWith(".json"))
        .map((file) => readJson(join(dir, file)))
        .filter((e) => e?.sessionId && e.name && e.pid && isAlive(e.pid))
        .map((e) => ({ name: e.name, sessionId: e.sessionId, cwd: e.cwd ?? "", status: e.status ?? "unknown" }))
    : [];

export const findTranscript = (sessionId, dir = PROJECTS) => {
  if (!existsSync(dir)) return null;
  for (const slug of readdirSync(dir)) {
    const path = join(dir, slug, `${sessionId}.jsonl`);
    if (existsSync(path)) return path;
  }
  return null;
};

// Tokens in the context window after one transcript entry: the last iteration's input, cache writes and cache reads.
export const contextOf = (entry) => {
  const usage = entry.message?.usage;
  if (!usage) return 0;
  const last = (Array.isArray(usage.iterations) ? usage.iterations.at(-1) : null) ?? usage;
  return (last.input_tokens ?? 0) + (last.cache_creation_input_tokens ?? 0) + (last.cache_read_input_tokens ?? 0);
};

if (import.meta.filename === process.argv[1]) {
  const room = createBuildRoom({
    dirs: roomDirsFrom(process.argv.slice(2), process.env),
    port: PORT,
    host: HOST,
    sessionsDir: SESSIONS,
    listLiveSessions,
    findTranscript,
    contextOf,
  });
  const server = createServer((req, res) => {
    if (room.handle(req, res, new URL(req.url, "http://localhost"))) return;
    if (req.url === "/") return void res.writeHead(302, { location: "/room" }).end();
    res.writeHead(404).end("not found");
  });
  server.on("error", (err) => {
    console.error(err.code === "EADDRINUSE" ? `build room: ${HOST}:${PORT} is already in use` : `build room: ${err.message}`);
    process.exit(1);
  });
  server.listen(PORT, HOST, () => {
    console.log(`build room on http://${HOST}:${PORT}/room: ${[...room.runs.values()].map((r) => r.dir).join(", ") || "no state dirs"}`);
  });
}

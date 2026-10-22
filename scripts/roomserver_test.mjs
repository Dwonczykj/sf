// The Build Room server: its session helpers, and a real run that serves the page and records an answer.
// node scripts/roomserver_test.mjs
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listLiveSessions, findTranscript, contextOf } from "../roomserver/server.mjs";

const ROOT = join(import.meta.dirname, "..");
const home = mkdtempSync(join(tmpdir(), "roomserver-"));
try {
  // A live session file is listed; a dead pid's is not.
  const sessions = join(home, "sessions");
  mkdirSync(sessions);
  writeFileSync(join(sessions, "1.json"), JSON.stringify({ pid: process.pid, sessionId: "s-live", name: "w1", status: "busy" }));
  writeFileSync(join(sessions, "2.json"), JSON.stringify({ pid: 2 ** 22 + 7, sessionId: "s-dead", name: "w2" }));
  writeFileSync(join(sessions, "3.json"), "{ half written");
  assert.deepEqual(listLiveSessions(sessions).map((s) => s.name), ["w1"]);

  const projects = join(home, "projects");
  mkdirSync(join(projects, "-Users-x-repo"), { recursive: true });
  writeFileSync(join(projects, "-Users-x-repo", "s-live.jsonl"), "");
  assert.equal(findTranscript("s-live", projects), join(projects, "-Users-x-repo", "s-live.jsonl"));
  assert.equal(findTranscript("nope", projects), null);

  assert.equal(contextOf({ message: { usage: { input_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 10 } } }), 115);
  assert.equal(contextOf({ message: { usage: { input_tokens: 1, iterations: [{ input_tokens: 2 }, { input_tokens: 3, cache_read_input_tokens: 4 }] } } }), 7);
  assert.equal(contextOf({}), 0);

  // A room with one open card, served from a home with nothing else in it.
  const room = join(home, "FyxerGh", "build-room", "demo");
  mkdirSync(room, { recursive: true });
  const ask = execFileSync("python3", [join(ROOT, "scripts", "room"), "ask", "--dir", room, "--ticket", "s1", "--header", "Retry",
    "--question", "Retry on 429?", "--option", "Retry", "Back off", "--option", "Fail", "Fail fast"], { encoding: "utf8" });
  const qid = JSON.parse(ask).id;
  const port = 17790 + Math.floor(Math.random() * 1000);
  const server = spawn("node", [join(ROOT, "roomserver", "server.mjs")], { env: { ...process.env, HOME: home, BUILD_ROOM_PORT: String(port) } });
  try {
    await new Promise((ok, fail) => {
      server.stdout.on("data", (d) => String(d).includes("build room on") && ok());
      server.on("exit", (code) => fail(new Error(`server exited ${code}`)));
      setTimeout(() => fail(new Error("server did not start")), 10_000);
    });
    const base = `http://127.0.0.1:${port}`;
    const page = await (await fetch(`${base}/room`)).text();
    const token = page.match(/[a-f0-9]{48}/)?.[0];
    assert.ok(token, "the page carries this launch's token");
    assert.equal((await fetch(`${base}/room/room.js`)).status, 200);
    assert.equal((await fetch(`${base}/`, { redirect: "manual" })).headers.get("location"), "/room");

    const answer = (headers) => fetch(`${base}/api/room/answer`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: base, "x-room-token": token, ...headers },
      body: JSON.stringify({ run: "demo", question: qid, labels: ["Retry"], text: "" }),
    });
    assert.equal((await answer({ "x-room-token": "wrong" })).status, 403);
    assert.equal((await answer({})).status, 200);
    const signed = readFileSync(join(room, "signoffs.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual([signed.at(-1).question, signed.at(-1).answer], [qid, "Retry"]);
    await new Promise((ok) => setTimeout(ok, 800)); // the server learns of the answer from its watch on events.jsonl
    assert.equal((await answer({})).status, 409, "a second answer to the same card is refused");
  } finally {
    server.kill();
  }
  console.log("roomserver_test: ok");
} finally {
  rmSync(home, { recursive: true, force: true });
}

// Build Room: Board, Ticket, Ledger and Room views over one or more sf:orchestrate state dirs.
// Reads events.jsonl, tickets.json, ledger.md, signoffs.jsonl and prs.json, watches them with fs.watch and pushes
// changes over SSE. Writes nothing itself: Joey's answers and messages go through `room signoff`, and the Refresh
// button runs `room prs`, so each file's format lives in the CLI alone.
import { watch, readFileSync, existsSync, statSync, readdirSync, openSync, readSync, closeSync } from "node:fs";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { join, basename, dirname, resolve } from "node:path";
import { homedir } from "node:os";

const HOME = homedir();
export const BUILD_ROOM_HOME = join(HOME, "FyxerGh", "build-room");
const ROOM_CLI = join(import.meta.dirname, "..", "scripts", "room"); // the same plugin version as this server
const PLUGINS_INDEX = join(HOME, ".claude", "plugins", "installed_plugins.json");
const USER_SKILLS = join(HOME, ".claude", "skills");
const TRANSCRIPT_TAIL_BYTES = 1_000_000;
const MAX_BODY = 16_000;
const CHAT_TAIL_BYTES = 400_000;
const CHAT_MESSAGES = 20;
const CHAT_TEXT_MAX = 1500;
const PRS_TIMEOUT_MS = 300_000; // `room prs` reads each PR one at a time
const ROOM_NAME = /^[A-Za-z0-9][\w.-]{0,63}$/; // a room is a dir under build-room, never a path
const LOOPBACK = new Set(["127.0.0.1", "::ffff:127.0.0.1"]);

const readText = (path) => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
};

const parseJsonl = (text) =>
  text
    .split("\n")
    .filter((line) => line.trim())
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });

// Reads whole lines appended since cursor.offset. A file that shrank was rewritten: start over.
const tail = (path, cursor) => {
  let size;
  try {
    size = statSync(path).size;
  } catch {
    return { lines: [], reset: false };
  }
  const reset = size < cursor.offset;
  if (reset) cursor.offset = 0;
  if (size === cursor.offset) return { lines: [], reset };
  const fd = openSync(path, "r");
  const buffer = Buffer.alloc(size - cursor.offset);
  readSync(fd, buffer, 0, buffer.length, cursor.offset);
  closeSync(fd);
  const end = buffer.lastIndexOf(10);
  if (end === -1) return { lines: [], reset };
  cursor.offset += end + 1;
  return { lines: parseJsonl(buffer.subarray(0, end + 1).toString("utf8")), reset };
};

// Dirs from --room flags and BUILD_ROOM_DIRS (colon separated), plus every run under ~/FyxerGh/build-room.
export const roomDirsFrom = (argv, env) => {
  const named = [];
  argv.forEach((arg, i) => {
    if (arg === "--room" && argv[i + 1]) named.push(argv[i + 1]);
    else if (arg.startsWith("--room=")) named.push(arg.slice(7));
  });
  named.push(...(env.BUILD_ROOM_DIRS ?? "").split(":").filter(Boolean));
  const found = existsSync(BUILD_ROOM_HOME)
    ? readdirSync(BUILD_ROOM_HOME, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => join(BUILD_ROOM_HOME, d.name))
        .filter((d) => existsSync(join(d, "events.jsonl")) || existsSync(join(d, "tickets.json")))
    : [];
  return [...new Set([...named, ...found].map((d) => resolve(d.replace(/^~(?=\/|$)/, HOME))))];
};

const frontmatter = (path) => {
  const text = readText(path);
  const match = text?.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const out = {};
  const lines = match[1].split("\n");
  lines.forEach((line, i) => {
    const kv = line.match(/^(name|description):\s*(.*)$/);
    if (!kv) return;
    let value = kv[2].trim();
    if (value === "|" || value === ">" || value === ">-" || value === "|-") {
      const block = [];
      for (let j = i + 1; j < lines.length && /^\s+/.test(lines[j]); j += 1) block.push(lines[j].trim());
      value = block.join(" ");
    }
    out[kv[1]] = value.replace(/^["']|["']$/g, "");
  });
  return out;
};

const listDirs = (path) => {
  try {
    return readdirSync(path, { withFileTypes: true });
  } catch {
    return [];
  }
};

const skillsIn = (root, prefix) =>
  listDirs(root)
    .filter((d) => d.isDirectory() || d.isSymbolicLink())
    .flatMap((d) => {
      const file = join(root, d.name, "SKILL.md");
      if (!existsSync(file)) return [];
      const fm = frontmatter(file);
      return [{ name: `${prefix}${fm.name ?? d.name}`, description: fm.description ?? "" }];
    });

const commandsIn = (root, prefix) =>
  listDirs(root)
    .filter((d) => d.name.endsWith(".md"))
    .map((d) => ({ name: `${prefix}${basename(d.name, ".md")}`, description: frontmatter(join(root, d.name)).description ?? "" }));

// Harness built-ins (/model, /compact, /clear) live in none of these places, so the list never has them.
const listSkills = (repo) => {
  const plugins = Object.entries(JSON.parse(readText(PLUGINS_INDEX) ?? "{}").plugins ?? {}).flatMap(([key, installs]) => {
    const path = installs?.[0]?.installPath;
    if (!path) return [];
    const prefix = `${key.split("@")[0]}:`;
    return [...skillsIn(join(path, "skills"), prefix), ...commandsIn(join(path, "commands"), prefix)];
  });
  const all = [...skillsIn(USER_SKILLS, ""), ...(repo ? skillsIn(join(repo, ".claude", "skills"), "") : []), ...plugins];
  const seen = new Set();
  return all
    .filter((s) => !seen.has(s.name) && seen.add(s.name))
    .map((s) => ({ ...s, description: s.description.slice(0, 200) }))
    .sort((a, b) => a.name.localeCompare(b.name));
};

const gitRoot = (start) => {
  for (let dir = start; dir && dir !== dirname(dir); dir = dirname(dir)) {
    if (existsSync(join(dir, ".git"))) return dir;
  }
  return null;
};

export const createBuildRoom = ({ dirs, port, host, sessionsDir, listLiveSessions, findTranscript, contextOf }) => {
  const token = randomBytes(24).toString("hex");
  const cli = process.env.ROOM_CLI || ROOM_CLI;

  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `${host}:${port}`]);
  const origins = new Set([...hosts].map((h) => `http://${h}`));
  const clients = new Set();
  const broadcast = (payload) => {
    const data = `data: ${JSON.stringify(payload)}\n\n`;
    for (const res of clients) res.write(data);
  };

  const runs = new Map();
  const known = new Set(); // every dir added, so a re-scan only adds what is new
  const addRun = (dir) => {
    if (!existsSync(dir)) {
      console.warn(`build room: ${dir} does not exist, skipped`);
      return;
    }
    known.add(dir);
    let id = basename(dir);
    for (let n = 2; runs.has(id); n += 1) id = `${basename(dir)}-${n}`;
    const run = {
      id,
      dir,
      tickets: null,
      ticketsError: null,
      ticketsBytes: 0,
      events: [],
      signoffs: [],
      ledger: null,
      prs: null,
      context: null,
      cursors: { events: { offset: 0 }, signoffs: { offset: 0 } },
    };
    runs.set(id, run);
    return run;
  };
  for (const dir of dirs) addRun(dir);

  const loadTickets = (run) => {
    const text = readText(join(run.dir, "tickets.json"));
    run.ticketsBytes = text?.length ?? 0;
    try {
      run.tickets = text ? JSON.parse(text) : null;
      run.ticketsError = null;
    } catch (error) {
      // A half-written file: keep the last good queue on screen and say why it is stale.
      run.ticketsError = `tickets.json does not parse: ${error.message}`;
    }
  };

  const orchestratorContext = (run) => {
    const name = run.tickets?.orchestrator;
    if (!name) return null;
    const live = listLiveSessions().find((s) => s.name === name);
    const transcript = live && findTranscript(live.sessionId);
    if (!transcript) return { session: name, live: false, tokens: null };
    const size = statSync(transcript).size;
    const fd = openSync(transcript, "r");
    const length = Math.min(size, TRANSCRIPT_TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, size - length);
    closeSync(fd);
    const lines = buffer.toString("utf8").split("\n");
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      if (!lines[i].includes('"usage"')) continue;
      try {
        const tokens = contextOf(JSON.parse(lines[i]));
        if (tokens) return { session: name, live: true, status: live.status, tokens };
      } catch {
        // a torn first line of the tail
      }
    }
    return { session: name, live: true, status: live.status, tokens: null };
  };

  const refresh = (run, name) => {
    if (name === "prs.json") {
      // `room prs` replaces it whole; a torn read keeps the last good one
      const text = readText(join(run.dir, name));
      try {
        run.prs = text ? JSON.parse(text) : null;
      } catch {
        return;
      }
      broadcast({ type: "prs", run: run.id, prs: run.prs });
    } else if (name === "events.jsonl" || name === "signoffs.jsonl") {
      const key = name === "events.jsonl" ? "events" : "signoffs";
      const { lines, reset } = tail(join(run.dir, name), run.cursors[key]);
      if (reset) run[key] = [];
      if (!lines.length && !reset) return;
      run[key].push(...lines);
      broadcast({ type: key, run: run.id, [key]: reset ? run[key] : lines, reset });
    } else {
      if (name === "tickets.json") {
        loadTickets(run);
        broadcast({ type: "tickets", run: run.id, tickets: run.tickets, ticketsError: run.ticketsError, ticketsBytes: run.ticketsBytes });
      } else {
        run.ledger = readText(join(run.dir, "ledger.md"));
        broadcast({ type: "ledger", run: run.id, ledger: run.ledger });
      }
      // The orchestrator rewrites these on every wake, so its context moves with them. No timer.
      run.context = orchestratorContext(run);
      broadcast({ type: "context", run: run.id, context: run.context });
    }
  };

  const FILES = ["events.jsonl", "signoffs.jsonl", "tickets.json", "ledger.md", "prs.json"];
  const start = (run) => {
    for (const name of FILES) refresh(run, name);
    const pending = new Map();
    // Watch the dir, not the files: tickets.json and ledger.md are replaced, not edited in place.
    watch(run.dir, (_event, name) => {
      for (const file of name ? [String(name)].filter((n) => FILES.includes(n)) : FILES) {
        clearTimeout(pending.get(file));
        pending.set(file, setTimeout(() => refresh(run, file), 40));
      }
    });
  };
  for (const run of runs.values()) start(run);

  const sessionList = () => listLiveSessions().map((s) => ({ name: s.name, status: s.status }));
  if (existsSync(sessionsDir)) {
    let timer = null;
    watch(sessionsDir, () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        broadcast({ type: "sessions", sessions: sessionList() });
        for (const run of runs.values()) {
          run.context = orchestratorContext(run);
          broadcast({ type: "context", run: run.id, context: run.context });
        }
      }, 200);
    });
  }

  const snapshot = () => ({
    type: "snapshot",
    runs: [...runs.values()].map(({ cursors, ...run }) => run),
    sessions: sessionList(),
  });

  // A room made while the server runs (`room new`, `room adopt`) is added without a restart: on a change under
  // build-room, and whenever a page connects. The --room and BUILD_ROOM_DIRS dirs are already known.
  const rescan = () => {
    const added = roomDirsFrom([], {}).filter((dir) => !known.has(dir)).map(addRun).filter(Boolean);
    for (const run of added) start(run);
    if (added.length) broadcast(snapshot());
  };
  if (existsSync(BUILD_ROOM_HOME)) {
    let timer = null;
    // the dir appears before its files do, so look again a moment later
    watch(BUILD_ROOM_HOME, () => {
      clearTimeout(timer);
      timer = setTimeout(() => { rescan(); setTimeout(rescan, 2000); }, 300);
    });
  }

  const repoOf = (run) =>
    gitRoot(run.dir) ??
    (run.tickets?.tickets ?? []).map((t) => t.worktree).find((w) => w && existsSync(join(w, ".git"))) ??
    null;

  const answered = (run, id) => run.events.some((e) => e.type === "answer" && e.note?.startsWith(`re ${id}:`));
  const oneLine = (text) => String(text ?? "").replace(/\s+/g, " ").trim();
  const inFlight = new Set();

  const answer = (body, done) => {
    const run = runs.get(body?.run);
    if (!run) return done(400, { error: "unknown run" });
    const text = oneLine(body.text).slice(0, 2000);
    let args;
    if (body.question != null) {
      const id = Number(body.question);
      const question = run.events.find((e) => e.type === "question" && e.id === id);
      if (!question?.ask) return done(400, { error: `no question ${body.question} in ${run.id}` });
      if (answered(run, id) || inFlight.has(`${run.id}:${id}`)) return done(409, { error: "already answered" });
      const offered = question.ask.options.map((o) => o.label);
      const labels = Array.isArray(body.labels) ? body.labels.map(String) : [];
      if (labels.some((l) => !offered.includes(l))) return done(400, { error: "pick from the question's options" });
      if (labels.length > 1 && !question.ask.multiSelect) return done(400, { error: "this question takes one option" });
      if (!labels.length && !text) return done(400, { error: "pick an option or type a reply" });
      const picked = labels.join(", ");
      args = ["--ticket", question.ticket, "--question", String(id),
        "--answer", (picked || `Other: ${text}`).slice(0, 500), "--quote", text || picked];
      inFlight.add(`${run.id}:${id}`);
    } else {
      if (!text) return done(400, { error: "empty message" });
      // A message can name the ticket it is about (the PRs tab's Address all); only a ticket the room has.
      const ticket = (run.tickets?.tickets ?? []).some((t) => t.id === body.ticket) ? body.ticket : "all";
      args = ["--ticket", ticket, "--message", "--quote", text];
    }
    execFile("python3", [cli, "signoff", "--dir", run.dir, ...args], { timeout: 15_000 }, (error, stdout, stderr) => {
      if (body.question != null) inFlight.delete(`${run.id}:${Number(body.question)}`);
      if (error) return done(400, { error: (stderr || error.message).trim() });
      done(200, { ok: true, line: JSON.parse(stdout) });
    });
  };

  // Undo: reopen an answered card. `room reopen` re-asks the question, so every reader shows a fresh open card.
  const reopen = (body, done) => {
    const run = runs.get(body?.run);
    const id = Number(body?.question);
    if (!run || !Number.isInteger(id)) return done(400, { error: "unknown run or question" });
    execFile("python3", [cli, "reopen", "--dir", run.dir, "--question", String(id)], { timeout: 15_000 }, (error, stdout, stderr) =>
      error ? done(400, { error: (stderr || error.message).trim() }) : done(200, { ok: true }));
  };

  // The last messages of one session, for judging whether a card is stale. Text turns only, newest last.
  const chat = (url, done) => {
    const run = runs.get(url.searchParams.get("run"));
    const name = url.searchParams.get("session");
    const live = run && name && listLiveSessions().find((s) => s.name === name);
    const transcript = live && findTranscript(live.sessionId);
    if (!transcript) return done(200, { session: name, messages: [] });
    const size = statSync(transcript).size;
    const length = Math.min(size, CHAT_TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    const fd = openSync(transcript, "r");
    readSync(fd, buffer, 0, length, size - length);
    closeSync(fd);
    const messages = [];
    for (const line of buffer.toString("utf8").split("\n")) {
      let e;
      try { e = JSON.parse(line); } catch { continue; } // a torn first line of the tail
      if (e.type !== "user" && e.type !== "assistant") continue;
      const c = e.message?.content;
      const text = (typeof c === "string" ? c : (c ?? []).filter((b) => b.type === "text").map((b) => b.text).join("\n"))
        .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim();
      if (text && !text.startsWith("<")) messages.push({ role: e.type, ts: e.timestamp, text: text.slice(0, CHAT_TEXT_MAX) });
    }
    done(200, { session: name, messages: messages.slice(-CHAT_MESSAGES) });
  };

  // Refresh: run `room prs` for one room, a fixed argv and no shell. The page gets prs.json from the file watch.
  const checking = new Set();
  const refreshPrs = (body, done) => {
    const name = body?.run;
    const run = typeof name === "string" && ROOM_NAME.test(name) ? runs.get(name) : null;
    if (!run) return done(400, { error: "unknown room" });
    if (checking.has(run.id)) return done(409, { error: "already checking GitHub for this room" });
    checking.add(run.id);
    execFile("python3", [cli, "prs", "--dir", run.dir], { timeout: PRS_TIMEOUT_MS }, (error, stdout, stderr) => {
      checking.delete(run.id);
      if (error) return done(502, { error: oneLine(stderr || error.message).slice(0, 300) });
      done(200, { ok: true, line: oneLine(stdout) });
    });
  };

  const json = (res, code, payload) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(payload));
  };

  // Returns true when it handled the request.
  const handle = (req, res, url) => {
    const ours = url.pathname === "/room" || url.pathname === "/room/room.js" || url.pathname.startsWith("/api/room/");
    if (!ours) return false;
    // A page on another site can reach localhost, and DNS rebinding can make it look same-origin.
    // Refuse any Host but ours, and any write without our Origin and this launch's token.
    if (!hosts.has(req.headers.host)) {
      res.writeHead(403).end("wrong host");
      return true;
    }

    if (url.pathname === "/room/room.js") {
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
      res.end(readFileSync(join(import.meta.dirname, "room.js"), "utf8"));
      return true;
    }

    if (url.pathname === "/room") {
      const page = readFileSync(join(import.meta.dirname, "room.html"), "utf8").replace("__ROOM_TOKEN__", token);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(page);
      return true;
    }

    if (url.pathname === "/api/room/stream") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      rescan();
      res.write(`data: ${JSON.stringify(snapshot())}\n\n`);
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return true;
    }

    if (url.pathname === "/api/room/skills") {
      const run = runs.get(url.searchParams.get("run"));
      json(res, 200, listSkills(run ? repoOf(run) : null));
      return true;
    }

    if (url.pathname === "/api/room/chat") {
      chat(url, (code, payload) => json(res, code, payload));
      return true;
    }

    const write = { "/api/room/answer": answer, "/api/room/reopen": reopen, "/api/room/prs-refresh": refreshPrs }[url.pathname];
    if (write) {
      if (req.method !== "POST") return json(res, 405, { error: "POST only" }), true;
      // Only a browser on this machine: the server may be bound wider by HOST, the Refresh button never is.
      if (url.pathname === "/api/room/prs-refresh" && !LOOPBACK.has(req.socket.localAddress)) {
        return json(res, 403, { error: "refresh is served on 127.0.0.1 only" }), true;
      }
      if (!origins.has(req.headers.origin)) return json(res, 403, { error: "wrong origin" }), true;
      if (req.headers["x-room-token"] !== token) return json(res, 403, { error: "bad token" }), true;
      if (!String(req.headers["content-type"]).startsWith("application/json")) {
        return json(res, 415, { error: "send JSON" }), true;
      }
      let raw = "";
      req.on("data", (chunk) => {
        raw += chunk;
        if (raw.length > MAX_BODY) req.destroy();
      });
      req.on("end", () => {
        let body;
        try {
          body = JSON.parse(raw);
        } catch {
          return json(res, 400, { error: "bad JSON" });
        }
        write(body, (code, payload) => json(res, code, payload));
      });
      return true;
    }

    res.writeHead(404).end("not found");
    return true;
  };

  return { handle, runs };
};

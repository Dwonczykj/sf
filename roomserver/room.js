// Build Room: Board, Ticket, Ledger and Room views over the state dirs the server watches.
// Every bit of free text from the state files goes through h() before it reaches innerHTML.
const h = (text) => String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clip = (text, n) => (!text ? "" : text.length > n ? `${text.slice(0, n - 1)}…` : text);
const fmtTokens = (n) => (n > 1e6 ? `${(n / 1e6).toFixed(1)}M` : n > 1e3 ? `${(n / 1e3).toFixed(0)}k` : `${n}`);
const hashOf = (text) => {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  return Math.abs(hash);
};

const TOKEN = document.querySelector('meta[name="room-token"]').content;
const FORK_AT = 500_000; // orchestrate.md forks the orchestrator here
const GATES = [
  ["framed", "Framed"], ["requirements", "Requirements"], ["grilled", "Grilled"], ["impact", "Impact sized"],
  ["steward", "Steward review"], ["split", "Split"], ["spec", "Spec"], ["planReview", "Plan review"],
  ["gate", "Pre-PR gate"], ["ci", "CI and bots"], ["complexity", "Complexity review"],
];
// Gates room start and room render check against signoffs.jsonl; a value in tickets.json alone doesn't pass them.
const HUMAN = new Set(["requirements", "split", "spec", "complexity"]);
const DONE_VALUE = /^(true|done|passed|pass|ok|signed|green|release|released|yes|plan ok)\b/i;
const SKIP_VALUE = /^(none|n\/a|skip|skipped)$/i;
const COLUMNS = [
  { id: "shaping", name: "Shaping", color: "#6e44d8", states: [], rule: "Requirements, grill, impact and steward review. Nothing builds until you sign." },
  { id: "queued", name: "Queued", color: "#98a2b3", states: ["NOT STARTED"], rule: "Signed off. Starts when its \"after\" list is met and a builder is free." },
  { id: "building", name: "Building", color: "#0a5bd3", states: ["BUILDING", "LOCAL", "PROBE", "FACTORY"], rule: "One session per ticket, in its own worktree, or a factory run. Max 3 local." },
  { id: "ci", name: "CI and bots", color: "#0e9384", states: ["PUSHED", "DRAFT PR", "PR"], rule: "Pushed. The worker watches CI and threads and fixes, simplifies or asks." },
  { id: "call", name: "Your call", color: "#d97706", states: ["WAITING ON JOEY", "COMPLEXITY REVIEW", "DONE"], rule: "Waiting on you: an answer, the steward's cuts, or a merge." },
  { id: "merged", name: "Merged or done", color: "#5b34c0", states: ["MERGED"], rule: "In staging, or a finished task." },
];
const TONE = {
  amber: ["rgba(217,119,6,.14)", "#92400e"], blue: ["rgba(10,91,211,.12)", "#0a4fb8"], teal: ["rgba(14,147,132,.12)", "#0b6b60"],
  green: ["rgba(31,138,76,.13)", "#166534"], purple: ["rgba(110,68,216,.12)", "#5b34c0"], grey: ["rgba(15,23,42,.07)", "#344054"],
  red: ["rgba(192,54,44,.12)", "#9f1f16"],
};
const STATE_TONE = {
  "WAITING ON JOEY": "amber", BUILDING: "blue", LOCAL: "blue", FACTORY: "blue", PUSHED: "teal", "DRAFT PR": "teal", PR: "teal",
  "COMPLEXITY REVIEW": "purple", DONE: "green", MERGED: "purple",
};
// Topic-room tasks (sf's room CLI, TASKS): no gates, no PR; a DONE one is finished, not waiting on a merge.
const TASK_KINDS = new Set(["explore", "investigate", "plan", "design", "prototype", "size", "evaluate", "measure"]);
const isTask = (t) => TASK_KINDS.has(t.kind);
const PALETTE = ["#0a5bd3", "#0e9384", "#6e44d8", "#d97706", "#c0362c", "#3f2a8c", "#1f8a4c", "#b8502a"];

const storage = {
  get: (key) => { try { return localStorage.getItem(key); } catch { return null; } },
  set: (key, value) => { try { localStorage.setItem(key, value); } catch { /* private window */ } },
};

const store = {
  runs: new Map(),
  sessions: [],
  skills: [],
  skillsFor: null,
  run: new URLSearchParams(location.search).get("room") || storage.get("build-room-run"),
  picks: new Map(), // "run:q" -> Set of labels, for multi-select questions
  sending: new Set(),
  errors: new Map(),
  macOpen: new Set(),
  mode: "card", // what the composer sends: a reply to the selected card, or a plain message to the orchestrator
  sel: null, // the selected card, "run:question"; the first open card when null or no longer open
  chatOpen: false,
  roomMenu: false, // the header's room menu is open
  qodoOpen: new Set(), // "run|pr key" whose Qodo findings are expanded
  addressed: new Set(), // "run|pr key" already sent to the orchestrator with Address all
  menu: { hi: 0, closed: false },
  history: null, // the feature the merge-history modal shows ("" for all), or null when it is closed
  checking: new Set(), // runs whose Refresh is running
  showMerged: new Set(), // runs whose PRs tab also lists merged PRs
  allMerged: new Set(), // runs whose Merged stage shows every card, not the newest 12
  sheet: false, // the Board's inbox sheet is open
  revealed: null, // the open stage tile last scrolled into view
};

// ---------------------------------------------------------------- derived
const ticketsOf = (run) => run?.tickets?.tickets ?? [];
const isAnswered = (run, id) => run.events.some((e) => e.type === "answer" && e.note?.startsWith(`re ${id}:`));
// Joey's latest answer to a question that has not been reopened: what Undo takes back.
const undoable = (run) => {
  const s = [...run.signoffs].reverse().find((x) => x.question && isAnswered(run, x.question) && !run.events.some((e) => e.reopens === x.question));
  return s ? { q: s.question, ticket: s.ticket } : null;
};
const openQuestions = (run) => run.events.filter((e) => e.type === "question" && e.ask && !isAnswered(run, e.id));
const allOpen = () => [...store.runs.values()].flatMap((run) => openQuestions(run).map((q) => ({ run, q })));
const currentRun = () => store.runs.get(store.run) ?? [...store.runs.values()][0] ?? null;
const sessionOf = (name) => store.sessions.find((s) => s.name === name);
const colourOf = (name) => PALETTE[hashOf(String(name ?? "")) % PALETTE.length];
const initials = (name) => String(name ?? "?").split(/[-_\s]+/).map((s) => s[0] ?? "").join("").slice(0, 2).toUpperCase() || "?";
const toneChip = (tone, text, cls = "chip sm") => {
  const [bg, fg] = TONE[tone] ?? TONE.grey;
  return `<span class="${cls}" style="background:${bg};color:${fg}">${h(text)}</span>`;
};
const columnOf = (t) =>
  (isTask(t) && t.state === "DONE" ? COLUMNS.find((c) => c.id === "merged") : null) ??
  COLUMNS.find((c) => t.queue && [c.id, c.name.toLowerCase()].includes(String(t.queue).toLowerCase())) ??
  COLUMNS.find((c) => c.states.includes(t.state)) ??
  COLUMNS[1];

const fmtTime = (ts) => {
  if (!ts) return "";
  const d = new Date(ts);
  const hm = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString() ? hm : `${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })} ${hm}`;
};

// A feature's gates are signed for "all" with that feature (none in a room with its contract at the root);
// complexity and a light build's own contract are signed per ticket. Same rule as the room CLI's signed().
const signedLine = (run, gate, t) =>
  run.signoffs.find((s) => s.gate === gate && (s.ticket === t.id ||
    (gate !== "complexity" && t.kind !== "light" && s.ticket === "all" && (s.feature ?? null) === (t.feature ?? null))));

const gateStatus = (run, t, gate) => {
  const value = t.gates?.[gate];
  // a ticket adopted from another run keeps its gates in that run, so only its values show here
  const human = HUMAN.has(gate) && !t.source;
  const line = human && signedLine(run, gate, t);
  if (line) return { s: "done", who: `you, ${fmtTime(line.ts)}`, detail: line.quote };
  if (gate === "spec" && SKIP_VALUE.test(String(value ?? "none"))) return { s: "skip", who: "", detail: "No spec requested." };
  if (SKIP_VALUE.test(String(value ?? ""))) return { s: "skip", who: "", detail: "Skipped." };
  if (human) return { s: "todo", who: "you", detail: value ? `${value}; no sign-off in signoffs.jsonl yet.` : "No sign-off in signoffs.jsonl yet." };
  if (value === true || DONE_VALUE.test(String(value ?? ""))) return { s: "done", who: "", detail: typeof value === "string" ? value : "" };
  return { s: "todo", who: "", detail: value ? String(value) : "" };
};

const gatesOf = (run, t) => {
  const list = GATES.map(([id, name]) => ({ id, name, ...gateStatus(run, t, id) }));
  const waiting = t.state === "WAITING ON JOEY" || openQuestions(run).some((q) => q.ticket === t.id);
  const next = list.find((g) => g.s === "todo");
  if (next && waiting) next.s = "wait";
  return list;
};

const lastModelEvent = (run, id) => run.events.filter((e) => e.ticket === id && e.type === "model").at(-1);
const modelOf = (run, t) => {
  if (t.model) return [t.model, t.effort].filter(Boolean).join(" · ");
  const e = lastModelEvent(run, t.id);
  return e ? e.note.split(":")[0] : "";
};
const modelTone = (model) => (/opus/i.test(model) ? "purple" : "teal");

const shellQuote = (s) => (/^[\w/.:@%+=-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

// Links back to the sessions behind a card: the ticket's worker and the orchestrator that asked. The ids are the
// desktop app's own (tickets.json: sessionId per ticket, orchestratorSessionId for the run); anything else gets no link.
const SESSION_ID = /^local_[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const sessionLink = (who, label) => {
  if (!who?.name) return "";
  if (!SESSION_ID.test(String(who.id ?? ""))) return `<span class="muted small">${h(label)} ${h(who.name)}: session id not recorded</span>`;
  return `<a class="btn ghost" style="display:inline-flex;align-items:center;text-decoration:none" href="claude://claude.ai/epitaxy/${h(who.id)}" title="Opens ${h(who.name)} in the Claude app">${h(label)} ${h(who.name)}</a>`;
};
const sessionLinks = (run, ticketId, from) => {
  const t = ticketsOf(run).find((x) => x.id === ticketId);
  const orch = run.tickets?.orchestrator ? { name: run.tickets.orchestrator, id: run.tickets.orchestratorSessionId } : null;
  // `from`: the session behind a card (room ask --from-name/--from-session), such as where a light build came from
  const row = [sessionLink(from?.name ? { name: from.name, id: from.sessionId } : null, "Open"),
    sessionLink(t?.session ? { name: t.session, id: t.sessionId } : null, "Open session"), sessionLink(orch, "Open orchestrator")].filter(Boolean).join("");
  return row ? `<div class="row" style="flex-wrap:wrap;gap:6px">${row}</div>` : "";
};

// Sessions Joey started by hand that `room join` added: the latest join event per session, kept while no ticket
// carries that session (by id, or by name when the join had none) and always for a watcher.
const joinedSessions = (run) => {
  const latest = new Map();
  for (const e of run.events) if (e.type === "join" && e.name) latest.set(e.sessionId || e.name, e);
  return [...latest.values()].filter((e) => {
    const watching = e.ticket === "all" && !e.newTitle;
    const assigned = ticketsOf(run).some((t) => (e.sessionId ? t.sessionId === e.sessionId : t.session === e.name));
    return watching || !assigned;
  });
};

const unassignedStrip = (run) => {
  const joined = joinedSessions(run);
  if (!joined.length) return "";
  const wants = (e) => (e.newTitle ? `new ticket: ${clip(e.newTitle, 40)}` : e.ticket === "all" ? "watching" : `joining ${e.ticket}`);
  return `<div class="glass panel" style="margin-bottom:12px">
    <div class="muted small" style="font-weight:600;margin-bottom:8px">Unassigned sessions</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px">${joined.map((e) => `<div class="card" style="padding:8px 10px;display:flex;flex-direction:column;gap:6px;min-width:200px">
      <div class="row"><span class="who"><span class="ini" style="background:${colourOf(e.name)}">${h(initials(e.name))}</span><span>${h(e.name)}</span></span>${toneChip("grey", wants(e))}</div>
      ${sessionLink({ name: e.name, id: e.sessionId }, "Open session")}
    </div>`).join("")}</div>
  </div>`;
};

// ---------------------------------------------------------------- header
// One header on every view: the room as a title that opens a menu of rooms, and the tabs. The counts the old
// headers carried sit on the tabs: cards waiting on you on Room, open PRs on PRs.
const renderHead = (run, route) => {
  const runs = [...store.runs.values()];
  const badge = (n, warn) => (n ? `<span class="tab-n${warn ? " warn" : ""}">${n}</span>` : "");
  const tabs = [["board", "Board"], ["room", "Room", badge(run ? openQuestions(run).length : 0, true)], ["ledger", "Ledger"],
    ["prs", "PRs", badge(run ? unmerged(run).length : 0)]]
    .map(([id, name, n = ""]) => `<a href="#${id}" class="${route.view === id || (id === "board" && route.view === "ticket") ? "on" : ""}">${name}${n}</a>`)
    .join("");
  const head = document.getElementById("head");
  if (!run) {
    head.innerHTML = `<div class="room-name">Build Room</div><span class="muted small">No rooms yet. Start one with /sf:orchestrate or /sf:room new &lt;topic&gt;.</span>`;
    return;
  }
  const others = runs.filter((r) => r !== run).reduce((n, r) => n + openQuestions(r).length, 0);
  const switcher = runs.length > 1
    ? `<details class="rooms" id="room-menu"${store.roomMenu ? " open" : ""}><summary aria-label="Switch room"><span class="room-name">${h(run.id)}</span>${badge(others, true)}
        <svg class="chev" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 5l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path></svg></summary>
        <div class="room-list" role="menu">${runs.map((r) => `<button type="button" role="menuitemradio" aria-checked="${r === run}" class="${r === run ? "on" : ""}" data-act="pick-room" data-run="${h(r.id)}"><span>${h(r.id)}</span>${badge(openQuestions(r).length, true)}</button>`).join("")}</div></details>`
    : `<div class="room-name">${h(run.id)}</div>`;
  head.innerHTML = `${switcher}<nav aria-label="Views">${tabs}</nav>`;
};

// ---------------------------------------------------------------- pull requests
// prs.json, written by sf's `room prs` alone: every PR the room built, read from GitHub, the unmerged ones in merge order.
const prsOf = (run) => (Array.isArray(run.prs?.prs) ? run.prs.prs : []);
const unmerged = (run) => prsOf(run).filter((e) => e.state === "OPEN").sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
const mergedPrs = (run) => prsOf(run).filter((e) => e.state === "MERGED" && e.mergedAt);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const ago = (iso) => {
  const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (!Number.isFinite(min)) return "";
  return min < 1 ? "just now" : min < 60 ? `${min} min ago` : min < 1440 ? `${Math.round(min / 60)} h ago` : `${Math.round(min / 1440)} d ago`;
};
const span = (ms) => {
  const hours = Math.round(ms / 3_600_000);
  return hours < 1 ? "under an hour" : hours < 48 ? plural(hours, "hour") : plural(Math.round(hours / 24), "day");
};
const groupOf = (e) => e.feature ?? "No feature";
const webUrl = (url) => (/^https:\/\//.test(String(url ?? "")) ? url : "#"); // GitHub's own, never another scheme
const sessionHref = (e) => (SESSION_ID.test(String(e.sessionId ?? "")) ? `claude://claude.ai/epitaxy/${e.sessionId}` : null);

const historyModal = (run) => {
  const all = mergedPrs(run).sort((a, b) => String(b.mergedAt).localeCompare(String(a.mergedAt)));
  const groups = [...new Set(all.map(groupOf))];
  const shown = all.filter((e) => !store.history || groupOf(e) === store.history);
  const days = new Map();
  for (const e of shown) {
    const day = new Date(e.mergedAt).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
    days.set(day, [...(days.get(day) ?? []), e]);
  }
  const item = (e) => {
    const by = e.builtBy === "factory" ? "the factory" : e.mergedBy ?? "someone";
    const open = e.createdAt ? ` · ${span(Date.parse(e.mergedAt) - Date.parse(e.createdAt))} open` : "";
    const href = sessionHref(e);
    return `<div class="hist-item">
      <div class="hist-tick"><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.2l2.3 2.3L9.5 3.5" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path></svg></div>
      <div style="flex:1 1 260px;min-width:0;display:flex;flex-direction:column;gap:3px">
        <div style="display:flex;gap:8px;align-items:baseline;min-width:0"><a class="pr-num" data-pr="${h(run.id)}|${h(e.key)}" href="${h(webUrl(e.url))}" target="_blank" rel="noopener">#${h(e.number)}</a><span style="font-weight:600;overflow-wrap:anywhere">${h(e.title)}</span></div>
        <div class="muted small">${h(`${groupOf(e)} · merged by ${by}${open}`)}</div>
      </div>
      <div class="hist-links" style="display:flex;gap:10px;flex:none">
        ${e.linearUrl ? `<a class="pr-link" href="${h(webUrl(e.linearUrl))}" target="_blank" rel="noopener">Linear</a>` : e.linearIssue ? `<span class="muted small">${h(e.linearIssue)}</span>` : ""}
        ${href ? `<a class="pr-link" href="${h(href)}">Session</a>` : ""}
      </div>
    </div>`;
  };
  const filter = (value, label) => `<button type="button" class="chip${store.history === value ? " on" : ""}" data-act="prs-filter" data-feature="${h(value)}">${h(label)}</button>`;
  return `<div class="modal-bg" data-act="prs-close">
    <div class="modal" role="dialog" aria-modal="true" aria-label="Merge history">
      <div style="display:flex;align-items:center;gap:10px"><h2 style="font-size:16px;flex:1">Merge history</h2>
        <button type="button" class="modal-x" data-act="prs-close" aria-label="Close"><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2 2l10 10M12 2L2 12" stroke="#0b1220" stroke-width="1.8" stroke-linecap="round"></path></svg></button></div>
      ${groups.length > 1 ? `<div class="chips">${filter("", "All features")}${groups.map((g) => filter(g, g)).join("")}</div>` : ""}
      <div class="hist">${shown.length ? [...days].map(([day, list]) => `<div class="hist-day">${h(day)}</div>${list.map(item).join("")}`).join("") : `<div class="muted">Nothing merged yet.</div>`}</div>
    </div>
  </div>`;
};

// ---------------------------------------------------------------- board
// One stage of the pipeline is open at a time. A stage's cards are its tickets, each joined to its PR from prs.json,
// in merge order; an open PR that no ticket names is kept in "CI and bots" so nothing in prs.json goes unseen.
const prFor = (run, t) => prsOf(run).find((e) => e.ticket === t.id || (t.pr != null && String(e.number) === String(t.pr)));
const featureOf = ({ t, e }) => t?.feature ?? e?.feature ?? null;

const stageItems = (run, c) => {
  const tickets = ticketsOf(run);
  const items = tickets.filter((t) => columnOf(t) === c).map((t) => ({ t, e: prFor(run, t) }));
  if (c.id === "ci") {
    const named = new Set(tickets.map((t) => prFor(run, t)));
    items.push(...unmerged(run).filter((e) => !named.has(e)).map((e) => ({ t: null, e })));
  }
  if (c.id === "merged") return items.sort((a, b) => String(b.e?.mergedAt ?? "").localeCompare(String(a.e?.mergedAt ?? ""))); // newest first
  return items.sort((a, b) => (a.e?.order ?? 1e9) - (b.e?.order ?? 1e9));
};

const MERGED_SHOWN = 12;

// The "Pull requests" view: every unmerged PR in merge order, each joined to the ticket that names it.
const PRS_STAGE = { id: "prs", name: "Pull requests", rule: "Every unmerged PR in merge order, across all stages." };
const prsItems = (run) => unmerged(run).map((e) => ({ t: ticketsOf(run).find((t) => prFor(run, t) === e) ?? null, e }));

const stageKey = (run) => `build-room-stage:${run.id}`;
const openStage = (run, stages) => {
  const saved = storage.get(stageKey(run));
  if (saved === "prs" || stages.some((s) => s.c.id === saved)) return saved;
  return ["call", "ci", "building", "queued", "shaping"].find((id) => stages.find((s) => s.c.id === id).items.length) ?? "call";
};

const HUMAN_STATES = new Set(["WAITING ON JOEY", "COMPLEXITY REVIEW"]);
const sentence = (s) => `${s[0]}${s.slice(1).toLowerCase()}`.replace(/\bjoey\b/, "you");
// [phrase, tone]: the one thing to know about a card
const phraseOf = (t, e) => {
  if (t && HUMAN_STATES.has(t.state)) return [sentence(t.state), STATE_TONE[t.state]];
  if (e) {
    const ci = e.ci ?? {};
    if (e.state === "MERGED") return ["Merged", "purple"];
    if (ci.failed) return [`CI failed: ${[...new Set(ci.failing ?? [])].join(", ") || plural(ci.failed, "check")}`, "red"];
    if (e.draft) return ["Draft", "grey"];
    if (e.ready) return ["Ready to merge", "green"];
    if (e.next) return ["Next to merge", "green"];
    if (ci.running) return ["Waiting on checks", "amber"];
    if (e.builtBy === "factory") return ["Factory", "blue"];
    return ["Waiting its turn", "grey"];
  }
  return [t.state === "FACTORY" ? "Factory" : sentence(t.state), STATE_TONE[t.state] ?? "grey"];
};

const factsOf = (run, t, e) => {
  const num = (key) => `#${String(key).split("#").at(-1)}`;
  const bits = [];
  if (e?.state === "MERGED") {
    bits.push(`merged ${fmtTime(e.mergedAt)}`, e.builtBy === "factory" ? "by the factory" : e.mergedBy && `by ${e.mergedBy}`);
  } else if (e) {
    const ci = e.ci ?? { passed: 0, failed: 0, running: 0 };
    const states = (e.reviews ?? []).map((r) => r.state);
    const approved = states.filter((x) => x === "APPROVED").length;
    bits.push(
      ci.failed ? `${plural(ci.failed, "check")} failing` : ci.running ? `CI running ${ci.running} of ${ci.passed + ci.failed + ci.running}` : ci.passed ? "CI green" : "no CI",
      states.includes("CHANGES_REQUESTED") ? "changes requested" : approved ? `approved by ${approved}` : "no review yet",
      plural((e.threads?.bots ?? 0) + (e.threads?.humans ?? 0), "open thread"),
      e.mergeable === "CONFLICTING" && "merge conflict",
      e.behind && `${e.behind} behind ${e.base}`,
      e.stacksOn && `stacks on ${num(e.stacksOn)}`,
      e.waitsOn?.length ? `waits on ${e.waitsOn.join(", ")}` : e.mergesAfter?.length && `merges after ${e.mergesAfter.map(num).join(", ")}`,
    );
  } else {
    const gate = !isTask(t) && ["shaping", "queued"].includes(columnOf(t).id) && gatesOf(run, t).find((g) => g.s === "todo" || g.s === "wait");
    bits.push(t.ci && `CI ${t.ci}`, gate && `next gate: ${gate.name}`, t.after?.length && `after ${t.after.join(", ")}`, t.needs?.length && `needs ${t.needs.join(", ")}`);
  }
  if (t?.source) bits.push(`read-only, from ${String(t.source).split("/").filter(Boolean).at(-1)}`);
  const lead = bits.filter(Boolean).join(" · ");
  const note = t?.note ? clip(t.note, 160) : "";
  return lead && note ? `${lead}. ${note}` : lead || note;
};

const stageCard = (run, item) => {
  const { t, e } = item;
  const [state, tone] = phraseOf(t, e);
  const prNum = e?.number ?? t?.pr;
  const prUrl = webUrl(e?.url ?? t?.prUrl);
  const session = sessionHref({ sessionId: t?.sessionId ?? e?.sessionId });
  const dot = e?.ready ? "var(--green)" : e?.waitsOn?.length ? "var(--mute)" : "var(--blue)";
  return `<article class="scard">
    <div class="scard-top">
      ${e?.order != null ? `<span class="nth" style="background:${dot}">${h(e.order)}</span>` : ""}
      ${prNum ? `<span class="pr-num" style="color:var(--blue)"${e?.key ? ` data-pr="${h(run.id)}|${h(e.key)}"` : ""}>#${h(prNum)}</span>` : ""}
      ${t ? `<span class="muted small">${h(t.id)}</span>` : ""}
      <span class="grow"></span><span class="scard-state" style="color:${TONE[tone][1]}">${h(state)}</span>
    </div>
    <div class="scard-title">${h(t?.title ?? e.title)}</div>
    <div class="scard-line">${h(factsOf(run, t, e))}</div>
    <div class="scard-links">
      ${session ? `<a href="${h(session)}" title="Opens ${h(t?.session ?? e?.session ?? "the session")} in the Claude app">Open session</a>` : ""}
      ${prUrl !== "#" ? `<a href="${h(prUrl)}" target="_blank" rel="noopener"${e?.key ? ` data-pr="${h(run.id)}|${h(e.key)}"` : ""}>Open PR</a>` : ""}
      <span class="grow"></span>
      ${t ? `<a href="#ticket/${encodeURIComponent(t.id)}" style="color:var(--ink-2)">Details</a>` : ""}
    </div>
  </article>`;
};

const staleBanner = (run) => (run.ticketsError ? `<div class="card q err" style="margin-bottom:12px">${h(run.ticketsError)}. Showing the last good queue.</div>` : "");

const stageSection = (run, { c, items }) => {
  const doc = run.prs;
  const busy = store.checking.has(run.id);
  const checked = doc?.checkedAt ? `Checked on GitHub ${ago(doc.checkedAt)}` : "Not checked on GitHub yet";
  const failed = store.errors.get(`prs:${run.id}`);
  const features = new Set([...ticketsOf(run).map((t) => t.feature), ...prsOf(run).map((e) => e.feature)].filter(Boolean));
  const capped = c.id === "merged" && items.length > MERGED_SHOWN && !store.allMerged.has(run.id);
  const shown = capped ? items.slice(0, MERGED_SHOWN) : items;
  const grid = (list) => `<div class="sgrid">${list.map((item) => stageCard(run, item)).join("")}</div>`;
  const names = [...new Set(shown.map(featureOf))].sort((a, b) => Number(a === null) - Number(b === null));
  const body = !items.length ? `<div class="muted">${c.id === "prs" ? "No unmerged pull requests." : `Nothing in ${h(c.name)} right now.`}</div>`
    : features.size > 1 ? names.map((f) => `<div class="sgroup"><h3>${f ? h(f) : "No feature"}</h3>${grid(shown.filter((i) => featureOf(i) === f))}</div>`).join("")
      : grid(shown);
  const more = capped ? `<div class="stage-more"><button type="button" class="btn ghost" data-act="merged-all" data-run="${h(run.id)}">Show all ${items.length} merged</button><span class="muted small">Newest ${MERGED_SHOWN} shown</span></div>` : "";
  return `<section class="stage" aria-label="${h(c.name)}">
    <div class="stage-head"><h2>${h(c.name)}</h2><span class="muted small">${h(c.rule)}</span><span class="grow"></span>
      ${["building", "ci", "call", "merged", "prs"].includes(c.id) ? `<span class="muted small">${h(checked)}</span>
      <button type="button" class="btn ghost" data-act="prs-refresh" data-run="${h(run.id)}"${busy ? " disabled" : ""}>${busy ? "Checking…" : "Refresh"}</button>` : ""}
    </div>
    ${doc?.error ? `<div class="err">${h(doc.error)}</div>` : ""}
    ${failed ? `<div class="err">${h(failed)}</div>` : ""}
    ${body}${more}
  </section>`;
};

// The PRs tab: open and draft PRs in merge order, then tickets with no PR yet, then (toggled) merged PRs, newest first.
const BOT_NAME = { "chatgpt-codex-connector": "Codex", cursor: "Cursor", "qodo-code-review": "Qodo", coderabbitai: "CodeRabbit", copilot: "Copilot" };
const prNum = (key) => `#${String(key).split("#").at(-1)}`;
const LEVELS = [["high", "High"], ["medium", "Medium"], ["low", "Low"]];
// Qodo's line opens to the findings still open (the resolved ones are left out), with a link to its review and an
// Address all button that asks the orchestrator to have the ticket's worker fix or refute every one.
const qodoLine = (q, e, run, t) => {
  const counts = LEVELS.map(([k, name]) => q[k] && `${q[k]} ${name.toLowerCase()}`).filter(Boolean).join(", ");
  const edited = q.editedAt ? ` · edited ${ago(q.editedAt)}` : "";
  const findings = q.findings ?? [];
  const tone = q.needs ? "var(--red)" : "var(--green)";
  if (!findings.length) {
    return `<a href="${h(webUrl(q.url))}" target="_blank" rel="noopener" style="color:${tone}">Qodo: clear${q.low ? `, ${q.low} low` : ""}</a><span class="muted">${h(edited)}</span>`;
  }
  const key = `${run.id}|${e.key}`;
  const groups = LEVELS.map(([k, name]) => {
    const list = findings.filter((f) => f.level === k);
    return list.length ? `<div class="qodo-level">${name}</div><ol>${list.map((f) => `<li>${h(f.title)}</li>`).join("")}</ol>` : "";
  }).join("");
  const sent = store.addressed.has(key);
  return `<details class="qodo" data-key="${h(key)}"${store.qodoOpen.has(key) ? " open" : ""}>
    <summary><b style="color:${tone}">Qodo: ${q.needs ? `${q.needs} to fix` : "nothing to fix"}</b> <span>(${h(counts)})</span><span class="muted">${h(edited)}</span></summary>
    <div class="qodo-body">${groups}
      ${q.trimmed ? `<div class="muted small">Qodo trimmed ${q.trimmed} lower-severity findings from its comment, so they are only on GitHub.</div>` : ""}
      <div class="qodo-actions"><a href="${h(webUrl(q.url))}" target="_blank" rel="noopener">Open Qodo's review</a>
        <button type="button" class="btn" data-act="address-all" data-run="${h(run.id)}" data-key="${h(key)}" data-ticket="${h(t?.id ?? "")}"${sent ? " disabled" : ""}>${sent ? "Sent to the orchestrator" : "Address all"}</button></div>
      ${store.errors.get(`addr:${key}`) ? `<div class="err">${h(store.errors.get(`addr:${key}`))}</div>` : ""}
    </div></details>`;
};
const botLine = (e, run, t) => {
  const q = e.qodo;
  const parts = [];
  if (q) parts.push(qodoLine(q, e, run, t));
  for (const [bot, b] of Object.entries(e.botThreads ?? {})) {
    const name = BOT_NAME[bot] ?? bot;
    parts.push(`<span style="color:var(--red)">${h(name)}: ${b.open} open ${b.open === 1 ? "thread" : "threads"}</span> ${b.urls.map((u, i) => `<a href="${h(webUrl(u))}" target="_blank" rel="noopener">${i + 1}</a>`).join(" ")}`);
  }
  return parts.length ? parts.join(" · ") : `<span class="muted">No bot comments</span>`;
};
const dependsLine = (e, t) => {
  const deps = [e?.stacksOn && `${prNum(e.stacksOn)} (stack)`, ...(e?.mergesAfter ?? []).filter((k) => k !== e.stacksOn).map(prNum), ...(e?.waitsOn ?? []), ...(!e ? (t?.after ?? []) : []), !e && t?.stacksOn].filter(Boolean);
  return deps.length ? `Depends on ${[...new Set(deps)].join(", ")}` : "";
};
const prCard = (run, e, t) => {
  const [state, tone] = phraseOf(t, e);
  const merged = e.state === "MERGED";
  const ci = e.ci ?? {};
  const states = (e.reviews ?? []).map((r) => r.state);
  const status = merged ? [`merged ${fmtTime(e.mergedAt)}`, e.builtBy === "factory" ? "by the factory" : e.mergedBy && `by ${e.mergedBy}`]
    : [ci.failed ? `${plural(ci.failed, "check")} failing` : ci.running ? "CI running" : ci.passed ? "CI green" : "no CI",
      states.includes("CHANGES_REQUESTED") ? "changes requested" : states.includes("APPROVED") ? "approved" : "no review yet",
      e.mergeable === "CONFLICTING" && "merge conflict", e.behind && `${e.behind} behind ${e.base}`];
  const depends = dependsLine(e, t);
  return `<article class="scard">
    <div class="scard-top">
      ${e.order != null ? `<span class="nth" style="background:${e.ready ? "var(--green)" : "var(--blue)"}">${h(e.order)}</span>` : ""}
      <a class="pr-num" data-pr="${h(run.id)}|${h(e.key)}" href="${h(webUrl(e.url))}" target="_blank" rel="noopener">#${h(e.number)}</a>
      ${t ? `<span class="muted small">${h(t.id)}</span>` : ""}
      <span class="grow"></span><span class="scard-state" style="color:${TONE[tone][1]}">${h(state)}</span>
    </div>
    <div class="scard-title">${h(e.title)}</div>
    <div class="scard-line">${h(status.filter(Boolean).join(" · "))}</div>
    ${depends ? `<div class="scard-line">${h(depends)}</div>` : ""}
    ${merged ? "" : `<div class="scard-line">${botLine(e, run, t)}</div>`}
  </article>`;
};
const unbuiltCard = (run, t) => {
  const [state, tone] = phraseOf(t, null);
  const depends = dependsLine(null, t);
  return `<article class="scard">
    <div class="scard-top"><span class="muted small">${h(t.id)}</span><span class="grow"></span><span class="scard-state" style="color:${TONE[tone][1]}">${h(state)}</span></div>
    <div class="scard-title">${h(t.title)}</div>
    <div class="scard-line">No PR yet${depends ? ` · ${h(depends)}` : ""}</div>
    <div class="scard-links"><span class="grow"></span><a href="#ticket/${encodeURIComponent(t.id)}" style="color:var(--ink-2)">Details</a></div>
  </article>`;
};
const prsView = (run) => {
  const open = unmerged(run);
  const unbuilt = ticketsOf(run).filter((t) => !isTask(t) && !prFor(run, t) && !["MERGED", "DONE"].includes(t.state));
  const merged = mergedPrs(run).sort((a, b) => String(b.mergedAt).localeCompare(String(a.mergedAt)));
  const showMerged = store.showMerged.has(run.id);
  const doc = run.prs;
  const busy = store.checking.has(run.id);
  const failed = store.errors.get(`prs:${run.id}`);
  const tix = (e) => ticketsOf(run).find((t) => prFor(run, t) === e) ?? null;
  const grid = (cards) => `<div class="sgrid">${cards.join("")}</div>`;
  const section = (title, rule, cards, empty) => `<section class="stage"><div class="stage-head"><h2>${title}</h2><span class="muted small">${rule}</span></div>${cards.length ? grid(cards) : `<div class="muted">${empty}</div>`}</section>`;
  return `${staleBanner(run)}<div class="stage-head" style="margin-bottom:12px"><span class="muted small">${h(doc?.checkedAt ? `Checked on GitHub ${ago(doc.checkedAt)}` : "Not checked on GitHub yet")}</span><span class="grow"></span>
      <button type="button" class="chip" data-act="prs-history">Merge history</button>
      <button type="button" class="chip${showMerged ? " on" : ""}" data-act="prs-merged" data-run="${h(run.id)}" aria-pressed="${showMerged}">Show merged (${merged.length})</button>
      <button type="button" class="btn ghost" data-act="prs-refresh" data-run="${h(run.id)}"${busy ? " disabled" : ""}>${busy ? "Checking…" : "Refresh"}</button></div>
    ${doc?.error ? `<div class="err">${h(doc.error)}</div>` : ""}${failed ? `<div class="err">${h(failed)}</div>` : ""}
    ${section("Open and draft", "In merge order: a PR another depends on comes first.", open.map((e) => prCard(run, e, tix(e))), "No unmerged pull requests.")}
    ${section("Not built yet", "Tickets with no PR. They merge after what they depend on.", unbuilt.map((t) => unbuiltCard(run, t)), "Every ticket has a PR.")}
    ${showMerged ? section("Merged", "Newest first.", merged.map((e) => prCard(run, e, tix(e))), "Nothing merged yet.") : ""}
    ${store.history !== null ? historyModal(run) : ""}`;
};

// Hovering (or focusing) a PR link shows what GitHub said last: title, state, review, CI, conflicts, threads.
const prPopHtml = (e) => {
  const ci = e.ci ?? { passed: 0, failed: 0, running: 0, failing: [] };
  const reviews = e.reviews ?? [];
  const approved = reviews.filter((r) => r.state === "APPROVED").map((r) => r.login);
  const changes = reviews.filter((r) => r.state === "CHANGES_REQUESTED").map((r) => r.login);
  const line = (tone, text) => `<div class="pp-line" style="color:${TONE[tone][1]}">${h(text)}</div>`;
  const rows = [];
  const state = e.state === "MERGED" ? `Merged ${fmtTime(e.mergedAt)}${e.mergedBy ? ` by ${e.mergedBy}` : ""}` : e.state === "CLOSED" ? "Closed" : e.draft ? "Draft" : "Open";
  rows.push(line(e.state === "MERGED" ? "purple" : "grey", `${state} · ${e.head} into ${e.base}`));
  rows.push(changes.length ? line("red", `Changes requested by ${changes.join(", ")}`)
    : approved.length ? line("green", `Approved by ${approved.join(", ")}`) : line("amber", "Not approved: no approving review yet"));
  if (e.state === "OPEN") {
    rows.push(ci.failed ? line("red", `CI failed: ${[...new Set(ci.failing ?? [])].join(", ") || plural(ci.failed, "check")}`)
      : ci.running ? line("amber", `CI running: ${ci.running} of ${ci.passed + ci.failed + ci.running} checks`)
        : ci.passed ? line("green", "CI passed") : line("grey", "No CI checks"));
    if (e.mergeable === "CONFLICTING") rows.push(line("red", "Merge conflict with the base branch"));
    if (e.behind) rows.push(line("amber", `${e.behind} commits behind ${e.base}`));
    const humans = e.threads?.humans ?? 0;
    const bots = e.threads?.bots ?? 0;
    if (humans + bots) rows.push(line("amber", `Unresolved: ${[humans && plural(humans, "human thread"), bots && plural(bots, "bot thread")].filter(Boolean).join(", ")}`));
    if (e.qodo?.needs) rows.push(line("red", `Qodo: ${e.qodo.needs} Medium or High issue${e.qodo.needs === 1 ? "" : "s"} to fix`));
    const waits = [e.stacksOn && `${prNum(e.stacksOn)} (stack)`, ...(e.mergesAfter ?? []).filter((k) => k !== e.stacksOn).map(prNum), ...(e.waitsOn ?? [])].filter(Boolean);
    if (waits.length) rows.push(line("grey", `Merges after ${waits.join(", ")}`));
    if (e.ready) rows.push(line("green", "Ready to merge"));
  }
  return `<b>#${h(e.number)} ${h(e.title)}</b>${rows.join("")}<div class="muted small" style="margin-top:6px">${h(e.state === "OPEN" && !e.ready ? "As of the last check on GitHub" : "")}</div>`;
};
const pop = document.getElementById("pr-pop");
const showPop = (el) => {
  const [runId, key] = el.dataset.pr.split("|");
  const e = prsOf(store.runs.get(runId) ?? {}).find((x) => x.key === key);
  if (!e) return;
  pop.innerHTML = prPopHtml(e);
  pop.classList.add("on");
  const r = el.getBoundingClientRect();
  const p = pop.getBoundingClientRect();
  const below = r.bottom + 8 + p.height < window.innerHeight;
  pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - p.width - 8))}px`;
  pop.style.top = `${below ? r.bottom + 8 : Math.max(8, r.top - p.height - 8)}px`;
};
const hidePop = () => pop.classList.remove("on");
document.addEventListener("mouseover", (ev) => { const el = ev.target.closest?.("[data-pr]"); if (el) showPop(el); });
document.addEventListener("mouseout", (ev) => { if (ev.target.closest?.("[data-pr]")) hidePop(); });
document.addEventListener("focusin", (ev) => { const el = ev.target.closest?.("[data-pr]"); if (el) showPop(el); });
document.addEventListener("focusout", hidePop);
document.addEventListener("scroll", hidePop, true);

const boardView = (run) => {
  if (!run.tickets) return `<div class="glass panel"><h2>No queue yet</h2><div class="muted">${h(run.dir)} has no tickets.json. The orchestrator writes it when it starts the build.</div></div>`;
  const stages = COLUMNS.map((c) => ({ c, items: stageItems(run, c) }));
  const open = openStage(run, stages);
  const tile = ({ c, items }) => `<button type="button" class="tile${c.id === open ? " on" : ""}" data-act="stage" data-stage="${c.id}" data-run="${h(run.id)}"${c.id === open ? ' aria-current="step"' : ""}>
    <span class="tile-name">${c.id === "merged" ? "Merged" : h(c.name)}</span><b>${items.length}</b></button>`;
  return `${staleBanner(run)}${unassignedStrip(run)}
    <nav class="pipe" aria-label="Pipeline">${stages.map(tile).join("")}</nav>
    ${stageSection(run, open === "prs" ? { c: PRS_STAGE, items: prsItems(run) } : stages.find((s) => s.c.id === open))}${store.history !== null ? historyModal(run) : ""}`;
};

// ---------------------------------------------------------------- ticket
const pad = (s, n) => String(s ?? "").padEnd(n);
const budgetRows = (budget) => {
  const rows = Array.isArray(budget) ? budget : Object.entries(budget).map(([label, v]) => (Array.isArray(v) ? { label, actual: v[0], limit: v[1] } : { label, ...v }));
  return rows.map((b) => `<div class="card stat"><div class="k">${h(b.label)}</div><div class="v" style="color:${Number(b.actual) > Number(b.limit) ? "#9f1f16" : "#166534"}">${h(b.actual ?? "?")}<span class="muted" style="font-size:13px"> / ${h(b.limit ?? "?")}</span></div></div>`).join("");
};

const ticketView = (run, route) => {
  const t = ticketsOf(run).find((x) => x.id === route.id);
  if (!t) return `<div class="glass panel"><h2>No ticket ${h(route.id)}</h2><a href="#board">Back to the board</a></div>`;
  const gates = gatesOf(run, t);
  const model = modelOf(run, t);
  const sub = [t.id, t.pr && `#${t.pr}`, t.stacksOn && `stacks on ${t.stacksOn}`, t.after?.length && `after: ${t.after.join(", ")}`, t.needs?.length && `needs ${t.needs.join(", ")}`].filter(Boolean).join(" · ");
  const switches = run.events.filter((e) => e.ticket === t.id && e.type === "model");
  const lines = [
    ...run.events.filter((e) => e.ticket === t.id && e.type !== "answer").map((e) => ({ ts: e.ts, text: `${pad(fmtTime(e.ts), 13)} ${pad(e.role, 13)} ${pad(e.type, 9)} ${e.note}${e.sha ? `  ${e.sha}` : ""}` })),
    ...run.signoffs.filter((s) => s.ticket === t.id).map((s) => ({ ts: s.ts, text: `${pad(fmtTime(s.ts), 13)} ${pad("you", 13)} ${pad("signoff", 9)} ${s.gate ?? (s.question ? `re ${s.question}` : "message")}: "${s.quote}"` })),
  ].sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
  return `<div style="display:flex;flex-direction:column;gap:16px">
    <header class="glass" style="padding:16px 18px">
      <a href="#board" style="font-size:13px;font-weight:600;text-decoration:none">Board</a><span style="color:#98a2b3"> /</span>
      <div style="flex:1 1 360px;min-width:0"><div class="muted small" style="font-weight:600">${h(sub)}</div><h1 style="margin-top:2px;font-size:22px">${h(t.title)}</h1></div>
      ${toneChip(STATE_TONE[t.state] ?? "grey", t.state, "chip")}
      ${t.ci ? toneChip(/green|pass/i.test(t.ci) ? "green" : /red|fail/i.test(t.ci) ? "red" : "blue", `CI ${t.ci}${t.sha ? ` at ${String(t.sha).slice(0, 7)}` : ""}`, "chip") : ""}
      ${t.session ? toneChip("grey", `Session ${t.session}`, "chip") : ""}
      ${model ? toneChip(modelTone(model), model, "chip") : ""}
    </header>
    ${staleBanner(run)}
    <div class="split">
      <section class="glass panel" aria-label="Gate ladder" style="flex:1 1 380px;gap:4px">
        <h2 style="margin-bottom:6px">Gate ladder</h2>
        <div class="muted" style="font-size:12px;line-height:1.4;margin-bottom:8px">A human gate passes only when your line is in signoffs.jsonl; room start reads that, not the orchestrator's memory.</div>
        ${gates.map((g) => `<div class="rung"><div class="rung-rail"><span class="rung-dot" style="background:${g.s === "done" ? "#1f8a4c" : g.s === "wait" ? "#d97706" : "#98a2b3"}">${g.s === "done" ? "✓" : g.s === "wait" ? "!" : g.s === "skip" ? "–" : ""}</span><span class="rung-line"></span></div>
          <div style="flex:1;padding-bottom:12px;min-width:0"><div class="row" style="align-items:baseline"><span style="font-size:13px;font-weight:600">${h(g.name)}</span><span class="muted small">${h(g.who)}</span></div>
          <div class="muted" style="font-size:12px;line-height:1.35">${h(g.detail)}</div></div></div>`).join("")}
      </section>
      <div style="flex:999 1 560px;min-width:0;display:flex;flex-direction:column;gap:16px">
        <section class="glass panel" aria-label="Steward's budget">
          <div class="row" style="align-items:baseline;flex-wrap:wrap"><h2>Steward's budget</h2><span class="muted" style="font-size:12px">Set at shaping, checked on the green PR</span></div>
          ${t.budget ? `<div class="stats">${budgetRows(t.budget)}</div>` : `<div class="muted">Not set. The steward sets it at shaping as the ticket's <span class="mono">budget</span> field.</div>`}
        </section>
        <section class="glass panel" aria-label="Model routing">
          <div class="row" style="align-items:baseline;flex-wrap:wrap"><h2>Model routing</h2><span class="muted" style="font-size:12px">Chosen by the orchestrator, switched on each phase change</span></div>
          <div class="stats">
            <div class="card stat"><div class="k">Now</div><div class="v" style="font-size:16px">${h(model || "not set")}</div></div>
            <div class="card stat"><div class="k">Complexity</div><div class="v">${h(t.complexity ?? "–")}</div></div>
            <div class="card stat"><div class="k">Blast risk</div><div class="v" style="color:${/high/i.test(t.blast ?? "") ? "#9f1f16" : "inherit"}">${h(t.blast ?? "–")}</div></div>
          </div>
          ${switches.length ? switches.slice().reverse().map((e) => `<div style="display:flex;gap:10px;align-items:center;font-size:12px"><span class="muted" style="width:90px">${h(fmtTime(e.ts))}</span>${toneChip(modelTone(e.note), e.note.split(":")[0])}<span>${h(e.note.split(":").slice(1).join(":").trim())}</span></div>`).join("") : `<div class="muted" style="font-size:12px">No model switches logged.</div>`}
        </section>
        <section class="glass panel" aria-label="Events">
          <h2>Events for this ticket</h2>
          ${lines.length ? `<div class="log">${h(lines.map((l) => l.text).join("\n"))}</div>` : `<div class="muted">None yet.</div>`}
        </section>
      </div>
    </div>
  </div>`;
};

// ---------------------------------------------------------------- ledger
const inline = (s) => s.replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
const markdown = (text) => {
  const out = [];
  let list = false;
  let fence = null;
  for (const raw of text.split("\n")) {
    if (raw.startsWith("```")) {
      if (fence) { out.push(`<pre>${fence.join("\n")}</pre>`); fence = null; } else fence = [];
      continue;
    }
    if (fence) { fence.push(h(raw)); continue; }
    const line = h(raw);
    const item = line.match(/^\s*[-*] (.*)/);
    if (!item && list) { out.push("</ul>"); list = false; }
    const head = line.match(/^(#{1,3}) (.*)/);
    if (head) out.push(`<h${head[1].length}>${inline(head[2])}</h${head[1].length}>`);
    else if (item) { if (!list) { out.push("<ul>"); list = true; } out.push(`<li>${inline(item[1])}</li>`); }
    else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  if (list) out.push("</ul>");
  if (fence) out.push(`<pre>${fence.join("\n")}</pre>`);
  return out.join("");
};

const ledgerView = (run) => {
  const ledger = run.ledger ?? "";
  const cursor = Number(ledger.match(/^Cursor:\s*(\d+)/m)?.[1] ?? 0);
  const lastId = run.events.at(-1)?.id ?? 0;
  const lineage = (ledger.match(/^Lineage:\s*(.*)$/m)?.[1] ?? run.tickets?.orchestrator ?? "").split(/\s*(?:→|->)\s*/).filter(Boolean);
  const ctx = run.context;
  const pct = ctx?.tokens ? Math.min(100, Math.round((ctx.tokens / FORK_AT) * 100)) : 0;
  const stat = (k, v) => `<div class="card stat"><div class="k">${k}</div><div class="v">${v}</div></div>`;
  return `<div style="display:flex;flex-direction:column;gap:16px">
    <header class="glass" style="padding:12px 16px"><div><div class="title">Orchestrator · ${h(run.tickets?.orchestrator ?? "not named in tickets.json")}</div>
      <div class="muted small">ledger.md is written by this session only. ${h(run.dir)}</div></div></header>
    <div class="split">
      <div style="flex:1 1 380px;display:flex;flex-direction:column;gap:16px">
        <section class="glass panel" aria-label="Context">
          <h2>Context</h2>
          ${ctx?.tokens
            ? `<div style="display:flex;align-items:baseline;gap:8px"><span style="font-size:40px;font-weight:700;letter-spacing:-.02em">${fmtTokens(ctx.tokens)}</span><span class="muted" style="font-size:14px">of ${fmtTokens(FORK_AT)} before it forks</span></div><div class="meter"><div style="width:${pct}%"></div></div>`
            : `<div class="muted">${ctx?.session ? `${h(ctx.session)} is not a live session on this Mac, so its context can't be read.` : "No orchestrator named yet."}</div>`}
          <div class="muted" style="font-size:12px;line-height:1.45">Each wake reads the ledger, the queue and the events after its cursor; sub-agents read diffs and transcripts. Refreshed when the orchestrator rewrites a file.</div>
          <div class="stats">${stat("ledger.md", `~${fmtTokens(Math.round(ledger.length / 4))}`)}${stat("tickets.json", `~${fmtTokens(Math.round(run.ticketsBytes / 4))}`)}${stat("new events", Math.max(0, lastId - cursor))}</div>
        </section>
        <section class="glass panel" aria-label="Lineage">
          <h2>Lineage</h2>
          ${lineage.length ? lineage.map((name, i) => `<div style="display:flex;gap:10px;align-items:center"><span class="dot" style="width:10px;height:10px;background:${i === lineage.length - 1 ? "#1f8a4c" : "#98a2b3"}"></span><div><div style="font-size:13px;font-weight:600">${h(name)}</div><div class="muted small">${i === lineage.length - 1 ? `running, cursor at event ${cursor}` : "forked"}</div></div></div>`).join("") : `<div class="muted">No lineage line in ledger.md yet.</div>`}
        </section>
      </div>
      <section class="glass panel" aria-label="ledger.md" style="flex:999 1 560px;min-width:0">
        <div class="row" style="align-items:baseline;flex-wrap:wrap"><h2>ledger.md</h2><span class="muted" style="font-size:12px">Rewritten, never appended. Capped at 200 lines.</span></div>
        ${ledger ? `<div class="md">${markdown(ledger)}</div>` : `<div class="muted">No ledger.md yet.</div>`}
      </section>
    </div>
  </div>`;
};

// ---------------------------------------------------------------- room stations
const DOT = { work: "#1f8a4c", wait: "#d97706", idle: "#98a2b3", red: "#c0362c" };
const stationRow = (p) => `<a class="srow" href="${p.href}"><span class="dot" style="background:${p.dot}"></span><b class="srow-name">${h(p.name)}</b><span class="srow-pr">${h(p.pr ?? "")}</span><span class="srow-note">${h(clip(p.note ?? "", 100))}</span></a>`;
const roomView = (run) => {
  const tickets = ticketsOf(run);
  const open = openQuestions(run);
  const lastNote = (id) => run.events.filter((e) => e.ticket === id && e.type !== "answer").at(-1);
  const dotFor = (t) => {
    if (t.state === "WAITING ON JOEY" || open.some((q) => q.ticket === t.id)) return DOT.wait;
    if (lastNote(t.id)?.type === "blocker") return DOT.red;
    return sessionOf(t.session)?.status === "busy" ? DOT.work : DOT.idle;
  };
  const orch = run.tickets?.orchestrator;
  const orchEvent = run.events.filter((e) => e.role === "orchestrator" && e.type !== "question").at(-1);
  const stations = [
    { name: "Control", color: "#0b1220", rows: [
      { name: "you", pr: "", note: open.length ? `${plural(open.length, "card")} waiting` : "Nothing waiting", dot: open.length ? DOT.wait : DOT.idle, href: "#room" },
      ...(orch ? [{ name: orch, pr: "", note: orchEvent?.note ?? "Waiting for events", dot: sessionOf(orch)?.status === "busy" ? DOT.work : DOT.idle, href: "#ledger" }] : []),
    ] },
    ...COLUMNS.filter((c) => c.id !== "merged").map((c) => ({
      name: c.name, color: c.color,
      rows: tickets.filter((t) => columnOf(t) === c).map((t) => ({
        name: t.id, pr: t.pr ? `#${t.pr}` : "", note: lastNote(t.id)?.note ?? t.note ?? t.title, dot: dotFor(t), href: `#ticket/${encodeURIComponent(t.id)}`,
      })),
    })),
  ].filter((s) => s.rows.length);
  return `<div class="stations">${stations.map((s) => `<section class="stn" aria-label="${h(s.name)}">
      <h2><span class="swatch" style="background:${s.color}"></span>${h(s.name)} <span class="muted">${s.rows.length}</span></h2>
      ${s.rows.map(stationRow).join("")}</section>`).join("")}</div>`;
};

// ---------------------------------------------------------------- inbox and chat
// The card the composer answers: the selected one, else the first open one. None in message mode.
const targetQ = (run) => {
  if (store.mode !== "card" || !run) return null;
  const open = openQuestions(run);
  return open.find((q) => `${run.id}:${q.id}` === store.sel) ?? open[0] ?? null;
};
const questionCard = (run, q, multiRun) => {
  const key = `${run.id}:${q.id}`;
  const picks = store.picks.get(key) ?? new Set();
  const busy = store.sending.has(key);
  const { header, question, options, multiSelect } = q.ask;
  const selected = targetQ(run)?.id === q.id;
  return `<div class="card q open${selected ? " sel" : ""}" data-card="${h(key)}"${busy ? ' style="opacity:.6"' : ""}>
    <div class="row"><span style="display:flex;gap:6px;align-items:center"><span class="chip sm">${h(header)}</span>${selected ? '<span class="chip sm on">Your reply goes here</span>' : ""}</span><span class="muted small">${h(q.ticket)}${multiRun ? ` · ${h(run.id)}` : ""} · ${h(fmtTime(q.ts))} · asks you</span></div>
    <div class="q-text">${h(question)}</div>
    ${q.ask.body?.length ? `<div class="md">${markdown(q.ask.body.join("\n"))}</div>` : ""}
    <div role="${multiSelect ? "group" : "radiogroup"}" aria-label="${h(header)}" style="display:flex;flex-direction:column;gap:6px">
      ${options.map((o, i) => `<button type="button" class="opt${picks.has(o.label) ? " picked" : ""}" data-act="pick" data-run="${h(run.id)}" data-q="${q.id}" data-label="${h(o.label)}"${multiSelect ? ` aria-pressed="${picks.has(o.label)}"` : ""}${busy ? " disabled" : ""}>
        <b>${h(o.label)}${i === 0 && !/recommended/i.test(o.label) ? '<span class="rec">Recommended</span>' : ""}</b><i>${h(o.description)}</i></button>`).join("")}
      <button type="button" class="opt other" data-act="other" data-run="${h(run.id)}" data-q="${q.id}"${busy ? " disabled" : ""}>Other: type a reply below</button>
      ${multiSelect ? `<button type="button" class="btn" data-act="send-picks" data-run="${h(run.id)}" data-q="${q.id}"${picks.size && !busy ? "" : " disabled"}>Send ${picks.size || ""} picked</button>` : ""}
    </div>
    ${sessionLinks(run, q.ticket, q.from)}
    ${store.errors.get(key) ? `<div class="err">${h(store.errors.get(key))}</div>` : ""}
  </div>`;
};

const macCard = (run, t, multiRun) => {
  const key = `${run.id}:${t.id}`;
  const cmd = `python3 ${shellQuote(`${run.dir}/room`)} start --dir ${shellQuote(run.dir)} ${shellQuote(t.id)}`;
  return `<div class="card q">
    <div class="row">${toneChip("blue", "Needs your Mac")}<span class="muted small">${h(t.id)}${multiRun ? ` · ${h(run.id)}` : ""}</span></div>
    <div class="q-text">${h(t.title)} needs ${h((t.needs ?? []).join(", "))}, so it runs on this Mac.</div>
    <div><button type="button" class="btn" data-act="mac" data-key="${h(key)}">Start local session</button></div>
    ${sessionLinks(run, t.id)}
    ${store.macOpen.has(key) ? `<div class="cmd">${h(cmd)}</div><div class="muted small">This button starts nothing yet. Run the command in a terminal: it checks the gates, then prints the session, worktree and branch to start.</div>` : ""}
  </div>`;
};

const mergeCard = (run, t, multiRun) => `<div class="card q">
  <div class="row">${toneChip("green", "Ready to merge")}<span class="muted small">${h(t.id)}${multiRun ? ` · ${h(run.id)}` : ""}</span></div>
  <div class="q-text">#${h(t.pr)} ${h(t.title)} is through its complexity review. Only you merge.</div>
  ${sessionLinks(run, t.id)}
</div>`;

const feedEntry = (who, colour, ts, text, extra = "") => `<div class="ev"><span class="ini" style="background:${colour}">${h(initials(who))}</span>
  <div style="min-width:0"><div class="muted small"><strong style="color:#0b1220">${h(who)}</strong> · ${h(fmtTime(ts))}${extra}</div><div class="ev-text">${h(text)}</div></div></div>`;

const feedOf = (run) => {
  const byTicket = new Map(ticketsOf(run).map((t) => [t.id, t]));
  const orch = run.tickets?.orchestrator ?? "orchestrator";
  const PREFIX = { ci: "CI: ", blocker: "Blocked: ", model: "Model: ", question: "Asks you: " };
  const events = run.events.filter((e) => e.type !== "answer").map((e) => {
    const who = e.role === "orchestrator" ? orch : byTicket.get(e.ticket)?.session ?? `${e.ticket} ${e.role}`;
    const text = `${PREFIX[e.type] ?? ""}${e.type === "question" && e.ask ? e.ask.question : e.note}`;
    const extra = e.type === "question" ? (isAnswered(run, e.id) ? " · answered" : " · open") : ` · ${e.ticket}`;
    return { ts: e.ts, html: feedEntry(who, e.role === "orchestrator" ? "#344054" : colourOf(who), e.ts, text, h(extra)) };
  });
  const mine = run.signoffs.map((s) => {
    const reply = s.answer.startsWith("Other: ") ? `"${s.quote}"` : `${s.answer}${s.quote !== s.answer ? `, "${s.quote}"` : ""}`;
    const text = s.message ? s.quote : s.question ? `Re Q${s.question}: ${reply}` : `Signed off ${s.gate ?? s.change}: "${s.quote}"`;
    return { ts: s.ts, html: feedEntry("you", "#0b1220", s.ts, text, h(` · ${s.ticket}`)) };
  });
  return [...events, ...mine].sort((a, b) => String(b.ts).localeCompare(String(a.ts))).slice(0, 120).map((x) => x.html).join("");
};

const elsewhereLine = (run) => {
  const rooms = [...store.runs.values()].filter((r) => r !== run).map((r) => ({ id: r.id, n: openQuestions(r).length })).filter((r) => r.n);
  return rooms.length
    ? `<span class="muted small">Also waiting in other rooms: ${rooms.map((r) => `<button type="button" class="link-btn" data-act="switch-room" data-run="${h(r.id)}">${h(r.id)} (${r.n})</button>`).join(", ")}</span>`
    : "";
};
const inboxBar = (run, total) => {
  const qs = openQuestions(run);
  const next = qs[0];
  const from = next && (next.from?.name ?? ticketsOf(run).find((t) => t.id === next.ticket)?.session ?? next.ticket);
  return `<span class="bar-badge">Your turn</span>
    <div class="bar-text"><b>${qs.length ? `${plural(qs.length, "question")} ${qs.length === 1 ? "waits" : "wait"} on you in ${h(run.id)}` : total ? `${total} to start or merge in ${h(run.id)}` : `Nothing waits on you in ${h(run.id)}`}</b>
      <span class="muted small ellipsis">${next ? `Next: ${h(next.ask.question)} · from ${h(from)}` : total ? "Open to see them" : ""}</span>${elsewhereLine(run)}</div>
    <button type="button" class="btn dark" id="answer-now"${total ? "" : " hidden"} data-act="sheet-toggle" aria-expanded="${store.sheet}" aria-controls="sheet">${store.sheet ? "Close" : qs.length ? "Answer now" : "Open"}</button>`;
};

const renderSide = (run, route) => {
  const room = route.view === "room";
  document.getElementById("side-title").textContent = room ? "Room chat" : "Inbox";
  document.getElementById("side-sub").textContent = room
    ? "The event stream, read by everyone. Only the orchestrator talks to you; the rest talk to the stream."
    : "Every question from every session lands here. Nothing about scope changes without an answer here.";
  // The inbox is this room's. Questions waiting in other rooms are one line below, with a switch.
  const here = run ? [run] : [];
  const cards = [
    ...here.flatMap((r) => openQuestions(r).map((q) => questionCard(r, q, false))),
    ...here.flatMap((r) => ticketsOf(r).filter((t) => t.needs?.length && t.state === "NOT STARTED").map((t) => macCard(r, t, false))),
    ...here.flatMap((r) => ticketsOf(r).filter((t) => t.state === "DONE" && t.pr).map((t) => mergeCard(r, t, false))),
  ];
  const elsewhere = [...store.runs.values()].filter((r) => r !== run).map((r) => ({ id: r.id, n: openQuestions(r).length })).filter((r) => r.n);
  const others = elsewhere.length ? `<div style="margin-top:6px">${elsewhereLine(run)}</div>` : "";
  document.getElementById("cards").innerHTML = (cards.join("") || `<div class="muted" style="font-size:12px">Nothing waiting on you in this room.</div>`) + others;
  document.getElementById("feed").innerHTML = room && run ? feedOf(run) : "";
  // On the Board the side panel is a bottom bar; its cards open as a sheet.
  const board = route.view === "board";
  if (!cards.length) store.sheet = false;
  document.body.dataset.inbox = cards.length || (board && elsewhere.length) ? "1" : "0"; // the bar also points to other rooms
  document.body.dataset.sheet = board && store.sheet ? "1" : "0";
  document.getElementById("bar").innerHTML = board && run && (cards.length || elsewhere.length) ? inboxBar(run, cards.length) : "";
  const sheet = document.getElementById("sheet");
  if (board) sheet.setAttribute("role", "dialog"); else sheet.removeAttribute("role");
  const undo = undoable(run ?? { signoffs: [], events: [] });
  const undoBtn = document.getElementById("undo");
  undoBtn.hidden = !undo;
  undoBtn.dataset.q = undo?.q ?? "";
  undoBtn.title = undoBtn.ariaLabel = undo ? `Undo your answer to Q${undo.q} and ask it again` : "";
  document.getElementById("undo-note").textContent = store.undoNote ?? "";
  renderChat(run);
  renderMode(run);
};

const renderMode = (run) => {
  const target = targetQ(run);
  const cards = run ? openQuestions(run).length : 0;
  const card = store.mode === "card" && cards > 0;
  document.getElementById("mode").innerHTML = `<div class="seg" role="group" aria-label="What Send does">
      <button type="button" data-act="mode" data-mode="card" aria-pressed="${card}"${cards ? "" : " disabled"}>Answer a card</button>
      <button type="button" data-act="mode" data-mode="orch" aria-pressed="${!card}">Message the orchestrator</button></div>
    <div class="target ${card ? "to-card" : "to-orch"}">${card && target
      ? `<b>Replying to Q${h(target.id)} · ${h(target.ask.header)}</b> <span class="muted">${h(clip(target.ask.question, 70))}${cards > 1 ? " · Alt+↑↓ for another card" : ""}</span>`
      : `<b>Plain message to the orchestrator</b> <span class="muted">${cards ? "It does not answer any card." : "No card is waiting."}</span>`}</div>`;
  const say = document.getElementById("say");
  say.placeholder = card && target ? `Reply to Q${target.id}: ${target.ask.header}` : "Message the orchestrator, or / for skills";
  document.getElementById("composer").dataset.mode = card ? "card" : "orch";
};

// The recent chat of the session behind the first open card (else the orchestrator), to judge a card that may be stale.
// Fetched when the target or the room's event count changes, which is when the SSE stream says something happened.
const chatTarget = (run) => {
  const next = openQuestions(run)[0];
  const name = next?.from?.name ?? ticketsOf(run).find((t) => t.id === next?.ticket)?.session ?? run.tickets?.orchestrator;
  return name ?? null;
};
const renderChat = (run) => {
  const box = document.getElementById("chat");
  const name = run && chatTarget(run);
  box.hidden = !name;
  if (!name) return;
  const key = `${run.id}:${name}:${run.events.length}`;
  if (key !== store.chatKey) {
    store.chatKey = key;
    fetch(`/api/room/chat?run=${encodeURIComponent(run.id)}&session=${encodeURIComponent(name)}`)
      .then((r) => r.json()).then((c) => { if (store.chatKey === key) { store.chat = c; paintChat(); } }).catch(() => {});
  }
  paintChat();
};
const paintChat = () => {
  const box = document.getElementById("chat");
  const log = box.querySelector("#chat-log");
  const atEnd = !log || log.scrollHeight - log.scrollTop - log.clientHeight < 24;
  const c = store.chat;
  box.innerHTML = `<details${store.chatOpen ? " open" : ""}><summary class="muted small">Recent chat · <b>${h(c?.session ?? "")}</b></summary><div id="chat-log">${
    c?.messages.length ? c.messages.map((m) => `<div class="msg ${m.role}">${h(m.text)}</div>`).join("") : `<span class="muted small">${sessionOf(c?.session) ? "No messages to show." : "That session is not running, so there is no chat to show. The card may be stale."}</span>`}</div></details>`;
  const next = box.querySelector("#chat-log");
  next.scrollTop = atEnd ? next.scrollHeight : log.scrollTop;
};

const updateTurn = () => {
  const here = currentRun();
  const n = here ? openQuestions(here).length : 0;
  const all = allOpen().length;
  document.body.dataset.turn = n ? "1" : "0"; // the amber side panel is for this room's questions
  document.title = all ? `(${all}) Your turn · Build Room` : "Build Room"; // the tab counts every room
};

// ---------------------------------------------------------------- render loop
const parseRoute = () => {
  const [view, id] = location.hash.replace(/^#/, "").split("/");
  if (view === "ticket" && id) return { view, id: decodeURIComponent(id) };
  return { view: ["room", "ledger", "prs"].includes(view) ? view : "board" };
};
const VIEWS = { board: boardView, ticket: ticketView, ledger: ledgerView, room: roomView, prs: prsView };

let queued = false;
const render = () => {
  if (queued) return;
  queued = true;
  // Not requestAnimationFrame: it never fires in a background tab, and the tab title is how a
  // background tab says it's your turn.
  queueMicrotask(() => {
    queued = false;
    const run = currentRun();
    const route = parseRoute();
    document.body.dataset.view = route.view;
    renderHead(run, route);
    const focused = document.activeElement?.closest?.("#view [data-stage]")?.dataset.stage;
    const strip = document.querySelector("#view .pipe")?.scrollLeft;
    document.getElementById("view").innerHTML = run ? VIEWS[route.view](run, route) : "";
    if (focused) document.querySelector(`#view [data-stage="${focused}"]`)?.focus();
    const pipe = document.querySelector("#view .pipe");
    if (strip && pipe) pipe.scrollLeft = strip; // a redraw must not rewind the phone's strip
    const on = document.querySelector("#view .tile.on");
    if (on && store.revealed !== `${run.id}:${on.dataset.stage}`) {
      store.revealed = `${run.id}:${on.dataset.stage}`;
      on.scrollIntoView({ inline: "center", block: "nearest" }); // the phone's strip scrolls
    }
    renderSide(run, route);
    updateTurn();
  });
};
window.addEventListener("hashchange", render);

const loadSkills = () => {
  const run = currentRun();
  if (!run || store.skillsFor === run.id) return;
  store.skillsFor = run.id;
  fetch(`/api/room/skills?run=${encodeURIComponent(run.id)}`).then((r) => r.json()).then((list) => { store.skills = list; });
};

const selectRun = (id) => {
  store.run = id;
  const url = new URL(location.href);
  url.searchParams.set("room", id); // a reload or a copied link stays in this room
  history.replaceState(null, "", url);
  store.sheet = false;
  storage.set("build-room-run", id);
  loadSkills();
  render();
};

// ---------------------------------------------------------------- writes
const post = async (body, path = "/api/room/answer") => {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-room-token": TOKEN },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || res.statusText);
  return json;
};

const answer = async (runId, q, labels, text) => {
  const key = `${runId}:${q}`;
  store.sending.add(key);
  store.errors.delete(key);
  render();
  try {
    await post({ run: runId, question: Number(q), labels, text });
    store.picks.delete(key);
  } catch (error) {
    store.errors.set(key, error.message);
  } finally {
    store.sending.delete(key);
    render();
  }
};

document.getElementById("undo").addEventListener("click", async (e) => {
  const run = currentRun();
  try {
    await post({ run: run.id, question: Number(e.currentTarget.dataset.q) }, "/api/room/reopen");
    store.undoNote = "Question reopened. If its session already acted on your answer, press Esc in that session in Claude.";
  } catch (error) {
    store.undoNote = error.message;
  }
  render();
});

const say = document.getElementById("say");
document.getElementById("cards").addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]");
  if (!el || el.disabled) return;
  const { act, run: runId, q, label } = el.dataset;
  if (act === "switch-room") return selectRun(runId);
  const run = store.runs.get(runId);
  const question = run?.events.find((x) => x.id === Number(q));
  if (act === "pick" && question?.ask.multiSelect) {
    const key = `${runId}:${q}`;
    const picks = store.picks.get(key) ?? new Set();
    if (picks.has(label)) picks.delete(label); else picks.add(label);
    store.picks.set(key, picks);
    render();
  } else if (act === "pick") {
    answer(runId, q, [label], "");
  } else if (act === "send-picks") {
    answer(runId, q, [...(store.picks.get(`${runId}:${q}`) ?? [])], "");
  } else if (act === "other") {
    store.mode = "card";
    store.sel = `${runId}:${q}`;
    store.sheet = false;
    if (parseRoute().view !== "room") location.hash = "#room";
    document.body.dataset.view = "room"; // shows the composer now, so it can take focus in this click
    say.focus();
    render();
  } else if (act === "mac") {
    if (store.macOpen.has(el.dataset.key)) store.macOpen.delete(el.dataset.key); else store.macOpen.add(el.dataset.key);
    render();
  }
});

// the PR panel and its merge-history modal
const refreshPrs = async (runId) => {
  store.checking.add(runId);
  store.errors.delete(`prs:${runId}`);
  render();
  try {
    await post({ run: runId }, "/api/room/prs-refresh"); // the new prs.json arrives through the stream
  } catch (error) {
    store.errors.set(`prs:${runId}`, `Refresh failed: ${error.message}`);
  } finally {
    store.checking.delete(runId);
    render();
  }
};
// Address all: one message to the orchestrator, about the PR's ticket, listing every open Qodo finding.
const addressAll = async (runId, key, ticket) => {
  const run = store.runs.get(runId);
  const e = prsOf(run ?? {}).find((x) => `${runId}|${x.key}` === key);
  if (!e?.qodo) return;
  const q = e.qodo;
  const counts = LEVELS.map(([k, name]) => q[k] && `${q[k]} ${name}`).filter(Boolean).join(", ");
  const text = `Address all open Qodo findings on #${e.number} (${counts}${q.trimmed ? `, plus ${q.trimmed} lower-severity ones Qodo trimmed from its comment` : ""}): `
    + `${(q.findings ?? []).map((f) => `[${f.level}] ${f.title}`).join("; ")}. Fix or refute each one, push, and wait for Qodo to re-review. ${q.url}`;
  store.errors.delete(`addr:${key}`);
  try {
    await post({ run: runId, text, ...(ticket ? { ticket } : {}) });
    store.addressed.add(key);
  } catch (error) {
    store.errors.set(`addr:${key}`, error.message);
  }
  render();
};
const focusSoon = (id) => setTimeout(() => document.getElementById(id)?.focus(), 0); // after render's microtask
document.addEventListener("click", (e) => {
  const menu = document.getElementById("room-menu");
  if (menu?.open && !e.target.closest("#room-menu")) menu.open = false; // a click anywhere else closes it
  const el = e.target.closest("[data-act]");
  if (!el || el.disabled) return;
  const { act } = el.dataset;
  if (act === "prs-close" && el !== e.target && el.classList.contains("modal-bg")) return; // a click inside the dialog
  if (act === "merged-all") store.allMerged.add(el.dataset.run);
  else if (act === "stage") storage.set(`build-room-stage:${el.dataset.run}`, el.dataset.stage);
  else if (act === "sheet-toggle") { store.sheet = !store.sheet; focusSoon(store.sheet ? "sheet" : "answer-now"); }
  else if (act === "sheet-close") { store.sheet = false; focusSoon("answer-now"); }
  else if (act === "prs-refresh") refreshPrs(el.dataset.run);
  else if (act === "switch-room" && el.closest("#bar")) return selectRun(el.dataset.run); // #cards has its own handler
  else if (act === "pick-room") { store.roomMenu = false; return selectRun(el.dataset.run); }
  else if (act === "address-all") return addressAll(el.dataset.run, el.dataset.key, el.dataset.ticket);
  else if (act === "prs-merged") { if (store.showMerged.has(el.dataset.run)) store.showMerged.delete(el.dataset.run); else store.showMerged.add(el.dataset.run); }
  else if (act === "prs-history") store.history = "";
  else if (act === "prs-filter") store.history = el.dataset.feature;
  else if (act === "prs-close") store.history = null;
  else return;
  render();
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (store.roomMenu) { store.roomMenu = false; render(); return; }
  if (store.history !== null) store.history = null;
  else if (store.sheet) { store.sheet = false; focusSoon("answer-now"); } else return;
  render();
});

document.addEventListener("toggle", (e) => {
  if (e.target.closest("#chat")) store.chatOpen = e.target.open;
  if (e.target.id === "room-menu") store.roomMenu = e.target.open;
  if (e.target.classList?.contains("qodo")) { if (e.target.open) store.qodoOpen.add(e.target.dataset.key); else store.qodoOpen.delete(e.target.dataset.key); }
}, true);

// Drag the side panel's left edge to resize it. The width is kept per browser; double-click resets it.
const grip = document.getElementById("side-grip");
const setSideWidth = (px) => {
  const w = Math.round(Math.min(Math.max(px, 380), window.innerWidth * 0.8));
  document.documentElement.style.setProperty("--side-w", `${w}px`);
  return w;
};
const savedWidth = Number(storage.get("build-room-side-w"));
if (savedWidth) setSideWidth(savedWidth);
grip.addEventListener("pointerdown", (e) => {
  grip.setPointerCapture(e.pointerId);
  const right = document.getElementById("side").getBoundingClientRect().right;
  const move = (m) => setSideWidth(right - m.clientX);
  const up = () => {
    grip.removeEventListener("pointermove", move);
    grip.removeEventListener("pointerup", up);
    storage.set("build-room-side-w", String(Math.round(document.getElementById("side").getBoundingClientRect().width)));
  };
  grip.addEventListener("pointermove", move);
  grip.addEventListener("pointerup", up);
});
grip.addEventListener("dblclick", () => {
  document.documentElement.style.removeProperty("--side-w");
  storage.set("build-room-side-w", "");
});
grip.addEventListener("keydown", (e) => {
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  e.preventDefault();
  const now = document.getElementById("side").getBoundingClientRect().width;
  storage.set("build-room-side-w", String(setSideWidth(now + (e.key === "ArrowLeft" ? 40 : -40))));
});

document.getElementById("mode").addEventListener("click", (e) => {
  const el = e.target.closest("[data-mode]");
  if (!el || el.disabled) return;
  store.mode = el.dataset.mode;
  render();
  say.focus();
});

// Selecting a card by clicking it (not one of its buttons) makes it the one the composer answers.
document.getElementById("cards").addEventListener("click", (e) => {
  const card = e.target.closest("[data-card]");
  if (!card || e.target.closest("button, a")) return;
  store.mode = "card";
  store.sel = card.dataset.card;
  render();
  say.focus();
});

// ---------------------------------------------------------------- composer and slash menu
const menu = document.getElementById("menu");
const matches = () => {
  const draft = say.value;
  if (!draft.startsWith("/") || /\s/.test(draft)) return [];
  const q = draft.slice(1).toLowerCase();
  const starts = (s) => s.name.toLowerCase().split(/[:-]/).some((word) => word.startsWith(q)) || s.name.toLowerCase().startsWith(q);
  return store.skills.filter((s) => s.name.toLowerCase().includes(q)).sort((a, b) => Number(starts(b)) - Number(starts(a))).slice(0, 60);
};
const renderMenu = () => {
  const list = matches();
  const open = !store.menu.closed && list.length > 0;
  menu.classList.toggle("on", open);
  if (!open) return;
  store.menu.hi = Math.min(store.menu.hi, list.length - 1);
  menu.innerHTML = list.map((s, i) => `<button type="button" role="option" class="mi${i === store.menu.hi ? " hi" : ""}" aria-selected="${i === store.menu.hi}" data-i="${i}"><b>/${h(s.name)}</b><i>${h(s.description)}</i></button>`).join("")
    + `<div class="muted" style="font-size:10px;padding:4px 9px 2px">Tab or Enter to complete · arrows to move · Esc to close</div>`;
  menu.querySelector(".mi.hi")?.scrollIntoView({ block: "nearest" });
};
const complete = (skill) => {
  say.value = `/${skill.name} `;
  store.menu = { hi: 0, closed: false };
  renderMenu();
  say.focus();
};
menu.addEventListener("mousedown", (e) => {
  const item = e.target.closest("[data-i]");
  if (!item) return;
  e.preventDefault();
  complete(matches()[Number(item.dataset.i)]);
});

const sendError = document.getElementById("send-error");
const send = async () => {
  const text = say.value.trim();
  const run = currentRun();
  if (!text || !run) return;
  sendError.textContent = "";
  try {
    const target = text.startsWith("/") ? null : targetQ(run); // a slash command is always a message
    await post(target ? { run: run.id, question: target.id, text } : { run: run.id, text });
    say.value = "";
    store.sel = null; // the next open card is the target
    renderMenu();
    render();
  } catch (error) {
    sendError.textContent = error.message;
  }
};
document.getElementById("send").onclick = send;
say.addEventListener("input", () => {
  store.menu = { hi: 0, closed: false };
  renderMenu();
});
say.addEventListener("keydown", (e) => {
  if (e.altKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
    const run = currentRun();
    const open = run ? openQuestions(run) : [];
    if (open.length > 1 && store.mode === "card") {
      e.preventDefault();
      const at = Math.max(0, open.indexOf(targetQ(run)));
      store.sel = `${run.id}:${open[(at + (e.key === "ArrowDown" ? 1 : open.length - 1)) % open.length].id}`;
      render();
      document.querySelector("#cards .q.sel")?.scrollIntoView({ block: "nearest" });
    }
    return;
  }
  const list = matches();
  const open = !store.menu.closed && list.length > 0;
  if (open && (e.key === "Tab" || e.key === "Enter")) {
    e.preventDefault();
    complete(list[store.menu.hi]);
  } else if (open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
    e.preventDefault();
    store.menu.hi = (store.menu.hi + (e.key === "ArrowDown" ? 1 : list.length - 1)) % list.length;
    renderMenu();
  } else if (e.key === "Escape") {
    store.menu.closed = true;
    renderMenu();
  } else if (e.key === "Enter") {
    e.preventDefault();
    send();
  }
});

// ---------------------------------------------------------------- feed
const apply = (p) => {
  if (p.type === "snapshot") {
    store.runs = new Map(p.runs.map((r) => [r.id, r]));
    store.sessions = p.sessions;
    if (!store.runs.has(store.run)) {
      const newest = [...store.runs.values()].sort((a, b) => String(b.events.at(-1)?.ts ?? "").localeCompare(String(a.events.at(-1)?.ts ?? "")))[0];
      store.run = newest?.id ?? null;
    }
    loadSkills();
    return;
  }
  if (p.type === "sessions") {
    store.sessions = p.sessions;
    return;
  }
  const run = store.runs.get(p.run);
  if (!run) return;
  if (p.type === "events" || p.type === "signoffs") run[p.type] = p.reset ? p[p.type] : run[p.type].concat(p[p.type]);
  else if (p.type === "tickets") Object.assign(run, { tickets: p.tickets, ticketsError: p.ticketsError, ticketsBytes: p.ticketsBytes });
  else if (p.type === "ledger") run.ledger = p.ledger;
  else if (p.type === "prs") run.prs = p.prs;
  else if (p.type === "context") run.context = p.context;
};

const stream = new EventSource("/api/room/stream");
stream.onmessage = (message) => {
  apply(JSON.parse(message.data));
  render();
};
render();

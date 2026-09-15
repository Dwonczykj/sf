#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const parseArgs = (argv) =>
  argv.reduce(
    (acc, arg, i, arr) =>
      arg.startsWith('--') ? { ...acc, [arg.slice(2)]: arr[i + 1] } : acc,
    {},
  );

const readStdin = async () => {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8').trim();
};

const DEFAULT_MODEL = 'gpt-5.6-sol';
const DEFAULT_EFFORT = 'medium';
const EFFORTS = new Set(['minimal', 'low', 'medium', 'high']);
const EFFORT_SUFFIX = /-(minimal|low|medium|high)$/;

// Codex names a model as base slug + a separate reasoning-effort config, unlike Cursor's
// combined `family-effort` slug. Accept both: if --model carries a trailing effort
// suffix (Cursor habit, e.g. gpt-5.6-sol-high) split it off into the effort. A `-fast`
// suffix is refused outright — the factory never runs codex fast.
const resolveModel = ({ model, effort }) => {
  const raw = model ?? DEFAULT_MODEL;
  if (/-fast$/.test(raw)) {
    return { error: `refusing '-fast' model '${raw}': the factory never runs codex fast` };
  }
  const suffix = raw.match(EFFORT_SUFFIX)?.[1];
  const base = suffix ? raw.replace(EFFORT_SUFFIX, '') : raw;
  const chosen = (effort ?? suffix ?? DEFAULT_EFFORT).toLowerCase();
  if (chosen === 'fast') {
    return { error: "refusing effort 'fast': the factory never runs codex fast" };
  }
  if (!EFFORTS.has(chosen)) {
    return { error: `unknown reasoning effort '${chosen}' (use ${[...EFFORTS].join('/')})` };
  }
  return { base, effort: chosen };
};

const buildCodexArgs = ({ prompt, base, effort, sandbox, cwd, outFile }) => [
  'exec',
  // Headless review agents don't want the user's MCP servers, SessionStart/UserPromptSubmit
  // hooks, or custom model config — those cold-start on every CLI call and can add minutes
  // (a failing MCP OAuth retries for the whole run). Auth lives in CODEX_HOME, not the config,
  // so it survives this. We pass model/effort/sandbox explicitly below, so nothing is lost.
  '--ignore-user-config',
  '--model',
  base,
  '-c',
  `model_reasoning_effort="${effort}"`,
  '--sandbox',
  sandbox,
  '--cd',
  cwd,
  '--skip-git-repo-check',
  '--color',
  'never',
  '-o',
  outFile,
  prompt,
];

// spawn, not execFile: codex exec blocks reading stdin until EOF whenever stdin looks
// piped, and execFile leaves the child's stdin an open pipe (it also ignores a `stdio`
// option), so codex hangs until the timeout even with the prompt already a positional arg.
// spawn honours stdio — stdin 'ignore' is a closed fd, so codex proceeds straight to the
// prompt (~6s vs a full-timeout hang). The answer comes back via the -o file, so stdout is
// dropped; stderr is kept for a failure message. Timeout is enforced with SIGKILL.
const runCodex = ({ args, timeoutMs }) =>
  new Promise((resolve) => {
    const child = spawn('codex', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => {
      if (stderr.length < 20000) stderr += d.toString();
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ status: 'error', reason: `timed out after ${timeoutMs / 1000}s` });
    }, timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ status: 'error', reason: error.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(
        code === 0
          ? { status: 'ok' }
          : { status: 'error', reason: `codex exited ${code}: ${stderr.trim().split('\n').slice(-3).join(' ')}` },
      );
    });
  });

const main = async () => {
  const flags = parseArgs(process.argv.slice(2));
  const instructions = flags.instructions ?? (await readStdin());

  if (!instructions) {
    console.error('No instructions given (pass --instructions or pipe via stdin).');
    process.exit(1);
  }

  const resolved = resolveModel({ model: flags.model, effort: flags.effort });
  if (resolved.error) {
    console.error(`codex-agent: ${resolved.error}`);
    process.exit(1);
  }

  const cwd = flags.cwd ?? process.cwd();
  const sandbox = flags.sandbox ?? 'read-only';
  const timeoutSeconds = flags.timeout ? Number(flags.timeout) : 600;

  const dir = await mkdtemp(join(tmpdir(), 'codex-agent-'));
  const outFile = join(dir, 'last-message.txt');

  const args = buildCodexArgs({
    prompt: instructions,
    base: resolved.base,
    effort: resolved.effort,
    sandbox,
    cwd,
    outFile,
  });

  const run = await runCodex({ args, timeoutMs: timeoutSeconds * 1000 });

  const result = await readFile(outFile, 'utf8').catch(() => '');
  await rm(dir, { recursive: true, force: true }).catch(() => {});

  if (run.status === 'error' && !result.trim()) {
    console.error(`codex failed: ${run.reason}`);
    process.exit(1);
  }
  if (!result.trim()) {
    console.error('codex reported failure: (empty result)');
    process.exit(1);
  }

  console.log(result.trim());
};

main();

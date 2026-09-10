#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

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

// --trust marks the target directory as non-malicious (same idea as VS Code's "trust
// this folder"); it does NOT bypass command-level approval, which is separately gated
// by permissions.allow in ~/.cursor/cli-config.json (see SKILL.md). Always on here
// because this wrapper's whole purpose is running against freshly-created worktrees
// that cursor-agent has never seen before — without it, a new directory just exits 1
// asking to be trusted interactively, which headless mode can't do.
const buildAgentArgs = ({ prompt, model }) => [
  '--print',
  prompt,
  ...(model ? ['--model', model] : []),
  '--trust',
  '--output-format',
  'json',
];

const runAgent = ({ args, cwd, timeoutMs }) =>
  execFileAsync('agent', args, { cwd, timeout: timeoutMs, maxBuffer: 20 * 1024 * 1024 })
    .then((r) => ({ status: 'ok', stdout: r.stdout }))
    .catch((error) => ({ status: 'error', reason: error.message }));

const main = async () => {
  const flags = parseArgs(process.argv.slice(2));
  const instructions = flags.instructions ?? (await readStdin());

  if (!instructions) {
    console.error('No instructions given (pass --instructions or pipe via stdin).');
    process.exit(1);
  }

  const cwd = flags.cwd ?? process.cwd();
  const timeoutSeconds = flags.timeout ? Number(flags.timeout) : 600;
  const args = buildAgentArgs({ prompt: instructions, model: flags.model });

  const run = await runAgent({ args, cwd, timeoutMs: timeoutSeconds * 1000 });

  if (run.status === 'error') {
    console.error(`agent failed: ${run.reason}`);
    process.exit(1);
  }

  let parsed;
  try {
    parsed = JSON.parse(run.stdout);
  } catch {
    console.error(`agent produced non-JSON output:\n${run.stdout}`);
    process.exit(1);
  }

  if (parsed.is_error || !parsed.result?.trim()) {
    console.error(`agent reported failure: ${parsed.result || '(empty result)'}`);
    process.exit(1);
  }

  console.log(parsed.result);
};

main();

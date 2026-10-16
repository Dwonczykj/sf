// node scripts/build_verify_slice_test.mjs -> ok. Runs the workflow with agent() stubbed.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const src = readFileSync(fileURLToPath(new URL('../workflows/build-verify-slice.js', import.meta.url)), 'utf8').replace('export const meta', 'const meta')
const AsyncFn = Object.getPrototypeOf(async () => {}).constructor
const calls = []
const agent = async (prompt, opts) => {
  calls.push({ label: opts.label, model: opts.model, prompt })
  if (opts.label.startsWith('plan:')) return { verdict: 'PLAN OK', planFindings: [], widthQuestions: [] }
  if (opts.label.startsWith('t1:')) return { entries: [] }
  if (opts.label.startsWith('build:')) return { summary: 'x', diffFiles: 2 }
  if (opts.label.startsWith('verify:')) {
    const pass = opts.label.split(':')[1]
    const fb = opts.label.includes('seat2') ? { fellBack: 'gemini: agy not logged in, reviewed by d' } : {}
    return { pass, verdict: 'RELEASE', findings: [], ...fb }
  }
  return {}
}
const parallel = (fns) => Promise.all(fns.map((f) => f()))
const seats = [
  { seat: 1, vendor: 'codex', model: null, command: 'node /R/codex --cwd {cwd}', fallback: null },
  { seat: 2, vendor: 'gemini', model: null, command: 'cd {cwd} && agy --add-dir {cwd} --print "$(cat)"', fallback: null },
  { seat: 3, vendor: 'claude', model: 'claude-opus-5-5', command: null, fallback: 'cursor: logged out' },
]
const args = { pluginRoot: '/R', seats, slices: [{ slug: 's', worktree: '/W', pkg: 'app', base: 'staging' }] }
const out = await new AsyncFn('args', 'agent', 'parallel', 'log', 'budget', 'phase', src)(args, agent, parallel, () => {}, {}, () => {})
const v = calls.filter((c) => c.label.startsWith('verify:'))
assert.ok(out.slices[0].released, 'released')
assert.ok(v.length === 9, 'nine verify calls')
assert.ok(v.some((c) => c.prompt.includes('cd /W && agy --add-dir /W')), 'cwd substituted')
assert.ok(v.filter((c) => c.model === 'claude-opus-5-5').length === 3, 'claude seat on its model')
assert.ok(v.filter((c) => c.model === 'claude-sonnet-5-5').length === 6, 'drivers on verify model')
assert.ok(out.panel.fallbacks.length === 2 && out.panel.fallbacks[0].includes('cursor: logged out'), JSON.stringify(out.panel))
console.log('ok')

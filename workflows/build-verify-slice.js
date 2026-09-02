export const meta = {
  name: 'sf-build-verify',
  description: 'Deterministic Phase 3 machine: per-slice plan-review -> build+tests -> capped build/verify loop, cross-vendor (Codex+Gemini+Cursor), stops at RELEASE (never pushes).',
  whenToUse: 'After the plan/split are signed off (sf:plan done). Runs one wave of independent slices to pre-PR RELEASE. Push + CI stay in the interactive session.',
  phases: [
    { title: 'Plan review' },
    { title: 'Build' },
    { title: 'Verify' },
  ],
}

// ---------------------------------------------------------------------------
// Invocation contract (args):
//   {
//     slices: [
//       { slug, worktree, pkg, base }   // one WAVE of independent slices only
//     ],
//     maxRounds?: 4,                     // build<->verify cap per slice
//     widthAnswered?: false             // set true on re-invoke, AFTER the
//   }                                    // interactive lead has answered the
//                                        // width questions and written them
//                                        // into requirements.md / the plan.
//
// Why the human gates are OUTSIDE this script: a Workflow runs headless and
// cannot call AskUserQuestion. So the two hard human gates of Phase 3 live in
// the interactive lead, not here:
//   1. width questions (solve-in-worktrees Phase 2b, finding 7) -> this script
//      returns them and HALTS the slice; the lead asks, writes answers into the
//      plan, then re-invokes with widthAnswered:true.
//   2. push + open PR (a RELEASE'd slice is returned; the lead pushes).
//
// ponytail: reviewer prompts are NOT duplicated here. Each vendor driver reads
// the canonical skill text (solve-in-worktrees / pre-pr-gate) and runs exactly
// that review, so the prompts can't drift from the skills. This script owns
// ordering, the vote, and the loop -- nothing else.
// ---------------------------------------------------------------------------

const MAX_ROUNDS = (args && args.maxRounds) || 4
const WIDTH_ANSWERED = !!(args && args.widthAnswered)
const SLICES = (args && args.slices) || []

const VENDORS = [
  { id: 'codex', label: 'codex' },
  { id: 'gemini', label: 'gemini' },
  { id: 'cursor', label: 'cursor' },
]

const PLAN_REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'planFindings', 'widthQuestions'],
  properties: {
    verdict: { type: 'string', enum: ['PLAN OK', 'PLAN CHANGES'] },
    planFindings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'changesPlan', 'forUser'],
        properties: {
          text: { type: 'string' },
          fileLine: { type: 'string' },
          changesPlan: { type: 'boolean' }, // findings 1/3/5 rewrite the plan text
          forUser: { type: 'boolean' }, // finding 5 (ambiguity) usually comes back to the user
        },
      },
    },
    widthQuestions: {
      type: 'array', // solve-in-worktrees Phase 2b finding 7 -- empty is the normal answer
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['behaviour', 'fileLine', 'freezesWhat'],
        properties: {
          behaviour: { type: 'string' },
          fileLine: { type: 'string' },
          freezesWhat: { type: 'string' },
        },
      },
    },
  },
}

const VERIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['pass', 'verdict', 'findings'],
  properties: {
    pass: { type: 'string', enum: ['A', 'B', 'C'] },
    verdict: { type: 'string', enum: ['RELEASE', 'CHANGES REQUIRED'] },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'text', 'forTests'],
        properties: {
          severity: { type: 'string', enum: ['P0', 'P1', 'P2'] },
          fileLine: { type: 'string' },
          text: { type: 'string' },
          forTests: { type: 'boolean' }, // Pass C test findings -> test agents, not the build agent
        },
      },
    },
  },
}

const TEST_REQS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['entries'],
  properties: {
    entries: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['statement', 'kind'],
        properties: {
          statement: { type: 'string' }, // unit + breaking input + observable outcome
          kind: { type: 'string', enum: ['NEW', 'UPDATE', 'COVERED'] },
        },
      },
    },
  },
}

// How a Claude driver agent invokes each external vendor. The driver is thin:
// run the command, capture the vendor's verdict + findings, return the schema.
// The reasoning is the vendor's; the driver only parses. Cross-vendor diversity
// (three different model families, not three Claude agents) is the whole point.
function vendorCommand(vendor, cwd) {
  if (vendor === 'codex') {
    return `Call the MCP tool mcp__codex__codex with { cwd: "${cwd}", sandbox: "read-only", "approval-policy": "never", prompt: <REVIEW_PROMPT> }.`
  }
  if (vendor === 'gemini') {
    return `Run in Bash (heredoc the prompt, do not interpolate): node ~/.claude/skills/gemini-agent/scripts/run-agent.mjs --model gemini-3.1-pro-high --cwd ${cwd} --timeout 900  <<'EOF'\n<REVIEW_PROMPT>\nEOF`
  }
  // cursor
  return `Run in Bash (heredoc the prompt, do not interpolate): node ~/.claude/skills/cursor-agent/scripts/run-agent.mjs --model claude-opus-5-high --cwd ${cwd} --timeout 900  <<'EOF'\n<REVIEW_PROMPT>\nEOF`
}

function driverPrompt({ vendor, cwd, reviewPrompt, schemaNote }) {
  return [
    `You are a thin driver for an external review model. Do NOT review anything yourself.`,
    `Invoke the vendor exactly as follows, passing it the REVIEW_PROMPT verbatim:`,
    ``,
    vendorCommand(vendor, cwd),
    ``,
    `REVIEW_PROMPT:`,
    reviewPrompt,
    ``,
    `Capture the vendor's full output. Parse its single verdict line and its numbered findings into the structured output. ${schemaNote}`,
    `If the vendor errored or produced no verdict, return the most conservative verdict (a CHANGES/PLAN CHANGES with a single finding naming the failure) so the loop does not release on a missing signal.`,
  ].join('\n')
}

// --- reconciliation (canonical in pre-pr-gate) ------------------------------
// A finding is ACTIONED when >=2 of 3 vendors raise it. A finding raised by
// exactly one vendor is NOT auto-acted and NOT dropped: it goes to
// needsHumanCheck. A pass RELEASEs only when no vendor still returns a blocking
// verdict on a quorum finding. Dedupe is by normalised text -- coarse on
// purpose; over-merging two findings only ever makes the gate stricter.
function normalise(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .slice(0, 80)
}

function quorumFindings(perVendorFindings) {
  const counts = new Map()
  for (const list of perVendorFindings) {
    const seenThisVendor = new Set()
    for (const f of list || []) {
      const key = normalise(f.text)
      if (!key || seenThisVendor.has(key)) continue
      seenThisVendor.add(key)
      const prev = counts.get(key) || { count: 0, sample: f }
      counts.set(key, { count: prev.count + 1, sample: prev.sample })
    }
  }
  const quorum = []
  const single = []
  for (const { count, sample } of counts.values()) {
    if (count >= 2) quorum.push(sample)
    else single.push(sample)
  }
  return { quorum, single }
}

async function runVendorReview({ vendor, cwd, reviewPrompt, schema, phase, label }) {
  const schemaNote =
    schema === PLAN_REVIEW_SCHEMA
      ? 'Return verdict (PLAN OK|PLAN CHANGES), planFindings, and widthQuestions.'
      : 'Return pass, verdict (RELEASE|CHANGES REQUIRED), and findings with P0/P1/P2 severities.'
  return agent(driverPrompt({ vendor, cwd, reviewPrompt, schemaNote }), {
    schema,
    phase,
    label,
    effort: 'low', // the driver only parses; the vendor does the thinking
  })
}

// --- Phase 2b: plan review --------------------------------------------------
async function planReview(slice) {
  const reviewPrompt = [
    `Read the skill at ~/.claude/skills/solve-in-worktrees/SKILL.md, section "Phase 2b".`,
    `Perform EXACTLY that plan review (its 7 numbered checks) against the real codebase in ${slice.worktree}.`,
    `The plan under review is the requirements + solution in .scratch/${slice.slug}/requirements.md and the slice's solution notes.`,
    `Write no files. End with one verdict line PLAN OK or PLAN CHANGES.`,
    `Report finding 7 (width questions) separately: each names the behaviour, its file:line, and what pinning it would stop anyone changing later. Empty is the normal answer.`,
  ].join('\n')

  const reviews = await parallel(
    VENDORS.map((v) => () =>
      runVendorReview({
        vendor: v.id,
        cwd: slice.worktree,
        reviewPrompt,
        schema: PLAN_REVIEW_SCHEMA,
        phase: 'Plan review',
        label: `plan:${slice.slug}:${v.label}`,
      }),
    ),
  )
  const ok = reviews.filter(Boolean)

  const widthQuestions = ok.flatMap((r) => r.widthQuestions || [])
  const { quorum: planChanges } = quorumFindings(ok.map((r) => r.planFindings))
  const forUser = planChanges.filter((f) => f.forUser)
  return { widthQuestions, planChanges, forUser }
}

// --- Phase 3 / 3b: build + tests (one round) --------------------------------
async function buildRound(slice, round, priorFindings) {
  const findingsBlock = priorFindings.length
    ? `\n\nPrior verify findings to fix this round (each is file:line + text):\n${priorFindings
        .map((f, i) => `${i + 1}. [${f.severity}] ${f.fileLine || ''} ${f.text}`)
        .join('\n')}`
    : ''

  // T1: test-requirement gathering from the PLAN (read-only). Feed 1.
  const t1 = await agent(
    [
      `Read ~/.claude/skills/solve-in-worktrees/SKILL.md, "Phase 3b" (T1, feed 0 + feed 1).`,
      `Worktree: ${slice.worktree}. Plan: .scratch/${slice.slug}/requirements.md.`,
      `Output the test-requirements list (NEW/UPDATE/COVERED), each naming the unit, the input that breaks it, and the observable outcome. Read-only, write no files.`,
    ].join('\n'),
    { schema: TEST_REQS_SCHEMA, phase: 'Build', label: `t1:${slice.slug}:r${round}` },
  )
  const testReqs = (t1 && t1.entries) || []
  const newReqs = testReqs.filter((e) => e.kind === 'NEW')
  const updateReqs = testReqs.filter((e) => e.kind === 'UPDATE')
  const testFindings = priorFindings.filter((f) => f.forTests)
  const buildFindings = priorFindings.filter((f) => !f.forTests)

  // Build agent (source only) + T2 (new tests) + T3 (existing tests), concurrent.
  // File ownership keeps the concurrency safe: build->source, T2->new test
  // files, T3->existing test files. Nobody writes another's files.
  await parallel([
    () =>
      agent(
        [
          `You are the BUILD agent for slice "${slice.slug}". Absolute worktree: ${slice.worktree}.`,
          `EVERY edit and git command targets that path (git -C ${slice.worktree} ...) and nothing outside it.`,
          `Read the plan at .scratch/${slice.slug}/requirements.md and build to the planned interface. Follow ~/.claude/skills/solve-in-worktrees/SKILL.md "Phase 3" (repo standards, comments-stricter-than-default, checks to run, DO NOT touch test files, DO NOT push, commit locally).`,
          `Never run tsc --noEmit anywhere in this repo; verify types by reading the diff.`,
          `A planned test that disagrees with your code: the plan wins -- fix the code, unless the plan detail itself is wrong, then stop and flag it.`,
          findingsBlock && buildFindings.length ? findingsBlock : '',
        ]
          .filter(Boolean)
          .join('\n'),
        { phase: 'Build', label: `build:${slice.slug}:r${round}`, agentType: 'tech-lead' },
      ),
    () =>
      agent(
        [
          `You are Codex test-agent T2 (test create) for slice "${slice.slug}". Worktree: ${slice.worktree}.`,
          `Follow ~/.claude/skills/solve-in-worktrees/SKILL.md "Phase 3b" (T2). Write ONLY new test files, for the NEW entries below, against the interface the PLAN promised. Mirror the nearest existing test file. Never stub the planned module into existence or soften an assertion to make red go away. Commit locally, no push.`,
          `NEW test-requirements:\n${newReqs.map((e, i) => `${i + 1}. ${e.statement}`).join('\n') || '(none)'}`,
        ].join('\n'),
        { phase: 'Build', label: `t2:${slice.slug}:r${round}`, agentType: 'general-purpose' },
      ),
    () =>
      agent(
        [
          `You are Codex test-agent T3 (test update) for slice "${slice.slug}". Worktree: ${slice.worktree}.`,
          `Follow ~/.claude/skills/solve-in-worktrees/SKILL.md "Phase 3b" (T3). Touch ONLY existing test files, for the UPDATE entries below. A test that now fails is a real regression (report it) unless the contract deliberately changed. Never delete a failing test to go green. Commit locally, no push.`,
          `UPDATE test-requirements:\n${updateReqs.map((e, i) => `${i + 1}. ${e.statement}`).join('\n') || '(none)'}`,
          testFindings.length
            ? `Pass C test findings to address:\n${testFindings.map((f, i) => `${i + 1}. ${f.fileLine || ''} ${f.text}`).join('\n')}`
            : '',
        ]
          .filter(Boolean)
          .join('\n'),
        { phase: 'Build', label: `t3:${slice.slug}:r${round}`, agentType: 'general-purpose' },
      ),
  ])

  // T1 feed 2: re-run over the first diff for behaviour the plan never named.
  // ponytail: coverage feed only -- it appends, it does not gate. The plan feed
  // above is the oracle; this catches branches/error-paths the plan missed.
  await agent(
    [
      `Codex test-agent T1, feed 2 (diff coverage) for slice "${slice.slug}". Worktree: ${slice.worktree}.`,
      `Re-run T1 over git -C ${slice.worktree} diff origin/${slice.base}...HEAD for behaviour the plan never named (a branch, an invented error path, a caller it had to touch). If any is worth a test, write/append it (new file only) and commit locally. Otherwise report none.`,
    ].join('\n'),
    { phase: 'Build', label: `t1diff:${slice.slug}:r${round}` },
  )
}

// --- Phase 4: verify (3 passes x 3 vendors = 9) -----------------------------
async function verifyRound(slice, round) {
  const passes = [
    {
      pass: 'A',
      ref: `~/.claude/skills/solve-in-worktrees/SKILL.md "Phase 4 -- Pass A" (solution-vs-requirements over git -C ${slice.worktree} diff origin/${slice.base}...HEAD, against .scratch/${slice.slug}/requirements.md only). Per requirement: met / not met / met-but-broken with file:line, plus correctness/edge-case/dead-code defects. Not design/DRY/concurrency/tests.`,
    },
    {
      pass: 'B',
      ref: `~/.claude/skills/pre-pr-gate/SKILL.md "Pass B" (code-quality: reuse/DRY, concurrency, mechanical design; ignore business correctness). Rank P0/P1/P2; only P0 gates RELEASE.`,
    },
    {
      pass: 'C',
      ref: `~/.claude/skills/pre-pr-gate/SKILL.md "Pass C" (test-critique: every mock vs what the real function returns, cardinality absent/more-than-one/stale/mis-attributed, justify every first()/[0]/.find() over an external collection). Rank P0/P1/P2; only P0 gates RELEASE. Mark test-directed findings forTests:true.`,
    },
  ]

  const results = await parallel(
    passes.flatMap((p) =>
      VENDORS.map((v) => () =>
        runVendorReview({
          vendor: v.id,
          cwd: slice.worktree,
          reviewPrompt: [
            `Read and perform EXACTLY this review, write no files, end with one verdict line RELEASE or CHANGES REQUIRED and a numbered findings list:`,
            p.ref,
            `Reconciliation is not your job -- just report your own verdict and findings.`,
          ].join('\n'),
          schema: VERIFY_SCHEMA,
          phase: 'Verify',
          label: `verify:${p.pass}:${slice.slug}:${v.label}:r${round}`,
        }),
      ),
    ),
  )
  const ok = results.filter(Boolean)

  // Blocking = quorum P0 (any pass) OR quorum Pass-A not-met (severity P0 by
  // convention in the Pass-A prompt). Only P0 gates. Single-vendor findings
  // are surfaced, not looped on and not dropped.
  const byPass = { A: [], B: [], C: [] }
  for (const r of ok) byPass[r.pass].push(r.findings || [])
  let blocking = []
  const needsHumanCheck = []
  for (const pass of ['A', 'B', 'C']) {
    const { quorum, single } = quorumFindings(byPass[pass])
    blocking = blocking.concat(quorum.filter((f) => f.severity === 'P0'))
    for (const f of single) needsHumanCheck.push({ ...f, pass })
  }
  const released = blocking.length === 0
  return { released, blocking, needsHumanCheck }
}

// --- per-slice loop ---------------------------------------------------------
async function runSlice(slice) {
  const review = await planReview(slice)

  if (review.widthQuestions.length && !WIDTH_ANSWERED) {
    log(`slice ${slice.slug}: ${review.widthQuestions.length} width question(s) -- halting for the lead to answer`)
    return {
      slug: slice.slug,
      released: false,
      halted: 'width-questions',
      widthQuestions: review.widthQuestions,
      planChangesForUser: review.forUser,
    }
  }
  if (review.forUser.length) {
    log(`slice ${slice.slug}: ${review.forUser.length} ambiguity finding(s) for the lead -- halting`)
    return {
      slug: slice.slug,
      released: false,
      halted: 'plan-ambiguity',
      planChangesForUser: review.forUser,
    }
  }

  let priorFindings = []
  let lastNeedsHuman = []
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    if (budget.total && budget.remaining() < 60000) {
      log(`slice ${slice.slug}: stopping at round ${round}, token budget nearly spent`)
      return { slug: slice.slug, released: false, halted: 'budget', roundsUsed: round - 1, needsHumanCheck: lastNeedsHuman }
    }
    await buildRound(slice, round, priorFindings)
    const verify = await verifyRound(slice, round)
    lastNeedsHuman = verify.needsHumanCheck
    if (verify.released) {
      log(`slice ${slice.slug}: RELEASE after ${round} round(s)`)
      return { slug: slice.slug, released: true, roundsUsed: round, needsHumanCheck: verify.needsHumanCheck }
    }
    priorFindings = verify.blocking
    log(`slice ${slice.slug}: round ${round} -> ${verify.blocking.length} blocking P0(s), looping`)
  }
  return { slug: slice.slug, released: false, halted: 'max-rounds', roundsUsed: MAX_ROUNDS, contested: priorFindings, needsHumanCheck: lastNeedsHuman }
}

// --- entry ------------------------------------------------------------------
if (!SLICES.length) {
  log('no slices in args.slices -- nothing to do')
  return { slices: [] }
}
log(`sf build/verify: ${SLICES.length} slice(s), maxRounds=${MAX_ROUNDS}, widthAnswered=${WIDTH_ANSWERED}`)
const results = await parallel(SLICES.map((s) => () => runSlice(s)))
return { slices: results.filter(Boolean) }

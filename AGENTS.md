# Reply Rules

You should reply to user in Chinese.

## Commit Message Format

Use Conventional Commit types, but keep the subject line as type only.

Format:

```text
<type>:
- <change summary 1>
- <change summary 2>
- Tests: <status>
```

Rules:

- type in `{feat, fix, refactor, chore, docs, test, perf}`
- one change per bullet, start with a verb, keep each line short
- include a Tests line when relevant, for example `Tests: not run (not requested)`

## Project Notes

- Ranni is a local-first web agent workbench, not an Electron app.
- The selected session workspace is the agent execution boundary. File tools, terminal tools, research output, and `.ranni` task memory must use that workspace.
- Runtime outputs such as `research/`, `.ranni/`, and `dist/` are ignored. Promote only curated, durable content into `docs/`.
- Settings keys stored in the browser are localStorage data and should be treated as local-only convenience, not production secret storage.
- `npm run research:eval` is the local deep-research harness. It can run cases, reanalyze traces, compare runs, and produce rubric/style judge artifacts under ignored `research/research-eval/`.
- Deep research quality work should optimize user-visible final results first. Use trace, task memory, source ledgers, claim ledgers, coverage matrices, and judge outputs for diagnosis, not as fixed trajectories to overfit.
- Long research finals may use Ranni's chunked final protocol and should be judged after the aggregated final answer, not by any single partial chunk.
- Model `thinking` is part of the observable trace/display surface when the provider returns it. The UI can show it as a separate readable process item, while full raw context remains in trace/debug views.

## Documentation Rules

- Keep README aligned with current user-facing functionality and startup instructions.
- For architecture or agent behavior changes, update the matching docs under `docs/agent-arch/`, `docs/agent-orchestration.md`, or `docs/runtime-architecture.md`.
- For component or directory ownership changes, update `docs/component-map.md`.
- For product-level capability changes, update `docs/project-overview.md`.
- When documenting historical commit work, add files under `docs/update-log/` using `update-编号-内容概要标题.md`.
- Keep concept docs separate from implementation docs:
  - `docs/core-concept/` is for foundational concepts.
  - `docs/agent-arch/` is for agent loop, action way, implementation notes, and architecture optimization.

## Verification

- For code changes, prefer `npm run typecheck`, `npm run lint`, and `npm run build` unless the change is clearly docs-only.
- For research harness behavior changes, prefer at least one targeted `npm run research:eval -- --case ... --judge` run when model and Tavily keys are available.
- For docs-only changes, `git diff --check` is enough to catch formatting whitespace issues.

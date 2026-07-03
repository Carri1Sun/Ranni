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

## Branch Rules

This project is currently in the debugging phase and does not need to adhere to strict branching rules, only commit conventions. All current work is being executed on the main branch.

## Project Notes

- Ranni is a local-first web agent workbench, not an Electron app.
- The selected session workspace is the agent execution boundary. File tools, terminal tools, research output, and `.ranni` task memory must use that workspace.
- Runtime outputs such as `research/`, `.ranni/`, and `dist/` are ignored. Promote only curated, durable content into `docs/`.
- Settings keys stored in the browser are localStorage data and should be treated as local-only convenience, not production secret storage.
- `npm run research:eval` is the local deep-research harness. It can run cases, reanalyze traces, compare runs, and produce rubric/style judge artifacts under ignored `research/research-eval/`.
- Deep research quality work should optimize user-visible final results first. Use trace, task memory, source ledgers, claim ledgers, coverage matrices, and judge outputs for diagnosis, not as fixed trajectories to overfit.
- Long research finals may use Ranni's chunked final protocol and should be judged after the aggregated final answer, not by any single partial chunk.
- Model `thinking` is part of the observable trace/display surface when the provider returns it. The UI can show it as a separate readable process item, while full raw context remains in trace/debug views.

## Product UI Naming

- Use `UI-NAMING.md` as the canonical vocabulary for Ranni page regions, modules, and visible UI elements.
- When discussing product changes, bug reports, docs, or code review comments, prefer the Chinese UI names from `UI-NAMING.md`.
- When adding or renaming visible UI modules, update `UI-NAMING.md` in the same change.

## Documentation Rules

- Keep README aligned with current user-facing functionality and startup instructions.
- Use the current docs taxonomy:
  - `docs/tech/` stores technical and architecture documents.
  - `docs/product/` stores product and UI design documents.
  - `docs/manuel/` stores usage guidance and teaching documents.
- Every markdown document under `docs/` must start with metadata front matter:
  - `author: <name>`
  - `version: <version>`
  - `date: YYYY-MM-DD`
- When creating or editing docs, preserve or add the metadata front matter. Use the file creation date for `date` when available; if unavailable, use the current date.
- Default docs metadata is `author: codex` and `version: v1`.
- Documents under `docs/tech/v2-architecture/` use `author: manus` and `version: v2`.
- For architecture or agent behavior changes, update the matching docs under `docs/tech/`.
- For component or directory ownership changes, update `docs/tech/v1-architecture/component-map.md` or the current matching tech architecture document.
- For product-level UI or capability changes, update the matching docs under `docs/product/`.
- For user-facing usage guidance changes, update the matching docs under `docs/manuel/`.
- Keep concept docs separate from implementation docs:
  - `docs/tech/**/core-concept/` is for foundational concepts.
  - `docs/tech/**/agent-arch/` is for agent loop, action way, implementation notes, and architecture optimization.

## Verification

- For code changes, prefer `npm run typecheck`, `npm run lint`, and `npm run build` unless the change is clearly docs-only.
- For research harness behavior changes, prefer at least one targeted `npm run research:eval -- --case ... --judge` run when model and Tavily keys are available.
- For docs-only changes, `git diff --check` is enough to catch formatting whitespace issues.

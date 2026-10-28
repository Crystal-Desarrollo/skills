# Crystal skills

Portable agent skills from Crystal Desarrollo. Install with the Skills CLI.

## Company CLI (local, unpublished)

From this repository, build and list the approved catalog:

```bash
pnpm install
pnpm build
node dist/cli.js list
```

From the target project, run `node /absolute/path/to/skills/dist/cli.js init --commit` for interactive selection and a scoped commit. Replace the path with this checkout's path. The command installs to OpenCode by default; repeat `--agent` to select other supported agents. See [the CLI guide](docs/company-skills-cli.md) for selection, update, provenance, and safety details.

## Company skill updates

The monthly workflow proposes approved catalog revisions without automatic merging. See [catalog maintenance](docs/catalog-maintenance.md).

## Install

Run this command from the project where you want to use the skill:

```bash
pnpm dlx skills add Crystal-Desarrollo/skills --skill shadcn-audit
```

Add `--global` for a user-wide installation. Add `--agent opencode` to select OpenCode.

List available skills without installation:

```bash
pnpm dlx skills add Crystal-Desarrollo/skills --list
```

## Shadcn audit

| Setting | Behavior |
| --- | --- |
| Framework | React, including locally customized shadcn components. |
| Default mode | Full compliance: adoption, composition, styling, tokens, and source accessibility checks. |
| Component-only mode | Component adoption and reuse. No styling or composition compliance checks. |
| Scope | All first-party UI, paths, globs, or a named feature. |
| Output | Chat tables with coverage, findings, exceptions, and verification limits. |
| Changes | None. The skill audits; it does not edit or install application code. |
| Missing configuration | The response is only `shadcn is not configured`. |
| Browser inspection | Opt-in. Source inspection is the default. |

Use these prompts after installation:

```text
Use shadcn-audit in full mode across this React codebase.
Use shadcn-audit in component-only mode for src/features/checkout/**.
Use shadcn-audit in full mode for the account settings feature.
Use shadcn-audit in full mode for src/pages/profile.tsx, with browser inspection.
```

The agent reports recommendations that preserve behavior and intended appearance.
Project exceptions require evidence. Native HTML and local component customization are not automatic violations.
Findings outside the selected scope are not included. Shared components can be read for context.

## Maintain

```bash
pnpm test
pnpm typecheck
pnpm build
python3 -m unittest discover -s tests -v
pnpm dlx skills add . --list
```

Tests validate metadata, local links, rule IDs, and scenario contracts.
They do not execute a model or prove visual, runtime, or audit accuracy.
The skill needs no Python script, other installed skill, or CodeGraph at runtime.

## License

Copyright 2026 Crystal Desarrollo. Licensed under [Apache-2.0](LICENSE).

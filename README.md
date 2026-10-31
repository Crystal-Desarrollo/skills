# Crystal skills

Company-owned skills and an approved third-party catalog from Crystal Desarrollo.

## Install from the company catalog

Run from the target project. Select skills with the checkboxes, then press Enter:

```bash
pnpm --package=github:Crystal-Desarrollo/skills dlx crystal-skills init --commit
```

This uses the GitHub package directly. It needs no local checkout, npm publication, or consumer compiler build. The command installs to OpenCode by default; repeat `--agent` to select other supported agents. Omit `--commit` to leave generated files uncommitted. See [the CLI guide](docs/company-skills-cli.md) for selection, update, provenance, and safety details.

## Company skill updates

The monthly workflow proposes approved catalog revisions without automatic merging. See [catalog maintenance](docs/catalog-maintenance.md).

## Install only the owned audit skill

The stock Skills CLI discovers skill folders, not the company catalog. This command installs only `shadcn-audit`:

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

Install development dependencies, build, then run the checks:

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
pnpm test
pnpm typecheck
python3 -m unittest discover -s tests -v
pnpm dlx skills add . --list
```

Commit `dist/cli.js` when changing `src/cli.tsx`. Distribution tests compare the runtime with a fresh TypeScript build and check the package contents. The committed runtime avoids Git dependency build approvals on consumer machines.

Tests validate metadata, local links, rule IDs, and scenario contracts.
They do not execute a model or prove visual, runtime, or audit accuracy.
The skill needs no Python script, other installed skill, or CodeGraph at runtime.

## License

Copyright 2026 Crystal Desarrollo. Licensed under [Apache-2.0](LICENSE).

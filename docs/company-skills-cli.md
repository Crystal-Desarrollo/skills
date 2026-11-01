# Company skills CLI

The company CLI installs selected skills from immutable public Git revisions. Run the package directly from GitHub; it is not published to npm. Review upstream skill instructions before use because agents execute them with repository permissions.

## Quick path

Run from the target project without cloning this repository:

```sh
pnpm --package=github:Crystal-Desarrollo/skills dlx crystal-skills init --commit
```

For noninteractive installation, select explicit source-qualified skill IDs:

```sh
pnpm --package=github:Crystal-Desarrollo/skills dlx crystal-skills init --skill crystal-desarrollo/skills/shadcn-audit --skill vercel-labs/skills/find-skills --agent opencode --commit
```

Use the same package command with `list` to inspect the catalog or `update --commit` to update recorded selections. For a fixed CLI revision, append `#<commit-sha>` to `github:Crystal-Desarrollo/skills`.

The package includes its built JavaScript, catalog, and license. It has no consumer build hook and does not need a TypeScript compiler on the target machine. Keep package-manager trust checks enabled. The stock `pnpm dlx skills add Crystal-Desarrollo/skills` command discovers the owned skill plus vendored third-party snapshots. It does not run this catalog wrapper or make its optional scoped commit. The wrapper still installs directly from the catalog's upstream pins; its source-qualified IDs do not change.

The default agent is the explicit safe target `opencode`. Repeat `--agent` for more targets. The CLI never detects agents from the host machine or writes to the global home directory.

Agent paths follow `skills@1.7.4`. Cursor uses the shared `.agents/skills` directory; it does not require a separate `.cursor` copy.

## Selection and updates

| Command | Behavior |
| --- | --- |
| `list` | Shows every source-qualified skill ID and any unavailable reason. |
| `init` | Opens searchable Ink checkboxes on a TTY. Use arrows, Space, Enter, and Escape. |
| `init --skill <source/name>` | Installs the listed selection. Repeat to select multiple skills. |
| `update` | Reinstalls the recorded selections and agents at packaged catalog pins. |
| `--commit` | Opts in to a scoped commit. Without it, the CLI never commits. |

Non-TTY `init` requires one or more explicit `--skill` flags. `update` rejects `--skill` and `--agent`; it uses the recorded selection and agents. `list` accepts no selection or commit options.

## Project state and safety

The CLI stages the published `skills@1.7.4` installation outside the project with isolated HOME and Git configuration. It validates the complete staged plan before copying any files. It uses the published installer for agent paths and writes its native `skills-lock.json` format.

The project stores source-qualified choices and SHA-256 provenance in `.company-skills.json`. License notices are copied to `.company-skills/licenses/<source-id>/LICENSE`. The updater preserves unrelated native lock entries and unrelated files inside agent skill directories. It refuses symlinks, locally edited managed files, unmanaged conflicts, malformed state, invalid agents, and unsafe commits.

`--commit` requires the current directory to be a Git repository root. The commit contains only generated file paths. Unrelated staged changes remain staged and are not committed.

## Catalog provenance

The recovered original list does not specify a Matt Pocock subset. The catalog therefore records every skill present at its verified pin. `vercel-labs/agent-skills` remains unavailable because the pinned tree has no root license notice; its listed skill identities remain visible, with the missing notice explained. All enabled sources use verified immutable commits and license files. The company skill uses publicly verified baseline `fe79416fc1a52130bdb7184f34e8b84fd81e900d`.

Pins are reviewed source snapshots, not endorsements of upstream safety. Review the exact skill content and license notice before approving catalog changes. The package requires Node.js 22.20 or newer.

## Local development

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
pnpm test
```

Commit `dist/cli.js` with CLI source changes. Tests reject a stale runtime or a package that requires a consumer build hook. After building, local target projects can also run `node /absolute/path/to/skills/dist/cli.js init --commit`.

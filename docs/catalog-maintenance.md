# Synchronize company skill snapshots

The monthly workflow proposes approved upstream revisions and matching snapshots in one pull request. A person reviews and merges the proposal. It never merges automatically or updates consumer repositories.

## Run locally

Use Node.js 22.20 or newer. No dependency install is required for synchronization.

| Command | Result |
| --- | --- |
| `pnpm skills:sync` | Copy the approved pins from `catalog.json`. |
| `pnpm skills:sync --update` | Resolve current upstream default-branch revisions, verify unchanged licenses, and propose matching catalog and snapshots. |
| `pnpm skills:sync --check` | Verify local file hashes, modes, and catalog correspondence without network access or writes. |
| `pnpm skills:sync --help` | Show command usage. |

The equivalent direct command is `node scripts/sync-skills.mjs`. Accept at most one option. Unknown, repeated, or conflicting options fail without writes. Review catalog selection changes before running the default sync. Disabled sources stay disabled. The company-owned skill is never copied over.

## Copies and provenance

| File | Purpose |
| --- | --- |
| `catalog.json` | Approved selections, revisions, and license metadata. |
| `skills/vendor/<source>/<name>/` | Complete upstream skill directory and supporting files. |
| Each skill's `LICENSE.upstream` | Exact upstream repository license notice, included during stock installation. |
| Each skill's `PROVENANCE.json` | Original repository, canonical repository, pin, source path, original and installed name, and adaptations. |
| `skills/vendor/_manifest.json` | SHA-256 hashes and file modes, plus the matching catalog hash. |

Only colliding names receive source-prefixed aliases. Their frontmatter name is the only changed upstream content. Other upstream files, executable bits, notices, and links remain intact. The stock installer discovers these real folders, not `catalog.json`. The separate company wrapper retains its upstream source-qualified IDs and optional commits.

Synchronization uses public HTTPS without ambient credentials. It verifies Git blob hashes and limits paths, file types, size, count, and redirects. It rejects incomplete trees, ambiguous skill paths, symlinks, submodules, changed license classifications, missing notices, and conflicting installed names. Upstream content remains data: the command never executes scripts, agent instructions, or installation hooks from upstream repositories. These checks do not establish that skill instructions are safe to use. Review them before installation.

Local snapshot edits, added files, removed files, and changed modes block replacement. Preserve those edits separately before restoring approved snapshots. Do not delete local edits merely to clear a check.

## Transaction recovery

Writers use `.skills-sync.lock/` for exclusion, staging, and rollback backups. Ordinary download or validation failures leave the catalog and snapshots unchanged. The command rechecks local content before replacement and rolls back a failed replacement.

A process kill or machine failure can interrupt the two-path replacement. A remaining lock blocks further sync and integrity checks. Do not remove it blindly. Inspect `original-catalog`, `old-vendor`, `new-vendor`, and the live catalog/vendor paths to determine which replacement completed. Preserve both local changes and backups. Restore a matching catalog/vendor pair before removing the lock and checking again. The lock does not stop unrelated programs from editing files; do not edit snapshots during sync.

## Monthly proposals

The workflow runs at **09:23 UTC on the first day of each month**, or on manual dispatch. It uses pinned actions, an explicit Node version, a time limit, and serialized runs. Checkout does not persist credentials. Only the pull request action receives the repository token; downloads use anonymous public HTTPS. No upstream code is executed, and no dependency install is needed.

The proposal branch is `automation/catalog-updates`. Its allowed paths are `catalog.json` and `skills/vendor/`. Review the complete snapshot diff, provenance, and license notices before merging. Source moves, missing selected skills, license changes, or API limits fail the job without publishing a partial proposal. The workflow never runs the source content it downloads.

Repository administrators must enable **Settings → Actions → General → Workflow permissions → Allow GitHub Actions to create and approve pull requests**. The workflow must reach the default branch before the schedule becomes active. Keep action references pinned to reviewed immutable commit SHAs.

## Catalog-only inspection

The existing metadata-only updater remains available with its previous behavior:

```sh
node scripts/catalog-updates.mjs --check
node scripts/catalog-updates.mjs --write --catalog /path/to/catalog.json
```

It does not synchronize snapshots. Do not use its catalog-only write as the monthly snapshot pipeline. Use `skills:sync --update` to keep snapshot revisions and GitHub blob license URLs compatible with the company CLI.

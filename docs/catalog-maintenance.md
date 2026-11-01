# Synchronize company skill snapshots

The monthly workflow proposes approved upstream revisions and matching snapshots in one pull request. A person reviews and merges the proposal. It never merges automatically or updates consumer repositories.

## Run locally

Use Node.js 22.20 or newer. No dependency install is required for synchronization.

| Command | Result |
| --- | --- |
| `pnpm skills:sync` | Copy the approved pins from `catalog.json` and generate author groups. |
| `pnpm skills:sync --update` | Resolve current upstream default-branch revisions, verify unchanged licenses, and propose matching catalog and snapshots. |
| `pnpm skills:sync --check` | Verify file hashes, modes, catalog correspondence, and author metadata without network access or writes. |
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
| `.claude-plugin/marketplace.json` | Generated author groups for the stock Skills picker and listing, with unchanged skill names. Its hash and mode are checked by the snapshot manifest. |

Only colliding names receive source-prefixed aliases. Their frontmatter name is the only changed upstream content. Other upstream files, executable bits, notices, and links remain intact. The stock installer discovers these real folders, not `catalog.json`. The separate company wrapper retains its upstream source-qualified IDs and optional commits.

The stock CLI sorts author groups and their skills. The two Vercel Labs repositories share one author group. Matt's explicit allowlist contains only the 27 paths declared by his approved plugin manifest: Engineering and Productivity. His 11 ungrouped `Other` skills are not copied, and monthly revision updates do not add them back.

Synchronization uses public HTTPS without ambient credentials. It verifies Git blob hashes and limits paths, file types, size, count, and redirects. It rejects incomplete trees, ambiguous skill paths, symlinks, submodules, changed license classifications, missing notices, and conflicting installed names. Upstream content remains data: the command never executes scripts, agent instructions, or installation hooks from upstream repositories. These checks do not establish that skill instructions are safe to use. Review them before installation.

Local snapshot or grouping-metadata edits, added files, removed files, and changed modes block replacement. An existing unmanaged marketplace file or a symlinked metadata directory also blocks sync. Preserve those edits separately before restoring approved snapshots. Do not delete local edits merely to clear a check. The first sync upgrades older snapshots that have no grouping metadata; it does not overwrite an existing unmanaged configuration.

## Transaction recovery

Writers use `.skills-sync.lock/` for exclusion, staging, and rollback backups. Ordinary download or validation failures leave the catalog, snapshots, and author metadata unchanged. The command rechecks local content before replacement and rolls back a failed replacement.

A process kill or machine failure can interrupt the three-path replacement. A remaining lock blocks further sync and integrity checks. Do not remove it blindly. Inspect `original-catalog`, `old-vendor`, `new-vendor`, `original-marketplace`, `new-marketplace`, and the live paths to determine which replacement completed. Preserve both local changes and backups. Restore matching catalog, vendor, and marketplace files before removing the lock and checking again. For an initial failed sync, the old marketplace may not exist. The lock does not stop unrelated programs from editing files; do not edit snapshots or metadata during sync.

## Monthly proposals

The workflow runs at **09:23 UTC on the first day of each month**, or on manual dispatch. It uses pinned actions, an explicit Node version, a time limit, and serialized runs. Checkout does not persist credentials. Only the pull request action receives the repository token; downloads use anonymous public HTTPS. No upstream code is executed, and no dependency install is needed.

The proposal branch is `automation/catalog-updates`. Its allowed paths are `catalog.json`, `skills/vendor/`, and `.claude-plugin/marketplace.json`. Review the complete snapshot diff, author groups, provenance, and license notices before merging. Source moves, missing selected skills, license changes, or API limits fail the job without publishing a partial proposal. The workflow never runs the source content it downloads.

Repository administrators must enable **Settings → Actions → General → Workflow permissions → Allow GitHub Actions to create and approve pull requests**. The workflow must reach the default branch before the schedule becomes active. Keep action references pinned to reviewed immutable commit SHAs.

## Catalog-only inspection

The existing metadata-only updater remains available with its previous behavior:

```sh
node scripts/catalog-updates.mjs --check
node scripts/catalog-updates.mjs --write --catalog /path/to/catalog.json
```

It does not synchronize snapshots. Do not use its catalog-only write as the monthly snapshot pipeline. Use `skills:sync --update` to keep snapshot revisions and GitHub blob license URLs compatible with the company CLI.

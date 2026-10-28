# Catalog update proposals

The monthly workflow proposes revision changes for enabled public sources. It opens or updates one reviewable pull request. A person must review and merge that pull request; the workflow never merges it or updates consumer repositories.

## Run locally

Use Node.js with built-in modules only:

```sh
node scripts/catalog-updates.mjs --check
node scripts/catalog-updates.mjs --write
node scripts/catalog-updates.mjs --check --catalog /path/to/catalog.json
```

`--check` reports current revisions, candidate revision summaries, and disabled sources. It does not write. `--write` writes only when a candidate differs. It validates the complete catalog before network access and updates no files when any enabled source cannot be verified.

The command accepts exactly one mode, `--check` or `--write`. `--catalog PATH` is optional and may appear once. Unknown, repeated, missing, or conflicting options return an error. The default path is `catalog.json` at the repository root.

The updater reads public GitHub repository, default-branch commit, and license metadata over HTTPS. It uses no Git shell command or ambient authentication token. It rejects HTTP errors, unknown SPDX metadata, and license changes for human review. It preserves source records, skill selections, and unknown metadata. Disabled sources remain disabled and are reported without network access.

Candidate reports link to the upstream revision comparison, license file comparison, and source content comparison. Review the full diff and license provenance before approval. The updater does not establish that upstream content is safe to install.

## Workflow controls

The workflow runs on the first day of each month and on manual dispatch. It runs only the updater; upstream skill content is treated as catalog data and is never executed. The pull request action receives a scoped repository token to update only `catalog.json` on `automation/catalog-updates`. There is no auto-merge step.

Repository administrators must enable **Settings → Actions → General → Workflow permissions → Allow GitHub Actions to create and approve pull requests**. Do not enable auto-merge for this workflow. Keep the action references pinned to reviewed immutable commit SHAs.

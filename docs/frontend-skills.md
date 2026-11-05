# Frontend skills per project

Run installation from the target project's root. Do not use `--global` when sharing the selection through that project's Git repository. Installation makes skills available to an agent; it does not run them or automatically install them into every project.

## Choose a workflow

| Skill | Use it for | Upstream | License |
| --- | --- | --- | --- |
| `hallmark` | New websites and pages with a distinctive visual direction. Existing-design changes require an explicit Hallmark request. | [Nutlope/hallmark](https://github.com/Nutlope/hallmark) | MIT |
| `impeccable` | Interface design, critique, accessibility review, refinement, and production edge cases. | [pbakaus/impeccable](https://github.com/pbakaus/impeccable) | Apache-2.0; includes `NOTICE.md` |
| `ui-ux-pro-max` | Searchable UX rules, palettes, typography, charts, and stack-specific guidance. | [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) | MIT; retain bundled data attribution |
| `logo-design` | Logos, SVG brand marks, favicons, and identity assets. | [kaankiziltug/logo-design-skill](https://github.com/kaankiziltug/logo-design-skill) | MIT for skill text, scripts, templates, and catalog data; reference SVGs are excluded and retain `TRADEMARKS.md` restrictions |

Choose one primary design workflow for a task. Add `ui-ux-pro-max` when searchable guidance helps, and `logo-design` for identity work. Do not ask all design routers to direct the same screen at once. Reuse the project's established components and constraints.

The repository already offers `frontend-design`, `shadcn`, `shadcn-audit`, `tailwind-design-system`, `typescript-advanced-types`, `vercel-react-best-practices`, `responsive-design`, `vite`, and `pnpm`. This PR does not update those snapshots or enable the three Vercel skills awaiting license approval. It does not add Playwright CLI, Unslop, Flutter skills, or the Three.js skill suite. A selected upstream skill may itself contain guidance for several stacks; its supporting files are kept intact.

## Stock installer

List everything without installing:

```sh
pnpm dlx skills add Crystal-Desarrollo/skills --list
```

Install one skill for OpenCode without prompts:

```sh
pnpm dlx skills add Crystal-Desarrollo/skills --skill impeccable --agent opencode --yes
```

Repeat `--skill` to select more. Replace `opencode` or repeat `--agent` for other supported agents. Without explicit selections, the stock command opens the author-grouped picker. Review the generated skill directories and lockfile before committing them. The stock installer does not make a commit.

## Company installer

For revision-pinned upstream installation and a recorded project selection:

```sh
pnpm --package=github:Crystal-Desarrollo/skills dlx crystal-skills init --skill pbakaus/impeccable/impeccable --agent opencode
```

Other source-qualified IDs:

```text
nutlope/hallmark/hallmark
nextlevelbuilder/ui-ux-pro-max-skill/ui-ux-pro-max
kaankiziltug/logo-design-skill/logo-design
```

Repeat `--skill` for multiple selections. Add `--commit` only when you want the installer to commit its generated files. Run the same package command with `update` to update the recorded selection to the packaged pins. See [CLI safety and update behavior](company-skills-cli.md).

## UI Taste: official external installation

UI Taste is still available, but upstream now distributes it through `uizze.sh`, not the current GitHub tree. The company catalog only supports immutable GitHub revisions. It therefore does not bundle an old GitHub mirror, silently replace UI Taste with another Uizze skill, or pretend it can update a domain-based source.

Install it separately using [upstream's documented command](https://github.com/uizze/uizze#install):

```sh
pnpm dlx skills add https://uizze.sh --skill ui-taste --agent opencode
```

This command follows the external source, not company-reviewed pins. Review its current content and license notices before installation. Keep its generated files and lock entry in the target project if the team wants to share it. Company updates do not manage this selection.

## Prerequisites and runtime behavior

- Company CLI: Node.js 22.20 or newer and pnpm; GitHub network access for installation.
- Hallmark: its optional helper scripts require Node.js; inspect their network behavior before using them.
- Impeccable: its launcher may download a platform-specific executable on first use. Installation and snapshot sync do not execute it. Upstream documents a manual-context fallback when the launcher cannot run. Review executable downloads separately from this Markdown snapshot.
- UI/UX Pro Max: Python 3 is needed for its local search scripts. Its datasets and references are included. Upstream examples use the Claude-only `${CLAUDE_PLUGIN_ROOT}` variable; on OpenCode and other hosts, resolve the actual installed skill directory instead. For a shared project install, for example, run `python3 .agents/skills/ui-ux-pro-max/scripts/search.py "keyboard focus" --domain ux` from the project root. Do not assume Claude's environment variable exists.
- Logo Design: Python 3 is needed for its helper scripts; extra rendering/export tools depend on the requested output. The SVG reference library is included, not fetched during installation. Its 1,432 reference logos are not MIT-licensed; upstream includes them solely for educational reference, grants no rights to them, and prohibits treating them as original product assets. Preserve `TRADEMARKS.md` and review applicable owner guidelines and law before any use beyond reference.
- UI Taste: its free design guidance does not require a paid Uizze MCP account. Optional hosted references have separate service requirements.

Examples after installation:

```text
Use hallmark to design a new product landing page within our brand constraints.
Use impeccable to polish src/pages/settings while preserving its current identity.
Use ui-ux-pro-max to check typography and interaction choices for our dashboard.
Use logo-design to explore an original SVG mark for our product.
```

Packaging and installer tests establish discovery, provenance, and file handling. They do not prove visual quality or model accuracy.

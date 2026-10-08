# Audit rules

## Apply evidence, not blanket bans

Use these IDs to identify checks. An ID is not itself proof of a violation.
Require an applicable project rule, verified local contract, or compatible official documentation for each confirmed violation.
Record the source of the requirement. Prefer an explicit project exception over generic style guidance.
If an exception conflicts with accessibility or functional requirements, disclose the conflict and its consequence instead of silently approving compliance.
Examples can suggest a composition without requiring every optional subcomponent.

Local customization is expected in shadcn. Do not classify upstream source differences as defects by themselves.
Do not recommend replacing a specialized widget with a component that changes its behavior or intended design.
Classify that proposal as requiring design review, not a proven equivalent replacement.

## Component adoption: both modes

| ID | Check | Evidence and limits |
| --- | --- | --- |
| C01 | Appropriate component adoption | Identify custom controls, feedback, navigation, overlays, and data surfaces with an equivalent shadcn component. An equivalent without a project adoption mandate is an opportunity, not an automatic violation. |
| C02 | Reuse of owned components | Trace imports and wrappers. Compare duplicate UI to installed components and documented project reuse rules. A wrapper that composes shadcn is already adoption. |
| C03 | Available replacement API | Verify actual exports, variants, primitive base, and dependencies before suggesting reuse. If a component is missing, label the opportunity as requiring addition; never suggest an import that does not exist as an immediate fix. |

| UI need | Candidate components |
| --- | --- |
| Actions and controls | Button, Input, Textarea, Checkbox, Switch, RadioGroup, Select, NativeSelect, Combobox, Slider, ToggleGroup. |
| Feedback | Alert, Badge, Empty, Skeleton, Spinner, Progress, implementation-compatible toast. |
| Navigation and overlays | Tabs, Sidebar, Breadcrumb, NavigationMenu, Dialog, AlertDialog, Sheet, Drawer, Popover, menus, Tooltip. |
| Data and layout | Card, Table, Avatar, Separator, Accordion, ScrollArea, Chart. |
| Form composition | Field, FieldGroup, InputGroup, or the project's compatible form abstraction. |

Verify availability and semantic fit; this table is not an installation list.
Keep layout containers, semantic headings, real links, hidden inputs, and justified native controls.
Do not replace all `div`, `span`, `button`, `input`, or `select` elements by tag name alone.
Raw HTML inside a primitive's own implementation does not indicate missing adoption.

## Full compliance only

| ID | Check | Evidence and limits |
| --- | --- | --- |
| F01 | Component composition | Verify roots, triggers, content, groups, lists, and item relationships against local and primitive APIs. Resolve conditional children and wrappers before declaring a required child missing. |
| F02 | Primitive-compatible props | Check Radix `asChild`, Base UI `render`, and other base-specific contracts where applicable. Detect unsupported props and nested interactive elements. Do not mix primitive APIs. |
| F03 | Forms and validation | Check label/control association, grouping, descriptions, invalid state, and disabled state. Respect compatible legacy Form abstractions; require newer Field APIs only when project rules mandate them. |
| F04 | Source accessibility | Check accessible names, overlay titles or valid naming alternatives, image alternatives, roles, and focusable controls. Check only source-provable facts; disclose runtime checks separately. |
| F05 | Variants and component styling | Prefer supported variants and shared extensions over repeated styling overrides where policy requires it. Layout classes and intentional local variants are valid. Show the actual conflicting contract or inconsistency. |
| F06 | Theme tokens and dark mode | When CSS variables are enabled, check semantic token use and theme mappings. Honor documented brand/status tokens. Inline colors and `dark:` utilities can be valid when CSS variables are disabled or local source intentionally uses them. |
| F07 | Spacing, sizing, and typography | Compare layouts to the detected style and project scale. Check gap versus space utilities, size shorthand, truncation, and typography only against an applicable convention. Do not invent a universal spacing scale. |
| F08 | Icons, slots, and state hooks | Verify icon library, sizing, `data-icon`, `data-slot`, conditional class utilities, and state selectors only when the local component contracts use them. Their absence in an older implementation is not a blanket violation. |
| F09 | Overlays and UI states | Check stacking overrides and source handling for loading, empty, error, disabled, controlled, and uncontrolled states. Focus, scrolling, animation, and responsive operation need runtime evidence. |

`component-only` does not run F01–F09. Do not promote a styling or accessibility finding into an adoption finding to bypass the mode.

## Documentation lookup

Fetch official documentation as needed rather than treating this catalog as frozen API documentation.
Start with the installed source and compatible primitive docs; newer examples are advisory if compatibility is uncertain.

| Primary source | Use |
| --- | --- |
| `https://ui.shadcn.com/docs/components-json` | Configuration and aliases. |
| `https://ui.shadcn.com/docs/theming` | CSS-variable and non-variable theming. |
| `https://ui.shadcn.com/docs/components` | Select the component and primitive base that match the project. |
| `https://www.radix-ui.com/primitives` | Applicable Radix contracts. |
| `https://base-ui.com/react/overview/quick-start` | Applicable Base UI contracts. |

These are lookup sources, not required installed skills. Keep all skill reference links local.

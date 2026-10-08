# Chat report contract

Return these tables in order. Keep recommendations read-only and preserve intended appearance and behavior.
For the missing-configuration stop, return only `shadcn is not configured`; do not return these tables.

## Summary

| Field | Value |
| --- | --- |
| Mode | `full` or `component-only`. |
| Scope | Resolved roots, paths or globs, and named-feature boundaries. |
| Implementation | React, primitive base, local style, aliases, and relevant versions. |
| Source coverage | Complete or incomplete, with reason. |
| Outcome | Confirmed violations found; opportunities only; or no confirmed violations in performed checks. |

Use incomplete coverage when files remain blocked or applicable source checks remain unverified.
With complete source coverage but no browser inspection, say source checks are complete and runtime/visual checks are unverified.
Do not use an unqualified pass, compliance score, or codebase-wide claim from partial evidence.

## Coverage

| Path or explicit file set | Role | Status | Checks or exclusion/blocker reason |
| --- | --- | --- | --- |
| Each inventoried path | Eligible UI, excluded, or context only | Inspected, blocked, excluded, or context only | Applied rules or precise reason. |

Include totals for eligible, inspected, blocked, excluded, and context-only files. Reconcile eligible = inspected + blocked.
Group paths only if the complete member list stays visible. Do not replace the file ledger with directory counts.
Separate inspected files with unverified checks from files that were not read; both prevent claims about unchecked source rules.

## Findings

| File:line | Category | Severity | Rule | Evidence and requirement | Preservation-aware recommendation |
| --- | --- | --- | --- | --- | --- |
| Exact source location | Violation or opportunity | High, medium, low, or advisory | C/F ID | Minimal source evidence plus project/local/doc requirement | Equivalent existing component or compatible pattern; note addition or design-review needs. |

| Category | Requirement |
| --- | --- |
| Violation | Source evidence proves a breach of an applicable rule or API contract. |
| Opportunity | An equivalent shadcn component could improve adoption, but no binding rule is breached. |
| Accepted exception | Explicit rule, decision, or evidenced requirement justifies the custom implementation. |

| Severity | Meaning |
| --- | --- |
| High | Confirmed issue blocks a primary action or accessible operation. |
| Medium | Confirmed functional, composition, or accessibility issue affects a usable flow. |
| Low | Confirmed style, token, or consistency requirement is breached without proven flow failure. |
| Advisory | Adoption opportunity; not a confirmed violation. |

Use one row per independently actionable location. A shared root cause can group explicitly listed locations.
Do not duplicate a primitive defect at each consumer or fabricate line numbers from search previews.
If no findings exist, say `None in performed checks` in the table. Preserve coverage and verification limits.

## Exceptions and conflicts

| File:line or applicable scope | Rule | Evidence | Disposition |
| --- | --- | --- | --- |
| Location or scope | Rule ID | Exact project instruction, decision, or verified specialized need | Accepted exception, or conflict requiring review with its consequence. |

Custom source alone does not establish intent. When justification is missing, report an opportunity or verification limit, not an invented exception.

## Verification

| Check | Result | Evidence or limit |
| --- | --- | --- |
| Source rules | Performed, partially performed, blocked, or not applicable | Applicable C/F IDs and unmet prerequisites. |
| Documentation | Verified, partial, or unavailable | Compatible sources used and uncertain contracts. |
| Browser/runtime/visual | Performed, partial, unverified, or not requested | Routes, states, viewport sizes, and actual observations. |

Recommend further verification without running mutations, installations, or artifact-producing checks without permission.

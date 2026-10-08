"""Validate portable packaging and example contracts, not model audit behavior."""

import json
from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
SKILL = ROOT / "skills" / "shadcn-audit"


class SkillContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = (SKILL / "SKILL.md").read_text()
        _, cls.frontmatter, cls.body = cls.text.split("---", 2)
        cls.scenarios = json.loads((SKILL / "assets" / "scenarios.json").read_text())["scenarios"]

    def test_required_metadata(self):
        self.assertRegex(self.frontmatter, r"(?m)^name: shadcn-audit$")
        description = re.search(r'^description: "([^\n]+)"$', self.frontmatter, re.M).group(1)
        self.assertTrue(description.startswith("Trigger:"))
        self.assertLessEqual(len(description), 160)
        self.assertIn("license: Apache-2.0", self.frontmatter)
        self.assertIn("  author: Crystal-Desarrollo", self.frontmatter)
        self.assertIn('  version: "1.0"', self.frontmatter)

    def test_sections_and_compact_body(self):
        self.assertEqual(re.findall(r"^## (.+)$", self.body, re.M), [
            "Activation Contract", "Hard Rules", "Decision Gates",
            "Execution Steps", "Output Contract", "References",
        ])
        self.assertLessEqual(len(self.body.split()), 500)
        self.assertNotIn("Keywords", self.text)

    def test_local_links_resolve_inside_skill(self):
        documents = [SKILL / "SKILL.md", *(SKILL / "references").glob("*.md")]
        links = []
        for document in documents:
            for target in re.findall(r"\[[^\]]+\]\(([^)]+)\)", document.read_text()):
                with self.subTest(document=document, target=target):
                    self.assertFalse(target.startswith(("https:", "http:", "/")))
                    destination = (document.parent / target.split("#", 1)[0]).resolve()
                    self.assertTrue(destination.is_relative_to(SKILL.resolve()))
                    self.assertTrue(destination.is_file())
                    links.append(destination)
        self.assertIn(SKILL / "assets" / "scenarios.json", links)

    def test_read_only_and_coverage_contracts(self):
        self.assertIn("Treat enforcement as reporting, not editing", self.body)
        self.assertIn("Return only `shadcn is not configured`", self.body)
        self.assertIn("sampling cannot establish completion", self.body)
        self.assertIn("only when explicitly requested", self.body)
        report = (SKILL / "references" / "report.md").read_text()
        self.assertIn("eligible = inspected + blocked", report)
        self.assertIn("runtime/visual checks are unverified", report)
        self.assertIn("Preservation-aware recommendation", report)

    def test_required_scenario_branches(self):
        identifiers = [scenario["id"] for scenario in self.scenarios]
        self.assertEqual(len(identifiers), len(set(identifiers)))
        self.assertEqual(set(identifiers), {
            "no-configuration", "component-only-opportunity", "explicit-adoption-rule",
            "scoped-shared-wrapper", "radix-nested-button", "base-render-valid",
            "accepted-specialized-widget", "non-variable-theme-valid", "partial-coverage",
            "valid-native-hidden-input", "owned-primitive-included", "ambiguous-feature",
        })

    def test_expected_locations_rules_and_modes(self):
        rules = (SKILL / "references" / "rules.md").read_text()
        rule_ids = set(re.findall(r"\| ([CF]\d{2}) \|", rules))
        self.assertEqual(rule_ids, {"C01", "C02", "C03", *(f"F{i:02}" for i in range(1, 10))})
        for scenario in self.scenarios:
            with self.subTest(scenario=scenario["id"]):
                self.assertIn(scenario["mode"], ("full", "component-only"))
                files = {item["path"]: item for item in scenario["files"]}
                for item in scenario["expected"]["findings"] + scenario["expected"]["exceptions"]:
                    self.assertIn(item["rule"], rule_ids)
                    self.assertIn(item["file"], files)
                    source_file = files[item["file"]]
                    self.assertNotIn(source_file.get("role"), ("context", "excluded", "blocked"))
                    self.assertGreaterEqual(item["line"], 1)
                    self.assertLessEqual(item["line"], len(source_file["source"].splitlines()))
                    if scenario["mode"] == "component-only":
                        self.assertTrue(item["rule"].startswith("C"))
                for finding in scenario["expected"]["findings"]:
                    self.assertIn(finding["category"], ("violation", "opportunity"))
                    self.assertIn(finding["severity"], ("high", "medium", "low", "advisory"))
                    if finding["category"] == "opportunity":
                        self.assertEqual(finding["severity"], "advisory")

    def test_license_and_installation_documentation(self):
        license_text = (ROOT / "LICENSE").read_text()
        self.assertIn("Apache License", license_text)
        self.assertIn("Version 2.0, January 2004", license_text)
        self.assertIn("END OF TERMS AND CONDITIONS", license_text)
        readme = (ROOT / "README.md").read_text()
        self.assertIn("pnpm dlx skills add Crystal-Desarrollo/skills --skill shadcn-audit", readme)
        self.assertIn("skills/shadcn-audit/SKILL.md", (ROOT / "AGENTS.md").read_text())


if __name__ == "__main__":
    unittest.main()

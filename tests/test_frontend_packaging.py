"""Check frontend snapshot resources and notices, not design quality."""

import json
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
VENDOR = ROOT / "skills" / "vendor"


class FrontendPackagingTests(unittest.TestCase):
    def test_required_resources_are_bundled(self):
        resources = {
            "nutlope-hallmark/hallmark": [
                "SKILL.md", "scripts/theme.mjs", "references/flow.md",
                "references/themes/index.json",
            ],
            "pbakaus-impeccable/impeccable": [
                "SKILL.md", "scripts/impeccable", "scripts/impeccable.cmd",
                "scripts/engine-checksums.txt", "reference/routing.md", "NOTICE.md",
            ],
            "nextlevelbuilder-ui-ux-pro-max-skill/ui-ux-pro-max": [
                "SKILL.md", "scripts/search.py", "scripts/core.py",
                "data/ui-reasoning.csv", "references/quick-reference.md",
                "data/data-provenance.json", "data/google-font-licenses.json",
            ],
            "kaankiziltug-logo-design-skill/logo-design": [
                "SKILL.md", "scripts/search_library.py", "scripts/svg_audit.py",
                "assets/library/catalog.json", "TRADEMARKS.md",
            ],
        }
        for directory, files in resources.items():
            for name in [*files, "LICENSE.upstream", "PROVENANCE.json"]:
                with self.subTest(directory=directory, name=name):
                    self.assertTrue((VENDOR / directory / name).is_file())

    def test_provenance_matches_catalog_pins(self):
        catalog = json.loads((ROOT / "catalog.json").read_text())
        sources = {source["source"]: source for source in catalog["sources"]}
        manifest = json.loads((VENDOR / "_manifest.json").read_text())
        for name in ["hallmark", "impeccable", "ui-ux-pro-max", "logo-design"]:
            skill = next(item for item in manifest["skills"] if item["installedName"] == name)
            provenance = json.loads((VENDOR / skill["target"] / "PROVENANCE.json").read_text())
            self.assertEqual(provenance["revision"], sources[provenance["source"]]["revision"])
            self.assertEqual(provenance["installedName"], name)
            self.assertEqual(provenance["adaptations"], [])

    def test_reference_logos_retain_non_mit_notice(self):
        skill = VENDOR / "kaankiziltug-logo-design-skill" / "logo-design"
        self.assertGreater(len(list((skill / "assets/library/svg").glob("*.svg"))), 1400)
        notice = (skill / "TRADEMARKS.md").read_text()
        self.assertIn("MIT license", notice)
        self.assertIn("grants no rights", notice)


if __name__ == "__main__":
    unittest.main()

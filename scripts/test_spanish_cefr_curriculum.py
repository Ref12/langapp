"""Tests for the CEFR Spanish inventory check (scripts/check_spanish_cefr_curriculum.py)."""

from __future__ import annotations

from copy import deepcopy
from pathlib import Path
import unittest

from check_spanish_cefr_curriculum import (
    DEFAULT_ROOT, LEVELS, check, check_data, counts, load_all,
)


class SpanishCefrInventoryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = load_all(DEFAULT_ROOT)

    def mutated(self):
        return deepcopy(self.data)

    def test_real_inventory_passes(self):
        self.assertEqual(check(Path(DEFAULT_ROOT)), [])

    def test_every_level_is_populated_and_cumulative_sizes_grow(self):
        totals = counts(DEFAULT_ROOT)
        running = 0
        for level in LEVELS:
            self.assertGreater(totals[level]["vocabulary"], 0, level)
            self.assertGreater(totals[level]["grammar"], 0, level)
            self.assertGreater(totals[level]["functions"], 0, level)
            running += totals[level]["vocabulary"]
        self.assertGreater(running, 5000)

    def test_a1_modules_are_in_range(self):
        modules = self.data["sequence"]["modules"]
        for module in modules[:-1]:
            self.assertTrue(8 <= len(module["units"]) <= 12, module["id"])
        self.assertTrue(5 <= len(modules[-1]["units"]) <= 12)

    def test_item_in_two_levels_is_reported(self):
        data = self.mutated()
        data["vocab"]["b1"].append(dict(data["vocab"]["a1"][0]))
        self.assertTrue(any("duplicate item" in line for line in check_data(data)))

    def test_long_gloss_is_reported(self):
        data = self.mutated()
        data["vocab"]["a2"][0]["gloss"] = "x" * 41
        self.assertTrue(any("gloss longer" in line for line in check_data(data)))

    def test_verb_without_class_is_reported(self):
        data = self.mutated()
        data["verbs"][0]["class"] = []
        self.assertTrue(any("no class" in line for line in check_data(data)))

    def test_vosotros_taught_is_reported(self):
        data = self.mutated()
        data["vocab"]["c2"][0].update({"lemma": "vosotros", "taught": True})
        self.assertTrue(any("vosotros" in line for line in check_data(data)))
        data = self.mutated()
        data["tenses"]["persons"][-1]["taught"] = True
        self.assertTrue(any("vosotros" in line for line in check_data(data)))

    def test_a1_item_missing_from_units_is_reported(self):
        data = self.mutated()
        data["sequence"]["modules"][0]["units"][0]["items"].pop(0)
        self.assertTrue(any("in no unit" in line for line in check_data(data)))

    def test_item_in_two_units_is_reported(self):
        data = self.mutated()
        first = data["sequence"]["modules"][0]["units"][0]["items"][0]
        data["sequence"]["modules"][0]["units"][1]["items"].append(first)
        self.assertTrue(any("more than one unit" in line for line in check_data(data)))

    def test_short_module_and_repeated_title_are_reported(self):
        data = self.mutated()
        data["sequence"]["modules"][1]["units"] = data["sequence"]["modules"][1]["units"][:3]
        data["sequence"]["modules"][2]["title"] = data["sequence"]["modules"][0]["title"]
        lines = check_data(data)
        self.assertTrue(any("units, expected" in line for line in lines))
        self.assertTrue(any("repeats" in line for line in lines))

    def test_verb_before_its_grammar_is_reported(self):
        data = self.mutated()
        modules = data["sequence"]["modules"]
        verb = next(row for row in data["verbs"] if row.get("taught_after") and row["lemma"] == "hablar")
        last_items = modules[-1]["units"][-1]["items"]
        for module in modules:
            for unit in module["units"]:
                if verb["id"] in unit["items"]:
                    unit["items"].remove(verb["id"])
        modules[0]["units"][0]["items"].insert(0, verb["id"])
        self.assertTrue(any("before its grammar" in line for line in check_data(data)), last_items[:1])


if __name__ == "__main__":
    unittest.main()

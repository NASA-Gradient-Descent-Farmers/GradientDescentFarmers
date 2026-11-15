import unittest

import pandas as pd

from gradientdescentfarmers.model_builder.soil_context import summarize_soil_context


class SoilContextTests(unittest.TestCase):
    def test_mass_weighted_total_n_and_carbon(self):
        rows = []
        for depth, n, carbon, density in (
            ("0-5cm", 2.02, 19.6, 1.41),
            ("5-15cm", 1.94, 14.3, 1.45),
            ("15-30cm", 1.60, 11.5, 1.42),
        ):
            for prop, value, unit in (("nitrogen", n, "g/kg"),
                                      ("soc", carbon, "g/kg"),
                                      ("bdod", density, "kg/dm3")):
                rows.append({"property": prop, "depth": depth, "value": value, "unit": unit})
        rows.append({"property": "phh2o", "depth": "0-5cm", "value": 8.0, "unit": "pH"})
        result = summarize_soil_context(pd.DataFrame(rows))
        weights = [5 * 1.41, 10 * 1.45, 15 * 1.42]
        self.assertAlmostEqual(result["soil_total_n_0_30cm_g_kg"],
                               sum(a * b for a, b in zip((2.02, 1.94, 1.60), weights)) / sum(weights))
        self.assertAlmostEqual(result["soil_organic_carbon_0_30cm_g_kg"],
                               sum(a * b for a, b in zip((19.6, 14.3, 11.5), weights)) / sum(weights))
        self.assertEqual(result["soil_ph_0_5cm"], 8.0)

    def test_missing_table_does_not_invent_nutrients(self):
        result = summarize_soil_context(None)
        self.assertIsNone(result["soil_total_n_0_30cm_g_kg"])
        self.assertEqual(result["soil_context_source"], "unavailable")

    def test_unexpected_unit_is_rejected(self):
        frame = pd.DataFrame([{"property": "nitrogen", "depth": "0-5cm",
                               "value": 2.0, "unit": "%"}])
        with self.assertRaisesRegex(ValueError, "Unexpected SoilGrids unit"):
            summarize_soil_context(frame)


if __name__ == "__main__":
    unittest.main()

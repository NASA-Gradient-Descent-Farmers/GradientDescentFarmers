import unittest

import pandas as pd

from gradientdescentfarmers.model_builder.profile_scenarios import (
    shift_profile_weather, soilgrids_water_proxy,
)


class ProfileScenariosTests(unittest.TestCase):
    def test_weather_shift_drops_leap_day_without_inventing_weather(self):
        weather = pd.DataFrame({
            "date": pd.date_range("2024-02-28", "2024-03-01"),
            "precip_mm": [1.0, 2.0, 3.0],
        })
        analog = shift_profile_weather(weather, years=2)
        self.assertEqual(analog.date.dt.strftime("%Y-%m-%d").tolist(),
                         ["2026-02-28", "2026-03-01"])
        self.assertEqual(analog.precip_mm.tolist(), [1.0, 3.0])

    def test_soil_proxy_has_real_anchors_and_explicit_assumptions(self):
        rows = []
        for depth in ("0-5cm", "5-15cm", "15-30cm"):
            rows.extend([
                {"property": "wv1500", "depth": depth, "value": 20, "unit": "vol%"},
                {"property": "wv0033", "depth": depth, "value": 35, "unit": "vol%"},
                {"property": "bdod", "depth": depth, "value": 1.4, "unit": "kg/dm3"},
            ])
        soil, initial = soilgrids_water_proxy(pd.DataFrame(rows))
        self.assertAlmostEqual(soil["SMW"], 0.2)
        self.assertAlmostEqual(soil["SMFCF"], 0.35)
        self.assertAlmostEqual(initial, 4.5)
        self.assertGreater(soil["SM0"], soil["SMFCF"])


if __name__ == "__main__":
    unittest.main()

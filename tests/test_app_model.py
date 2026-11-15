"""App-level checks for user overrides and irrigation settings."""

import unittest

from gradientdescentfarmers.app import run_model_app


class RecordingModelBuilder:
    def __init__(self):
        self.calls = []

    def build(self, source, config):
        self.calls.append((source, config))
        return config


class AppModelTests(unittest.TestCase):
    def test_user_dictionary_reaches_model_orchestrator(self):
        builder = RecordingModelBuilder()
        source = object()
        settings = run_model_app({
            "selected_products": ["maize", "fababean"],
            "water_mode": "rainfed", "soil_parameters": {"SMW": 0.1},
            "initial_available_water_cm": 10.0,
            "future_weather": "gs://test-bucket/future_weather.csv",
        }, source=source, model_builder=builder)
        self.assertIs(builder.calls[0][0], source)
        self.assertEqual(settings["selected_products"], ["maize", "fababean"])
        self.assertEqual(settings["water_mode"], "rainfed")
        self.assertEqual(settings["irrigation_system"], None)
        self.assertIn("historical_seasons", settings)

    def test_irrigated_requires_system_and_each_season_event(self):
        with self.assertRaisesRegex(ValueError, "irrigation_system"):
            run_model_app({"water_mode": "irrigated"}, model_builder=RecordingModelBuilder())
        with self.assertRaisesRegex(ValueError, "irrigation_events"):
            run_model_app({"water_mode": "irrigated", "irrigation_system": "drip"},
                          model_builder=RecordingModelBuilder())

    def test_irrigated_rotation_options_check_every_phase(self):
        historical = [{
            "crop": "maize", "sowing_date": "2024-05-15", "harvest_date": "2024-12-15",
            "irrigation_events": [{"date": "2024-06-01", "amount_mm": 40, "efficiency": 0.8}],
        }]
        options = [{"rotation_id": "two_phase", "phases": [
            {"crop": "maize", "sowing_date": "2027-05-15", "harvest_date": "2027-12-15",
             "area_ha": 1.0, "irrigation_events": [{"date": "2027-06-01", "amount_mm": 40, "efficiency": 0.8}]},
            {"crop": "maize", "sowing_date": "2028-05-15", "harvest_date": "2028-12-15",
             "area_ha": 1.0},
        ]}]
        with self.assertRaisesRegex(ValueError, "irrigation_events"):
            run_model_app({
                "water_mode": "irrigated", "irrigation_system": "drip",
                "soil_parameters": {"SMW": 0.1}, "initial_available_water_cm": 10.0,
                "historical_seasons": historical, "rotation_options": options,
            }, model_builder=RecordingModelBuilder())


if __name__ == "__main__":
    unittest.main()

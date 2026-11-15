"""App-level checks for user overrides and irrigation settings."""

import unittest

import pandas as pd

from gradientdescentfarmers.app import NoPointDataError, run_model_app


class RecordingModelBuilder:
    def __init__(self):
        self.calls = []

    def build(self, source, config):
        self.calls.append((source, config))
        return config


class AppModelTests(unittest.TestCase):
    def test_other_point_returns_no_data_before_loading_profile(self):
        with self.assertRaisesRegex(NoPointDataError, "No profile data is available"):
            run_model_app({"latitude": 21.0, "longitude": -101.1466639},
                          model_builder=RecordingModelBuilder())

    def test_app_resolves_unset_inputs_from_pinned_profile(self):
        class Profile:
            manifest = {"farmer_inputs": {"latitude": 20.4243195,
                                          "longitude": -101.1466639}}

            def table(self, name):
                if name == "weather_daily":
                    return pd.DataFrame({
                        "date": pd.date_range("2024-01-01", "2025-12-31"),
                        "precip_mm": 1.0,
                    })
                if name == "soil_properties_raw":
                    return pd.DataFrame([
                        {"property": prop, "depth": depth, "value": value, "unit": unit}
                        for depth in ("0-5cm", "5-15cm", "15-30cm")
                        for prop, value, unit in (
                            ("wv1500", 20.0, "vol%"), ("wv0033", 35.0, "vol%"),
                            ("bdod", 1.4, "kg/dm3"),
                        )
                    ])
                raise AssertionError(name)

        class Client:
            def load_profile(self, run_uri):
                self.run_uri = run_uri
                return Profile()

        client, builder = Client(), RecordingModelBuilder()
        settings = run_model_app({}, source=client, model_builder=builder)
        self.assertIs(builder.calls[0][0], client)
        self.assertEqual(settings["future_weather_source"],
                         "GCS_profile_2024_2025_weather_analog_plus_2y")
        self.assertEqual(settings["future_weather"].date.iloc[0], pd.Timestamp("2026-01-01"))
        self.assertEqual(settings["future_weather"].date.iloc[-1], pd.Timestamp("2027-12-31"))
        self.assertAlmostEqual(settings["soil_parameters"]["SMFCF"], 0.35)
        self.assertAlmostEqual(settings["initial_available_water_cm"], 4.5)

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

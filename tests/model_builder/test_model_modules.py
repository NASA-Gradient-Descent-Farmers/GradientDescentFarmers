import hashlib
import io
import json
import unittest
from datetime import date
from unittest.mock import Mock

import pandas as pd

from gradientdescentfarmers.model_builder.gcs import GCSDataClient
from gradientdescentfarmers.model_builder.wofost import _water_inputs, available_crop_varieties, validate_weather
from gradientdescentfarmers.model_builder.calibration import (
    calibrate_yield, calibrate_siap_yield, compare_siap_yield, error_metrics,
)


class FakeBlob:
    def __init__(self, payload):
        self.payload = payload

    def download_as_bytes(self):
        return self.payload


class FakeBucket:
    def __init__(self, objects):
        self.objects = objects

    def blob(self, name):
        return FakeBlob(self.objects[name])


class FakeClient:
    def __init__(self, objects):
        self.objects = objects

    def bucket(self, name):
        assert name == "data_dump_samples"
        return FakeBucket(self.objects)

    def list_blobs(self, bucket, prefix):
        return [Mock(name=name) for name in self.objects if name.startswith(prefix)]


class ModelModulesTests(unittest.TestCase):
    def test_catalog_choices_and_water_modes(self):
        catalog = Mock()
        catalog.get_crops_varieties.return_value = {
            "maize": ["Grain_maize_202", "Grain_maize_201"], "unknown": ["other"]
        }
        self.assertEqual(
            available_crop_varieties(catalog),
            {"maize": ["Grain_maize_201", "Grain_maize_202"]},
        )
        soil = {"SMW": 0.1, "SMFCF": 0.3, "SM0": 0.4, "RDMSOL": 100,
                "CRAIRC": 0.06, "SOPE": 10, "KSUB": 10, "K0": 10}
        start, end = date(2024, 5, 1), date(2024, 9, 30)
        rainfed_soil, rainfed_events = _water_inputs(
            "rainfed", start, end, soil, 10, None, None
        )
        irrigated_soil, irrigated_events = _water_inputs(
            "irrigated", start, end, soil, 10, "drip",
            [{"date": "2024-06-01", "amount_mm": 40, "efficiency": 0.8}],
        )
        self.assertEqual(rainfed_soil, irrigated_soil)
        self.assertEqual(rainfed_events, [])
        self.assertEqual(irrigated_events, [{date(2024, 6, 1): {"amount": 4.0, "efficiency": 0.8}}])
        with self.assertRaisesRegex(ValueError, "requires soil_parameters"):
            _water_inputs("rainfed", start, end, None, None, None, None)
        with self.assertRaisesRegex(ValueError, "SMW must be numeric"):
            _water_inputs("rainfed", start, end, {**soil, "SMW": None}, 10, None, None)
        with self.assertRaisesRegex(ValueError, "cannot include"):
            _water_inputs("rainfed", start, end, soil, 10, "drip", None)
        with self.assertRaisesRegex(ValueError, "requires irrigation_system"):
            _water_inputs("irrigated", start, end, soil, 10, None, None)

    def test_profile_table_checksum_and_identity(self):
        csv = b"date,tmin_c\n2024-01-01,12\n"
        run = "farm_profiles/guanajuato_valle_demo/runs/run123"
        manifest = {
            "run_id": "run123", "farmer_inputs": {"farm_id": "guanajuato_valle_demo"},
            "tables": {"weather_daily": {"relative_path": "standardized/weather_daily.csv",
                                         "format": "csv", "sha256": hashlib.sha256(csv).hexdigest()}},
        }
        objects = {f"{run}/farm_profile.json": json.dumps(manifest).encode(),
                   f"{run}/standardized/weather_daily.csv": csv}
        reader = GCSDataClient(FakeClient(objects)).load_profile(f"gs://data_dump_samples/{run}")
        self.assertEqual(reader.table("weather_daily").tmin_c.iloc[0], 12)
        objects[f"{run}/standardized/weather_daily.csv"] = b"changed"
        with self.assertRaisesRegex(ValueError, "SHA-256"):
            reader.table("weather_daily")

    def test_calibration_keeps_field_records_out_of_fit(self):
        simulation = pd.DataFrame({"year": [2024, 2025], "crop": ["maize", "maize"],
                                   "yield_t_ha": [4.0, 6.0], "is_final_day": [True, True]})
        siap = pd.DataFrame({"Anio": [2024, 2025], "Nommunicipio": ["Salamanca"] * 2,
                             "Nomcultivo": ["Maíz grano"] * 2, "Nomunidad": ["Tonelada"] * 2,
                             "Sembrada": [10, 10], "Volumenproduccion": [20, 30]})
        fields = pd.DataFrame({"yr": [2024], "product": ["MAIZE"],
                               "plot": ["field-1"], "yield": [8.0]})
        result = calibrate_yield(
            simulation, siap, fields, municipality="Salamanca",
            siap_crop_labels={"maize": "Maíz grano"}, field_crop_labels={"maize": "MAIZE"},
            field_columns={"year": "yr", "crop": "product", "field_id": "plot", "yield_t_ha": "yield"},
        )
        self.assertEqual(set(result.calibration_factor), {0.5})
        self.assertEqual(result.loc[result.level == "field", "role"].iloc[0], "comparison_only")
        self.assertEqual(len(result), 3)

    def test_field_year_without_weather_is_explicitly_unmatched(self):
        simulation = pd.DataFrame({"year": [2024], "crop": ["maize"],
                                   "yield_t_ha": [4.0], "is_final_day": [True]})
        siap = pd.DataFrame({"year": [2024], "municipality": ["Salamanca"],
                             "crop": ["Maíz grano"], "unit": ["Tonelada"],
                             "sown_ha": [10], "production_volume": [20]})
        fields = pd.DataFrame({"yr": [2019], "product": ["MAIZE"],
                               "plot": ["field-1"], "yield": [3.0]})
        result = calibrate_yield(
            simulation, siap, fields, municipality="Salamanca",
            siap_crop_labels={"maize": "Maíz grano"}, field_crop_labels={"maize": "MAIZE"},
            field_columns={"year": "yr", "crop": "product", "field_id": "plot", "yield_t_ha": "yield"},
        )
        field = result[result.level == "field"].iloc[0]
        self.assertEqual(field.role, "unmatched_year")
        self.assertTrue(pd.isna(field.calibrated_t_ha))

    def test_siap_errors_and_leave_one_year_out_use_only_other_year(self):
        simulation = pd.DataFrame({"year": [2024, 2025], "crop": ["maize", "maize"],
                                   "yield_t_ha": [4.0, 6.0], "is_final_day": [True, True],
                                   "water_mode": ["rainfed", "rainfed"]})
        siap = pd.DataFrame({"Anio": [2024, 2025], "Nommunicipio": ["Valle de Santiago"] * 2,
                             "Nomcultivo": ["Maíz grano"] * 2, "Nomunidad": ["Tonelada"] * 2,
                             "Sembrada": [10.0, 10.0], "Volumenproduccion": [20.0, 45.0]})
        comparison = compare_siap_yield(
            simulation, siap, municipality="Valle de Santiago",
            crop_labels={"maize": "Maíz grano"},
        )
        self.assertEqual(comparison.water_mode.tolist(), ["rainfed", "rainfed"])
        self.assertEqual(comparison.raw_error_t_ha.tolist(), [2.0, 1.5])
        self.assertAlmostEqual(error_metrics(comparison, prediction_column="simulated_t_ha").mae_t_ha.iloc[0], 1.75)
        calibrated = calibrate_siap_yield(comparison)
        self.assertAlmostEqual(calibrated.loyo_factor.iloc[0], 0.75)
        self.assertAlmostEqual(calibrated.loyo_factor.iloc[1], 0.5)
        changed = comparison.copy()
        changed.loc[0, "observed_t_ha"] = 3.0
        self.assertAlmostEqual(calibrate_siap_yield(changed).loyo_factor.iloc[0], 0.75)

    def test_weather_requires_complete_window(self):
        weather = pd.DataFrame({"date": ["2024-01-01"], "tmin_c": [10], "tmax_c": [20],
                                "precip_mm": [0], "rh_pct": [50], "wind_m_s": [2],
                                "solar_mj_m2_day": [15]})
        from datetime import date
        with self.assertRaisesRegex(ValueError, "every simulation day"):
            validate_weather(weather, date(2024, 1, 1), date(2024, 1, 2))


if __name__ == "__main__":
    unittest.main()

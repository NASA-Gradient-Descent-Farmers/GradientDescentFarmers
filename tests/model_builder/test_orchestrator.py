import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

import pandas as pd

from gradientdescentfarmers.model_builder.base import GuanajuatoModelBuilder


class FakeProfile:
    manifest = {
        "run_id": "fake-run",
        "farmer_inputs": {"latitude": 20.4243195, "longitude": -101.1466639},
        "topography": {"elevation_m": 1700.0},
    }

    def table(self, name):
        assert name == "weather_daily"
        return pd.DataFrame({"date": ["2024-05-15"]})


class FakeGCS:
    def load_profile(self, run_uri):
        assert run_uri.endswith("/fake-run")
        return FakeProfile()

    def read_frame(self, uri):
        year = int(uri.rsplit("_", 1)[-1].removesuffix(".csv"))
        return pd.DataFrame({
            "Anio": [year, year], "Nomestado": ["Guanajuato"] * 2,
            "Nommunicipio": ["Valle de Santiago", "Salamanca"],
            "Nomcultivo": ["Maíz grano", "Haba grano"],
            "Nomunidad": ["Tonelada"] * 2,
            "Sembrada": [10.0, 5.0], "Volumenproduccion": [20.0, 10.0],
            "Valorproduccion": [20.0 * (2000 + 50 * (year - 2003)),
                                10.0 * (3000 + 70 * (year - 2003))],
        })


class FakeGCSWithoutFabaCalibration(FakeGCS):
    def read_frame(self, uri):
        frame = super().read_frame(uri)
        if int(frame.Anio.iloc[0]) in (2024, 2025):
            return frame[frame.Nomcultivo != "Haba grano"].copy()
        return frame


def fake_wofost(weather, *, crop, sowing_date, end_date, water_mode, **kwargs):
    assert water_mode == "rainfed"
    return pd.DataFrame([{
        "date": pd.Timestamp(end_date).date(), "crop": crop,
        "year": pd.Timestamp(sowing_date).year, "yield_t_ha": 5.0,
        "is_final_day": True, "water_mode": water_mode,
        "variety": kwargs["variety"],
        "NamountSO": 30.0, "SM": 0.2,
        "summary_LAIMAX": 4.0, "summary_NuptakeTotal": 48.0,
        "terminal_RAINT": 15.0, "terminal_TOTIRR": 0.0,
        "terminal_WTRAT": 12.0, "terminal_EVST": 2.0,
    }])


def config(selected_products):
    return {
        "run_uri": "gs://data_dump_samples/farm_profiles/guanajuato_valle_demo/runs/fake-run",
        "state": "Guanajuato", "municipality": "Valle de Santiago",
        "water_mode": "rainfed", "future_weather": pd.DataFrame({"date": ["2027-05-15"]}),
        "future_weather_source": "test_scenario",
        "selected_products": selected_products,
        "historical_seasons": [
            {"crop": crop, "sowing_date": f"{year}-05-15", "harvest_date": f"{year}-12-15"}
            for crop in ("maize", "fababean") for year in (2024, 2025)
        ],
        "planned_rotation": [
            {"crop": "maize", "sowing_date": "2027-05-15",
             "harvest_date": "2027-10-20", "area_ha": 2.0},
            {"crop": "fababean", "sowing_date": "2028-01-15",
             "harvest_date": "2028-05-20", "area_ha": 1.5},
        ] if selected_products else [
            {"crop": "maize", "sowing_date": "2027-05-15",
             "harvest_date": "2027-10-20", "area_ha": 2.0},
        ],
    }


class OrchestratorTests(unittest.TestCase):
    def setUp(self):
        self.builder = GuanajuatoModelBuilder(wofost_runner=fake_wofost)
        self.gcs = FakeGCS()

    def test_complete_flow_selects_minimum_price_error_and_multiplies_tonnes(self):
        result = self.builder.build(self.gcs, config(["maize", "fababean"]))
        self.assertEqual(set(result.final_df.crop), {"maize", "fababean"})
        self.assertEqual(result.horizon_months, 29)
        self.assertEqual(result.rotation_df.rotation_step.tolist(), [1, 2])
        self.assertEqual(result.rotation_df.crop.tolist(), ["maize", "fababean"])
        self.assertEqual(result.final_df.season_id.tolist(), ["planned_001", "planned_002"])
        self.assertFalse(result.final_df.soil_state_carried_forward.any())
        for column in ("NamountSO", "SM", "summary_LAIMAX", "terminal_RAINT"):
            self.assertNotIn(column, result.final_df)
            self.assertIn(column, result.future_daily_df)
        self.assertNotIn("wofost_daily_json", result.final_df)
        self.assertEqual(result.final_df.rainfall_total_mm.tolist(), [150.0, 150.0])
        self.assertEqual(result.final_df.transpiration_total_mm.tolist(), [120.0, 120.0])
        self.assertEqual(result.final_df.soil_evaporation_total_mm.tolist(), [20.0, 20.0])
        self.assertEqual(result.final_df.plant_n_uptake_kg_ha.tolist(), [48.0, 48.0])
        self.assertTrue(result.final_df.soil_total_n_0_30cm_g_kg.isna().all())
        for crop in ("maize", "fababean"):
            row = result.final_df[result.final_df.crop == crop].iloc[0]
            board = result.price_leaderboard_df[result.price_leaderboard_df.crop == crop]
            self.assertEqual(row.price_model, board.loc[board.mae_mxn_t.idxmin(), "model"])
            self.assertAlmostEqual(row.calibrated_t_ha, 2.0)
            self.assertAlmostEqual(row.estimated_tonnes, 2.0 * row.area_ha)
            self.assertAlmostEqual(row.estimated_gross_value_mxn,
                                   row.estimated_tonnes * row.estimated_price_mxn_t)
        self.assertEqual(result.final_df.set_index("crop").loc["maize", "calibration_scope"],
                         "municipal")
        self.assertEqual(result.final_df.set_index("crop").loc["fababean", "calibration_scope"],
                         "state")
        self.assertEqual(result.final_df.set_index("crop").loc["fababean", "price_scope"],
                         "state")

    def test_csv_bundle_keeps_daily_and_rotation_outputs(self):
        result = self.builder.build(self.gcs, config(["maize", "fababean"]))
        with TemporaryDirectory() as directory:
            paths = result.save_csv_bundle(directory, prefix="example")
            self.assertEqual(len(paths), 13)
            self.assertTrue(all(Path(path).exists() for path in paths.values()))
            daily = pd.read_csv(paths["future_daily_df"])
            rotation = pd.read_csv(paths["rotation_df"])
            self.assertEqual(rotation.crop.tolist(), ["maize", "fababean"])
            self.assertEqual(daily.rotation_step.tolist(), [1, 2])
            self.assertEqual(daily.summary_LAIMAX.tolist(), [4.0, 4.0])
            self.assertEqual(daily.terminal_RAINT.tolist(), [15.0, 15.0])

    def test_multiple_rotations_keep_one_final_row_per_phase(self):
        values = config(["maize", "fababean"])
        values["rotation_options"] = [
            {"rotation_id": "three_phase", "phases": [
                {"crop": "maize", "sowing_date": "2027-05-15", "harvest_date": "2027-10-20", "area_ha": 2.0},
                {"crop": "fababean", "sowing_date": "2028-01-15", "harvest_date": "2028-05-20", "area_ha": 1.5},
                {"crop": "maize", "sowing_date": "2029-05-15", "harvest_date": "2029-10-20", "area_ha": 2.0},
            ]},
            {"rotation_id": "two_phase", "phases": [
                {"crop": "maize", "sowing_date": "2027-05-15", "harvest_date": "2027-10-20", "area_ha": 1.0},
                {"crop": "fababean", "sowing_date": "2028-01-15", "harvest_date": "2028-05-20", "area_ha": 1.0},
            ]},
        ]
        result = self.builder.build(self.gcs, values)
        final = result.final_df
        self.assertEqual(len(final), 5)
        self.assertEqual(final.groupby("rotation_id").size().to_dict(),
                         {"three_phase": 3, "two_phase": 2})
        self.assertEqual(final.loc[final.rotation_id == "three_phase", "rotation_step"].tolist(),
                         [1, 2, 3])
        self.assertEqual(final.rotation_option_count.unique().tolist(), [2])
        self.assertEqual(result.horizon_months, 46)
        self.assertEqual(final.loc[0, "estimated_price_mxn_t"],
                         final.loc[3, "estimated_price_mxn_t"])
        for row in final.itertuples():
            self.assertAlmostEqual(row.estimated_gross_value_mxn,
                                   row.estimated_tonnes * row.estimated_price_mxn_t)
        with TemporaryDirectory() as directory:
            path = result.save_final_csv(Path(directory) / "final.csv")
            exported = pd.read_csv(path)
            self.assertEqual(len(exported), 5)
            self.assertEqual(exported.rotation_id.tolist(), final.rotation_id.tolist())

    def test_rotation_options_reject_overlapping_phases(self):
        values = config(["maize"])
        values["rotation_options"] = [{"rotation_id": "overlap", "phases": [
            {"crop": "maize", "sowing_date": "2027-05-15", "harvest_date": "2027-10-20", "area_ha": 1.0},
            {"crop": "maize", "sowing_date": "2027-10-20", "harvest_date": "2027-12-20", "area_ha": 1.0},
        ]}]
        with self.assertRaisesRegex(ValueError, "nonoverlapping"):
            self.builder.build(self.gcs, values)

    def test_omitted_products_follow_municipal_siap_history(self):
        result = self.builder.build(self.gcs, config(None))
        self.assertEqual(result.final_df.crop.tolist(), ["maize"])

    def test_future_weather_is_explicit(self):
        values = config(["maize"])
        values.pop("future_weather")
        with self.assertRaisesRegex(ValueError, "future_weather"):
            self.builder.build(self.gcs, values)

    def test_missing_faba_yield_observations_do_not_reuse_maize_calibration(self):
        with self.assertRaisesRegex(ValueError, "Cannot calibrate fababean"):
            self.builder.build(FakeGCSWithoutFabaCalibration(), config(["maize", "fababean"]))

    def test_irrigation_system_and_events_reach_each_wofost_season(self):
        calls = []

        def capturing_runner(weather, *, crop, sowing_date, end_date, water_mode,
                             irrigation_system, irrigation_events, **kwargs):
            calls.append((water_mode, irrigation_system, irrigation_events))
            return pd.DataFrame([{
                "date": pd.Timestamp(end_date).date(), "crop": crop,
                "year": pd.Timestamp(sowing_date).year, "yield_t_ha": 5.0,
                "is_final_day": True,
            }])

        values = config(None)
        values["water_mode"] = "irrigated"
        values["irrigation_system"] = "drip"
        for season in [*values["historical_seasons"], *values["planned_rotation"]]:
            season["irrigation_events"] = [{
                "date": season["sowing_date"], "amount_mm": 40,
                "efficiency": 0.8,
            }]
        result = GuanajuatoModelBuilder(wofost_runner=capturing_runner).build(self.gcs, values)
        self.assertEqual(len(result.final_df), 1)
        self.assertEqual(len(calls), 3)
        self.assertTrue(all(mode == "irrigated" and system == "drip" and events
                            for mode, system, events in calls))


if __name__ == "__main__":
    unittest.main()

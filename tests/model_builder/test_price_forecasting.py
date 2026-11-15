import unittest

import pandas as pd

from gradientdescentfarmers.model_builder.price_forecasting import (
    add_prices_to_calibrated_wofost, compare_price_models,
    forecast_harvest_prices, prepare_siap_price_year, rotation_horizon,
    select_price_scope,
)


class PriceForecastingTests(unittest.TestCase):
    def test_siap_alias_and_production_weighted_price(self):
        frame = pd.DataFrame({
            "Anio": [2018, 2018, 2018, 2018],
            "Nomestado": ["Guanajuato"] * 4,
            "Nommunicipio": ["Valle de Santiago", "Valle de Santiago", "Salamanca", "Salamanca"],
            "Nomcultivo sin UM": ["Maíz grano", "Maíz grano", "Maíz grano", "Haba grano"],
            "Nomunidad": ["Tonelada"] * 4,
            "Volumenproduccion": [1, 3, 2, 1],
            "Valorproduccion": [1000, 3000, 3000, 2000],
        })
        prices = prepare_siap_price_year(
            frame, state="Guanajuato", municipality="Valle de Santiago",
            crop_labels={"maize": "Maíz grano", "fababean": "Haba grano"},
        )
        municipal = prices[(prices.crop == "maize") & (prices.scope == "municipal")].iloc[0]
        state = prices[(prices.crop == "maize") & (prices.scope == "state")].iloc[0]
        self.assertEqual(municipal.price_mxn_t, 1000)
        self.assertAlmostEqual(state.price_mxn_t, 7000 / 6)
        self.assertFalse(((prices.crop == "fababean") & (prices.scope == "municipal")).any())

    def test_state_fallback_and_last_harvest_horizon(self):
        rows = []
        for year in range(2003, 2026):
            rows.append({"year": year, "crop": "maize", "scope": "municipal",
                         "price_mxn_t": 1000 + 50 * (year - 2003)})
            if year <= 2023 and year != 2021:
                rows.append({"year": year, "crop": "fababean", "scope": "state",
                             "price_mxn_t": 2000 + 60 * (year - 2003)})
        rows.append({"year": 2005, "crop": "fababean", "scope": "municipal",
                     "price_mxn_t": 2500})
        prices = pd.DataFrame(rows)
        harvests, months, years = rotation_horizon(
            ["maize", "fababean"],
            [{"crop": "maize", "harvest_date": "2027-09-15"},
             {"crop": "fababean", "harvest_date": "2027-10-20"}],
            last_siap_year=2025,
        )
        self.assertEqual((months, years), (22, 2))
        maize_scope, maize_history, _ = select_price_scope(
            prices, crop="maize", last_siap_year=2025, horizon_years=years
        )
        faba_scope, faba_history, diagnostics = select_price_scope(
            prices, crop="fababean", last_siap_year=2025, horizon_years=years
        )
        self.assertEqual(maize_scope, "municipal")
        self.assertEqual(faba_scope, "state")
        self.assertEqual(diagnostics.iloc[-1].forecast_horizon_years, 4)
        boards = {crop: pd.DataFrame({"model": ["last_value"], "mae_mxn_t": [1.0]})
                  for crop in ("maize", "fababean")}
        annual, by_harvest = forecast_harvest_prices(
            {"maize": maize_history, "fababean": faba_history}, boards,
            harvests, last_siap_year=2025,
        )
        self.assertEqual(set(annual.forecast_year), {2026, 2027})
        self.assertEqual(annual.loc[(annual.crop == "fababean") &
                                    (annual.forecast_year == 2027),
                                    "forecast_step_years"].iloc[0], 4)
        self.assertEqual(len(by_harvest), 2)

    def test_backtest_uses_same_observed_holdouts(self):
        history = pd.DataFrame({
            "year": [year for year in range(2003, 2026) if year != 2021],
            "price_mxn_t": [3000 + 90 * (year - 2003) + 20 * (year % 3)
                            for year in range(2003, 2026) if year != 2021],
        })
        backtest, leaderboard, failures = compare_price_models(
            history, horizon_years=2
        )
        self.assertFalse(leaderboard.empty)
        self.assertNotIn(2021, backtest.target_year.tolist())
        self.assertEqual(set(backtest.horizon_years), {2})
        pairs = [set(zip(group.origin_year, group.target_year))
                 for _, group in backtest.groupby("model")]
        self.assertTrue(all(pair == pairs[0] for pair in pairs))
        self.assertTrue(leaderboard.mae_mxn_t.ge(0).all())
        self.assertEqual(set(failures.columns), {"model", "error"})

    def test_calibrated_tonnes_times_harvest_price(self):
        calibrated = pd.DataFrame({
            "crop": ["maize"], "harvest_date": ["2027-10-20"],
            "calibrated_t_ha": [3.0], "area_ha": [2.0],
        })
        prices = pd.DataFrame({
            "crop": ["maize"], "harvest_date": [pd.Timestamp("2027-10-20")],
            "estimated_price_mxn_t": [5000.0], "scope": ["municipal"],
            "model": ["last_value"], "last_observed_year": [2025],
        })
        result = add_prices_to_calibrated_wofost(calibrated, prices)
        self.assertEqual(result.estimated_tonnes.iloc[0], 6.0)
        self.assertEqual(result.estimated_gross_value_mxn.iloc[0], 30000.0)
        self.assertEqual(result.last_observed_year.iloc[0], 2025)


if __name__ == "__main__":
    unittest.main()

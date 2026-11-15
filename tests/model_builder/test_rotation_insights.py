"""Tests for the checks added on top of the rotation indicators: local adoption, bad-year replay, scenarios,
the previous-crop what-if, weather trends and GRACE water storage. Synthetic data except the last test."""

import numpy as np
import pandas as pd
import pytest

from gradientdescentfarmers.model_builder.rotations import grace, indicators, insights, trends
from test_rotations import synthetic_place
from gradientdescentfarmers.source_builder.district import grace as grace_build


def place_with_years(water="temporal"):
    """The synthetic place plus 23 years of monthly rain and ET0, and a 60 ha winter chickpea record."""
    place = synthetic_place(water)
    rng = np.random.default_rng(3)
    rows = []
    for year in range(2003, 2026):
        factor = rng.uniform(0.6, 1.3)
        for m in range(12):
            rows.append({"year": year, "month": m + 1, "rain": place.climate["rain"].iloc[m] * factor, "et0": 130.0})
    place.climate_years = pd.DataFrame(rows)
    siap = place.siap.copy()
    chick = siap["crop"] == "chickpea"
    siap.loc[chick, ["sown_ha", "harvested_ha"]] = 12.0          # 1.2% of the 1,000 ha of maize
    siap.loc[chick, "production_t"] = 12.0
    siap.loc[chick, "value_mxn"] = 12.0 * 9000
    place.siap = siap
    return place


def test_a_crop_sown_on_few_plots_is_flagged_and_a_common_one_is_not():
    place = place_with_years()
    base = indicators.evaluate(place, [{"pv": "maize"}])
    winter = insights.adoption(place, indicators.evaluate(place, [{"pv": "maize", "oi": "chickpea"}]), base)
    assert winter["condicional"]
    row = winter["cultivos_nuevos"][0]
    assert row["clave"] == "chickpea" and row["ha"] == 12 and row["proporcion"] == pytest.approx(0.012)
    assert "12 ha" in insights.adoption_lines(winter)[0]
    legume = insights.adoption(place, indicators.evaluate(place, [{"pv": "maize"}, {"pv": "bean"}]), base)
    assert not legume["condicional"] and legume["cultivos_nuevos"][0]["proporcion"] == pytest.approx(1.0)
    assert insights.adoption(place, base, base) == {"cultivos_nuevos": [], "condicional": False}


def test_bad_years_are_the_current_rotations_worst_and_use_the_trend():
    place = place_with_years()
    base = indicators.evaluate(place, [{"pv": "maize"}])
    info = insights.bad_years(place, base, base)
    rel = insights.relative_to_trend(base["income_by_year"])
    assert info["años"] == sorted(rel.nsmallest(insights.N_BAD).index)
    assert info["relativo"] == info["relativo_actual"] < 1
    assert set(info["lluvia_relativa"]) == set(info["años"])
    other = insights.bad_years(place, indicators.evaluate(place, [{"pv": "maize"}, {"pv": "sorghum"}]), base)
    assert other["años"] == info["años"]                      # the same years, so the comparison is paired
    assert other["relativo"] > info["relativo_actual"]        # an independent crop cushions maize's worst years
    assert "no un cálculo" in insights.bad_line(other)


def test_relative_to_trend_removes_a_steady_rise():
    years = pd.Index(range(2003, 2026))
    rising = pd.Series(np.linspace(1000, 3000, len(years)), index=years)
    assert np.allclose(insights.relative_to_trend(rising), 1.0)


def test_scenarios_move_water_the_right_way_and_keep_the_calendar():
    place = place_with_years()
    rotation = [{"pv": "maize"}]
    grid = insights.scenario_grid(place, rotation)
    values = np.array(grid["valores"])
    assert values.shape == (len(insights.TEMP_STEPS), len(insights.RAIN_STEPS))
    assert (np.diff(values, axis=1) >= 0).all()               # more rain: rain covers more of the need
    assert (np.diff(values, axis=0) <= 0).all()               # hotter: it covers less
    zero = values[insights.TEMP_STEPS.index(0.0), insights.RAIN_STEPS.index(0)]
    assert zero == pytest.approx(indicators.evaluate(place, rotation)["values"]["agua_cubierta"], abs=1e-3)
    hot = insights.shifted(place, 0, 3.0)
    assert hot.climate is place.climate                       # normals untouched: same sowing date and cycle

    irrigated = place_with_years("riego")
    need = np.array(insights.scenario_grid(irrigated, rotation)["valores"])
    assert (np.diff(need, axis=1) <= 0).all() and (np.diff(need, axis=0) >= 0).all()


def test_et0_factor_is_about_two_and_a_half_percent_per_degree():
    assert insights.et0_factor(20.0, 0.0) == 1.0
    assert insights.et0_factor(20.0, 1.0) == pytest.approx(1 + 1 / 37.8)


def test_precrop_what_if_is_separate_from_income_and_gives_the_break_even():
    place = place_with_years()
    base = indicators.evaluate(place, [{"pv": "maize"}])
    legume = indicators.evaluate(place, [{"pv": "maize"}, {"pv": "bean"}])
    assert insights.precrop(base, None) is None               # nothing follows a legume
    info = insights.precrop(legume, base)
    assert info["secuencias"] == ["maíz después de frijol"] and info["tipo"] == "supuesto de literatura"
    maize_income = next(i["income_mean"] for i in legume["seasons"] if i["season"].crop == "maize")
    mid = next(s for s in info["supuestos"] if s["nivel"] == "medio")
    assert mid["ingreso"] == round(legume["values"]["ingreso"] + 0.20 * maize_income / 2)
    assert info["ingreso_sin_efecto"] == round(legume["values"]["ingreso"])       # the indicator itself is untouched
    gap = base["values"]["ingreso"] - legume["values"]["ingreso"]
    expected = 0.0 if gap <= 0 else round(100 * gap / (maize_income / 2), 1)
    assert info["equilibrio_pct"] == expected
    assert [s["aumento_pct"] for s in info["supuestos"]] == [4, 20, 32]


def test_calendar_has_twelve_months_of_cover_per_rotation_year():
    place = place_with_years()
    e = indicators.evaluate(place, [{"pv": "maize", "oi": "chickpea"}, {"pv": "bean"}])
    cal = insights.calendar(e)
    assert [len(y["cobertura"]) for y in cal] == [12, 12]
    assert [c["cultivo"] for c in cal[0]["cultivos"]] == ["maíz", "garbanzo"]
    assert all(0 <= v <= 1 for y in cal for v in y["cobertura"])


def test_theil_sen_and_mann_kendall():
    years = np.arange(1982, 2026)
    rng = np.random.default_rng(0)
    warming = 25 + 0.03 * (years - 1982) + rng.normal(0, 0.2, len(years))
    assert trends.theil_sen(years, warming) == pytest.approx(0.03, abs=0.01)
    assert trends.mann_kendall(warming) < 0.01
    noise = rng.normal(600, 80, len(years))
    row = trends.trend_row(years, noise)
    assert not row["clara"]
    assert trends.trend_row(years[:10], noise[:10]) is None   # too few years to say anything


def test_grace_trend_recovers_a_slope_under_a_seasonal_cycle():
    t = 2002.3 + np.arange(250) / 12
    rng = np.random.default_rng(1)
    y = -0.8 * (t - t.mean()) + 6 * np.sin(2 * np.pi * t) + rng.normal(0, 1.5, len(t))
    slope, se = grace_build.trend(t, y)
    assert slope == pytest.approx(-0.8, abs=0.05) and 0 < se < 0.1
    assert np.isnan(grace_build.trend(t[:10], y[:10])[0])


def test_grace_trend_test_keeps_its_false_alarm_rate_with_correlated_months():
    """With no true trend, about 1 series in 10 should cross the 90% bar, also when months are correlated."""
    t = 2002.3 + np.arange(250) / 12
    rng = np.random.default_rng(5)
    for rho in (0.0, 0.5):
        alarms = 0
        for _ in range(400):
            e = rng.normal(0, 1.5, len(t))
            for i in range(1, len(e)):
                e[i] = rho * e[i - 1] + np.sqrt(1 - rho ** 2) * e[i]
            slope, se = grace_build.trend(t, 6 * np.sin(2 * np.pi * t) + e)
            alarms += abs(slope) > grace.CLEAR_Z * se
        assert 0.04 < alarms / 400 < 0.18


def test_grace_assigns_points_to_the_mascon_that_contains_them():
    table = pd.DataFrame({"lat": [20.5, 20.5, 21.5], "lon": [-101.5, -100.5, -100.5], "lat_span": 1.0, "lon_span": 1.0})
    assert list(grace_build.assign([(20.52, -100.81), (20.9, -101.9), (21.6, -100.4), (40.0, -100.6)], table)) == [1, 0, 2, 2]


def test_grace_lines_state_the_limits():
    summary = {"tendencia_cm_año": -1.0, "cambio_cm": -23.0, "clara": True, "posicion_nacional": 0.06, "periodo": [2002, 2026]}
    text = " ".join(grace.lines(summary, "riego"))
    assert "300 km" in text and "No ve tu pozo" in text and "CONAGUA" in text and "años secos recientes" in text
    unclear = grace.lines({**summary, "clara": False, "tendencia_cm_año": -0.2}, "temporal")
    assert len(unclear) == 1 and "sin tendencia clara" in unclear[0]
    assert grace.lines(None, "riego") == []


# --- At least two alternatives everywhere: the widened search --------------------------------------

def monoculture_place():
    """A district where maize covers nearly everything: 30 ha of bean here, and sorghum only elsewhere in the state."""
    place = synthetic_place()
    siap = place.siap[place.siap["crop"].isin(["maize", "bean"])].copy()
    siap.loc[siap["crop"] == "maize", ["sown_ha", "harvested_ha", "production_t", "value_mxn"]] *= 80
    bean = siap["crop"] == "bean"
    siap.loc[bean, ["sown_ha", "harvested_ha", "production_t", "value_mxn"]] *= 0.03
    elsewhere = place.siap[place.siap["crop"] == "sorghum"].assign(ddr=2)
    elsewhere[["sown_ha", "harvested_ha", "production_t", "value_mxn"]] *= 5
    place.siap = pd.concat([siap, elsewhere], ignore_index=True)
    return place


def test_wider_pool_lists_niche_crops_then_state_crops():
    from gradientdescentfarmers.model_builder.rotations import candidates

    place = monoculture_place()
    assert [c for c, _ in candidates.local_crops(place, "pv")] == ["maize"]
    wider = candidates.wider_crops(place, "pv")
    assert [(c, h["level"]) for c, h in wider] == [("bean", "distrito"), ("sorghum", "estado")]
    assert [c for c, _ in candidates.wider_crops(place, "pv", min_state_ha=1e6)] == ["bean"]   # state crops need scale
    current = [{"pv": "maize"}]
    assert candidates.generate(place, current) == []                                 # the usual search finds nothing
    widened = dict(candidates.generate(place, current, widen=True))
    assert widened["leguminosa"] == [{"pv": "maize"}, {"pv": "bean"}]
    assert widened["sequia"] == [{"pv": "sorghum"}, {"pv": "maize"}]


def test_crops_from_few_plots_or_from_outside_the_district_are_flagged_and_ranked():
    place = monoculture_place()
    base = indicators.evaluate(place, [{"pv": "maize"}])
    bean = insights.adoption(place, indicators.evaluate(place, [{"pv": "maize"}, {"pv": "bean"}]), base)
    sorghum = insights.adoption(place, indicators.evaluate(place, [{"pv": "sorghum"}, {"pv": "maize"}]), base)
    assert bean["condicional"] and bean["cultivos_nuevos"][0]["pocas_parcelas"]
    assert sorghum["condicional"] and sorghum["cultivos_nuevos"][0]["fuera_del_distrito"]
    assert insights.adoption_rank(insights.adoption(place, base, base)) == 0
    assert insights.adoption_rank(bean) == 1 and insights.adoption_rank(sorghum) == 2
    assert "menos de 0.1%" in insights.adoption_lines(bean, place)[0]               # 30 ha against 80,000
    assert "promedio de Prueba" in insights.adoption_lines(sorghum, place)[0]


def test_real_case_keeps_observed_model_and_literature_apart(panel_run):
    from gradientdescentfarmers.model_builder.rotations.compare import comparar_rotaciones, to_json
    r = comparar_rotaciones("Valle de Santiago", "maíz", estado="Guanajuato", prioridades=["riesgo", "suelo"])
    assert r["tendencias"]["lineas"] and r["agua_region"]["lineas"] and len(r["calendario_lugar"]["lluvia_mm"]) == 12
    for x in r["rotaciones"]:
        assert x["escenarios"]["valores"] and x["calendario"]
        effect = x["efecto_cultivo_anterior"]
        if effect:                                             # the what-if never changes the indicator
            assert effect["ingreso_sin_efecto"] == round(x["indicadores"]["ingreso"]["valor"])
    ranks = [insights.adoption_rank(a["adopcion"]) for a in r["rotaciones"][1:]]
    assert ranks == sorted(ranks)                              # options resting on few plots are listed last
    assert r["nota_opciones"] is None and not any(a["busqueda_ampliada"] for a in r["rotaciones"])
    assert to_json(r)
    fast = comparar_rotaciones("Valle de Santiago", "maíz", estado="Guanajuato", escenarios=False)
    assert all(x["escenarios"] is None for x in fast["rotaciones"])


# --- Fixes made when porting into model_builder ----------------------------------------------------

def season_like(sow_month, months_in_field, crop="wheat", cycle="oi"):
    from types import SimpleNamespace

    present = np.zeros(12)
    for m in months_in_field:
        present[m - 1] = 1.0
    sow_day = int(np.cumsum([0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30])[sow_month - 1]) + 5
    return SimpleNamespace(crop=crop, cycle=cycle, sow_day=sow_day, present_month=present)


def history_frame(years=range(1982, 2026), warming=0.04):
    rows = []
    rng = np.random.default_rng(2)
    for y in years:
        for m in range(1, 13):
            rows.append({"year": y, "month": m, "rain": 10 + rng.normal(0, 2), "et0": 120 + rng.normal(0, 3),
                         "tmin": 10 + rng.normal(0, 0.3), "tmax": 25 + warming * (y - 1982) + rng.normal(0, 0.3),
                         "frost_nights": 0.0, "heat_days": 0.0})
    return pd.DataFrame(rows)


def test_trend_window_follows_the_crop_across_the_new_year():
    s = season_like(11, [11, 12, 1, 2, 3, 4])
    assert trends.window(s) == [11, 12, 1, 2, 3, 4]
    assert trends.window_label(trends.window(s)) == "noviembre a abril"
    series = trends.window_series(history_frame(), trends.window(s), ["tmax", "rain"])
    assert series.index.min() == 1982 and series.index.max() == 2024        # Nov 2025-Apr 2026 is not complete
    assert series["rain"].iloc[0] == pytest.approx(60, abs=10)               # six months of ~10 mm


def test_place_trends_are_per_season_and_irrigated_places_get_the_water_note():
    from types import SimpleNamespace

    place = SimpleNamespace(climate_history=history_frame(), chirps_history=None)
    found = trends.place_trends(place, [season_like(11, [11, 12, 1, 2, 3, 4]), season_like(6, [6, 7, 8, 9], "maize", "pv")])
    assert [b["meses"][0] for b in found] == [11, 6]
    assert found[0]["tendencias"]["tmax"]["clara"]
    text = trends.lines(found, "riego")
    assert "noviembre a abril" in text[0] and "no un pronóstico" in text[0]
    assert any("temperatura máxima media sube" in t for t in text)
    assert any("Sin datos de CHIRPS" in t for t in text if t.startswith("La lluvia")) or \
        any("lluvia" in t and t.startswith("Sin tendencia clara") for t in text)
    assert "CONAGUA" in text[-1] and "ET0" in text[-1]
    assert "CONAGUA" not in " ".join(trends.lines(found, "temporal"))
    assert trends.place_trends(SimpleNamespace(climate_history=None), [season_like(11, [11, 12])]) == []


def test_trend_lines_say_no_clear_trend_instead_of_inventing_one():
    years = [1982, 2025]
    made = [{"cultivo": "maize", "ciclo": "pv", "meses": [6, 7, 8, 9, 10], "periodo": years, "tendencias": {
        "rain": {"clara": False, "nombre": "lluvia", "años": years},
        "tmax": {"clara": True, "pendiente_decada": 0.3, "primera_mitad": 26.2, "segunda_mitad": 26.8, "media": 26.5,
                 "nombre": "temperatura máxima media", "unidad": "°C", "decimales": 1, "relativa": False, "años": years},
        "heat_days": {"clara": True, "pendiente_decada": 0.0, "primera_mitad": 0.8, "segunda_mitad": 2.1, "media": 1.4,
                      "nombre": "días de 35 °C o más", "unidad": "días", "decimales": 1, "relativa": False, "años": years}}}]
    text = trends.lines(made)
    assert "junio a octubre" in text[0] and "no un pronóstico" in text[0]
    assert any("sube unos 0.3 °C por década" in t for t in text)
    assert any("aumentaron: de 0.8 a 2.1" in t for t in text)          # a zero median slope is not reported as "0.0"
    assert text[-1].startswith("Sin tendencia clara") and "lluvia" in text[-1]


def test_irrigated_district_gets_trends_over_its_winter_season(panel_run):
    from gradientdescentfarmers.model_builder.rotations.compare import comparar_rotaciones

    r = comparar_rotaciones("Bácum", "trigo", estado="Sonora", agua="riego", escenarios=False)
    assert r["lugar"]["distrito"] == "Cajeme"
    blocks = r["tendencias"]["detalle"]
    assert blocks and blocks[0]["ciclo"] == "oi" and 1 in blocks[0]["meses"]        # a winter window
    assert "CONAGUA" in r["tendencias"]["lineas"][-1]
    assert "chirps_coincide" in blocks[0]["tendencias"]["rain"]                    # checked against CHIRPS


def test_off_cycle_crop_is_not_proposed_in_its_off_season(panel_run):
    from gradientdescentfarmers.model_builder.rotations import candidates, places

    # Los Mochis: chickpea is a winter crop (thousands of ha in OI); SIAP has ~400 ha a year under PV.
    place = places.place("Ahome", "Sinaloa", water="riego")
    assert candidates.off_cycle(place, "chickpea", "pv")
    assert not candidates.off_cycle(place, "maize", "pv")                            # real summer maize stays
    assert "chickpea" not in [c for c, _ in candidates.local_crops(place, "pv")]
    current = candidates.assign_cycles(place, candidates.parse_rotation("maíz"))
    for template, rotation in candidates.generate(place, current):
        assert all(y.get("pv") != "chickpea" for y in rotation), (template, rotation)


def test_off_cycle_rule_on_synthetic_place():
    from gradientdescentfarmers.model_builder.rotations import candidates

    place = synthetic_place()
    assert not candidates.off_cycle(place, "chickpea", "oi")      # no PV record of chickpea to compare with
    extra = place.siap[place.siap["crop"] == "chickpea"].assign(cycle="pv", sown_ha=50.0, harvested_ha=50.0,
                                                               production_t=50.0, value_mxn=50.0 * 9000)
    place.siap = pd.concat([place.siap, extra], ignore_index=True)
    assert candidates.off_cycle(place, "chickpea", "pv") and not candidates.off_cycle(place, "chickpea", "oi")


def test_map_soil_without_igbp_values_is_reported_not_crashed(panel_run, monkeypatch):
    from gradientdescentfarmers.model_builder.rotations import panel, soil

    real = panel.read("soil_municipal")
    no_igbp = real.assign(profile_available_water_capacity=np.nan, soil_carbon_density=np.nan)
    monkeypatch.setattr(panel, "read", lambda name: no_igbp if name == "soil_municipal" else real)
    row = no_igbp.iloc[0]
    maps = soil.from_maps(int(row.state_id), int(row.mun_id))
    assert maps["textura"] and maps["agua_disponible_mapa_mm"] is None and maps["carbono_kg_m2"] is None
    assert "IGBP" not in maps["fuente"]


def test_model_builder_contract(tmp_path):
    from gradientdescentfarmers.model_builder import ModelBuilder
    from gradientdescentfarmers.model_builder.rotations import RotationModelBuilder
    from conftest import FIXTURE

    pytest.importorskip("pyarrow")
    builder = RotationModelBuilder()
    assert isinstance(builder, ModelBuilder)
    engine = builder.build({"output_dir": str(FIXTURE), "build_state": "complete"}, {"defaults": {"escenarios": False}})
    out = engine.compare("Ahome", "maíz", estado="Sinaloa", agua="riego")
    assert out["lugar"]["distrito"] == "Los Mochis" and all(x["escenarios"] is None for x in out["rotaciones"])
    assert set(engine.sites()["ddr_name"]) == {"Cortazar", "Los Mochis", "Cajeme"}
    with pytest.raises(ValueError):
        builder.build({"build_state": "failed", "output_dir": str(FIXTURE), "fatal": "x"}, {})
    with pytest.raises(FileNotFoundError):
        builder.build(str(tmp_path), {})


def test_sowing_month_moves_the_season_of_its_own_cycle():
    from gradientdescentfarmers.model_builder.rotations.indicators import sowing_cycle, sowing_day

    assert [sowing_cycle(m) for m in (3, 8, 9, 12, 1, 2)] == ["pv", "pv", "oi", "oi", "oi", "oi"]
    place = synthetic_place(water="riego")
    default_oi, default_pv = sowing_day(place, "oi"), sowing_day(place, "pv")
    place.sowing_month = 12
    assert sowing_day(place, "oi") == 334 + 10 and sowing_day(place, "pv") == default_pv     # December, winter only
    place.sowing_month = 1
    assert sowing_day(place, "oi") == 10                                                    # January sowing
    place.sowing_month = 6
    assert sowing_day(place, "oi") == default_oi and sowing_day(place, "pv") == 151 + 10


def test_winter_sowing_month_changes_water_and_trend_window_and_is_asked_for(panel_run):
    from gradientdescentfarmers.model_builder.rotations.compare import comparar_rotaciones

    default = comparar_rotaciones("Bácum", "trigo", estado="Sonora", agua="riego", escenarios=False)
    assert default["fechas_siembra"] == [{"ciclo": "oi", "cultivo": "wheat", "mes": 11, "fuente": "supuesto"}]
    assert [p["dato"] for p in default["preguntar"]] == ["mes_siembra"]
    december = comparar_rotaciones("Bácum", "trigo", estado="Sonora", agua="riego", mes_siembra=12, escenarios=False)
    assert december["fechas_siembra"][0]["fuente"] == "agricultor" and december["preguntar"] == []
    assert december["tendencias"]["detalle"][0]["meses"] != default["tendencias"]["detalle"][0]["meses"]
    water = lambda r: r["rotaciones"][0]["indicadores"]["agua"]["valor"]
    assert water(december) != water(default)
    assert any("el mes que nos dijiste" in line for line in december["tu_lugar"])
    june = comparar_rotaciones("Bácum", "trigo", estado="Sonora", agua="riego", mes_siembra=6, escenarios=False)
    assert any("no se usó" in line for line in june["tu_lugar"]) and june["fechas_siembra"][0]["fuente"] == "supuesto"
    summer = comparar_rotaciones("Valle de Santiago", "maíz", estado="Guanajuato", mes_siembra=6, escenarios=False)
    assert summer["fechas_siembra"][0] == {"ciclo": "pv", "cultivo": "maize", "mes": 6, "fuente": "agricultor"}
    assert summer["preguntar"] == []

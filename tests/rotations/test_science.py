"""Units, soil hydraulics and conservative economic reference handling."""
from datetime import date

import numpy as np
import pandas as pd
import pytest

pytest.importorskip("pcse")

from gradientdescentfarmers.model_builder.wofost_mvp.weather import prepare_weather, vapour_pressure_hpa
from gradientdescentfarmers.model_builder.wofost_mvp.soil import prepare_soil
from gradientdescentfarmers.model_builder.wofost_mvp.settings import ModelSettings
from gradientdescentfarmers.model_builder.wofost_mvp.builder import make_slots, enumerate_sequences
from gradientdescentfarmers.model_builder.wofost_mvp.economics import normalize_state_export, EconomicReference


def weather():
    return pd.DataFrame({"date": ["2024-01-01", "2024-01-02", "2024-01-03"],
                         "tmin_c": [10.]*3, "tmax_c": [25.]*3, "precip_mm": [20.]*3,
                         "solar_mj_m2_day": [15.]*3, "rh_pct": [70.]*3, "wind_m_s": [2.]*3})


def test_pcse_units_and_reference_et():
    from pcse.util import reference_ET
    provider, table = prepare_weather(weather(), 25.7, -108.8, 6.)
    day = provider(date(2024, 1, 1))
    assert day.RAIN == 2.
    assert day.IRRAD == 15_000_000.
    assert day.WIND == 2.
    assert 10 < day.VAP < 25
    expected = reference_ET(date(2024, 1, 1), 25.7, 6., 10., 25., 15_000_000., day.VAP, 2., .29, .49)
    assert [day.E0, day.ES0, day.ET0] == pytest.approx(np.array(expected) / 10)
    assert len(table) == 3


@pytest.mark.parametrize("defect", ["gap", "duplicate", "nan", "humidity", "temperature"])
def test_weather_defects_fail_without_imputation(defect):
    frame = weather()
    if defect == "gap": frame = frame.drop(index=1)
    elif defect == "duplicate": frame.loc[1, "date"] = frame.loc[0, "date"]
    elif defect == "nan": frame.loc[1, "precip_mm"] = np.nan
    elif defect == "humidity": frame.loc[1, "rh_pct"] = 110
    elif defect == "temperature": frame.loc[1, "tmin_c"] = 30
    with pytest.raises(ValueError):
        prepare_weather(frame, 25.7, -108.8, 6.)


def test_soilgrids_retention_uses_vol_percent_not_g_per_kg():
    rows = [{"property": prop, "depth": depth, "value": value}
            for prop, value in {"sand": 37., "clay": 34., "soc": 20., "bdod": 1.4,
                                "wv0033": 26., "wv1500": 17.8}.items()
            for depth in ["0-5cm", "5-15cm", "15-30cm"]]
    result = prepare_soil(pd.DataFrame(rows), ModelSettings())
    assert result["parameters"]["SMFCF"] == pytest.approx(.26)
    assert result["parameters"]["SMW"] == pytest.approx(.178)
    assert result["parameters"]["SM0"] == pytest.approx(1 - 1.4/2.65)
    assert result["inputs"]["sand_fraction"] == pytest.approx(.37)
    assert result["site"]["WAV"] == pytest.approx((.26-.178)*100*.6)


def test_three_campaign_enumeration_and_no_overlapping_calendar():
    slots = make_slots([2024, 2025], 3)
    assert [slot["season"] for slot in slots] == ["warm", "cool", "warm"]
    assert all(a["end"] < b["start"] for a, b in zip(slots, slots[1:]))
    sequences = enumerate_sequences(slots, ModelSettings())
    assert len(sequences) == 20
    assert all(sum(c is not None for c in seq) >= 2 for seq in sequences)


def state_records():
    rows = []
    for year, price in [(2021, 100.), (2022, 200.), (2023, 300.)]:
        rows.append({"AÑO": year, "CVE_ENT": 25, "ENTIDAD": "Sinaloa", "CULTIVO": "Maíz grano",
                     "VARIEDAD": "Blanco", "UNIDAD_MEDIDA": "Tonelada", "CICLO": "Primavera - Verano",
                     "MODALIDAD": "Temporal", "TIPO_TECNOLOGIA": "Cielo abierto", "TIPO_PRODUCCION": "Convencional",
                     "TIPO_MERCADO": "Nacional", "SUPERFICIE_SEMBRADA": 2., "SUPERFICIE_COSECHADA": 2.,
                     "SUPERFICIE_SINIESTRADA": 0., "VOLUMEN_PRODUCCION": 10., "RENDIMIENTO": 5.,
                     "PRECIO_MEDIO_RURAL": price, "VALOR_PRODUCCION": 10*price})
    return rows


def test_economics_keeps_gross_separate_from_margin_and_probability():
    frame, report = normalize_state_export(state_records())
    reference = EconomicReference(frame, {}, {"economics_applicable": True, "cve_ent": "25"})
    simulation = {"water_regime": "rainfed", "campaigns": [{"crop": "maize", "marketable_grain_t_ha": 2.}]}
    gross = reference.evaluate(simulation, {})
    assert gross["gross_median_mxn_ha"] == 400
    assert gross["margin_median_mxn_ha"] is None
    assert gross["net_profit_mxn_ha"] is None
    assert gross["gross_p10_mxn_ha"] == pytest.approx(240.)
    margin = reference.evaluate(simulation, {"maize": 50.})
    assert margin["margin_median_mxn_ha"] == 350.
    assert margin["net_profit_mxn_ha"] is None
    assert "not a confidence" in gross["price_interval_kind"]


def test_duplicate_state_records_do_not_double_count_and_conflicts_fail():
    rows = state_records()
    frame, _ = normalize_state_export(rows + [rows[0]])
    assert len(frame) == 3
    conflict = {**rows[0], "PRECIO_MEDIO_RURAL": 200.}
    with pytest.raises(ValueError, match="conflicting"):
        normalize_state_export(rows + [conflict])


def test_economics_outside_mexico_stays_unavailable_not_zero():
    reference = EconomicReference(None, {}, {"economics_applicable": False})
    result = reference.evaluate({"campaigns": [], "water_regime": "rainfed"}, {})
    assert result["applicable"] is False
    assert result["gross_median_mxn_ha"] is None

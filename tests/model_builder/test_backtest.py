"""The held-out backtest: the panel is really cut at the cutoff, and the scoring reads claims against held-out years only."""

from pathlib import Path

import pandas as pd

from gradientdescentfarmers.model_builder.rotations import backtest

FIXTURE = Path(__file__).parent / "fixtures" / "three_districts"


def test_truncated_panel_drops_every_year_after_the_cutoff(tmp_path):
    cut = backtest.truncated_panel(FIXTURE, 2015, tmp_path / "cut")
    for f in (cut / "tables").glob("*.parquet"):
        t = pd.read_parquet(f)
        original = pd.read_parquet(FIXTURE / "tables" / f.name)
        if "year" in t.columns:
            assert t["year"].max() <= 2015
        else:
            assert len(t) == len(original)
    assert (cut / "manifest.json").is_file()


def _case(alt_income, cur_income, pred, prio=("ingreso",), riesgo=(0.1, 0.2)):
    cur_rot, alt_rot = [{"pv": "maize"}], [{"pv": "maize", "oi": "chickpea"}]
    pred_rows = [{"id": "actual", "nombre": "actual", "rotacion": cur_rot, "puntaje": 40, "pred": None, "condicional": False, "riesgo_pred": riesgo[1]},
                 {"id": "invierno", "nombre": "alt", "rotacion": alt_rot, "puntaje": 60, "pred": {"media": pred, "clara": True},
                  "condicional": False, "riesgo_pred": riesgo[0]}]
    return {"grupo": "demo", "etiqueta": "x", "predicciones": [{"prioridades": list(prio), "rotaciones": pred_rows}],
            "series": {backtest._key(cur_rot): cur_income, backtest._key(alt_rot): alt_income}}


def test_score_uses_only_held_out_years():
    train = {y: 100.0 for y in range(2003, 2018)}
    # better before the cutoff, worse after: the claim (+) must be judged wrong
    alt = {**{y: 200.0 for y in range(2003, 2018)}, **{y: 50.0 for y in range(2018, 2026)}}
    cur = {**train, **{y: 100.0 for y in range(2018, 2026)}}
    pairs, top = backtest.score([_case(alt, cur, pred=+100)], 2017)
    assert pairs[0]["real"] == -50.0 and pairs[0]["acierta"] is False and pairs[0]["años_prueba"] == 8
    assert top[0]["dijo_mejor"] is True and top[0]["fue_mejor_o_igual"] is False


def test_bad_year_share_and_ties():
    series = {**{y: 100.0 for y in range(2003, 2018)}, 2018: 40.0, 2019: 100.0, 2020: 100.0, 2021: 100.0}
    assert backtest._bad_share(series, 2017) == 0.25
    flat = {y: 100.0 for y in range(2003, 2026)}
    pairs, top = backtest.score([_case(flat, flat, pred=-1, prio=("riesgo",))], 2017)
    assert top[0]["empate"] and top[0]["fue_mejor_o_igual"] and not top[0]["estrictamente_mejor"]

"""What has been changing where the farmer is, over the months the farmer's crops are in the field, 1982-2025.

Field-shift measured trends over a fixed May-October season, taken from the rainfed yield panel. That is the
wrong season for irrigated autumn-winter districts (wheat in Cajeme, maize in Los Mochis are in the field
roughly November-April), and those municipalities were not in that panel at all, so they got no trends.

Here each season of the farmer's current rotation sets its own window: the months its crop is in the field
(from the engine's crop calendar, `indicators.Season.present_month`). The series come from the panel's
monthly climate by year (`climate_*_years`, NASA POWER, 1982-2025): rain, reference evapotranspiration (ET0),
mean maximum and minimum temperature, days at or above 35 C and nights at or below 2 C. A season that
crosses the new year (November-April) is labelled by the year it is sown.

Method: Theil-Sen slope (the median of all pairwise slopes, so one odd year cannot bend it) and the
Mann-Kendall test. A trend is reported only when p < 0.10; otherwise the tool says there is no clear trend.

Limits shown to the farmer:
- POWER weather is MERRA-2 reanalysis on ~50 km cells. Its temperature trends are well constrained by
  observations; its rain trends are less reliable, so rain trends are checked against CHIRPS (satellite plus
  gauges, from 2001) and flagged when the two disagree in sign.
- Under irrigation, rain on the field matters little: the water a farmer can use depends on the dams and on
  CONAGUA's allocation. ET0 is what the crop asks for, so its trend is the one to watch.
- A trend is what happened, not a forecast.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import catalog
from .indicators import MONTH_NAMES, MONTH_OF_DAY

P_CLEAR = 0.10
MIN_YEARS = 25
MIN_CHIRPS_YEARS = 15
IN_FIELD = 0.5            # a month counts when the crop is in the field at least half of it

# column -> (Spanish label, unit, decimals, aggregation over the window, slope reported as % of the mean)
FEATURES = {
    "tmax": ("temperatura máxima media", "°C", 1, "mean", False),
    "tmin": ("temperatura mínima media", "°C", 1, "mean", False),
    "heat_days": ("días de 35 °C o más", "días", 1, "sum", False),
    "frost_nights": ("noches de helada (2 °C o menos)", "noches", 1, "sum", False),
    "et0": ("evapotranspiración de referencia (ET0, el agua que pide un cultivo)", "mm", 0, "sum", True),
    "rain": ("lluvia", "mm", 0, "sum", True),
}


def theil_sen(x, y):
    """Median of the slopes between every pair of points."""
    x, y = np.asarray(x, float), np.asarray(y, float)
    i, j = np.triu_indices(len(x), 1)
    dx = x[j] - x[i]
    return float(np.median((y[j] - y[i])[dx != 0] / dx[dx != 0]))


def mann_kendall(y):
    """Two-sided p-value of the Mann-Kendall trend test, with the tie correction."""
    from math import erf, sqrt

    y = np.asarray(y, float)
    n = len(y)
    i, j = np.triu_indices(n, 1)
    s = float(np.sign(y[j] - y[i]).sum())
    _, counts = np.unique(y, return_counts=True)
    var = (n * (n - 1) * (2 * n + 5) - (counts * (counts - 1) * (2 * counts + 5)).sum()) / 18
    if var <= 0:
        return 1.0
    z = (s - np.sign(s)) / sqrt(var)
    return float(2 * (1 - 0.5 * (1 + erf(abs(z) / sqrt(2)))))


def trend_row(years, values):
    ok = np.isfinite(values)
    years, values = np.asarray(years, float)[ok], np.asarray(values, float)[ok]
    if len(values) < MIN_YEARS:
        return None
    slope, p = theil_sen(years, values), mann_kendall(values)
    half = len(values) // 2
    return {"pendiente_decada": 10 * slope, "p": p, "clara": bool(p < P_CLEAR),
            "primera_mitad": float(values[:half].mean()), "segunda_mitad": float(values[half:].mean()),
            "media": float(values.mean()), "años": [int(years.min()), int(years.max())]}


def window(season) -> list[int]:
    """Months (1-12) the season's crop is in the field, in calendar order from sowing."""
    start = int(MONTH_OF_DAY[season.sow_day])
    months = []
    for k in range(12):
        m = (start + k) % 12
        if season.present_month[m] >= IN_FIELD:
            months.append(m + 1)
        elif months:
            break
    return months


def window_label(months: list[int]) -> str:
    if len(months) == 1:
        return MONTH_NAMES[months[0] - 1]
    return f"{MONTH_NAMES[months[0] - 1]} a {MONTH_NAMES[months[-1] - 1]}"


def window_series(history: pd.DataFrame, months: list[int], columns) -> pd.DataFrame:
    """One row per sowing year: each column aggregated over the window's months (all months required)."""
    if history is None or history.empty or not months:
        return pd.DataFrame()
    h = history.set_index(pd.PeriodIndex.from_fields(year=history["year"], month=history["month"], freq="M"))
    first_year, last_year = int(history["year"].min()), int(history["year"].max())
    rows = []
    for year in range(first_year, last_year + 1):
        offsets = np.cumsum([0] + [1 if b <= a else 0 for a, b in zip(months, months[1:])])
        periods = [pd.Period(year=year + int(o), month=m, freq="M") for m, o in zip(months, offsets)]
        if not all(p in h.index for p in periods):
            continue
        block = h.loc[periods]
        row = {"year": year}
        for col in columns:
            if col not in block:
                continue
            how = FEATURES[col][3] if col in FEATURES else "sum"
            values = block[col].astype(float)
            row[col] = float(values.mean() if how == "mean" else values.sum()) if values.notna().all() else np.nan
        rows.append(row)
    return pd.DataFrame(rows).set_index("year") if rows else pd.DataFrame()


def place_trends(place, seasons) -> list[dict]:
    """Trends over each distinct season (crop and cycle) of the current rotation.

    Returns a list of {"cultivo", "ciclo", "meses", "periodo", "tendencias": {feature: trend row}}.
    """
    history = getattr(place, "climate_history", None)
    if history is None or history.empty:
        return []
    chirps = getattr(place, "chirps_history", None)
    out, seen = [], set()
    for s in seasons:
        months = window(s)
        key = (s.crop, s.cycle, tuple(months))
        if not months or key in seen:
            continue
        seen.add(key)
        series = window_series(history, months, list(FEATURES))
        if series.empty:
            continue
        found = {}
        for name, (label, unit, decimals, _, relative) in FEATURES.items():
            if name not in series:
                continue
            row = trend_row(series.index.to_numpy(), series[name].to_numpy())
            if row is None:
                continue
            row.update({"nombre": label, "unidad": unit, "decimales": decimals, "relativa": relative})
            if name == "rain" and chirps is not None and not chirps.empty:
                c = window_series(chirps.rename(columns={"chirps_rain": "rain"}), months, ["rain"])
                both = series[["rain"]].join(c, rsuffix="_chirps", how="inner").dropna()
                if len(both) >= MIN_CHIRPS_YEARS:
                    a, b = theil_sen(both.index, both["rain"]), theil_sen(both.index, both["rain_chirps"])
                    row["chirps_coincide"] = bool(np.sign(a) == np.sign(b) or a == 0 or b == 0)
                    row["chirps_desde"] = int(both.index.min())
            found[name] = row
        if found:
            years = next(iter(found.values()))["años"]
            out.append({"cultivo": s.crop, "ciclo": s.cycle, "meses": months, "periodo": years, "tendencias": found})
    return out


def _article(label: str) -> str:
    first = label.split()[0]
    return {"días": "Los", "noches": "Las"}.get(first, "La")


def _line(name: str, t: dict) -> str:
    change, d = t["pendiente_decada"], t["decimales"]
    article = _article(t["nombre"])
    plural = article != "La"
    halves = (f"de {t['primera_mitad']:.{d}f} a {t['segunda_mitad']:.{d}f} {t['unidad']} entre la primera y la "
              "segunda mitad del periodo")
    if round(abs(change), d) == 0:
        # Counts with many zero years: the median slope is 0 although the series moved. Report the halves.
        up = t["segunda_mitad"] > t["primera_mitad"]
        verb = ("aumentaron" if up else "disminuyeron") if plural else ("subió" if up else "bajó")
        text = f"{article} {t['nombre']} {verb}: {halves}"
    else:
        verb = ("aumentan" if change > 0 else "disminuyen") if plural else ("sube" if change > 0 else "baja")
        if t["relativa"] and t["media"] > 0:
            # Given as a share of normal: a relative change does not depend on POWER's bias in millimetres.
            text = f"{article} {t['nombre']} {verb} alrededor de {abs(100 * change / t['media']):.0f}% por década"
        else:
            text = f"{article} {t['nombre']} {verb} unos {abs(change):.{d}f} {t['unidad']} por década: {halves}"
    if name == "rain":
        if t.get("chirps_coincide") is False:
            text += (f". Ojo: CHIRPS (satélite + pluviómetros) no muestra el mismo sentido desde {t['chirps_desde']}; "
                     "tómalo con reserva")
        elif "chirps_coincide" in t:
            text += f". CHIRPS (satélite + pluviómetros) apunta en el mismo sentido desde {t['chirps_desde']}"
        else:
            text += ". Sin datos de CHIRPS para comprobarlo con pluviómetros; tómalo con reserva"
    return text + "."


def lines(trends: list[dict], water: str = "temporal") -> list[str]:
    """Spanish sentences, one block per season of the current rotation: clear trends, then what shows none."""
    out = []
    for block in trends:
        a, b = block["periodo"]
        crop = catalog.name(block["cultivo"])
        clear = [_line(n, t) for n, t in block["tendencias"].items() if t["clara"]]
        flat = [t["nombre"] for t in block["tendencias"].values() if not t["clara"]]
        head = (f"Lo que ha cambiado en tu zona en los meses de {crop} ({window_label(block['meses'])}), {a}-{b} "
                "(NASA POWER; es lo que pasó, no un pronóstico):")
        if clear:
            out.append(head)
            out.extend(clear)
        if flat:
            out.append(f"Sin tendencia clara en los meses de {crop} ({a}-{b}): {', '.join(flat)}.")
    if out and water == "riego":
        out.append("Con riego, la lluvia sobre la parcela pesa poco: el agua que puedes usar depende de las presas o "
                   "del acuífero y de lo que asigne CONAGUA. La tendencia que más importa es la de la ET0, que dice "
                   "cuánta agua pide el cultivo.")
    return out

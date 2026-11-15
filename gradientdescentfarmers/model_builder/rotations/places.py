"""Find a farmer's district from a municipality or district name and assemble its data."""

from functools import lru_cache

import pandas as pd

from . import catalog, panel
from .indicators import Place


@lru_cache(maxsize=1)
def _siap():
    return panel.load_siap()


@lru_cache(maxsize=1)
def _districts():
    d = panel.load_districts().copy()
    d["mun_plain"] = d["municipality"].map(catalog.plain)
    d["ddr_plain"] = d["ddr_name"].map(catalog.plain)
    d["state_plain"] = d["state"].map(catalog.plain)
    return d


@lru_cache(maxsize=1)
def _observed():
    try:
        return panel.observed("district"), panel.observed("municipal")
    except FileNotFoundError:
        return None, None


@lru_cache(maxsize=1)
def _climate():
    return (panel.climate("district"), panel.climate("municipal"),
            panel.climate("district", yearly=True), panel.climate("municipal", yearly=True))


NORMAL_YEARS = (2001, 2025)


@lru_cache(maxsize=1)
def _calendars():
    path = catalog.DATA / "calendars.csv"
    return pd.read_csv(path) if path.is_file() else pd.DataFrame()


def district_calendar(state_id, ddr, water):
    """{(crop, cycle): {"siembra", "cosecha", "fuente"}} from tables/calendars.csv for a district and water regime."""
    t = _calendars()
    if t.empty:
        return {}
    rows = t[(t["state_id"] == state_id) & (t["ddr"] == ddr) & (t["water"] == water)]
    return {(r.crop, r.cycle): {"siembra": int(r.siembra) if pd.notna(r.siembra) else None,
                                "cosecha": int(r.cosecha) if pd.notna(r.cosecha) else None, "fuente": r.fuente}
            for r in rows.itertuples(index=False)}


def _chirps(row, municipal):
    """Monthly CHIRPS rain by year for the place, or None when the panel has none."""
    try:
        if municipal:
            t = panel.read("chirps_municipal_years")
            t = t[(t.state_id == row.state_id) & (t.mun_id == row.mun_id)]
        else:
            t = panel.read("chirps_district_years")
            t = t[(t.state_id == row.state_id) & (t.ddr == row.ddr)]
    except FileNotFoundError:
        return None
    return t[["year", "month", "chirps_rain"]].reset_index(drop=True) if len(t) else None


def find(name, state=None):
    """Rows of the municipality -> district table matching a municipality or district name."""
    d = _districts()
    key = catalog.plain(name)
    if state:
        d = d[d["state_plain"].str.contains(catalog.plain(state), regex=False)]
    hits = d[d["mun_plain"] == key]
    if hits.empty:
        hits = d[d["ddr_plain"] == key]
    if hits.empty:
        hits = d[d["mun_plain"].str.contains(key, regex=False) | d["ddr_plain"].str.contains(key, regex=False)]
    return hits


def place(name, state=None, water="temporal", sowing_month=None):
    """Place for a municipality (its own POWER climate, its district's SIAP) or a district."""
    hits = find(name, state)
    if hits.empty:
        raise LookupError(f"No encontré '{name}'" + (f" en {state}" if state else ""))
    districts = hits[["state_id", "ddr"]].drop_duplicates()
    if len(districts) > 1:
        options = hits.drop_duplicates(["state_id", "ddr"])[["municipality", "state", "ddr_name"]]
        raise LookupError("Hay varios lugares con ese nombre: " + "; ".join(
            f"{r.municipality} ({r.state}, distrito {r.ddr_name})" for r in options.itertuples()))
    row = hits.iloc[0]
    by_district, by_municipality, years_district, years_municipality = _climate()
    municipal = catalog.plain(name) in set(hits["mun_plain"])
    notes = []
    clim = pd.DataFrame()
    if municipal:
        clim = by_municipality[(by_municipality.state_id == row.state_id) & (by_municipality.mun_id == row.mun_id)]
        yearly = years_municipality[(years_municipality.state_id == row.state_id) & (years_municipality.mun_id == row.mun_id)]
    if clim.empty:
        clim = by_district[(by_district.state_id == row.state_id) & (by_district.ddr == row.ddr)]
        yearly = years_district[(years_district.state_id == row.state_id) & (years_district.ddr == row.ddr)]
        municipal = False
    if clim.empty:
        raise LookupError(f"Sin datos de clima de NASA POWER para el distrito {row.ddr_name}")
    if not municipal:
        notes.append("Clima: promedio del distrito ponderado por superficie sembrada")
    # The panel's yearly table runs 1982-2025. Water balances and bad years use 2001-2025, the window of the
    # normals (as in field-shift); the full series is kept for trends.
    history = yearly.sort_values(["year", "month"]).reset_index(drop=True)
    yearly = history[history["year"].between(*NORMAL_YEARS)].reset_index(drop=True)
    chirps = _chirps(row, municipal)
    if "rain_corrected" in clim and not bool(clim["rain_corrected"].any()):
        notes.append("Lluvia de NASA POWER sin corregir con estaciones (CHIRPS no disponible para este lugar)")
    obs_district, obs_municipal = _observed()
    obs = None
    if obs_municipal is not None:
        obs = obs_municipal[(obs_municipal.state_id == row.state_id) & (obs_municipal.mun_id == row.mun_id)] if municipal else None
        if obs is None or obs.empty or obs["ndvi"].isna().all():
            obs = obs_district[(obs_district.state_id == row.state_id) & (obs_district.ddr == row.ddr)]
        obs = obs.sort_values("month").reset_index(drop=True) if not obs.empty else None
    return Place(state_id=int(row.state_id), ddr=int(row.ddr), state=row.state, ddr_name=row.ddr_name, observed=obs,
                 water=water, climate=clim.sort_values("month").reset_index(drop=True), siap=_siap(),
                 climate_years=yearly, climate_history=history, chirps_history=chirps,
                 calendar=district_calendar(int(row.state_id), int(row.ddr), water),
                 municipality=row.municipality if municipal else None,
                 sowing_month=sowing_month, notes=notes, mun_id=int(row.mun_id) if municipal else None,
                 mun_ids=tuple(int(m) for m in _districts().query("state_id == @row.state_id and ddr == @row.ddr")["mun_id"]))

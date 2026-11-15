"""Offline tests for the district panel (no network, no credentials)."""
import json

import numpy as np
import pandas as pd
import pytest

from gradientdescentfarmers.source_builder.district import DistrictPanelSourceBuilder, climate, grace, observed, siap
from gradientdescentfarmers.source_builder.district.builder import DistrictPanelBuilder, validate
from gradientdescentfarmers.source_builder.district.common import DistrictSettings, district_mean, sample

SITES = [{"name": "site_a", "latitude": 20.4, "longitude": -101.1}]


def settings(tmp_path, **kw):
    base = {"sites": SITES, "output_root": tmp_path / "out", "cache_root": tmp_path / "cache"}
    return DistrictSettings.model_validate({**base, **kw})


def daily_frame(start="2000-01-01", end="2002-12-31", seed=0):
    idx = pd.date_range(start, end, freq="D", name="date")
    rng = np.random.default_rng(seed)
    return pd.DataFrame({
        "tmin_c": 8 + 6 * np.sin(2 * np.pi * idx.dayofyear / 365) + rng.normal(0, 3, len(idx)),
        "tmax_c": 26 + 6 * np.sin(2 * np.pi * idx.dayofyear / 365) + rng.normal(0, 3, len(idx)),
        "precip_mm": np.where(idx.month.isin(range(6, 10)), 5.0, 0.2),
        "rh_pct": 55.0, "solar_mj_m2_day": 20.0, "wind_m_s": 2.0, "tmean_c": 17.0,
    }, index=idx)


# --- climate -------------------------------------------------------------------------------------

def test_snap_matches_power_grid():
    lat, lon = climate.snap([20.4243, 25.76], [-101.1467, -108.86])
    assert list(lat) == [20.5, 26.0]
    assert list(lon) == [-101.25, -108.75]


def test_et0_fao_default_equals_power_wind_of_two():
    d = daily_frame()
    a = climate.et0_penman_monteith(d, 20.4, 1700.0, wind=None)
    b = climate.et0_penman_monteith(d, 20.4, 1700.0, wind=d["wind_m_s"])
    assert np.allclose(a, b)
    assert (a >= 0).all() and 2 < a.mean() < 8           # mm/day, plausible for central Mexico


def test_et0_increases_with_wind_in_dry_air():
    d = daily_frame().assign(rh_pct=30.0)
    calm = climate.et0_penman_monteith(d, 20.4, 1700.0, wind=np.full(len(d), 0.5))
    windy = climate.et0_penman_monteith(d, 20.4, 1700.0, wind=np.full(len(d), 5.0))
    assert (windy > calm).all()


def test_monthly_counts_frost_and_heat(tmp_path):
    d = daily_frame()
    d.loc["2001-01-10":"2001-01-12", "tmin_c"] = -1.0     # 3 frost nights in Jan 2001
    d.loc["2001-01-01":"2001-01-31", "tmin_c"] = d.loc["2001-01-01":"2001-01-31", "tmin_c"].clip(lower=3)
    d.loc["2001-01-10":"2001-01-12", "tmin_c"] = -1.0
    d.loc["2001-05-01":"2001-05-04", "tmax_c"] = 37.0     # 4 heat days in May 2001
    s = settings(tmp_path)
    per_year, normals = climate.monthly(d, 20.4, 1700.0, (2000, 2002), s)
    jan01 = per_year[(per_year.year == 2001) & (per_year.month == 1)].iloc[0]
    assert jan01.frost_nights == 3
    assert per_year[(per_year.year == 2001) & (per_year.month == 5)].iloc[0].heat_days >= 4
    assert per_year[(per_year.year == 2001) & (per_year.month == 7)].iloc[0].rain == pytest.approx(31 * 5.0)
    assert set(normals.columns) >= set(climate.NORMAL_COLUMNS)
    assert 0 <= normals.frost_prob.min() and normals.frost_prob.max() <= 1


def test_rain_ratio_is_fixed_per_municipality_and_applied_to_every_year():
    months = pd.period_range("1998-11", "2003-12", freq="M")
    power = pd.DataFrame({"state_id": 11, "mun_id": 42, "year": [p.year for p in months],
                          "month": [p.month for p in months], "rain": 100.0})
    chirps = power.rename(columns={"rain": "chirps_rain"}).assign(
        chirps_rain=lambda x: np.where(x.month.isin(range(5, 11)), 80.0, 150.0))
    ratios = climate.rain_ratios(power, chirps, (1999, 2003))
    assert ratios.ratio_season.iloc[0] == pytest.approx(0.8)
    assert ratios.ratio_off.iloc[0] == pytest.approx(1.5)
    years = power[power.year >= 1999].copy()
    out = climate.apply_correction(years, ratios)
    assert out.loc[out.month == 7, "rain"].eq(80.0).all()       # same factor in 1999 and 2003: no step
    assert out.loc[out.month == 1, "rain"].eq(150.0).all()
    assert out.rain_corrected.all()


def test_off_season_ratio_ignored_where_dry():
    months = pd.period_range("1999-11", "2002-12", freq="M")
    power = pd.DataFrame({"state_id": 26, "mun_id": 18, "year": [p.year for p in months],
                          "month": [p.month for p in months]})
    power["rain"] = np.where(power.month.isin(range(5, 11)), 60.0, 2.0)   # Nov-Apr total 12 mm < 20 mm
    chirps = power.rename(columns={"rain": "chirps_rain"}).assign(chirps_rain=lambda x: x.chirps_rain * 2)
    r = climate.rain_ratios(power, chirps, (2000, 2002))
    assert r.ratio_off.iloc[0] == 1.0 and r.ratio_season.iloc[0] == pytest.approx(2.0)


# --- SIAP ----------------------------------------------------------------------------------------

def siap_frame(year=2020):
    rows = [
        # municipality 11 is recorded under two districts (as SIAP does for Guasave)
        (year, 25, "Sinaloa", 133, "Los Mochis", 1, "Ahome", 1, 1, "Maíz grano", "Tonelada", 100, 90, 10, 900, 4.5e6),
        (year, 25, "Sinaloa", 133, "Los Mochis", 11, "Guasave", 1, 1, "Maíz grano", "Tonelada", 30, 30, 0, 300, 1.5e6),
        (year, 25, "Sinaloa", 135, "Guamúchil", 11, "Guasave", 1, 1, "Maíz grano", "Tonelada", 70, 70, 0, 700, 3.5e6),
        (year, 25, "Sinaloa", 135, "Guamúchil", 11, "Guasave", 2, 2, "Garbanzo grano", "Tonelada", 20, 20, 0, 30, 4e5),
        (year, 25, "Sinaloa", 135, "Guamúchil", 11, "Guasave", 1, 1, "Tomate rojo (jitomate)", "Tonelada", 50, 50, 0, 2000, 9e6),
        (year, 25, "Sinaloa", 133, "Los Mochis", 1, "Ahome", 1, 1, "Maíz forrajero en verde", "Hectárea", 5, 5, 0, 5, 1e4),
    ]
    cols = ["anio", "idestado", "nomestado", "idddr", "nomddr", "idmunicipio", "nommunicipio", "idciclo",
            "idmodalidad", "nomcultivo", "nomunidad", *siap.NUMERIC]
    return pd.DataFrame(rows, columns=cols)


def test_extract_year_keeps_catalogue_crops_in_tonnes():
    t = siap.extract_year(siap_frame())
    assert set(t.crop) == {"maize", "chickpea"}          # tomato is not in the catalogue; forage row is in ha
    mochis = t[(t.ddr == 133) & (t.crop == "maize")].iloc[0]
    assert mochis.sown_ha == 130 and mochis.cycle == "oi" and mochis.water == "riego"


def test_memberships_shared_and_primary():
    pairs = [siap.membership_year(siap_frame(y)) for y in (2020, 2021)]
    shared, primary = siap.memberships(pairs, "shared")
    g = shared[shared.mun_id == 11].set_index("ddr")
    assert g.loc[133, "sown_ha"] == 30 and g.loc[135, "sown_ha"] == 140
    assert primary.set_index("mun_id").loc[11, "ddr"] == 135       # larger area wins the tie in years
    only, _ = siap.memberships(pairs, "primary")
    one = only[only.mun_id == 11]
    assert len(one) == 1 and one.iloc[0].ddr == 135 and one.iloc[0].sown_ha == 170
    assert (shared.weight_ha == shared.sown_ha + 1).all()


# --- aggregation and sampling --------------------------------------------------------------------

def test_district_mean_weights_and_skips_missing():
    municipal = pd.DataFrame({"state_id": [1, 1, 1], "mun_id": [1, 2, 3], "month": [1, 1, 1], "x": [10.0, 20.0, np.nan]})
    weights = pd.DataFrame({"state_id": 1, "mun_id": [1, 2, 3], "ddr": 7, "weight_ha": [1.0, 3.0, 100.0]})
    out = district_mean(municipal, weights, ("month",), ["x"])
    assert out.x.iloc[0] == pytest.approx(17.5)
    assert district_mean(municipal, weights, ("month",), ["x"], weighted=False).x.iloc[0] == pytest.approx(15.0)


def test_sample_uses_cropland_weights():
    lat = np.array([20.025, 20.075])
    lon = np.array([-101.125, -101.075])
    cube = np.array([[[1.0, 2.0], [3.0, 4.0]]])
    w = np.array([[0.0, 0.0], [0.0, 1.0]])
    plain, _ = sample(cube, lat, lon, [(20.05, -101.1)], 10)
    weighted, used = sample(cube, lat, lon, [(20.05, -101.1)], 10, weights=w)
    assert plain[0, 0] == pytest.approx(2.5) and weighted[0, 0] == pytest.approx(4.0) and used[0]


def test_grace_trend_recovers_slope():
    t = np.arange(2002.3, 2026.3, 1 / 12)
    y = -1.2 * (t - t.mean()) + 3 * np.sin(2 * np.pi * t) + np.random.default_rng(1).normal(0, 0.5, len(t))
    slope, se = grace.trend(t, y)
    assert slope == pytest.approx(-1.2, abs=0.05) and 0 < se < 0.1


def test_observed_combine_with_ndvi_only():
    points = pd.DataFrame({"state_id": [1], "mun_id": [1]})
    ndvi = pd.DataFrame({"state_id": 1, "mun_id": 1, "month": range(1, 13), "ndvi": 0.4, "ndvi_p20": 0.3,
                         "ndvi_p80": 0.5, "ndvi_cropland_weighted": True})
    weights = pd.DataFrame({"state_id": [1], "mun_id": [1], "ddr": [9], "weight_ha": [5.0]})
    out = observed.combine(points, weights, ndvi, None)
    assert out["observed_municipal"].smap_relative.isna().all()
    assert out["observed_district"].ndvi.eq(0.4).all() and len(out["observed_district"]) == 12


# --- builder, end to end with fake sources -------------------------------------------------------

def test_builder_end_to_end_offline(tmp_path, monkeypatch):
    from gradientdescentfarmers.source_builder.district import builder as b, locate

    monkeypatch.setattr(locate, "boundaries_path", lambda *a, **k: tmp_path / "none.shp")
    monkeypatch.setattr(locate, "locate_points", lambda pts, path: pd.DataFrame(
        [{"site": "site_a", "latitude": 20.4, "longitude": -101.1, "state_id": 25, "mun_id": 1,
          "municipality_inegi": "Ahome", "state_inegi": "Sinaloa"}]).astype({"state_id": "Int64", "mun_id": "Int64"}))

    def fake_siap(cache_root, siap_years, weight_years, mode, timeout=120, log=print):
        frame = siap_frame()
        weights, primary = siap.memberships([siap.membership_year(frame)], mode)
        return {"siap_crop_years": siap.extract_year(frame), "municipality_district_weights": weights,
                "municipality_districts": primary}

    monkeypatch.setattr(siap, "build", fake_siap)
    monkeypatch.setattr(climate, "fetch_power_cells", lambda cells, s, run_dir, log=print:
                        {c: daily_frame("1999-01-01", "2002-12-31", i) for i, c in enumerate(cells)})
    s = settings(tmp_path, weather_years=(1999, 2002), normal_years=(2000, 2002),
                 sources={"chirps": False, "grace": False, "ndvi": False, "smap": False, "gldas": False, "igbp": False})
    summary = b.DistrictPanelBuilder(s, log=lambda m: None).build(export=True)
    assert summary["build_state"] == "complete", summary
    run = tmp_path / "out" / "runs" / summary["run_id"]
    manifest = json.loads((run / "manifest.json").read_text())
    for name in ("siap_crop_years", "municipality_districts", "climate_municipal", "climate_municipal_years",
                 "climate_district", "climate_district_years", "sites"):
        assert name in manifest["tables"]
    district = pd.read_parquet(run / "tables" / "climate_district_years.parquet")
    assert set(district.ddr) == {133} and district.year.min() == 1999
    validation = json.loads((run / "validation.json").read_text())
    assert validation["climate_district"]["passed"] and validation["climate_municipal"]["coverage"] == 1.0
    availability = json.loads((run / "availability.json").read_text())
    assert availability["smap"]["status"] == "not_requested"
    assert json.loads((tmp_path / "out" / "latest.json").read_text())["run_id"] == summary["run_id"]


def test_builder_fails_cleanly_when_siap_fails(tmp_path, monkeypatch):
    from gradientdescentfarmers.source_builder.district import builder as b, locate

    monkeypatch.setattr(locate, "boundaries_path", lambda *a, **k: tmp_path / "none.shp")
    monkeypatch.setattr(locate, "locate_points", lambda pts, path: pd.DataFrame(
        [{"site": "site_a", "latitude": 20.4, "longitude": -101.1, "state_id": 11, "mun_id": 42,
          "municipality_inegi": "x", "state_inegi": "y"}]))

    def boom(*a, **k):
        raise ConnectionError("SIAP unreachable")

    monkeypatch.setattr(siap, "build", boom)
    summary = b.DistrictPanelBuilder(settings(tmp_path), log=lambda m: None).build(export=True)
    assert summary["build_state"] == "failed" and summary["sources"]["siap"] == "error"


def test_validate_flags_duplicates_and_ranges():
    t = pd.DataFrame({"state_id": [1, 1], "ddr": [2, 2], "month": [1, 1], "rain": [10.0, -5.0]})
    v = validate("climate_district", t)
    assert not v["checks"]["keys_unique"] and not v["checks"]["rain_in_range"] and not v["passed"]


def test_adapter_preview_needs_no_network(tmp_path):
    out = DistrictPanelSourceBuilder(repository_root=tmp_path).build({"sites": SITES})
    assert out["build_state"] == "preview" and out["sources"]["smap"] is True
    with pytest.raises(ValueError):
        DistrictPanelSourceBuilder(repository_root=tmp_path).build({"sites": SITES, "output_root": "/tmp/elsewhere"})


def test_locate_points_and_district_split(tmp_path):
    shapefile = pytest.importorskip("shapefile")
    pytest.importorskip("shapely")
    from gradientdescentfarmers.source_builder.district import locate

    w = shapefile.Writer(str(tmp_path / "mun"), shapeType=shapefile.POLYGON, encoding="utf-8")
    for f in ("CVEGEO", "CVE_ENT", "CVE_MUN", "NOMGEO", "NOM_ENT"):
        w.field(f, "C", size=80)
    w.poly([[[-109.0, 25.5], [-109.0, 26.0], [-108.8, 26.0], [-108.8, 25.5], [-109.0, 25.5]]])
    w.record("25001", "25", "001", "Ahome", "Sinaloa")
    w.poly([[[-108.8, 25.5], [-108.8, 26.0], [-108.4, 26.0], [-108.4, 25.5], [-108.8, 25.5]]])
    w.record("25011", "25", "011", "Guasave", "Sinaloa")
    w.close()
    pts = [("a", 25.76, -108.86), ("b", 25.7, -108.6), ("sea", 24.0, -110.0)]
    located = locate.locate_points(pts, tmp_path / "mun.shp")
    assert located.set_index("site").loc["a", "mun_id"] == 1 and located.set_index("site").loc["b", "mun_id"] == 11
    assert pd.isna(located.set_index("site").loc["sea", "mun_id"])
    weights, primary = siap.memberships([siap.membership_year(siap_frame())], "shared")
    out = locate.assign_districts(located, weights, primary).set_index("site")
    assert out.loc["a", "ddr"] == 133 and out.loc["a", "note"] == ""
    assert out.loc["b", "ddr"] == 135 and "Los Mochis" in out.loc["b", "other_districts"]
    assert out.loc["sea", "note"] == "outside every INEGI municipality"


def test_rain_outliers_are_set_to_missing_and_flagged():
    rng = np.random.default_rng(4)
    rows = []
    for y in range(1982, 2026):
        for m in range(1, 13):
            wet = max(rng.normal(300, 90), 50) if m == 7 else 0          # wet months vary a lot from year to year
            rows.append({"state_id": 32, "mun_id": 43, "year": y, "month": m, "rain": 15.0 + (y % 5) + wet})
    t = pd.DataFrame(rows)
    t.loc[(t.year == 1991) & (t.month == 2), "rain"] = 4165.0            # the POWER artifact
    t.loc[(t.year == 2010) & (t.month == 7), "rain"] = 900.0             # a real wet-season extreme
    out = climate.flag_rain_outliers(t)
    assert out.loc[(out.year == 1991) & (out.month == 2), "rain_flagged"].all()
    assert out.loc[(out.year == 1991) & (out.month == 2), "rain"].isna().all()
    assert not out.loc[(out.year == 2010) & (out.month == 7), "rain_flagged"].any()
    assert int(out.rain_flagged.sum()) == 1

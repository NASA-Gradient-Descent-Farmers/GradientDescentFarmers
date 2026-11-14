"""Offline tests for the DGSIAP/SIAP district economic source.

Synthetic latin-1 CSVs are written under tmp_path and GCS is an in-memory fake,
so nothing here touches the network or the real bucket.
"""
import csv
import json
from pathlib import Path

import pandas as pd
import pytest

from gradientdescentfarmers.app import PipelineConfig
from gradientdescentfarmers.source_builder import (
    EconomicQuery, EconomicSourceBuilder, SourceBuilder)
from gradientdescentfarmers.source_builder import economic
from gradientdescentfarmers.source_builder.economic import (
    REPO_ROOT, haversine_km, load_economic_config, load_siap_mapping, resolve_district)

# Most fixtures cover one district on purpose; the warning has its own test below.
pytestmark = pytest.mark.filterwarnings("ignore:No SIAP rows for pilot district")

PREFIX = "SIAP_Agricultural_Production_2000_2025/Municipal (2003_2025)/"
STATE_PREFIX = "SIAP_Agricultural_Production_2000_2025/Estatal (2000_2002)/"
CONFIG = {
    "enabled": True,
    "source_id": "dgsiap_siap_district_mx",
    "currency": "MXN",
    "aggregation_level": "district_ddr",
    "gcs_bucket": "data_dump_samples",
    "gcs_municipal_prefix": PREFIX,
    "local_cache_dir": "data/raw/siap/municipal",
    "output_parquet": "data/economics/siap_3districts_normalized.parquet",
}
PILOTS = [
    (25.763611, -108.861389, 25, 133),   # Adolfo Ruiz Cortines, Guasave -> Los Mochis
    (27.332202, -110.162783, 26, 148),   # SE of Ciudad Obregon -> Cajeme
    (20.4243195, -101.1466639, 11, 52),  # Valle de Santiago -> Cortazar
]
TERRITORY = {
    (25, 133): ("Sinaloa", "Los Mochis"),
    (25, 134): ("Sinaloa", "Guasave"),
    (26, 148): ("Sonora", "Cajeme"),
    (11, 52): ("Guanajuato", "Cortazar"),
    (11, 50): ("Guanajuato", "Celaya"),
}
CYCLES = {1: "Otoño-Invierno", 2: "Primavera-Verano", 3: "Perennes"}
MODALITIES = {1: "Riego", 2: "Temporal"}


def siap_row(year, state, ddr, muni, *, crop="Maíz grano", crop_id=225, cycle=2, modality=1,
             planted=None, harvested=100.0, damaged=0.0, volume=1000.0, price=4000.0,
             value=None, unit="Tonelada", unit_id=200201, cader=1):
    """One SIAP municipal row keyed by canonical names; blank string means missing."""
    numeric = all(isinstance(v, (int, float)) for v in (volume, price))
    return {
        "Anio": year, "Idestado": state, "Nomestado": TERRITORY[(state, ddr)][0],
        "Idddr": ddr, "Nomddr": TERRITORY[(state, ddr)][1],
        "Idcader": cader, "Nomcader": f"Cader {cader}",
        "Idmunicipio": muni, "Nommunicipio": f"Municipio {muni}",
        "Idciclo": cycle, "Nomcicloproductivo": CYCLES[cycle],
        "Idmodalidad": modality, "Nommodalidad": MODALITIES[modality],
        "Idunidadmedida": unit_id, "Nomunidad": unit,
        "Idcultivo": crop_id, "crop": crop,
        "Sembrada": harvested if planted is None else planted,
        "Cosechada": harvested, "Siniestrada": damaged, "Volumenproduccion": volume,
        "Rendimiento": volume / harvested if numeric and harvested else "",
        "price": price,
        "Valorproduccion": (volume * price if numeric else "") if value is None else value,
    }


def write_siap_csv(directory, year, rows, name=None):
    """Write a municipal CSV using the header variant SIAP published for ``year``."""
    crop_header = "Nomcultivo Sin Um" if 2015 <= year <= 2020 else "Nomcultivo"
    price_header = "Precio" if year <= 2020 else "Preciomediorural"
    rename = {"crop": crop_header, "price": price_header}
    template = siap_row(year, 11, 52, 42)
    header = [rename.get(k, k) for k in template]
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / (name or f"Cierre_agricola_mun_{year}.csv")
    with path.open("w", encoding="latin-1", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(header)
        for row in rows:
            writer.writerow(list(row.values()))
    return path


class FakeBlob:
    def __init__(self, name, payload=b"", fail=False):
        self.name, self.payload, self.fail = name, payload, fail
        self.downloads = 0

    def download_to_filename(self, filename):
        self.downloads += 1
        if self.fail:
            Path(filename).write_bytes(b"partial")
            raise OSError("403 billing account disabled")
        Path(filename).write_bytes(self.payload)


class FakeClient:
    def __init__(self, blobs=()):
        self.blobs = list(blobs)
        self.list_calls = []

    def list_blobs(self, bucket, prefix=None):
        self.list_calls.append((bucket, prefix))
        return [b for b in self.blobs if b.name.startswith(prefix or "")]


class NoNetworkClient:
    def list_blobs(self, *args, **kwargs):
        raise AssertionError("GCS must not be contacted")


def build_source(tmp_path, files, client=None, **overrides):
    """Materialize a source from ``{year: rows}`` already present in the raw cache."""
    cache = tmp_path / CONFIG["local_cache_dir"]
    for year, rows in files.items():
        write_siap_csv(cache, year, rows)
    builder = EconomicSourceBuilder(tmp_path, storage_client=client or FakeClient())
    return builder.build({**CONFIG, **overrides})


# ------------------------------------------------------------------ architecture

def test_builder_implements_team_contract():
    assert issubclass(EconomicSourceBuilder, SourceBuilder)


def test_application_conf_block_keeps_scaffold_sections_empty():
    path = REPO_ROOT / "resources" / "application.conf"
    assert PipelineConfig.from_file(path) == PipelineConfig({}, {}, {})
    assert load_economic_config(path) == CONFIG


def test_mapping_is_self_contained_and_canonical():
    mapping = load_siap_mapping()
    assert economic.DEFAULT_MAPPING_FILE == "configs/siap_mapping_local.json"
    assert (REPO_ROOT / economic.DEFAULT_MAPPING_FILE).is_file()
    assert set(mapping.columns["crop"]) == {"Nomcultivo", "Nomcultivo Sin Um"}
    assert set(mapping.columns["rural_price_mxn_t"]) == {"Precio", "Preciomediorural"}
    assert (mapping.unit_name, mapping.unit_id) == ("Tonelada", 200201)
    assert sorted(mapping.pilot_keys) == [(11, 52), (25, 133), (26, 148)]
    assert mapping.explicit_only_keys == ((25, 134),)


def test_outputs_must_stay_under_repository_data(tmp_path):
    builder = EconomicSourceBuilder(tmp_path, storage_client=NoNetworkClient())
    with pytest.raises(ValueError, match="under repository-root data"):
        builder.build({**CONFIG, "output_parquet": "../outside/siap.parquet"})
    with pytest.raises(ValueError, match="under repository-root data"):
        builder.build({**CONFIG, "local_cache_dir": "raw/siap"})


def test_invalid_configuration_is_rejected(tmp_path):
    builder = EconomicSourceBuilder(tmp_path, storage_client=NoNetworkClient())
    with pytest.raises(ValueError, match="disabled"):
        builder.build({**CONFIG, "enabled": False})
    with pytest.raises(ValueError, match="aggregation_level"):
        builder.build({**CONFIG, "aggregation_level": "state"})
    with pytest.raises(ValueError, match="currency"):
        builder.build({**CONFIG, "currency": "USD"})
    with pytest.raises(ValueError, match="excluded state-level"):
        builder.build({**CONFIG, "gcs_municipal_prefix": STATE_PREFIX})


# ------------------------------------------------------------ coordinate resolution

@pytest.mark.parametrize("lat, lon, state_id, district_id", PILOTS)
def test_pilot_coordinates_resolve_to_validated_district(lat, lon, state_id, district_id):
    site = resolve_district(lat, lon)
    assert (site.state_id, site.district_id) == (state_id, district_id)


def test_haversine_matches_known_distance():
    assert haversine_km(0, 0, 0, 1) == pytest.approx(111.195, abs=0.01)
    assert haversine_km(20.0, -101.0, 20.0, -101.0) == 0


def test_coordinates_beyond_50_km_are_rejected():
    lat, lon = PILOTS[2][:2]
    assert resolve_district(lat + 0.40, lon).district_id == 52       # about 44 km north
    with pytest.raises(ValueError, match="km from the nearest pilot site"):
        resolve_district(lat + 0.50, lon)                             # about 56 km north
    with pytest.raises(ValueError, match="limit is 50 km"):
        resolve_district(19.4326, -99.1332)                           # Mexico City
    with pytest.raises(ValueError, match="Invalid coordinates"):
        resolve_district(95.0, -101.0)


# ----------------------------------------------------------------- GCS sync / cache

def test_sync_downloads_only_missing_municipal_files(tmp_path):
    cache = tmp_path / CONFIG["local_cache_dir"]
    seed = tmp_path / "seed"
    payload = lambda year: write_siap_csv(  # noqa: E731
        seed, year, [siap_row(year, 11, 52, 42)]).read_bytes()
    cached_2003 = write_siap_csv(cache, 2003, [siap_row(2003, 11, 52, 42, volume=777.0)])
    blobs = {
        "mun_2003": FakeBlob(PREFIX + "Cierre_agricola_mun_2003.csv", payload(2003)),
        "mun_2004": FakeBlob(PREFIX + "Cierre_agricola_mun_2004.csv", payload(2004)),
        "mun_2002": FakeBlob(PREFIX + "Cierre_agricola_mun_2002.csv", payload(2004)),
        "national": FakeBlob(PREFIX + "Cierre_agricola_nacional_2001.csv", b"state"),
        "nested": FakeBlob(PREFIX + "old/Cierre_agricola_mun_2005.csv", payload(2004)),
        "state_2000": FakeBlob(STATE_PREFIX + "Cierre_agricola_nacional_2000.csv", b"state"),
        "state_2002": FakeBlob(STATE_PREFIX + "Cierre_agricola_estat_2002.csv", b"state"),
    }
    client = FakeClient(blobs.values())
    source = EconomicSourceBuilder(tmp_path, storage_client=client).build(CONFIG)

    assert client.list_calls == [("data_dump_samples", PREFIX)]
    assert {name: blob.downloads for name, blob in blobs.items()} == {
        "mun_2003": 0, "mun_2004": 1, "mun_2002": 0, "national": 0, "nested": 0,
        "state_2000": 0, "state_2002": 0}
    assert sorted(p.name for p in cache.iterdir()) == [
        "Cierre_agricola_mun_2003.csv", "Cierre_agricola_mun_2004.csv"]
    assert "777" in cached_2003.read_text(encoding="latin-1")  # cached copy untouched
    assert source.metadata["file_years"] == [2003, 2004]
    assert sorted(source.records["Anio"].unique()) == [2003, 2004]


def test_state_level_files_in_the_cache_are_never_read(tmp_path):
    cache = tmp_path / CONFIG["local_cache_dir"]
    stale = [siap_row(2001, 11, 52, 42, volume=9999.0)]
    write_siap_csv(cache, 2001, stale, name="Cierre_agricola_nacional_2001.csv")
    write_siap_csv(cache, 2002, stale, name="Cierre_agricola_mun_2002.csv")
    source = build_source(tmp_path, {
        2003: [siap_row(2003, 11, 52, 42), siap_row(2001, 11, 52, 42, volume=5555.0)]})
    assert source.metadata["files"] == ["Cierre_agricola_mun_2003.csv"]
    assert source.records["Anio"].tolist() == [2003]
    assert source.metadata["quality_control"]["year_out_of_range"] == 1


def test_materialized_parquet_loads_offline_without_gcs_or_raw_csvs(tmp_path):
    first = build_source(tmp_path, {2010: [siap_row(2010, 11, 52, 42)]})
    cache = tmp_path / CONFIG["local_cache_dir"]
    for path in cache.iterdir():
        path.unlink()
    second = EconomicSourceBuilder(tmp_path, storage_client=NoNetworkClient()).build(CONFIG)
    pd.testing.assert_frame_equal(first.query(), second.query(), check_dtype=False)
    assert second.metadata["source_id"] == "dgsiap_siap_district_mx"
    assert second.municipality_catalog()["Idmunicipio"].tolist() == [42]


def test_complete_local_cache_never_contacts_gcs(tmp_path):
    files = {year: [siap_row(year, 26, 148, 18)] for year in range(2003, 2026)}
    source = build_source(tmp_path, files, client=NoNetworkClient())
    assert sorted(source.records["Anio"]) == list(range(2003, 2026))


def test_failed_download_raises_and_leaves_no_partial_file(tmp_path):
    client = FakeClient([FakeBlob(PREFIX + "Cierre_agricola_mun_2003.csv", fail=True)])
    with pytest.raises(RuntimeError, match="Could not download gs://data_dump_samples/.*403"):
        EconomicSourceBuilder(tmp_path, storage_client=client).build(CONFIG)
    cache = tmp_path / CONFIG["local_cache_dir"]
    assert list(cache.iterdir()) == []
    assert not (tmp_path / CONFIG["output_parquet"]).exists()


# ------------------------------------------------------- harmonization and quality

def test_crop_and_price_aliases_are_harmonized_across_years(tmp_path):
    files = {
        2014: [siap_row(2014, 11, 52, 42, crop="Trigo grano", crop_id=300, price=3000.0)],
        2015: [siap_row(2015, 11, 52, 42, crop="Trigo grano", crop_id=300, price=3500.0)],
        2021: [siap_row(2021, 11, 52, 42, crop="Trigo grano", crop_id=300, price=5500.0)],
    }
    cache = tmp_path / CONFIG["local_cache_dir"]
    source = build_source(tmp_path, files)
    header = lambda year: (cache / f"Cierre_agricola_mun_{year}.csv").read_text(  # noqa: E731
        encoding="latin-1").splitlines()[0]
    assert "Nomcultivo Sin Um" in header(2015) and "Precio" in header(2015)
    assert "Preciomediorural" in header(2021) and "Nomcultivo," in header(2021)

    records = source.query()
    assert records["crop"].tolist() == ["Trigo grano"] * 3
    assert records["Anio"].tolist() == [2014, 2015, 2021]
    assert records["weighted_price_mxn_t"].tolist() == [3000.0, 3500.0, 5500.0]
    assert "Nomcultivo" not in records.columns and "Precio" not in records.columns


def test_non_comparable_and_failed_rows_are_discarded(tmp_path):
    good = siap_row(2020, 11, 52, 42)
    rows = [
        good,
        siap_row(2020, 11, 52, 43, crop="Cilantro", crop_id=90, unit="Manojo", unit_id=200209),
        siap_row(2020, 11, 52, 44, unit="Tonelada", unit_id=200209),      # id contradicts name
        siap_row(2020, 11, 52, 45, harvested=0.0, volume=0.0, value=0.0, planted=50.0,
                 damaged=50.0),                                           # total crop failure
        siap_row(2020, 11, 52, 46, volume=0.0, value=0.0),
        siap_row(2020, 11, 52, 47, value=0.0),
        siap_row(2020, 11, 52, 48, price=0.0, value=4000000.0),
        siap_row(2020, 11, 52, 49, price=-5.0, value=4000000.0),
        siap_row(2020, 11, 52, 50, price="", value=4000000.0),            # null price
        siap_row(2020, 11, 52, 51, volume="n/d", value=4000000.0),        # unparseable
        siap_row(2020, 11, 50, 52),                                       # not a pilot district
    ]
    source = build_source(tmp_path, {2020: rows})
    records = source.query()
    assert len(records) == 1
    row = records.iloc[0]
    assert (row["crop"], row["source_rows"], row["harvested_ha"]) == ("Maíz grano", 1, 100.0)
    assert source.municipality_catalog()["Idmunicipio"].tolist() == [42]
    assert source.metadata["quality_control"] == {
        "rows_in_scope": 10, "missing_keys": 0, "year_out_of_range": 0,
        "non_tonne_unit": 2, "null_measure": 2, "non_positive_measure": 5, "rows_kept": 1}
    assert not records[["weighted_yield_t_ha", "weighted_price_mxn_t"]].isna().any().any()


# ------------------------------------------------------------ district aggregation

def test_district_yield_and_price_are_area_and_volume_weighted(tmp_path):
    rows = [  # two municipalities / CADERs of Idddr=133 with very different yields
        siap_row(2022, 25, 133, 11, cader=8, harvested=100.0, planted=110.0, damaged=10.0,
                 volume=1000.0, price=4000.0),
        siap_row(2022, 25, 133, 1, cader=5, harvested=300.0, planted=300.0, damaged=0.0,
                 volume=1500.0, price=6000.0),
    ]
    row = build_source(tmp_path, {2022: rows}).query(
        EconomicQuery(lat=PILOTS[0][0], lon=PILOTS[0][1])).iloc[0]

    assert (row["Idestado"], row["Idddr"], row["source_rows"]) == (25, 133, 2)
    assert row["planted_ha"] == 410.0
    assert row["harvested_ha"] == 400.0
    assert row["damaged_ha"] == 10.0
    assert row["volume_t"] == 2500.0
    assert row["production_value_mxn"] == 13_000_000.0
    assert row["weighted_yield_t_ha"] == 2500.0 / 400.0 == 6.25
    assert row["weighted_price_mxn_t"] == 13_000_000.0 / 2500.0 == 5200.0

    unweighted_yield = (1000.0 / 100.0 + 1500.0 / 300.0) / 2
    unweighted_price = (4000.0 + 6000.0) / 2
    assert (unweighted_yield, unweighted_price) == (7.5, 5000.0)
    assert row["weighted_yield_t_ha"] != unweighted_yield
    assert row["weighted_price_mxn_t"] != unweighted_price
    assert row["reference_level"] == "district_ddr_siap_reference"
    assert row["currency"] == "MXN"
    assert row["source_id"] == "dgsiap_siap_district_mx"


def test_label_spelling_cannot_split_a_district_total(tmp_path):
    first = siap_row(2022, 25, 133, 11, harvested=100.0, volume=1000.0, price=4000.0)
    second = siap_row(2022, 25, 133, 1, harvested=300.0, volume=1500.0, price=6000.0)
    second.update(Nomddr="LOS MOCHIS", crop="MAIZ GRANO", Nommodalidad="riego")
    other_crop = siap_row(2022, 25, 133, 1, crop="Maíz forrajero", harvested=10.0, volume=400.0)
    records = build_source(tmp_path, {2022: [first, second, other_crop]}).query()
    assert len(records) == 2                      # same ids + same crop id, different crop
    grain = records[records["crop"] == "Maíz grano"].iloc[0]
    assert (grain["Nomddr"], grain["Nommodalidad"], grain["source_rows"]) == (
        "Los Mochis", "Riego", 2)
    assert grain["weighted_yield_t_ha"] == 6.25
    assert grain["weighted_price_mxn_t"] == 5200.0
    assert records[records["crop"] == "Maíz forrajero"]["weighted_yield_t_ha"].tolist() == [40.0]


def test_utf8_copy_of_a_file_keeps_its_accents(tmp_path):
    cache = tmp_path / CONFIG["local_cache_dir"]
    path = write_siap_csv(cache, 2010, [siap_row(2010, 11, 52, 42, cycle=1)])
    path.write_bytes(b"\xef\xbb\xbf" + path.read_text(encoding="latin-1").encode("utf-8"))
    row = build_source(tmp_path, {}).query().iloc[0]
    assert (row["crop"], row["Nomcicloproductivo"]) == ("Maíz grano", "Otoño-Invierno")


def test_riego_and_temporal_and_cycles_stay_separate(tmp_path):
    rows = [
        siap_row(2019, 26, 148, 18, modality=1, cycle=1, harvested=200.0, volume=2400.0),
        siap_row(2019, 26, 148, 12, modality=1, cycle=1, harvested=100.0, volume=1200.0),
        siap_row(2019, 26, 148, 18, modality=2, cycle=1, harvested=100.0, volume=200.0),
        siap_row(2019, 26, 148, 18, modality=1, cycle=2, harvested=50.0, volume=400.0),
    ]
    source = build_source(tmp_path, {2019: rows})
    records = source.query(EconomicQuery(district_id=148))
    assert len(records) == 3
    by_group = {(r.Nomcicloproductivo, r.Nommodalidad): r.weighted_yield_t_ha
                for r in records.itertuples()}
    assert by_group == {
        ("Otoño-Invierno", "Riego"): 12.0,
        ("Otoño-Invierno", "Temporal"): 2.0,
        ("Primavera-Verano", "Riego"): 8.0,
    }
    pooled = (2400.0 + 1200.0 + 200.0) / 400.0
    assert pooled not in set(by_group.values())

    riego = source.query(EconomicQuery(district_id=148, modality="riego"))
    assert set(riego["Nommodalidad"]) == {"Riego"} and len(riego) == 2
    temporal = source.query(EconomicQuery(district_id=148, modality="Temporal"))
    assert temporal["weighted_yield_t_ha"].tolist() == [2.0]
    with pytest.raises(ValueError, match="modality"):
        EconomicQuery(modality="Humedad")


# ---------------------------------------------------------------- financial metrics

def test_stress_revenue_and_missing_net_margin_without_costs(tmp_path):
    rows = [siap_row(2022, 25, 133, 11, harvested=100.0, volume=1000.0, price=4000.0),
            siap_row(2022, 25, 133, 1, harvested=300.0, volume=1500.0, price=6000.0)]
    source = build_source(tmp_path, {2022: rows})
    row = source.query().iloc[0]
    assert row["gross_revenue_mxn_ha"] == 6.25 * 5200.0 == 32_500.0
    assert row["stress_minus20_revenue_mxn_ha"] == pytest.approx(32_500.0 * 0.64)
    assert row["stress_minus20_revenue_mxn_ha"] == pytest.approx(
        (6.25 * 0.8) * (5200.0 * 0.8))
    assert pd.isna(row["explicit_cost_mxn_ha"])
    assert pd.isna(row["net_margin_mxn_ha"])
    assert pd.isna(row["cost_reference_level"])

    priced = source.query(EconomicQuery(crop="maiz grano", explicit_cost_mxn_ha=20_000.0))
    assert priced["net_margin_mxn_ha"].tolist() == [12_500.0]
    assert priced["cost_reference_level"].tolist() == ["user_explicit"]
    assert pd.isna(source.query()["net_margin_mxn_ha"]).all()  # stored records unchanged
    with pytest.raises(ValueError, match="one crop"):
        EconomicQuery(explicit_cost_mxn_ha=20_000.0)


def cost_fixture(tmp_path):
    rows = [
        siap_row(2022, 25, 133, 11, harvested=100.0, volume=1000.0),
        siap_row(2022, 25, 133, 1, harvested=300.0, volume=1500.0),
        siap_row(2022, 25, 133, 1, harvested=80.0, volume=160.0, modality=2),
        siap_row(2022, 11, 52, 42, harvested=50.0, volume=400.0),
    ]
    return build_source(tmp_path, {2022: rows})


def test_state_only_cost_table_is_labelled_state_fallback(tmp_path):
    source = cost_fixture(tmp_path)
    state_costs = pd.DataFrame({
        "Idestado": [25, 99], "crop": ["Maíz grano", "Maíz grano"],
        "Nommodalidad": ["Riego", "Riego"], "explicit_cost_mxn_ha": [30_000.0, 1.0]})
    costs = source.costs_from_state_table(state_costs)
    assert costs[["Idestado", "Idddr"]].values.tolist() == [[25, 133]]
    assert costs["reference_level"].tolist() == ["state_fallback"]
    assert costs["explicit_cost_mxn_ha"].tolist() == [30_000.0]

    priced = source.with_costs(source.query(), costs)
    sinaloa_riego = priced[(priced["Idddr"] == 133) & (priced["Nommodalidad"] == "Riego")].iloc[0]
    assert sinaloa_riego["cost_reference_level"] == "state_fallback"
    assert sinaloa_riego["net_margin_mxn_ha"] == sinaloa_riego["gross_revenue_mxn_ha"] - 30_000.0
    assert sinaloa_riego["reference_level"] == "district_ddr_siap_reference"
    others = priced.drop(index=sinaloa_riego.name)
    assert len(others) == 2 and pd.isna(others["net_margin_mxn_ha"]).all()
    assert pd.isna(others["cost_reference_level"]).all()


def test_municipal_cost_table_is_weighted_by_harvested_area(tmp_path):
    source = cost_fixture(tmp_path)
    assert source.municipality_catalog()[["Idestado", "Idddr", "Idmunicipio"]].values.tolist() \
        == [[11, 52, 42], [25, 133, 1], [25, 133, 11]]
    municipal_costs = pd.DataFrame({
        "Idestado": [25, 25, 25], "Idmunicipio": [11, 1, 77],   # 77 is in no pilot district
        "Nommodalidad": ["Riego", "Riego", "Riego"],
        "explicit_cost_mxn_ha": [20_000.0, 28_000.0, 99_000.0]})
    costs = source.costs_from_municipal_table(municipal_costs)
    assert len(costs) == 1
    cost = costs.iloc[0]
    assert (cost["Idestado"], cost["Idddr"]) == (25, 133)
    assert cost["reference_level"] == "district_ddr_aggregated"
    assert cost["explicit_cost_mxn_ha"] == (20_000.0 * 100 + 28_000.0 * 300) / 400 == 26_000.0
    assert cost["explicit_cost_mxn_ha"] != (20_000.0 + 28_000.0) / 2
    assert (cost["cost_municipalities"], cost["cost_weight_harvested_ha"]) == (2, 400.0)

    state_costs = source.costs_from_state_table(pd.DataFrame({
        "Idestado": [25, 11], "explicit_cost_mxn_ha": [31_000.0, 15_000.0]}))
    priced = source.with_costs(source.with_costs(source.query(), costs), state_costs)
    levels = {(r.Idddr, r.Nommodalidad): (r.explicit_cost_mxn_ha, r.cost_reference_level)
              for r in priced.itertuples()}
    assert levels == {
        (133, "Riego"): (26_000.0, "district_ddr_aggregated"),  # district evidence kept
        (133, "Temporal"): (31_000.0, "state_fallback"),
        (52, "Riego"): (15_000.0, "state_fallback"),
    }
    assert (priced["net_margin_mxn_ha"]
            == priced["gross_revenue_mxn_ha"] - priced["explicit_cost_mxn_ha"]).all()


def test_cost_tables_are_validated_not_imputed(tmp_path):
    source = cost_fixture(tmp_path)
    with pytest.raises(ValueError, match="never imputed"):
        source.costs_from_state_table(pd.DataFrame({
            "Idestado": [25], "explicit_cost_mxn_ha": [float("nan")]}))
    with pytest.raises(ValueError, match="duplicate"):
        source.costs_from_state_table(pd.DataFrame({
            "Idestado": [25, 25], "explicit_cost_mxn_ha": [1.0, 2.0]}))
    with pytest.raises(ValueError, match="lacks columns"):
        source.costs_from_municipal_table(pd.DataFrame({
            "Idestado": [25], "explicit_cost_mxn_ha": [1.0]}))


# -------------------------------------------------------------------- query filters

def query_fixture(tmp_path):
    files = {}
    for year in (2018, 2019, 2020):
        files[year] = [
            siap_row(year, 25, 133, 11),
            siap_row(year, 25, 133, 11, crop="Frijol", crop_id=120, modality=2, volume=150.0),
            siap_row(year, 25, 134, 11, cader=9, volume=900.0),
            siap_row(year, 26, 148, 18, crop="Trigo grano", crop_id=300, cycle=1),
            siap_row(year, 11, 52, 42),
        ]
    return build_source(tmp_path, files)


def test_query_filters_by_site_district_years_crop_and_modality(tmp_path):
    source = query_fixture(tmp_path)
    everything = source.query()
    assert set(zip(everything["Idestado"], everything["Idddr"])) == {
        (25, 133), (26, 148), (11, 52)}
    assert len(everything) == 12

    for lat, lon, state_id, district_id in PILOTS:
        by_site = source.query(EconomicQuery(lat=lat, lon=lon))
        by_id = source.query(EconomicQuery(district_id=district_id))
        assert set(by_site["Idddr"]) == {district_id} and set(by_site["Idestado"]) == {state_id}
        pd.testing.assert_frame_equal(by_site, by_id)

    years = source.query(EconomicQuery(district_id=52, year_start=2019, year_end=2020))
    assert years["Anio"].tolist() == [2019, 2020]
    assert source.query(EconomicQuery(year_end=2002)).empty  # nothing before 2003

    frijol = source.query(EconomicQuery(crop="FRIJOL"))
    assert set(frijol["crop"]) == {"Frijol"} and set(frijol["Idddr"]) == {133}
    accent = source.query(EconomicQuery(district_id=133, crop="maiz grano", modality="Riego",
                                        year_start=2018, year_end=2018))
    assert accent[["Anio", "crop", "Nommodalidad"]].values.tolist() == [
        [2018, "Maíz grano", "Riego"]]
    assert source.query(EconomicQuery(district_id=133, modality="Temporal"))["crop"].tolist() \
        == ["Frijol"] * 3


def test_guasave_district_134_only_when_requested_explicitly(tmp_path):
    source = query_fixture(tmp_path)
    lat, lon = PILOTS[0][:2]
    assert 134 not in set(source.records["Idddr"])
    assert set(source.query(EconomicQuery(lat=lat, lon=lon))["Idddr"]) == {133}

    explicit = source.query(EconomicQuery(district_id=134))
    assert set(explicit["Idddr"]) == {134} and len(explicit) == 3
    assert explicit["weighted_yield_t_ha"].tolist() == [9.0] * 3
    assert set(explicit["reference_level"]) == {"district_ddr_siap_reference"}
    at_site = source.query(EconomicQuery(lat=lat, lon=lon, district_id=134))
    pd.testing.assert_frame_equal(explicit, at_site)
    assert 134 not in set(source.query()["Idddr"])            # still not a default district
    stored = pd.read_parquet(tmp_path / CONFIG["output_parquet"])
    assert set(stored["Idddr"]) == {52, 133, 148}


def test_unvalidated_or_inconsistent_districts_are_rejected(tmp_path):
    source = query_fixture(tmp_path)
    with pytest.raises(ValueError, match="not a validated district"):
        source.query(EconomicQuery(district_id=50))
    with pytest.raises(ValueError, match="not a validated district"):
        source.query(EconomicQuery(lat=PILOTS[1][0], lon=PILOTS[1][1], district_id=52))
    with pytest.raises(ValueError, match="nearest pilot site"):
        source.query(EconomicQuery(lat=19.4326, lon=-99.1332))
    with pytest.raises(ValueError, match="together"):
        EconomicQuery(lat=20.0)
    with pytest.raises(ValueError, match="year_start"):
        EconomicQuery(year_start=2020, year_end=2010)


@pytest.mark.filterwarnings("default:No SIAP rows for pilot district")
def test_pilot_district_absent_from_the_data_is_reported(tmp_path):
    with pytest.warns(UserWarning) as caught:
        source = build_source(tmp_path, {2010: [siap_row(2010, 11, 52, 42)]})
    messages = sorted(str(w.message) for w in caught)
    assert len(messages) == 2
    assert "Idddr=133 (Los Mochis)" in messages[0] and "Idddr=148 (Cajeme)" in messages[1]
    assert source.query(EconomicQuery(district_id=148)).empty  # absent, never fabricated


def test_materialized_parquet_carries_provenance(tmp_path):
    build_source(tmp_path, {2010: [siap_row(2010, 11, 52, 42)]})
    import pyarrow.parquet as pq
    schema = pq.read_schema(tmp_path / CONFIG["output_parquet"])
    provenance = json.loads(schema.metadata[b"gradientdescentfarmers.economic"])
    assert provenance["files"] == ["Cierre_agricola_mun_2010.csv"]
    assert provenance["aggregation_level"] == "district_ddr"
    assert provenance["stress_minus20_factor"] == 0.64
    assert provenance["quality_control"]["rows_kept"] == 1

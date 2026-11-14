"""SIAP module tests: fake HTTP session only, no network access."""
import pandas as pd
import pytest

from gradientdescentfarmers.source_builder.siap import (
    DATASETS, SiapClient, SiapFormatError, SiapSettings, SiapSourceBuilder, SiapStore, parse_csv)
from gradientdescentfarmers.source_builder.siap.catalog import parse_listing

HEADER = ("Anio,Idestado,Nomestado,Idddr,Nomddr,Idcader,Nomcader,Idmunicipio,Nommunicipio,Idciclo,"
          "Nomcicloproductivo,Idmodalidad,Nommodalidad,Idunidadmedida,Nomunidad,Idcultivo,Nomcultivo,"
          "Sembrada,Cosechada,Siniestrada,Volumenproduccion,Rendimiento,Preciomediorural,Valorproduccion")


def municipal_csv(year=2025, encoding="latin-1"):
    rows = [
        f"{year},11,Guanajuato,1,Celaya,1,Celaya,7,Celaya,1,Otoño-Invierno,1,Riego,200201,Tonelada,5670000,Brócoli,50,50,0,850,17,6887.78,5854613",
        f"{year},1,Aguascalientes,1,Aguascalientes,1,Aguascalientes,1,Aguascalientes,2,Primavera-Verano,2,Temporal,200201,Tonelada,5490000,Avena forrajera,10,8,2,80,10,500,40000",
    ]
    return "\r\n".join([HEADER, *rows, ""]).encode(encoding)


class FakeResponse:
    def __init__(self, status=200, body=b"", headers=None):
        self.status_code, self.body, self.headers = status, body, headers or {}
        self.text = body.decode("latin-1")

    def __enter__(self): return self
    def __exit__(self, *a): return False
    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")
    def iter_content(self, n):
        for i in range(0, len(self.body), n):
            yield self.body[i:i + n]


class FakeSession:
    def __init__(self, routes):
        self.routes, self.calls = routes, []
    def get(self, url, **kw):
        self.calls.append(url)
        for key, resp in self.routes.items():
            if key in url:
                return resp() if callable(resp) else resp
        return FakeResponse(404)


def client_for(routes):
    return SiapClient(SiapSettings(delay_between_requests_s=0), session=FakeSession(routes))


def ok(body, name="Cierre_agricola_mun_2025.csv"):
    return FakeResponse(200, body, {"Content-Disposition": f'attachment; filename="{name}"',
                                     "Content-Length": str(len(body))})


def test_parse_latin1_and_normalize():
    df = parse_csv(municipal_csv(), DATASETS["municipal"].required_columns)
    assert list(df.crop) == ["Brócoli", "Avena forrajera"]
    assert df.cycle.iloc[0] == "Otoño-Invierno"
    assert str(df.state_id.dtype) == "Int64" and df.production_value_mxn.iloc[0] == 5854613
    assert "price_mxn_per_unit" in df


def test_national_precio_column_maps_to_same_name():
    raw = ("Anio,Idestado,Nomestado,Idciclo,Nomcicloproductivo,Idmodalidad,Nommodalidad,Idunidadmedida,Nomunidad,"
           "Idcultivo,Nomcultivo,Sembrada,Cosechada,Siniestrada,Volumenproduccion,Rendimiento,Precio,Valorproduccion\n"
           "2002,1,Aguascalientes,1,Otoño-Invierno,1,Riego,200201,Tonelada,5010000,Acelga,2.00,2.00,0.00,18.00,9.00,1755.00,31590.00\n")
    df = parse_csv(raw.encode("latin-1"), DATASETS["national"].required_columns)
    assert df.price_mxn_per_unit.iloc[0] == 1755.0


@pytest.mark.parametrize("payload", [b"", b"<!DOCTYPE html><html><body>nope</body></html>",
                                     b"a,b\n1,2\n", HEADER.encode() + b"\n"])
def test_bad_payloads_rejected(payload):
    with pytest.raises(SiapFormatError):
        parse_csv(payload, DATASETS["municipal"].required_columns)


def test_unknown_column_rejected():
    raw = municipal_csv().replace(b"Sembrada", b"Plantada")
    with pytest.raises(SiapFormatError):
        parse_csv(raw)


def test_fetch_uses_root_relative_url_and_detects_html():
    ds = DATASETS["municipal"]
    assert ds.url(2025).startswith("https://nube.agricultura.gob.mx/index.php?view=")
    assert "/datosAbiertos/" not in ds.url(2025)
    html = FakeResponse(200, b"<!DOCTYPE html><html></html>")
    with pytest.raises(SiapFormatError):
        client_for({"ANIO=2025": html}).fetch_year(ds, 2025)


def test_truncated_download_rejected():
    body = municipal_csv()
    resp = FakeResponse(200, body, {"Content-Length": str(len(body) + 10)})
    with pytest.raises(SiapFormatError, match="truncated"):
        client_for({"ANIO=2025": resp}).fetch_year(DATASETS["municipal"], 2025)


def test_sync_load_skip_refresh_and_manifest(tmp_path):
    store = SiapStore(tmp_path)
    client = client_for({"ANIO=2025": ok(municipal_csv(2025)), "ANIO=2024": ok(municipal_csv(2024), "Cierre_agricola_mun_2024.csv")})
    rep = store.sync(client, ["municipal"], [2024, 2025])
    assert rep["municipal"] == {2024: "downloaded", 2025: "downloaded"}
    assert store.available_years("municipal") == [2024, 2025]
    assert (tmp_path / "raw/municipal/Cierre_agricola_mun_2025.csv").read_bytes() == municipal_csv(2025)
    n = len(client.session.calls)
    assert store.sync(client, ["municipal"], [2025])["municipal"][2025] == "skipped"
    assert len(client.session.calls) == n  # no network on skip
    assert store.sync(client, ["municipal"], [2025], refresh=True)["municipal"][2025] == "unchanged"
    df = store.load("municipal", state="guanajuato")
    assert set(df.year) == {2024, 2025} and set(df.state) == {"Guanajuato"}
    assert list(store.load("municipal", years=[2025], crop="brócoli", columns=["crop", "year"]).columns) == ["crop", "year"]
    assert store.manifest()["datasets"]["municipal"]["2025"]["cleaning"]["rows_out"] == 2


def test_sync_isolates_failures_and_missing_years(tmp_path):
    store = SiapStore(tmp_path)
    client = client_for({"ANIO=2025": ok(municipal_csv(2025)), "ANIO=2024": FakeResponse(200, b"<html></html>"),
                         "ANIO=2023": FakeResponse(404)})
    rep = store.sync(client, ["municipal"], [2023, 2024, 2025, 1999])["municipal"]
    assert rep[2025] == "downloaded" and rep[2023] == "unavailable" and rep[1999] == "unavailable"
    assert rep[2024].startswith("failed")
    assert store.available_years("municipal") == [2025]


def test_wrong_year_inside_file_rejected(tmp_path):
    client = client_for({"ANIO=2025": ok(municipal_csv(2019))})
    rep = SiapStore(tmp_path).sync(client, ["municipal"], [2025])["municipal"]
    assert rep[2025].startswith("failed")


def test_load_without_data_raises(tmp_path):
    with pytest.raises(FileNotFoundError):
        SiapStore(tmp_path).load("municipal")


def test_source_builder_never_syncs_unless_asked(tmp_path):
    client = client_for({"ANIO=2025": ok(municipal_csv(2025))})
    builder = SiapSourceBuilder(client)
    with pytest.raises(FileNotFoundError):
        builder.build({"root": str(tmp_path), "years": [2025]})
    assert client.session.calls == []
    df = builder.build({"root": str(tmp_path), "years": [2025], "sync": True, "state": "Guanajuato"})
    assert isinstance(df, pd.DataFrame) and len(df) == 1


def test_parse_listing():
    html = ('<a href="/index.php?view=10AE434F-A2158368-A120BC5A-EDF4AFAA&ANIO=2025">x</a>'
            '<a href="/index.php?view=10AE434F-A2158368-A120BC5A-EDF4AFAA&amp;ANIO=2024">y</a>'
            '<a href="/index.php?view=3DA7A2BB-7AEC2838-9D81CAA7-4EAF9CAD">dict</a>')
    assert parse_listing(html) == {"10AE434F-A2158368-A120BC5A-EDF4AFAA": [2024, 2025]}


# ---- cleaning ---------------------------------------------------------------
from gradientdescentfarmers.source_builder.siap import aggregate_municipality, clean  # noqa: E402


def frame(rows):
    cols = ["year", "state_id", "state", "ddr_id", "cader_id", "municipality_id", "municipality", "cycle_id", "cycle",
            "modality_id", "modality", "unit_id", "unit", "crop_id", "crop", "sown_ha", "harvested_ha", "lost_ha",
            "production_volume", "yield", "price_mxn_per_unit", "production_value_mxn"]
    return pd.DataFrame(rows, columns=cols).astype({c: "Int64" for c in cols[:2] + cols[3:6] + [cols[7], cols[9], cols[11], cols[13]]})


def row(cader=1, crop="Maíz", sown=10., harv=10., lost=0., vol=100., yld=10., price=5., value=500., unit="Tonelada"):
    return [2025, 11, "Guanajuato", 1, cader, 7, "Celaya", 1, "Primavera-Verano", 1, "Riego", 1, unit, 9, crop,
            sown, harv, lost, vol, yld, price, value]


def test_clean_drops_empty_and_exact_duplicates_and_nulls_zero_price():
    df = frame([row(), row(), row(crop="Frijol", sown=0, harv=0, vol=0, yld=0, price=0, value=0),
                row(crop="Trigo", sown=5, harv=0, vol=0, yld=0, price=0, value=0)])
    out, rep = clean(df)
    assert rep["exact_duplicates_dropped"] == 1 and rep["no_activity_rows_dropped"] == 1
    assert list(out.crop) == ["Maíz", "Trigo"] and rep["rows_out"] == 2
    trigo = out[out.crop == "Trigo"].iloc[0]
    assert pd.isna(trigo["yield"]) and pd.isna(trigo.price_mxn_per_unit) and not trigo.has_harvest
    assert len(df) == 4  # input untouched


def test_clean_flags_do_not_change_values():
    df = frame([row(sown=10, harv=11),                       # harvested > sown
                row(crop="B", yld=20, vol=100, harv=10),     # yield inconsistent with volume/harvested
                row(crop="C", value=9999),                   # value inconsistent with volume*price
                row(crop="D", unit="Planta")])
    out, rep = clean(df)
    f = out.set_index("crop")
    assert f.loc["Maíz", "flag_harvested_gt_sown"] and f.loc["B", "flag_yield_mismatch"]
    assert f.loc["C", "flag_value_mismatch"] and not f.loc["D", "is_tonne_unit"]
    assert f.loc["Maíz", "harvested_ha"] == 11 and f.loc["C", "production_value_mxn"] == 9999
    assert rep["flags"]["flag_harvested_gt_sown"] == 1


def test_clean_yield_outlier_within_crop_and_unit():
    rows = [row(cader=i, yld=10 + 0.1 * i, vol=100 + i, harv=10, price=1, value=100 + i) for i in range(1, 15)]
    rows.append(row(cader=99, yld=5000, vol=50000, harv=10, price=1, value=50000))
    out, _ = clean(frame(rows))
    assert out[out.flag_yield_outlier].cader_id.tolist() == [99]


def test_clean_nulls_negatives_and_normalizes_text():
    df = frame([row(crop="  Maíz   grano ", sown=-3)])
    out, rep = clean(df)
    assert out.crop.iloc[0] == "Maíz grano" and pd.isna(out.sown_ha.iloc[0])
    assert rep["negative_values_nulled"] == {"sown_ha": 1}


def test_clean_is_idempotent():
    out, _ = clean(frame([row(), row(cader=2, crop="Frijol")]))
    flags = [c for c in out if c.startswith(("flag_", "is_", "has_"))]
    again, _ = clean(out.drop(columns=flags))
    pd.testing.assert_frame_equal(out, again)


def test_aggregate_municipality_sums_cader_splits_and_recomputes_ratios():
    df, _ = clean(frame([row(cader=1, harv=10, vol=100, price=5, value=500), row(cader=2, harv=30, vol=600, price=10, value=6000)]))
    assert len(df) == 2
    agg = aggregate_municipality(df)
    assert len(agg) == 1
    r = agg.iloc[0]
    assert r.harvested_ha == 40 and r.production_volume == 700 and r.production_value_mxn == 6500
    assert r["yield"] == pytest.approx(17.5) and r.price_mxn_per_unit == pytest.approx(6500 / 700)


def test_sync_stores_cleaning_report_and_rebuild_offline(tmp_path):
    store = SiapStore(tmp_path)
    store.sync(client_for({"ANIO=2025": ok(municipal_csv(2025))}), ["municipal"], [2025])
    rep = store.manifest()["datasets"]["municipal"]["2025"]["cleaning"]
    assert rep["rows_in"] == 2 and rep["rows_out"] == 2
    fetched = store.manifest()["datasets"]["municipal"]["2025"]["fetched_at"]
    (tmp_path / "parquet/municipal/2025.parquet").unlink()
    assert store.rebuild()["municipal"] == {2025: "rebuilt"}
    assert len(store.load("municipal")) == 2
    assert store.manifest()["datasets"]["municipal"]["2025"]["fetched_at"] == fetched

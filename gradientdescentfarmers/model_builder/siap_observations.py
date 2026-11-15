"""Observed municipal SIAP history, separate from WOFOST model projections."""

from __future__ import annotations

from collections.abc import Sequence
import unicodedata

import pandas as pd

from .price_forecasting import SIAP_PREFIX


def _key(value: object) -> str:
    normalized = unicodedata.normalize("NFKD", str(value).strip().casefold())
    return "".join(char for char in normalized if not unicodedata.combining(char))


def load_municipal_siap_observations(
    client: object, *, municipality: str, state: str,
    years: Sequence[int] = tuple(range(2003, 2026)),
    selected_products: Sequence[str] | None = None,
    prefix: str = SIAP_PREFIX,
) -> pd.DataFrame:
    """Return every matching SIAP row; None selects all municipal crop labels.

    ``selected_products`` uses exact SIAP crop labels such as ``Maíz grano``.
    This table contains observed municipal aggregates, not field rotations or
    WOFOST simulations. Prices are nominal MXN per tonne when volume is positive.
    """
    if not years or len(set(years)) != len(years):
        raise ValueError("years must be a nonempty sequence without duplicates")
    selected = None
    if selected_products is not None:
        if isinstance(selected_products, str) or not selected_products:
            raise ValueError("selected_products must be None or a nonempty list of SIAP crop labels")
        selected = {_key(label) for label in selected_products}
        if len(selected) != len(selected_products):
            raise ValueError("selected_products contains duplicate labels")

    frames = []
    for year in sorted(years):
        uri = f"{prefix}/Cierre_agricola_mun_{year}.csv"
        data = client.read_frame(uri).copy()
        data.columns = [str(column).strip().casefold() for column in data.columns]
        if "nomcultivo sin um" in data:
            if "nomcultivo" in data:
                data["nomcultivo"] = data["nomcultivo"].fillna(data["nomcultivo sin um"])
            else:
                data = data.rename(columns={"nomcultivo sin um": "nomcultivo"})
        required = {
            "anio", "nomestado", "nommunicipio", "nomcultivo", "nomunidad",
            "nomcicloproductivo", "nommodalidad", "sembrada", "cosechada",
            "volumenproduccion", "valorproduccion",
        }
        missing = required - set(data)
        if missing:
            raise ValueError(f"SIAP file {year} is missing columns: {sorted(missing)}")
        data = data[
            data.nomestado.map(_key).eq(_key(state))
            & data.nommunicipio.map(_key).eq(_key(municipality))
        ].copy()
        if selected is not None:
            data = data[data.nomcultivo.map(_key).isin(selected)].copy()
        if data.empty:
            continue
        if not pd.to_numeric(data.anio, errors="raise").eq(year).all():
            raise ValueError(f"SIAP file year differs from its URI: {uri}")
        numeric_columns = (
            "sembrada", "cosechada", "siniestrada", "volumenproduccion",
            "valorproduccion", "preciomediorural",
        )
        for column in numeric_columns:
            if column in data:
                data[column] = pd.to_numeric(data[column], errors="raise")
        tonnes = data.nomunidad.map(_key).isin(("tonelada", "toneladas", "ton", "t"))
        observed_price = data.valorproduccion.div(data.volumenproduccion.where(data.volumenproduccion.gt(0)))
        observed_yield = data.volumenproduccion.div(data.sembrada.where(data.sembrada.gt(0)))
        part = pd.DataFrame({
            "year": year,
            "state": data.nomestado,
            "municipality": data.nommunicipio,
            "crop_label": data.nomcultivo,
            "siap_crop_id": data.get("idcultivo"),
            "production_cycle": data.nomcicloproductivo,
            "water_modality": data.nommodalidad,
            "unit": data.nomunidad,
            "sown_ha": data.sembrada,
            "harvested_ha": data.cosechada,
            "lost_ha": data.get("siniestrada"),
            "production_t": data.volumenproduccion.where(tonnes),
            "production_value_mxn": data.valorproduccion,
            "observed_yield_t_ha": observed_yield.where(tonnes),
            "observed_price_mxn_t": observed_price.where(tonnes),
            "reported_rural_price_mxn_t": data.get("preciomediorural"),
            "data_origin": "SIAP_OBSERVED",
            "is_wofost_simulation": False,
            "source_uri": uri,
        })
        frames.append(part)
    if not frames:
        raise ValueError("No SIAP observations match the municipality and selected products")
    records = [record for frame in frames for record in frame.to_dict(orient="records")]
    result = pd.DataFrame.from_records(records, columns=frames[0].columns)
    return result.sort_values(
        ["year", "crop_label", "production_cycle", "water_modality"],
        kind="stable",
    ).reset_index(drop=True)

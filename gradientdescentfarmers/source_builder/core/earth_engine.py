"""Optional Google Earth Engine alternatives from notebook sections 7, 9, 11–13.

Requires explicit source_overrides / EE_PROJECT_ID. Fallbacks are never silently
used for unavailable default products: their QA differs from ORNL.
"""
from __future__ import annotations
import os
import pandas as pd
from .providers import ProviderContext, ProviderPayload


def _ee(ctx):
    import ee
    project=ctx.settings.ee_project or os.getenv("EE_PROJECT_ID")
    if not project:
        raise RuntimeError("EE_PROJECT_ID is required for Earth Engine sources")
    ee.Initialize(project=project)
    return ee


def _point(ctx, collection, bands, start, end, scale, limit=300, predicates=None):
    ee=_ee(ctx)
    coll=ee.ImageCollection(collection).filterBounds(ee.Geometry.Point([ctx.farmer.longitude,ctx.farmer.latitude]))
    coll=coll.filterDate(str(start),str(end))
    for attr,value in (predicates or {}).items():
        coll=coll.filter(ee.Filter.eq(attr,value))
    coll=coll.select(bands)
    if coll.size().getInfo()>limit:
        raise RuntimeError(f"Earth Engine query exceeds {limit} images; narrow time window")
    raw=coll.getRegion(ee.Geometry.Point([ctx.farmer.longitude,ctx.farmer.latitude]),scale).getInfo()
    if not raw or len(raw)<2:
        raise ValueError(f"empty Earth Engine collection {collection}")
    frame=pd.DataFrame(raw[1:],columns=raw[0])
    frame["date"]=pd.to_datetime(frame["time"],unit="ms",utc=True)
    frame["farm_id"]=ctx.farmer.farm_id
    return frame


def get_grace(ctx):
    collection="NASA/GRACE/MASS_GRIDS_V04/MASCON"
    ee=_ee(ctx)
    first=ee.ImageCollection(collection).first()
    band_names=first.bandNames().getInfo()
    lwe=[b for b in band_names if "lwe" in b.lower() or "liquid" in b.lower()]
    if not lwe:
        raise ValueError("GRACE LWE bands not found: inspect collection documentation")
    frame=_point(ctx,collection,lwe[:2],"2019-01-01","2024-10-01",50000,limit=100)
    return ProviderPayload(tables={"regional_water_storage":frame}, source_url=collection,
       spatial_resolution="regional mascon, not point-scale",temporal_resolution="monthly",
       warnings=["LWE units and baseline must be interpreted by selected band metadata"])


def get_cmip(ctx):
    cfg=ctx.settings
    frame=_point(ctx,"NASA/GDDP-CMIP6",["pr","tasmin","tasmax"],cfg.cmip_start,cfg.cmip_end,27830,
                 limit=300,predicates={"model":cfg.cmip_model,"scenario":cfg.cmip_scenario})
    for col in ("pr","tasmin","tasmax"):
        frame[col]=pd.to_numeric(frame[col],errors="coerce")
    frame["precip_mm_day"]=frame["pr"]*86400
    frame["tmin_c"]=frame["tasmin"]-273.15
    frame["tmax_c"]=frame["tasmax"]-273.15
    frame["model"]=cfg.cmip_model
    frame["scenario"]=cfg.cmip_scenario
    return ProviderPayload(tables={"climate_projections":frame[["date","farm_id","model","scenario","precip_mm_day","tmin_c","tmax_c"]]},
       source_url="NASA/GDDP-CMIP6",spatial_resolution="~0.25°",temporal_resolution="daily",
       units={"precip_mm_day":"mm/day","tmin_c":"°C","tmax_c":"°C"},
       warnings=["Scenario projection, NOT a weather forecast; one model/month is not climate robustness"])


def get_landcover(ctx):
    frame=_point(ctx,"MODIS/061/MCD12Q1",["LC_Type1"],"2022-01-01","2023-01-01",500,limit=2)
    return ProviderPayload(tables={"landcover":frame[["date","farm_id","LC_Type1"]]},
       source_url="MODIS/061/MCD12Q1",spatial_resolution="500m",temporal_resolution="annual",
       units={"LC_Type1":"IGBP class code"},
       warnings=["2022 reference year fixed as in notebook; does not identify crop species"])


def get_ee_modis(ctx, product: str):
    """Explicit Earth Engine MODIS 061 source, preserving raw QA and native scales.

    The existing ORNL preprocessing/validation pipeline handles the raw bands,
    which avoids double-scaling and retains observation-level QA diagnostics.
    No fallback is selected automatically.
    """
    spec = {
        "MOD13Q1": ("MODIS/061/MOD13Q1",
            ["NDVI", "EVI", "DetailedQA", "SummaryQA"], 250,
            {"NDVI": "250m_16_days_NDVI", "EVI": "250m_16_days_EVI",
             "DetailedQA": "250m_16_days_VI_Quality",
             "SummaryQA": "250m_16_days_pixel_reliability"},
            "vegetation_timeseries", "16d"),
        "MOD11A2": ("MODIS/061/MOD11A2",
            ["LST_Day_1km", "LST_Night_1km", "QC_Day", "QC_Night"], 1000,
            {}, "land_surface_temperature", "8d"),
        "MOD16A2GF": ("MODIS/061/MOD16A2GF",
            ["ET", "PET", "ET_QC"], 500,
            {"ET": "ET_500m", "PET": "PET_500m", "ET_QC": "ET_QC_500m"},
            "evapotranspiration", "8d"),
    }
    if product not in spec:
        raise ValueError(f"unknown Earth Engine MODIS product: {product}")
    collection, bands, scale, mapping, name, temporal = spec[product]
    frame = _point(ctx, collection, bands, ctx.settings.modis_start,
                   ctx.settings.modis_end, scale, limit=300)
    frame = frame.rename(columns=mapping)
    frame["date"] = pd.to_datetime(frame["date"], utc=True)
    frame["modis_date"] = frame["date"].dt.strftime("A%Y%j")
    if frame.modis_date.duplicated().any():
        raise ValueError("duplicate MODIS composite acquisition timestamps")
    frame = frame.drop(columns=["time", "id", "longitude", "latitude"], errors="ignore")
    if frame.empty:
        raise ValueError(f"Earth Engine MODIS {product} returned no rows")
    return ProviderPayload(
        tables={name: frame},
        source_url=f"https://developers.google.com/earth-engine/datasets/catalog/{collection.replace('/', '_')}",
        spatial_resolution=f"{scale}m",
        temporal_resolution=temporal,
        provenance={
            "provider": "Google Earth Engine", "collection": collection,
            "raw_bands": bands, "pixel_scale_m": scale,
            "qa_method": "Preserved raw QA bitfields; standardize_modXX handles masks and scales",
            "not_equivalent_to_ornl_pixel": True,
            "coordinate": [ctx.farmer.longitude, ctx.farmer.latitude],
        },
        warnings=["Earth Engine point sampling and ORNL subset may select different "
                  "pixels/projections; do not assume pixel-level equivalence"],
    )


OPTIONAL_FUNCTIONS={
  "gpm_imerg_v07":None, "smap_l4":None, # Bound lazily in builder to avoid earthaccess import at startup
  "grace_fo_mascon":get_grace,
  "nex_gddp_cmip6":get_cmip,
  "modis_landcover":get_landcover,
}

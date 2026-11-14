"""Source registry and reproducible run configuration.

'Provider default' and 'enabled by default' are separate concepts. GEE is a
registered fallback but no automatic silent change of scientific product is made.
"""
from __future__ import annotations
from datetime import date
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict, model_validator

SOURCE_TABLES = {
    "nasa_power": ["weather_daily"],
    "srtm": ["topography_samples"],
    "soilgrids_wcs": ["soil_properties_raw"],
    "modis_mod13q1": ["vegetation_timeseries"],
    "modis_mod11a2": ["land_surface_temperature"],
    "modis_mod16a2gf": ["evapotranspiration"],
    "gpm_imerg_v07": ["gpm_half_hourly", "gpm_daily"],
    "smap_l4": ["soil_moisture_timeseries"],
    "worldbank_agriculture": ["country_agriculture_context"],
    "usda_quickstats": ["usda_iowa_yield"],
    "faostat_production": ["faostat_production"],
    "faostat_prices": ["faostat_prices"],
    "grace_fo_mascon": ["regional_water_storage"],
    "nex_gddp_cmip6": ["climate_projections"],
    "modis_landcover": ["landcover"],
}
# Consistent identifiers, including optional external/local data in final report.
EXTRA_SOURCES = (
    "farmer_crop_history", "farmer_soil_tests", "validated_crop_parameters",
    "local_crop_prices", "local_soil_lab", "management_history"
)
CORE = {"nasa_power", "srtm", "soilgrids_wcs", "modis_mod13q1", "modis_mod11a2", "modis_mod16a2gf", "worldbank_agriculture"}
ADVANCED = CORE | {"gpm_imerg_v07", "smap_l4"}
PROVIDERS = {
    "nasa_power": "NASA POWER API", "srtm": "OpenTopoData SRTM30m",
    "soilgrids_wcs": "ISRIC SoilGrids WCS",
    "modis_mod13q1": "NASA ORNL DAAC MOD13Q1",
    "modis_mod11a2": "NASA ORNL DAAC MOD11A2",
    "modis_mod16a2gf": "NASA ORNL DAAC MOD16A2GF",
    "gpm_imerg_v07": "NASA GES DISC Earthdata GPM_3IMERGHH v07",
    "smap_l4": "NASA NSIDC Earthdata SPL4SMGP v008",
    "worldbank_agriculture": "World Bank public API",
    "usda_quickstats": "USDA QuickStats API key",
    "faostat_production": "FAOSTAT JWT", "faostat_prices": "FAOSTAT JWT",
    "grace_fo_mascon": "Google Earth Engine NASA/GRACE",
    "nex_gddp_cmip6": "Google Earth Engine NASA/GDDP-CMIP6",
    "modis_landcover": "Google Earth Engine MODIS MCD12Q1",
}
ALTERNATIVES = {
    "modis_mod13q1": ["earth_engine_modis_mod13q1"],
    "modis_mod11a2": ["earth_engine_modis_mod11a2"],
    "modis_mod16a2gf": ["earth_engine_modis_mod16a2gf"],
    "gpm_imerg_v07": ["earth_engine_gpm_imerg"],
    "smap_l4": ["earthdata_harmony_smap_subsets"],
}

class BuilderSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    output_root: Path = Path("./data/farmadapt_v2")
    cache_root: Path = Path("./data/farmadapt_v2/cache")
    cache_enabled: bool = True
    cache_ttl_hours: int = Field(default=168, ge=0)
    http_timeout_s: int = Field(default=45, ge=5, le=300)
    retries: int = Field(default=2, ge=0, le=8)
    max_workers: int = Field(default=3, ge=1, le=12)
    weather_start: date = date(2024, 1, 1)
    weather_end: date = date(2025, 12, 31)
    modis_start: date = date(2024, 1, 1)
    modis_end: date = date(2025, 12, 31)
    modis_provider: str = Field(default="ornl", pattern=r"^(ornl|earthaccess)$")
    modis_max_granules: int = Field(default=3, ge=1, le=300)
    gpm_start: str = "2024-07-01T00:00:00"
    gpm_end: str = "2024-07-01T23:59:59"
    gpm_max_granules: int = Field(default=48, ge=1, le=1000)
    smap_start: str = "2024-01-01"
    smap_end: str = "2024-01-02"
    smap_max_granules: int = Field(default=2, ge=1, le=48)
    soil_scope: str = Field(default="pilot", pattern=r"^(pilot|full)$")
    soil_max_requests: int = Field(default=24, ge=1, le=500)
    cmip_start: date = date(2040, 1, 1)
    cmip_end: date = date(2040, 2, 1)
    cmip_model: str = "ACCESS-CM2"
    cmip_scenario: str = "ssp245"
    ee_project: str | None = None
    source_overrides: dict[str, bool] = Field(default_factory=dict)
    force_sources: bool = False
    input_files_root: Path = Path("./farm_inputs")
    export_format: str = Field(default="parquet", pattern=r"^(parquet|csv)$")
    dry_threshold_mm: float = Field(default=1., ge=0)
    heat_threshold_c: float = 35.
    frost_threshold_c: float = 0.
    gdd_base_c: float = 10.

    @model_validator(mode="after")
    def check_settings(self):
        if self.weather_start > self.weather_end or self.modis_start > self.modis_end:
            raise ValueError("invalid start/end dates")
        if self.cmip_start >= self.cmip_end:
            raise ValueError("invalid CMIP window")
        unknown = set(self.source_overrides) - set(SOURCE_TABLES)
        if unknown:
            raise ValueError(f"unknown source names: {sorted(unknown)}")
        return self

    def enabled(self, source: str, mode: str) -> bool:
        if source in self.source_overrides:
            return self.source_overrides[source]
        return source in (CORE if mode == "basic" else ADVANCED)

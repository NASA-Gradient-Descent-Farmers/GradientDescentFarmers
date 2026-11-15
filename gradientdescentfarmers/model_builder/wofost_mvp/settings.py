"""Explicit assumptions for a small, bounded crop-rotation experiment."""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

CROP_PARAMETER_COMMIT = "fc6eda46ea0081eb0ad31fa92ea49fea60e11075"
CROPS = {
    "wheat": {"label": "Trigo", "siap": "Trigo grano", "family": "Poaceae",
              "variety": "Winter_wheat_107", "season": "cool", "moisture": 0.13},
    "chickpea": {"label": "Garbanzo", "siap": "Garbanzo grano", "family": "Fabaceae",
                 "variety": "Chickpea_VanHeemst_1988", "season": "cool", "moisture": 0.12},
    "maize": {"label": "Maíz", "siap": "Maíz grano", "family": "Poaceae",
              "variety": "Maize_VanHeemst_1988", "season": "warm", "moisture": 0.14},
    "sorghum": {"label": "Sorgo", "siap": "Sorgo grano", "family": "Poaceae",
                "variety": "Sorghum_VanHeemst_1988", "season": "warm", "moisture": 0.14},
}


class ModelSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    crop_parameter_commit: str = Field(default=CROP_PARAMETER_COMMIT, pattern=r"^[a-f0-9]{40}$")
    crops: list[str] = Field(default_factory=lambda: list(CROPS))
    horizon_years: int = Field(default=2, ge=1, le=2)
    max_campaigns: int | None = Field(default=None, ge=1, le=4)
    allow_fallow: bool = True
    rootable_depth_cm: float = Field(default=100, ge=30, le=200)
    initial_available_water_fraction: float = Field(default=0.6, ge=0, le=1)
    soil_percolation_cm_day: float = Field(default=2.0, gt=0, le=50)
    subsoil_drainage_cm_day: float = Field(default=2.0, gt=0, le=50)
    irrigation_efficiency: float = Field(default=0.75, gt=0, le=1)
    irrigation_depletion_fraction: float = Field(default=0.5, gt=0, lt=1)
    irrigation_max_event_mm: float = Field(default=50, gt=0, le=150)
    min_planted_campaigns: int = Field(default=2, ge=1, le=4)
    siap_years: list[int] = Field(default_factory=lambda: [2021, 2022, 2023, 2024, 2025])
    minimum_price_years: int = Field(default=3, ge=1, le=10)
    state_id_hint: str | None = Field(default=None, pattern=r"^\d{2}$")
    water_regimes: list[str] = Field(default_factory=lambda: ["rainfed", "irrigated"])

    def validated_catalog(self):
        if not self.crops or len(set(self.crops)) != len(self.crops) or set(self.crops) - set(CROPS):
            raise ValueError("Choose unique crops from wheat, chickpea, maize, sorghum")
        if not self.water_regimes or len(set(self.water_regimes)) != len(self.water_regimes) or set(self.water_regimes) - {"rainfed", "irrigated"}:
            raise ValueError("water_regimes must contain rainfed and/or irrigated")
        if self.min_planted_campaigns > 2 * self.horizon_years:
            raise ValueError("min_planted_campaigns exceeds the planning horizon")
        if not self.siap_years or any(year < 2003 or year > 2025 for year in self.siap_years):
            raise ValueError("This version supports SIAP municipal years 2003–2025")
        return self

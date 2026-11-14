"""FarmProfileBuilder: input -> retrieval -> preprocessing -> validation ->
feature engineering -> readiness -> atomic export.

No dependency on the repository's legacy src/ tree, crop model or frontend.
A partial build is a supported outcome; no fake environmental or economic data.
"""
from __future__ import annotations
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable
from time import perf_counter
import hashlib
import json
import os
import uuid
import math
import pandas as pd
import numpy as np

from .schema import FarmerInput, FarmProfile, SourceRecord, SourceStatus, TableRecord
from .settings import BuilderSettings, SOURCE_TABLES, EXTRA_SOURCES, PROVIDERS, ALTERNATIVES
from .transport import CachedHTTP
from .providers import DEFAULT_FUNCTIONS, ProviderPayload, ProviderContext
from .preprocessing import TRANSFORMERS, farmer_tables, schema_only_tables
from .validation import validate_table, combined_source_status
from .features import weather_features, model_readiness


def _utcnow():
    return datetime.now(timezone.utc)


def _safe_error(ex:Exception):
    message=f"{type(ex).__name__}: {ex}"
    for key in ("USDA_NASS_API_KEY","FAOSTAT_JWT","EARTHDATA_PASSWORD","EARTHDATA_USERNAME"):
        secret=os.getenv(key)
        if secret: message=message.replace(secret,"[REDACTED]")
    return message[:400]


def _metadata_defaults(source):
    return {"provider":PROVIDERS.get(source,source), "alternatives":ALTERNATIVES.get(source,[])}


class FarmProfileBuilder:
    """Independent, repeatable data-collection orchestrator.

    Constructor input is a validated FarmerInput or JSON-like dict. Public phases:
    data_retrieval(), data_preprocessing(), data_validation(),
    feature_engineering(), build(), export(). Tests may inject providers that
    accept ProviderContext, eliminating network dependencies.

    'Build complete' means all enabled sources with validated usable records;
    it does NOT certify agronomic model validation.
    """
    def __init__(self, farmer_input: FarmerInput | dict[str,Any],
                 settings: BuilderSettings | dict[str,Any] | None=None,
                 providers: dict[str,Callable[[ProviderContext],ProviderPayload]] | None=None):
        self.farmer = farmer_input if isinstance(farmer_input,FarmerInput) else FarmerInput.model_validate(farmer_input)
        self.settings = (settings if isinstance(settings, BuilderSettings)
                         else BuilderSettings.model_validate(settings or {}))
        self.run_id = uuid.uuid4().hex[:16]
        self.run_dir = self.settings.output_root / self.farmer.farm_id / "runs" / self.run_id
        self.http=CachedHTTP(self.settings.cache_root,self.settings.http_timeout_s,self.settings.retries,
                             self.settings.cache_enabled,self.settings.cache_ttl_hours)
        funcs=dict(DEFAULT_FUNCTIONS)
        # Optional dependencies are imported only when explicitly enabled.
        from .earthdata import get_gpm, get_smap
        from .earth_engine import get_grace, get_cmip, get_landcover
        funcs.update({"gpm_imerg_v07":get_gpm,"smap_l4":get_smap,"grace_fo_mascon":get_grace,
                      "nex_gddp_cmip6":get_cmip,"modis_landcover":get_landcover})
        if providers:
            unknown=set(providers)-set(SOURCE_TABLES)
            if unknown: raise ValueError(f"unknown injected provider(s): {sorted(unknown)}")
            funcs.update(providers)
        self.providers=funcs
        self._reset()

    def _reset(self):
        self.raw:dict[str,ProviderPayload]={}
        self.tables:dict[str,pd.DataFrame]={}
        self.source_status:dict[str,SourceRecord]={}
        self.table_validation:dict[str,dict[str,Any]]={}
        self.provenance:dict[str,dict[str,Any]]={}
        self.table_source:dict[str,str]={}
        self.table_units:dict[str,dict[str,str]]={}
        self.table_temporal:dict[str,str|None]={}
        self.table_spatial:dict[str,str|None]={}
        self.topography={}
        self.features={}
        self.profile:FarmProfile|None=None

    def _add_table(self,name,frame,source,units=None,temporal=None,spatial=None,provenance=None):
        if not isinstance(frame,pd.DataFrame):
            raise TypeError(f"table {name} must be a pandas DataFrame")
        if name in self.tables:
            raise ValueError(f"duplicate output table name: {name}")
        self.tables[name]=frame.copy()
        self.table_source[name]=source
        self.table_units[name]=units or {}
        self.table_temporal[name]=temporal
        self.table_spatial[name]=spatial
        if provenance is not None:
            self.provenance[name]=provenance

    def data_retrieval(self):
        """Retrieve each enabled source with failure isolation and traceable timing."""
        context=ProviderContext(self.farmer,self.settings,self.http,self.run_dir)
        for source in SOURCE_TABLES:
            enabled=self.settings.enabled(source,self.farmer.mode)
            base=_metadata_defaults(source)
            record=SourceRecord(source=source,provider=base["provider"],enabled=enabled,
                                status=SourceStatus.NOT_REQUESTED if not enabled else SourceStatus.MISSING,
                                alternative_providers=base["alternatives"])
            if not enabled:
                self.source_status[source]=record
                continue
            start=perf_counter()
            record.started_utc=_utcnow()
            try:
                result=self.providers[source](context)
                if not isinstance(result,ProviderPayload):
                    raise TypeError(f"provider {source} returned {type(result).__name__}, not ProviderPayload")
                expected=set(SOURCE_TABLES[source])
                if not set(result.tables).issubset(expected):
                    raise ValueError(f"provider {source} returned unexpected table names")
                self.raw[source]=result
                record.tables=list(result.tables)
                record.rows=sum(len(v) for v in result.tables.values())
                record.spatial_resolution=result.spatial_resolution
                record.temporal_resolution=result.temporal_resolution
                record.units=result.units
                record.source_url=result.source_url
                record.warnings.extend(result.warnings)
                record.used_cache=(self.http.cache_hits>0)
                record.status=SourceStatus.AVAILABLE if record.rows else SourceStatus.MISSING
            except Exception as exc:
                record.status=SourceStatus.ERROR
                record.error=_safe_error(exc)
            finally:
                record.duration_s=round(perf_counter()-start,3)
                record.finished_utc=_utcnow()
                self.source_status[source]=record
        return self.raw

    def _local_inputs(self):
        """Notebook sections 13–15, optional expert/farmer CSVs and placeholder schemas."""
        for name,frame in farmer_tables(self.farmer).items():
            self._add_table(name,frame,"farmer",provenance={"method":"farmer_reported"})
        for name,frame in schema_only_tables(self.farmer).items():
            self._add_table(name,frame,"schema_only",provenance={"validated":False,"purpose":"requirements; not model-ready"})
        known={"validated_crop_parameters":"crop_parameters.csv", "local_crop_prices":"local_prices.csv",
               "local_soil_lab":"soil_lab.csv","management_history":"management_history.csv"}
        for name,file in known.items():
            path=self.settings.input_files_root/file
            if not path.is_file(): continue
            try:
                frame=pd.read_csv(path)
                if frame.empty:raise ValueError("empty CSV")
                self._add_table(name,frame,"user_csv",provenance={"path":str(path),"not_verified":True})
            except Exception as exc:
                self.source_status[name]=SourceRecord(source=name,provider="user CSV",status=SourceStatus.ERROR,
                               enabled=True,error=_safe_error(exc))

    def data_preprocessing(self):
        """Normalize raw provider tables to notebook-compatible names/units."""
        for source,payload in self.raw.items():
            record=self.source_status[source]
            try:
                for table,raw in payload.tables.items():
                    df=TRANSFORMERS[source][1](raw) if source in TRANSFORMERS else raw.copy()
                    if df.empty:
                        record.warnings.append(f"empty table: {table}")
                    self._add_table(table,df,source,payload.units,payload.temporal_resolution,
                                    payload.spatial_resolution, payload.provenance)
                if source=="srtm": self.topography=payload.extra.get("topography",{})
            except Exception as ex:
                record.status=SourceStatus.ERROR
                record.error=_safe_error(ex)
                # Retain unrelated tables, discard only those registered by broken provider.
                for table in payload.tables:
                    if self.table_source.get(table)==source:
                        self.tables.pop(table,None)
                        self.table_source.pop(table,None)
        self._local_inputs()
        return self.tables

    def data_validation(self):
        """Scientific QA & coverage, independent of download success.

        Source failures are never promoted to available by metadata alone.
        """
        for table,frame in self.tables.items():
            try:
                result=validate_table(table,frame)
                self.table_validation[table]=result.as_dict()
            except Exception as ex:
                self.table_validation[table]={"passed":False,"usable_rows":0,"coverage":None,
                    "checks":[],"error":_safe_error(ex)}
        for source,record in self.source_status.items():
            if source not in SOURCE_TABLES or not record.enabled or record.status==SourceStatus.ERROR:
                continue
            frames={t:self.tables[t] for t in SOURCE_TABLES[source] if t in self.tables}
            from .validation import ValidationResult,DataCheck
            results={}
            for name in frames:
                result=self.table_validation[name]
                check=ValidationResult(checks=[DataCheck(c["name"],c["passed"],c.get("severity","error"),c.get("detail",""))
                   for c in result.get("checks",[])],coverage=result.get("coverage"),usable_rows=result.get("usable_rows",0))
                results[name]=check
            record.quality={n:self.table_validation[n] for n in frames}
            record.coverage=min((r.coverage for r in results.values() if r.coverage is not None),default=None)
            record.status=combined_source_status(results,frames,record.warnings)
        for name in EXTRA_SOURCES:
            if name in self.source_status: continue
            map_names={"farmer_crop_history":"crop_plantings","farmer_soil_tests":"farmer_soil_tests",
              "validated_crop_parameters":"validated_crop_parameters","local_crop_prices":"local_crop_prices",
              "local_soil_lab":"local_soil_lab","management_history":"management_history"}
            table=map_names[name]
            available=table in self.tables and not self.tables[table].empty
            status=SourceStatus.AVAILABLE if available else (
                SourceStatus.MISSING if name in {"validated_crop_parameters","local_crop_prices"} else SourceStatus.NOT_REQUESTED)
            self.source_status[name]=SourceRecord(source=name,provider="farmer / expert",enabled=available,
                  status=status,rows=len(self.tables.get(table,[])),tables=[table] if available else [])
        return self.table_validation

    def feature_engineering(self):
        """Derive bounded, documented climate indicators and technical readiness."""
        weather=self.tables.get("weather_daily")
        checks=self.table_validation.get("weather_daily",{})
        if weather is not None and not weather.empty and checks.get("passed"):
            ann,mon,params=weather_features(weather,self.settings)
            self._add_table("climate_annual_features",ann,"derived:nasa_power",temporal="annual",
                 provenance={"method":"weather_features","parameters":params})
            self._add_table("climate_monthly_features",mon,"derived:nasa_power",temporal="monthly",
                 provenance={"method":"weather_features","parameters":params})
            self.features["climate_thresholds"]=params
            for name in ("climate_annual_features","climate_monthly_features"):
                self.table_validation[name]=validate_table(name,self.tables[name]).as_dict()
        self.features["source_summary"]={s.value:sum(1 for x in self.source_status.values() if x.status==s)
                                           for s in SourceStatus}
        return self.features

    def build(self, *, export:bool=False):
        """Build full FarmProfile. Re-entrant and idempotent at output path."""
        self._reset()
        self.data_retrieval()
        self.data_preprocessing()
        self.data_validation()
        self.feature_engineering()
        records={name:TableRecord(name=name,rows=len(frame),columns=list(map(str,frame.columns)),
              source=self.table_source[name],units=self.table_units.get(name,{}),
              temporal_resolution=self.table_temporal.get(name),spatial_resolution=self.table_spatial.get(name),
              validation=self.table_validation.get(name,{})) for name,frame in self.tables.items()}
        readiness=model_readiness(self.tables,self.table_validation)
        enabled=[s for s in self.source_status.values() if s.enabled and s.source in SOURCE_TABLES]
        build_state="complete" if enabled and all(s.status==SourceStatus.AVAILABLE for s in enabled) else "partial"
        if not any(x.status in (SourceStatus.AVAILABLE,SourceStatus.PARTIAL) for x in enabled):
            build_state="failed"
        self.profile=FarmProfile(farmer_inputs=self.farmer,source_status=self.source_status,
           tables=records,topography=self.topography,features=self.features,provenance=self.provenance,
           model_readiness=readiness,build_state=build_state,run_id=self.run_id,
           limitations=["Decision support prototype; not field-validated crop advice",
              "Coarse-grained satellite/model data do not measure individual fields",
              "No missing crop parameters, farmer costs or market prices are silently imputed",
              "A generated profile is NOT a WOFOST/NSGA result",
              "Intercropping supported by input schema, but NOT simulated or certified by this builder"])
        if export:self.export()
        return self.profile

    def export(self,root:Path|None=None):
        """Write tables and manifest atomically with verified relative paths/hashes."""
        if not self.profile:raise RuntimeError("Call build() before export()")
        target=Path(root) if root is not None else self.run_dir
        standardized=target/"standardized"
        standardized.mkdir(parents=True,exist_ok=True)
        for name,df in self.tables.items():
            fmt=self.settings.export_format
            path=standardized/f"{name}.{fmt}"
            temp=standardized/f".{name}.{os.getpid()}.{uuid.uuid4().hex[:8]}.{fmt}"
            try:
                if fmt=="parquet":
                    df.to_parquet(temp,index=False)
                else:
                    df.to_csv(temp,index=False)
            except ImportError:
                if fmt != "parquet":raise
                fmt="csv"
                path=standardized/f"{name}.csv"
                temp=standardized/f".{name}.{uuid.uuid4().hex[:8]}.csv"
                df.to_csv(temp,index=False)
            temp.replace(path)
            table=self.profile.tables[name]
            table.format=fmt
            table.relative_path=str(path.relative_to(target))
            table.sha256=hashlib.sha256(path.read_bytes()).hexdigest()
        self._atomic_json(target/"farm_profile.json",self.profile.model_dump(mode="json"))
        self._atomic_json(target/"availability.json",{k:v.model_dump(mode="json") for k,v in self.source_status.items()})
        self._atomic_json(target/"model_readiness.json",self.profile.model_readiness)
        self._atomic_json(target/"provenance.json",self.provenance)
        self._atomic_json(target/"validation.json",self.table_validation)
        pd.DataFrame([v.model_dump(mode="json",exclude={"quality"}) for v in self.source_status.values()]).to_csv(
            target/"feature_catalog.csv",index=False)
        # The pointer is written only for the standard run directory. It is a
        # convenience index, not a substitute for the versioned manifest.
        if target.resolve() == self.run_dir.resolve():
            self._atomic_json(self.settings.output_root/self.farmer.farm_id/"latest.json",
                              {"farm_id":self.farmer.farm_id,"run_id":self.run_id,
                               "relative_path":f"runs/{self.run_id}"})
        return target

    @staticmethod
    def _atomic_json(path: Path, payload: Any):
        """Export valid JSON atomically, replacing non-finite values with null."""

        def make_json_safe(value):
            # Dictionaries
            if isinstance(value, dict):
                return {
                    str(k): make_json_safe(v)
                    for k, v in value.items()
                }

            # Lists and tuples
            if isinstance(value, (list, tuple)):
                return [make_json_safe(v) for v in value]

            # NumPy scalars
            if isinstance(value, np.generic):
                return make_json_safe(value.item())

            # Missing pandas values
            if value is pd.NA or value is pd.NaT:
                return None

            # Non-finite floating-point numbers
            if isinstance(value, float):
                return value if math.isfinite(value) else None

            return value

        path.parent.mkdir(parents=True, exist_ok=True)

        temp = path.with_suffix(path.suffix + ".tmp")

        clean_payload = make_json_safe(payload)

        temp.write_text(
            json.dumps(
                clean_payload,
                indent=2,
                ensure_ascii=False,
                allow_nan=False,
                default=str,
            ),
            encoding="utf-8",
        )

        temp.replace(path)

    def availability_report(self):
        return pd.DataFrame([r.model_dump(mode="json",exclude={"quality"}) for r in self.source_status.values()])

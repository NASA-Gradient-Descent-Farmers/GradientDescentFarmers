# Entrega de datos para PCSE / WOFOST — Guanajuato

**Proyecto:** GradientDescentFarmers / FarmAdapt · **Módulo:** `gradientdescentfarmers/source_builder/`  
**Farm ID:** `guanajuato_valle_demo` · **Punto de referencia:** 20.4243195, -101.1466639 (Guanajuato, México)  
**Contrato:** `FarmProfile` versión 2.0.0, con `run_id`, tablas separadas, QA, unidades, procedencia y SHA-256.  
**Estado (2026-11-14):** run integral `67b66942681a4214` ejecutado y auditado: integridad y QA ambiental aprobadas. `build_state=partial` conserva faltantes de QA en MODIS; los calendarios están completos y no hay fuentes habilitadas con error. La preparación de entradas PCSE sigue a cargo del equipo WOFOST.

> **Importante:** Guanajuato es una ubicación de referencia, no una parcela georreferenciada. El campo de **1 ha es un placeholder sintético** requerido por el esquema. No hay especie, variedad, fecha de siembra, rendimiento, riego ni costos observados que podamos afirmar como datos reales.

## 1. Resumen para el equipo WOFOST

**Pueden empezar desde ahora:** crear un adaptador meteorológico de `weather_daily` a un `WeatherDataProvider` de PCSE, diseñar `CropParameterSet`, `SoilSiteParameterSet` y `AgroManagementPlan`, y ejecutar una simulación PP **experimental** con un ejemplo documentado de PCSE.

**No pueden asumir todavía:** que las tablas de SoilGrids son parámetros hidráulicos listos para WOFOST WLP; que los datos MODIS sustituyen `ET0` meteorológica; que el catálogo de requisitos de cultivos contiene parámetros calibrados; o que ya existe una recomendación de rendimiento/rentabilidad validada.

Para una primera ejecución WOFOST hay que **fijar versión de PCSE, modelo PP/WLP, cultivo/variedad, sitio, agromanagement, y un run_id específico del clima**. Consultar [PCSE Reference Guide](https://pcse.readthedocs.io/en/stable/reference_guide.html) y [PCSE Code Documentation](https://pcse.readthedocs.io/en/stable/code.html).

## 2. Arquitectura completa de SourceBuilder

```text
resources/guanajuato_reference.json       [FarmerInput: lugar, datos aportados]
resources/guanajuato_integrated.json      [config.source: qué proveedores ejecutar]
resources/guanajuato_integrated_settings.json
               │
               ▼
gradientdescentfarmers/source_builder/adapter.py
  NASAProfileSourceBuilder(SourceBuilder).build(config)
               │
               ▼
gradientdescentfarmers/source_builder/core/builder.py
  FarmProfileBuilder
    1. data_retrieval()          NASA POWER, SRTM, SoilGrids, MODIS, GPM, SMAP, WB
    2. data_preprocessing()      estandarización de tablas, unidades y bits QA
    3. data_validation()         rangos, duplicados, integridad, cobertura QA
    4. feature_engineering()     GDD, lluvia, sequías, calor/heladas por período
    5. build(export=True)        CSV/Parquet + manifiestos versionados
               │
               ▼
data/integrated_guanajuato/guanajuato_valle_demo/
  ├── latest.json
  └── runs/<RUN_ID>/
       ├── farm_profile.json
       ├── availability.json
       ├── validation.json
       ├── provenance.json
       ├── model_readiness.json
       ├── feature_catalog.csv
       └── standardized/
            ├── weather_daily.csv
            ├── topography_samples.csv
            ├── soil_properties_raw.csv
            ├── vegetation_timeseries.csv
            ├── land_surface_temperature.csv
            ├── evapotranspiration.csv
            ├── gpm_half_hourly.csv
            ├── gpm_daily.csv
            ├── soil_moisture_timeseries.csv
            ├── country_agriculture_context.csv
            ├── climate_annual_features.csv
            ├── climate_monthly_features.csv
            ├── fields.csv
            └── ... (solamente tablas generadas)
               │
               ▼
core/audit.py → core/handoff.py → contrato para equipo model_builder
               │
               ▼
 PCSE Weather + Crop Parameters + Soil/Site + Agromanagement
               │
               ▼
          WOFOST PP → WLP (una especie/campaña primero)
```

Los nombres de archivos mostrados suponen `export_format="csv"`, como en las configuraciones de Guanajuato. **Las tablas solo existen si su fuente pudo procesarse**. Consultar `farm_profile.json["tables"]` para obtener la ruta exacta, el formato y el hash. Las fuentes fallidas también quedan registradas en `availability.json`.

| Etapa | Código | Qué garantiza y qué NO garantiza |
|---|---|---|
| Adquisición | `core/providers.py`, `core/modis_earthaccess.py`, `core/earthdata.py`, `core/earthdata_recovery.py` | Solicitudes con límites y caché; fallos por fuente quedan registrados, no se fabrican observaciones |
| Preprocesamiento | `core/preprocessing.py` | Convierte MODIS a NDVI/EVI/LST/ET, interpreta bits QA; preserva granularidad original |
| Validación | `core/validation.py` | QA estructural/físico por tabla; `coverage=1.0` puede corresponder a solo **dos compuestos** |
| Feature engineering | `core/features.py` | Resúmenes de clima a partir de POWER: no son datos de simulación nuevos |
| Exportación | `core/builder.py` y `core/schema.py` | Manifiestos, metadatos, hashes SHA-256, estado por proveedor, `run_id` |
| Control de entrega | `core/audit.py` y `core/handoff.py` | Integridad y cobertura meteorológica/ambiental; bloqueo explícito de WOFOST PP/WLP sin parámetros |

## 3. Catálogo de datos con ubicación y uso

La ruta de cada archivo es `<RUN_DIR>/standardized/<nombre>.csv`, a menos que el manifiesto indique Parquet.

| Fuente | Tabla | Ventana / resolución | Variables | Cómo usarla |
|---|---|---|---|---|
| **NASA POWER** | `weather_daily.csv` | Diaria 2024-01-01 a 2025-12-31, **731 días esperados** | `date`, `tmean_c`, `tmin_c`, `tmax_c`, `precip_mm`, `rh_pct`, `wind_m_s`, `solar_mj_m2_day`, `farm_id` | **Meteorología principal de WOFOST**, después del adaptador PCSE |
| **SRTM vía OpenTopoData** | `topography_samples.csv` | 5 puntos cercanos | `sample`, `lat`, `lon`, `elevation_m` | `farm_profile.json["topography"]["elevation_m"]` es la elevación central estimada; no es levantamiento de parcela |
| **SoilGrids WCS** | `soil_properties_raw.csv` | Modo piloto: 24 observaciones propiedad×profundidad | `property`, `depth`, `statistic`, `value`, `unit`, `coverage`, `raw_pixel` | Propiedades edáficas de referencia, **sin** proveedor hidráulico WOFOST completo |
| **MOD13Q1.061** | `vegetation_timeseries.csv` | Compuestos de ~16 días; objetivo 2024–2025 | `ndvi`, `evi`, `ndvi_qa`, `evi_qa`, `qa_pass` | Fenología/contraste de observaciones; no identifica cultivo |
| **MOD11A2.061** | `land_surface_temperature.csv` | Compuestos de ~8 días | `lst_day_c`, `lst_night_c`, `lst_day_qa_c`, `lst_night_qa_c` | Temperatura de **superficie**, no temperatura meteorológica del aire |
| **MOD16A2GF.061** | `evapotranspiration.csv` | Compuestos de ~8 días | `et_mm_period`, `pet_mm_period`, `et_qa_mm_day`, `pet_qa_mm_day`, `period_days` | Comparación ET/PET de teledetección, no `E0/ES0/ET0` PCSE |
| **GPM IMERG V07** | `gpm_half_hourly.csv` | 30 minutos del 2024-07-01 | `datetime_utc`, `precip_rate_mm_h`, `precip_30min_mm`, `source_file` | Lluvia extrema: una jornada completa requiere **48 horarios únicos UTC y 48 valores válidos** |
| **GPM agregado** | `gpm_daily.csv` | Solo 2024-07-01 | `date_utc`, `slots`, `valid_slots`, `exact_utc_half_hours`, `complete_48_slots`, `precip_total_mm` | Lluvia diaria **solo si** `complete_48_slots=True`; nunca completar huecos con ceros |
| **SMAP L4** | `soil_moisture_timeseries.csv` | Ventana corta 2024-07-01 a 2024-07-02, máximo 2 gránulos | `datetime_utc`, `soil_moisture_surface_m3_m3`, `soil_moisture_rootzone_m3_m3`, `soil_moisture_rootzone_percentile` | Contexto regional de ~9 km; no lectura en campo ni estado inicial confiable de WLP |
| **World Bank** | `country_agriculture_context.csv` | Nacional y anual | `year`, `indicator`, `value`, `unit` | Contexto agrícola nacional, **no** precio o rendimiento de Guanajuato |
| **Derivados POWER** | `climate_annual_features.csv` / `climate_monthly_features.csv` | Anual/mensual | precipitación observada, cobertura, días secos/calor/heladas, GDD aproximados | Reportes y análisis; no sustituyen datos diarios |

**Detalles SoilGrids:** en `soil_scope="pilot"` se consulta `phh2o`, `soc`, `clay`, `sand`, `bdod`, `nitrogen`, `wv0033` y `wv1500` a `0–5 cm`, `5–15 cm` y `15–30 cm`; resultado nominal máximo: 24 solicitudes. Cada fila tiene unidades propias. `wv0033` y `wv1500` son información de retención puntual, **no** la curva hidráulica completa de WLP.

**Tablas que no son datos observados:** `crop_parameter_requirements.csv`, `management_options.csv` y `economic_input_requirements.csv` son **esquemas para registrar lo que falta**. `fields.csv` incluye un área demostrativa de 1 ha; **no** debe usarse como área real. `crop_plantings.csv`, `crop_seasons.csv` y `farmer_soil_tests.csv` solo aparecen cuando existe información aportada.

## 4. Dónde están los runs ya reportados

Estos paths son **locales a la Mac que ejecutó el pipeline**. Las primeras cuatro filas son rutas históricas: esos runs están respaldados en `data/archive/`, con instrucciones de restauración. El último es el dataset vigente. Ver la [guía de data](../../../data/README.md).

| Run ID | Directorio bajo `data/` | Resultado conocido |
|---|---|---|
| `044339e47498424e` | `processed/guanajuato_valle_demo/runs/044339e47498424e/` | POWER 731 días, SRTM 5 muestras, SoilGrids 24 registros; otros proveedores fallaron inicialmente |
| `78aa647095a849ce` | `worldbank_recovery/guanajuato_valle_demo/runs/78aa647095a849ce/` | World Bank disponible, aislado |
| `befdd22931504ee0` | `modis_earthaccess/guanajuato_valle_demo/runs/befdd22931504ee0/` | 2 compuestos por producto; MOD13/16 QA completa de esas 2 filas, MOD11 50%; **NO** serie histórica completa |
| `2d18a644f624482e` | `guanajuato_smoke/guanajuato_valle_demo/runs/2d18a644f624482e/` | GPM `partial` (smoke de 2 granulos) y SMAP `available`; autenticación y acceso reales funcionando |
| `67b66942681a4214` | `integrated_guanajuato/guanajuato_valle_demo/runs/67b66942681a4214/` | Integral ejecutado y auditado; calendarios completos y faltantes QA MODIS conservados |

**Los datasets de `data/` están ignorados en `.gitignore`; solo se versiona su README.** Hacer `git pull` **no descarga los CSV**. La entrega está en el prefijo GCS indicado en la sección 8; mantener juntos manifiestos y tablas del mismo run, sin incluir `.env` ni credenciales.

## 5. Código mínimo para consumir una tabla (verificar SHA-256)

Ejecutar desde la raíz del repositorio con el directorio real de la ejecución:

```python
from pathlib import Path
import hashlib
import json
import pandas as pd

RUN_DIR = Path(
    "data/integrated_guanajuato/guanajuato_valle_demo/runs/<RUN_ID>"
).resolve()

manifest = json.loads((RUN_DIR / "farm_profile.json").read_text())
assert manifest["farmer_inputs"]["farm_id"] == "guanajuato_valle_demo"
assert manifest["run_id"] == RUN_DIR.name

def read_table(name: str) -> pd.DataFrame:
    item = manifest["tables"][name]  # KeyError si la fuente no generó datos
    file = (RUN_DIR / item["relative_path"]).resolve()
    assert file.is_relative_to(RUN_DIR)
    assert hashlib.sha256(file.read_bytes()).hexdigest() == item["sha256"]
    if item["format"] == "parquet":
        return pd.read_parquet(file)
    if item["format"] == "csv":
        return pd.read_csv(file)
    raise ValueError(f"Unsupported table format: {item['format']}")

weather = read_table("weather_daily")
print(len(weather), weather.columns.tolist())
print(manifest["source_status"]["nasa_power"]["status"])
print(manifest["tables"]["weather_daily"]["validation"])
```

Si WOFOST no tiene acceso al directorio `data/` del equipo de datos, debe leer una **copia completa del mismo run**. No mezclar manualmente tablas de distintos `run_id`, ni usar `latest.json` como referencia inmutable durante la simulación.

## 6. Contrato WOFOST: qué hay que derivar y qué tiene que aportar el equipo

### 6.1 Adaptador meteorológico PCSE: tarea inmediata

La tabla `weather_daily` es una serie de **mediciones/reanálisis de POWER**, no un `WeatherDataProvider` listo para PCSE. En la versión PCSE seleccionada, validar su contrato `WeatherDataContainer`.

| Campo PCSE | Fuente | Transformación y condición |
|---|---|---|
| `DAY` | `weather_daily.date` | `datetime.date`, un día por registro, sin huecos ni duplicados en la campaña |
| `LAT` / `LON` | `farmer_inputs.latitude / longitude` | WGS84, ubicación de referencia |
| `ELEV` | `topography.elevation_m` | Metros; verificar no nulo |
| `TMIN` / `TMAX` | `tmin_c` / `tmax_c` | °C; conservar, revisar orden y rango |
| `IRRAD` | `solar_mj_m2_day` | **× 1 000 000** → J/m²/día |
| `RAIN` | `precip_mm` | **÷ 10** → cm/día |
| `WIND` | `wind_m_s` | m/s, normalmente referencia a 2 m: comprobar definición/altura de POWER |
| `VAP` | `rh_pct` + temperatura / otra fuente | **No disponible directamente**: derivar presión real de vapor en hPa con método y supuestos documentados; no equiparar RH (%) con VAP |
| `E0`, `ES0`, `ET0` | Meteorología + método PCSE | **No exportados** por SourceBuilder. Calcular con la metodología y versión de PCSE elegidas, en **cm/día**, validando inputs y rangos |

**Gates meteorológicos obligatorios:** contar los 731 días incluyendo 2024 bisiesto, comprobar la campaña de simulación completa, cero fechas duplicadas o faltantes, variables finitas, `TMIN ≤ TMAX`, unidades correctas, transformaciones verificadas con tests de casos límite. El `model_readiness.climate_exploration.ready=True` **no** certifica preparación PCSE.

**Evitar:** copiar directamente `et_qa_mm_day` de MOD16 como `ET0` del modelo; es otro producto y otra definición física.

### 6.2 Parámetros agronómicos y de sitio que no aporta automáticamente SourceBuilder

| Insumo | Quién lo prepara | Fuente / contrato previsto |
|---|---|---|
| Cultivo y **variedad** con parámetros WOFOST | Model team | Catálogo PCSE con especie, cultivar, origen y versión; para benchmark pueden usarse variedades de referencia de `YAMLCropDataProvider`, etiquetando región/representatividad |
| Manejo de campaña | Model team + experto/agricultor | `AgroManagementPlan` con fechas de siembra/emergencia/cosecha, reglas y eventos; historia agrícola **no** es un plan futuro |
| Parámetros de sitio para PP | Model team | `SiteParameterSet` compatible con la clase WOFOST elegida; no inventar valores de una parcela real |
| Perfil hidráulico, profundidad efectiva, agua inicial | Model team + suelo/experto | Específicos de **WLP**. No inferir directamente toda la curva a partir de 24 observaciones SoilGrids |
| Manejo de riego | Model team + agricultor | Calendario/eventos reales o escenario experimental explícito; `irrigation="unknown"` no significa rainfed |
| Observaciones independientes | Equipo agrícola/model team | Biomasa/fenología/rendimiento para calibración y evaluación, no generables desde MODIS o World Bank por sí solos |
| Costos y precios de finca | Equipo de optimización/negocio | Datos locales versionados; macroindicadores WB no son precios de mercado de parcela |

**Orden recomendado:** WOFOST PP monoespecie con ejemplo reproducible → WLP cuando haya parámetros hidráulicos y condiciones iniciales → validación contra datos observados → rotaciones → optimización. Las asociaciones de cultivos simultáneos requieren un modelo de interacción adicional, no sumar rendimientos de tres monocultivos.

## 7. QA y comandos de entrega

Desde la raíz del repositorio:

```bash
git switch daniel-sourcebuilder
git pull --ff-only origin daniel-sourcebuilder
python -m pip install -e '.[source,source-test,source-modis]'
python -m pytest tests/source_builder tests/test_scaffold.py -q

# Nueva adquisición integral, solo cuando sea necesaria; incluye un día GPM.
python -m gradientdescentfarmers.source_builder \
  --config resources/guanajuato_integrated.json --run

# Reemplazar <RUN_ID> con el identificado en la salida del run integral.
RUN_DIR="data/integrated_guanajuato/guanajuato_valle_demo/runs/<RUN_ID>"
python -m gradientdescentfarmers.source_builder.core.audit \
  --root data/integrated_guanajuato --sites guanajuato_valle_demo \
  --output data/integrated_guanajuato_audit.json

python -m gradientdescentfarmers.source_builder.core.handoff \
  --run-dir "$RUN_DIR" --output "$RUN_DIR/handoff_report.json"
```

Consultar `validation.json`, `availability.json`, `handoff_report.json` y el resumen `model_readiness.json`. El módulo `handoff.py` **bloquea deliberadamente** `wofost_pp_input_ready` y `wofost_wlp_input_ready` hasta que existan el adaptador PCSE y los parámetros específicos; es un gate de diseño, no un fallo de descarga.

El equipo de datos entregará como mínimo el directorio versionado `runs/<RUN_ID>/`, el reporte de auditoría y el reporte `handoff_report.json`. El receptor debe comprobar que `integrity_ok=True`; los demás flags detallan la cobertura y los bloqueadores, no equivalen a aprobación de la simulación.

### Aceptación en fases

1. **Data / integridad:** cada tabla declarada existe, SHA-256 coincide, fuentes identificadas, errores explícitos.
2. **Ambiental:** POWER 731 días, MODIS calendario y QA por producto, GPM 48/48 en un día, SMAP ventana corta honestamente reportada.
3. **Meteorología WOFOST:** `WeatherDataProvider` completo, unidades/evapotranspiración referencia comprobadas.
4. **Simulación experimental:** cultivo/variedad y sitio/campaña definidos con parámetros versionados; modo PP o WLP identificado.
5. **Validación científica:** resultados contrastados con mediciones independientes; sensibilidad, incertidumbre, reproducción y límites.
6. **Decisión/optimización:** precios, costos, agua, suelo y rendimiento/riesgo verificados antes de recomendar a un agricultor.

## 8. Estado de los runs y límites

El run integral **`67b66942681a4214`** pasó la auditoría el 14 de noviembre de 2026:

- **Integridad y QA:** hashes correctos y las 16 tablas exportadas con QA aprobada.
- **POWER / terreno / suelo:** 731 días consecutivos de 2024–2025, cinco muestras SRTM y las 24 combinaciones SoilGrids del piloto.
- **MODIS:** calendarios completos de 46/92/92 composiciones; pares utilizables tras QA: 41 NDVI/EVI, 67 LST día/noche y 79 ET/PET. `partial` describe estos faltantes de calidad, sin imputación.
- **GPM / SMAP / World Bank:** un día UTC con 48/48 intervalos válidos, snapshot SMAP de dos gránulos y 192 registros de contexto nacional.
- **Commit de adquisición:** `396f2968e81678a099e13d104e2ac3fd077db06d`. Se conserva `e07e32b` como referencia del intento interrumpido; el código de adquisición y su configuración integral no cambiaron entre ambos.

Directorio local: `data/integrated_guanajuato/guanajuato_valle_demo/runs/67b66942681a4214/`.
Destino de entrega: `gs://data_dump_samples/farm_profiles/guanajuato_valle_demo/runs/67b66942681a4214/`.
El paquete contiene el manifiesto original, tablas, reportes QA, procedencia de
ejecución y `SHA256SUMS`. `gcs_upload_receipt.json` confirma la transferencia
solo después de verificar el SHA-256 de todos los archivos remotos. Ver el
[inventario del run](GUANAJUATO_INTEGRATED_RUN.md).

El smoke histórico `2d18a644f624482e` sigue siendo parcial para GPM y no debe
confundirse con este run integral. La entrega ambiental aprobada todavía no
incluye un `WeatherDataProvider` PCSE, parámetros de cultivar/sitio, plan futuro
de manejo ni la hidráulica/agua inicial de WLP. No constituye una simulación
ni una validación de rendimientos.

El aviso deprecado `DataGranule.size()` de `earthaccess` es un `FutureWarning` de la biblioteca, **no** un error de archivo, fuente ni QA.

## 9. Más documentación

- [WOFOST_TRANSITION.md](WOFOST_TRANSITION.md) — plan detallado de parámetros, gates, contrato de simulación, PP/WLP.
- [FARM_PROFILE_CONTRACT.md](FARM_PROFILE_CONTRACT.md) — esquema versionado y rutas de exportación.
- [DATA_PIPELINE.md](DATA_PIPELINE.md) — etapas del pipeline y origen de fuentes.
- [SOURCE_CATALOG.md](SOURCE_CATALOG.md) — catálogo de observaciones y limitaciones.
- [QUALITY_AND_LIMITATIONS.md](QUALITY_AND_LIMITATIONS.md) — interpretación responsable de QA/cobertura.
- [GUANAJUATO_INTEGRATED_RUN.md](GUANAJUATO_INTEGRATED_RUN.md) — comandos del run integral.
- [PCSE Code Documentation](https://pcse.readthedocs.io/en/stable/code.html) — campos de `WeatherDataContainer`.
- [PCSE Reference Guide](https://pcse.readthedocs.io/en/stable/reference_guide.html) — proveedores de parámetros de cultivo y clases del modelo.

## Ruta alternativa: dataset WOFOST ligero (sin HDF)

Ante restricciones de almacenamiento, **priorizar** [GUANAJUATO_WOFOST_LIGHT_RUN.md](GUANAJUATO_WOFOST_LIGHT_RUN.md).
Esta guía contiene el comando limitado a NASA POWER, SRTM y SoilGrids, el gate científico `wofost_source_report.json`
y la subida de un solo run versionado a GCS. MODIS/GPM/SMAP están excluidos de esa alternativa ligera; sí están incluidos en el run integral auditado descrito arriba.

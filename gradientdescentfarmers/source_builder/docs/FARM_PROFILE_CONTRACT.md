# Contrato de datos — FarmProfileBuilder V2 (Fase 1)

**Estado:** contrato del código existente en `gradientdescentfarmers/source_builder/core/`. Actualizar conjuntamente con `schema.py`, `settings.py` y `builder.py`; la especificación del modelo WOFOST se prepara por separado.

## 1. Límite de responsabilidades

```text
FarmerInput + BuilderSettings + proveedores ambientales
                     ↓
FarmProfileBuilder
  retrieval → preprocessing → validation → feature engineering → export
                     ↓
FarmProfile (manifiesto) + tablas separadas + QA + provenance + readiness
                     ↓
FeasibilityAssessment (prerrequisitos) → [pendiente] CropCatalog / WOFOST / RotationPlanner
```

El builder **no** selecciona cultivos, no predice rendimiento, no demuestra aptitud agronómica, no optimiza rentabilidad y no simula cultivos asociados.

## 2. Entrada — FarmerInput (Pydantic)

Referencia normativa: `gradientdescentfarmers/source_builder/core/schema.py:FarmerInput`.

| Grupo | Campos actuales | Validaciones/semántica |
|---|---|---|
| Identificación y ubicación | `farm_id`, `mode`, `latitude`, `longitude`, `country_iso3?` | ID seguro, modo `basic/advanced`, rangos geográficos; país opcional |
| Parcelas | `fields[]` (`field_id`, `area_ha`, `boundary_geojson?`, lat/lon opcionales) | Al menos una parcela, IDs únicos, área positiva. GeoJSON **no** tiene validación topológica completa |
| Historial | `crop_history[]` (`field_id`, `season_id`, `planting_system`, `plantings[]`) | Temporada única por parcela; `monocrop` = 1 especie, `intercropping` >= 2; áreas interespecíficas pueden superponerse |
| Plantación | `crop_name`, variedad, fechas, rendimiento `yield_t_ha`, densidad, fertilización, riego, manejo de residuos, área/fracción cultivada | Muchos campos opcionales; no equivalen a parámetros fisiológicos calibrados de WOFOST |
| Agua/suelo/equipo | `irrigation`, `irrigation_water_m3_ha?`, `soil_tests[]`, `equipment[]` | Informa contexto; no verifica disponibilidad legal/física de agua ni capacidad real de maquinaria |
| Economía y preferencias | `budget?`, `currency?`, `crop_preferences[]`, `constraints`, `cropping_mode`, `objective_weights`, `language`, `farmer_notes?` | Presupuesto requiere moneda; pesos de 5 objetivos suman 100; preferencias no sustituyen la evaluación agronómica |

Los objetivos actuales son `profit`, `downside_risk`, `water`, `soil_health` y `climate_resilience`. Su presencia en el input **no implica que existan funciones objetivo implementadas**.

## 3. Configuración — BuilderSettings

Referencia normativa: `gradientdescentfarmers/source_builder/core/settings.py:BuilderSettings`.

- `output_root`, `cache_root`: rutas **locales** `pathlib.Path`; no son URIs `gs://`.
- `source_overrides`: selección explícita de proveedores, con prioridad respecto al modo `basic/advanced`.
- Ventanas `weather_start/end`, `modis_start/end`, `gpm_start/end`, `smap_start/end`, `cmip_start/end`; distintos conjuntos **no comparten necesariamente las mismas fechas**.
- Control de límites: `http_timeout_s`, `retries`, `max_workers`, `gpm_max_granules`, `smap_max_granules`, `soil_max_requests`.
- `cache_enabled`, `cache_ttl_hours`, `soil_scope`, `export_format`, `input_files_root`, umbrales de variables climáticas, opciones Earth Engine.
- El conjunto básico predeterminado incluye POWER, SRTM, SoilGrids, MODIS (3) y World Bank. El ejemplo vigente `resources/guanajuato_integrated_settings.json` añade GPM/SMAP mediante overrides explícitos; `resources/guanajuato_integrated.json` enlaza esos settings y el input del predio.

## 4. Salida — FarmProfile

Referencia normativa: `gradientdescentfarmers/source_builder/core/schema.py:FarmProfile`.

| Campo | Qué contiene | Precaución |
|---|---|---|
| `schema_version`, `builder_version`, `run_id`, `created_utc` | Identidad/versionado de manifiesto y ejecución | No demuestra identidad de fuentes ni versión de código Git por sí solo |
| `farmer_inputs` | Copia validada del input del agricultor | Puede contener información privada/comercial |
| `source_status` | Estado, cobertura, errores, advertencias, origen, duración, unidades | `available` significa QA preliminar, no validez a escala de parcela |
| `tables` | `TableRecord` por tabla: nombre, filas, columnas, unidad, granularidad, `relative_path`, `sha256`, validación | Datos viven en archivos separados; respetar su resolución |
| `topography`, `features`, `provenance` | Resúmenes de terreno, indicadores derivados y procedencia disponible | No interpolar fuentes a escala fina sin justificación |
| `model_readiness` | Indicadores booleanos de prerrequisitos actuales | **No** constituye validación independiente para WOFOST |
| `build_state`, `limitations` | `complete/partial/failed` y límites declarados | No implica simulación o recomendación realizada |

Cada fuente puede quedar `not_requested`, `missing`, `error`, `partial` o `available`. Un perfil `partial` es un resultado válido del pipeline; no se rellenan datos faltantes inventados.

### Archivos exportados por run

```text
<output_root>/<farm_id>/
  latest.json
  runs/<run_id>/
    farm_profile.json
    availability.json
    validation.json
    provenance.json
    model_readiness.json
    feature_catalog.csv
    standardized/<table>.csv|parquet
```

El directorio histórico anterior `<output_root>/<farm_id>/` puede conservar exportaciones `legacy`; no deben confundirse con los `runs/` nuevos. `latest.json` apunta al último run exportado, **no al último aprobado**. `GCSStorage` publica el directorio exacto `runs/<run_id>/` de forma optativa.

## 5. Tablas que pueden alimentar decisiones posteriores

| Tabla | Fuente habitual | Qué puede aportar | Qué NO prueba |
|---|---|---|---|
| `weather_daily` | NASA POWER | Temperatura, lluvia, radiación, HR, viento diarios | Microclima exacto de una parcela |
| `topography_samples` | SRTM | Elevación y pendiente local aproximada | Levantamiento topográfico del campo |
| `soil_properties_raw` | SoilGrids | Propiedades por profundidad con unidades y punto | Curvas hidráulicas completas ni análisis de laboratorio |
| `vegetation_timeseries` | MOD13Q1 | NDVI/EVI con máscara QA | Identidad del cultivo, rendimientos o manejo |
| `land_surface_temperature` | MOD11A2 | LST de día/noche | Temperatura del aire |
| `evapotranspiration` | MOD16A2GF | ET/PET satelital | Riego aplicado o demanda exacta de parcela |
| `gpm_half_hourly`, `gpm_daily` | GPM (opcional) | Intensidad de lluvia/eventos observados | Lluvia medida in situ |
| `soil_moisture_timeseries` | SMAP (opcional) | Humedad regional superficial/radicular | Sensor de campo |
| `country_agriculture_context` | World Bank | Contexto macroscópico nacional | Precio de venta o utilidad de una finca |
| `crop_plantings`, `fields`, `farmer_soil_tests` | FarmerInput | Historial y datos declarados por usuario | Verificación externa de esos datos |
| `validated_crop_parameters`, `local_crop_prices` | CSV opcional | Potenciales entradas para etapas siguientes | No están automáticamente calibradas, certificadas o completas |

**Nota:** la lista detallada de todas las tablas está en `settings.py:SOURCE_TABLES` y `preprocessing.py`. Algunas fuentes pueden estar deshabilitadas o devolver tablas vacías.

## 6. Contrato de consumo futuro

Una etapa de decisión debe:
1. Identificar el `run_id` y verificar rutas/hashes de tablas usadas.
2. Evaluar estado y QA **por variable/periodo/cultivo**, no solo `build_state`.
3. Exigir entradas independientes para catálogos agronómicos y económicos.
4. Conservar valores ausentes como ausentes; reportar supuestos, procedencia, unidades, fecha, resolución e incertidumbre.
5. **No modificar** el `FarmProfile`: producir un nuevo `FeasibilityAssessment`, `SimulationResult` o `Recommendation` versionado.

Documentos siguientes:
- [CROP_SHIFT_REQUIREMENTS.md](CROP_SHIFT_REQUIREMENTS.md): umbrales de evidencia para explorar, simular y recomendar.
- [WOFOST_TRANSITION.md](WOFOST_TRANSITION.md): contratos/adaptadores técnicos a implementar.

## 7. Registro histórico de la migración

Los resultados siguientes corresponden a una etapa previa. El ejemplo vigente,
ejecutado y auditado, está en [GUANAJUATO_INTEGRATED_RUN.md](GUANAJUATO_INTEGRATED_RUN.md).

En el Mac del desarrollador pasaron **39/39 pruebas automatizadas** antes de la ampliación reciente de aislamiento por run (confirmada después mediante ejecución manual). Las integraciones externas para las cuatro regiones **no están completadas**. En Texcoco, `nasa_power` y `srtm` fueron `available`; tres MODIS `partial`; SoilGrids `error` por conectividad en el manifiesto auditado. Existe un CSV histórico de SoilGrids con 12 observaciones, **no declarado** en dicho manifiesto. No debe tratarse como parte de la ejecución actual.

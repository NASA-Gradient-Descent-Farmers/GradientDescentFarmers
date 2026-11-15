# Farm Profile Builder

Este módulo construye un **inventario ambiental reproducible para una ubicación**:
recibe la descripción de un predio y una configuración de fuentes, adquiere datos,
normaliza unidades, aplica controles de calidad y exporta un `FarmProfile` con
tablas, procedencia y hashes SHA-256. Implementa el contrato `SourceBuilder` del
proyecto mediante `NASAProfileSourceBuilder`.

El resultado sirve como entrada para análisis y modelos posteriores. Los
parámetros de cultivo, el manejo futuro, la simulación WOFOST y la optimización
económica se preparan en sus respectivos módulos.

## Overview

```text
FarmerInput + BuilderSettings
           ↓
adquisición → normalización → validación → features → exportación local
           ↓
FarmProfile + standardized/ + QA + procedencia + hashes
           ↓
auditoría y publicación explícita en GCS → equipo de modelos
```

| Componente | Función |
| --- | --- |
| `adapter.py` y `__main__.py` | Integración con `Pipeline` y comando de terminal |
| `core/schema.py` | Validación del predio, historial y contrato `FarmProfile` 2.0.0 |
| `core/settings.py` | Fuentes habilitadas, fechas, límites y rutas |
| `core/providers.py`, `earthdata.py`, `modis_earthaccess.py` | Adquisición y muestreo de datos |
| `core/preprocessing.py`, `validation.py`, `features.py` | Unidades, máscaras QA e indicadores climáticos |
| `core/transport.py`, `earthdata_recovery.py` | Caché HTTP, reintentos y reutilización de gránulos válidos |
| `core/audit.py`, `handoff.py`, `wofost_source_check.py` | Auditoría de archivos y requisitos de entrega |
| `core/feasibility.py` | Prerrequisitos por escenario y evidencia externa |
| `core/jobs.py`, `storage.py` | Cola SQLite local y almacenamiento GCS opcional |
| `cloud/` | HTTP privado, worker persistente en VM y publicación automática auditada en GCS |

## Fuentes disponibles

| Fuente | Datos | Alcance |
| --- | --- | --- |
| NASA POWER | Temperatura, lluvia, radiación, humedad y viento | Serie diaria |
| SRTM / OpenTopoData | Elevación y pendiente aproximada | Cinco puntos cercanos |
| SoilGrids / ISRIC WCS | Propiedades de suelo por profundidad | Estimaciones raster; piloto de 24 combinaciones |
| MODIS MOD13Q1 | NDVI y EVI con QA | Composiciones de 16 días |
| MODIS MOD11A2 | Temperatura de superficie día/noche con QA | Composiciones de 8 días |
| MODIS MOD16A2GF | ET y PET con QA | Composiciones de hasta 8 días |
| GPM IMERG V07 | Lluvia cada 30 minutos y agregación diaria | Día válido solo con 48 intervalos UTC exactos y válidos |
| SMAP L4 | Humedad superficial y radicular | Gránulos de 3 horas, escala regional |
| World Bank | Contexto agrícola nacional | Indicadores anuales |

MODIS puede adquirirse mediante ORNL o `earthaccess`; el ejemplo integral usa
`earthaccess` y lee HDF4 con `pyhdf`, sin requerir el controlador HDF4 de GDAL.
USDA, FAOSTAT y proveedores Earth Engine también están registrados, pero se
habilitan explícitamente y necesitan credenciales y, según el proveedor,
dependencias adicionales. Ver el
[catálogo de fuentes](docs/SOURCE_CATALOG.md).

## Quick start

Desde la **raíz del repositorio**, con Python 3.11:

```bash
python -m pip install -e '.[source,source-test,source-modis]'
python -m pytest tests/source_builder tests/test_scaffold.py -q
```

Para las fuentes Earthdata del ejemplo integral, configurar una cuenta NASA
Earthdata con acceso a los productos solicitados. Usar variables de entorno o
un archivo local `gradientdescentfarmers/source_builder/.env`:

```dotenv
EARTHDATA_USERNAME=tu_usuario
EARTHDATA_PASSWORD=tu_password
```

También se admite `EARTHDATA_TOKEN`. La prioridad es: variables exportadas,
`.env` de `source_builder`, `.env` de la raíz y `.env` del directorio actual.
Las credenciales se mantienen fuera de Git y de los JSON de configuración.

**Este fue el comando de la ejecución integral de Guanajuato:**

```bash
python -m gradientdescentfarmers.source_builder \
  --config resources/guanajuato_integrated.json \
  --run
```

Al terminar imprime `run_id`, `build_state`, `output_dir` y `source_status`.
Cada ejecución crea un directorio nuevo y reutiliza la caché válida. Ejecutar
una adquisición a la vez cuando comparten caché: el builder no tiene un bloqueo
entre procesos. Las descargas HDF4/HDF5 pueden ocupar varios GiB.

`--run` habilita las consultas externas. Sin esa opción se exporta un perfil
con las fuentes remotas deshabilitadas; también se escriben archivos y se
actualiza `latest.json`. Para una prueba sin datos remotos, usar otro
`output_root`, como `data/previews`, para separarla de las adquisiciones.

## De dónde salen las especificaciones del terreno

Las antiguas carpetas `config/`, `configs/` y `examples/` no son necesarias en
esta implementación. Los tres JSON vigentes del ejemplo están en `resources/`:

```text
resources/guanajuato_integrated.json          ← recibido por --config
  source.farmer_input_file
    → resources/guanajuato_reference.json     ← ubicación y datos del predio
  source.settings_file
    → resources/guanajuato_integrated_settings.json
                                             ← fuentes, fechas y límites
```

| Archivo | Contenido |
| --- | --- |
| `guanajuato_reference.json` | `farm_id`, coordenadas, país, parcelas, superficies, historial, suelo y preferencias |
| `guanajuato_integrated_settings.json` | `source_overrides`, periodos por producto, proveedor MODIS y límites de adquisición |
| `guanajuato_integrated.json` | Enlaces a los dos anteriores, `output_root`, `cache_root` y contrato `source/model/optimizer` |

Las rutas dentro de `source` se resuelven respecto de la raíz del repositorio.
`resources/application.conf` conserva el contrato vacío compartido por los
módulos: no describe un terreno ni es un ejemplo listo para adquirir datos.
Los presets anteriores de baseline, smoke, MODIS piloto y entrega ligera se
retiraron; su historial permanece en Git.

## Ejecutar otra ubicación

Se necesita conexión a las fuentes seleccionadas, las dependencias anteriores,
espacio para la caché y estos datos/configuraciones:

| Dato | Requisito |
| --- | --- |
| `farm_id` | Identificador de 1–80 caracteres: letras ASCII, números, `_` o `-`; comienza con letra o número |
| `latitude`, `longitude` | Punto WGS84 en grados decimales: latitud −90..90 y longitud −180..180 |
| `fields` | Al menos una parcela, con `field_id` único y `area_ha` positiva |
| `country_iso3` | Código de país de tres letras; necesario si se habilita World Bank |
| Fuentes y fechas | Productos y ventanas con datos para ese lugar |
| Límites | Ajustar máximos de gránulos MODIS/GPM/SMAP y peticiones de suelo al objetivo |
| Credenciales | NASA Earthdata para MODIS vía `earthaccess`, GPM y SMAP; otras según los proveedores opcionales |
| Rutas | `output_root` y `cache_root` dentro de `data/` en la raíz del repositorio |

Un input mínimo válido, **solo ilustrativo**, tiene esta forma:

```json
{
  "farm_id": "mi_predio",
  "latitude": 19.4326,
  "longitude": -99.1332,
  "country_iso3": "MEX",
  "fields": [{"field_id": "parcela_1", "area_ha": 2.5}]
}
```

Sustituir coordenadas y superficie por los datos de interés. Historial, ensayos
de suelo, riego, presupuesto y preferencias son opcionales; los datos ausentes
no se inventan. El presupuesto requiere moneda; los pesos de objetivos suman 100.

Para preparar una configuración propia:

```bash
cp resources/guanajuato_reference.json resources/mi_sitio_reference.json
cp resources/guanajuato_integrated_settings.json resources/mi_sitio_settings.json
cp resources/guanajuato_integrated.json resources/mi_sitio_integrated.json
```

1. Editar el input: identificadores, coordenadas, país, superficie y datos reales.
2. Editar los settings: fuentes, periodos y número máximo de gránulos. El ejemplo
   solicita clima/MODIS de 2024–2025, **un día** GPM y **dos gránulos** SMAP; no
   hay una cobertura temporal común implícita para todos los productos.
3. Editar los enlaces y rutas del archivo principal. Para nuevos sitios se
   recomienda `output_root=data/processed` y `cache_root=data/cache`:

```json
{
  "source": {
    "farmer_input_file": "resources/mi_sitio_reference.json",
    "settings_file": "resources/mi_sitio_settings.json",
    "output_root": "data/processed",
    "cache_root": "data/cache"
  },
  "model": {},
  "optimizer": {}
}
```

```bash
python -m gradientdescentfarmers.source_builder \
  --config resources/mi_sitio_integrated.json --run
```

Los proveedores muestrean **el punto `latitude/longitude` del predio**. El
polígono `boundary_geojson` y las coordenadas opcionales de cada parcela se
conservan, pero no implementan recorte ni promedio de todo el terreno. Para
puntos separados, crear perfiles con identificadores y coordenadas propios.
La disponibilidad depende del producto, lugar y periodo y se reporta por fuente.

## Salidas y validación

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
    standardized/*.csv | *.parquet
```

El manifiesto `farm_profile.json` declara tablas existentes, filas, columnas,
unidades, rutas y SHA-256. `availability.json` describe fuentes y fallos;
`validation.json` contiene QA por tabla. Los features incluyen resúmenes
mensuales/anuales, GDD aproximados, lluvia, sequías, calor y heladas con umbrales.

`latest.json` apunta al último exportado, no al último aprobado. Consumir un
`run_id` fijo y las tablas de su manifiesto. Un perfil `partial` puede ser útil:
revisar las fuentes, variables y periodos incompletos. Ver la
[guía de `data/`](../../data/README.md).

Para auditar el ejemplo integral existente:

```bash
RUN_DIR="data/integrated_guanajuato/guanajuato_valle_demo/runs/67b66942681a4214"

python -m gradientdescentfarmers.source_builder.core.audit \
  --root data/integrated_guanajuato --sites guanajuato_valle_demo \
  --output data/integrated_guanajuato_audit.json

python -m gradientdescentfarmers.source_builder.core.handoff \
  --run-dir "$RUN_DIR"
```

`core.audit` comprueba archivos y hashes; su QA de baseline espera las fuentes
básicas. Los calendarios de `core.handoff` y `core.wofost_source_check` usan por
defecto 2024–2025 y el contrato piloto de suelo. Para otras ventanas o fuentes,
adaptar la evaluación a los settings elegidos. Los reportes publicados se
conservan sin reescribirlos.

## GCP: publicación posterior a la adquisición

El runner HTTP en una VM de `gdfarming` publica automáticamente en
`gs://gdfarming-farm-data`. Recibe los tres documentos JSON, responde con un
`job_id` y ejecuta adquisición, auditoría y subida desde un worker persistente.
Ver [despliegue, HTTP y operación de la VM](docs/GCP_VM_DEPLOYMENT.md).
SIAP y DENUE no están habilitados en este despliegue.
Para integrar el formulario y el trigger desde la UI, ver el
[contrato para Isaac: payload, backend, progreso y errores](docs/README.md#contrato-para-isaac-y-la-ui).
La evaluación posterior se documenta en
[WOFOST, SIAP y rotaciones](../rotations_service/README.md); su bucket de salida
es `gs://gdfarming-farm-rotations` y no altera los perfiles ambientales.

**`--run` exporta localmente; no activa una subida a GCP.** Para la entrega de
Guanajuato se ejecutaron después dos scripts operativos locales:

- `data/guanajuato_resume/finalize_delivery.py`: auditoría y preparación del paquete.
- `data/guanajuato_resume/publish_delivery.py`: subida automatizada y verificación remota.

Esos scripts pertenecen a la sesión local, no se distribuyen con el paquete
Python ni son una interfaz genérica para cualquier ubicación. El publicador
validó hashes locales, creó objetos sin sobrescribirlos, publicó
`farm_profile.json` al final y leyó de vuelta los 31 archivos para comparar
SHA-256. Después generó `gcs_upload_receipt.json` como recibo de transferencia.

**Bucket usado: `gs://data_dump_samples`.**

```text
gs://data_dump_samples/farm_profiles/guanajuato_valle_demo/runs/67b66942681a4214/
```

La cuenta tenía permisos de creación, lectura y listado de objetos aunque el
bucket pertenece a otro proyecto. Se autenticó con `gcloud auth login`; el
publicador usó un token en memoria. Se publicó solo el run, sin cachés ni
históricos. Para otros runs, ver [GCS_STORAGE.md](docs/GCS_STORAGE.md): copia
reproducible del directorio completo, credenciales de `gcloud` frente a ADC y
API opcional `GCSStorage`.

## Ejemplo auditado: Guanajuato

El run `67b66942681a4214`, del 14 de noviembre de 2026, usó el punto
`20.4243195, -101.1466639`. Es una referencia regional; la parcela de 1 ha del
input es un placeholder sintético, sin rendimientos ni manejo observados.

Pasó integridad y QA: POWER 731 días, SRTM 5 muestras, SoilGrids 24 valores,
MODIS 46/92/92 composiciones, GPM 48 intervalos UTC y SMAP 2 gránulos.
`build_state=partial` conserva los huecos de QA MODIS; ninguna fuente habilitada
quedó en error. El commit de adquisición fue `396f296`, con el mismo código y
configuración de adquisición que `e07e32b`. Ver el
[inventario y reportes de la ejecución](docs/GUANAJUATO_INTEGRATED_RUN.md).

Para WOFOST faltan un `WeatherDataProvider` de la versión PCSE elegida,
parámetros de cultivo/sitio y agromanagement; WLP requiere además hidráulica de
suelo y agua inicial. Los flags PP/WLP siguen en `false`.

## Documentación

- [Pipeline y transformaciones](docs/DATA_PIPELINE.md).
- [Contrato FarmProfile](docs/FARM_PROFILE_CONTRACT.md).
- [Calidad y limitaciones](docs/QUALITY_AND_LIMITATIONS.md).
- [Evaluación de prerrequisitos por escenario](docs/FEASIBILITY_ASSESSMENT.md).
- [MODIS mediante Earthdata](docs/MODIS_EARTHACCESS.md).
- [Entrega de datos a WOFOST](docs/WOFOST_DATA_HANDOFF.md).
- [Transición PCSE/WOFOST](docs/WOFOST_TRANSITION.md).
- [Requisitos para cambios de cultivo](docs/CROP_SHIFT_REQUIREMENTS.md).

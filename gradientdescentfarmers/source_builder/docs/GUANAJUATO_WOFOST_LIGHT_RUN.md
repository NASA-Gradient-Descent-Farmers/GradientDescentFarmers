# Guanajuato: entrega meteorológica y edáfica ligera para WOFOST

Esta es una **alternativa segura al run integral pesado** en una Mac con 8.4 GiB libres. Reutiliza caché válida de POWER/SoilGrids; no solicita MODIS, GPM ni SMAP. No elimina, altera ni vuelve a empaquetar los HDF/HDF5 ya descargados.

**Ubicación de referencia:** 20.4243195, -101.1466639. El campo de 1 ha en `guanajuato_reference.json` es un placeholder sintético, no un predio real.

## Ejecutar desde la raíz del repositorio

Primero confirmar que no quedan SourceBuilders ejecutándose ni modificaciones locales sin guardar:

```bash
ps -axo pid,etime,command | grep '[g]radientdescentfarmers.source_builder' || true
git switch daniel-sourcebuilder
git fetch origin
git pull --ff-only origin daniel-sourcebuilder
python -m pytest tests/source_builder tests/test_scaffold.py -q
df -h .
```

El comando ligero:

```bash
python -m gradientdescentfarmers.source_builder \
  --config resources/guanajuato_wofost_handoff.json --run
```

Guardar el `run_id` del resumen. La ubicación de salida es:

```text
data/wofost_handoff_guanajuato/guanajuato_valle_demo/runs/<RUN_ID>/
    farm_profile.json
    availability.json
    validation.json
    model_readiness.json
    provenance.json
    feature_catalog.csv
    standardized/
        weather_daily.csv
        topography_samples.csv
        soil_properties_raw.csv
        climate_annual_features.csv
        climate_monthly_features.csv
        fields.csv
        ... otras tablas de requisitos no observados
```

Los archivos concretos, formatos, columnas, hashes SHA-256 y procedencia se consultan en `farm_profile.json["tables"]`. No asumir que cada tabla existe si falló una fuente. El paquete es pequeño: no incluye los HDF ni los TIFF de caché.

## Auditoría de entrega específica

**No usar `all_baseline_qa_ok` de `core.audit` como prueba de este perfil ligero**: ese auditor histórico requiere fuentes MODIS y World Bank que aquí se deshabilitaron intencionalmente. La integridad de hashes sí se reutiliza.

```bash
RUN_DIR="data/wofost_handoff_guanajuato/guanajuato_valle_demo/runs/<RUN_ID>"
python -m gradientdescentfarmers.source_builder.core.wofost_source_check \
  --run-dir "$RUN_DIR" --output "$RUN_DIR/wofost_source_report.json"
```

**Aceptar entrega ambiental** solo con `integrity_ok=true` y `lean_source_qa_ready=true`. Este gate exige:

- POWER con 731 días consecutivos 2024–2025 (incluye 2024 bisiesto), sin nulos ni infinitos en temperatura mínima/media/máxima, lluvia, humedad, viento, radiación; con plausibilidad básica.
- SRTM con cinco muestras nombradas y elevaciones no faltantes.
- SoilGrids con 24 combinaciones únicas (8 propiedades × 3 profundidades), media, unidades y valores finitos.
- Todas las tablas declaradas presentes e intactas según hashes SHA-256, QA por tabla y las tres fuentes habilitadas y usables.

**No es un gate PCSE ni una aprobación de simulación.** El equipo WOFOST tiene que aportar un proveedor `WeatherDataProvider` con `VAP, E0, ES0, ET0`, conversiones de unidades y verificación de campaña; parámetros de cultivar/sitio; plan de agromanagement; para WLP, parámetros hidráulicos y estado inicial del agua. Para recomendaciones hay que validar rendimientos con observaciones independientes.

## Compartir en GCP

No subir todo `data/`: las cachés MODIS/HDF son muy grandes, y hay runs parciales. Subir únicamente el directorio del `RUN_ID` validado.

```bash
gcloud storage rsync "$RUN_DIR" \
  "gs://TU_BUCKET/farm_profiles/guanajuato_valle_demo/runs/<RUN_ID>" \
  --recursive
```

Compartir con el equipo: `gs://.../runs/<RUN_ID>/`, el `run_id`, SHA del commit que lo generó, `farm_profile.json`, `wofost_source_report.json` y [WOFOST_DATA_HANDOFF.md](WOFOST_DATA_HANDOFF.md). **Nunca subir .env ni credenciales**.

Cuando tenga sentido reanudar los productos MODIS/GPM, hacerlo por fuente, evitando ejecuciones simultáneas, con monitoreo de espacio y preferentemente subsetting espacial del proveedor o una máquina con mayor disco.

# Qué contiene `data/`

Aquí viven los datos generados y los archivos de trabajo locales. Solo este
README se versiona en Git; las descargas y datasets se excluyen.

| Ruta | Qué contiene | Cuándo usarla |
| --- | --- | --- |
| `integrated_guanajuato/` | Dataset vigente, con manifiesto, tablas y reportes | Para consumir la entrega de Guanajuato |
| `siap/` | CSV originales, tablas Parquet limpias, diccionario y manifiesto de producción agrícola SIAP | Consultar producción, rendimientos y precio medio rural por territorio/cultivo |
| `cache/http/` | Respuestas HTTP reutilizables | Evitar repetir consultas |
| `cache/soilgrids/` | Raster TIFF de suelo | Caché de adquisición |
| `cache/earthdata/` | Gránulos originales MODIS, GPM y SMAP | Reanudar descargas; ocupa ~12.7 GiB en este ejemplo |
| `guanajuato_resume/` | Logs, scripts de la sesión, diagnósticos, resumen final y mensaje WOFOST | Entender cómo se reanudó y publicó la entrega |
| `gcp_deploy/` | Paquetes de código, SHA y recibos locales del despliegue en la VM | Reproducir el despliegue; ver `source_builder/docs/GCP_VM_DEPLOYMENT.md` |
| `archive/` | Respaldo de 9 runs anteriores, inventario y `RESTORE.md` | Consultar o restaurar el histórico |
| `integrated_guanajuato_audit.json` | Auditoría local del sitio | Revisar el resultado ambiental |
| `worldbank_only.json` | Configuración local histórica de recuperación de World Bank | Referencia; no interviene en el run integral |

## Dataset que hay que consumir

```text
integrated_guanajuato/guanajuato_valle_demo/
  latest.json
  runs/67b66942681a4214/
    farm_profile.json          # tablas, unidades, rutas y hashes
    standardized/              # CSV de clima, suelo, satélite y features
    availability.json          # estado de cada fuente
    validation.json            # QA por tabla
    provenance.json            # procedencia
    model_readiness.json       # requisitos de modelos
    feature_catalog.csv
    audit_report.json
    handoff_report.json
    wofost_source_report.json
    delivery_manifest.json
    SHA256SUMS
    gcs_upload_receipt.json     # transferencia verificada
    ... documentación y procedencia de ejecución
```

Fijar el `run_id` para trabajar: `latest.json` puede apuntar a una ejecución
más reciente que todavía no esté aprobada. Leer las rutas de tablas declaradas
en `farm_profile.json`, conservando las de un mismo run.

La misma entrega está en:

```text
gs://data_dump_samples/farm_profiles/guanajuato_valle_demo/runs/67b66942681a4214/
```

Los reportes y tablas publicados se conservan sin modificaciones para que sus
hashes sigan coincidiendo. Los scripts de `guanajuato_resume/` documentan esa
sesión y no son necesarios para leer el dataset.

Para nuevos sitios, usar preferentemente `output_root=data/processed` y la
misma `cache_root=data/cache`: cada predio queda en
`processed/<farm_id>/runs/<run_id>/`. La configuración de entrada vive en
`resources/`, fuera de esta carpeta. Ver la
[guía del builder](../gradientdescentfarmers/source_builder/README.md).

## Datos regionales SIAP

El módulo `gradientdescentfarmers.source_builder.siap` escribe en `data/siap/`
por defecto. Conserva `raw/`, `parquet/`, `dictionary/` y `manifest.json`.
`SIAP_DATA_DIR` permite usar otro directorio; en una VM debe apuntar a disco
persistente. Ver la [guía SIAP](../gradientdescentfarmers/source_builder/siap/README.md).

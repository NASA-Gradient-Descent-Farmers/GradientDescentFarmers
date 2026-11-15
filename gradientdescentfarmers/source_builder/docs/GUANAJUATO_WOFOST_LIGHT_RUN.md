# Adquisición ligera de clima, terreno y suelo

El preset JSON dedicado se retiró de `resources/`; los tres JSON del ejemplo
integral son la referencia vigente. Esta receta opcional muestra cómo usarlos
con ajustes en memoria para una adquisición nueva limitada a POWER, SRTM y
SoilGrids. No es necesario ejecutarla para consumir la entrega integral auditada.

## Ejecutar una adquisición ligera

Desde la raíz del repositorio, con las dependencias `source` instaladas:

```bash
python - <<'PY'
import json
from gradientdescentfarmers.source_builder.adapter import (
    REPO_ROOT, NASAProfileSourceBuilder, load_source_config,
)
from gradientdescentfarmers.source_builder.core.settings import SOURCE_TABLES

cfg = load_source_config(REPO_ROOT / "resources/guanajuato_integrated.json")
settings = json.loads((REPO_ROOT / cfg.pop("settings_file")).read_text())
required = {"nasa_power", "srtm", "soilgrids_wcs"}
settings["source_overrides"] = {name: name in required for name in SOURCE_TABLES}
cfg.update(settings=settings, output_root="data/wofost_handoff_guanajuato", run=True)
result = NASAProfileSourceBuilder().build(cfg)
print(json.dumps({key: result[key] for key in ("run_id", "build_state", "output_dir")}, indent=2))
PY
```

Conserva el punto, fechas y piloto de suelo del ejemplo integral, cambia las
fuentes habilitadas y usa una salida propia. No descarga MODIS, GPM ni SMAP.
Reutiliza la caché válida y consulta a los proveedores cuando corresponde.

## QA de esa configuración

```bash
RUN_DIR="data/wofost_handoff_guanajuato/guanajuato_valle_demo/runs/MI_RUN_ID"
python -m gradientdescentfarmers.source_builder.core.wofost_source_check \
  --run-dir "$RUN_DIR"
```

El gate espera 731 días de POWER de 2024–2025, cinco muestras SRTM y 24
combinaciones SoilGrids (ocho propiedades por tres profundidades), además de
integridad de todas las tablas declaradas. `lean_source_qa_ready=true` evalúa
ese paquete ambiental, sin aprobar PCSE. El auditor de baseline completo espera
fuentes adicionales y no es un gate adecuado para esta selección ligera.

Para otras fechas o propiedades de suelo, adaptar la evaluación a los settings.
Para publicar un nuevo paquete aprobado, consultar [GCS_STORAGE.md](GCS_STORAGE.md).
Cultivo/sitio, agromanagement y el adaptador meteorológico PCSE siguen siendo
entregables separados.

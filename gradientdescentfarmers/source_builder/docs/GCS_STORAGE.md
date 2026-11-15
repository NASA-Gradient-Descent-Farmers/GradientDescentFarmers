# Publicación de FarmProfile en Google Cloud Storage

La adquisición y la publicación son pasos separados. El comando
`python -m gradientdescentfarmers.source_builder --config ... --run`
exporta localmente. No hay una subida implícita ni un job de GCP instalado.

## Bucket y entrega existente

Bucket usado: **`gs://data_dump_samples`**.

```text
gs://data_dump_samples/farm_profiles/guanajuato_valle_demo/runs/67b66942681a4214/
```

Contiene 31 archivos de contenido verificados, más `gcs_upload_receipt.json`.
El recibo registra el run, commit de adquisición, hashes y resultado de la
lectura de vuelta. La entrega puede consumirse sin repetir la adquisición
ni sobrescribir sus objetos.

## Cómo se automatizó esa subida

Después del run se ejecutaron dos scripts locales de la sesión:

1. `data/guanajuato_resume/finalize_delivery.py` auditó el run, comprobó clima,
   terreno, suelo, calendarios MODIS, GPM y SMAP, y preparó reportes, documentación,
   `delivery_manifest.json` y `SHA256SUMS`.
2. `data/guanajuato_resume/publish_delivery.py` leyó el destino de
   `resume_context.json`, comprobó los hashes locales y creó los objetos con
   `if_generation_match=0`. Reutilizó solo objetos con el mismo contenido;
   publicó `farm_profile.json` al final, descargó cada archivo para comparar
   SHA-256 y generó el recibo después de aprobar la verificación.

El publicador usó la identidad activa de `gcloud` mediante un token en memoria.
No borró objetos, cambió permisos ni subió cachés, credenciales o históricos.
Los scripts de `data/` son herramientas locales específicas de la sesión;
no forman parte de la distribución del repositorio ni son una interfaz
estable de publicación para cualquier configuración.

## Autenticación y otro proyecto GCP

Para los comandos de terminal:

```bash
gcloud auth login
```

La cuenta debe tener permisos `storage.objects.create`, `storage.objects.get`
y `storage.objects.list` sobre el bucket/prefijo. En esta entrega se comprobaron
esos permisos aunque el bucket está en otro proyecto. No fue necesario cambiar
el proyecto activo ni solicitar acceso administrativo al bucket.

Para clientes Python que usan **Application Default Credentials (ADC)**:

```bash
python -m pip install -e '.[gcs]'
gcloud auth application-default login
```

`gcloud auth login` y ADC son mecanismos distintos. La clase `GCSStorage`
usa ADC por defecto; el publicador de esta sesión usó un token de `gcloud`.
Las credenciales permanecen fuera del paquete de datos.

## Publicar otro run completo con la CLI

Primero aprobar integridad y QA para las fuentes y ventanas elegidas. Publicar
el directorio exacto del run bajo un prefijo nuevo y conservar los reportes
con el mismo manifiesto. Sustituir los identificadores de este ejemplo:

```bash
RUN_DIR="data/processed/mi_predio/runs/MI_RUN_ID"
DEST="gs://data_dump_samples/farm_profiles/mi_predio/runs/MI_RUN_ID"

# Vista previa: no copia archivos.
gcloud storage rsync "$RUN_DIR" "$DEST" --recursive --dry-run

# Copiar contenido; publicar el manifiesto solo si terminó la copia.
gcloud storage rsync "$RUN_DIR" "$DEST" \
  --recursive --no-clobber --exclude='^farm_profile[.]json$' && \
  gcloud storage cp "$RUN_DIR/farm_profile.json" "$DEST/farm_profile.json" \
    --if-generation-match=0
```

La condición de creación rechaza un manifiesto existente. `--no-clobber` evita
sobrescribir los demás objetos. Esta alternativa copia todos los archivos del
directorio, incluidos los reportes QA preparados; debe apuntar exclusivamente
a un paquete revisado, nunca a todo `data/`. La CLI no genera el recibo SHA-256
del publicador local anterior. Antes de confirmar una nueva entrega, verificar
los archivos remotos contra el manifiesto local; si existe `SHA256SUMS`, se
puede descargar una copia y comprobarla con `shasum -a 256 -c SHA256SUMS`.

## API Python del repositorio

`core/storage.py::GCSStorage` sube y recupera el paquete básico exportado por
el builder. Comprueba hashes de tablas, crea objetos sin sobrescribir y publica
`farm_profile.json` al final:

```python
from gradientdescentfarmers.source_builder.core.storage import GCSStorage

storage = GCSStorage("data_dump_samples", prefix="profiles")
result = storage.upload_profile("data/processed/mi_predio/runs/MI_RUN_ID")
print(result["manifest_uri"])
```

Su formato actual es `gs://<bucket>/<prefix>/<farm_id>/<run_id>/`; con estos
argumentos sería `gs://data_dump_samples/profiles/mi_predio/MI_RUN_ID/`.
Incluye los seis archivos básicos de reporte/manifiesto y las tablas declaradas.
No incluye automáticamente reportes adicionales como `handoff_report.json`
ni el recibo del publicador de la sesión. La copia completa anterior y la
entrega existente usan `farm_profiles/<farm_id>/runs/<run_id>/`.

`output_root` y `cache_root` siguen siendo rutas locales bajo `data/`;
no reciben URIs `gs://`. La configuración del terreno vive en `resources/`.

# FarmProfileBuilder en GCP

El builder científico corre en una VM de Compute Engine. Un servicio HTTP recibe
solicitudes y un worker independiente descarga, valida y publica los perfiles.
La petición HTTP termina inmediatamente con un `job_id`; no espera las descargas.
Esta integración no activa SIAP ni DENUE, ni ejecuta WOFOST o el optimizador.

## Recursos y organización

| Recurso | Configuración |
|---|---|
| Proyecto | `gdfarming` (nombre visible: GDfarming) |
| Bucket privado | `gs://gdfarming-farm-data` |
| Región / zona | `us-central1` / `us-central1-a` |
| VM | `farm-profile-builder`, `e2-standard-4`: 4 vCPU, 16 GB RAM |
| Disco del sistema | 20 GB |
| Disco persistente de datos | `farm-builder-data`, 100 GB, conservado al eliminar la VM |
| Cuenta de servicio | `farm-profile-builder@gdfarming.iam.gserviceaccount.com` |
| Credenciales NASA | Secret Manager: `farm-builder-earthdata`; nunca dentro de los JSON ni del código |
| Red | `farm-builder-vpc`, subred `farm-builder-subnet` |
| HTTP | Puerto 8080; entrada permitida solo desde IAP, igual que SSH |

El nombre del bucket no necesita número: se eligió `gdfarming-farm-data` porque
estaba disponible. Los nombres de bucket son globales, aunque pertenezcan a un
proyecto específico. Todos los comandos de despliegue indican `--project` y no
cambian el proyecto activo de tu CLI.

```text
gs://gdfarming-farm-data/
  inputs/<job_id>/
    config.json
    farmer_input.json
    settings.json
    status.json                  # Estado mutable del trabajo
  farm_profiles/<farm_id>/runs/<run_id>/
    farm_profile.json
    standardized/
    availability.json
    validation.json
    provenance.json
    model_readiness.json
    feature_catalog.csv
    audit_report.json
    handoff_report.json
    cloud_execution.json
    delivery_manifest.json
    SHA256SUMS
    upload_receipt.json
  deployment/releases/<version>/source.tar.gz
```

`deployment/` contiene únicamente el código empaquetado necesario para reproducir
el despliegue. No se crean directorios ni datasets SIAP o DENUE. Los prefijos de
GCS aparecen cuando se publica su primer archivo; no requieren carpetas vacías.

En la VM, el disco de datos se monta en `/srv/farm-profile-builder/`:

```text
inputs/<job_id>/                  # Los tres documentos normalizados
profiles/<farm_id>/runs/<run_id>/  # Resultados locales antes de publicar
cache/                           # Descargas satelitales y caché HTTP reutilizables
jobs.sqlite                      # Cola persistente
worker.lock                      # Impide dos workers simultáneos
worker.heartbeat
```

El código queda en `/opt/farm-profile-builder/`, con un entorno Python y una
versión identificada por SHA256. El caché pesado permanece en disco: no se sube
al bucket como parte de los perfiles ni se borra al terminar una ejecución.

## Cómo se despliega

Desde la raíz del repositorio, con acceso al proyecto y facturación habilitada:

```bash
gcloud auth login
python -m pip install -e '.[source,source-modis,gcs,source-cloud,source-test]'

# Preparación local: genera el archivo de código y su SHA, sin crear recursos.
python -m gradientdescentfarmers.source_builder.cloud.deploy_vm

# Crear el despliegue en GCP.
python -m gradientdescentfarmers.source_builder.cloud.deploy_vm \
  --project gdfarming \
  --bucket gdfarming-farm-data \
  --zone us-central1-a \
  --apply
```

El script habilita las APIs, comprueba que el bucket pertenece al proyecto,
crea una identidad exclusiva, red y firewall, disco y VM. Empaqueta únicamente
código, configuraciones y documentación; excluye `.env`, `.git`, `data/`, el
frontend y notebooks. Guarda el recibo local en `data/gcp_deploy/<version>/`.

Las credenciales Earthdata se leen del entorno o del `.env` local ignorado por
Git, con la precedencia habitual del builder. Se transfieren a Secret Manager
por stdin. La VM obtiene esa versión mediante su cuenta de servicio; no hay
llaves JSON de GCP ni tokens personales de `gcloud` dentro de la VM.

La cuenta de servicio recibe acceso a objetos únicamente en este bucket y acceso
únicamente al secreto NASA correspondiente. El script de arranque verifica el
SHA del paquete, instala las dependencias y habilita dos servicios systemd:
`farm-builder-api` y `farm-builder-worker`.

`--apply` es para la creación inicial; no reemplaza una VM existente ni reinicia
trabajos activos. Antes de una actualización, esperar que termine la cola,
preparar una nueva versión y actualizar el código y los servicios durante una
ventana de mantenimiento. No borrar el disco ni las ejecuciones existentes.

## Conectarse al HTTP

Abrir una terminal y mantener este túnel autenticado:

```bash
gcloud compute start-iap-tunnel farm-profile-builder 8080 \
  --local-host-port=127.0.0.1:8080 \
  --project=gdfarming --zone=us-central1-a
```

Desde otra terminal:

```bash
curl --fail http://127.0.0.1:8080/healthz
```

La documentación interactiva está en `http://127.0.0.1:8080/docs` mientras el
túnel esté abierto. Se necesita permiso IAP (`roles/iap.tunnelResourceAccessor`);
SSH requiere además los permisos OS Login correspondientes. No se abre 8080 a
Internet ni se publica el bucket.

Si el túnel se interrumpe, cerrarlo, abrirlo de nuevo y consultar el mismo
`job_id`. Los trabajos no dependen de la terminal ni de que tu computadora siga
encendida: continúan en los servicios de la VM.

Este HTTP está destinado al operador y al backend. La interfaz web y WhatsApp
necesitarán después un backend público autenticado que registre solicitudes y
consulte resultados; no deben conectarse directamente a una VM privada.

## Qué recibe la VM

`POST /jobs`, `Content-Type: application/json`, recibe los tres documentos como
objetos JSON, no rutas del equipo del usuario:

```json
{
  "config": {"source": {}},
  "farmer_input": {
    "farm_id": "mi_parcela",
    "latitude": 25.763611,
    "longitude": -108.861389,
    "country_iso3": "MEX",
    "fields": [{"field_id": "parcela_01", "area_ha": 2}]
  },
  "settings": {
    "weather_start": "2024-01-01",
    "weather_end": "2025-12-31"
  },
  "idempotency_key": "mi-parcela-primer-run"
}
```

El ejemplo muestra la estructura; para reproducir el run integral usar el preset
completo de `resources/guanajuato_integrated_settings.json`. El cliente siguiente
lee los tres archivos relacionados por el JSON principal y envía sus contenidos:

```bash
python -m gradientdescentfarmers.source_builder.cloud submit \
  --config resources/mexico_norte_01_integrated.json \
  --idempotency-key gcp-mexico_norte_01-integrated-v1

python -m gradientdescentfarmers.source_builder.cloud submit \
  --config resources/mexico_norte_02_integrated.json \
  --idempotency-key gcp-mexico_norte_02-integrated-v1
```

También acepta `--farmer-input archivo.json`, `--settings archivo.json`,
`--url URL` y `--idempotency-key CLAVE`. Las claves de los ejemplos corresponden
a las pruebas ya ejecutadas: repetir esos comandos devuelve sus trabajos
existentes. Usar una clave nueva para crear otra ejecución.

Las rutas `output_root`, `cache_root`,
`input_files_root` o referencias a archivos incluidas en los JSON nunca se usan
para leer o escribir rutas arbitrarias de la VM: el servidor impone sus propios
directorios. Los tres documentos guardados incluyen los valores por defecto
normalizados y `cloud_execution.json` conserva la configuración efectiva.

La respuesta es HTTP 202, con `job_id` y `status: queued`. Sin clave explícita,
reenviar los mismos documentos devuelve el mismo trabajo. Una clave nueva permite
repetir una extracción conservando las anteriores. Reutilizar una clave con
documentos distintos devuelve HTTP 409. No se aceptan credenciales en `config`.
El límite de la petición es 2 MiB.

## Consultar el resultado y la subida automática

```bash
python -m gradientdescentfarmers.source_builder.cloud status TU_JOB_ID

curl --fail http://127.0.0.1:8080/jobs/TU_JOB_ID
```

Estados: `queued`, `running`, `succeeded`, `failed`. Mientras corre, `stage` y
`active_source` indican la fase y la fuente. La cola es SQLite sobre disco
persistente, con un solo worker para evitar descargas duplicadas. Si la VM se
reinicia, recupera los trabajos interrumpidos: reutiliza un perfil local terminado
o comienza otro run aprovechando el caché existente.

Después de la adquisición, el worker:

1. Verifica integridad y hashes; produce auditoría y handoff con las fechas de la solicitud.
2. Conserva el commit base, SHA del código exacto desplegado y hash de la solicitud.
3. Sube tablas y reportes al directorio versionado; publica `farm_profile.json` al final.
4. Descarga cada objeto y comprueba su SHA256; crea `upload_receipt.json`.
5. Devuelve `dataset_uri`, `manifest_uri`, `run_id`, `build_state` y `source_status`.

Los archivos de un run son inmutables. Una reanudación acepta objetos existentes
solo si sus bytes coinciden. Una diferencia o un fallo de integridad bloquea la
publicación. `status.json` sí se actualiza y es un espejo; la cola local es la
fuente de estado durante interrupciones de GCS.

`succeeded` significa que se generó y publicó el paquete, que puede tener
`build_state: partial` por cobertura o QA de las fuentes. Consultar siempre los
reportes; esto no certifica que PCSE/WOFOST esté listo ni que existan predicciones
agronómicas validadas. Si ninguna fuente produce datos utilizables, el trabajo
queda `failed` y conserva sus diagnósticos.

## Las dos ubicaciones de prueba

| Farm ID | Latitud | Longitud |
|---|---:|---:|
| `mexico_norte_01` | 25.763611 | -108.861389 |
| `mexico_norte_02` | 27.332202 | -110.162783 |

Se reutiliza el preset integral de Guanajuato para mantener las mismas ventanas:
POWER y MODIS 2024–2025; GPM 48 intervalos del 1 de julio de 2024 UTC y SMAP del
1–2 de julio de 2024. El nombre del preset no fija las coordenadas: provienen de
cada `farmer_input`. En ambos sitios, 1 ha es un campo técnico provisional
declarado en las notas, no superficie real ni base para ingresos totales.

## Operación y costos

```bash
# Acceso a la VM
gcloud compute ssh farm-profile-builder --tunnel-through-iap \
  --project=gdfarming --zone=us-central1-a

# Dentro de la VM
sudo systemctl status farm-builder-api farm-builder-worker
sudo journalctl -u farm-builder-worker -n 60 --no-pager
sudo journalctl -u google-startup-scripts.service -n 60 --no-pager
df -h /srv/farm-profile-builder
```

La VM genera cargos mientras está encendida; el disco y GCS siguen generándolos
aunque se detenga. Cuando no haya trabajos pendientes, se puede detener:

```bash
gcloud compute instances stop farm-profile-builder \
  --project=gdfarming --zone=us-central1-a
```

Para volver a usar el HTTP:

```bash
gcloud compute instances start farm-profile-builder \
  --project=gdfarming --zone=us-central1-a
```

La cola y el caché permanecen en el disco. No detener durante una entrega activa.
El bucket previo `data_dump_samples` y el run de Guanajuato publicado allí no se
modifican como parte de este despliegue.

## Verificación local

```bash
python -m pip install -e '.[source,source-modis,gcs,source-cloud,source-test]'
python -m pytest tests/source_builder tests/test_scaffold.py -q
```

Las pruebas nuevas cubren HTTP, validación, idempotencia, cola persistente,
publicación completa, reanudación tras reinicio y rechazo de datos alterados,
sin descargar fuentes ni requerir una cuenta GCP.

## Resultado de la primera prueba en GCP

Ejecutada el 15 de noviembre de 2026 UTC, todavía 14 de noviembre en México.
Las dos solicitudes terminaron con `status: succeeded`, integridad y QA base
correctos, y 28 archivos por run descargados y verificados independientemente
mediante SHA256. Ninguna de las nueve fuentes ambientales habilitadas terminó
con error.

| Farm ID | Job ID | Run ID |
|---|---|---|
| `mexico_norte_01` | `0d66836f517641babef44ee6575ae9f0` | `b50bfdf0a58240aa` |
| `mexico_norte_02` | `71403916a7b546d69435b7a984294a19` | `9849d2f76f944625` |

```text
gs://gdfarming-farm-data/farm_profiles/mexico_norte_01/runs/b50bfdf0a58240aa/
gs://gdfarming-farm-data/farm_profiles/mexico_norte_02/runs/9849d2f76f944625/
```

Ambos tienen 731 días POWER, los 46/92/92 compuestos MODIS esperados, el día GPM
con 48 intervalos completos y el snapshot SMAP. La cobertura de fechas MODIS es
completa; después de QA, las filas utilizables son:

| Fuente | Norte 01 | Norte 02 |
|---|---:|---:|
| MOD13Q1: NDVI/EVI | 45/46 | 46/46 |
| MOD11A2: LST día/noche | 60/92 | 48/92 |
| MOD16A2GF: ET/PET | 61/92 | 79/92 |

`build_state` es `partial`: se conservan los huecos de QA y las advertencias de
las fuentes. En MOD13Q1 se descartó un compuesto fuera de la ventana; SMAP no
incluye un percentil válido de humedad radicular, que no se imputó. Esto no es
un fallo de transferencia. La disponibilidad de fuentes no sustituye el adaptador
meteorológico y los parámetros de cultivo/sitio/manejo necesarios para PCSE.

El primer trabajo tardó aproximadamente 11 min 46 s; el segundo, 61 s,
reutilizando los gránulos del caché. Se verificó que ambos perfiles contienen
sus coordenadas respectivas y que sus mediciones meteorológicas son distintas.

El commit base del despliegue fue `fa9f850fce3a8f6575346b861d95d0c9ed3e500e`.
El paquete incluye el código nuevo de integración aún sin commit al desplegar;
su SHA256 identifica los bytes exactos, no solo el commit base:

```text
1845cee81b52bb6a6d34a26a6d6ca4a04689c3e02a44bdf7fa47a4e19522fae4
gs://gdfarming-farm-data/deployment/releases/fa9f850fce3a-1845cee81b52/source.tar.gz
```

Los recibos locales están en `data/gcp_deploy/`; el resumen independiente es
`cloud_trials_report.json` y las copias verificadas están bajo `verified/`.

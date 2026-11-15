# Fase 2: FarmProfile → WOFOST → SIAP → rotaciones

El servicio usa los perfiles existentes de GCS. No vuelve a descargar MODIS,
POWER ni los otros datos NASA. Añade adaptación meteorológica a PCSE, balance
de agua continuo, economía de referencia y selección de opciones explicables.

Los archivos originales de `model_builder/` y `optimizer_builder/` no cambian.
Las implementaciones están en sus nuevos subdirectorios `wofost_mvp/` y
`rotation_mvp/`. Este servicio las conecta sin modificar `app.py`.

## Ejecución local

Desde la raíz del repositorio, Python 3.11:

```bash
python -m pip install -e '.[rotations,gcs,source-cloud,source-test]'

# Con la copia previamente descargada y verificada del perfil.
python -m gradientdescentfarmers.rotations_service run \
  --profile-dir data/gcp_deploy/verified/farm_profiles/mexico_norte_01/runs/b50bfdf0a58240aa \
  --source-uri gs://gdfarming-farm-data/farm_profiles/mexico_norte_01/runs/b50bfdf0a58240aa \
  --config resources/rotation_mvp.json
```

También se puede usar `--profile-uri gs://...` para descargar el paquete con
Application Default Credentials. `gcloud auth login` autentica al CLI;
`gcloud auth application-default login` configura ADC para Python local. La VM
usa su cuenta de servicio, sin llaves ni credenciales personales. `--publish`
publica el paquete en el bucket de rotaciones.

Con datos locales, `--profile-dir` no necesita una sesión GCP. El entorno aislado
usado en desarrollo está en `data/phase2/venv`. PCSE crea su configuración y logs
estándar en el directorio del usuario que ejecuta el modelo.

Las primeras ejecuciones preparan los parámetros públicos y SIAP. Las siguientes
reutilizan el caché. Los recibos y resultados locales viven en `data/phase2/`.

## Despliegue independiente en GCP

| Recurso | Valor |
|---|---|
| Proyecto | `gdfarming` |
| VM | `farm-rotations`, `us-central1-a` |
| Máquina | `e2-standard-2`: 2 vCPU, 8 GB RAM |
| Disco de datos | `farm-rotations-data`, 30 GB persistentes |
| Bucket de entrada, solo lectura | `gs://gdfarming-farm-data` |
| Bucket de salida, privado | `gs://gdfarming-farm-rotations` |
| Cuenta de servicio | `farm-rotations@gdfarming.iam.gserviceaccount.com` |
| HTTP privado | Puerto 8081, protegido por IAP |

```bash
# Preparar paquetes locales y revisar sus hashes; no crea recursos.
python -m gradientdescentfarmers.rotations_service.deploy_vm

# Crear la VM y asignar permisos en los buckets del proyecto.
python -m gradientdescentfarmers.rotations_service.deploy_vm --apply
```

El despliegue empaqueta el código y un snapshot de referencias con hashes. No
incluye `.env`, `.git`, cachés NASA, frontend ni entornos virtuales. El servicio
de rotaciones tiene lectura sobre el bucket de perfiles y escritura solo en su
bucket. No recibe credenciales NASA ni acceso al secreto del builder.

El arranque verifica los paquetes, instala dependencias y comprueba que NumPy,
Pandas y PyArrow puedan trabajar juntos antes de iniciar los servicios
`farm-rotations-api` y `farm-rotations-worker`. Se fija PyArrow 20.0.0, probado
con NumPy 1.26: PyArrow 26 exige NumPy 2 y no sirve para este entorno de PCSE.
En la VM:

```text
/opt/farm-rotations/current/       código desplegado
/srv/farm-rotations/
  jobs.sqlite                    solicitudes persistentes
  profiles/<farm_id>/<run_id>/    copias verificadas del perfil
  reference/<snapshot_sha>/       parámetros y referencias SIAP/INEGI
  cache/models/<model_key>/       resultados físicos reutilizables
  runs/<farm_id>/<source_run_id>/<rotation_run_id>/
```

Un solo worker conserva el orden y evita duplicidad. Al reiniciar, recupera
trabajos interrumpidos y reutiliza un paquete terminado para completar la subida.
El disco no se elimina al borrar la VM. No se reemplaza una VM activa desde
`deploy_vm --apply`; las actualizaciones requieren terminar antes la cola.

## Encadenamiento automático

Cada 30 segundos el worker busca nuevos `upload_receipt.json` de perfiles
versionados en el bucket de entrada. Ese archivo aparece al terminar la subida
y verificación de la fase 1. Descarga el paquete, comprueba hashes y crea una
solicitud idempotente. No modifica los datos ni el código de la VM de adquisición.

Para enviar preferencias desde los mismos tres JSON de la UI, el documento
principal puede incluir:

```json
{
  "source": {},
  "model": {"rotation_mvp": {"horizon_years": 2}},
  "optimizer": {
    "rotation_mvp": {
      "weights": {"income": 30, "water": 20, "soil": 20, "pesticide": 10, "risk": 10, "climate": 10},
      "excluded_crops": [],
      "max_total_irrigation_mm": null
    }
  }
}
```

Ese objeto va dentro de `config` en el payload de la fase 1. El builder archiva
el documento completo; el worker de rotaciones lee las dos secciones después.
Sin ellas usa los valores por defecto y las preferencias del agricultor guardadas
en `farm_profile.json`. No se necesita un cuarto JSON ni un segundo trigger para
la ejecución automática.

Para otro predio se necesita un perfil con auditoría de integridad aprobada,
clima diario continuo de uno o dos años completos, elevación y propiedades de
suelo. El catálogo de esta versión tiene cuatro cultivos y hasta cuatro
campañas. Con `country_iso3: MEX` se habilita la economía SIAP; con otro país
o sin país identificado queda sin evaluación económica. Los polígonos incluidos
cubren Sinaloa y Sonora. Para otro estado mexicano se puede indicar
`model.rotation_mvp.state_id_hint`, por ejemplo `"11"` para Guanajuato: se
descarga el polígono oficial y se comprueba la coordenada. Sin resolución estatal
se declara una referencia nacional, nunca se inventa un municipio o precio local.

## Reoptimizar por HTTP sin repetir la adquisición

Abrir el túnel en una terminal:

```bash
gcloud compute start-iap-tunnel farm-rotations 8081 \
  --local-host-port=127.0.0.1:8081 \
  --project=gdfarming --zone=us-central1-a
```

Desde otra terminal:

```bash
curl --fail http://127.0.0.1:8081/healthz

python -m gradientdescentfarmers.rotations_service submit \
  --profile-uri gs://gdfarming-farm-data/farm_profiles/mexico_norte_01/runs/b50bfdf0a58240aa \
  --config resources/rotation_mvp.json

python -m gradientdescentfarmers.rotations_service status TU_JOB_ID
```

`POST /jobs` recibe:

```json
{
  "source_profile_uri": "gs://gdfarming-farm-data/farm_profiles/mexico_norte_01/runs/b50bfdf0a58240aa",
  "model": {},
  "optimizer": {
    "max_irrigation_mm_per_campaign": 500,
    "costs_mxn_ha": {},
    "budget_mxn_ha": null
  },
  "idempotency_key": "norte01-prioridades-agua-v1"
}
```

Devuelve HTTP 202 con `job_id`. `GET /jobs/{job_id}` consulta la solicitud;
`GET /source-runs/{source_run_id}` encuentra la más reciente para ese perfil.
Puede devolver 404 hasta que el observador detecte el nuevo run. Reintentar con
la misma clave evita duplicados; una clave nueva permite otra evaluación.
HTTP 409 indica una clave reutilizada con datos distintos; 422, datos inválidos;
413, más de 1 MiB. El servicio es privado: la UI llama a su propio backend.

Los estados son `queued`, `running`, `succeeded`, `failed`. `stage`, `completed`
y `total` describen el avance dentro de una etapa. `succeeded` confirma una
evaluación publicada, no su validación en campo. Un resultado puede tener
`rotation_status: no_feasible_options`: mostrar su explicación, sin inventar
una recomendación que incumpla límites.

## Salida para Isaac, la UI y WhatsApp

```text
gs://gdfarming-farm-rotations/
  farm_rotations/<farm_id>/source_runs/<source_run_id>/runs/<rotation_run_id>/
    rotations.json             contrato principal para la UI
    whatsapp_summary.txt       texto para el futuro chatbot; no envía mensajes
    candidate_metrics.csv      comparación de opciones factibles
    economic_reference.csv     precios efectivamente usados
    pcse_weather_daily.csv     WeatherDataProvider exportado, con unidades PCSE
    soil_parameters.json
    model_evaluations.jsonl    todos los escenarios físicos y riegos
    confidence.json
    validation.json
    source_validation.json
    simulation_rejections.json
    financial_provenance.json
    crop_parameter_manifest.json
    geography.json
    provenance.json
    request.json
    README.md
    manifest.json
    SHA256SUMS
    upload_receipt.json
  status/source_runs/<source_run_id>.json
  latest/<farm_id>.json
  deployment/releases/<code_sha>/source.tar.gz
  reference/releases/<snapshot_sha>/reference.tar.gz
```

La publicación verifica hashes locales y lee cada objeto de vuelta. Se publica
`manifest.json` al final y después el recibo. Los archivos de un run no se
sobrescriben. `latest` y `status` son punteros mutables, no los datasets.

La UI debe:

1. Mantener el `source_run_id` devuelto por la fase 1 y consultar el estado de
   fase 2. Si no existe aún, mostrar «Esperando evaluación».
2. Cuando termine, leer `result.rotations_uri` desde el backend con su identidad
   GCP. También puede usar `latest/<farm_id>.json`, **comprobando que corresponda
   al mismo `source_run_id` y preferencias solicitadas**.
3. Mostrar `options`, separadas por `water_regime`, y usar `description_es`,
   `highlights_es`, `highlight_objectives` y `planning_year` para las tarjetas.
4. Mostrar calendario relativo con `sowing_month_day`, `calendar_end_month_day`,
   `planning_year` y `planning_year_end`. Las fechas `historical_*` pertenecen
   al ensayo con clima pasado y no se deben anunciar como fechas futuras.
5. Mostrar `economics.gross_median_mxn_ha`, P10/P90 y moneda como **ingreso bruto
   de escenario por hectárea y por el horizonte completo**. Los valores nulos
   significan «sin datos», nunca cero. No confundirlo con utilidad neta.
6. Diferenciar riego aplicado (`irrigation_gross_m3_ha`) de consumo total
   (`evapotranspiration_mm`). En temporal no hay riego, pero sí uso de lluvia.
7. Mostrar `confidence.label_es` y las razones. `priority_score` representa
   afinidad con prioridades; no es un porcentaje de éxito. Los indicadores
   de suelo y pesticidas son proxies; no mostrarlos como reducciones medidas.
8. Señalar `high_risk_experiment`, `failed_harvests` y necesidad de confirmar
   infraestructura de riego. No ocultar campañas fallidas ni convertir las
   opciones experimentales en un plan operativo aprobado.

El backend de la aplicación debe autorizar la finca y los jobs por usuario,
usar VPC/pasarela autenticada para estos HTTP privados y entregar los JSON o
URLs firmadas temporales. No poner credenciales en el navegador ni hacer
públicos los buckets. Esa pasarela de la web todavía corresponde a la integración
de la UI. El dominio GoDaddy y WhatsApp no se configuran desde este servicio.

La confianza actual es baja: parámetros de referencia sin calibración local,
clima histórico corto y precios estatales redistribuidos. No hay porcentajes
calibrados de éxito, ahorro medido de pesticidas o mejora física garantizada
del suelo. Ver [modelo](../model_builder/wofost_mvp/README.md) y
[economía, riesgo y optimización](../optimizer_builder/rotation_mvp/README.md).

## Operación

```bash
gcloud compute ssh farm-rotations --tunnel-through-iap \
  --project=gdfarming --zone=us-central1-a

# Dentro de la VM
sudo systemctl status farm-rotations-api farm-rotations-worker
sudo journalctl -u farm-rotations-worker -n 60 --no-pager
```

La VM de adquisición y la de rotaciones son independientes. Ambas deben estar
encendidas para la cadena completa. Para detener la segunda cuando no haya
trabajos activos, usar `gcloud compute instances stop farm-rotations
--project=gdfarming --zone=us-central1-a`; sus discos y GCS se conservan y siguen
generando cargos. No detenerla mientras se espera el encadenamiento automático.

```bash
python -m pytest tests/rotations -q
```

Las pruebas son offline: unidades PCSE, rechazo de huecos meteorológicos,
retención de suelo, normalización SIAP, restricciones, Pareto, idempotencia,
recuperación y publicación inmutable. La aceptación también incluye ejecuciones
reales sobre los dos perfiles GCP.

## Pilotos verificados el 15 de noviembre de 2026

La fase 1 quedó guardada en `acd94e9`. El código exacto desplegado de fase 2 se
identifica con el SHA256 de paquete
`d2cee6eac3fbea741f19938bb15580af906569be1ae93e730bf567da689f619e`;
`source_manifest.json` registra los hashes de sus archivos, incluidos los cambios
de implementación que todavía no tenían commit al preparar el paquete.

| Predio | Coordenadas | Municipio INEGI | Run ambiental | Run de rotaciones | Opciones riego / temporal |
|---|---|---|---|---|---|
| `mexico_norte_01` | 25.763611, -108.861389 | Juan José Ríos, Sinaloa | `b50bfdf0a58240aa` | `be357172bae941c1` | 3 / 5 |
| `mexico_norte_02` | 27.332202, -110.162783 | Bácum, Sonora | `9849d2f76f944625` | `5abb561d6ead496b` | 5 / 2 |

Paquetes publicados:

```text
gs://gdfarming-farm-rotations/farm_rotations/mexico_norte_01/source_runs/b50bfdf0a58240aa/runs/be357172bae941c1/
gs://gdfarming-farm-rotations/farm_rotations/mexico_norte_02/source_runs/9849d2f76f944625/runs/5abb561d6ead496b/
```

En ambos casos se verificaron 731 días de clima, 40 simulaciones sin fallos
físicos y cierre de agua menor de `1e-5 cm`. Se descargaron los 20 objetos de
cada paquete para comprobar sus hashes desde fuera de la VM. Repetir el mismo
`POST /jobs` devolvió el job existente. Las 150 pruebas locales del repositorio
pasaron. La corrección inicial de PyArrow conservó los jobs y el caché físico.

Los recibos y la comprobación independiente están en
`data/phase2/cloud_trials_report.json`; las copias descargadas, en
`data/phase2/verified/`. `rotations.json` y `whatsapp_summary.txt` ya se pueden
consumir desde el backend de la UI. Esta entrega comprueba el funcionamiento del
pipeline; las opciones siguen siendo experimentales y sin validación en campo.

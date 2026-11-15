# Source Builder: despliegue y operación

La guía para ejecutar FarmProfileBuilder en Google Cloud está en
[GCP_VM_DEPLOYMENT.md](GCP_VM_DEPLOYMENT.md). Explica el despliegue por CLI,
las credenciales NASA, el HTTP, los tres JSON de entrada, la cola y la subida
automática de perfiles a `gs://gdfarming-farm-data` en el proyecto `gdfarming`.

Para conectarse al servicio desplegado:

```bash
gcloud compute start-iap-tunnel farm-profile-builder 8080 \
  --local-host-port=127.0.0.1:8080 \
  --project=gdfarming --zone=us-central1-a
```

En otra terminal, enviar una ubicación:

```bash
python -m gradientdescentfarmers.source_builder.cloud submit \
  --config resources/mexico_norte_01_integrated.json \
  --idempotency-key gcp-mexico_norte_01-integrated-v1

python -m gradientdescentfarmers.source_builder.cloud status TU_JOB_ID
```

El servicio recibe `config`, `farmer_input` y `settings` como objetos JSON.
Devuelve un `job_id` para consultar el progreso y, al terminar, la ruta GCS del
run y sus reportes QA. SIAP y DENUE quedan fuera de este despliegue.

## Contrato para Isaac y la UI

La UI debe generar una solicitud con **tres objetos JSON**: `config`,
`farmer_input` y `settings`, más una `idempotency_key` por solicitud. No debe
enviar rutas locales ni obligar al agricultor a escribir archivos JSON.

Flujo de integración:

1. El agricultor selecciona un punto en el mapa y registra la superficie de la
   parcela. La UI genera un `farm_id` estable, un `field_id` y una clave UUID de
   solicitud. Conservar esa clave al reintentar la misma petición.
2. El navegador envía los tres objetos a **un backend de la aplicación**, por
   ejemplo `POST /api/farm-profiles`. El backend autentica al usuario y llama a
   `POST /jobs` del builder. Ese endpoint de la aplicación es una propuesta que
   Isaac debe implementar; el builder ya tiene `/jobs`.
3. El backend devuelve el `job_id`. La UI guarda el identificador y consulta
   el estado cada 5–10 segundos mediante su backend, que consulta
   `GET /jobs/{job_id}` del builder.
4. Mostrar `queued`, `running`, `succeeded` o `failed`. Mientras corre,
   `stage` y `active_source` sirven para traducir el progreso a mensajes simples.
   Al completar, conservar `result.dataset_uri`, `result.run_id`,
   `result.build_state`, `result.source_status` y los indicadores de QA.
5. Un resultado `partial` puede contener datos útiles y no se debe presentar
   como un error de red ni como información completa. Leer las advertencias.

**Acceso actual:** la VM tiene HTTP privado protegido por IAP. El navegador no
puede llamarla directamente. Para desplegar el backend de la UI en GCP hay que
configurar su conectividad a la VPC y autorizar exclusivamente su acceso a 8080,
o proporcionar una pasarela autenticada. Ese puente público aún no está
desplegado. No poner credenciales de GCP/NASA, claves privadas, el CLI `gcloud`
ni acceso directo al bucket en el código del navegador.

### Datos del formulario y valores del backend

| Dato | Quién lo proporciona | Regla |
|---|---|---|
| `latitude`, `longitude` | Mapa / ubicación compartida | Números; latitud −90..90, longitud −180..180 |
| `farm_id` | Aplicación | Identificador estable ASCII, 1–80 caracteres, letras/números/`_`/`-` |
| `fields[].field_id` | Aplicación | ID único dentro de la finca |
| `fields[].area_ha` | Agricultor | Número mayor que cero en hectáreas |
| `country_iso3` | Geocodificación verificada o agricultor | ISO3, por ejemplo `MEX`; necesario para World Bank; no fijar México para todos los puntos |
| `irrigation` | Agricultor, si se conoce | `rainfed`, `irrigated`, `mixed`, `unknown` |
| Preferencias y restricciones | Agricultor, opcionales | Cultivos permitidos/excluidos, presupuesto, agua y prioridades |
| `settings` | Backend / preset versionado | Fuentes, fechas y límites de adquisición; no son un formulario técnico para el agricultor |

Una coordenada no determina la superficie real. Para una demo con superficie
desconocida puede usarse el campo técnico de 1 ha, declarándolo en
`farmer_notes`; mostrar resultados por hectárea y no presentarlo como superficie
medida ni calcular ingresos totales sobre ese dato provisional.

### Ejemplo completo de petición

El backend puede cargar el preset versionado de
`resources/guanajuato_integrated_settings.json`: el nombre no fija la ubicación.
Este ejemplo reproduce las nueve fuentes y ventanas de las pruebas integrales:

```json
{
  "config": {"source": {}},
  "farmer_input": {
    "farm_id": "mi_parcela_001",
    "mode": "basic",
    "latitude": 25.763611,
    "longitude": -108.861389,
    "country_iso3": "MEX",
    "fields": [{"field_id": "parcela_01", "area_ha": 2}],
    "irrigation": "unknown",
    "crop_preferences": [],
    "constraints": {
      "allowed_crops": [], "excluded_crops": [],
      "max_irrigation_mm": null, "max_rotation_seasons": 3
    },
    "objective_weights": {
      "profit": 30, "downside_risk": 20, "water": 15,
      "soil_health": 20, "climate_resilience": 15
    },
    "language": "es"
  },
  "settings": {
    "source_overrides": {
      "nasa_power": true, "srtm": true, "soilgrids_wcs": true,
      "modis_mod13q1": true, "modis_mod11a2": true,
      "modis_mod16a2gf": true, "gpm_imerg_v07": true,
      "smap_l4": true, "worldbank_agriculture": true,
      "usda_quickstats": false, "faostat_production": false,
      "faostat_prices": false, "grace_fo_mascon": false,
      "nex_gddp_cmip6": false, "modis_landcover": false
    },
    "modis_provider": "earthaccess",
    "weather_start": "2024-01-01", "weather_end": "2025-12-31",
    "modis_start": "2024-01-01", "modis_end": "2025-12-31",
    "modis_max_granules": 150,
    "gpm_start": "2024-07-01T00:00:00",
    "gpm_end": "2024-07-01T23:59:59", "gpm_max_granules": 48,
    "smap_start": "2024-07-01", "smap_end": "2024-07-02",
    "smap_max_granules": 2,
    "soil_scope": "pilot", "soil_max_requests": 24,
    "cache_enabled": true, "export_format": "csv"
  },
  "idempotency_key": "5edaa175-ae45-4447-b45e-617db81faf6b"
}
```

Las cinco prioridades suman 100. Si se incluye `budget`, se debe incluir
`currency` (por ejemplo `MXN`). El builder conserva esos datos para la fase de
modelos; adquirir fuentes no produce todavía una recomendación de rotación.
Mantener presupuesto y otros límites como restricciones explícitas: un precio
SIAP no proporciona costos para comprobar automáticamente un presupuesto.

### Ejemplo de la lógica del navegador

```typescript
// El payload lo compone la aplicación con el formulario y el preset anterior.
// Guardar la misma idempotency_key hasta que la solicitud termine.
const response = await fetch('/api/farm-profiles', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});
if (!response.ok) throw new Error('No se pudo registrar la solicitud');
const job = await response.json(); // { job_id, status, ... }

// Consultar desde el backend de la aplicación, no desde una URL privada de VM.
const progress = await fetch(`/api/farm-profiles/${job.job_id}`)
  .then(r => r.json());
```

El backend debe vincular cada `job_id` a su usuario, comprobar autorización al
consultar resultados y leer GCS con su identidad de servicio. Entregar JSON al
cliente o enlaces firmados temporales autorizados, sin hacer público el bucket.
Los campos `gs://...` son identificadores de almacenamiento, no enlaces de
descarga HTTP que el navegador pueda abrir directamente.

Errores del builder: HTTP 422 para JSON/datos inválidos, 409 si se reutiliza una
clave con contenidos distintos y 413 si la petición supera 2 MiB. Un timeout al
enviar no implica que el trabajo haya fallado: reintentar con la misma clave.
Cerrar el navegador no cancela el trabajo. No mostrar un porcentaje ficticio:
la API actual informa etapas, no un porcentaje de descarga certificado.

Otras referencias:

- [Entradas, fuentes y uso local](../README.md).
- [Contrato del perfil](FARM_PROFILE_CONTRACT.md).
- [Entrega de datos a WOFOST](WOFOST_DATA_HANDOFF.md).

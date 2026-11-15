# Entrega ambiental de Guanajuato para WOFOST

Run: `67b66942681a4214` · FarmProfile: `2.0.0` · Estado del builder: `partial`.

Commit que ejecutó este nuevo run: `396f2968e81678a099e13d104e2ac3fd077db06d`.
El intento interrumpido tenía como referencia `e07e32b`; sus descargas válidas se reutilizaron.

El paquete pasó integridad SHA-256, QA por tabla, clima diario 2024–2025 (731 días),
calendarios MODIS de 46/92/92 composiciones, GPM con los 48 intervalos UTC exactos
del 1 de julio de 2024 y el snapshot SMAP solicitado. La máscara QA conserva
observaciones faltantes: consultar cobertura por producto en `handoff_report.json`.
La disponibilidad parcial por QA no se convierte en datos inventados.

| Tabla ambiental | Filas | Fuente |
| --- | ---: | --- |
| country_agriculture_context | 192 | worldbank_agriculture |
| evapotranspiration | 92 | modis_mod16a2gf |
| gpm_daily | 1 | gpm_imerg_v07 |
| gpm_half_hourly | 48 | gpm_imerg_v07 |
| land_surface_temperature | 92 | modis_mod11a2 |
| soil_moisture_timeseries | 2 | smap_l4 |
| soil_properties_raw | 24 | soilgrids_wcs |
| topography_samples | 5 | srtm |
| vegetation_timeseries | 46 | modis_mod13q1 |
| weather_daily | 731 | nasa_power |

## Consumo

Fijar este `run_id`, comprobar `SHA256SUMS` y leer exclusivamente las rutas
declaradas en `farm_profile.json["tables"]`. Cada tabla conserva unidades,
resolución, procedencia y QA. `latest.json` no forma parte de esta entrega.

`weather_daily` contiene temperatura en °C, precipitación en mm/día,
radiación en MJ/m²/día, humedad relativa en % y viento en m/s.
El equipo PCSE debe fijar versión y modelo, convertir las unidades exigidas,
derivar/verificar VAP y calcular E0/ES0/ET0 con su proveedor meteorológico.
También debe aportar cultivo/variedad, parámetros de sitio y agromanagement;
WLP requiere además hidráulica de suelo y agua inicial verificadas.
Los indicadores `wofost_pp_input_ready` y `wofost_wlp_input_ready` siguen en `false`.

La coordenada es una referencia regional (20.4243195, -101.1466639).
El campo de 1 ha es un placeholder de esquema y no una parcela observada.
Las observaciones satelitales y SoilGrids conservan su escala regional.

## Contenido y trazabilidad

Se incluyen el manifiesto original, `standardized/`, disponibilidad, validación,
procedencia, requisitos de modelo y catálogo, junto con auditoría,
`handoff_report.json`, QA de clima/suelo, procedencia de ejecución y la guía WOFOST.
`delivery_manifest.json` y `SHA256SUMS` cubren los archivos de esta entrega.
No contiene cachés HDF4/HDF5, credenciales ni runs históricos.
`delivery_status.json` registra la verificación previa a la transferencia.
La subida a GCS se confirma por separado en `gcs_upload_receipt.json`.

# MODIS mediante NASA Earthdata y earthaccess

El proveedor `modis_provider="earthaccess"` consulta NASA CMR y LP DAAC para
MOD13Q1.061, MOD11A2.061 y MOD16A2GF.061. El ejemplo integral lo configura en
`resources/guanajuato_integrated_settings.json`.

## Método

1. Buscar gránulos por punto y ventana temporal.
2. Filtrar por fecha de adquisición: CMR puede devolver una composición que
   se solapa con la ventana pero empieza antes de ella.
3. Reutilizar HDF4 válidos o descargarlos en nuevas carpetas
   `data/cache/earthdata/modis/<producto>/recovery/attempt-*/`.
4. Proyectar el punto WGS84 a MODLAND sinusoidal, comprobar el tile y leer
   un píxel por capa con `pyhdf.SD`.
5. Conservar ciencia y QA nativas y aplicar `standardize_mod13`,
   `standardize_mod11` y `standardize_mod16`.

`earthaccess` hace la búsqueda y descarga; `pyhdf` lee HDF4 y `pyproj` resuelve
la geolocalización. Rasterio sigue siendo necesario para SoilGrids, pero su
controlador HDF4 no es requisito para MODIS.

```bash
python -m pip install -e '.[source,source-test,source-modis]'
python -m gradientdescentfarmers.source_builder \
  --config resources/guanajuato_integrated.json --run
```

Ese comando ejecuta **todas las fuentes del preset integral**. El preset piloto
de dos gránulos se retiró. Para un diagnóstico acotado, duplicar la configuración
según el README, habilitar solo los tres productos MODIS y reducir
`modis_max_granules`; esa prueba no demuestra una serie completa. Mantener su
salida separada de los runs aprobados.

## Inspección y ejemplo auditado

El notebook vigente es `notebooks/guanajuato_pipeline_validation.ipynb`, con
adquisición desactivada por defecto. `core/modis_earthaccess.py` también expone
`list_science_datasets(path)` para inspeccionar capas y dimensiones sin cargar
arrays completos. El notebook de discovery anterior se retiró.

El run `67b66942681a4214` tiene calendarios 2024–2025 completos: 46/92/92
composiciones. Pares utilizables tras QA: 41 NDVI/EVI, 67 LST día/noche y
79 ET/PET. Los faltantes de QA permanecen como tales; el inventario completo
no garantiza que cada observación sea utilizable.

Revisar `availability.json`, `validation.json`, `provenance.json` y
`handoff_report.json` del mismo run para diferenciar búsqueda, autenticación,
descarga, extracción y calidad. Ver el [README general](../README.md) para
adaptar el punto y el periodo.

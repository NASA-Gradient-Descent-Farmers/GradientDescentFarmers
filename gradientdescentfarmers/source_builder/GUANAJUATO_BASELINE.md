# SourceBuilder — piloto Guanajuato

- Rama de desarrollo: `daniel-sourcebuilder`.
- Punto de referencia: latitud `20.4243195`, longitud `-101.1466639` (Guanajuato, México).
- El punto es una **referencia geográfica**, no una parcela verificada.
- La salida se guardará en la carpeta `data/` de la raíz del repositorio.
- No se inventarán historial de cultivos, riego, superficie ni rendimientos reales.
- Orden de validación: baseline ambiental → GPM/SMAP smoke → GPM full-day → QA y auditoría → integración.
- Mantener las descargas científicas crudas, tokens y secretos fuera del repositorio.

El código científico anterior se encuentra en `NASA-warm-up/farmadapt_v2/` y se migrará mediante un adaptador del contrato `SourceBuilder.build(config)`.

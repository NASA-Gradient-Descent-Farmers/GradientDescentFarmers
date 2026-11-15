# WOFOST MVP

Implementación nueva de `ModelBuilder`; no modifica `model_builder/base.py` ni
el punto de integración existente. Recibe un FarmProfile exportado y verificado.

Hace una simulación **real de PCSE 6.0.13 / WOFOST 7.2 con balance de agua
continuo (CWB)**. No suma simulaciones de cultivos aislados: conserva el agua del
suelo entre campañas y durante barbechos. Temporal y riego usan el mismo modelo;
en riego se envían eventos al balance según el agotamiento de humedad configurado.

Entradas y preparación:

- `weather_daily`: RAIN mm→cm, IRRAD MJ→J, viento POWER a 2 m sin convertir.
  VAP se deriva de humedad relativa media mediante la aproximación FAO-56,
  ecuación 19. E0/ES0/ET0 se calculan con `pcse.util.reference_ET` y se convierten
  de mm a cm. Se rechazan días faltantes, duplicados o mediciones inválidas.
- SRTM aporta elevación. SoilGrids aporta `wv0033` y `wv1500` en vol%, densidad,
  textura y carbono. Se ponderan las capas 0–5, 5–15 y 15–30 cm. La porosidad se
  estima con densidad de partículas de 2.65 g/cm³. Si faltan ambas retenciones,
  hay un pedotransfer explícito Saxton–Rawls; nunca se usa para ocultar valores
  de retención presentes pero inconsistentes.
- Profundidad efectiva, drenaje, agua inicial y eficiencia de riego son
  **supuestos configurables**, no mediciones. No se atribuye agua inicial de
  enero a un snapshot SMAP de julio.
- Cultivos/variedades públicos fijados al commit
  `fc6eda46ea0081eb0ad31fa92ea49fea60e11075` de
  [WOFOST_crop_parameters](https://github.com/ajwdewit/WOFOST_crop_parameters/tree/fc6eda46ea0081eb0ad31fa92ea49fea60e11075).

El catálogo experimental es maíz, trigo, garbanzo y sorgo. En los dos pilotos,
el trigo de invierno de referencia no alcanza madurez: esas campañas se
descartan. **No significa que el trigo sea inviable en Sinaloa o Sonora**;
indica que faltan parámetros locales apropiados para recomendarlo. No se alteran
los parámetros para forzar un resultado favorable.

Con los perfiles actuales se ensayan tres campañas, según
`farmer_input.constraints.max_rotation_seasons`: verano del año 1, otoño–invierno
del año 1–2, verano del año 2. Ventanas de referencia no validadas: 15 junio–31
octubre y 15 noviembre–31 mayo. Hay 20 secuencias de dos o más cultivos, incluyendo
barbecho, y 40 simulaciones entre temporal y riego. Hasta cuatro campañas son
configurables con dos años completos de datos.

Las fechas de simulación son históricas 2024–2025. La propuesta usa años relativos
y mes/día para que la UI no muestre fechas pasadas como una instrucción futura.
**No hay pronóstico de clima o cosecha.** El historial corto no permite estimar
una probabilidad calibrada de éxito.

El caché se identifica por hashes del perfil, parámetros, settings y código.
Cambiar prioridades económicas no obliga a volver a descargar datos ni a
simular los mismos escenarios físicos.

Ver [ejecución local, GCP y contrato de salida](../../rotations_service/README.md).

Referencias metodológicas:

- [PCSE: modelo, clima y agromanejo](https://pcse.readthedocs.io/en/stable/code.html).
- [FAO-56: datos meteorológicos y presión de vapor](https://www.fao.org/4/x0490e/x0490e07.htm).
- [Saxton y Rawls, 2006](https://www.atmos.illinois.edu/~sshu3/model/saxton2006.pdf).

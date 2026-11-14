# Preparación para PCSE/WOFOST — transición Fase 1 → Fase 2

**Estado: diseño, no implementación.** Este documento define trabajo futuro sin modificar los datos ni declarar WOFOST validado. El contrato vigente está en [FARM_PROFILE_CONTRACT.md](FARM_PROFILE_CONTRACT.md) y la decisión sobre datos vitales/condicionales/confianza en [CROP_SHIFT_REQUIREMENTS.md](CROP_SHIFT_REQUIREMENTS.md).

## 1. Principio de separación

```text
FarmProfile(run_id, weather_daily, soil_properties_raw, QA, ...)
        + CropCatalog versionado / CropVariety
        + Site/SoilParameterSet documentado
        + AgroManagementPlan por parcela/campaña
        + ModelConfig (versión PCSE, modo PP/WLP, parámetros)
                            |
                  InputReadinessGate
               blockers / warnings / evidence
                            |
               PCSE WeatherDataProvider
               PCSE ParameterProvider
               PCSE AgroManagement
                            |
               WOFOST simulation (1 crop)
                            |
        SimulationResult (yield, growth, water, run_id,
                          model_version, provenance, limitations)
                            |
         RotationPlanner / Optimizer (trabajo posterior)
```

**Evitar** que WOFOST lea arbitrariamente `latest.json` mientras otros jobs ejecutan: el consumidor debe fijar un `run_id` inmutable y verificar SHA-256.

## 2. Seleccionar primero el tipo exacto de simulación

| Modelo/objetivo | Entradas fundamentales | Decisión |
|---|---|---|
| **PP — producción potencial** | Clima, cultivo/variedad, agromanagement, parámetros de sitio; sin modelar limitación de agua en el mismo sentido que WLP | Primer ensayo técnico reproducible si los datos están completos; no extrapolar a rendimiento real |
| **WLP — producción limitada por agua** | PP + balance hídrico, suelo hidráulico, profundidad efectiva, condiciones iniciales y manejo de riego | Segundo ensayo, después de validar la parametrización hídrica |
| **Limitación nutricional** | Requiere una versión/configuración que implemente la dinámica correspondiente y sus datos | No asumida por el builder actual |
| **Rotación** | Varios cultivos/campañas y transición explícita de estado inicial/final; calendario consistente | No equivale a concatenar predicciones arbitrarias |
| **Asociación simultánea** | Modelo de interacción validado y/o evidencia empírica | Fuera de alcance de WOFOST monoespecie inicial |

Los nombres de clases y parámetros dependen de la versión instalada de PCSE; fijarla antes de escribir el adaptador. Véase https://pcse.readthedocs.io/en/stable/user_guide.html y https://pcse.readthedocs.io/en/stable/reference_guide.html.

## 3. Matriz de transformación de entradas

| Salida actual | Entrada requerida en PCSE/WOFOST | Estado de transformación |
|---|---|---|
| `weather_daily.date` | DAY / índice diario sin duplicados, fechas consecutivas | Requiere adaptador y política de faltantes |
| `solar_mj_m2_day` | IRRAD (unidades requeridas por WeatherDataContainer) | Convertir explícitamente según interfaz elegida; no copiar números directamente |
| `tmin_c`, `tmax_c` | TMIN / TMAX | Ya disponibles en grados Celsius; validar cobertura temporal |
| `precip_mm` | RAIN | Convertir mm/día a la unidad exigida por PCSE; registrar factor |
| `wind_m_s` | WIND | Disponible en POWER; revisar representatividad/altura y validación |
| `rh_pct`, temperaturas | VAP (presión de vapor) o dato meteorológico adecuado | **No existe un campo `vap` listo**. Derivar solo con fórmula, presión/temperatura representativa, unidades, límites y pruebas físicas documentadas |
| `topography.elevation_m` | ELEV | Estimación SRTM; contrastar cuando posible |
| `soil_properties_raw` (pH, SOC, textura, etc.) | Parámetros hidráulicos/soil site adecuados | **No existe conversión directa verificada.** Pedotransferencia o conjunto de suelo validado, incertidumbre, perfil por profundidad, agua inicial |
| `FarmerInput.crop_history` | AgroManagement por campaña | **Historial ≠ plan futuro.** Crear calendarios explícitos por candidato |
| `farmer_soil_tests` | Posibles parámetros medidos de sitio/suelo | Requiere unidad, método y fecha; no asignar automáticamente |
| `validated_crop_parameters` / CropCatalog futuro | CropDataProvider y variedad activa | Actualmente archivo opcional, no esquema completo PCSE ni calibración |
| `vegetation_timeseries` / ET / SMAP | Comparaciones auxiliares, inicializaciones potenciales o asimilación futura | No inputs obligatorios genéricos; evitar sustituciones no validadas |
| `country_agriculture_context` / precios | Ningún input físico directo | Usar solo en evaluación económica posterior y con limitaciones |

### Validación meteorológica adicional necesaria

El `validate_table("weather_daily")` actual exige TMIN/TMEAN/TMAX, precipitación y radiación físicamente plausibles y algunas verificaciones de fechas. **No valida por sí solo** continuidad diaria completa, VAP, WIND, IRRAD/RAIN en unidades internas PCSE, ni cobertura de la campaña elegida. Crear un `WeatherReadinessCheck` específico y pruebas de límites (faltantes, año bisiesto, extremos, duplicados, conversiones y radiación).

### Hidráulica de suelo

SoilGrids proporciona propiedades raster por profundidad, pero WOFOST WLP necesita una parametrización compatible con su balance hídrico (no basta con pH, SOC y textura). Si se deriva capacidad de campo / punto de marchitez por pedotransferencia, etiquetar método, coeficientes, región, unidades, incertidumbre y validación. Los productos `wv0033` y `wv1500` se deben interpretar conforme a sus definiciones exactas, no asumir sin comprobar que definen toda la curva requerida.

## 4. Contratos nuevos sugeridos (no presentes aún en schema.py)

```text
CropParameterSet
  crop_code, variety, region, source, version,
  pcse_compatibility, physiological_parameters, validation_evidence

SoilSiteParameterSet
  field_id, soil_layers, hydraulic_parameters, rooting_depth,
  initial_water_state, derivation_method, source, uncertainty

AgroManagementPlan
  field_id, crop_code, variety, start/end dates,
  sowing/emergence/harvest rules, irrigation_events,
  fertilizer_events, residue_management, constraints

WofostRunSpec
  farm_id, farm_profile_run_id, field_id, campaign_id,
  crop_parameter_set_id, soil_site_parameter_set_id,
  agromanagement_plan_id, pcse_version, model_configuration,
  weather_source_and_version, random_seed_if_applicable

WofostReadinessReport
  ready, simulation_level, blocking_issues,
  warnings, selected_assumptions, provenance_refs

SimulationResult
  run_spec_hash, inputs_hashes, start/end, daily_output,
  summary_yield_or_biomass, water_indicators,
  model_version, validation_level, limitations
```

Separar modelos de input, ejecución y resultados; no grabar rendimientos en `FarmProfile`.

## 5. Orden de implementación y pruebas (propuesto)

1. **Elegir versión fija de PCSE y modo PP inicial.** Revisar parámetros que realmente exige esa versión y construir un ejemplo oficial reproducible con datos de ejemplo del paquete.
2. **WeatherAdapter**: convertir POWER -> proveedor meteorológico PCSE con cambios de unidades explícitos y pruebas unitarias. Fallar ante variables críticas faltantes; no interpolar silenciosamente.
3. **CropCatalog / CropParameterSet**: seleccionar una especie/variedad con parámetros ya disponibles y con fuente; documentar área de aplicación. No elegir simplemente “maíz” si no existe variedad/parámetro representativo defendible.
4. **Site/SoilParameterSet**: para PP usar requisitos del modo elegido; para WLP añadir hidráulica y condiciones iniciales verificadas o documentadas como supuestos experimentales.
5. **AgroManagementPlan**: separar historial agrícola del plan futuro; validar fechas y acciones. Una campaña monoespecie primero.
6. **InputReadinessGate**: bloquear por campo/campaña/simulación, explicar causas y nivel de evidencia. No reutilizar el booleano `agronomic_input_available` como autorización de simulación.
7. **Ejecutar benchmark reproducible** con insumos oficiales/ejemplo. Luego repetir con FarmProfile de Texcoco **solo cuando el run correspondiente tenga inputs completos**.
8. **Comprobar resultados**: invariantes físicas, repetibilidad, sensibilidad a fechas/riego, comparación de rendimiento y fenología frente a datos independientes, holdout por años/localidades cuando existan.
9. **Después**: WLP, varios escenarios meteorológicos, cambios entre campañas/rotaciones y, por separado, optimización. No recomendar milpa simulando tres monocultivos y sumando sus rendimientos.

## 6. Gates de aceptación

| Gate | Condición verificable | Resultado si falla |
|---|---|---|
| G1 — Integridad | Manifiesto, hashes y `run_id` coinciden | Rechazar datos |
| G2 — Tiempo/espacio | Coordenadas, resolución y días cubren campo/campaña | Bloquear o documentar extrapolación |
| G3 — Clima | Variables requeridas, unidad, continuidad y QA específica PCSE | Bloquear esa simulación |
| G4 — Parámetros | Crop/Soil/Site completos para versión y modo | Bloquear esa simulación |
| G5 — Manejo | Plan futuro, fechas y reglas de operaciones coherentes | Bloquear esa simulación |
| G6 — Ejecución | Modelo corre, salida física y checksum persistente | Marcar fallo experimental |
| G7 — Validación | Métricas frente a observaciones independientes, incertidumbre | Etiquetar como experimento no validado |
| G8 — Decisión | Restricciones operativas, impactos y rentabilidad verificados | No emitir recomendación contextual |

G1–G6 habilitan una **simulación experimental**; G7–G8 son necesarios antes de presentar recomendaciones respaldadas. Los gates son política propuesta de FarmAdapt.

## 7. Situación de Texcoco al documentar

- Manifiesto auditado: `build_state=partial`, integridad OK, `qa_ok=false` por SoilGrids con error de conectividad.
- POWER: 731 registros, QA previa positiva; **aún falta verificar variables meteorológicas adicionales y continuidad para PCSE**.
- MODIS: tres productos `partial`, con porcentajes de observaciones válidas diferentes.
- CSV SoilGrids con 12 valores: archivo histórico no declarado en el manifiesto auditado, **no utilizar como dato de esa ejecución**.
- Parámetros de cultivo y precios locales: ausentes/no verificados en el run.
- **Conclusión:** Texcoco es caso L0 parcial; todavía **no está listo** para WOFOST WLP ni para recomendar un cambio rentable.

## Referencias técnicas externas

- PCSE, User Guide: https://pcse.readthedocs.io/en/stable/user_guide.html
- PCSE, Reference Guide: https://pcse.readthedocs.io/en/stable/reference_guide.html
- PCSE, Code documentation: https://pcse.readthedocs.io/en/stable/code.html
- WOFOST summary, CSDMS: https://csdms.colorado.edu/wiki/Model:WOFOST
- Scientific data-source limitations: [QUALITY_AND_LIMITATIONS.md](QUALITY_AND_LIMITATIONS.md)

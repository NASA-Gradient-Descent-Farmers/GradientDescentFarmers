# Matriz de requisitos para cambio de cultivo (crop shift), rotaciones y asociaciones

**Estado:** criterios propuestos para Fase 2; no son filtros ya implementados ni garantías de éxito agrícola. Se distinguen requisitos para un análisis exploratorio, una simulación y una recomendación. Revisar con especialista agronómico y datos locales antes del uso en campo.

## 1. Definición y alcance

- **Crop shift**: sustituir un cultivo/variedad por otro en una parcela y campaña definida; incluye cambios de calendario o sistema (secano/riego) si se explicitan.
- **Rotación**: secuencia temporal de una o varias campañas; requiere evaluar **estado inicial y efectos entre campañas**.
- **Intercropping/milpa**: especies que coexisten en la misma campaña. El esquema `FarmerInput` la representa, pero WOFOST monoespecie **no demuestra competencia, complementariedad ni rendimientos asociados**.
- **Decisión objetivo**: distingue `biophysically_possible`, `operationally_feasible`, `economically_supported`, `simulated`, `validated` y `recommended`. Son atributos distintos; no asumir que uno implica otro.

## 2. Tres categorías de datos

| Categoría | Interpretación | Política cuando falta |
|---|---|---|
| **V — Vital / bloqueante** | Dato o evidencia mínimo para la *decisión de ese nivel* | Bloquear esa evaluación; comunicar campo faltante |
| **C — Condicional** | Vital solo para un cultivo, sistema o objetivo concreto | Deshabilitar ese escenario o componente, no todo el perfil |
| **F — Fortalece confianza** | Permite calibración, contraste y menor incertidumbre | Dejar incertidumbre explícita; no inventar porcentaje de confianza |

Una variable puede ser **F** para explorar alternativas y **V** para recomendar rendimientos o retornos. No existe una sola clasificación universal.

## 3. Matriz por dimensión

| Dimensión y dato | Explorar alternativas | Simulación WOFOST | Recomendación operativa/económica | Fuentes y notas |
|---|---|---|---|---|
| Ubicación, superficie y periodo/campaña | **V** | **V** | **V** | `FarmerInput` existente; validar geografía real de parcela |
| Cultivo candidato, variedad o parametrización representativa | **V** | **V** | **V** | Catálogo validado por región y versión; no inferir fisiología de nombre común |
| Calendario viable: siembra, fin de campaña, ventana de cultivo | **V** | **V** | **V** | Calendario local, agrónomo, manejo; resolver conflictos entre campañas |
| Temperatura, lluvia, radiación diarias | **F** para exploración preliminar | **V** | **V** | POWER puede proveerlas; QA, continuidad, escala y periodo son esenciales |
| Variables meteorológicas adicionales (viento, presión de vapor/humedad, elevación) | **F** | **V** según WeatherDataProvider/configuración | **V** para resultados con estrés hídrico | POWER incluye HR y viento; requiere convertir con fórmulas y unidades verificadas; presión de vapor no se entrega como campo listo |
| Parámetros fisiológicos y fenológicos para cultivo/variedad | **F** para listado inicial | **V** | **V** para ranking basado en rendimientos | CropCatalog, versión PCSE, adaptación local y licencia de uso |
| Suelo hidráulico y profundidad radicular efectiva | **F** para filtrado grueso | **C/V** según modelo hídrico | **V** si se aconseja secano/riego/riesgo de sequía | SoilGrids no provee por sí solo todos los coeficientes WOFOST; pedotransferencia con incertidumbre o laboratorio |
| Estado inicial de agua en suelo/almacenamiento hídrico | **F** | **C/V** según modelo seleccionado | **V** si resultados dependen del estrés hídrico | SMAP es grueso y no reemplaza medición de perfil; documentar inicialización |
| Riego disponible, turnos/caudal y volumen autorizado | **C** | **C** para escenarios irrigados | **V** para recomendar riego | Declaración agricultor + derecho/infraestructura; `irrigation_water_m3_ha` no valida disponibilidad |
| Fertilización, nutrientes, restricciones químicas | **F** | **C/V** en configuraciones con nutrientes | **C/V** según cultivo y restricciones | `fertilizer_kg_ha` histórico puede ser insuficiente: tipo, dosis, fecha, respuesta |
| Historial y rotaciones, residuos, cultivo predecesor | **F** para reemplazo único | **C** para una campaña; **V** para rotaciones con dependencia de estado | **V** para recomendación de rotación | `crop_history` puede estar vacío; estado inicial del suelo no debe suponerse como observado |
| Restricciones legales y ambientales: protección de suelo/agua/uso de tierra | **C** | Fuera del motor de crecimiento | **V** | No recomendar cambio de uso/deforestación ni violar restricciones |
| Acceso a insumos, maquinaria, trabajo y mercados | **F** | Fuera de WOFOST | **V** para recomendaciones operativamente ejecutables | `equipment` inicial; falta disponibilidad/fechas/capacidad verificadas |
| Precio de venta local, costos desglosados, transporte, moneda, contratos | Fuera del análisis biofísico | Fuera de WOFOST | **V** si se comunica rentabilidad | Precios regionales/nacionales no equivalen a ingresos netos reales |
| Riesgos: variabilidad clima/precio, escenarios adversos | **F** | **F** para simulación de un año; **V** si se afirma robustez | **V** para comparar downside risk | Requiere varios años/escenarios y distribución de resultados, no solo media |
| Ensayos de suelo/laboratorio y estación meteorológica | **F** | **F** | **F** (a veces V para decisiones sensibles) | Evidencia local de mayor resolución |
| Rendimientos reales, campañas históricas y parcelas comparables | **F** | **F** para simulación ilustrativa | **V** para afirmar validación predictiva del rendimiento | Calibración y validación fuera de muestra; reportar incertidumbre |
| MODIS NDVI/EVI/ET y SRTM | **F** | **F** o covariables auxiliares | **F** | No se convierten automáticamente en parámetros WOFOST |
| GPM/SMAP/CMIP6 y otros datos remotos | **F** | **C/F** según escenario | **F** o **V** si el resultado promete extremos, humedad o clima futuro | Periodos/grillas/proyecciones y límites explícitos |
| Compatibilidad de asociación y diseño espacial | **C** | Modelo monoespecie insuficiente | **V** si se recomienda intercropping | Catálogo validado por región, densidades, competencia e interacciones; no sumar simulaciones independientes |

**No confundir** datos exigidos por un modelo computacional con los exigidos para emitir recomendaciones responsables: una simulación técnicamente ejecutable puede carecer de validación de rendimientos y de costos locales.

## 4. Niveles de producto permitidos

| Nivel | Qué se puede producir | Criterios mínimos |
|---|---|---|
| **L0 — Inventario ambiental** | `FarmProfile`, cobertura, alertas de datos faltantes | Input válido y procedencia; puede estar `partial` |
| **L1 — Exploración de factibilidad** | Alternativas candidatas con restricciones y advertencias | Ubicación/campaña/cultivos, calendario plausiblemente compatible; fuentes verificadas para cada criterio; sin afirmar rendimiento |
| **L2 — Simulación experimental** | Escenarios de rendimiento/agua con supuestos | WeatherDataProvider completo, Crop/Soil/Site parameters, AgroManagement, modelo fijado, QA de entradas; indicar **no calibrado** si corresponde |
| **L3 — Comparación respaldada** | Rangos de rendimiento y trade-offs bajo escenarios | Evaluación fuera de muestra o benchmarks regionales documentados, modelos revisados, incertidumbre |
| **L4 — Recomendación contextual** | Cambio o rotación priorizada para agricultor con advertencias | L3 + costos/precios/contratos reales, disponibilidad operacional, impactos ambientales, restricciones y aceptación agronómica |

En el MVP es aceptable entregar L0/L1 y simulaciones L2 **explícitamente experimentales**. No simular confianza validada de L3/L4.

## 5. Bloqueadores propuestos por escenario

- **Una campaña, secano**: calendario, parámetros de cultivo, tiempo meteorológico diario y suelo/humedad acorde a configuración del modelo. Falta de suelo hidráulico bloquea simulación hídrica fiable, no necesariamente un ensayo de producción potencial.
- **Una campaña, irrigado**: añadir disponibilidad, programación, eficiencia y límites del agua (si la recomendación incluye riego).
- **Rotación plurianual**: fechas no superpuestas indebidamente, cultivo anterior, manejo de residuos y modelo de transferencia de estado suelo/agua/nutrientes o inicializaciones justificadas.
- **Intercropping**: requerir evidencia de interacción/compatibilidad y modelo apropiado; históricas milpas siguen siendo datos válidos aunque no puedan simularse.
- **Optimización económica**: rendimiento/costos/ingresos con unidades, cosecha y precios comparables, restricciones de recursos, incertidumbre. La frontera Pareto no es prueba de rentabilidad.

## 6. Confianza: matriz de evidencia, no una cifra inventada

Guardar dimensiones independientes: `input_completeness`, `source_quality`, `spatial_representativeness`, `parameter_provenance`, `model_validation`, `scenario_robustness`, `economic_reliability`. Valores iniciales sugeridos: `verified`, `partial`, `unavailable`, `not_applicable`; añadir evidencia vinculada a versiones, fechas y pruebas. **No** usar suma de porcentajes arbitrarios para afirmar '85 % de confianza'.

Ejemplo lógico: Texcoco tiene POWER usable, tres MODIS parciales y SoilGrids con error en el run auditado. Ese run puede aportar información climática L0, pero **no permite afirmar L2 de producción hídrica** ni L4 de cambio rentable. El CSV histórico de SoilGrids encontrado fuera del manifiesto no corrige la ausencia en ese run.

## 7. Entregables a construir en Fase 2

1. `CropCatalog` con fuente, parámetros, variedad, región, calendario y estado de validación.
2. `FeasibilityAssessment` con blockers/warnings, campo/temporada y nivel máximo soportado.
3. `AgroManagementPlan` y `WeatherAdapter`/parámetros PCSE (ver [WOFOST_TRANSITION.md](WOFOST_TRANSITION.md)).
4. `EconomicCatalog` con precios/costos observados o claramente hipotéticos.
5. `EvidenceReport` que acompaña cada simulación/cambio propuesto.

## Referencias para implementación

- PCSE user guide: https://pcse.readthedocs.io/en/stable/user_guide.html
- PCSE reference guide: https://pcse.readthedocs.io/en/stable/reference_guide.html
- PCSE code docs: https://pcse.readthedocs.io/en/stable/code.html
- Descripción WOFOST/inputs: https://csdms.colorado.edu/wiki/Model:WOFOST
- Fuentes concretas de datos en `docs/QUALITY_AND_LIMITATIONS.md`

Las etiquetas V/C/F y niveles L0–L4 son **política de producto propuesta para FarmAdapt**, no terminología oficial de PCSE.

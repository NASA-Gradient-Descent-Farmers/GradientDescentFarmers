# Selección de rotaciones del MVP

Implementación nueva de `OptimizerBuilder`; los archivos existentes del builder
se conservan. Usa los escenarios físicos de WOFOST y referencias SIAP.

Para este catálogo pequeño se evalúan **todas las secuencias permitidas**.
Después se aplican restricciones, se conserva el frente de Pareto y se presentan
alternativas por prioridades, ingreso, agua, diversidad y repetición de familias.
NSGA no hace falta para 20 secuencias: no añade precisión y dificultaría revisar
por qué una alternativa fue seleccionada. La exhaustividad es sobre este
catálogo y calendario; no equivale a encontrar la mejor rotación agronómica
entre todos los cultivos y manejos posibles.

Restricciones: cultivos permitidos/excluidos, modalidad, madurez, número mínimo
de cosechas, agua total o por campaña y presupuesto cuando hay costos. Se
aceptan nombres del catálogo en español o inglés. Una solicitud de policultivo
simultáneo se rechaza: WOFOST en esta implementación evalúa un cultivo por campaña.

Las cinco prioridades existentes se conservan: `profit` se transforma en ingreso
bruto cuando faltan costos, `water` en agua, `soil_health` en diversidad,
`downside_risk` en sensibilidad económica y `climate_resilience` en estrés hídrico.
La prioridad de pesticidas puede indicarse por separado con `optimizer.weights`.
Las seis claves son `income`, `water`, `soil`, `pesticide`, `risk`, `climate`,
sumando 100. La normalización ocurre dentro de la misma solicitud y modalidad.
El puntaje es afinidad relativa con prioridades, **no probabilidad de éxito**.

## Economía y riesgo

SIAP aporta precios medios rurales y rendimientos regionales, no costos.
La adquisición inicial directa falló tanto localmente como en GCP. El MVP usa
una redistribución pública de los registros SIAP vía
[DataMX](https://datamx.io/dataset/produccion-agricola-en-mexico-1980-2024),
consultada por su datastore, con bytes originales, SHA256 y URL de la consulta.
**No se afirma que ese espejo haya sido contrastado con el servidor oficial.**

Se usan registros 2021–2025 de los cuatro cultivos, por estado, variedad, ciclo,
modalidad, tecnología, producción y mercado. Se conservan todas esas dimensiones
para evitar dobles conteos. Se reutiliza la limpieza de `source_builder.siap`.
Solo se comparan toneladas; los precios se ponderan por volumen después de
comprobar valor/volumen. Los precios son estatales, aunque INEGI identifique el
municipio de la parcela. Si faltan suficientes años se amplía modalidad, ciclo
o país y se declara ese fallback. Fuera de México no hay evaluación económica.

El ingreso bruto de escenario es grano simulado × precio rural de referencia.
WOFOST entrega materia seca; se declara una humedad supuesta por cultivo para
comparar toneladas de grano con precios SIAP. No se modelan pérdidas comerciales,
calidad de venta, subsidios ni inflación. No son precios actuales ni un pronóstico.

P10/P90 resumen sensibilidad a años históricos de precio aplicados a las mismas
cosechas simuladas. Se usa el mismo año de precio para todos los cultivos de cada
escenario, conservando su covariación. No son intervalos estadísticos de confianza
ni probabilidades de cosecha. Se informa el número de años comunes disponibles.

Si se proporcionan costos completos por cultivo en `costs_mxn_ha`, se calcula un
margen de escenario. `net_profit_mxn_ha` sigue siendo nulo: no hay contabilidad
auditada. Un presupuesto sin costos se rechaza; no se declara cumplido por usar
precios de venta. Los montos son por hectárea y por el horizonte completo.

## Agua, suelo y pesticidas

El agua aplicada y la evapotranspiración provienen del balance WOFOST. El agua
retirada de escenario incluye la eficiencia de aplicación supuesta. Cada modalidad
tiene su propio ranking; 0 m³ de riego en temporal no significa 0 consumo de agua.

Diversidad de familias, presencia de leguminosa y oportunidad de cobertura forman
un índice heurístico de suelo. La repetición consecutiva de familias forma un
indicador de presión potencial de plagas. Estos índices describen el **plan**,
no beneficios medidos o garantizados: una campaña fallida puede no realizar esa
oportunidad. No se calculan porcentajes de reducción de pesticidas ni cambios
de carbono. Una mejora del índice no prueba una mejora física del suelo.

Las comparaciones de agua indican su referencia: nunca se supone que sea la
práctica actual del agricultor. Si la referencia fija no llega a madurez, se usa
una alternativa factible de mayor ingreso bruto como comparación hipotética.

Las opciones con cosechas simuladas menores a 50 kg/ha quedan identificadas como
escenarios de alto riesgo. No deben presentarse como planes operativos validados.
Todas las opciones actuales tienen confianza baja por falta de calibración local.

Ver [CLI, salidas y conexión a la UI](../../rotations_service/README.md).

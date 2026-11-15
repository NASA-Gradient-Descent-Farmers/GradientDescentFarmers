# FeasibilityAssessment — preflight de crop shifts

**Implementado en:** `gradientdescentfarmers/source_builder/core/feasibility.py`. Es una evaluación de requisitos, no un modelo de rendimiento ni una certificación agronómica.

## Política conservadora

`assess_feasibility(profile, scenario, verified)` devuelve:
- `max_level`: `inventory`, `exploration`, `simulation` o `optimization`.
- `exploration_allowed`, `simulation_allowed`, `optimization_allowed`.
- `blocking_issues` separados por nivel y `warnings` explícitos.
- Identidad `farm_profile_run_id` y referencias `evidence_refs`.

`ScenarioSpec` describe **una propuesta futura**: parcela, campaña, cultivos candidatos, fecha de siembra/cosecha, monocultivo/asociación, secano/irrigado, evaluación de rentabilidad y si incluye rotación. No se interpreta `crop_history` como calendario futuro.

`VerifiedInputs` contiene *atestaciones* de verificaciones externas de calendario, normas ambientales, catálogo, WeatherDataProvider PCSE, suelo, agromanagement, simulación, validación fuera de muestra, costos y riesgo. Todo valor `True` exige una referencia de evidencia no vacía. **Las referencias no se verifican automáticamente**: el futuro servicio solo debe permitir atestaciones generadas por validadores confiables, no enviadas libremente por el cliente web.

Para el modo actual, la autorización de simulación presupone un escenario de crecimiento **limitado por agua**, por lo que exige información hidráulica/estado de agua. Una ruta separada PP (producción potencial) debe modelarse explícitamente antes de relajar esa condición. El gate para optimización está diseñado para una aplicación que considera rentabilidad, de modo que siempre exige costos y precios validados.

## Ejemplo desde un run exportado (offline)

```python
from gradientdescentfarmers.source_builder.core.feasibility import (
    ScenarioSpec, VerifiedInputs, assess_exported_profile,
    require_optimization_approval, OptimizationBlocked,
)

scenario = ScenarioSpec(
    field_id="parcel_01", crop_codes=["maize"],
    season_id="future_rainy", planting_date="2027-05-15",
    harvest_date="2027-10-20", water_regime="rainfed",
    evaluate_profit=True,
)
report = assess_exported_profile(
    "data/processed/MI_FARM_ID/runs/MI_RUN_ID",
    scenario,
    VerifiedInputs(),
)
print(report.model_dump_json(indent=2))

try:
    require_optimization_approval(report)
except OptimizationBlocked as exc:
    print("No se ejecutará optimización:", exc)
```

Reemplaza el path por un run real que ya existe y usa un `field_id` declarado en su input. El código lee el manifiesto y verifica archivos/hash; **no descarga datos ni ejecuta WOFOST/NSGA-II**.

Los campos `verified` están en `False` por defecto. Un perfil de Texcoco con POWER disponible y SoilGrids fallido **no** recibe automáticamente permiso para simular ni para optimizar.

## Semántica de gates

- `inventory`: se puede inspeccionar el FarmProfile, pero faltan verificaciones básicas del escenario.
- `exploration`: parcela, cultivo permitido, calendario y restricciones ambientales/legales atestadas; no supone rendimiento.
- `simulation`: condiciones anteriores más validación de entradas meteorológicas PCSE, parámetros regionales del cultivo, sitio, manejo y agua/estados; bloquea milpa sin modelo de interacción y rotaciones sin transiciones.
- `optimization`: condiciones anteriores más validación fuera de muestra, incertidumbre, operación, riesgo, precios y costos locales. Si cualquier condición falta se bloquea.

La función `require_optimization_approval` falla con `OptimizationBlocked` cuando el resultado no cumple el gate. **El optimizador todavía no está implementado ni conectado**, por tanto el gate solo prepara ese punto de integración.

### Limitaciones / siguientes mejoras

- Las atestaciones requieren verificación por servicio confiable; no aceptar flags del agricultor sin evidencia.
- Añadir inspección de cobertura y variables por periodo/parcela, catálogos regionales y criterios de temporada/cultivos. La política actual no los infiere automáticamente.
- Modelar por separado producción potencial PP, WLP y casos nutricionales.
- Un resultado con `optimization_allowed=True` no garantiza éxito agrícola ni reemplaza revisión de un especialista; únicamente satisface **esta lista preliminar de prerrequisitos**.
- Persistir y versionar el assessment con hashes del escenario, parámetros y modelo antes de activarlo como gate productivo.

Relacionado: [CROP_SHIFT_REQUIREMENTS.md](CROP_SHIFT_REQUIREMENTS.md), [WOFOST_TRANSITION.md](WOFOST_TRANSITION.md).

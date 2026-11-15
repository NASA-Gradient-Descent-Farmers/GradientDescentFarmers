# District engine (SIAP) backtest: trained 2003-2019, tested 2020-2025

Generated 2026-11-15 with `python -m gradientdescentfarmers.model_builder.rotations.backtest --cutoff 2019`.

The engine was run on a copy of the panel cut at the training cutoff, so it only knew what existed then. Its recommendations were then checked against what the districts produced in the following years (SIAP, valued at the same fixed recent prices for every rotation). This tests the engine's statements about the district, not about one field.

Cases: 50 (0 without an engine answer): the web app's demo cases and a seeded random sample of districts across Mexico. Baselines: a coin flip (50%), and always predicting whatever happened most often (the 'Majority baseline' column).

## Did the alternative earn more (or less) than the current rotation, as the engine said?

| Group | Pairs | Direction right | Majority baseline | Claimed gap ≥ 5,000 | Claimed gap < 5,000 | 'Clear' only | Spearman claimed vs real | Median abs. error (MXN/ha/yr) | Median |real gap| |
|---|---|---|---|---|---|---|---|---|---|
| demo | 50 | 90% | 52% | 100% (n=26) | 79% (n=24) | 90% (n=30) | 0.90 | 9,002 | 12,686 |
| national | 77 | 92% | 78% | 100% (n=29) | 88% (n=48) | 98% (n=50) | 0.90 | 2,404 | 5,912 |
| all | 127 | 91% | 68% | 100% (n=55) | 85% (n=72) | 95% (n=80) | 0.90 | 4,171 | 9,040 |

## When the farmer's priority is income or risk: did the top-scored alternative deliver?

| Group / priority | Cases | Top alternative equal or better | Strictly better | Ties | When the engine said it was better |
|---|---|---|---|---|---|
| demo / income | 17 | 76% | 76% | 0 | 100% (n=13) |
| demo / risk (bad years) | 16 | 100% | 0% | 16 | 100% (n=13) |
| national / income | 28 | 89% | 89% | 0 | 96% (n=25) |
| national / risk (bad years) | 28 | 100% | 7% | 26 | 100% (n=21) |

Risk: most held-out windows had no bad year for either rotation, so the comparison is mostly ties and does not validate the risk claim either way.

## Where the direction was wrong (11 pairs, largest gaps first)

| Case | Alternative (engine's Spanish name) | Claimed (MXN/ha/yr) | Happened | Marked 'clear' |
|---|---|---|---|---|
| sonora/riego/maiz | Con leguminosa: maíz – garbanzo | +3,294 | -12,104 | yes |
| sonora/riego/trigo_maiz | Con leguminosa: trigo – garbanzo | +3,294 | -12,104 | yes |
| Querétaro/Querétaro/riego/maize_forage | Milpa: milpa (maíz-frijol-calabaza) | -3,530 | +5,574 | no |
| sonora/riego/trigo | Con leguminosa: trigo – garbanzo | +2,742 | -4,346 | yes |
| Michoacán/La Piedad/riego/maize | Menos agua de riego: sorgo – maíz | +165 | -4,755 | no |
| Hidalgo/Pachuca/temporal/barley | Milpa: milpa (maíz-frijol-calabaza) | +46 | -2,720 | no |
| guanajuato/temporal/sorgo | Con leguminosa: sorgo – frijol | -338 | +1,038 | no |
| guanajuato/temporal/maiz_frijol | Más tolerante a sequía: sorgo – maíz | +338 | -1,038 | no |
| Yucatán/Tizimín/temporal/maize | Más ingreso: maíz – calabaza (semilla) | +10 | -995 | no |
| Michoacán/La Piedad/temporal/maize | Más tolerante a sequía: sorgo – maíz | +291 | -595 | no |
| Tamaulipas/Mante/temporal/soybean | Más tolerante a sequía: sorgo – soya | -731 | +87 | yes |

## What this test cannot check

Water, nitrogen, carbon, erosion, pest breaks and forage have no observed yearly district outcome to compare with; they remain model estimates (FAO-56) and literature rules.

## Limits

- District SIAP aggregates many fields; crops grown on few hectares have fewer years and more noise.
- Income at fixed recent prices measures what was produced, not price luck; price risk is separate.
- Priority settings tested: none and each of the seven alone (not pairs).
- The WOFOST simulation is not part of this test.

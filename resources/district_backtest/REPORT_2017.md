# District engine (SIAP) backtest: trained 2003-2017, tested 2018-2025

Generated 2026-11-15 with `python -m gradientdescentfarmers.model_builder.rotations.backtest --cutoff 2017`.

The engine was run on a copy of the panel cut at the training cutoff, so it only knew what existed then. Its recommendations were then checked against what the districts produced in the following years (SIAP, valued at the same fixed recent prices for every rotation). This tests the engine's statements about the district, not about one field.

Cases: 50 (0 without an engine answer): the web app's demo cases and a seeded random sample of districts across Mexico. Baselines: a coin flip (50%), and always predicting whatever happened most often (the 'Majority baseline' column).

## Did the alternative earn more (or less) than the current rotation, as the engine said?

| Group | Pairs | Direction right | Majority baseline | Claimed gap ≥ 5,000 | Claimed gap < 5,000 | 'Clear' only | Spearman claimed vs real | Median abs. error (MXN/ha/yr) | Median |real gap| |
|---|---|---|---|---|---|---|---|---|---|
| demo | 51 | 90% | 51% | 100% (n=24) | 81% (n=27) | 84% (n=32) | 0.91 | 9,489 | 11,587 |
| national | 79 | 81% | 76% | 96% (n=27) | 73% (n=52) | 84% (n=50) | 0.91 | 2,013 | 4,631 |
| all | 130 | 85% | 65% | 98% (n=51) | 76% (n=79) | 84% (n=82) | 0.90 | 3,466 | 7,087 |

## When the farmer's priority is income or risk: did the top-scored alternative deliver?

| Group / priority | Cases | Top alternative equal or better | Strictly better | Ties | When the engine said it was better |
|---|---|---|---|---|---|
| demo / income | 17 | 76% | 76% | 0 | 100% (n=13) |
| demo / risk (bad years) | 16 | 100% | 0% | 16 | 100% (n=13) |
| national / income | 28 | 82% | 82% | 0 | 92% (n=25) |
| national / risk (bad years) | 28 | 96% | 25% | 20 | 100% (n=23) |

Risk: most held-out windows had no bad year for either rotation, so the comparison is mostly ties and does not validate the risk claim either way.

## Where the direction was wrong (20 pairs, largest gaps first)

| Case | Alternative (engine's Spanish name) | Claimed (MXN/ha/yr) | Happened | Marked 'clear' |
|---|---|---|---|---|
| sonora/riego/maiz | Con leguminosa: maíz – garbanzo | +3,489 | -12,302 | yes |
| sonora/riego/trigo_maiz | Con leguminosa: trigo – garbanzo | +3,489 | -12,302 | yes |
| Michoacán/Sahuayo/riego/maize | Con leguminosa: maíz – frijol | +858 | -14,128 | no |
| Sonora/Hermosillo/riego/wheat | Con leguminosa: trigo – garbanzo | +1,951 | -5,946 | yes |
| Michoacán/Zamora/riego/wheat | Con leguminosa: trigo – garbanzo | -6,014 | +1,207 | yes |
| sonora/riego/trigo | Con leguminosa: trigo – garbanzo | +2,308 | -4,345 | yes |
| Michoacán/La Piedad/riego/maize | Menos agua de riego: sorgo – maíz | +815 | -5,228 | no |
| Nayarit/Ahuacatlán/temporal/maize | Más tolerante a sequía: sorgo – maíz | +78 | -4,467 | no |
| Puebla/Zacatlán/riego/maize | Con leguminosa: maíz – frijol | +2,639 | -1,699 | yes |
| Michoacán/Morelia/riego/maize | Menos agua de riego: sorgo – maíz | +531 | -3,265 | yes |
| Zacatecas/Jalpa/temporal/maize | Con leguminosa: maíz – frijol | +273 | -3,285 | no |
| Hidalgo/Pachuca/temporal/barley | Milpa: milpa (maíz-frijol-calabaza) | +440 | -2,670 | yes |

## What this test cannot check

Water, nitrogen, carbon, erosion, pest breaks and forage have no observed yearly district outcome to compare with; they remain model estimates (FAO-56) and literature rules.

## Limits

- District SIAP aggregates many fields; crops grown on few hectares have fewer years and more noise.
- Income at fixed recent prices measures what was produced, not price luck; price risk is separate.
- Priority settings tested: none and each of the seven alone (not pairs).
- The WOFOST simulation is not part of this test.

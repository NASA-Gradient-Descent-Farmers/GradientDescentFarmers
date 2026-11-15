# Does YoliA's district engine hold up in years it never saw?

A held-out backtest of the SIAP district rotation engine (`gradientdescentfarmers/model_builder/rotations`), the
"district history" half of YoliA. Code: `backtest.py` in that package. Full tables: `REPORT_2017.md`, `REPORT_2019.md`;
raw results: `pairs_*.csv`, `priority_*.csv`, `summary_*.json`.

## Method

1. Cut the national district panel at a year (2017, and 2019 as a check): every yearly table (SIAP, NASA POWER, CHIRPS,
   GRACE) keeps only the years up to the cutoff.
2. Run the engine on that cut panel exactly as the app does, for 50 cases: the web app's 23 demo cases (Guanajuato,
   Sinaloa, Sonora; irrigated and rainfed; their main current rotations) and 27 randomly sampled districts across Mexico
   (seeded; each with its largest main-season crop as the current rotation). Priority settings: none, and each of the
   seven priorities alone.
3. On the full panel, measure what each recommended rotation and the current rotation actually produced in the
   held-out years (2018-2025, or 2020-2025): district SIAP production per sown hectare, valued at the same fixed recent
   prices for all rotations.
4. Compare the engine's claims with what happened.

## Headline (2018-2025 held out; 2020-2025 in brackets)

| What the engine claimed | Held up | Baselines |
|---|---|---|
| Whether an alternative earns more or less than the current rotation (130 pairs) | **85%** [91%] | coin flip 50%; always-the-most-common-outcome 65% [68%] |
| ... when the engine claimed a gap of 5,000 MXN/ha/yr or more (51 pairs) | **98%** [100%] | |
| ... when it claimed a smaller gap (79 pairs) | 76% [85%] | |
| Ranking of the size of the gaps (Spearman, claimed vs real) | **0.90** [0.90] | |
| Farmer prioritises income: the top-scored alternative did at least as well as the current rotation (45 cases) | **80%** [84%] | |
| ... and when the engine said it would be better | **95%** [97%] | |

The demo cases alone: direction right 90% [90%] against a majority baseline of 51% [52%].

## What it means, honestly

- **Direction is reliable; size is approximate.** The median error on the size of the gap (3,500-4,200 MXN/ha/yr) is
  about half the typical real gap. Large claimed differences almost always held; small ones (< 5,000) are much less
  certain, and the app should say so.
- **Nationally, the 2017 test only modestly beats the simple baseline** (81% vs 76% for the 27 random districts); the
  2019 test does better (92% vs 78%). The demo cases beat it by far (90% vs about 51%).
- **The "clear difference" label did not add much** (84% vs 85% overall with the 2017 cutoff; 95% vs 91% with 2019).
- **Risk (share of bad years) could not be validated:** most held-out windows had no bad year for either rotation, so
  the comparison is mostly ties.
- **A known miss in the demo: Sonora, irrigated, wheat → wheat-chickpea.** The engine said about +2,300 to +3,500
  MXN/ha/yr (marked "clear"); after 2017 it came out −4,300 to −12,300. Chickpea in the Yaqui valley did much worse than
  its history suggested. It is the largest miss in both tests, and worth saying out loud in the demo.
- **Not testable with observed data:** water, nitrogen, carbon, erosion, pest breaks and forage. They remain model
  estimates (FAO-56) and literature rules.
- District SIAP aggregates many fields: this validates the engine's statements about the district, not about a
  particular field. The WOFOST simulation is not part of this test.

## Reproduce

```bash
python -m gradientdescentfarmers.model_builder.rotations.backtest --cutoff 2017 --national 30   # ~4 min on 2 cores
python -m gradientdescentfarmers.model_builder.rotations.backtest --cutoff 2019 --national 30
```

`--national 30` asks for 30 districts; 27 met the sampling rules (≥ 2,000 ha of the main crop a year in training,
SIAP data in most held-out years, not one of the demo districts).

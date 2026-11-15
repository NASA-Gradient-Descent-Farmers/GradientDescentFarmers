# Rotation engine

Compares a farmer's current rotation with at least two alternatives built from what has actually been grown in their SIAP district, and explains each one: why it was proposed, the evidence, benefits, risks, information gaps, and questions for a local technician. Ported from field-shift (`NASA-warm-up`, branch `claude/field-shift`, `src/rotations/`); the logic is unchanged except for the fixes below.

It reads only a district panel built by `source_builder.district` (see `source_builder/district/DISTRICT_PANEL_CONTRACT.md`).

```python
from gradientdescentfarmers.model_builder.rotations import RotationModelBuilder

engine = RotationModelBuilder().build("data/processed/districts", {})        # folder with latest.json, or a run
result = engine.compare("Bácum", "trigo", estado="Sonora", agua="riego", prioridades=["agua", "suelo"])
for r in result["rotaciones"]:
    print(r["nombre"], r["puntaje_prioridades"], r["tarjeta"]["por_que"])
```

`compare` takes the arguments of `compare.comparar_rotaciones` (place, current rotation, water regime, priorities, residue handling, animals, sowing month, slope, the farmer's costs and own yield, soil). The result is a JSON-ready dict in Spanish. Through the team pipeline, `RotationModelBuilder().build(source_result, model_config)` accepts the dict returned by `DistrictPanelSourceBuilder`.

## Changes from field-shift

1. **Reads the panel it is given.** `panel.py` replaces field-shift's fixed `data/rotations/` and `data/shared/` paths. Build-time code (downloads, NASA processing) lives in `source_builder.district`, not here.
2. **Trends over each crop's own season** (`trends.py`, rewritten). Field-shift used a fixed May–October window from the rainfed yield panel: wrong for irrigated winter districts, and empty for municipalities that panel left out (Ahome, Bácum, Cajeme). Trends now come from the panel's 1982–2025 monthly climate, over the months each crop of the current rotation is in the field, with rain trends checked against CHIRPS. Irrigated places get a note that ET0, not rain, is the trend that matters.
3. **No crops proposed in their off-season** (`candidates.off_cycle`). SIAP records ~400 ha a year of "spring-summer" chickpea in Los Mochis against thousands of hectares in autumn-winter, and the engine proposed summer chickpea. A crop grown in a cycle on under a quarter of its area in the other cycle and under 1,000 ha is now treated as niche there: listed, not proposed.
4. **Missing map soil values** (IGBP-DIS needs an Earthdata login) are reported as missing instead of crashing.
5. Water balances and bad years keep field-shift's 2001–2025 window; the longer 1982–2025 series is used only for trends.
6. **The farmer's sowing month sets its own cycle** (`indicators.sowing_day`). Field-shift applied `mes_siembra` to spring–summer only, so a Yaqui wheat farmer saying "December" changed nothing. Now March–August moves the spring–summer sowing and September–February the autumn–winter one. The result lists the date used for each cycle and whether it came from the farmer (`fechas_siembra`), and when a winter crop runs on the default the result asks for the month (`preguntar`), for the assistant or the web page to pass on.

## Known limitation to review

The crop calendar assumes irrigated autumn-winter crops are sown around 21 November, and FAO-56 stage lengths shorten in warm places: wheat in the Yaqui valley comes out at ~108 days (harvest mid-March), maize in Los Mochis at ~129 days. Local practice is probably later sowing and a longer season. This affects water need and the trend window. The farmer's sowing month now corrects the start; the season length still needs a technician's or INIFAP's calendar for each district.

## Tests

```bash
python -m pytest tests/model_builder -q
```

They run offline on a committed three-district panel (`tests/model_builder/fixtures/three_districts/`, public data only, ~0.9 MB).

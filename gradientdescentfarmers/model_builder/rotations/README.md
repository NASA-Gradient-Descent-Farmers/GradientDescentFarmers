# Rotation engine

Compares a farmer's current rotation with at least two alternatives built from what has actually been grown in their SIAP district, and explains each one: why it was proposed, the evidence, benefits, risks, information gaps, and questions for a local technician. Ported from field-shift (`NASA-warm-up`, branch `claude/field-shift`, `src/rotations/`); the logic is unchanged except for the fixes below.

It reads only a district panel built by `source_builder.district` (see `source_builder/district/DISTRICT_PANEL_CONTRACT.md`).

```python
from gradientdescentfarmers.model_builder.rotations import RotationModelBuilder

engine = RotationModelBuilder().build(None, {})                              # the committed national panel
# or: RotationModelBuilder().build("data/processed/districts", {})           # a panel you built (latest.json or a run)
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

7. **Harvest month and district calendars** (`indicators.season`). A season's sowing and harvest months come from the farmer (`mes_siembra`, `mes_cosecha`), then from the district calendar in `tables/calendars.csv`, then from the formula. A known harvest month sets the season length, keeping FAO-56's stage proportions. `fechas_siembra` says where each date came from, and `preguntar` asks for the harvest month when a winter crop's season length comes from the formula.
8. **Crop and soil tables checked against FAO-56** (Tables 11, 12, 19, 22) on 15 November 2026; the result is in `tables/crop_sources.csv`. Wheat now uses FAO's December-sown California desert row (160 days) instead of the spring-sown mid-latitude row (135 days).

## District calendars (`tables/calendars.csv`)

Usual sowing month, and harvest month where the source gives a season length, for the main crops of the three demo districts, from INIFAP's *Agenda Técnica Agrícola* for Guanajuato, Sinaloa and Sonora (2017). Each row quotes the recommended window in `nota`; the month chosen is the one whose 10th falls inside it. Where an agenda gives days to maturity, the harvest month is the sowing day plus the midpoint (wheat and chickpea 130–140 days, safflower 140–152). Gaps, on purpose:

- **No harvest month** for maize, sorghum, soybean, irrigated bean and Bajío wheat: the agendas give sowing windows but not season lengths. Those seasons keep the FAO-56 formula, and the engine asks the farmer (`preguntar`).
- **Cajeme** wheat and chickpea use the Sinaloa agenda's days to maturity; the Sonora agenda gives none.
- **No maize in Cajeme, no barley in Cortazar, no sorghum in Los Mochis.** The Sonora agenda has no maize package, the Guanajuato agenda only forage barley. Sinaloa's irrigated sorghum is sown 15 January–10 March, which does not fit SIAP's spring-summer cycle as the engine reads it; left out until a technician says how SIAP files it.

These are state-level recommendations, not observations: a technician should confirm them for each district.

## Known limitation to review

Where no calendar row or farmer answer exists, the crop calendar falls back to the default sowing date (around 21 November for irrigated autumn–winter crops) and FAO-56 stage lengths shortened in warm places. The calendar table above replaces that for its rows; the rest still need local calendars.

## Tests

```bash
python -m pytest tests/model_builder -q
```

They run offline on a committed three-district panel (`tests/model_builder/fixtures/three_districts/`, public data only, ~0.9 MB).

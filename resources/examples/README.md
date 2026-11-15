# Observed municipal SIAP example

`siap_valle_de_santiago_observed_2003_2025.csv` contains **real SIAP
observations** for every crop label reported in Valle de Santiago,
Guanajuato, from 2003 through 2025: 891 municipal records and 47 distinct
crop labels. `selected_products=None` in the observation loader applies no
crop filter. Separate SIAP production cycles and water modalities remain
separate rows. The bucket's 2000–2002 SIAP files are state-only; municipal
files start in 2003.

The CSV includes reported sown and harvested area, production volume and
value, plus `observed_yield_t_ha = production_t / sown_ha` and
`observed_price_mxn_t = production_value_mxn / production_t`. The latter is
blank for 19 rows with zero production. `source_uri` identifies the exact GCS
object for each row.

This CSV **replaces the synthetic model-output example**. It is not a WOFOST
simulation, a field crop rotation, or a future price forecast. SIAP's annual
municipal aggregates do not provide verified field sowing dates, soil inputs,
or future weather for all 47 crops. See
[`DATA_SOURCES_CALIBRATION_OUTPUTS.md`](../../gradientdescentfarmers/model_builder/docs/DATA_SOURCES_CALIBRATION_OUTPUTS.md)
for the distinction between this observed export and the model's final
`final_df`, along with a dictionary of all columns in both schemas.

Regenerate it with GCS Application Default Credentials:

```python
from gradientdescentfarmers.model_builder.gcs import GCSDataClient
from gradientdescentfarmers.model_builder.siap_observations import load_municipal_siap_observations

observed = load_municipal_siap_observations(
    GCSDataClient(project="gdfarming"),
    municipality="Valle de Santiago",
    state="Guanajuato",
    selected_products=None,
)
observed.to_csv(
    "resources/examples/siap_valle_de_santiago_observed_2003_2025.csv",
    index=False,
)
```

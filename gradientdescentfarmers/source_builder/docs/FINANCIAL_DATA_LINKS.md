# Financial and economic data: links

Where to find the economic data the project uses, the official sources behind it, and the sources we still need.

External links were checked on 2026-11-15.

## Our processed data (repository, branch `rodrigo-dev`)

| What | Link |
|---|---|
| District-level dataset (primary): yield, price, gross revenue, stress test | [`data/economics/siap_3districts_normalized.parquet`](https://github.com/NASA-Gradient-Descent-Farmers/GradientDescentFarmers/blob/rodrigo-dev/data/economics/siap_3districts_normalized.parquet) |
| Municipality / CADER-level dataset | [`data/economics/siap_3districts_normalized_municipal.parquet`](https://github.com/NASA-Gradient-Descent-Farmers/GradientDescentFarmers/blob/rodrigo-dev/data/economics/siap_3districts_normalized_municipal.parquet) |
| Dataset README: schemas, units, rules, GCP usage | [`data/economics/README.md`](https://github.com/NASA-Gradient-Descent-Farmers/GradientDescentFarmers/blob/rodrigo-dev/data/economics/README.md) |
| Team report: what was built and what comes next | [`SIAP_ECONOMIC_REPORT.md`](https://github.com/NASA-Gradient-Descent-Farmers/GradientDescentFarmers/blob/rodrigo-dev/gradientdescentfarmers/source_builder/docs/SIAP_ECONOMIC_REPORT.md) |
| Code that builds the datasets | [`economic.py`](https://github.com/NASA-Gradient-Descent-Farmers/GradientDescentFarmers/blob/rodrigo-dev/gradientdescentfarmers/source_builder/economic.py) |
| SIAP column mapping and pilot sites | [`configs/siap_mapping_local.json`](https://github.com/NASA-Gradient-Descent-Farmers/GradientDescentFarmers/blob/rodrigo-dev/configs/siap_mapping_local.json) |

## Raw data (Google Cloud Storage)

| What | Link |
|---|---|
| SIAP folder in the console | [data_dump_samples / SIAP_Agricultural_Production_2000_2025](https://console.cloud.google.com/storage/browser/data_dump_samples/SIAP_Agricultural_Production_2000_2025) |
| Municipal closing CSVs, 2003–2025 (used) | `gs://data_dump_samples/SIAP_Agricultural_Production_2000_2025/Municipal (2003_2025)/` |
| State-level CSVs, 2000–2002 (not used) | `gs://data_dump_samples/SIAP_Agricultural_Production_2000_2025/Estatal (2000_2002)/` |

The bucket can be listed but not downloaded from: its project has no billing account, so reads return `403`.

## Official sources

### Production, yield and rural prices: SIAP (DGSIAP)

| What | Link |
|---|---|
| SIAP home page | https://www.gob.mx/siap |
| Open data, agriculture: municipal closing CSVs, 2003–2025 | https://nube.agricultura.gob.mx/datosAbiertos/Agricola.php |
| Agricultural production yearbook: query tool with Excel export | https://nube.agricultura.gob.mx/cierre_agricola/ |
| Secretaría de Agricultura (SADER) | https://www.gob.mx/agricultura |

The open-data page offers the same "Cierre" municipal CSVs, one per year from 2003 to 2025, plus a data dictionary. It is the public source of the files in our bucket, and a way to get them while the bucket downloads are blocked.

### Production costs: FIRA (still needed)

| What | Link |
|---|---|
| FIRA home page | https://www.fira.gob.mx/ |
| Agrocostos: production costs per hectare by crop, cycle and region | https://www.fira.gob.mx/Nd/Agrocostos.jsp |

Agrocostos is the most likely source for `explicit_cost_mxn_ha`, which is what net margin needs. It covers Primavera-Verano 2026, Otoño-Invierno 2026/2027, Perennes 2026 and closed past cycles. The tables load through the page's scripts, so their format and regional breakdown still need to be checked by hand in a browser. FIRA works by region or agro-ecological zone rather than by state; that decides which helper applies, `costs_from_municipal_table` or `costs_from_state_table`.

### Inflation, to compare prices across years

| What | Link |
|---|---|
| INEGI, National Consumer Price Index (INPC) | https://www.inegi.org.mx/temas/inpc/ |
| Banxico, Economic Information System (SIE): prices, exchange rates and other series | https://www.banxico.org.mx/SieInternet/ |

SIAP prices are nominal. Deflating them with the INPC turns them into constant pesos.

# GradientDescentFarmers

Base template for the NASA Space Apps project. Requires Python 3.10 or higher. The model builder uses PCSE, scikit-learn, and statsmodels; install dependencies with `requirements.txt`.

## Structure

```text
gradientdescentfarmers/
  app.py                 # configuration and integration order
  source_builder/        # data loading or preparation
  model_builder/         # model construction
  optimizer_builder/     # optimizer construction
  version.py             # single package version
resources/
  application.conf       # shared JSON schema
tests/
  source_builder/
  model_builder/
  optimizer_builder/
data/
```

## Getting started

From the repository root:

```bash
python3 -m pip install -r requirements.txt
python3 -m unittest discover -s tests -v
```

The shared configuration has the sections `source`, `model` and `optimizer`. The `model` section in `resources/application.conf` contains the Guanajuato app template, including selected products, water mode, irrigation system, historical seasons, and planned rotation. Soil measurements, planned area, and future weather remain unset until provided for a real run. Each team can create its own file, for example `resources/experiment.local.conf`, without editing the shared file. `*.local.conf` files are ignored by Git.

## Guanajuato model app

`run_model_app()` in `gradientdescentfarmers/app.py` loads the JSON template, applies a user dictionary to its `model` section, then calls `GuanajuatoModelBuilder`. Pass `rotation_options` to compare multiple named crop schedules. The single compact `final_df` has **one row per phase of each option**, including crop and phase identifiers, water estimates, soil nutrient context, calibrated yield, harvest price, and gross value. Full WOFOST daily and terminal variables remain in the result's diagnostic DataFrames. Use `result.save_final_csv("data/model_builder/my_run.csv")` for one consolidated CSV. `notebooks/app.ipynb` demonstrates two options with three and two phases. Its historical and future weather, hydraulic soil inputs, dates, and areas are invented for a smoke test. For input details and the faba-bean data limitation, see `gradientdescentfarmers/model_builder/README.md`.

The versioned [SIAP municipal observation CSV](resources/examples/siap_valle_de_santiago_observed_2003_2025.csv) includes all 47 crop labels reported during 2003–2025 with `selected_products=None`; it is observed annual municipal data, not WOFOST output. The [model data and output dictionary](gradientdescentfarmers/model_builder/docs/DATA_SOURCES_CALIBRATION_OUTPUTS.md) explains both schemas and the sources used by the model.

```python
from gradientdescentfarmers.app import run_model_app

result = run_model_app({
    "selected_products": ["maize"],
    "water_mode": "rainfed",
    "irrigation_system": None,
    "soil_parameters": measured_soil,
    "initial_available_water_cm": measured_initial_water_cm,
    "future_weather": future_weather_df,
    "planned_rotation": planned_rotation_with_dates_and_area,
})
valued_harvests = result.final_df
```

## Contracts between modules

Each module exports a base class (`SourceBuilder`, `ModelBuilder`, `OptimizerBuilder`) from its `__init__.py`. Implementations are added inside the corresponding module. The common flow is:

```python
from gradientdescentfarmers.app import Pipeline, PipelineConfig
from gradientdescentfarmers.source_builder import SourceBuilder
from gradientdescentfarmers.model_builder import ModelBuilder
from gradientdescentfarmers.optimizer_builder import OptimizerBuilder


class MySource(SourceBuilder):
    def build(self, config):
        return ...  # prepared data


class MyModel(ModelBuilder):
    def build(self, source, config):
        return ...  # model built from the data


class MyOptimizer(OptimizerBuilder):
    def build(self, model, config):
        return ...  # optimizer configured for the model


config = PipelineConfig.from_file("resources/application.conf")
components = Pipeline(MySource(), MyModel(), MyOptimizer()).build(config)
```

`Pipeline.build` assembles the three components; training and evaluation belong to the implementation that uses those components. The concrete data and model types are agreed upon by whoever integrates those branches.

## Package version

The package version is changed **only** in `gradientdescentfarmers/version.py`; `pyproject.toml` takes it from there.

## Working with branches

1. Create your branch from this template on `main`.
2. Add implementations and tests in the module assigned to you. Avoid editing `base.py`, `app.py` and `application.conf` unless the common contract really needs to change.
3. Keep data, weights and local configuration files out of Git; use separate paths for each experiment.
4. Before the pull request, merge the latest changes from `main` into your branch and run `python3 -m unittest discover -s tests -v`.

The shared `Pipeline` contract remains available for source and optimizer implementations. The Guanajuato model flow can already be run through `run_model_app()`.

# GradientDescentFarmers

Base template for the NASA Space Apps project. Requires Python 3.10 or higher and does not install ML libraries: each implementation can choose its own framework.

The implemented environmental pipeline is documented in
[FarmProfileBuilder](gradientdescentfarmers/source_builder/README.md). The
[rotation MVP](gradientdescentfarmers/rotations_service/README.md) adds real
PCSE/WOFOST simulations, regional SIAP gross-income scenarios and Pareto
selection using farmer priorities, locally and on GCP. Its results are
exploratory and require local calibration; soil and pesticide indicators are
heuristic proxies. Each implementation installs through its own optional extras.

## Web app and WhatsApp demo

`frontend/` is the YoliA web app (React + Vite, Spanish first). It needs only Node 22.12 or newer: no Python, backend or API key, because
the model results it shows are committed in `frontend/public/data/`.

```bash
cd frontend
npm ci
npm run dev        # http://localhost:5173  (home page; the WhatsApp simulation is at /demo/whatsapp)
npm test && npm run lint && npm run build
```

`server/` is an optional Twilio WhatsApp Sandbox webhook that answers with the same conversation engine; see
[server/README.md](server/README.md) for the setup (it needs a Twilio account and keeps its credentials in a git-ignored `.env`).
Details of the app, its pages, and how Daniel's data (environmental profiles and rotation runs for Sonora, Sinaloa and Guanajuato) gets into it and is refreshed are in [frontend/README.md](frontend/README.md).

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

The shared configuration has the sections `source`, `model` and `optimizer`. Each team can create its own file, for example `resources/experiment.local.conf`, without editing the base file. `*.local.conf` files are ignored by Git.

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

Once the team agrees on concrete implementations, they can create an entry point that instantiates them and runs training, evaluation and export.

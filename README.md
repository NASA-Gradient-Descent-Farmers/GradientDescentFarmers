# GradientDescentFarmers

Plantilla base para el proyecto NASA Space Apps. Requiere Python 3.10 o superior y no instala librerías de ML: cada implementación puede escoger su propio framework.

## Estructura

```text
gradientdescentfarmers/
  app.py                 # configuración y orden de integración
  source_builder/        # carga o preparación de datos
  model_builder/         # construcción del modelo
  optimizer_builder/     # construcción del optimizador
  version.py             # versión única del paquete
resources/
  application.conf       # esquema JSON compartido
tests/
  source_builder/
  model_builder/
  optimizer_builder/
data/
```

## Empezar

Desde la raíz del repositorio:

```bash
python3 -m pip install -r requirements.txt
python3 -m unittest discover -s tests -v
```

La configuración compartida tiene las secciones `source`, `model` y `optimizer`. Cada equipo puede crear un archivo propio, por ejemplo `resources/experimento.local.conf`, sin editar el archivo base. Los archivos `*.local.conf` se ignoran en Git.

## Contratos entre módulos

Cada módulo exporta una clase base (`SourceBuilder`, `ModelBuilder`, `OptimizerBuilder`) desde su `__init__.py`. Las implementaciones se agregan dentro del módulo correspondiente. El flujo común es:

```python
from gradientdescentfarmers.app import Pipeline, PipelineConfig
from gradientdescentfarmers.source_builder import SourceBuilder
from gradientdescentfarmers.model_builder import ModelBuilder
from gradientdescentfarmers.optimizer_builder import OptimizerBuilder


class MySource(SourceBuilder):
    def build(self, config):
        return ...  # datos preparados


class MyModel(ModelBuilder):
    def build(self, source, config):
        return ...  # modelo construido a partir de los datos


class MyOptimizer(OptimizerBuilder):
    def build(self, model, config):
        return ...  # optimizador configurado para el modelo


config = PipelineConfig.from_file("resources/application.conf")
components = Pipeline(MySource(), MyModel(), MyOptimizer()).build(config)
```

`Pipeline.build` arma los tres componentes; el entrenamiento y la evaluación pertenecen a la implementación que use esos componentes. El tipo concreto de datos y modelo se acuerda entre quienes integren esas ramas.

## Versión del paquete

La versión del paquete se cambia **solo** en `gradientdescentfarmers/version.py`; `pyproject.toml` la toma de ahí.

## Trabajo en ramas

1. Crea tu rama desde esta plantilla en `main`.
2. Agrega implementaciones y pruebas en el módulo que te corresponda. Evita editar `base.py`, `app.py` y `application.conf` salvo que el contrato común realmente deba cambiar.
3. Mantén datos, pesos y archivos de configuración local fuera de Git; usa rutas propias para cada experimento.
4. Antes del pull request, integra los cambios recientes de `main` en tu rama y ejecuta `python3 -m unittest discover -s tests -v`.

Cuando el equipo acuerde implementaciones concretas, pueden crear un punto de entrada que las instancie y ejecute entrenamiento, evaluación y exportación.

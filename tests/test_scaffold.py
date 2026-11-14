"""Integration checks for the contracts shared by feature branches."""

import tempfile
import unittest
from pathlib import Path

from gradientdescentfarmers import __version__
from gradientdescentfarmers.app import Pipeline, PipelineConfig
from gradientdescentfarmers.model_builder import ModelBuilder
from gradientdescentfarmers.optimizer_builder import OptimizerBuilder
from gradientdescentfarmers.source_builder import SourceBuilder


class ExampleSource(SourceBuilder):
    def build(self, config):
        return [config["value"]]


class ExampleModel(ModelBuilder):
    def build(self, source, config):
        return {"source": source, "factor": config["factor"]}


class ExampleOptimizer(OptimizerBuilder):
    def build(self, model, config):
        return {"model": model, "rate": config["rate"]}


class ScaffoldTests(unittest.TestCase):
    def test_pipeline_passes_previous_component_to_next_builder(self):
        config = PipelineConfig(
            source={"value": 3}, model={"factor": 2}, optimizer={"rate": 0.1}
        )
        result = Pipeline(ExampleSource(), ExampleModel(), ExampleOptimizer()).build(config)
        self.assertEqual(result.source, [3])
        self.assertIs(result.model["source"], result.source)
        self.assertIs(result.optimizer["model"], result.model)
        self.assertEqual(result.optimizer["rate"], 0.1)

    def test_template_config_is_valid(self):
        path = Path(__file__).resolve().parents[1] / "resources" / "application.conf"
        self.assertEqual(PipelineConfig.from_file(path), PipelineConfig({}, {}, {}))

    def test_config_rejects_missing_section(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.json"
            path.write_text('{"source": {}, "model": {}}', encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "optimizer"):
                PipelineConfig.from_file(path)

    def test_package_has_version(self):
        self.assertRegex(__version__, r"^\d+\.\d+\.\d+$")


if __name__ == "__main__":
    unittest.main()

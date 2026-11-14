"""Small integration point for independently developed builders."""

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping

from .model_builder import ModelBuilder
from .optimizer_builder import OptimizerBuilder
from .source_builder import SourceBuilder


@dataclass(frozen=True)
class PipelineConfig:
    source: Mapping[str, Any]
    model: Mapping[str, Any]
    optimizer: Mapping[str, Any]

    @classmethod
    def from_file(cls, path: str | Path) -> "PipelineConfig":
        """Read the shared JSON configuration and check its three sections."""
        with Path(path).open(encoding="utf-8") as config_file:
            data = json.load(config_file)
        if not isinstance(data, dict):
            raise ValueError("La configuración debe ser un objeto JSON")
        sections = {}
        for name in ("source", "model", "optimizer"):
            value = data.get(name)
            if not isinstance(value, dict):
                raise ValueError(f"La sección '{name}' debe ser un objeto JSON")
            sections[name] = value
        return cls(**sections)


@dataclass(frozen=True)
class PipelineComponents:
    source: Any
    model: Any
    optimizer: Any


@dataclass(frozen=True)
class Pipeline:
    source_builder: SourceBuilder
    model_builder: ModelBuilder
    optimizer_builder: OptimizerBuilder

    def build(self, config: PipelineConfig) -> PipelineComponents:
        """Build components in dependency order."""
        source = self.source_builder.build(config.source)
        model = self.model_builder.build(source, config.model)
        optimizer = self.optimizer_builder.build(model, config.optimizer)
        return PipelineComponents(source, model, optimizer)

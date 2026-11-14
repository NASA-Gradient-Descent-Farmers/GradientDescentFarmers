"""Contract owned by the optimizer builder module."""

from abc import ABC, abstractmethod
from typing import Any, Mapping


class OptimizerBuilder(ABC):
    """Configure an optimizer for an already constructed model."""

    @abstractmethod
    def build(self, model: Any, config: Mapping[str, Any]) -> Any:
        """Return an optimizer using the ``optimizer`` configuration section."""

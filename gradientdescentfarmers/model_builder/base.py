"""Contract owned by the model builder module."""

from abc import ABC, abstractmethod
from typing import Any, Mapping


class ModelBuilder(ABC):
    """Construct a model using the prepared source and model settings."""

    @abstractmethod
    def build(self, source: Any, config: Mapping[str, Any]) -> Any:
        """Return a model using the ``model`` configuration section."""

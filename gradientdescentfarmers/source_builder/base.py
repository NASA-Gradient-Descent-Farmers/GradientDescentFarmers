"""Contract owned by the source builder module."""

from abc import ABC, abstractmethod
from typing import Any, Mapping


class SourceBuilder(ABC):
    """Prepare data in the format expected by a model implementation."""

    @abstractmethod
    def build(self, config: Mapping[str, Any]) -> Any:
        """Return a data source using the ``source`` configuration section."""

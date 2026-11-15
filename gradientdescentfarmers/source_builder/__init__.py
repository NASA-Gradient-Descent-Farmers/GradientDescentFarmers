"""Scientific data pipeline implementations of the team's SourceBuilder contract."""
from .base import SourceBuilder
from .adapter import NASAProfileSourceBuilder

# Resolved on first access so that importing this package does not require pandas.
_ECONOMIC_EXPORTS = ("EconomicQuery", "EconomicSource", "EconomicSourceBuilder")

__all__ = ["SourceBuilder", "NASAProfileSourceBuilder", *_ECONOMIC_EXPORTS]


def __getattr__(name):
    if name in _ECONOMIC_EXPORTS:
        from . import economic
        return getattr(economic, name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")

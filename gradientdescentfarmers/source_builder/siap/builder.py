"""``SourceBuilder`` implementation so SIAP data plugs into the team's ``Pipeline`` contract."""
from __future__ import annotations

from typing import Any, Mapping

import pandas as pd

from ..base import SourceBuilder
from .client import SiapClient, SiapSettings
from .store import SiapStore


class SiapSourceBuilder(SourceBuilder):
    """Return SIAP production data as a DataFrame.

    ``config`` keys (all optional): ``root``, ``dataset`` (default ``"municipal"``), ``years``,
    ``state``, ``crop``, ``sync`` (download missing years first; default False so a web
    request never triggers network access), ``refresh``.
    """

    def __init__(self, client: SiapClient | None = None):
        self._client = client

    def build(self, config: Mapping[str, Any]) -> pd.DataFrame:
        store = SiapStore(config.get("root"))
        dataset = config.get("dataset", "municipal")
        years = config.get("years")
        if config.get("sync", False):
            client = self._client or SiapClient(SiapSettings(**config.get("http", {})))
            report = store.sync(client, [dataset], years, refresh=bool(config.get("refresh", False)))
            failed = {y: s for y, s in report[dataset].items() if s.startswith("failed")}
            if failed and not store.available_years(dataset):
                raise RuntimeError(f"SIAP sync failed and no local data exists: {failed}")
        return store.load(dataset, years, config.get("state"), config.get("crop"))

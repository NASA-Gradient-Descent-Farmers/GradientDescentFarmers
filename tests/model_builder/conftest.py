"""Shared fixtures for the rotation engine tests."""
from pathlib import Path

import pytest

FIXTURE = Path(__file__).parent / "fixtures" / "three_districts"


@pytest.fixture
def panel_run():
    """The engine pointed at the committed three-district panel (Cortazar, Los Mochis, Cajeme)."""
    pytest.importorskip("pyarrow")
    from gradientdescentfarmers.model_builder.rotations import panel

    yield panel.use(FIXTURE)

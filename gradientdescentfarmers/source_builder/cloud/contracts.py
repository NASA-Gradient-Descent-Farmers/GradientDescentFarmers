"""Validated cloud requests. Runtime paths are always controlled by the VM."""
from __future__ import annotations

import hashlib
import json
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator

from ..core.schema import FarmerInput
from ..core.settings import BuilderSettings


def json_bytes(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode()


class BuildRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    config: dict[str, Any]
    farmer_input: FarmerInput
    settings: BuilderSettings
    idempotency_key: str | None = Field(default=None, min_length=1, max_length=128)

    @model_validator(mode="after")
    def check_config(self):
        if not isinstance(self.config.get("source"), dict):
            raise ValueError("config must contain a source object")
        # Credentials belong in Secret Manager, never in persisted requests.
        forbidden = {"earthdata_username", "earthdata_password", "earthdata_token",
                     "usda_nass_api_key", "faostat_jwt", "private_key", "access_token"}
        def check(value):
            if isinstance(value, dict):
                for key, child in value.items():
                    if key.lower() in forbidden:
                        raise ValueError("credentials are not accepted in build requests")
                    check(child)
            elif isinstance(value, list):
                for child in value:
                    check(child)
        check(self.config)
        return self

    def documents(self) -> dict[str, Any]:
        return self.model_dump(mode="json", exclude={"idempotency_key"})

    def digest(self) -> str:
        return hashlib.sha256(json_bytes(self.documents())).hexdigest()

"""Application settings, read from environment variables (or a local .env file)."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=PROJECT_ROOT / ".env", env_prefix="CHURNSIGHT_", extra="ignore")

    app_env: str = Field("development", description="development | production")
    models_dir: Path = PROJECT_ROOT / "models"
    # Comma-separated list of allowed browser origins. No wildcard by default.
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173"
    max_body_bytes: int = 16_384
    log_level: str = "INFO"

    @field_validator("cors_origins")
    @classmethod
    def _no_blank(cls, v: str) -> str:
        return ",".join(o.strip() for o in v.split(",") if o.strip())

    @property
    def cors_origin_list(self) -> list[str]:
        return [o for o in self.cors_origins.split(",") if o]


@lru_cache
def get_settings() -> Settings:
    return Settings()

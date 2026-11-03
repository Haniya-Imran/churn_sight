"""Vercel entrypoint for the ChurnSight FastAPI backend.

Locally you can keep using: uvicorn backend.app.main:app --port 8000
"""
from backend.app.main import app  # noqa: F401

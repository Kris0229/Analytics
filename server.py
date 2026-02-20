from __future__ import annotations

from functools import lru_cache
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

try:
    from pybaseball import statcast_batter, statcast_pitcher
except Exception as exc:  # pragma: no cover
    raise RuntimeError(
        "pybaseball 無法載入，請先安裝 requirements.txt"
    ) from exc

app = FastAPI(title="Fantasy Baseball Cheatsheet API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

BATTER_METRICS = {
    "avg_hit_speed": "平均擊球初速 (mph)",
    "max_hit_speed": "最大擊球初速 (mph)",
    "sweet_spot_percent": "Sweet Spot %",
    "barrel_batted_rate": "Barrel %",
    "hard_hit_percent": "Hard Hit %",
    "avg_launch_angle": "平均仰角",
}

PITCHER_METRICS = {
    "avg_speed": "平均球速 (mph)",
    "release_spin_rate": "平均轉速 (rpm)",
    "whiff_percent": "Whiff %",
    "hard_hit_percent": "Hard Hit %",
    "barrel_batted_rate": "Barrel %",
}


def _percentile(series, value: float) -> Optional[float]:
    values = series.dropna().astype(float)
    if values.empty:
        return None
    percentile = (values <= value).mean() * 100
    return round(float(percentile), 1)


def _load_statcast(func, season: int):
    # pybaseball signature differs by version; try common variants.
    variants = [
        lambda: func(season, minBBE="q"),
        lambda: func(season),
        lambda: func(f"{season}-03-01", f"{season}-11-30"),
    ]
    last_exc = None
    for variant in variants:
        try:
            return variant()
        except TypeError as exc:
            last_exc = exc
            continue
    if last_exc:
        raise last_exc
    raise RuntimeError("Unable to load Statcast data")


@lru_cache(maxsize=6)
def load_leaderboard(role: str, season: int):
    if role == "batter":
        return _load_statcast(statcast_batter, season)
    if role == "pitcher":
        return _load_statcast(statcast_pitcher, season)
    raise ValueError("Unknown role")


def build_metrics(row, leaderboard, mapping: Dict[str, str]):
    metrics: List[Dict[str, Any]] = []
    for key, label in mapping.items():
        if key not in leaderboard.columns:
            continue
        value = row.get(key)
        if value is None:
            continue
        percentile = _percentile(leaderboard[key], float(value))
        metrics.append(
            {
                "key": key,
                "label": label,
                "value": round(float(value), 2),
                "percentile": percentile,
            }
        )
    return metrics


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/player")
async def player(mlb_id: int, season: int = 2025, role: str = "batter"):
    try:
        leaderboard = load_leaderboard(role, season)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    row = None
    if "player_id" in leaderboard.columns:
        match = leaderboard[leaderboard["player_id"] == mlb_id]
        if not match.empty:
            row = match.iloc[0]
    if row is None and "playerid" in leaderboard.columns:
        match = leaderboard[leaderboard["playerid"] == mlb_id]
        if not match.empty:
            row = match.iloc[0]

    if row is None:
        raise HTTPException(status_code=404, detail="player not found in leaderboard")

    if role == "pitcher":
        metrics = build_metrics(row, leaderboard, PITCHER_METRICS)
    else:
        metrics = build_metrics(row, leaderboard, BATTER_METRICS)

    return {
        "player_id": mlb_id,
        "season": season,
        "role": role,
        "metrics": metrics,
    }

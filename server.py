from __future__ import annotations

from functools import lru_cache
from typing import Any, Dict, List, Optional, Sequence, Tuple

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

try:
    from pybaseball import statcast_batter, statcast_pitcher
    try:
        from pybaseball import (
            statcast_batter_exitvelo_barrels,
            statcast_pitcher_exitvelo_barrels,
        )
    except Exception:
        statcast_batter_exitvelo_barrels = None
        statcast_pitcher_exitvelo_barrels = None
    try:
        from pybaseball import (
            statcast_batter_percentile_ranks,
            statcast_pitcher_percentile_ranks,
        )
    except Exception:
        statcast_batter_percentile_ranks = None
        statcast_pitcher_percentile_ranks = None
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
    "contact_rate": "Contact %",
    "whiff_percent": "Whiff %",
}

PITCHER_METRICS = {
    "avg_speed": "平均球速 (mph)",
    "release_spin_rate": "平均轉速 (rpm)",
    "whiff_percent": "Whiff %",
    "hard_hit_percent": "Hard Hit %",
    "barrel_batted_rate": "Barrel %",
}

METRIC_PERCENTILE_COLUMNS = {
    "avg_hit_speed": ["avg_hit_speed_percentile", "avg_hit_speed"],
    "max_hit_speed": ["max_hit_speed_percentile", "max_hit_speed"],
    "sweet_spot_percent": ["sweet_spot_percentile", "sweet_spot_percent"],
    "barrel_batted_rate": ["barrel_batted_rate_percentile", "barrel_batted_rate"],
    "hard_hit_percent": ["hard_hit_percentile", "hard_hit_percent"],
    "avg_launch_angle": ["avg_launch_angle_percentile", "avg_launch_angle"],
    "contact_rate": ["contact_percentile", "contact_rate"],
    "whiff_percent": ["whiff_percentile", "whiff_percent"],
    "avg_speed": ["avg_speed_percentile", "avg_speed"],
    "release_spin_rate": ["release_spin_rate_percentile", "release_spin_rate"],
}

SWING_DESCRIPTIONS = {
    "swinging_strike",
    "swinging_strike_blocked",
    "foul",
    "foul_tip",
    "hit_into_play",
    "hit_into_play_no_out",
    "hit_into_play_score",
    "missed_bunt",
}

WHIFF_DESCRIPTIONS = {"swinging_strike", "swinging_strike_blocked", "missed_bunt"}

ID_COLUMNS = ("player_id", "playerid", "key_mlbam", "mlb_id")


def _percentile(series, value: float) -> Optional[float]:
    values = series.dropna().astype(float)
    if values.empty:
        return None
    percentile = (values <= value).mean() * 100
    return round(float(percentile), 1)


def _load_player_statcast(role: str, season: int, player_id: int):
    start_date = f"{season}-03-01"
    end_date = f"{season}-11-30"
    func = statcast_pitcher if role == "pitcher" else statcast_batter
    variants = [
        lambda: func(start_date, end_date, player_id),
        lambda: func(player_id, start_date, end_date),
        lambda: func(start_date, end_date, player_id=player_id),
        lambda: func(start_date, end_date, pitcher_id=player_id),
        lambda: func(start_date, end_date, batter_id=player_id),
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
    raise RuntimeError("Unable to load Statcast data for player")


def _get_contact_whiff_rates(dataframe) -> Tuple[Optional[float], Optional[float]]:
    if "description" not in dataframe.columns:
        return None, None
    desc = dataframe["description"].dropna()
    swings = desc.isin(SWING_DESCRIPTIONS).sum()
    if swings == 0:
        return None, None
    whiffs = desc.isin(WHIFF_DESCRIPTIONS).sum()
    whiff_rate = whiffs / swings * 100
    contact_rate = (swings - whiffs) / swings * 100
    return round(contact_rate, 2), round(whiff_rate, 2)


def _get_batted_ball_rates(dataframe) -> Dict[str, Optional[float]]:
    if "launch_speed" not in dataframe.columns:
        return {"hard_hit_percent": None, "barrel_batted_rate": None, "sweet_spot_percent": None}
    balls = dataframe[dataframe["launch_speed"].notna()]
    if balls.empty:
        return {"hard_hit_percent": None, "barrel_batted_rate": None, "sweet_spot_percent": None}
    hard_hit = (balls["launch_speed"] >= 95).mean() * 100
    if "barrel" in balls.columns:
        barrels = (balls["barrel"] == 1).mean() * 100
    elif "launch_speed_angle" in balls.columns:
        barrels = balls["launch_speed_angle"].isin([6, 7]).mean() * 100
    else:
        barrels = None
    if "launch_angle" in balls.columns:
        sweet_spot = balls["launch_angle"].between(8, 32).mean() * 100
    else:
        sweet_spot = None
    return {
        "hard_hit_percent": round(float(hard_hit), 2) if hard_hit is not None else None,
        "barrel_batted_rate": round(float(barrels), 2) if barrels is not None else None,
        "sweet_spot_percent": round(float(sweet_spot), 2) if sweet_spot is not None else None,
    }


@lru_cache(maxsize=6)
def load_exitvelo_leaderboard(role: str, season: int):
    if role == "batter" and statcast_batter_exitvelo_barrels:
        return statcast_batter_exitvelo_barrels(season)
    if role == "pitcher" and statcast_pitcher_exitvelo_barrels:
        return statcast_pitcher_exitvelo_barrels(season)
    return None


@lru_cache(maxsize=6)
def load_percentile_ranks(role: str, season: int):
    if role == "batter" and statcast_batter_percentile_ranks:
        return statcast_batter_percentile_ranks(season)
    if role == "pitcher" and statcast_pitcher_percentile_ranks:
        return statcast_pitcher_percentile_ranks(season)
    return None


def _find_player_row(dataframe, player_id: int):
    for column in ID_COLUMNS:
        if column in dataframe.columns:
            match = dataframe[dataframe[column] == player_id]
            if not match.empty:
                return match.iloc[0]
    return None


def _resolve_percentile(
    metric_key: str,
    value: Optional[float],
    percentile_df,
    leaderboard_df,
    player_id: int,
) -> Optional[float]:
    if percentile_df is not None:
        row = _find_player_row(percentile_df, player_id)
        if row is not None:
            for col in METRIC_PERCENTILE_COLUMNS.get(metric_key, []):
                if col not in percentile_df.columns:
                    continue
                percentile_value = row.get(col)
                if percentile_value is None:
                    continue
                if "percentile" in col:
                    return round(float(percentile_value), 1)
                if value is not None:
                    return _percentile(percentile_df[col], float(value))
    if leaderboard_df is not None and value is not None:
        if metric_key in leaderboard_df.columns:
            return _percentile(leaderboard_df[metric_key], float(value))
    return None


def build_metrics(
    values: Dict[str, Optional[float]],
    mapping: Dict[str, str],
    percentile_df,
    leaderboard_df,
    player_id: int,
):
    metrics: List[Dict[str, Any]] = []
    for key, label in mapping.items():
        value = values.get(key)
        if value is None:
            continue
        percentile = _resolve_percentile(key, value, percentile_df, leaderboard_df, player_id)
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
        statcast_df = _load_player_statcast(role, season, mlb_id)
        leaderboard = load_exitvelo_leaderboard(role, season)
        percentile_df = load_percentile_ranks(role, season)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    if statcast_df is None or statcast_df.empty:
        return {
            "player_id": mlb_id,
            "season": season,
            "role": role,
            "metrics": [],
            "note": "本季無 Statcast 資料",
        }

    values: Dict[str, Optional[float]] = {}
    if role == "pitcher":
        if "release_speed" in statcast_df.columns:
            values["avg_speed"] = statcast_df["release_speed"].dropna().mean()
        if "release_spin_rate" in statcast_df.columns:
            values["release_spin_rate"] = statcast_df["release_spin_rate"].dropna().mean()
        contact_rate, whiff_rate = _get_contact_whiff_rates(statcast_df)
        values["whiff_percent"] = whiff_rate
        values.update(_get_batted_ball_rates(statcast_df))
        metrics = build_metrics(values, PITCHER_METRICS, percentile_df, leaderboard, mlb_id)
    else:
        if "launch_speed" in statcast_df.columns:
            values["avg_hit_speed"] = statcast_df["launch_speed"].dropna().mean()
            values["max_hit_speed"] = statcast_df["launch_speed"].dropna().max()
        if "launch_angle" in statcast_df.columns:
            values["avg_launch_angle"] = statcast_df["launch_angle"].dropna().mean()
        values.update(_get_batted_ball_rates(statcast_df))
        contact_rate, whiff_rate = _get_contact_whiff_rates(statcast_df)
        values["contact_rate"] = contact_rate
        values["whiff_percent"] = whiff_rate
        metrics = build_metrics(values, BATTER_METRICS, percentile_df, leaderboard, mlb_id)

    return {
        "player_id": mlb_id,
        "season": season,
        "role": role,
        "metrics": metrics,
    }

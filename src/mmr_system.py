#!/usr/bin/env python3
import argparse
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Dict

import pandas as pd

# Config & Defaults


TIER_BASE: Dict[int, float] = {
    1: 1600.0,
    2: 1500.0,
    3: 1400.0,
    4: 1300.0,
    5: 1200.0,
}

# Key words[codes, Divisons, Tier mapping]
DIV_TIER_MAP: Dict[str, int] = {
    # England
    "E0": 1, "E1": 2, "E2": 3, "E3": 4, "E4": 5,
    # Spain
    "SP1": 1, "SP2": 2,
    # Italy
    "I1": 1, "I2": 2,
    # Germany
    "D1": 1, "D2": 2,
    # France
    "F1": 1, "F2": 2,
}

DEFAULT_K = 40.0
HOME_ADVANTAGE = 60.0
SEASON_BLEND = 0.5
PROMOTION_BONUS = 75.0
RELEGATION_NERF = 75.0  # positive magnitude


# Helpers Key words[Definations, Divisons, Tier Sorting]


def get_tier_from_div(div: str) -> int:
    """Return tier integer for a division code, falling back to digits if unknown."""
    if div in DIV_TIER_MAP:
        return DIV_TIER_MAP[div]
    digits = "".join([c for c in div if c.isdigit()])
    if digits:
        try:
            tier_num = int(digits)
            # clamp reasonable tiers [1..5]
            return max(1, min(5, tier_num if tier_num >= 1 else 1))
        except ValueError:
            pass
    return 1


def base_for_div(div: str) -> float:
    return TIER_BASE.get(get_tier_from_div(div), 1500.0)


def compute_season_key(ts: pd.Timestamp) -> int:
    """European season start around July. Season key = starting year."""
    return ts.year if ts.month >= 7 else ts.year - 1


def expected_home_score(home_mmr: float, away_mmr: float, home_advantage: float) -> float:
    return 1.0 / (1.0 + 10.0 ** ((away_mmr - (home_mmr + home_advantage)) / 400.0))


def goal_diff_factor(home_mmr: float, away_mmr: float, goal_diff_abs: int) -> float:
    """
    Goal difference scaling for Elo-style updates.

    Important: draws (goal_diff_abs == 0) should still move MMR, so we use 1.0
    instead of 0 to avoid killing all rating change on draws.
    """
    if goal_diff_abs == 0:
        # Draws: use normal K (no GD boost, but not zero either)
        return 1.0

    return math.log10(goal_diff_abs + 1.0) * (
        2.2 / (((home_mmr - away_mmr) * 0.001) + 2.2)
    )


@dataclass
class TeamState:
    mmr: float
    last_season: int = None
    last_tier: int = None


# Idk bruh thb  Key words[Core, Divisons, Processing, Core Processing]


def parse_dates_robust(series: pd.Series) -> pd.Series:
    """Try several date formats and coercions; drop invalid later."""
    s = series.astype(str).str.strip().str.replace(".", "/", regex=False)
    # Try vectorized to_datetime first
    parsed = pd.to_datetime(s, errors="coerce", dayfirst=True)
    # Fill remaining with month-first trial
    mask = parsed.isna()
    if mask.any():
        parsed2 = pd.to_datetime(s[mask], errors="coerce", dayfirst=False)
        parsed.loc[mask] = parsed2

    # Final attempt per-cell with a small set of formats
    def try_manual(x: str):
        from datetime import datetime
        fmts = [
            "%d/%m/%Y", "%d/%m/%y",
            "%Y-%m-%d",
            "%d-%m-%Y", "%d-%m-%y",
            "%m/%d/%Y", "%m/%d/%y",
            "%Y/%m/%d",
        ]
        for f in fmts:
            try:
                return pd.Timestamp(datetime.strptime(x, f))
            except Exception:
                continue
        return pd.NaT

    mask = parsed.isna()
    if mask.any():
        parsed.loc[mask] = s[mask].map(try_manual)
    return parsed


def process_matches(
    df: pd.DataFrame,
    k: float = DEFAULT_K,
    home_adv: float = HOME_ADVANTAGE,
    season_blend: float = SEASON_BLEND,
    promotion_bonus: float = PROMOTION_BONUS,
    relegation_nerf: float = RELEGATION_NERF,
) -> pd.DataFrame:
    """
    Process matches in chronological order and return a per-match MMR log.

    Required input columns: Date, Div, HomeTeam, AwayTeam, FTHG, FTAG
    """
    # Validate columns
    required_cols = ["Date", "Div", "HomeTeam", "AwayTeam", "FTHG", "FTAG"]
    for c in required_cols:
        if c not in df.columns:
            raise ValueError(f"Input missing required column: {c}")

    df = df.copy()
    df["Date"] = parse_dates_robust(df["Date"])
    before = len(df)
    df = df.dropna(subset=["Date"]).reset_index(drop=True)
    if len(df) == 0:
        raise ValueError("All rows had unparseable dates in 'Date' column.")

    df = df.sort_values("Date").reset_index(drop=True)

    teams: Dict[str, TeamState] = {}
    rows = []

    def preseason_adjust(team: str, div: str, season: int):
        base = base_for_div(div)
        tier = get_tier_from_div(div)
        # New team: initialize at division base
        if team not in teams:
            teams[team] = TeamState(mmr=base, last_season=season, last_tier=tier)
            return
        st = teams[team]
        if st.last_season is None or st.last_season != season:
            # Blend toward current division base
            st.mmr = (1 - season_blend) * st.mmr + season_blend * base
            # If tier changed vs last season, apply promo/relegation adjustment
            if st.last_tier is not None and tier != st.last_tier:
                # smaller tier number -> promotion
                if tier < st.last_tier:
                    # promotion: nudge further toward new base
                    direction = 1.0 if (base - st.mmr) >= 0 else -1.0
                    st.mmr += direction * promotion_bonus
                else:
                    # relegation: nudge away from previous base toward lower tier base (penalty)
                    direction = 1.0 if (base - st.mmr) >= 0 else -1.0
                    st.mmr -= direction * relegation_nerf
            st.last_season = season
            st.last_tier = tier
        else:
            # same season; update tier if changed in-season (rare)
            st.last_tier = tier

    for _, row in df.iterrows():
        date = row["Date"]
        div = str(row["Div"]).strip()
        home = str(row["HomeTeam"]).strip()
        away = str(row["AwayTeam"]).strip()
        # Goals as integers
        fthg = int(float(row["FTHG"])) if pd.notna(row["FTHG"]) else 0
        ftag = int(float(row["FTAG"])) if pd.notna(row["FTAG"]) else 0

        season = compute_season_key(pd.Timestamp(date))

        # Preseason checks
        preseason_adjust(home, div, season)
        preseason_adjust(away, div, season)

        home_before = teams[home].mmr
        away_before = teams[away].mmr

        goal_diff = fthg - ftag
        gd_abs = abs(goal_diff)

        exp_home = expected_home_score(home_before, away_before, home_adv)
        exp_away = 1.0 - exp_home

        if goal_diff > 0:
            actual_home = 1.0
        elif goal_diff == 0:
            actual_home = 0.5
        else:
            actual_home = 0.0

        gdf = goal_diff_factor(home_before, away_before, gd_abs)
        delta_home = k * gdf * (actual_home - exp_home)
        delta_away = -delta_home  # keep it symmetric

        home_after = home_before + delta_home
        away_after = away_before + delta_away

        teams[home].mmr = home_after
        teams[away].mmr = away_after

        rows.append({
            "Date": pd.Timestamp(date).date().isoformat(),
            "Div": div,
            "HomeTeam": home,
            "AwayTeam": away,
            "FTHG": int(fthg),
            "FTAG": int(ftag),
            "HomeTeamMMRBefore": round(home_before, 3),
            "AwayTeamMMRBefore": round(away_before, 3),
            "HomeTeamMMRAfter": round(home_after, 3),
            "AwayTeamMMRAfter": round(away_after, 3),
            "DeltaHome": round(delta_home, 3),
            "DeltaAway": round(delta_away, 3),
            "ExpectedHome": round(exp_home, 5),
            "ExpectedAway": round(exp_away, 5),
            "KUsed": k,
            "GoalDiff": int(goal_diff),
        })

    out_df = pd.DataFrame(rows, columns=[
        "Date", "Div", "HomeTeam", "AwayTeam", "FTHG", "FTAG",
        "HomeTeamMMRBefore", "AwayTeamMMRBefore", "HomeTeamMMRAfter", "AwayTeamMMRAfter",
        "DeltaHome", "DeltaAway", "ExpectedHome", "ExpectedAway", "KUsed", "GoalDiff"
    ])
    return out_df


def main():
    ap = argparse.ArgumentParser(description="MMR system for multi-league, multi-division football data.")
    ap.add_argument("--input", required=True, help="CSV with columns: Date, Div, HomeTeam, AwayTeam, FTHG, FTAG")
    ap.add_argument("--output", required=True, help="Output CSV path for per-match MMR rows")
    ap.add_argument("--k", type=float, default=DEFAULT_K)
    ap.add_argument("--home-adv", type=float, default=HOME_ADVANTAGE)
    ap.add_argument("--season-blend", type=float, default=SEASON_BLEND)
    ap.add_argument("--promotion-bonus", type=float, default=PROMOTION_BONUS)
    ap.add_argument("--relegation-nerf", type=float, default=RELEGATION_NERF)
    args = ap.parse_args()

    df = pd.read_csv(Path(args.input))
    out_df = process_matches(
        df,
        k=args.k,
        home_adv=args.home_adv,
        season_blend=args.season_blend,
        promotion_bonus=args.promotion_bonus,
        relegation_nerf=args.relegation_nerf,
    )
    out_df.to_csv(Path(args.output), index=False)
    print(f"Wrote {len(out_df)} rows to {args.output}")


if __name__ == "__main__":
    main()

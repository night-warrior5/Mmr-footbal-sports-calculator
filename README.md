# Multi-League, Multi-Division MMR System

This project implements an **MMR (Elo-like) rating system** for association football across the top 5 European leagues and their divisions.
It is designed to:
- Initialize **base MMRs per league & division** (e.g., Premier League vs. Championship).
- Update MMRs **per match** using an Elo-style formula with **goal-difference scaling**.
- Apply **season resets** that pull each team toward their league/division **base MMR**.
- Apply **promotion/relegation adjustments** toward the **new division's base** (promotion boost / relegation nerf).
- Produce a per-match output file with the following columns:

```
Date	Div	HomeTeam	AwayTeam	FTHG	FTAG	HomeTeamMMRBefore	AwayTeamMMRBefore	HomeTeamMMRAfter	AwayTeamMMRAfter	DeltaHome	DeltaAway	ExpectedHome	ExpectedAway	KUsed	GoalDiff
```

> The implementation is dataset-agnostic, but the included example uses a file like `E0 - 1993-2010 (1).csv` that follows the common Football-Data.co.uk schema.

## Method

### 1) Base MMR per league & division
We assign **base MMRs** per league tier (customizable in code):
- Tier 1 (top flight): **1600**
- Tier 2: **1500**
- Tier 3: **1400**
- Tier 4: **1300**
- Tier 5: **1200**

Leagues/divisions are mapped by code (e.g., `E0`=England tier 1, `E1`=England tier 2, `SP1`/`SP2`, `I1`/`I2`, `D1`/`D2`, `F1`/`F2`). You can extend this mapping via `DIV_TIER_MAP` and adjust base values in `TIER_BASE`.

### 2) Match update
We use an Elo-like expected score with a **home advantage** offset (default: +60 MMR for the home team, configurable as `HOME_ADVANTAGE`):

```
expected_home = 1 / (1 + 10 ** ((away_mmr - (home_mmr + HOME_ADVANTAGE)) / 400))
expected_away = 1 - expected_home
```

Actual score:
- Home win → `actual_home = 1`
- Draw → `0.5`
- Away win → `0`

Goal difference multiplier:

```
gd = abs(home_goals - away_goals)
gd_factor = log10(gd + 1) * (2.2 / ((home_mmr - away_mmr) * 0.001 + 2.2))
```

MMR updates (with constant `K` per match, default `40`):

```
delta_home = K * gd_factor * (actual_home - expected_home)
delta_away = -delta_home
home_mmr_after = home_mmr + delta_home
away_mmr_after = away_mmr + delta_away
```

### 3) Seasons, resets, and movement between divisions
- **Season detection** is inferred from match dates (Europe-style seasons start around July 1st). The “season key” is:
  - `season = year(Date)` if `month >= 7`; else `year(Date) - 1`.
- **Season reset** (first time a team appears in a season): pull them **halfway** to their division’s base MMR:
  - `mmr = 0.5 * mmr + 0.5 * base(div)`
- **Promotion/Relegation adjustment**: if a team’s division **tier** changes from last season:
  - Blend to new base as above, **then** apply:
    - Promotion: `+75` toward the new base
    - Relegation: `-75` toward the new base
  - (This is implemented as a signed offset `MOVEMENT_ADJ` after the blend.)

You can tune:
- `K` (default `40`)
- `HOME_ADVANTAGE` (default `60`)
- `SEASON_BLEND` toward base (default `0.5`)
- `PROMOTION_BONUS` / `RELEGATION_NERF` (default `+75` / `-75`)

### 4) Output
For each processed match, we write a row with:

- `Date, Div, HomeTeam, AwayTeam, FTHG, FTAG`
- `HomeTeamMMRBefore, AwayTeamMMRBefore, HomeTeamMMRAfter, AwayTeamMMRAfter`
- `DeltaHome, DeltaAway`
- `ExpectedHome, ExpectedAway`
- `KUsed`
- `GoalDiff`

### 5) Usage

```
python mmr_system.py \
  --input "/path/to/matches.csv" \
  --output "/path/to/mmr_per_match.csv"
```

Optional flags:
```
--k 40
--home-adv 60
--season-blend 0.5
--promotion-bonus 75
--relegation-nerf 75
```

### Notes & Assumptions
- Division codes must be present per match via a `Div` column.
- If a team appears for the first time ever, its initial MMR is the division base for that match’s division.
- If your dataset includes multiple countries/divisions, the mapping provided will generalize. You can add or modify `DIV_TIER_MAP` as needed.
- If season boundaries differ (e.g., non-European leagues), adjust `compute_season_key` accordingly.

---

## Example
We include an example run using the uploaded dataset `E0 - 1993-2010 (1).csv`, producing an output file like `mmr_output_E0_1993-2010.csv`.

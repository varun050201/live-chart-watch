"""Python mirror of pine/live_chart_watch_indicator.pine.

Implements the EXACT same rules, so the backtest measures the rules
Varun would actually see on the chart. Any change to the Pine file
must be mirrored here (and vice versa).

Rules (identical constants to the .pine file):
    atr    = Wilder ATR(14)
    ema3   = EMA(close, 3), ema6 = EMA(close, 6)
    vwap   = session (per-day) cumulative sum(close*volume)/sum(volume)
    volAvg = SMA(volume, 20)
    mom    = clip(((close - close[10]) / atr) / 2, -1, 1)
    struct = clip(((ema3 - ema6) / atr) / 0.5, -1, 1)
    vwapS  = clip((close - vwap) / atr, -1, 1)
    boost  = 1.10 if volume / volAvg >= 1.5 else 1.0
    signal = clip((0.50*mom + 0.25*struct + 0.25*vwapS) * boost, -1, 1)
    score  = round(50 + 50*|signal|)
    call   = UP if signal >= 0.35, DOWN if signal <= -0.35, else SIDEWAYS

Outcome (next 30 minutes, regular session only):
    realised UP       if close[t+30] / close[t] - 1 >  +0.15%
    realised DOWN     if                                 <  -0.15%
    realised SIDEWAYS otherwise
A call is a HIT when it equals the realised class.

Usage: python3 pine/rules_mirror.py
Writes pine/rules_backtest.md and prints the summary.
"""

from __future__ import annotations

import datetime as dt
import math
from pathlib import Path

import numpy as np
import pandas as pd
import yfinance as yf

HERE = Path(__file__).resolve().parent

# ---- constants: keep in sync with the .pine file -------------------
LOOKBACK = 10
ATR_LEN = 14
VOL_LEN = 20
W_MOM, W_STRUCT, W_VWAP = 0.50, 0.25, 0.25
THRESHOLD = 0.35
VOL_BOOST_AT = 1.5
VOL_BOOST_BY = 1.10
HORIZON_MIN = 30
MOVE_PCT = 0.0015  # +/-0.15% defines a realised UP/DOWN over 30 min
WARMUP = 100       # bars dropped so EMA/ATR/VWAP seeding does not count


def wilder_atr(high: pd.Series, low: pd.Series, close: pd.Series, n: int) -> pd.Series:
    """Wilder ATR, as Pine ta.atr: RMA of true range."""
    prev_close = close.shift(1)
    tr = pd.concat([
        high - low,
        (high - prev_close).abs(),
        (low - prev_close).abs(),
    ], axis=1).max(axis=1)
    # RMA: alpha = 1/n, seeded with the SMA of the first n values.
    atr = tr.ewm(alpha=1.0 / n, adjust=False).mean()
    return atr


def ema(series: pd.Series, n: int) -> pd.Series:
    """Pine ta.ema: alpha = 2/(n+1), seeded with the SMA of the first n."""
    alpha = 2.0 / (n + 1)
    out = series.ewm(alpha=alpha, adjust=False).mean()
    return out


def session_vwap(df: pd.DataFrame) -> pd.Series:
    """Pine ta.vwap(close): per-session cumulative sum(close*vol)/sum(vol)."""
    dates = df.index.date
    pv = df["Close"] * df["Volume"]
    cum_pv = pv.groupby(dates).cumsum()
    cum_v = df["Volume"].groupby(dates).cumsum()
    return cum_pv / cum_v.replace(0, np.nan)


def compute_calls(df: pd.DataFrame) -> pd.DataFrame:
    close = df["Close"]
    atr = wilder_atr(df["High"], df["Low"], close, ATR_LEN)
    e3, e6 = ema(close, 3), ema(close, 6)
    vwap = session_vwap(df)
    vol_avg = df["Volume"].rolling(VOL_LEN).mean()

    mom_raw = (close - close.shift(LOOKBACK)) / atr
    mom = (mom_raw / 2.0).clip(-1, 1)
    struct_raw = (e3 - e6) / atr
    struct = (struct_raw / 0.5).clip(-1, 1)
    vwap_raw = (close - vwap) / atr
    vwap_s = vwap_raw.clip(-1, 1)

    vol_ratio = df["Volume"] / vol_avg
    boost = np.where(vol_ratio >= VOL_BOOST_AT, VOL_BOOST_BY, 1.0)

    signal_raw = W_MOM * mom + W_STRUCT * struct + W_VWAP * vwap_s
    signal = pd.Series(signal_raw.values * boost, index=df.index).clip(-1, 1)
    score = (50 + 50 * signal.abs()).round().astype("Int64")
    call = np.where(signal >= THRESHOLD, "UP",
                    np.where(signal <= -THRESHOLD, "DOWN", "SIDEWAYS"))

    out = pd.DataFrame({
        "close": close, "atr": atr, "ema3": e3, "ema6": e6, "vwap": vwap,
        "mom": mom, "struct": struct, "vwap_s": vwap_s,
        "vol_ratio": vol_ratio, "signal": signal, "score": score,
        "call": call,
    }, index=df.index)
    return out


def fetch_tsla_1m(days: int = 30) -> pd.DataFrame:
    """yfinance 1-minute bars go back ~30 days, max 7 days per request."""
    end = dt.datetime.now(dt.timezone.utc)
    chunks = []
    for i in range(0, days, 7):
        chunk_end = end - dt.timedelta(days=i)
        chunk_start = chunk_end - dt.timedelta(days=7)
        data = yf.download("TSLA", start=chunk_start, end=chunk_end,
                           interval="1m", progress=False, auto_adjust=False)
        if data is not None and len(data):
            chunks.append(data)
    df = pd.concat(chunks).sort_index()
    df = df[~df.index.duplicated(keep="first")]
    # Flatten MultiIndex columns if present (newer yfinance).
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    # Regular session only, America/New_York 09:30–16:00.
    df = df.tz_convert("America/New_York")
    df = df.between_time("09:30", "15:59")
    return df


def backtest(df: pd.DataFrame) -> dict:
    calls = compute_calls(df).iloc[WARMUP:]
    future_close = calls["close"].shift(-HORIZON_MIN)
    # Only bars whose +30 min bar is in the same session (same date).
    same_day = future_close.index.date == calls.index.date
    ret = future_close / calls["close"] - 1
    realised = np.where(ret > MOVE_PCT, "UP",
                        np.where(ret < -MOVE_PCT, "DOWN", "SIDEWAYS"))
    valid = same_day & future_close.notna() & calls["call"].notna()
    c = calls.loc[valid, "call"].values
    r = realised[valid]
    hit = c == r
    rows = {}
    for name in ("UP", "DOWN", "SIDEWAYS"):
        m = c == name
        rows[name] = {
            "n": int(m.sum()),
            "share_pct": round(100 * m.mean(), 1) if len(c) else 0.0,
            "hit_rate_pct": round(100 * hit[m].mean(), 1) if m.sum() else None,
        }
    total = len(c)
    return {
        "total_bars": int(total),
        "first": str(calls.index[0]),
        "last": str(calls.index[-1]),
        "overall_hit_pct": round(100 * hit.mean(), 1),
        "per_call": rows,
        "realised_share": {k: round(100 * float((r == k).mean()), 1)
                           for k in ("UP", "DOWN", "SIDEWAYS")},
        "mean_score_by_call": {
            k: (round(float(calls.loc[valid].loc[calls.loc[valid, "call"] == k, "score"].mean()), 1)
                if (calls.loc[valid, "call"] == k).any() else None)
            for k in ("UP", "DOWN", "SIDEWAYS")},
    }


def main() -> None:
    df = fetch_tsla_1m(30)
    print(f"Fetched {len(df)} TSLA 1m bars, "
          f"{df.index[0]} -> {df.index[-1]} (America/New_York)")
    res = backtest(df)
    print(f"Evaluated bars: {res['total_bars']}")
    print(f"Overall hit rate: {res['overall_hit_pct']}% "
          f"(random 3-class guess: 33.3%)")
    print(f"Realised shares: {res['realised_share']}")
    for k, v in res["per_call"].items():
        print(f"  {k:8s} fired {v['n']:5d} ({v['share_pct']}%), "
              f"hit rate {v['hit_rate_pct']}%, "
              f"mean score {res['mean_score_by_call'][k]}")

    md = f"""# Live Chart Watch [3-Class] — rules backtest

Rules mirror: `pine/live_chart_watch_indicator.pine` (same constants).
Data: TSLA 1-minute bars, regular session (09:30–16:00 ET), last 30 days
via yfinance. Warmup: first {WARMUP} bars dropped.

- Bars evaluated: **{res['total_bars']}**
- Period: {res['first']} → {res['last']}
- Outcome: realised class over the next {HORIZON_MIN} minutes
  (UP if return > +{MOVE_PCT:.2%}, DOWN if < −{MOVE_PCT:.2%}, else SIDEWAYS)

## Results

| Call | Fired | Share | Hit rate (next 30 min) | Mean score |
|------|------:|------:|-----------------------:|-----------:|
"""
    for k in ("UP", "DOWN", "SIDEWAYS"):
        v = res["per_call"][k]
        md += (f"| {k} | {v['n']} | {v['share_pct']}% | {v['hit_rate_pct']}% | "
               f"{res['mean_score_by_call'][k]} |\n")
    md += f"""
- **Overall hit rate: {res['overall_hit_pct']}%** (a random 3-class guess is 33.3%)
- Realised shares over the same bars: UP {res['realised_share']['UP']}%, DOWN {res['realised_share']['DOWN']}%, SIDEWAYS {res['realised_share']['SIDEWAYS']}%
- Majority-class baseline (always calling the most common realised class): {max(res['realised_share'].values())}%

## Honest reading

This backtest measures the rules on the chart, not a live AI read. A hit
rate near the random or majority-class baseline means the rules describe
recent price action but do not predict the next 30 minutes. Do not trade
on the score alone; the indicator is a label for what the chart is doing
now, and the live model read in the app is a separate, unproven thing.
"""
    (HERE / "rules_backtest.md").write_text(md)
    print("Wrote pine/rules_backtest.md")


if __name__ == "__main__":
    main()

# Live Chart Watch [3-Class] — rules backtest

Rules mirror: `pine/live_chart_watch_indicator.pine` (same constants).
Data: TSLA 1-minute bars, regular session (09:30–16:00 ET), last 30 days
via yfinance. Warmup: first 100 bars dropped.

- Bars evaluated: **7606**
- Period: 2026-10-08 15:40:00-04:00 → 2026-11-05 12:58:00-05:00
- Outcome: realised class over the next 30 minutes
  (UP if return > +0.15%, DOWN if < −0.15%, else SIDEWAYS)

## Results

| Call | Fired | Share | Hit rate (next 30 min) | Mean score |
|------|------:|------:|-----------------------:|-----------:|
| UP | 2427 | 31.9% | 33.9% | 84.5 |
| DOWN | 2476 | 32.6% | 37.8% | 85.8 |
| SIDEWAYS | 2703 | 35.5% | 35.6% | 58.6 |

- **Overall hit rate: 35.7%** (a random 3-class guess is 33.3%)
- Realised shares over the same bars: UP 31.9%, DOWN 35.6%, SIDEWAYS 32.4%
- Majority-class baseline (always calling the most common realised class): 35.6%

## Honest reading

This backtest measures the rules on the chart, not a live AI read. A hit
rate near the random or majority-class baseline means the rules describe
recent price action but do not predict the next 30 minutes. Do not trade
on the score alone; the indicator is a label for what the chart is doing
now, and the live model read in the app is a separate, unproven thing.

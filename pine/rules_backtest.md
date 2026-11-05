# Live Chart Watch [3-Class] — rules backtest

Rules mirror: `pine/live_chart_watch_indicator.pine` (same constants).
Data: TSLA 1-minute bars, regular session (09:30–16:00 ET), via yfinance.
Yahoo only serves 1-minute bars for the last 30 days and the oldest
7-day chunk fell outside that window, so coverage is 2026-10-08 →
2026-11-05 (~20 trading days), not a full 30. Warmup: first 100 bars
dropped.

- Bars evaluated: **7606**
- Period: 2026-10-08 15:28:00-04:00 → 2026-11-05 12:46:00-05:00
- Outcome: realised class over the next 30 minutes
  (UP if return > +0.15%, DOWN if < −0.15%, else SIDEWAYS)

## Results

| Call | Fired | Share | Hit rate (next 30 min) | Mean score |
|------|------:|------:|-----------------------:|-----------:|
| UP | 2451 | 32.2% | 35.1% | 84.6 |
| DOWN | 2462 | 32.4% | 37.4% | 85.5 |
| SIDEWAYS | 2693 | 35.4% | 35.2% | 58.5 |

- **Overall hit rate: 35.9%** (a random 3-class guess is 33.3%)
- Realised shares over the same bars: UP 32.1%, DOWN 35.6%, SIDEWAYS 32.3%
- Majority-class baseline (always calling the most common realised class): 35.6%

## Honest reading

This backtest measures the rules on the chart, not a live AI read. A hit
rate near the random or majority-class baseline means the rules describe
recent price action but do not predict the next 30 minutes. Do not trade
on the score alone; the indicator is a label for what the chart is doing
now, and the live model read in the app is a separate, unproven thing.

# Live Chart Watch

A small, fast app that watches your TradingView screen live and scores it:
**UP / DOWN / SIDEWAYS for the next 30 minutes, with a 0–100 score**, shown
automatically in a big side panel.

The idea: instead of waiting 15 minutes after the 9:30 open for the chart to
"prove" itself, a small model watches the screen from the first second — like
a camera watching a person — and scores what it sees, frame by frame. The
prediction problem here is tiny: only three classes (up, down, sideways).

> **Experimental.** A score is a guess with a number attached, not a
> guarantee. Short-horizon direction is close to a coin flip. Judge every
> call against what actually happened, using the session tape. Never trade
> on this alone.

## How it works

1. Open your TradingView chart (1-minute is the intended timeframe).
2. Open this app in desktop Chrome/Edge, type the symbol (default `TSLA`),
   pick a sample interval (10–60s, default 20s).
3. Tap **Start watch** and share the TradingView tab/window in the browser
   share picker.
4. The app shows a live preview of your shared screen, samples one frame
   every interval, and puts the call + score + the candle evidence it used
   in the side rail. Every read is listed in the session tape (time, call,
   score) so calls can be judged afterwards.
5. Frames that don't show a readable chart are rejected with an error
   instead of being scored. Only the reads are kept (in memory, per
   session) — the video is never stored.

## Scoring

`POST /api/score` accepts `{image: "data:image/...", symbol: "TSLA"}` and
returns `{call, score, evidence, source, model, at}`.

- **Vision mode (recommended):** set `OPENAI_API_KEY` and the frame goes to
  a vision model (`gpt-4o-mini` by default, override with `VISION_MODEL`)
  with a 3-class prompt. Responses are labelled `source: "vision"`.
- **Heuristic fallback:** with no key set, the server decodes the PNG
  pixels locally and scores simple green/red candle structure (recent half
  vs earlier half of the frame). It is crude by design and every response
  is labelled `source: "heuristic-fallback"`. It never pretends to be a
  model read. The frontend sends PNG frames in this mode.

## Run it locally

```bash
npm install
npm start
# open http://127.0.0.1:3000
```

With a vision key:

```bash
cp .env.example .env   # put your key in .env (never commit it)
# or: OPENAI_API_KEY=sk-... npm start
```

`GET /api/health` reports which scoring mode is active.

## TradingView indicator (no dashboard needed)

If you don't want the separate app at all, use the rules-based version
directly on the chart: `pine/live_chart_watch_indicator.pine` is a Pine
Script v6 indicator, **"Live Chart Watch [3-Class]"**. It shows the same
UP / DOWN / SIDEWAYS call + 0–100 score in a small table fixed at the
top-right corner of the chart, coloured green/red/grey — nothing else is
plotted, so it doesn't clutter your layout.

How to add it in TradingView:

1. Open your chart, then **Pine Editor** (bottom panel).
2. Delete the template, paste the whole `.pine` file, click **Add to chart**.
3. It works on any timeframe; 1-minute is what it was designed for.
4. Tune it in the indicator's settings: momentum lookback, ATR length,
   the three weights, and the call threshold (default 0.35).

How it calls: ATR(14)-normalised 10-bar momentum (50%), EMA 3 vs EMA 6
structure (25%), price vs session VWAP (25%), with a 10% boost when the
current bar's volume is ≥1.5× its 20-bar average. Score = 50 + 50 ×
|signal|. All rules are in comments inside the file.

> **Honest limit:** this is rules-based, not the live AI model read. It
> describes what the chart is doing *now*; it does not see anything the
> candles don't already show. Backtested on real TSLA 1-minute bars
> (2026-10-08 → 2026-11-05, 7,606 bars, `pine/rules_backtest.md`): the
> calls hit the realised next-30-minute class **35.9%** of the time —
> barely above a random 3-class guess (33.3%) and the majority-class
> baseline (35.6%). UP fired 2,451 times (35.1% hit), DOWN 2,462 times
> (37.4% hit), SIDEWAYS 2,693 times (35.2% hit). In plain words: the
> rules label the current move, they do not predict the next one. The
> Python mirror of the exact rules is `pine/rules_mirror.py` — rerun it
> with `python3 pine/rules_mirror.py`.

## Project layout

```
server.js           zero-framework Node server (static files + /api/score)
public/index.html   the whole frontend: share picker, preview, side rail, tape
pine/               TradingView indicator (Pine v6) + Python rules mirror + backtest
test/score.test.js  smoke test for /api/score (fallback mode)
```

## Roadmap

- Accuracy-vs-time-since-open replay test: at what minute after 9:30 does
  the read first beat a coin flip? That minute becomes the real "wait".
- Per-symbol calibration, score-threshold alerts, tape export.

## License

MIT.

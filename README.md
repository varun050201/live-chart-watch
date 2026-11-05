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

## Project layout

```
server.js           zero-framework Node server (static files + /api/score)
public/index.html   the whole frontend: share picker, preview, side rail, tape
test/score.test.js  smoke test for /api/score (fallback mode)
```

## Roadmap

- Accuracy-vs-time-since-open replay test: at what minute after 9:30 does
  the read first beat a coin flip? That minute becomes the real "wait".
- Per-symbol calibration, score-threshold alerts, tape export.

## License

MIT.

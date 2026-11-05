// Smoke test: /api/score must respond in fallback mode (no API key).
// Run: npm test   (starts its own server on port 3456, then exits)
const { PNG } = require('pngjs');

const PORT = 3456;
process.env.PORT = String(PORT);
delete process.env.OPENAI_API_KEY;

const server = require('../server.js'); // requiring starts the server (side effect)

async function main() {
  // server.js listens on require, so just wait a beat, then hit it.
  await new Promise((r) => setTimeout(r, 500));

  // Build a small synthetic chart-like PNG: left half mostly red candles,
  // right half mostly green candles (price turning up).
  const png = new PNG({ width: 160, height: 90 });
  for (let y = 0; y < 90; y++) {
    for (let x = 0; x < 160; x++) {
      const i = (y * 160 + x) * 4;
      png.data[i] = 15; png.data[i + 1] = 15; png.data[i + 2] = 20; png.data[i + 3] = 255;
      // red block left, green block right, in the middle band
      if (y > 30 && y < 60) {
        if (x < 80) { png.data[i] = 220; png.data[i + 1] = 60; png.data[i + 2] = 60; }
        else { png.data[i] = 60; png.data[i + 1] = 220; png.data[i + 2] = 80; }
      }
    }
  }
  const buf = PNG.sync.write(png);
  const dataUrl = 'data:image/png;base64,' + buf.toString('base64');

  const res = await fetch(`http://127.0.0.1:${PORT}/api/score`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: dataUrl, symbol: 'TEST' }),
  });
  const json = await res.json();
  console.log('status:', res.status, 'body:', JSON.stringify(json));
  const ok =
    res.status === 200 &&
    ['UP', 'DOWN', 'SIDEWAYS', 'UNREADABLE'].includes(json.call) &&
    typeof json.score === 'number' &&
    json.source === 'heuristic-fallback';
  // Green-dominant recent half should not read DOWN.
  const sane = json.call !== 'DOWN';
  console.log(ok && sane ? 'PASS' : 'FAIL');
  process.exit(ok && sane ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });

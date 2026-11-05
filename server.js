// Live Chart Watch — minimal standalone server.
// Serves the frontend and scores chart frames.
//
// Scoring backends (in order):
//   1. Vision model — if OPENAI_API_KEY is set, the frame is sent to the
//      configured vision model (default gpt-4o-mini, override with
//      VISION_MODEL) for a 3-class read: UP / DOWN / SIDEWAYS next 30 min.
//   2. Heuristic fallback — if no key is present, a small local heuristic
//      reads green/red candle structure out of the PNG pixels. It is crude
//      by design and every response it produces is labelled
//      "heuristic-fallback". It never pretends to be a model read.
//
// No credentials are ever committed. Set OPENAI_API_KEY in the environment
// (or a local .env file — see .env.example). Never put a key in this repo.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const VISION_MODEL = process.env.VISION_MODEL || 'gpt-4o-mini';
const VISION_API_KEY = process.env.OPENAI_API_KEY || '';
const VISION_API_URL =
  process.env.VISION_API_URL || 'https://api.openai.com/v1/chat/completions';

const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const VISION_PROMPT = [
  'You are reading a TradingView stock chart screenshot.',
  'Look only at the candles and indicators visible in the image.',
  'Decide what the stock is most likely to do over the NEXT 30 MINUTES.',
  'Answer with exactly one JSON object, no other text:',
  '{"call":"UP"|"DOWN"|"SIDEWAYS","score":0-100,"evidence":"one short sentence naming the candle evidence you used"}',
  'score is your confidence in the call (0-100).',
  'If the image does not show a readable price chart, answer:',
  '{"call":"UNREADABLE","score":0,"evidence":"no readable chart in frame"}',
].join('\n');

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

// ---------------------------------------------------------------------------
// Heuristic fallback: crude green/red candle-structure read from PNG pixels.
// Deliberately simple — it counts bullish vs bearish coloured pixels in the
// recent (right-hand) part of the frame versus the earlier (left-hand) part.
// It is NOT a model and its responses are always labelled as such.
// ---------------------------------------------------------------------------
function heuristicScore(png) {
  const { width, height, data } = png;
  // Sample a coarse grid so big frames stay cheap.
  const stepX = Math.max(1, Math.floor(width / 160));
  const stepY = Math.max(1, Math.floor(height / 90));
  let leftBull = 0, leftBear = 0, rightBull = 0, rightBear = 0, coloured = 0;
  for (let y = 0; y < height; y += stepY) {
    for (let x = 0; x < width; x += stepX) {
      const i = (y * width + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const isBull = g > r + 25 && g > b + 25;
      const isBear = r > g + 25 && r > b + 25;
      if (!isBull && !isBear) continue;
      coloured++;
      if (x < width / 2) {
        if (isBull) leftBull++; else leftBear++;
      } else {
        if (isBull) rightBull++; else rightBear++;
      }
    }
  }
  if (coloured < 20) {
    return { call: 'UNREADABLE', score: 0, evidence: 'no readable chart in frame' };
  }
  const recent = rightBull - rightBear;
  const earlier = leftBull - leftBear;
  const momentum = recent - earlier; // positive = candles turning greener
  const total = rightBull + rightBear + 1;
  const bullShare = rightBull / total;
  // Map momentum to a 0-100 score centred on 50.
  const raw = 50 + momentum * 2 + (bullShare - 0.5) * 40;
  const score = Math.max(5, Math.min(95, Math.round(raw)));
  let call = 'SIDEWAYS';
  if (score >= 60) call = 'UP';
  else if (score <= 40) call = 'DOWN';
  return {
    call,
    score,
    evidence:
      `heuristic pixel read: ${rightBull} green vs ${rightBear} red candle pixels ` +
      `in the recent half of the frame (earlier half ${leftBull} green vs ${leftBear} red)`,
  };
}

async function visionScore(dataUrl) {
  const resp = await fetch(VISION_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${VISION_API_KEY}`,
    },
    body: JSON.stringify({
      model: VISION_MODEL,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: VISION_PROMPT },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
      max_tokens: 200,
      temperature: 0,
    }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`vision API ${resp.status}: ${text.slice(0, 200)}`);
  }
  const json = await resp.json();
  const content = json.choices && json.choices[0] && json.choices[0].message
    ? json.choices[0].message.content
    : '';
  const match = String(content).match(/\{[\s\S]*\}/);
  if (!match) throw new Error('vision API returned no JSON object');
  const parsed = JSON.parse(match[0]);
  const call = ['UP', 'DOWN', 'SIDEWAYS', 'UNREADABLE'].includes(parsed.call)
    ? parsed.call
    : 'UNREADABLE';
  const score = Math.max(0, Math.min(100, Number(parsed.score) || 0));
  return {
    call,
    score,
    evidence: String(parsed.evidence || '').slice(0, 300),
  };
}

async function handleScore(req, res) {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > 8 * 1024 * 1024) req.destroy(); // 8 MB cap
  });
  req.on('end', async () => {
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      return sendJson(res, 400, { error: 'invalid JSON body' });
    }
    const image = payload && payload.image;
    if (typeof image !== 'string' || !image.startsWith('data:image/')) {
      return sendJson(res, 400, { error: 'expected {image: "data:image/..."}' });
    }
    try {
      if (VISION_API_KEY) {
        const result = await visionScore(image);
        return sendJson(res, 200, {
          ...result,
          source: 'vision',
          model: VISION_MODEL,
          symbol: payload.symbol || null,
          at: new Date().toISOString(),
        });
      }
      // Fallback: decode PNG pixels locally. JPEG frames are rejected here
      // (the frontend sends PNG when no key is configured).
      const base64 = image.split(',')[1];
      const buf = Buffer.from(base64, 'base64');
      let png;
      try {
        png = PNG.sync.read(buf);
      } catch {
        return sendJson(res, 400, {
          error: 'heuristic fallback needs a PNG frame; set OPENAI_API_KEY for JPEG/vision scoring',
        });
      }
      const result = heuristicScore(png);
      return sendJson(res, 200, {
        ...result,
        source: 'heuristic-fallback',
        model: null,
        symbol: payload.symbol || null,
        at: new Date().toISOString(),
      });
    } catch (err) {
      return sendJson(res, 502, { error: `scoring failed: ${err.message}` });
    }
  });
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); return res.end('forbidden');
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('not found');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url.split('?')[0] === '/api/score') {
    return handleScore(req, res);
  }
  if (req.method === 'GET' && req.url.split('?')[0] === '/api/health') {
    return sendJson(res, 200, {
      ok: true,
      scoring: VISION_API_KEY ? 'vision' : 'heuristic-fallback',
      model: VISION_API_KEY ? VISION_MODEL : null,
    });
  }
  if (req.method === 'GET') return serveStatic(req, res);
  res.writeHead(405); res.end('method not allowed');
});

server.listen(PORT, HOST, () => {
  console.log(`live-chart-watch on http://${HOST}:${PORT}`);
  console.log(`scoring: ${VISION_API_KEY ? `vision (${VISION_MODEL})` : 'heuristic-fallback (set OPENAI_API_KEY for vision scoring)'}`);
});

import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

const WORKSPACE_ROOT = __dirname;

const TONBAK_OCR_PROMPT = `You are an expert Optical Music Recognition (OMR) system specializing in Iranian Tonbak (تنبک) standard notation (specifically Bahman Rajabi / Hossein Tehrani single-line percussion notation).

Analyze the uploaded sheet music photo and transcribe EVERY measure on the page from top-left to bottom-right into valid JSON.

Notation guide for this book:
- Single-line percussion staff with percussion clef ||.
- Time signature at top-left (e.g. 6/8, 2/4, 4/4, 3/4) and optional tempo marking (e.g. dotted-quarter = 96, or quarter = 66).
- Stroke symbols ABOVE each notehead:
  - "tom": Persian question mark ؟ (center bass stroke, تُم)
  - "bak_r": caret ^ without arc (right-hand rim stroke, بک راست)
  - "bak_l": inverted caret v with dot above v̇ (left-hand rim stroke, بک چپ). Often has finger "2", "3", "4", or "=" above the dot.
  - "pelang_r": caret ^ with curved arc above it (right snap/flick, پلنگ راست)
  - "pelang_l": inverted caret v with curved arc above it (left snap/flick, پلنگ چپ)
  - "chap": caret ^ with horizontal bar/macron above it (accented/muted rim)
  - "riz": ^v together (often with arc, +, or - above) AND tremolo slashes on the stem (roll, ریز)
  - "eshareh": small ornament stroke / 5-finger grace stroke
  - "rest": rhythmic rest (quarter rest, eighth rest, sixteenth rest, etc.)
- Grace notes: small beamed notes slurred before a main note (commonly a pair of pelang_r + pelang_l grace notes, or a single eshareh/tom grace note before a riz). Put these in "graceNotes": [{"stroke": "pelang_r"}, {"stroke": "pelang_l"}] on the main note they lead into.
- Measure repeat sign: % inside a measure means repeat the previous measure -> set "isRepeatPrevious": true and "notes": [].
- Durations: "whole", "half", "quarter", "eighth" (1 flag/beam), "sixteenth" (2 beams), "thirtysecond" (3 beams). Include "dotted": true if there is an augmentation dot after the notehead.
- Tremolo/Riz: set "tremolo": true when the stem has diagonal tremolo slashes. Set "glissando": true if followed by a wavy glissando line.

Return ONLY raw JSON (no markdown fences, no commentary) matching this exact structure:
{
  "title": "string (e.g. Page title or number from top box)",
  "subtitle": "string (optional book/level name)",
  "timeSignature": { "numerator": 6, "denominator": 8 },
  "tempo": 96,
  "tempoBeat": "dotted-quarter" | "quarter",
  "measures": [
    {
      "isRepeatPrevious": false,
      "notes": [
        {
          "stroke": "tom" | "bak_r" | "bak_l" | "pelang_r" | "pelang_l" | "chap" | "riz" | "eshareh" | "rest",
          "duration": "whole" | "half" | "quarter" | "eighth" | "sixteenth" | "thirtysecond",
          "dotted": false,
          "finger": "2",
          "tremolo": false,
          "glissando": false,
          "graceNotes": [{ "stroke": "pelang_r" }, { "stroke": "pelang_l" }]
        }
      ]
    }
  ]
}`;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, data: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}

function zarbSazApiPlugin(): Plugin {
  return {
    name: 'zarbsaz-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url || '/', 'http://localhost');

        // List book photos in workspace root
        if (req.method === 'GET' && url.pathname === '/api/book-photos') {
          try {
            const entries = fs.readdirSync(WORKSPACE_ROOT);
            const photos = entries
              .filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
              .sort()
              .map((filename) => {
                const stat = fs.statSync(path.join(WORKSPACE_ROOT, filename));
                return {
                  filename,
                  url: `/api/book-photos/${encodeURIComponent(filename)}`,
                  sizeBytes: stat.size,
                };
              });
            return sendJson(res, 200, { photos });
          } catch (err) {
            return sendJson(res, 500, { error: String(err) });
          }
        }

        // Serve a specific book photo safely
        if (req.method === 'GET' && url.pathname.startsWith('/api/book-photos/')) {
          const rawName = decodeURIComponent(url.pathname.slice('/api/book-photos/'.length));
          const safeName = path.basename(rawName);
          const fullPath = path.join(WORKSPACE_ROOT, safeName);
          if (!/\.(jpe?g|png|webp)$/i.test(safeName) || !fs.existsSync(fullPath)) {
            res.statusCode = 404;
            res.end('Not found');
            return;
          }
          const ext = path.extname(safeName).toLowerCase();
          res.setHeader(
            'Content-Type',
            ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
          );
          res.setHeader('Cache-Control', 'public, max-age=3600');
          fs.createReadStream(fullPath).pipe(res);
          return;
        }

        // Report OCR provider availability
        if (req.method === 'GET' && url.pathname === '/api/ocr-status') {
          return sendJson(res, 200, {
            hasOpenRouterKey: Boolean(process.env.OPENROUTER_API_KEY),
            hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
            hasOpenAIKey: Boolean(process.env.OPENAI_API_KEY),
          });
        }

        // Vision OCR endpoint
        if (req.method === 'POST' && url.pathname === '/api/ocr') {
          try {
            const bodyStr = await readBody(req);
            const body = JSON.parse(bodyStr) as {
              imageDataUrl?: string;
              provider?: 'openrouter' | 'gemini' | 'openai';
              apiKey?: string;
              model?: string;
            };

            if (!body.imageDataUrl || !body.imageDataUrl.startsWith('data:image/')) {
              return sendJson(res, 400, { error: 'Missing valid imageDataUrl' });
            }

            const provider =
              body.provider ||
              (process.env.OPENROUTER_API_KEY
                ? 'openrouter'
                : process.env.GEMINI_API_KEY
                  ? 'gemini'
                  : 'openai');

            const apiKey =
              body.apiKey?.trim() ||
              (provider === 'openrouter'
                ? process.env.OPENROUTER_API_KEY
                : provider === 'gemini'
                  ? process.env.GEMINI_API_KEY
                  : process.env.OPENAI_API_KEY);

            if (!apiKey) {
              return sendJson(res, 400, {
                error:
                  'No Vision API key configured. Provide an API key in OCR Settings or use Local Offline OMR.',
              });
            }

            let contentText = '';
            let usedModel = body.model || '';

            if (provider === 'openrouter') {
              usedModel = body.model || 'google/gemini-2.5-flash';
              const upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${apiKey}`,
                  'HTTP-Referer': 'http://localhost:5173',
                  'X-Title': 'ZarbSaz Tonbak Notation',
                },
                body: JSON.stringify({
                  model: usedModel,
                  temperature: 0.1,
                  messages: [
                    {
                      role: 'user',
                      content: [
                        { type: 'text', text: TONBAK_OCR_PROMPT },
                        { type: 'image_url', image_url: { url: body.imageDataUrl } },
                      ],
                    },
                  ],
                }),
              });

              const data = (await upstream.json()) as {
                choices?: Array<{ message?: { content?: string } }>;
                error?: { message?: string };
              };
              if (!upstream.ok) {
                return sendJson(res, upstream.status, {
                  error: data.error?.message || `OpenRouter error (${upstream.status})`,
                });
              }
              contentText = data.choices?.[0]?.message?.content || '';
            } else if (provider === 'gemini') {
              usedModel = body.model || 'gemini-2.5-flash';
              const match = body.imageDataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
              if (!match) {
                return sendJson(res, 400, { error: 'Invalid base64 image data URL' });
              }
              const [, mimeType, base64Data] = match;
              const upstream = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(usedModel)}:generateContent?key=${encodeURIComponent(apiKey)}`,
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    contents: [
                      {
                        parts: [
                          { text: TONBAK_OCR_PROMPT },
                          { inline_data: { mime_type: mimeType, data: base64Data } },
                        ],
                      },
                    ],
                    generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
                  }),
                }
              );
              const data = (await upstream.json()) as {
                candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
                error?: { message?: string };
              };
              if (!upstream.ok) {
                return sendJson(res, upstream.status, {
                  error: data.error?.message || `Gemini error (${upstream.status})`,
                });
              }
              contentText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
            } else {
              usedModel = body.model || 'gpt-4o-mini';
              const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                  model: usedModel,
                  temperature: 0.1,
                  messages: [
                    {
                      role: 'user',
                      content: [
                        { type: 'text', text: TONBAK_OCR_PROMPT },
                        { type: 'image_url', image_url: { url: body.imageDataUrl } },
                      ],
                    },
                  ],
                }),
              });
              const data = (await upstream.json()) as {
                choices?: Array<{ message?: { content?: string } }>;
                error?: { message?: string };
              };
              if (!upstream.ok) {
                return sendJson(res, upstream.status, {
                  error: data.error?.message || `OpenAI error (${upstream.status})`,
                });
              }
              contentText = data.choices?.[0]?.message?.content || '';
            }

            // Strip markdown code fences if present
            const cleaned = contentText
              .replace(/^```(?:json)?\s*/i, '')
              .replace(/\s*```\s*$/i, '')
              .trim();
            const firstBrace = cleaned.indexOf('{');
            const lastBrace = cleaned.lastIndexOf('}');
            if (firstBrace === -1 || lastBrace === -1) {
              return sendJson(res, 502, {
                error: 'Vision model did not return valid JSON',
                raw: contentText.slice(0, 500),
              });
            }
            const parsed = JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
            return sendJson(res, 200, {
              parsed,
              provider,
              model: usedModel,
            });
          } catch (err) {
            return sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
          }
        }

        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), zarbSazApiPlugin()],
  build: {
    target: 'esnext',
  },
});

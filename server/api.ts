import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ZarbSazStore } from './db';

const SESSION_COOKIE = 'zarbsaz_session';

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

function parseCookies(req: IncomingMessage): Record<string, string> {
  const header = req.headers.cookie || '';
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function setSessionCookie(res: ServerResponse, token: string | null) {
  if (token) {
    res.setHeader(
      'Set-Cookie',
      `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`
    );
  } else {
    res.setHeader(
      'Set-Cookie',
      `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
    );
  }
}

export function createApiMiddleware(workspaceRoot: string, store: ZarbSazStore) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const pathname = url.pathname;
    if (!pathname.startsWith('/api/')) return next();

    const cookies = parseCookies(req);
    const currentUser = store.getUserBySession(cookies[SESSION_COOKIE]);

    try {
      // --- Auth ---
      if (req.method === 'GET' && pathname === '/api/auth/me') {
        return sendJson(res, 200, { user: currentUser });
      }

      if (req.method === 'POST' && pathname === '/api/auth/register') {
        const body = JSON.parse(await readBody(req)) as {
          username?: string;
          email?: string;
          password?: string;
          seedPages?: Array<{
            title: string;
            subtitle?: string;
            timeSignature?: { numerator: number; denominator: number };
            tempo?: number;
            tempoBeat?: 'quarter' | 'dotted-quarter';
            measures?: unknown[];
            sourceImage?: string;
            isStandalone?: boolean;
          }>;
        };
        const user = store.registerUser(body.username || '', body.email || '', body.password || '');

        // Seed starter book + standalone piece if provided
        if (Array.isArray(body.seedPages) && body.seedPages.length > 0) {
          const bookPages = body.seedPages.filter((p) => !p.isStandalone);
          const standalones = body.seedPages.filter((p) => p.isStandalone);
          if (bookPages.length > 0) {
            const starterBook = store.createBook(user.id, {
              title: 'آموزش تنبک — Bahman Rajabi',
              author: 'Bahman Rajabi',
              description: 'Starter sample pages from the book',
              coverColor: '#9c3b1e',
            });
            bookPages.forEach((p, idx) => {
              store.createPiece(user.id, {
                bookId: starterBook.id,
                sortOrder: idx,
                title: p.title,
                subtitle: p.subtitle,
                timeSignature: p.timeSignature,
                tempo: p.tempo,
                tempoBeat: p.tempoBeat,
                measures: p.measures,
                sourceImage: p.sourceImage,
              });
            });
          }
          standalones.forEach((p) => {
            store.createPiece(user.id, {
              bookId: null,
              title: p.title,
              subtitle: p.subtitle,
              timeSignature: p.timeSignature,
              tempo: p.tempo,
              tempoBeat: p.tempoBeat,
              measures: p.measures,
              sourceImage: p.sourceImage,
            });
          });
        }

        const token = store.createSession(user.id);
        setSessionCookie(res, token);
        return sendJson(res, 201, { user });
      }

      if (req.method === 'POST' && pathname === '/api/auth/login') {
        const body = JSON.parse(await readBody(req)) as { identifier?: string; password?: string };
        const user = store.authenticateUser(body.identifier || '', body.password || '');
        if (!user) return sendJson(res, 401, { error: 'Invalid username/email or password' });
        const token = store.createSession(user.id);
        setSessionCookie(res, token);
        return sendJson(res, 200, { user });
      }

      if (req.method === 'POST' && pathname === '/api/auth/logout') {
        if (cookies[SESSION_COOKIE]) store.deleteSession(cookies[SESSION_COOKIE]);
        setSessionCookie(res, null);
        return sendJson(res, 200, { ok: true });
      }

      // --- Library ---
      if (req.method === 'GET' && pathname === '/api/library') {
        if (!currentUser) return sendJson(res, 401, { error: 'Not signed in' });
        return sendJson(res, 200, store.getUserLibrary(currentUser.id));
      }

      // --- Books CRUD ---
      if (req.method === 'POST' && pathname === '/api/books') {
        if (!currentUser) return sendJson(res, 401, { error: 'Not signed in' });
        const body = JSON.parse(await readBody(req)) as {
          title?: string;
          author?: string;
          description?: string;
          coverColor?: string;
        };
        const book = store.createBook(currentUser.id, {
          title: body.title || 'New Book',
          author: body.author,
          description: body.description,
          coverColor: body.coverColor,
        });
        return sendJson(res, 201, { book });
      }

      const bookMatch = pathname.match(/^\/api\/books\/([^/]+)$/);
      if (bookMatch) {
        if (!currentUser) return sendJson(res, 401, { error: 'Not signed in' });
        const bookId = decodeURIComponent(bookMatch[1]);
        if (req.method === 'PATCH') {
          const patch = JSON.parse(await readBody(req));
          const updated = store.updateBook(currentUser.id, bookId, patch);
          if (!updated) return sendJson(res, 404, { error: 'Book not found' });
          return sendJson(res, 200, { book: updated });
        }
        if (req.method === 'DELETE') {
          const ok = store.deleteBook(currentUser.id, bookId);
          return sendJson(res, ok ? 200 : 404, { ok });
        }
      }

      // --- Pieces CRUD ---
      if (req.method === 'POST' && pathname === '/api/pieces') {
        if (!currentUser) return sendJson(res, 401, { error: 'Not signed in' });
        const body = JSON.parse(await readBody(req));
        if (Array.isArray(body.pieces)) {
          const created = body.pieces.map((item: Record<string, unknown>) =>
            store.createPiece(currentUser.id, item as Parameters<ZarbSazStore['createPiece']>[1])
          );
          return sendJson(res, 201, { pieces: created });
        }
        const piece = store.createPiece(currentUser.id, body);
        return sendJson(res, 201, { piece });
      }

      const pieceMatch = pathname.match(/^\/api\/pieces\/([^/]+)$/);
      if (pieceMatch) {
        if (!currentUser) return sendJson(res, 401, { error: 'Not signed in' });
        const pieceId = decodeURIComponent(pieceMatch[1]);
        if (req.method === 'PATCH') {
          const patch = JSON.parse(await readBody(req));
          const updated = store.updatePiece(currentUser.id, pieceId, patch);
          if (!updated) return sendJson(res, 404, { error: 'Piece not found' });
          return sendJson(res, 200, { piece: updated });
        }
        if (req.method === 'DELETE') {
          const ok = store.deletePiece(currentUser.id, pieceId);
          return sendJson(res, ok ? 200 : 404, { ok });
        }
      }

      // --- Snippets ---
      if (req.method === 'POST' && pathname === '/api/snippets') {
        if (!currentUser) return sendJson(res, 401, { error: 'Not signed in' });
        const body = JSON.parse(await readBody(req));
        const snippet = store.createSnippet(currentUser.id, body);
        return sendJson(res, 201, { snippet });
      }

      const snippetMatch = pathname.match(/^\/api\/snippets\/([^/]+)$/);
      if (snippetMatch && req.method === 'DELETE') {
        if (!currentUser) return sendJson(res, 401, { error: 'Not signed in' });
        const ok = store.deleteSnippet(currentUser.id, decodeURIComponent(snippetMatch[1]));
        return sendJson(res, ok ? 200 : 404, { ok });
      }

      // --- Sharing ---
      const shareManageMatch = pathname.match(/^\/api\/share\/(book|piece)\/([^/]+)\/(user|recipients)$/);
      if (shareManageMatch) {
        if (!currentUser) return sendJson(res, 401, { error: 'Not signed in' });
        const type = shareManageMatch[1] as 'book' | 'piece';
        const resourceId = decodeURIComponent(shareManageMatch[2]);
        const action = shareManageMatch[3];

        if (action === 'recipients' && req.method === 'GET') {
          return sendJson(res, 200, {
            recipients: store.listRecipients(currentUser.id, type, resourceId),
          });
        }
        if (action === 'user' && req.method === 'POST') {
          const body = JSON.parse(await readBody(req)) as { identifier?: string };
          const result = store.shareWithUser(
            currentUser.id,
            type,
            resourceId,
            body.identifier || ''
          );
          return sendJson(res, 200, result);
        }
      }

      const shareCloneMatch = pathname.match(/^\/api\/share\/(book|piece)\/([^/]+)\/clone$/);
      if (shareCloneMatch && req.method === 'POST') {
        if (!currentUser) return sendJson(res, 401, { error: 'Sign in to copy into your library' });
        const type = shareCloneMatch[1] as 'book' | 'piece';
        const token = decodeURIComponent(shareCloneMatch[2]);
        const cloned = store.clonePublicResource(currentUser.id, type, token);
        if (!cloned) return sendJson(res, 404, { error: 'Shared item not found' });
        return sendJson(res, 201, cloned);
      }

      const sharePublicMatch = pathname.match(/^\/api\/share\/(book|piece)\/([^/]+)$/);
      if (sharePublicMatch && req.method === 'GET') {
        const type = sharePublicMatch[1] as 'book' | 'piece';
        const token = decodeURIComponent(sharePublicMatch[2]);
        if (type === 'book') {
          const data = store.getPublicBookByToken(token);
          if (!data) return sendJson(res, 404, { error: 'Shared book not found or link disabled' });
          return sendJson(res, 200, { type: 'book', ...data });
        } else {
          const piece = store.getPublicPieceByToken(token);
          if (!piece) return sendJson(res, 404, { error: 'Shared piece not found or link disabled' });
          return sendJson(res, 200, { type: 'piece', piece });
        }
      }

      // --- Local Workspace Book Photos ---
      if (req.method === 'GET' && pathname === '/api/book-photos') {
        const entries = fs.readdirSync(workspaceRoot);
        const photos = entries
          .filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
          .sort()
          .map((filename) => {
            const stat = fs.statSync(path.join(workspaceRoot, filename));
            return {
              filename,
              url: `/api/book-photos/${encodeURIComponent(filename)}`,
              sizeBytes: stat.size,
            };
          });
        return sendJson(res, 200, { photos });
      }

      if (req.method === 'GET' && pathname.startsWith('/api/book-photos/')) {
        const rawName = decodeURIComponent(pathname.slice('/api/book-photos/'.length));
        const safeName = path.basename(rawName);
        const fullPath = path.join(workspaceRoot, safeName);
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

      // --- OCR Status & Vision OCR ---
      if (req.method === 'GET' && pathname === '/api/ocr-status') {
        return sendJson(res, 200, {
          hasOpenRouterKey: Boolean(process.env.OPENROUTER_API_KEY),
          hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
          hasOpenAIKey: Boolean(process.env.OPENAI_API_KEY),
        });
      }

      if (req.method === 'POST' && pathname === '/api/ocr') {
        const body = JSON.parse(await readBody(req)) as {
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
          if (!match) return sendJson(res, 400, { error: 'Invalid base64 image data URL' });
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
        return sendJson(res, 200, { parsed, provider, model: usedModel });
      }

      return sendJson(res, 404, { error: `Unknown API route: ${pathname}` });
    } catch (err) {
      return sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
  };
}

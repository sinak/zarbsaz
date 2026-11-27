import crypto from 'node:crypto';

export interface Env {
  DB: D1Database;
  OPENROUTER_API_KEY?: string;
  GEMINI_API_KEY?: string;
  OPENAI_API_KEY?: string;
}

const SESSION_COOKIE = 'zarbsaz_session';

const TONBAK_OCR_PROMPT = `You are an expert Optical Music Recognition (OMR) system specializing in Iranian Tonbak (تنبک) standard notation (specifically Bahman Rajabi / Hossein Tehrani single-line percussion notation).

Analyze the uploaded sheet music photo and transcribe EVERY measure on the page from top-left to bottom-right into valid JSON.

Notation guide for this book:
- Single-line percussion staff with percussion clef ||.
- Time signature at top-left (e.g. 6/8, 2/4, 4/4, 3/4, 6/4) and optional tempo marking.
- Stroke symbols ABOVE each notehead:
  - "tom": dotless curved hook (تُم — center bass stroke)
  - "bak_r": caret ^ (right-hand Bak; placement "center" for ^+, "edge" for ^̄)
  - "bak_l": plain inverted caret v with NO dot (left-hand Bak; finger "=" for 2-finger center Bak)
  - "pelang": inverted caret v WITH dot above v̇ (left-hand finger click; finger "1"=pinky, "2", "3", "=")
  - "bak_pelang": dotted × (×̇ — simultaneous Bak R + Pelang L)
  - "pelang_r": caret ^ with curved arc above (right-hand 4-finger cascade)
  - "pelang_l": inverted caret v with curved arc above (left-hand 4-finger cascade)
  - "chap": caret ^ with horizontal bar above (^̄ — right-hand edge Bak)
  - "riz": ^v with tremolo slashes (rizStyle "edge" for plain ^v, "pelang" for ^v̇, "full" for curved-arc ◠^v)
  - "eshareh": S-shaped soft Tom grace note before a Riz
  - "rest": rhythmic rest
- Grace notes: put preceding small beamed/slurred notes in "graceNotes" on the main note.
- Measure repeat sign: % -> "isRepeatPrevious": true, "repeatBars": 1 (or 2 if vertical barline runs through %).
- Durations: "whole", "half", "quarter", "eighth", "sixteenth", "thirtysecond".

Return ONLY raw JSON (no markdown fences) with keys: title, subtitle, timeSignature, tempo, tempoBeat, barsPerLine, measures.`;

function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

function genToken(): string {
  return crypto.randomBytes(16).toString('base64url');
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, keyHex] = stored.split(':');
  if (!salt || !keyHex) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(keyHex, 'hex');
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.get('cookie') || '';
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

function makeCookieHeader(req: Request, token: string | null): string {
  const isHttps = new URL(req.url).protocol === 'https:';
  const secure = isHttps ? '; Secure' : '';
  if (token) {
    return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=${60 * 60 * 24 * 30}`;
  }
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=0`;
}

function json(data: unknown, status = 200, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
  });
}

function rowToBook(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    ownerId: String(row.owner_id),
    ownerUsername: row.owner_username ? String(row.owner_username) : undefined,
    title: String(row.title),
    author: String(row.author || ''),
    description: String(row.description || ''),
    coverColor: String(row.cover_color || '#9c3b1e'),
    shareToken: String(row.share_token),
    isPublic: Boolean(row.is_public),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function rowToPiece(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    ownerId: String(row.owner_id),
    ownerUsername: row.owner_username ? String(row.owner_username) : undefined,
    bookId: row.book_id ? String(row.book_id) : null,
    sortOrder: Number(row.sort_order || 0),
    title: String(row.title),
    subtitle: row.subtitle ? String(row.subtitle) : undefined,
    timeSignature: {
      numerator: Number(row.time_sig_num || 6),
      denominator: Number(row.time_sig_den || 8),
    },
    tempo: Number(row.tempo || 96),
    tempoBeat: row.tempo_beat === 'quarter' ? 'quarter' : 'dotted-quarter',
    measures: JSON.parse(String(row.measures_json || '[]')),
    barsPerLine: row.bars_per_line_json ? JSON.parse(String(row.bars_per_line_json)) : undefined,
    sourceImage: row.source_image ? String(row.source_image) : undefined,
    shareToken: String(row.share_token),
    isPublic: Boolean(row.is_public),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

async function getCurrentUser(db: D1Database, req: Request) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  const row = await db
    .prepare(
      `SELECT u.id, u.username, u.email, u.created_at
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > ?`
    )
    .bind(token, Date.now())
    .first<Record<string, unknown>>();
  if (!row) return null;
  return {
    id: String(row.id),
    username: String(row.username),
    email: String(row.email),
    createdAt: Number(row.created_at),
  };
}

async function createBook(
  db: D1Database,
  ownerId: string,
  input: { title?: string; author?: string; description?: string; coverColor?: string }
) {
  const id = genId('book');
  const now = Date.now();
  const shareToken = genToken();
  await db
    .prepare(
      `INSERT INTO books (id, owner_id, title, author, description, cover_color, share_token, is_public, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
    )
    .bind(
      id,
      ownerId,
      (input.title || 'New Book').trim() || 'Untitled Book',
      (input.author || '').trim(),
      (input.description || '').trim(),
      input.coverColor || '#9c3b1e',
      shareToken,
      now,
      now
    )
    .run();
  const row = await db
    .prepare(`SELECT b.*, u.username AS owner_username FROM books b JOIN users u ON u.id = b.owner_id WHERE b.id = ?`)
    .bind(id)
    .first<Record<string, unknown>>();
  return row ? rowToBook(row) : null;
}

async function createPiece(db: D1Database, ownerId: string, input: Record<string, unknown>) {
  const id = genId('piece');
  const now = Date.now();
  const shareToken = genToken();
  let validBookId: string | null = null;
  if (typeof input.bookId === 'string' && input.bookId) {
    const b = await db
      .prepare('SELECT id FROM books WHERE id = ? AND owner_id = ?')
      .bind(input.bookId, ownerId)
      .first();
    if (b) validBookId = input.bookId;
  }
  const ts = (input.timeSignature || {}) as { numerator?: number; denominator?: number };
  await db
    .prepare(
      `INSERT INTO pieces (
         id, owner_id, book_id, sort_order, title, subtitle,
         time_sig_num, time_sig_den, tempo, tempo_beat,
         measures_json, bars_per_line_json, source_image, share_token, is_public, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
    )
    .bind(
      id,
      ownerId,
      validBookId,
      typeof input.sortOrder === 'number' ? input.sortOrder : 0,
      String(input.title || 'Untitled Piece').trim() || 'Untitled Piece',
      input.subtitle ? String(input.subtitle) : null,
      ts.numerator ?? 6,
      ts.denominator ?? 8,
      typeof input.tempo === 'number' ? input.tempo : 96,
      input.tempoBeat === 'quarter' ? 'quarter' : 'dotted-quarter',
      JSON.stringify(Array.isArray(input.measures) ? input.measures : []),
      Array.isArray(input.barsPerLine) ? JSON.stringify(input.barsPerLine) : null,
      input.sourceImage ? String(input.sourceImage) : null,
      shareToken,
      now,
      now
    )
    .run();

  const row = await db
    .prepare(`SELECT p.*, u.username AS owner_username FROM pieces p JOIN users u ON u.id = p.owner_id WHERE p.id = ?`)
    .bind(id)
    .first<Record<string, unknown>>();
  return row ? rowToPiece(row) : null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;
    if (!pathname.startsWith('/api/')) {
      return new Response('Not found', { status: 404 });
    }

    const db = env.DB;
    const currentUser = await getCurrentUser(db, request);

    try {
      // --- Auth ---
      if (request.method === 'GET' && pathname === '/api/auth/me') {
        return json({ user: currentUser });
      }

      if (request.method === 'POST' && pathname === '/api/auth/register') {
        const body = (await request.json()) as {
          username?: string;
          email?: string;
          password?: string;
          seedPages?: Array<Record<string, unknown>>;
        };
        const cleanUser = (body.username || '').trim();
        const cleanEmail = (body.email || '').trim();
        const password = body.password || '';

        if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(cleanUser)) {
          return json({ error: 'Username must be 3–32 characters (letters, numbers, _, ., -)' }, 400);
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
          return json({ error: 'Please enter a valid email address' }, 400);
        }
        if (password.length < 6) {
          return json({ error: 'Password must be at least 6 characters' }, 400);
        }

        const existing = await db
          .prepare('SELECT id FROM users WHERE username_lower = ? OR email_lower = ?')
          .bind(cleanUser.toLowerCase(), cleanEmail.toLowerCase())
          .first();
        if (existing) {
          return json({ error: 'Username or email is already registered' }, 400);
        }

        const userId = genId('usr');
        const now = Date.now();
        await db
          .prepare(
            `INSERT INTO users (id, username, username_lower, email, email_lower, password_hash, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            userId,
            cleanUser,
            cleanUser.toLowerCase(),
            cleanEmail,
            cleanEmail.toLowerCase(),
            hashPassword(password),
            now
          )
          .run();

        if (Array.isArray(body.seedPages) && body.seedPages.length > 0) {
          const bookPages = body.seedPages.filter((p) => !p.isStandalone);
          const standalones = body.seedPages.filter((p) => p.isStandalone);
          if (bookPages.length > 0) {
            const starterBook = await createBook(db, userId, {
              title: 'آموزش تنبک — Bahman Rajabi',
              author: 'Bahman Rajabi',
              description: 'Starter sample pages from the book',
              coverColor: '#9c3b1e',
            });
            for (let idx = 0; idx < bookPages.length; idx += 1) {
              await createPiece(db, userId, { ...bookPages[idx], bookId: starterBook?.id, sortOrder: idx });
            }
          }
          for (const p of standalones) {
            await createPiece(db, userId, { ...p, bookId: null });
          }
        }

        const token = genToken();
        await db
          .prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
          .bind(token, userId, now, now + 1000 * 60 * 60 * 24 * 30)
          .run();

        return json(
          { user: { id: userId, username: cleanUser, email: cleanEmail, createdAt: now } },
          201,
          { 'Set-Cookie': makeCookieHeader(request, token) }
        );
      }

      if (request.method === 'POST' && pathname === '/api/auth/login') {
        const body = (await request.json()) as { identifier?: string; password?: string };
        const cleanId = (body.identifier || '').trim().toLowerCase();
        const row = await db
          .prepare(
            `SELECT id, username, email, password_hash, created_at
             FROM users WHERE username_lower = ? OR email_lower = ?`
          )
          .bind(cleanId, cleanId)
          .first<Record<string, unknown>>();
        if (!row || !verifyPassword(body.password || '', String(row.password_hash))) {
          return json({ error: 'Invalid username/email or password' }, 401);
        }
        const token = genToken();
        const now = Date.now();
        await db
          .prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
          .bind(token, String(row.id), now, now + 1000 * 60 * 60 * 24 * 30)
          .run();
        return json(
          {
            user: {
              id: String(row.id),
              username: String(row.username),
              email: String(row.email),
              createdAt: Number(row.created_at),
            },
          },
          200,
          { 'Set-Cookie': makeCookieHeader(request, token) }
        );
      }

      if (request.method === 'POST' && pathname === '/api/auth/logout') {
        const token = parseCookies(request)[SESSION_COOKIE];
        if (token) {
          await db.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
        }
        return json({ ok: true }, 200, { 'Set-Cookie': makeCookieHeader(request, null) });
      }

      // --- Library ---
      if (request.method === 'GET' && pathname === '/api/library') {
        if (!currentUser) return json({ error: 'Not signed in' }, 401);
        const booksRes = await db
          .prepare(
            `SELECT b.*, u.username AS owner_username FROM books b
             JOIN users u ON u.id = b.owner_id
             WHERE b.owner_id = ? ORDER BY b.updated_at DESC`
          )
          .bind(currentUser.id)
          .all<Record<string, unknown>>();
        const piecesRes = await db
          .prepare(
            `SELECT p.*, u.username AS owner_username FROM pieces p
             JOIN users u ON u.id = p.owner_id
             WHERE p.owner_id = ? ORDER BY p.sort_order ASC, p.created_at ASC`
          )
          .bind(currentUser.id)
          .all<Record<string, unknown>>();
        const snipsRes = await db
          .prepare('SELECT * FROM snippets WHERE owner_id = ? ORDER BY created_at DESC')
          .bind(currentUser.id)
          .all<Record<string, unknown>>();

        const sharedBooksRes = await db
          .prepare(
            `SELECT b.*, u.username AS owner_username
             FROM shares s JOIN books b ON b.id = s.resource_id JOIN users u ON u.id = b.owner_id
             WHERE s.resource_type = 'book' AND s.shared_with_user_id = ? ORDER BY s.created_at DESC`
          )
          .bind(currentUser.id)
          .all<Record<string, unknown>>();

        const sharedBooks = (sharedBooksRes.results || []).map(rowToBook);
        const sharedBookPieces: ReturnType<typeof rowToPiece>[] = [];
        for (const sb of sharedBooks) {
          const pRes = await db
            .prepare(
              `SELECT p.*, u.username AS owner_username FROM pieces p
               JOIN users u ON u.id = p.owner_id
               WHERE p.book_id = ? ORDER BY p.sort_order ASC, p.created_at ASC`
            )
            .bind(sb.id)
            .all<Record<string, unknown>>();
          for (const r of pRes.results || []) sharedBookPieces.push(rowToPiece(r));
        }

        const sharedPiecesRes = await db
          .prepare(
            `SELECT p.*, u.username AS owner_username
             FROM shares s JOIN pieces p ON p.id = s.resource_id JOIN users u ON u.id = p.owner_id
             WHERE s.resource_type = 'piece' AND s.shared_with_user_id = ? ORDER BY s.created_at DESC`
          )
          .bind(currentUser.id)
          .all<Record<string, unknown>>();

        return json({
          books: (booksRes.results || []).map(rowToBook),
          pieces: (piecesRes.results || []).map(rowToPiece),
          snippets: (snipsRes.results || []).map((r) => ({
            id: String(r.id),
            ownerId: String(r.owner_id),
            name: String(r.name),
            timeSignature: { numerator: Number(r.time_sig_num), denominator: Number(r.time_sig_den) },
            measures: JSON.parse(String(r.measures_json || '[]')),
            createdAt: Number(r.created_at),
          })),
          sharedWithMe: {
            books: sharedBooks,
            bookPieces: sharedBookPieces,
            pieces: (sharedPiecesRes.results || []).map(rowToPiece),
          },
        });
      }

      // --- Books CRUD ---
      if (request.method === 'POST' && pathname === '/api/books') {
        if (!currentUser) return json({ error: 'Not signed in' }, 401);
        const body = (await request.json()) as {
          title?: string;
          author?: string;
          description?: string;
          coverColor?: string;
        };
        const book = await createBook(db, currentUser.id, body);
        return json({ book }, 201);
      }

      const bookMatch = pathname.match(/^\/api\/books\/([^/]+)$/);
      if (bookMatch) {
        if (!currentUser) return json({ error: 'Not signed in' }, 401);
        const bookId = decodeURIComponent(bookMatch[1]);
        if (request.method === 'PATCH') {
          const existing = await db
            .prepare('SELECT * FROM books WHERE id = ? AND owner_id = ?')
            .bind(bookId, currentUser.id)
            .first<Record<string, unknown>>();
          if (!existing) return json({ error: 'Book not found' }, 404);
          const patch = (await request.json()) as Record<string, unknown>;
          await db
            .prepare(
              `UPDATE books SET title = ?, author = ?, description = ?, cover_color = ?, is_public = ?, updated_at = ?
               WHERE id = ? AND owner_id = ?`
            )
            .bind(
              patch.title !== undefined ? String(patch.title) : String(existing.title),
              patch.author !== undefined ? String(patch.author) : String(existing.author),
              patch.description !== undefined ? String(patch.description) : String(existing.description),
              patch.coverColor !== undefined ? String(patch.coverColor) : String(existing.cover_color),
              patch.isPublic !== undefined ? (patch.isPublic ? 1 : 0) : Number(existing.is_public),
              Date.now(),
              bookId,
              currentUser.id
            )
            .run();
          const updated = await db
            .prepare(`SELECT b.*, u.username AS owner_username FROM books b JOIN users u ON u.id = b.owner_id WHERE b.id = ?`)
            .bind(bookId)
            .first<Record<string, unknown>>();
          return json({ book: updated ? rowToBook(updated) : null });
        }
        if (request.method === 'DELETE') {
          const res = await db
            .prepare('DELETE FROM books WHERE id = ? AND owner_id = ?')
            .bind(bookId, currentUser.id)
            .run();
          return json({ ok: (res.meta.changes || 0) > 0 }, (res.meta.changes || 0) > 0 ? 200 : 404);
        }
      }

      // --- Pieces CRUD ---
      if (request.method === 'POST' && pathname === '/api/pieces') {
        if (!currentUser) return json({ error: 'Not signed in' }, 401);
        const body = (await request.json()) as Record<string, unknown>;
        if (Array.isArray(body.pieces)) {
          const created = [];
          for (const item of body.pieces) {
            created.push(await createPiece(db, currentUser.id, item as Record<string, unknown>));
          }
          return json({ pieces: created }, 201);
        }
        const piece = await createPiece(db, currentUser.id, body);
        return json({ piece }, 201);
      }

      const pieceMatch = pathname.match(/^\/api\/pieces\/([^/]+)$/);
      if (pieceMatch) {
        if (!currentUser) return json({ error: 'Not signed in' }, 401);
        const pieceId = decodeURIComponent(pieceMatch[1]);
        if (request.method === 'PATCH') {
          const existing = await db
            .prepare('SELECT * FROM pieces WHERE id = ? AND owner_id = ?')
            .bind(pieceId, currentUser.id)
            .first<Record<string, unknown>>();
          if (!existing) return json({ error: 'Piece not found' }, 404);
          const patch = (await request.json()) as Record<string, unknown>;
          const ts = (patch.timeSignature || {}) as { numerator?: number; denominator?: number };
          const nextBarsPerLineJson =
            patch.barsPerLine !== undefined
              ? patch.barsPerLine
                ? JSON.stringify(patch.barsPerLine)
                : null
              : existing.bars_per_line_json ?? null;
          await db
            .prepare(
              `UPDATE pieces SET
                book_id = ?, sort_order = ?, title = ?, subtitle = ?,
                time_sig_num = ?, time_sig_den = ?, tempo = ?, tempo_beat = ?,
                measures_json = ?, bars_per_line_json = ?, source_image = ?, is_public = ?, updated_at = ?
               WHERE id = ? AND owner_id = ?`
            )
            .bind(
              patch.bookId !== undefined ? (patch.bookId ? String(patch.bookId) : null) : existing.book_id,
              patch.sortOrder !== undefined ? Number(patch.sortOrder) : Number(existing.sort_order),
              patch.title !== undefined ? String(patch.title) : String(existing.title),
              patch.subtitle !== undefined ? (patch.subtitle ? String(patch.subtitle) : null) : existing.subtitle,
              ts.numerator ?? Number(existing.time_sig_num),
              ts.denominator ?? Number(existing.time_sig_den),
              patch.tempo !== undefined ? Number(patch.tempo) : Number(existing.tempo),
              patch.tempoBeat !== undefined ? String(patch.tempoBeat) : String(existing.tempo_beat),
              patch.measures !== undefined ? JSON.stringify(patch.measures) : String(existing.measures_json),
              nextBarsPerLineJson,
              patch.sourceImage !== undefined ? (patch.sourceImage ? String(patch.sourceImage) : null) : existing.source_image,
              patch.isPublic !== undefined ? (patch.isPublic ? 1 : 0) : Number(existing.is_public),
              Date.now(),
              pieceId,
              currentUser.id
            )
            .run();
          const updated = await db
            .prepare(`SELECT p.*, u.username AS owner_username FROM pieces p JOIN users u ON u.id = p.owner_id WHERE p.id = ?`)
            .bind(pieceId)
            .first<Record<string, unknown>>();
          return json({ piece: updated ? rowToPiece(updated) : null });
        }
        if (request.method === 'DELETE') {
          const res = await db
            .prepare('DELETE FROM pieces WHERE id = ? AND owner_id = ?')
            .bind(pieceId, currentUser.id)
            .run();
          return json({ ok: (res.meta.changes || 0) > 0 }, (res.meta.changes || 0) > 0 ? 200 : 404);
        }
      }

      // --- Snippets ---
      if (request.method === 'POST' && pathname === '/api/snippets') {
        if (!currentUser) return json({ error: 'Not signed in' }, 401);
        const body = (await request.json()) as {
          name?: string;
          timeSignature?: { numerator: number; denominator: number };
          measures?: unknown[];
        };
        const id = genId('snip');
        const now = Date.now();
        await db
          .prepare(
            `INSERT INTO snippets (id, owner_id, name, time_sig_num, time_sig_den, measures_json, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            id,
            currentUser.id,
            body.name || 'Saved Phrase',
            body.timeSignature?.numerator ?? 6,
            body.timeSignature?.denominator ?? 8,
            JSON.stringify(body.measures ?? []),
            now
          )
          .run();
        return json(
          {
            snippet: {
              id,
              ownerId: currentUser.id,
              name: body.name || 'Saved Phrase',
              timeSignature: body.timeSignature ?? { numerator: 6, denominator: 8 },
              measures: body.measures ?? [],
              createdAt: now,
            },
          },
          201
        );
      }

      const snippetMatch = pathname.match(/^\/api\/snippets\/([^/]+)$/);
      if (snippetMatch && request.method === 'DELETE') {
        if (!currentUser) return json({ error: 'Not signed in' }, 401);
        const res = await db
          .prepare('DELETE FROM snippets WHERE id = ? AND owner_id = ?')
          .bind(decodeURIComponent(snippetMatch[1]), currentUser.id)
          .run();
        return json({ ok: (res.meta.changes || 0) > 0 }, (res.meta.changes || 0) > 0 ? 200 : 404);
      }

      // --- Sharing ---
      const shareManageMatch = pathname.match(/^\/api\/share\/(book|piece)\/([^/]+)\/(user|recipients)$/);
      if (shareManageMatch) {
        if (!currentUser) return json({ error: 'Not signed in' }, 401);
        const type = shareManageMatch[1] as 'book' | 'piece';
        const resourceId = decodeURIComponent(shareManageMatch[2]);
        const action = shareManageMatch[3];
        if (action === 'recipients' && request.method === 'GET') {
          const rows = await db
            .prepare(
              `SELECT u.id, u.username, u.email, u.created_at
               FROM shares s JOIN users u ON u.id = s.shared_with_user_id
               WHERE s.owner_id = ? AND s.resource_type = ? AND s.resource_id = ?`
            )
            .bind(currentUser.id, type, resourceId)
            .all<Record<string, unknown>>();
          return json({
            recipients: (rows.results || []).map((r) => ({
              id: String(r.id),
              username: String(r.username),
              email: String(r.email),
              createdAt: Number(r.created_at),
            })),
          });
        }
        if (action === 'user' && request.method === 'POST') {
          const body = (await request.json()) as { identifier?: string };
          const ident = (body.identifier || '').trim().toLowerCase();
          const target = await db
            .prepare('SELECT id, username, email, created_at FROM users WHERE username_lower = ? OR email_lower = ?')
            .bind(ident, ident)
            .first<Record<string, unknown>>();
          if (!target) return json({ error: `No ZarbSaz user found for "${body.identifier}"` }, 400);
          if (String(target.id) === currentUser.id) {
            return json({ error: 'You already own this item' }, 400);
          }
          await db
            .prepare(
              `INSERT OR IGNORE INTO shares (id, resource_type, resource_id, owner_id, shared_with_user_id, permission, created_at)
               VALUES (?, ?, ?, ?, ?, 'view', ?)`
            )
            .bind(genId('shr'), type, resourceId, currentUser.id, String(target.id), Date.now())
            .run();
          return json({
            ok: true,
            recipient: {
              id: String(target.id),
              username: String(target.username),
              email: String(target.email),
              createdAt: Number(target.created_at),
            },
          });
        }
      }

      const shareCloneMatch = pathname.match(/^\/api\/share\/(book|piece)\/([^/]+)\/clone$/);
      if (shareCloneMatch && request.method === 'POST') {
        if (!currentUser) return json({ error: 'Sign in to copy into your library' }, 401);
        const type = shareCloneMatch[1] as 'book' | 'piece';
        const token = decodeURIComponent(shareCloneMatch[2]);
        if (type === 'piece') {
          const row = await db
            .prepare('SELECT * FROM pieces WHERE share_token = ? AND is_public = 1')
            .bind(token)
            .first<Record<string, unknown>>();
          if (!row) return json({ error: 'Shared piece not found' }, 404);
          const p = rowToPiece(row);
          const cloned = await createPiece(db, currentUser.id, {
            ...p,
            bookId: null,
            title: `${p.title} (Copy)`,
          });
          return json({ piece: cloned }, 201);
        } else {
          const bRow = await db
            .prepare('SELECT * FROM books WHERE share_token = ? AND is_public = 1')
            .bind(token)
            .first<Record<string, unknown>>();
          if (!bRow) return json({ error: 'Shared book not found' }, 404);
          const b = rowToBook(bRow);
          const newBook = await createBook(db, currentUser.id, {
            title: `${b.title} (Copy)`,
            author: b.author,
            description: b.description,
            coverColor: b.coverColor,
          });
          const pRows = await db
            .prepare('SELECT * FROM pieces WHERE book_id = ? ORDER BY sort_order ASC, created_at ASC')
            .bind(b.id)
            .all<Record<string, unknown>>();
          const clonedPieces = [];
          for (let i = 0; i < (pRows.results || []).length; i += 1) {
            const p = rowToPiece(pRows.results![i]);
            clonedPieces.push(await createPiece(db, currentUser.id, { ...p, bookId: newBook?.id, sortOrder: i }));
          }
          return json({ book: newBook, pieces: clonedPieces }, 201);
        }
      }

      const sharePublicMatch = pathname.match(/^\/api\/share\/(book|piece)\/([^/]+)$/);
      if (sharePublicMatch && request.method === 'GET') {
        const type = sharePublicMatch[1] as 'book' | 'piece';
        const token = decodeURIComponent(sharePublicMatch[2]);
        if (type === 'book') {
          const bRow = await db
            .prepare(
              `SELECT b.*, u.username AS owner_username FROM books b
               JOIN users u ON u.id = b.owner_id
               WHERE b.share_token = ? AND b.is_public = 1`
            )
            .bind(token)
            .first<Record<string, unknown>>();
          if (!bRow) return json({ error: 'Shared book not found or link disabled' }, 404);
          const book = rowToBook(bRow);
          const pRows = await db
            .prepare(
              `SELECT p.*, u.username AS owner_username FROM pieces p
               JOIN users u ON u.id = p.owner_id
               WHERE p.book_id = ? ORDER BY p.sort_order ASC, p.created_at ASC`
            )
            .bind(book.id)
            .all<Record<string, unknown>>();
          return json({ type: 'book', book, pieces: (pRows.results || []).map(rowToPiece) });
        } else {
          const pRow = await db
            .prepare(
              `SELECT p.*, u.username AS owner_username FROM pieces p
               JOIN users u ON u.id = p.owner_id
               WHERE p.share_token = ? AND p.is_public = 1`
            )
            .bind(token)
            .first<Record<string, unknown>>();
          if (!pRow) return json({ error: 'Shared piece not found or link disabled' }, 404);
          return json({ type: 'piece', piece: rowToPiece(pRow) });
        }
      }

      // --- Local-only book photos returns empty list on cloud ---
      if (request.method === 'GET' && pathname === '/api/book-photos') {
        return json({ photos: [] });
      }

      // --- OCR Status & Vision OCR ---
      if (request.method === 'GET' && pathname === '/api/ocr-status') {
        return json({
          hasOpenRouterKey: Boolean(env.OPENROUTER_API_KEY),
          hasGeminiKey: Boolean(env.GEMINI_API_KEY),
          hasOpenAIKey: Boolean(env.OPENAI_API_KEY),
        });
      }

      if (request.method === 'POST' && pathname === '/api/ocr') {
        const body = (await request.json()) as {
          imageDataUrl?: string;
          provider?: 'openrouter' | 'gemini' | 'openai';
          apiKey?: string;
          model?: string;
        };
        if (!body.imageDataUrl || !body.imageDataUrl.startsWith('data:image/')) {
          return json({ error: 'Missing valid imageDataUrl' }, 400);
        }
        const provider =
          body.provider ||
          (env.OPENROUTER_API_KEY ? 'openrouter' : env.GEMINI_API_KEY ? 'gemini' : 'openai');
        const apiKey =
          body.apiKey?.trim() ||
          (provider === 'openrouter'
            ? env.OPENROUTER_API_KEY
            : provider === 'gemini'
              ? env.GEMINI_API_KEY
              : env.OPENAI_API_KEY);
        if (!apiKey) {
          return json(
            { error: 'No Vision API key configured. Provide an API key in OCR Settings or use Local Offline OMR.' },
            400
          );
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
              'HTTP-Referer': 'https://zarbsaz.com',
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
          if (!upstream.ok) return json({ error: data.error?.message || `OpenRouter error (${upstream.status})` }, upstream.status);
          contentText = data.choices?.[0]?.message?.content || '';
        } else if (provider === 'gemini') {
          usedModel = body.model || 'gemini-2.5-flash';
          const match = body.imageDataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
          if (!match) return json({ error: 'Invalid base64 image data URL' }, 400);
          const upstream = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(usedModel)}:generateContent?key=${encodeURIComponent(apiKey)}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ parts: [{ text: TONBAK_OCR_PROMPT }, { inline_data: { mime_type: match[1], data: match[2] } }] }],
                generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
              }),
            }
          );
          const data = (await upstream.json()) as {
            candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
            error?: { message?: string };
          };
          if (!upstream.ok) return json({ error: data.error?.message || `Gemini error (${upstream.status})` }, upstream.status);
          contentText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        } else {
          usedModel = body.model || 'gpt-4o-mini';
          const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
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
          if (!upstream.ok) return json({ error: data.error?.message || `OpenAI error (${upstream.status})` }, upstream.status);
          contentText = data.choices?.[0]?.message?.content || '';
        }

        const cleaned = contentText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
        const firstBrace = cleaned.indexOf('{');
        const lastBrace = cleaned.lastIndexOf('}');
        if (firstBrace === -1 || lastBrace === -1) {
          return json({ error: 'Vision model did not return valid JSON' }, 502);
        }
        return json({ parsed: JSON.parse(cleaned.slice(firstBrace, lastBrace + 1)), provider, model: usedModel });
      }

      return json({ error: `Unknown API route: ${pathname}` }, 404);
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  },
};

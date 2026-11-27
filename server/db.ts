import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

interface SqliteStatement {
  run: (...params: unknown[]) => { changes: number | bigint };
  get: (...params: unknown[]) => unknown;
  all: (...params: unknown[]) => unknown[];
}

interface SqliteDatabase {
  exec: (sql: string) => void;
  prepare: (sql: string) => SqliteStatement;
  close: () => void;
}

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as {
  DatabaseSync: new (path: string) => SqliteDatabase;
};

export interface DbUser {
  id: string;
  username: string;
  email: string;
  createdAt: number;
}

export interface DbBook {
  id: string;
  ownerId: string;
  ownerUsername?: string;
  title: string;
  author: string;
  description: string;
  coverColor: string;
  shareToken: string;
  isPublic: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface DbPiece {
  id: string;
  ownerId: string;
  ownerUsername?: string;
  bookId: string | null;
  sortOrder: number;
  title: string;
  subtitle?: string;
  timeSignature: { numerator: number; denominator: number };
  tempo: number;
  tempoBeat: 'quarter' | 'dotted-quarter';
  measures: unknown[];
  barsPerLine?: number[];
  sourceImage?: string;
  shareToken: string;
  isPublic: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface DbSnippet {
  id: string;
  ownerId: string;
  name: string;
  timeSignature: { numerator: number; denominator: number };
  measures: unknown[];
  createdAt: number;
}

function genId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function genToken(): string {
  return crypto.randomBytes(16).toString('base64url');
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, keyHex] = stored.split(':');
  if (!salt || !keyHex) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const storedBuf = Buffer.from(keyHex, 'hex');
  if (derived.length !== storedBuf.length) return false;
  return crypto.timingSafeEqual(derived, storedBuf);
}

export class ZarbSazStore {
  private db: SqliteDatabase;

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.initSchema();
  }

  private initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS books (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        author TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        cover_color TEXT NOT NULL DEFAULT '#9c3b1e',
        share_token TEXT NOT NULL UNIQUE,
        is_public INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS pieces (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        book_id TEXT REFERENCES books(id) ON DELETE SET NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        title TEXT NOT NULL,
        subtitle TEXT,
        time_sig_num INTEGER NOT NULL DEFAULT 6,
        time_sig_den INTEGER NOT NULL DEFAULT 8,
        tempo INTEGER NOT NULL DEFAULT 96,
        tempo_beat TEXT NOT NULL DEFAULT 'dotted-quarter',
        measures_json TEXT NOT NULL DEFAULT '[]',
        bars_per_line_json TEXT,
        source_image TEXT,
        share_token TEXT NOT NULL UNIQUE,
        is_public INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS shares (
        id TEXT PRIMARY KEY,
        resource_type TEXT NOT NULL CHECK(resource_type IN ('book', 'piece')),
        resource_id TEXT NOT NULL,
        owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        recipient_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        UNIQUE(resource_type, resource_id, recipient_user_id)
      );

      CREATE TABLE IF NOT EXISTS snippets (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        time_sig_num INTEGER NOT NULL DEFAULT 6,
        time_sig_den INTEGER NOT NULL DEFAULT 8,
        measures_json TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL
      );
    `);

    // Safe migration for existing databases created before bars_per_line_json existed
    try {
      this.db.exec('ALTER TABLE pieces ADD COLUMN bars_per_line_json TEXT;');
    } catch {
      // column already exists
    }
  }

  public close() {
    this.db.close();
  }

  // --- Auth ---

  public registerUser(username: string, email: string, password: string): DbUser {
    const cleanUser = username.trim();
    const cleanEmail = email.trim().toLowerCase();
    if (cleanUser.length < 2) throw new Error('Username must be at least 2 characters');
    if (!cleanEmail.includes('@')) throw new Error('Please enter a valid email address');
    if (password.length < 6) throw new Error('Password must be at least 6 characters');

    const id = genId('usr');
    const now = Date.now();
    const hash = hashPassword(password);

    try {
      this.db
        .prepare(
          'INSERT INTO users (id, username, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)'
        )
        .run(id, cleanUser, cleanEmail, hash, now);
    } catch (err) {
      const msg = String(err);
      if (msg.includes('UNIQUE')) {
        throw new Error('An account with that username or email already exists');
      }
      throw err;
    }

    return { id, username: cleanUser, email: cleanEmail, createdAt: now };
  }

  public authenticateUser(identifier: string, password: string): DbUser | null {
    const ident = identifier.trim();
    const row = this.db
      .prepare(
        'SELECT id, username, email, password_hash, created_at FROM users WHERE username = ? OR email = ?'
      )
      .get(ident, ident.toLowerCase()) as
      | { id: string; username: string; email: string; password_hash: string; created_at: number }
      | undefined;

    if (!row || !verifyPassword(password, row.password_hash)) return null;
    return { id: row.id, username: row.username, email: row.email, createdAt: row.created_at };
  }

  public createSession(userId: string): string {
    const token = crypto.randomBytes(24).toString('base64url');
    const expiresAt = Date.now() + 1000 * 60 * 60 * 24 * 30; // 30 days
    this.db
      .prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
      .run(token, userId, expiresAt);
    return token;
  }

  public getUserBySession(token: string | undefined): DbUser | null {
    if (!token) return null;
    const row = this.db
      .prepare(
        `SELECT u.id, u.username, u.email, u.created_at, s.expires_at
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token = ?`
      )
      .get(token) as
      | { id: string; username: string; email: string; created_at: number; expires_at: number }
      | undefined;

    if (!row) return null;
    if (row.expires_at < Date.now()) {
      this.db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
      return null;
    }
    return { id: row.id, username: row.username, email: row.email, createdAt: row.created_at };
  }

  public deleteSession(token: string) {
    this.db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }

  public findUserByIdentifier(identifier: string): DbUser | null {
    const ident = identifier.trim();
    const row = this.db
      .prepare('SELECT id, username, email, created_at FROM users WHERE username = ? OR email = ?')
      .get(ident, ident.toLowerCase()) as
      | { id: string; username: string; email: string; created_at: number }
      | undefined;
    return row
      ? { id: row.id, username: row.username, email: row.email, createdAt: row.created_at }
      : null;
  }

  // --- Books ---

  private mapBook(row: Record<string, unknown>): DbBook {
    return {
      id: String(row.id),
      ownerId: String(row.owner_id),
      ownerUsername: row.owner_username ? String(row.owner_username) : undefined,
      title: String(row.title),
      author: String(row.author ?? ''),
      description: String(row.description ?? ''),
      coverColor: String(row.cover_color ?? '#9c3b1e'),
      shareToken: String(row.share_token),
      isPublic: Boolean(row.is_public),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }

  private mapPiece(row: Record<string, unknown>): DbPiece {
    let measures: unknown[] = [];
    try {
      measures = JSON.parse(String(row.measures_json || '[]'));
    } catch {
      measures = [];
    }
    let barsPerLine: number[] | undefined;
    if (row.bars_per_line_json) {
      try {
        const parsed = JSON.parse(String(row.bars_per_line_json));
        if (Array.isArray(parsed) && parsed.length > 0) barsPerLine = parsed;
      } catch {
        // ignore
      }
    }
    return {
      id: String(row.id),
      ownerId: String(row.owner_id),
      ownerUsername: row.owner_username ? String(row.owner_username) : undefined,
      bookId: row.book_id ? String(row.book_id) : null,
      sortOrder: Number(row.sort_order ?? 0),
      title: String(row.title),
      subtitle: row.subtitle ? String(row.subtitle) : undefined,
      timeSignature: {
        numerator: Number(row.time_sig_num ?? 6),
        denominator: Number(row.time_sig_den ?? 8),
      },
      tempo: Number(row.tempo ?? 96),
      tempoBeat: row.tempo_beat === 'quarter' ? 'quarter' : 'dotted-quarter',
      measures,
      barsPerLine,
      sourceImage: row.source_image ? String(row.source_image) : undefined,
      shareToken: String(row.share_token),
      isPublic: Boolean(row.is_public),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }

  public createBook(
    ownerId: string,
    input: { title: string; author?: string; description?: string; coverColor?: string }
  ): DbBook {
    const id = genId('book');
    const now = Date.now();
    const shareToken = genToken();
    const title = input.title.trim() || 'Untitled Book';
    const author = (input.author || '').trim();
    const description = (input.description || '').trim();
    const coverColor = input.coverColor || '#9c3b1e';

    this.db
      .prepare(
        `INSERT INTO books (id, owner_id, title, author, description, cover_color, share_token, is_public, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
      )
      .run(id, ownerId, title, author, description, coverColor, shareToken, now, now);

    return this.getBookById(id)!;
  }

  public getBookById(id: string): DbBook | null {
    const row = this.db
      .prepare(
        `SELECT b.*, u.username as owner_username
         FROM books b JOIN users u ON u.id = b.owner_id
         WHERE b.id = ?`
      )
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.mapBook(row) : null;
  }

  public updateBook(
    ownerId: string,
    bookId: string,
    patch: Partial<{ title: string; author: string; description: string; coverColor: string; isPublic: boolean }>
  ): DbBook | null {
    const existing = this.getBookById(bookId);
    if (!existing || existing.ownerId !== ownerId) return null;

    const now = Date.now();
    this.db
      .prepare(
        `UPDATE books
         SET title = ?, author = ?, description = ?, cover_color = ?, is_public = ?, updated_at = ?
         WHERE id = ? AND owner_id = ?`
      )
      .run(
        patch.title !== undefined ? patch.title.trim() || existing.title : existing.title,
        patch.author !== undefined ? patch.author : existing.author,
        patch.description !== undefined ? patch.description : existing.description,
        patch.coverColor !== undefined ? patch.coverColor : existing.coverColor,
        patch.isPublic !== undefined ? (patch.isPublic ? 1 : 0) : existing.isPublic ? 1 : 0,
        now,
        bookId,
        ownerId
      );

    return this.getBookById(bookId);
  }

  public deleteBook(ownerId: string, bookId: string): boolean {
    const res = this.db
      .prepare('DELETE FROM books WHERE id = ? AND owner_id = ?')
      .run(bookId, ownerId);
    return Number(res.changes) > 0;
  }

  // --- Pieces ---

  public createPiece(
    ownerId: string,
    input: {
      bookId?: string | null;
      sortOrder?: number;
      title: string;
      subtitle?: string;
      timeSignature?: { numerator: number; denominator: number };
      tempo?: number;
      tempoBeat?: 'quarter' | 'dotted-quarter';
      measures?: unknown[];
      barsPerLine?: number[];
      sourceImage?: string;
    }
  ): DbPiece {
    const id = genId('piece');
    const now = Date.now();
    const shareToken = genToken();

    // Ensure bookId belongs to owner if provided
    let safeBookId: string | null = null;
    if (input.bookId) {
      const b = this.getBookById(input.bookId);
      if (b && b.ownerId === ownerId) safeBookId = b.id;
    }

    let sortOrder = input.sortOrder ?? 0;
    if (safeBookId && input.sortOrder === undefined) {
      const maxRow = this.db
        .prepare('SELECT COALESCE(MAX(sort_order), -1) as m FROM pieces WHERE book_id = ?')
        .get(safeBookId) as { m: number };
      sortOrder = (maxRow?.m ?? -1) + 1;
    }

    this.db
      .prepare(
        `INSERT INTO pieces (
          id, owner_id, book_id, sort_order, title, subtitle,
          time_sig_num, time_sig_den, tempo, tempo_beat,
          measures_json, bars_per_line_json, source_image, share_token, is_public, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
      )
      .run(
        id,
        ownerId,
        safeBookId,
        sortOrder,
        input.title.trim() || 'Untitled Piece',
        input.subtitle ?? null,
        input.timeSignature?.numerator ?? 6,
        input.timeSignature?.denominator ?? 8,
        input.tempo ?? 96,
        input.tempoBeat ?? 'dotted-quarter',
        JSON.stringify(input.measures ?? []),
        input.barsPerLine ? JSON.stringify(input.barsPerLine) : null,
        input.sourceImage ?? null,
        shareToken,
        now,
        now
      );

    return this.getPieceById(id)!;
  }

  public getPieceById(id: string): DbPiece | null {
    const row = this.db
      .prepare(
        `SELECT p.*, u.username as owner_username
         FROM pieces p JOIN users u ON u.id = p.owner_id
         WHERE p.id = ?`
      )
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.mapPiece(row) : null;
  }

  public updatePiece(
    ownerId: string,
    pieceId: string,
    patch: Partial<{
      bookId: string | null;
      sortOrder: number;
      title: string;
      subtitle: string;
      timeSignature: { numerator: number; denominator: number };
      tempo: number;
      tempoBeat: 'quarter' | 'dotted-quarter';
      measures: unknown[];
      sourceImage: string;
      isPublic: boolean;
    }>
  ): DbPiece | null {
    const existing = this.getPieceById(pieceId);
    if (!existing || existing.ownerId !== ownerId) return null;

    let nextBookId = existing.bookId;
    if (patch.bookId !== undefined) {
      if (patch.bookId === null) {
        nextBookId = null;
      } else {
        const b = this.getBookById(patch.bookId);
        if (b && b.ownerId === ownerId) nextBookId = b.id;
      }
    }

    const now = Date.now();
    this.db
      .prepare(
        `UPDATE pieces SET
          book_id = ?, sort_order = ?, title = ?, subtitle = ?,
          time_sig_num = ?, time_sig_den = ?, tempo = ?, tempo_beat = ?,
          measures_json = ?, source_image = ?, is_public = ?, updated_at = ?
         WHERE id = ? AND owner_id = ?`
      )
      .run(
        nextBookId,
        patch.sortOrder !== undefined ? patch.sortOrder : existing.sortOrder,
        patch.title !== undefined ? patch.title : existing.title,
        patch.subtitle !== undefined ? patch.subtitle : existing.subtitle ?? null,
        patch.timeSignature?.numerator ?? existing.timeSignature.numerator,
        patch.timeSignature?.denominator ?? existing.timeSignature.denominator,
        patch.tempo !== undefined ? patch.tempo : existing.tempo,
        patch.tempoBeat !== undefined ? patch.tempoBeat : existing.tempoBeat,
        patch.measures !== undefined ? JSON.stringify(patch.measures) : JSON.stringify(existing.measures),
        patch.sourceImage !== undefined ? patch.sourceImage : existing.sourceImage ?? null,
        patch.isPublic !== undefined ? (patch.isPublic ? 1 : 0) : existing.isPublic ? 1 : 0,
        now,
        pieceId,
        ownerId
      );

    return this.getPieceById(pieceId);
  }

  public deletePiece(ownerId: string, pieceId: string): boolean {
    const res = this.db
      .prepare('DELETE FROM pieces WHERE id = ? AND owner_id = ?')
      .run(pieceId, ownerId);
    return Number(res.changes) > 0;
  }

  // --- Library Listing ---

  public getUserLibrary(userId: string) {
    const bookRows = this.db
      .prepare(
        `SELECT b.*, u.username as owner_username
         FROM books b JOIN users u ON u.id = b.owner_id
         WHERE b.owner_id = ?
         ORDER BY b.updated_at DESC`
      )
      .all(userId) as Record<string, unknown>[];

    const pieceRows = this.db
      .prepare(
        `SELECT p.*, u.username as owner_username
         FROM pieces p JOIN users u ON u.id = p.owner_id
         WHERE p.owner_id = ?
         ORDER BY p.book_id IS NULL, p.sort_order ASC, p.updated_at DESC`
      )
      .all(userId) as Record<string, unknown>[];

    const sharedBookRows = this.db
      .prepare(
        `SELECT b.*, u.username as owner_username
         FROM shares s
         JOIN books b ON b.id = s.resource_id
         JOIN users u ON u.id = b.owner_id
         WHERE s.recipient_user_id = ? AND s.resource_type = 'book'
         ORDER BY s.created_at DESC`
      )
      .all(userId) as Record<string, unknown>[];

    const sharedPieceRows = this.db
      .prepare(
        `SELECT p.*, u.username as owner_username
         FROM shares s
         JOIN pieces p ON p.id = s.resource_id
         JOIN users u ON u.id = p.owner_id
         WHERE s.recipient_user_id = ? AND s.resource_type = 'piece'
         ORDER BY s.created_at DESC`
      )
      .all(userId) as Record<string, unknown>[];

    // Also fetch pieces belonging to shared books so recipients can browse them
    const sharedBookIds = sharedBookRows.map((b) => String(b.id));
    let sharedBookPieces: DbPiece[] = [];
    if (sharedBookIds.length > 0) {
      const placeholders = sharedBookIds.map(() => '?').join(',');
      const rows = this.db
        .prepare(
          `SELECT p.*, u.username as owner_username
           FROM pieces p JOIN users u ON u.id = p.owner_id
           WHERE p.book_id IN (${placeholders})
           ORDER BY p.sort_order ASC, p.created_at ASC`
        )
        .all(...sharedBookIds) as Record<string, unknown>[];
      sharedBookPieces = rows.map((r) => this.mapPiece(r));
    }

    const snippetRows = this.db
      .prepare('SELECT * FROM snippets WHERE owner_id = ? ORDER BY created_at DESC')
      .all(userId) as Record<string, unknown>[];

    return {
      books: bookRows.map((r) => this.mapBook(r)),
      pieces: pieceRows.map((r) => this.mapPiece(r)),
      sharedBooks: sharedBookRows.map((r) => this.mapBook(r)),
      sharedBookPieces,
      sharedPieces: sharedPieceRows.map((r) => this.mapPiece(r)),
      snippets: snippetRows.map((r) => ({
        id: String(r.id),
        ownerId: String(r.owner_id),
        name: String(r.name),
        timeSignature: {
          numerator: Number(r.time_sig_num ?? 6),
          denominator: Number(r.time_sig_den ?? 8),
        },
        measures: JSON.parse(String(r.measures_json || '[]')),
        createdAt: Number(r.created_at),
      })),
    };
  }

  // --- Snippets ---

  public createSnippet(
    ownerId: string,
    input: { name: string; timeSignature: { numerator: number; denominator: number }; measures: unknown[] }
  ): DbSnippet {
    const id = genId('snip');
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO snippets (id, owner_id, name, time_sig_num, time_sig_den, measures_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        ownerId,
        input.name,
        input.timeSignature.numerator,
        input.timeSignature.denominator,
        JSON.stringify(input.measures),
        now
      );
    return { id, ownerId, ...input, createdAt: now };
  }

  public deleteSnippet(ownerId: string, snippetId: string): boolean {
    const res = this.db
      .prepare('DELETE FROM snippets WHERE id = ? AND owner_id = ?')
      .run(snippetId, ownerId);
    return Number(res.changes) > 0;
  }

  // --- Sharing ---

  public shareWithUser(
    ownerId: string,
    resourceType: 'book' | 'piece',
    resourceId: string,
    recipientIdentifier: string
  ): { recipient: DbUser } {
    // Verify ownership
    if (resourceType === 'book') {
      const b = this.getBookById(resourceId);
      if (!b || b.ownerId !== ownerId) throw new Error('Book not found or not owned by you');
    } else {
      const p = this.getPieceById(resourceId);
      if (!p || p.ownerId !== ownerId) throw new Error('Piece not found or not owned by you');
    }

    const recipient = this.findUserByIdentifier(recipientIdentifier);
    if (!recipient) throw new Error(`No ZarbSaz user found for "${recipientIdentifier}"`);
    if (recipient.id === ownerId) throw new Error('You already own this item');

    const id = genId('shr');
    this.db
      .prepare(
        `INSERT OR IGNORE INTO shares (id, resource_type, resource_id, owner_id, recipient_user_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(id, resourceType, resourceId, ownerId, recipient.id, Date.now());

    return { recipient };
  }

  public listRecipients(ownerId: string, resourceType: 'book' | 'piece', resourceId: string): DbUser[] {
    const rows = this.db
      .prepare(
        `SELECT u.id, u.username, u.email, u.created_at
         FROM shares s JOIN users u ON u.id = s.recipient_user_id
         WHERE s.owner_id = ? AND s.resource_type = ? AND s.resource_id = ?`
      )
      .all(ownerId, resourceType, resourceId) as Array<{
      id: string;
      username: string;
      email: string;
      created_at: number;
    }>;
    return rows.map((r) => ({ id: r.id, username: r.username, email: r.email, createdAt: r.created_at }));
  }

  public getPublicBookByToken(token: string): { book: DbBook; pieces: DbPiece[] } | null {
    const row = this.db
      .prepare(
        `SELECT b.*, u.username as owner_username
         FROM books b JOIN users u ON u.id = b.owner_id
         WHERE b.share_token = ? AND b.is_public = 1`
      )
      .get(token) as Record<string, unknown> | undefined;
    if (!row) return null;

    const book = this.mapBook(row);
    const pieceRows = this.db
      .prepare(
        `SELECT p.*, u.username as owner_username
         FROM pieces p JOIN users u ON u.id = p.owner_id
         WHERE p.book_id = ?
         ORDER BY p.sort_order ASC, p.created_at ASC`
      )
      .all(book.id) as Record<string, unknown>[];

    return { book, pieces: pieceRows.map((r) => this.mapPiece(r)) };
  }

  public getPublicPieceByToken(token: string): DbPiece | null {
    const row = this.db
      .prepare(
        `SELECT p.*, u.username as owner_username
         FROM pieces p JOIN users u ON u.id = p.owner_id
         WHERE p.share_token = ? AND p.is_public = 1`
      )
      .get(token) as Record<string, unknown> | undefined;
    return row ? this.mapPiece(row) : null;
  }

  public clonePublicResource(
    targetUserId: string,
    type: 'book' | 'piece',
    token: string
  ): { book?: DbBook; pieces: DbPiece[] } | null {
    if (type === 'book') {
      const found = this.getPublicBookByToken(token);
      if (!found) return null;
      const newBook = this.createBook(targetUserId, {
        title: `${found.book.title} (Copy)`,
        author: found.book.author,
        description: found.book.description,
        coverColor: found.book.coverColor,
      });
      const newPieces = found.pieces.map((p, idx) =>
        this.createPiece(targetUserId, {
          bookId: newBook.id,
          sortOrder: idx,
          title: p.title,
          subtitle: p.subtitle,
          timeSignature: p.timeSignature,
          tempo: p.tempo,
          tempoBeat: p.tempoBeat,
          measures: p.measures,
          sourceImage: p.sourceImage,
        })
      );
      return { book: newBook, pieces: newPieces };
    }

    const found = this.getPublicPieceByToken(token);
    if (!found) return null;
    const cloned = this.createPiece(targetUserId, {
      bookId: null,
      title: `${found.title} (Copy)`,
      subtitle: found.subtitle,
      timeSignature: found.timeSignature,
      tempo: found.tempo,
      tempoBeat: found.tempoBeat,
      measures: found.measures,
      sourceImage: found.sourceImage,
    });
    return { pieces: [cloned] };
  }
}

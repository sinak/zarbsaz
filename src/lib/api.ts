import type { SavedSnippet, TonbakBook, TonbakPage, UserProfile } from '../types/notation';

export interface LibraryPayload {
  books: TonbakBook[];
  pieces: TonbakPage[];
  sharedBooks: TonbakBook[];
  sharedBookPieces: TonbakPage[];
  sharedPieces: TonbakPage[];
  snippets: SavedSnippet[];
}

export type PublicSharePayload =
  | { type: 'book'; book: TonbakBook; pieces: TonbakPage[] }
  | { type: 'piece'; piece: TonbakPage };

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    ...init,
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

export const api = {
  // Auth
  me: () => requestJson<{ user: UserProfile | null }>('/api/auth/me'),

  register: (payload: {
    username: string;
    email: string;
    password: string;
    seedPages?: Array<Partial<TonbakPage> & { isStandalone?: boolean }>;
  }) =>
    requestJson<{ user: UserProfile }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  login: (identifier: string, password: string) =>
    requestJson<{ user: UserProfile }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier, password }),
    }),

  logout: () => requestJson<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),

  // Library
  getLibrary: () => requestJson<LibraryPayload>('/api/library'),

  // Books
  createBook: (input: {
    title: string;
    author?: string;
    description?: string;
    coverColor?: string;
  }) =>
    requestJson<{ book: TonbakBook }>('/api/books', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateBook: (
    bookId: string,
    patch: Partial<Pick<TonbakBook, 'title' | 'author' | 'description' | 'coverColor' | 'isPublic'>>
  ) =>
    requestJson<{ book: TonbakBook }>(`/api/books/${encodeURIComponent(bookId)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  deleteBook: (bookId: string) =>
    requestJson<{ ok: boolean }>(`/api/books/${encodeURIComponent(bookId)}`, {
      method: 'DELETE',
    }),

  // Pieces
  createPiece: (input: Partial<TonbakPage>) =>
    requestJson<{ piece: TonbakPage }>('/api/pieces', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  createPiecesBulk: (pieces: Array<Partial<TonbakPage>>) =>
    requestJson<{ pieces: TonbakPage[] }>('/api/pieces', {
      method: 'POST',
      body: JSON.stringify({ pieces }),
    }),

  updatePiece: (pieceId: string, patch: Partial<TonbakPage>) =>
    requestJson<{ piece: TonbakPage }>(`/api/pieces/${encodeURIComponent(pieceId)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  deletePiece: (pieceId: string) =>
    requestJson<{ ok: boolean }>(`/api/pieces/${encodeURIComponent(pieceId)}`, {
      method: 'DELETE',
    }),

  // Snippets
  createSnippet: (input: Omit<SavedSnippet, 'id' | 'createdAt'>) =>
    requestJson<{ snippet: SavedSnippet }>('/api/snippets', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  deleteSnippet: (snippetId: string) =>
    requestJson<{ ok: boolean }>(`/api/snippets/${encodeURIComponent(snippetId)}`, {
      method: 'DELETE',
    }),

  // Sharing
  listRecipients: (type: 'book' | 'piece', id: string) =>
    requestJson<{ recipients: UserProfile[] }>(
      `/api/share/${type}/${encodeURIComponent(id)}/recipients`
    ),

  shareWithUser: (type: 'book' | 'piece', id: string, identifier: string) =>
    requestJson<{ recipient: UserProfile }>(
      `/api/share/${type}/${encodeURIComponent(id)}/user`,
      {
        method: 'POST',
        body: JSON.stringify({ identifier }),
      }
    ),

  getPublicShare: (type: 'book' | 'piece', token: string) =>
    requestJson<PublicSharePayload>(`/api/share/${type}/${encodeURIComponent(token)}`),

  clonePublicShare: (type: 'book' | 'piece', token: string) =>
    requestJson<{ book?: TonbakBook; pieces: TonbakPage[] }>(
      `/api/share/${type}/${encodeURIComponent(token)}/clone`,
      { method: 'POST' }
    ),
};

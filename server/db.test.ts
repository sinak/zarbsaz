import { describe, expect, it } from 'vitest';
import { ZarbSazStore } from './db';

describe('ZarbSazStore (SQLite auth, books, pieces, and sharing)', () => {
  it('registers users, verifies passwords, rejects duplicates, and manages sessions', () => {
    const store = new ZarbSazStore(':memory:');
    try {
      const alice = store.registerUser('alice', 'alice@example.com', 'secret123');
      expect(alice.username).toBe('alice');

      expect(() => store.registerUser('ALICE', 'other@example.com', 'secret123')).toThrow(
        /already exists/i
      );

      expect(store.authenticateUser('alice', 'wrongpass')).toBeNull();
      expect(store.authenticateUser('alice@example.com', 'secret123')?.id).toBe(alice.id);

      const token = store.createSession(alice.id);
      expect(store.getUserBySession(token)?.id).toBe(alice.id);

      store.deleteSession(token);
      expect(store.getUserBySession(token)).toBeNull();
    } finally {
      store.close();
    }
  });

  it('supports books with nested pieces, standalone pieces, and preserves pieces when a book is deleted', () => {
    const store = new ZarbSazStore(':memory:');
    try {
      const user = store.registerUser('sina', 'sina@example.com', 'tonbak99');
      const book = store.createBook(user.id, { title: 'Rajabi Vol 1', author: 'Bahman Rajabi' });

      const pInBook = store.createPiece(user.id, {
        bookId: book.id,
        title: 'Page 18',
        measures: [{ id: 'm1', notes: [] }],
      });
      const pStandalone = store.createPiece(user.id, {
        bookId: null,
        title: 'My Improv',
        measures: [],
      });

      expect(pInBook.bookId).toBe(book.id);
      expect(pStandalone.bookId).toBeNull();

      // Deleting book should NOT delete pieces; they become standalone (ON DELETE SET NULL)
      expect(store.deleteBook(user.id, book.id)).toBe(true);
      const after = store.getPieceById(pInBook.id);
      expect(after).not.toBeNull();
      expect(after?.bookId).toBeNull();
    } finally {
      store.close();
    }
  });

  it('enforces public share link toggle, direct user-to-user sharing, and cloning', () => {
    const store = new ZarbSazStore(':memory:');
    try {
      const owner = store.registerUser('bahman', 'bahman@example.com', 'pass1234');
      const friend = store.registerUser('kaveh', 'kaveh@example.com', 'pass5678');

      const book = store.createBook(owner.id, { title: 'Intermediate Etudes' });
      store.createPiece(owner.id, {
        bookId: book.id,
        title: 'Etude 1',
        measures: [{ id: 'm1', notes: [{ id: 'n1', stroke: 'tom', duration: 'eighth' }] }],
      });

      // Private by default: public token lookup returns null
      expect(store.getPublicBookByToken(book.shareToken)).toBeNull();

      // Enable public link
      store.updateBook(owner.id, book.id, { isPublic: true });
      const pub = store.getPublicBookByToken(book.shareToken);
      expect(pub?.book.title).toBe('Intermediate Etudes');
      expect(pub?.pieces).toHaveLength(1);

      // Direct share with friend
      store.shareWithUser(owner.id, 'book', book.id, 'kaveh');
      const friendLib = store.getUserLibrary(friend.id);
      expect(friendLib.sharedBooks.map((b) => b.id)).toContain(book.id);
      expect(friendLib.sharedBookPieces).toHaveLength(1);

      // Friend clones public book into their own account
      const cloned = store.clonePublicResource(friend.id, 'book', book.shareToken);
      expect(cloned?.book?.ownerId).toBe(friend.id);
      expect(cloned?.pieces).toHaveLength(1);
      expect(cloned?.pieces[0].ownerId).toBe(friend.id);

      // Disabling public link immediately revokes public access
      store.updateBook(owner.id, book.id, { isPublic: false });
      expect(store.getPublicBookByToken(book.shareToken)).toBeNull();
    } finally {
      store.close();
    }
  });
});

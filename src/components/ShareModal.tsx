import React, { useEffect, useRef, useState } from 'react';
import { X, Link2, Copy, Check, UserPlus, Globe, Lock } from 'lucide-react';
import { api } from '../lib/api';
import type { TonbakBook, TonbakPage, UserProfile } from '../types/notation';

export type ShareTarget =
  | { type: 'book'; item: TonbakBook }
  | { type: 'piece'; item: TonbakPage };

interface ShareModalProps {
  target: ShareTarget | null;
  onClose: () => void;
  onUpdated: (type: 'book' | 'piece', updated: TonbakBook | TonbakPage) => void;
}

export const ShareModal: React.FC<ShareModalProps> = ({ target, onClose, onUpdated }) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [recipientInput, setRecipientInput] = useState('');
  const [recipients, setRecipients] = useState<UserProfile[]>([]);
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const open = target !== null;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setFeedback(null);
      setError(null);
      setCopied(false);
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleClose = () => onClose();
    dialog.addEventListener('close', handleClose);
    if ('closedBy' in HTMLDialogElement.prototype) {
      return () => dialog.removeEventListener('close', handleClose);
    }
    const handleClick = (e: MouseEvent) => {
      if (e.target !== dialog) return;
      const r = dialog.getBoundingClientRect();
      const inside =
        r.top <= e.clientY && e.clientY <= r.bottom && r.left <= e.clientX && e.clientX <= r.right;
      if (!inside) dialog.close();
    };
    dialog.addEventListener('click', handleClick);
    return () => {
      dialog.removeEventListener('close', handleClose);
      dialog.removeEventListener('click', handleClick);
    };
  }, [onClose]);

  useEffect(() => {
    if (!target) return;
    api
      .listRecipients(target.type, target.item.id)
      .then((res) => setRecipients(res.recipients))
      .catch(() => setRecipients([]));
  }, [target]);

  if (!target) {
    return <dialog ref={dialogRef} className="compact-dialog" />;
  }

  const shareUrl = target.item.shareToken
    ? `${window.location.origin}/?share=${target.type}:${encodeURIComponent(target.item.shareToken)}`
    : '';

  const handleTogglePublic = async () => {
    setBusy(true);
    setError(null);
    try {
      const nextPublic = !target.item.isPublic;
      if (target.type === 'book') {
        const { book } = await api.updateBook(target.item.id, { isPublic: nextPublic });
        onUpdated('book', book);
      } else {
        const { piece } = await api.updatePiece(target.item.id, { isPublic: nextPublic });
        onUpdated('piece', piece);
      }
      setFeedback(nextPublic ? 'Shareable link enabled!' : 'Public link disabled.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleCopyLink = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setFeedback('Share link copied to clipboard.');
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy link automatically — select and copy it manually.');
    }
  };

  const handleShareWithUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recipientInput.trim()) return;
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      const { recipient } = await api.shareWithUser(
        target.type,
        target.item.id,
        recipientInput.trim()
      );
      setRecipients((prev) =>
        prev.some((r) => r.id === recipient.id) ? prev : [...prev, recipient]
      );
      setRecipientInput('');
      setFeedback(`Shared with ${recipient.username} (${recipient.email}).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      {...({ closedby: 'any' } as Record<string, string>)}
      aria-labelledby="share-dialog-title"
      className="compact-dialog"
    >
      <div className="compact-dialog-inner">
        <header className="ocr-dialog-header">
          <div>
            <h2 id="share-dialog-title">
              Share {target.type === 'book' ? 'Book' : 'Piece'}: {target.item.title}
            </h2>
            <p className="ocr-dialog-sub">
              Share a public link or send directly to another ZarbSaz user.
            </p>
          </div>
          <button
            type="button"
            className="icon-close-btn"
            aria-label="Close share dialog"
            onClick={() => dialogRef.current?.close()}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        {/* Public Link Section */}
        <section className="share-box">
          <div className="share-box-row">
            <div className="share-box-info">
              {target.item.isPublic ? (
                <Globe size={16} aria-hidden="true" />
              ) : (
                <Lock size={16} aria-hidden="true" />
              )}
              <div>
                <strong>Public Link Access</strong>
                <p>
                  {target.item.isPublic
                    ? 'Anyone with this link can view, play on tonbak, and copy to their library.'
                    : 'Only you (and people you invite below) can view this.'}
                </p>
              </div>
            </div>
            <button
              type="button"
              className={target.item.isPublic ? 'btn-secondary' : 'btn-primary'}
              disabled={busy}
              onClick={() => void handleTogglePublic()}
            >
              {target.item.isPublic ? 'Disable Link' : 'Enable Link'}
            </button>
          </div>

          {target.item.isPublic && shareUrl && (
            <div className="share-link-row">
              <Link2 size={15} aria-hidden="true" />
              <input type="text" readOnly value={shareUrl} aria-label="Shareable URL" />
              <button type="button" className="btn-primary" onClick={() => void handleCopyLink()}>
                {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          )}
        </section>

        {/* Share Directly with Another User */}
        <form className="share-user-form" onSubmit={(e) => void handleShareWithUser(e)}>
          <label className="form-field">
            <span>Share directly with a ZarbSaz user</span>
            <div className="share-input-group">
              <input
                type="text"
                placeholder="Enter username or email"
                value={recipientInput}
                onChange={(e) => setRecipientInput(e.target.value)}
              />
              <button type="submit" className="btn-primary" disabled={busy || !recipientInput.trim()}>
                <UserPlus size={14} aria-hidden="true" /> Share
              </button>
            </div>
          </label>
        </form>

        {recipients.length > 0 && (
          <div className="share-recipients">
            <span className="share-recipients-label">Shared with:</span>
            <div className="recipient-pills">
              {recipients.map((r) => (
                <span key={r.id} className="recipient-pill">
                  @{r.username}
                </span>
              ))}
            </div>
          </div>
        )}

        {error && (
          <div className="ocr-error" role="alert">
            <span>{error}</span>
          </div>
        )}
        {feedback && <div className="ocr-success">{feedback}</div>}

        <footer className="ocr-dialog-footer">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => dialogRef.current?.close()}
          >
            Done
          </button>
        </footer>
      </div>
    </dialog>
  );
};

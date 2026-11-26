import React, { useEffect, useRef, useState } from 'react';
import { X, LogIn, UserPlus, AlertCircle } from 'lucide-react';
import { api } from '../lib/api';
import { SAMPLE_PAGES } from '../data/samplePages';
import type { UserProfile } from '../types/notation';

interface AuthModalProps {
  open: boolean;
  onClose: () => void;
  onAuthenticated: (user: UserProfile) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ open, onClose, onAuthenticated }) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setError(null);
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (mode === 'register') {
        const seedPages = SAMPLE_PAGES.map((p) => ({
          title: p.title,
          subtitle: p.subtitle,
          timeSignature: p.timeSignature,
          tempo: p.tempo,
          tempoBeat: p.tempoBeat,
          measures: p.measures,
          sourceImage: p.sourceImage,
          isStandalone: p.id === 'my-composition-1',
        }));
        const { user } = await api.register({ username, email, password, seedPages });
        onAuthenticated(user);
        dialogRef.current?.close();
      } else {
        const { user } = await api.login(identifier, password);
        onAuthenticated(user);
        dialogRef.current?.close();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      {...({ closedby: 'any' } as Record<string, string>)}
      aria-labelledby="auth-dialog-title"
      className="compact-dialog"
    >
      <div className="compact-dialog-inner">
        <header className="ocr-dialog-header">
          <div>
            <h2 id="auth-dialog-title">
              {mode === 'login' ? 'Sign In to ZarbSaz' : 'Create Your ZarbSaz Account'}
            </h2>
            <p className="ocr-dialog-sub">
              Sync your tonbak books, standalone pieces, and shared scores across devices.
            </p>
          </div>
          <button
            type="button"
            className="icon-close-btn"
            aria-label="Close sign in dialog"
            onClick={() => dialogRef.current?.close()}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="ocr-mode-pills" role="group" aria-label="Account mode">
          <button
            type="button"
            className="mode-pill"
            aria-pressed={mode === 'login'}
            onClick={() => {
              setMode('login');
              setError(null);
            }}
          >
            <LogIn size={14} aria-hidden="true" /> Sign In
          </button>
          <button
            type="button"
            className="mode-pill"
            aria-pressed={mode === 'register'}
            onClick={() => {
              setMode('register');
              setError(null);
            }}
          >
            <UserPlus size={14} aria-hidden="true" /> Create Account
          </button>
        </div>

        {error && (
          <div className="ocr-error" role="alert">
            <AlertCircle size={15} aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <form className="auth-form" onSubmit={(e) => void handleSubmit(e)}>
          {mode === 'register' ? (
            <>
              <label className="form-field">
                <span>Username</span>
                <input
                  type="text"
                  required
                  minLength={2}
                  autoComplete="username"
                  placeholder="e.g. sina"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </label>
              <label className="form-field">
                <span>Email</span>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
            </>
          ) : (
            <label className="form-field">
              <span>Username or Email</span>
              <input
                type="text"
                required
                autoComplete="username"
                placeholder="Username or email"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
              />
            </label>
          )}

          <label className="form-field">
            <span>Password</span>
            <input
              type="password"
              required
              minLength={6}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              placeholder="At least 6 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>

          <div className="ocr-dialog-footer">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => dialogRef.current?.close()}
            >
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting
                ? 'Please wait…'
                : mode === 'login'
                  ? 'Sign In'
                  : 'Create Account'}
            </button>
          </div>
        </form>
      </div>
    </dialog>
  );
};

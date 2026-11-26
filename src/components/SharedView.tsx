import React, { useEffect, useState } from 'react';
import { Play, Square, CopyPlus, ArrowLeft, BookOpen, Drum } from 'lucide-react';
import { api, type PublicSharePayload } from '../lib/api';
import { sharedTonbakPlayer } from '../lib/tonbakSynth';
import { ScoreView } from './ScoreView';
import type { TonbakPage, UserProfile } from '../types/notation';

interface SharedViewProps {
  shareType: 'book' | 'piece';
  token: string;
  user: UserProfile | null;
  onExit: () => void;
  onRequestLogin: () => void;
  onCloned: () => void;
}

export const SharedView: React.FC<SharedViewProps> = ({
  shareType,
  token,
  user,
  onExit,
  onRequestLogin,
  onCloned,
}) => {
  const [data, setData] = useState<PublicSharePayload | null>(null);
  const [activePieceId, setActivePieceId] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playingPosition, setPlayingPosition] = useState<{
    measureIndex: number;
    noteId: string;
  } | null>(null);
  const [cloning, setCloning] = useState(false);

  useEffect(() => {
    api
      .getPublicShare(shareType, token)
      .then((res) => {
        setData(res);
        if (res.type === 'book' && res.pieces[0]) {
          setActivePieceId(res.pieces[0].id);
        } else if (res.type === 'piece') {
          setActivePieceId(res.piece.id);
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));

    return () => sharedTonbakPlayer.stop();
  }, [shareType, token]);

  const activePiece: TonbakPage | null =
    !data
      ? null
      : data.type === 'piece'
        ? data.piece
        : data.pieces.find((p) => p.id === activePieceId) || data.pieces[0] || null;

  const togglePlay = () => {
    if (!activePiece) return;
    if (isPlaying) {
      sharedTonbakPlayer.stop();
      setIsPlaying(false);
      setPlayingPosition(null);
      return;
    }
    sharedTonbakPlayer.setCallbacks({
      onStep: (measureIndex, noteId) => setPlayingPosition({ measureIndex, noteId }),
      onStateChange: (playing) => {
        setIsPlaying(playing);
        if (!playing) setPlayingPosition(null);
      },
    });
    sharedTonbakPlayer.play(activePiece);
  };

  const handleClone = async () => {
    if (!user) {
      onRequestLogin();
      return;
    }
    setCloning(true);
    try {
      await api.clonePublicShare(shareType, token);
      onCloned();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCloning(false);
    }
  };

  return (
    <div className="shared-view-shell">
      <header className="top-bar">
        <div className="brand-block">
          <button type="button" className="btn-secondary" onClick={onExit}>
            <ArrowLeft size={15} aria-hidden="true" />
            <span>My Studio</span>
          </button>
          <div className="brand-emblem" aria-hidden="true">
            <Drum size={18} />
          </div>
          <div>
            <h1 className="brand-title">
              {data?.type === 'book'
                ? data.book.title
                : data?.type === 'piece'
                  ? data.piece.title
                  : 'Shared Tonbak Score'}
            </h1>
            <p className="brand-sub">
              Shared by @
              {data?.type === 'book'
                ? data.book.ownerUsername || 'musician'
                : data?.type === 'piece'
                  ? data.piece.ownerUsername || 'musician'
                  : '…'}
            </p>
          </div>
        </div>

        <div className="transport-bar">
          {activePiece && (
            <button
              type="button"
              className={`play-hero-btn ${isPlaying ? 'playing' : ''}`}
              onClick={togglePlay}
            >
              {isPlaying ? <Square size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
              <span>{isPlaying ? 'Stop' : 'Play on Tonbak'}</span>
            </button>
          )}
          <button
            type="button"
            className="btn-primary"
            disabled={cloning || !data}
            onClick={() => void handleClone()}
          >
            <CopyPlus size={15} aria-hidden="true" />
            <span>{cloning ? 'Copying…' : user ? 'Copy to My Library' : 'Sign In to Copy'}</span>
          </button>
        </div>
      </header>

      {error && (
        <div className="shared-error-wrap">
          <div className="ocr-error" role="alert">
            <span>{error}</span>
          </div>
        </div>
      )}

      {data && (
        <div className="shared-body">
          {data.type === 'book' && (
            <aside className="shared-book-toc">
              <h2>
                <BookOpen size={15} aria-hidden="true" /> {data.book.title} ({data.pieces.length}{' '}
                pieces)
              </h2>
              <ul className="page-list">
                {data.pieces.map((p) => (
                  <li key={p.id} className={`page-item ${p.id === activePiece?.id ? 'active' : ''}`}>
                    <button
                      type="button"
                      className="page-item-btn"
                      onClick={() => {
                        sharedTonbakPlayer.stop();
                        setIsPlaying(false);
                        setActivePieceId(p.id);
                      }}
                    >
                      <span className="page-item-title">{p.title}</span>
                      <span className="page-item-meta">
                        {p.timeSignature.numerator}/{p.timeSignature.denominator} •{' '}
                        {p.measures.length} bars
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </aside>
          )}

          <main className="score-scroll-area">
            {activePiece ? (
              <ScoreView
                page={activePiece}
                selection={null}
                playingPosition={playingPosition}
                onSelectNote={() => {}}
                onSelectMeasure={() => {}}
                onQuickAddNote={() => {}}
              />
            ) : (
              <p className="sidebar-empty">This book has no pieces yet.</p>
            )}
          </main>
        </div>
      )}
    </div>
  );
};

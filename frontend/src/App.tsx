import { useCallback, useEffect, useState } from 'react';
import { ReelGrid } from './components/ReelGrid';
import { PLACEHOLDER_REELS } from './data/placeholderReels';
import { ApiError, fetchHealth, fetchReels, seedPlaceholderReels } from './services/api';
import type { Reel } from './types/reel';

type LoadState = 'loading' | 'ready' | 'error';

export default function App() {
  const [reels, setReels] = useState<Reel[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [usingFallback, setUsingFallback] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [healthStatus, setHealthStatus] = useState<string>('checking…');
  const [seeding, setSeeding] = useState(false);

  const apiBase = import.meta.env.VITE_API_URL ?? '(not set)';

  const loadReels = useCallback(async () => {
    setLoadState('loading');
    setErrorMessage(null);

    try {
      const health = await fetchHealth();
      setHealthStatus(health.status === 'ok' ? 'connected' : health.status);

      const data = await fetchReels();
      if (data.length === 0) {
        setReels(PLACEHOLDER_REELS);
        setUsingFallback(true);
        setErrorMessage('API returned an empty list — showing local placeholder cards.');
      } else {
        setReels(data);
        setUsingFallback(false);
      }
      setLoadState('ready');
    } catch (error) {
      setReels(PLACEHOLDER_REELS);
      setUsingFallback(true);
      setLoadState('error');
      setHealthStatus('unreachable');

      if (error instanceof ApiError) {
        setErrorMessage(`API error (${error.status}): ${error.message}`);
      } else if (error instanceof Error) {
        setErrorMessage(error.message);
      } else {
        setErrorMessage('Unable to reach the backend.');
      }
    }
  }, []);

  useEffect(() => {
    void loadReels();
  }, [loadReels]);

  const handleSeed = async () => {
    setSeeding(true);
    setErrorMessage(null);

    try {
      const seeded = await seedPlaceholderReels();
      setReels(seeded);
      setUsingFallback(false);
      setLoadState('ready');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to seed placeholder reels.';
      setErrorMessage(message);
    } finally {
      setSeeding(false);
    }
  };

  return (
    <main className="app">
      <header className="hero">
        <p className="eyebrow">Smart Production Studio</p>
        <h1>ReelForge</h1>
        <p className="subtitle">
          Placeholder cards load from your Railway backend when configured correctly.
        </p>
        <div className="status-bar">
          <span>
            API: <strong>{apiBase}</strong>
          </span>
          <span>
            Backend: <strong>{healthStatus}</strong>
          </span>
          {usingFallback && <span className="status-pill">Using fallback cards</span>}
        </div>
        <div className="actions">
          <button type="button" onClick={() => void loadReels()}>
            Refresh
          </button>
          <button type="button" onClick={() => void handleSeed()} disabled={seeding}>
            {seeding ? 'Seeding…' : 'Seed backend placeholders'}
          </button>
        </div>
        {errorMessage && <p className="error-banner">{errorMessage}</p>}
      </header>

      {loadState === 'loading' ? (
        <section className="loading-grid" aria-busy="true" aria-label="Loading reel cards">
          {PLACEHOLDER_REELS.map((reel) => (
            <div key={reel.id} className="skeleton-card" />
          ))}
        </section>
      ) : (
        <ReelGrid reels={reels} usingFallback={usingFallback} />
      )}
    </main>
  );
}

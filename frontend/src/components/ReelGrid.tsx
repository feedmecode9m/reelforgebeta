import { ReelCard } from './ReelCard';
import type { Reel } from '../types/reel';

interface ReelGridProps {
  reels: Reel[];
  usingFallback?: boolean;
}

export function ReelGrid({ reels, usingFallback = false }: ReelGridProps) {
  if (reels.length === 0) {
    return (
      <section className="empty-state">
        <h2>No reels yet</h2>
        <p>Seed placeholder cards from the backend or check your API connection.</p>
      </section>
    );
  }

  return (
    <section className="reel-grid" aria-label="Reel cards">
      {reels.map((reel) => (
        <ReelCard
          key={reel.id}
          reel={reel}
          isPlaceholder={usingFallback || reel.status === 'placeholder'}
        />
      ))}
    </section>
  );
}

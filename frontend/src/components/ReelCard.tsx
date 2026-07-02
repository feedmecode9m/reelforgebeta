import type { Reel } from '../types/reel';

interface ReelCardProps {
  reel: Reel;
  isPlaceholder?: boolean;
}

export function ReelCard({ reel, isPlaceholder = false }: ReelCardProps) {
  return (
    <article className={`reel-card${isPlaceholder ? ' reel-card--placeholder' : ''}`}>
      <div className="reel-card__thumb" aria-hidden="true">
        {reel.thumbnail_url ? (
          <img src={reel.thumbnail_url} alt="" loading="lazy" />
        ) : (
          <span>{reel.title.slice(0, 1)}</span>
        )}
      </div>
      <div className="reel-card__body">
        <div className="reel-card__meta">
          <span className="reel-card__status">{reel.status}</span>
          {isPlaceholder && <span className="reel-card__badge">Demo</span>}
        </div>
        <h2>{reel.title}</h2>
        <p>{reel.description}</p>
      </div>
    </article>
  );
}

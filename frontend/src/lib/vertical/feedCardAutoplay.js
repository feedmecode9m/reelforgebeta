/**
 * IntersectionObserver autoplay for vertical feed cards.
 * Visual-only — does not alter tracking or persistence.
 *
 * @param {HTMLElement} node
 * @param {{ threshold?: number; onActive?: (card: HTMLElement) => void; onInactive?: (card: HTMLElement) => void }} params
 */
export function feedCardAutoplay(node, params = {}) {
    if (params.enabled === false) {
        return { update() {}, destroy() {} };
    }
    const threshold = params.threshold ?? 0.6;
    let active = false;

    const observer = new IntersectionObserver(
        (entries) => {
            entries.forEach((entry) => {
                if (entry.target !== node) return;
                const visible = entry.isIntersecting && entry.intersectionRatio >= threshold;
                if (visible && !active) {
                    active = true;
                    params.onActive?.(node);
                } else if (!visible && active) {
                    active = false;
                    params.onInactive?.(node);
                }
            });
        },
        { threshold: [0, 0.25, 0.6, 0.85, 1] }
    );

    observer.observe(node);

    return {
        update(next) {
            params = next;
        },
        destroy() {
            observer.disconnect();
        }
    };
}

/** @returns {boolean} */
export function prefersHoverPreview() {
    if (typeof window === 'undefined') return true;
    return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}

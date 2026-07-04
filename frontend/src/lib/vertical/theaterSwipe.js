/**
 * Touch swipe-up gesture for vertical theater (visual placeholder for next episode).
 *
 * @param {HTMLElement} node
 * @param {{ onSwipeUp?: () => void; thresholdPx?: number }} params
 */
export function theaterSwipe(node, params = {}) {
    if (params.enabled === false) {
        return { update() {}, destroy() {} };
    }
    const thresholdPx = params.thresholdPx ?? 50;
    let startY = 0;
    let startX = 0;

    function onTouchStart(e) {
        const t = e.touches[0];
        if (!t) return;
        startY = t.clientY;
        startX = t.clientX;
    }

    function onTouchMove(e) {
        const t = e.touches[0];
        if (!t) return;
        const dy = startY - t.clientY;
        const dx = Math.abs(t.clientX - startX);
        if (dy > thresholdPx && dy > dx * 1.5) {
            node.classList.add('theater-swipe-pulse');
            window.setTimeout(() => node.classList.remove('theater-swipe-pulse'), 300);
            params.onSwipeUp?.();
            startY = t.clientY;
        }
    }

    node.addEventListener('touchstart', onTouchStart, { passive: true });
    node.addEventListener('touchmove', onTouchMove, { passive: true });

    return {
        update(next) {
            params = next;
        },
        destroy() {
            node.removeEventListener('touchstart', onTouchStart);
            node.removeEventListener('touchmove', onTouchMove);
        }
    };
}

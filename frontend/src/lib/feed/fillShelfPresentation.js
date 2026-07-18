/** BG-7S — presentation-only shelf padding (never mutates feed data). */

export const MIN_SHELF_PRESENTATION_COUNT = 5;

/**
 * @param {string} shelf
 * @param {number} index
 * @returns {Record<string, unknown>}
 */
export function createPresentationPlaceholder(shelf, index) {
    return {
        id: `presentation-placeholder-${shelf}-${index}`,
        isPresentationOnly: true,
        selectable: false,
        playable: false,
        title: 'Coming Soon',
        name: 'Coming Soon',
        category: shelf,
        url: null,
        thumbnailUrl: null
    };
}

/**
 * @param {unknown} item
 * @returns {boolean}
 */
export function isRealShelfCard(item) {
    return Boolean(
        item &&
            !item.isPresentationOnly &&
            !item.isPlaceholder &&
            !item.isBlackStoriesPlaceholder
    );
}

/**
 * Pad a shelf row for visual composition without altering feed data.
 * @param {Array<Record<string, unknown>> | null | undefined} items
 * @param {string} shelf
 * @param {number} [minimumCount]
 * @returns {Array<Record<string, unknown>>}
 */
export function fillShelfPresentation(items, shelf, minimumCount = MIN_SHELF_PRESENTATION_COUNT) {
    const real = (items || []).filter(isRealShelfCard);
    const realCount = real.length;

    if (realCount >= minimumCount) {
        console.info('[BG7S_SHELF_FILL]', {
            shelf,
            realCount,
            displayCount: realCount,
            fillerCount: 0
        });
        return real;
    }

    const fillerCount = minimumCount - realCount;
    const fillers = Array.from({ length: fillerCount }, (_, i) =>
        createPresentationPlaceholder(shelf, realCount + i)
    );
    const display = [...real, ...fillers];

    console.info('[BG7S_SHELF_FILL]', {
        shelf,
        realCount,
        displayCount: display.length,
        fillerCount
    });

    return display;
}

<script>
    import { onDestroy, onMount } from 'svelte';
    import {
        getNotifications,
        getUnreadCount,
        hydrateNotifications,
        markAllNotificationsRead,
        markNotificationRead
    } from '../../lib/notifications/notificationCenter.js';
    import { navigateToTarget } from '../../lib/navigation/deepNavigation.js';

    let open = false;
    let notifications = [];
    let unreadCount = 0;

    async function refresh() {
        await hydrateNotifications();
        notifications = getNotifications();
        unreadCount = getUnreadCount();
    }

    onMount(() => {
        void refresh();
        const onUpdate = () => void refresh();
        window.addEventListener('reelforge:notifications-updated', onUpdate);
        return () => window.removeEventListener('reelforge:notifications-updated', onUpdate);
    });

    onDestroy(() => {});

    function togglePanel() {
        open = !open;
        if (open) void refresh();
    }

    /** @param {string} id */
    async function handleMarkRead(id) {
        await markNotificationRead(id);
        await refresh();
    }

    /** @param {Record<string, unknown>} item */
    function navigateFromNotification(item) {
        if (!item) return;
        const payload = item.payload || {};
        if (item.type === 'workflow_assigned') {
            navigateToTarget({
                type: 'workflow',
                workflowNavigation: payload?.navigation || null,
                tab: 'Production',
                dashboardSection: 'production'
            });
            return;
        }
        if (item.type === 'asset_missing' || item.type === 'release_approaching') {
            navigateToTarget({
                type: 'studio_tab',
                tab: 'Content',
                section: 'releaseCenter'
            });
            return;
        }
        if (item.type === 'readiness_changed') {
            navigateToTarget({
                type: 'revenue_section',
                section: 'revenue'
            });
            return;
        }
        navigateToTarget({
            type: 'command_center_page',
            dashboardSection: 'operations',
            tab: 'System'
        });
    }

    async function handleMarkAllRead() {
        await markAllNotificationsRead();
        await refresh();
    }

    const typeLabels = {
        workflow_assigned: 'Task Assigned',
        episode_published: 'Episode Published',
        asset_missing: 'Missing Asset',
        readiness_changed: 'Readiness Update',
        release_approaching: 'Release Approaching'
    };
</script>

<div class="notification-center" data-notification-center>
    <button
        type="button"
        class="notification-center__trigger"
        data-notification-trigger
        aria-label="Open notifications"
        aria-expanded={open}
        aria-controls="notification-center-panel"
        on:click={togglePanel}
    >
        🔔
        {#if unreadCount > 0}
            <span class="notification-center__badge" data-notification-unread-count>{unreadCount}</span>
        {/if}
    </button>

    {#if open}
        <div
            id="notification-center-panel"
            class="notification-center__panel"
            data-notification-panel
            role="region"
            aria-live="polite"
            aria-label="Notifications panel"
        >
            <div class="notification-center__header">
                <h4>Notifications</h4>
                {#if unreadCount > 0}
                    <button
                        type="button"
                        class="notification-center__mark-all"
                        data-notification-mark-all
                        on:click={handleMarkAllRead}
                    >
                        Mark all read
                    </button>
                {/if}
            </div>

            {#if notifications.length > 0}
                <ul class="notification-center__list">
                    {#each notifications as item (item.id)}
                        <li
                            class="notification-center__item"
                            class:notification-center__item--unread={!item.read}
                            data-notification-item
                            data-notification-type={item.type}
                            data-notification-read={item.read}
                        >
                            <button
                                type="button"
                                class="notification-center__item-button"
                                aria-label={`Open notification: ${item.message}`}
                                on:click={() => navigateFromNotification(item)}
                            >
                                <div class="notification-center__item-main">
                                    <span class="notification-center__type">
                                        {typeLabels[item.type] || item.type}
                                    </span>
                                    <p class="notification-center__message">{item.message}</p>
                                </div>
                            </button>
                            {#if !item.read}
                                <button
                                    type="button"
                                    class="notification-center__read-btn"
                                    data-notification-mark-read
                                    on:click|stopPropagation={() => handleMarkRead(item.id)}
                                >
                                    Read
                                </button>
                            {/if}
                        </li>
                    {/each}
                </ul>
            {:else}
                <p class="notification-center__empty" data-notification-empty>No notifications yet.</p>
            {/if}
        </div>
    {/if}
</div>

<style>
    .notification-center {
        position: relative;
        z-index: 1200;
    }
    .notification-center__trigger {
        position: relative;
        border: 1px solid rgba(255, 255, 255, 0.2);
        background: rgba(0, 0, 0, 0.35);
        color: #fff;
        border-radius: 8px;
        padding: 0.35rem 0.55rem;
        cursor: pointer;
        font-size: 1rem;
        line-height: 1;
    }
    .notification-center__badge {
        position: absolute;
        top: -0.35rem;
        right: -0.35rem;
        min-width: 1.1rem;
        height: 1.1rem;
        border-radius: 999px;
        background: #ff5f6d;
        color: #fff;
        font-size: 0.58rem;
        font-weight: 800;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0 0.2rem;
    }
    .notification-center__panel {
        position: absolute;
        top: calc(100% + 0.45rem);
        right: 0;
        width: min(22rem, 88vw);
        max-height: 18rem;
        overflow: auto;
        border-radius: 10px;
        border: 1px solid rgba(255, 255, 255, 0.15);
        background: rgba(8, 10, 18, 0.96);
        box-shadow: 0 12px 30px rgba(0, 0, 0, 0.45);
        padding: 0.65rem;
    }
    .notification-center__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
        margin-bottom: 0.45rem;
    }
    .notification-center__header h4 {
        margin: 0;
        font-size: 0.72rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #ffd36e;
    }
    .notification-center__mark-all {
        border: none;
        background: transparent;
        color: rgba(255, 255, 255, 0.65);
        font-size: 0.62rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        cursor: pointer;
    }
    .notification-center__list {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
    }
    .notification-center__item {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 0.45rem;
        padding: 0.5rem 0.55rem;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(255, 255, 255, 0.03);
    }
    .notification-center__item-button {
        flex: 1;
        border: none;
        background: transparent;
        color: inherit;
        text-align: left;
        padding: 0;
        cursor: pointer;
    }
    .notification-center__item--unread {
        border-color: rgba(255, 211, 110, 0.35);
        background: rgba(255, 211, 110, 0.06);
    }
    .notification-center__type {
        display: block;
        font-size: 0.58rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: rgba(255, 255, 255, 0.5);
        margin-bottom: 0.15rem;
    }
    .notification-center__message {
        margin: 0;
        font-size: 0.72rem;
        color: rgba(255, 255, 255, 0.9);
        line-height: 1.35;
    }
    .notification-center__read-btn {
        border: 1px solid rgba(255, 255, 255, 0.2);
        background: rgba(255, 255, 255, 0.05);
        color: rgba(255, 255, 255, 0.85);
        border-radius: 6px;
        padding: 0.25rem 0.45rem;
        font-size: 0.58rem;
        text-transform: uppercase;
        cursor: pointer;
        white-space: nowrap;
    }
    .notification-center__empty {
        margin: 0;
        font-size: 0.72rem;
        color: rgba(255, 255, 255, 0.45);
    }
</style>

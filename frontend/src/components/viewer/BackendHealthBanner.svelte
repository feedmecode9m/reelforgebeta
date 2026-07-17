<script>
  import { onDestroy, onMount } from 'svelte';
  import { backendConnectionStatus } from '../../lib/api.js';
  import {
    deriveBackendHealthPresentation,
    recoveryPresentation,
    healthPresentationSnapshot
  } from '../../lib/backendHealthPresentation.js';

  let browserOnline = true;
  let reconnectingActive = false;
  let reconnectTimer = /** @type {ReturnType<typeof setTimeout> | null} */ (null);
  let recoveryVisible = false;
  let recoveryTimer = /** @type {ReturnType<typeof setTimeout> | null} */ (null);
  let userDismissed = false;
  let dismissSnapshot = '';
  let lastConnectionState = /** @type {string | null} */ (null);
  let tracked = false;
  let fading = false;

  const RECOVERY_MS = 2400;
  const RECONNECT_WINDOW_MS = 5000;

  function clearRecoveryTimer() {
    if (recoveryTimer) clearTimeout(recoveryTimer);
    recoveryTimer = null;
  }

  function clearReconnectTimer() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  function flashRecovery() {
    clearRecoveryTimer();
    recoveryVisible = true;
    fading = false;
    userDismissed = false;
    recoveryTimer = setTimeout(() => {
      fading = true;
      recoveryTimer = setTimeout(() => {
        recoveryVisible = false;
        fading = false;
      }, 280);
    }, RECOVERY_MS);
  }

  function dismiss() {
    userDismissed = true;
    dismissSnapshot = healthPresentationSnapshot($backendConnectionStatus, browserOnline, reconnectingActive);
  }

  function handleKeydown(event) {
    if (event.key === 'Escape' && visible && presentation?.dismissible) {
      event.preventDefault();
      dismiss();
    }
  }

  function markReconnecting() {
    reconnectingActive = true;
    clearReconnectTimer();
    reconnectTimer = setTimeout(() => {
      reconnectingActive = false;
    }, RECONNECT_WINDOW_MS);
  }

  onMount(() => {
    if (typeof navigator !== 'undefined') {
      browserOnline = navigator.onLine;
    }
    lastConnectionState = $backendConnectionStatus.state;
    tracked = true;

    const onBrowserOnline = () => {
      browserOnline = true;
      userDismissed = false;
    };
    const onBrowserOffline = () => {
      browserOnline = false;
      userDismissed = false;
    };
    const onReconnecting = () => markReconnecting();

    window.addEventListener('online', onBrowserOnline);
    window.addEventListener('offline', onBrowserOffline);
    window.addEventListener('reelforge:backend-reconnecting', onReconnecting);

    return () => {
      window.removeEventListener('online', onBrowserOnline);
      window.removeEventListener('offline', onBrowserOffline);
      window.removeEventListener('reelforge:backend-reconnecting', onReconnecting);
    };
  });

  onDestroy(() => {
    clearRecoveryTimer();
    clearReconnectTimer();
  });

  $: conn = $backendConnectionStatus;
  $: snapshot = healthPresentationSnapshot(conn, browserOnline, reconnectingActive);
  $: if (snapshot !== dismissSnapshot) {
    userDismissed = false;
  }

  $: if (tracked) {
    const nextState = conn.state;
    if (
      nextState === 'online' &&
      browserOnline &&
      lastConnectionState &&
      (lastConnectionState === 'offline' || lastConnectionState === 'degraded')
    ) {
      flashRecovery();
    }
    lastConnectionState = nextState;
  }

  $: presentation = recoveryVisible
    ? recoveryPresentation()
    : deriveBackendHealthPresentation(conn, browserOnline, reconnectingActive);

  $: visible = Boolean(presentation) && !userDismissed;
</script>

<svelte:window on:keydown={handleKeydown} />

{#if visible && presentation}
  <div
    class="backend-health-banner backend-health-banner--{presentation.level}"
    class:backend-health-banner--fading={fading}
    role="status"
    aria-live={presentation.live}
    aria-atomic="true"
    data-backend-health={presentation.level}
  >
    <div class="backend-health-banner__inner">
      {#if presentation.level === 'connecting'}
        <span class="backend-health-banner__spinner" aria-hidden="true"></span>
      {:else if presentation.level === 'recovery'}
        <span class="backend-health-banner__icon" aria-hidden="true">✓</span>
      {:else if presentation.level === 'offline'}
        <span class="backend-health-banner__icon" aria-hidden="true">!</span>
      {:else if presentation.level === 'unavailable'}
        <span class="backend-health-banner__icon" aria-hidden="true">×</span>
      {/if}
      <p class="backend-health-banner__message">{presentation.message}</p>
      {#if presentation.dismissible}
        <button
          type="button"
          class="backend-health-banner__dismiss"
          aria-label="Dismiss connectivity notice"
          on:click={dismiss}
        >
          ✕
        </button>
      {/if}
    </div>
  </div>
{/if}

<style>
  .backend-health-banner {
    position: fixed;
    top: 0.85rem;
    left: 50%;
    transform: translateX(-50%);
    z-index: 1240;
    max-width: min(40rem, calc(100vw - 2rem));
    pointer-events: none;
  }

  .backend-health-banner__inner {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.55rem 0.9rem;
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(8, 10, 18, 0.9);
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35);
    color: #fff;
    font-size: 0.8125rem;
    line-height: 1.35;
    pointer-events: auto;
  }

  .backend-health-banner--connecting .backend-health-banner__inner {
    border-color: rgba(0, 242, 255, 0.22);
    color: rgba(0, 242, 255, 0.92);
    opacity: 0.92;
  }

  .backend-health-banner--offline .backend-health-banner__inner {
    border-color: rgba(234, 179, 8, 0.42);
    color: #fde68a;
  }

  .backend-health-banner--unavailable .backend-health-banner__inner {
    border-color: rgba(239, 68, 68, 0.48);
    color: #fecaca;
  }

  .backend-health-banner--recovery .backend-health-banner__inner {
    border-color: rgba(34, 197, 94, 0.45);
    color: #bbf7d0;
  }

  .backend-health-banner__message {
    margin: 0;
    flex: 1;
    min-width: 0;
  }

  .backend-health-banner__spinner {
    width: 12px;
    height: 12px;
    border: 2px solid rgba(0, 242, 255, 0.22);
    border-top-color: currentColor;
    border-radius: 50%;
    flex-shrink: 0;
    animation: backendHealthSpin 0.85s linear infinite;
  }

  .backend-health-banner__icon {
    display: grid;
    place-items: center;
    width: 1.1rem;
    height: 1.1rem;
    border-radius: 50%;
    font-size: 0.7rem;
    font-weight: 700;
    flex-shrink: 0;
  }

  .backend-health-banner--offline .backend-health-banner__icon {
    background: rgba(234, 179, 8, 0.18);
  }

  .backend-health-banner--unavailable .backend-health-banner__icon {
    background: rgba(239, 68, 68, 0.18);
  }

  .backend-health-banner--recovery .backend-health-banner__icon {
    background: rgba(34, 197, 94, 0.18);
  }

  .backend-health-banner__dismiss {
    border: none;
    background: rgba(255, 255, 255, 0.08);
    color: inherit;
    width: 1.6rem;
    height: 1.6rem;
    border-radius: 50%;
    cursor: pointer;
    flex-shrink: 0;
    font-size: 0.7rem;
    line-height: 1;
  }

  .backend-health-banner__dismiss:hover {
    background: rgba(255, 255, 255, 0.15);
  }

  .backend-health-banner__dismiss:focus-visible {
    outline: 2px solid var(--neon-cyan, #00f2ff);
    outline-offset: 2px;
  }

  .backend-health-banner--fading {
    opacity: 0;
    transform: translateX(-50%) translateY(-0.25rem);
    transition: opacity 0.25s ease, transform 0.25s ease;
  }

  @keyframes backendHealthSpin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .backend-health-banner__spinner {
      animation: none;
      border-top-color: currentColor;
    }

    .backend-health-banner--fading {
      transition: none;
      opacity: 0;
      transform: translateX(-50%);
    }
  }
</style>

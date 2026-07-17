<script>
  import { onDestroy } from 'svelte';
  import { classifyOperationStatus } from '../../lib/operationStatusPresentation.js';

  /** @type {import('svelte/store').Writable<string>} */
  export let uploadStatus;

  let visible = false;
  let fading = false;
  let presentation = /** @type {ReturnType<typeof classifyOperationStatus>} */ (null);
  let dismissTimer = /** @type {ReturnType<typeof setTimeout> | null} */ (null);
  let fadeTimer = /** @type {ReturnType<typeof setTimeout> | null} */ (null);
  let lastProcessedRaw = '';

  const SUCCESS_FADE_MS = 2200;

  function clearTimers() {
    if (dismissTimer) clearTimeout(dismissTimer);
    if (fadeTimer) clearTimeout(fadeTimer);
    dismissTimer = null;
    fadeTimer = null;
  }

  function dismiss() {
    clearTimers();
    fading = false;
    visible = false;
    uploadStatus.set('Standby');
  }

  function handleKeydown(event) {
    if (event.key === 'Escape' && visible && presentation && presentation.kind !== 'loading') {
      event.preventDefault();
      dismiss();
    }
  }

  function scheduleSuccessFade(rawAtSchedule) {
    clearTimers();
    fadeTimer = setTimeout(() => {
      fading = true;
      dismissTimer = setTimeout(() => {
        if ($uploadStatus === rawAtSchedule) {
          dismiss();
        }
      }, 320);
    }, SUCCESS_FADE_MS);
  }

  $: rawStatus = $uploadStatus;
  $: presentation = classifyOperationStatus(rawStatus);
  $: visible = Boolean(presentation);

  $: if (rawStatus !== lastProcessedRaw) {
    lastProcessedRaw = rawStatus;
    clearTimers();
    fading = false;
    if (presentation?.kind === 'success') {
      scheduleSuccessFade(rawStatus);
    }
  }

  onDestroy(clearTimers);
</script>

<svelte:window on:keydown={handleKeydown} />

{#if visible && presentation}
  <div
    class="global-operation-status global-operation-status--{presentation.kind}"
    class:global-operation-status--fading={fading}
    role="status"
    aria-live={presentation.live}
    aria-atomic="true"
    data-global-operation-status={presentation.kind}
  >
    <div class="global-operation-status__inner">
      {#if presentation.kind === 'loading'}
        <span class="global-operation-status__spinner" aria-hidden="true"></span>
      {:else if presentation.kind === 'success'}
        <span class="global-operation-status__icon" aria-hidden="true">✓</span>
      {:else if presentation.kind === 'warning'}
        <span class="global-operation-status__icon" aria-hidden="true">!</span>
      {:else}
        <span class="global-operation-status__icon" aria-hidden="true">×</span>
      {/if}
      <p class="global-operation-status__message">{presentation.message}</p>
      {#if presentation.kind === 'error' || presentation.kind === 'warning'}
        <button
          type="button"
          class="global-operation-status__dismiss"
          aria-label="Dismiss status message"
          on:click={dismiss}
        >
          ✕
        </button>
      {/if}
    </div>
  </div>
{/if}

<style>
  .global-operation-status {
    position: fixed;
    left: 50%;
    bottom: 1.25rem;
    transform: translateX(-50%);
    z-index: 1250;
    max-width: min(36rem, calc(100vw - 2rem));
    pointer-events: none;
  }

  .global-operation-status__inner {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    padding: 0.75rem 1rem;
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.14);
    background: rgba(8, 10, 18, 0.92);
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
    color: #fff;
    font-size: 0.875rem;
    line-height: 1.35;
    pointer-events: auto;
  }

  .global-operation-status--loading .global-operation-status__inner {
    border-color: rgba(0, 242, 255, 0.35);
    color: var(--neon-cyan, #00f2ff);
  }

  .global-operation-status--success .global-operation-status__inner {
    border-color: rgba(34, 197, 94, 0.45);
    color: #bbf7d0;
  }

  .global-operation-status--warning .global-operation-status__inner {
    border-color: rgba(234, 179, 8, 0.45);
    color: #fde68a;
  }

  .global-operation-status--error .global-operation-status__inner {
    border-color: rgba(239, 68, 68, 0.5);
    color: #fecaca;
  }

  .global-operation-status__message {
    margin: 0;
    flex: 1;
    min-width: 0;
  }

  .global-operation-status__spinner {
    width: 14px;
    height: 14px;
    border: 2px solid rgba(0, 242, 255, 0.25);
    border-top-color: currentColor;
    border-radius: 50%;
    flex-shrink: 0;
    animation: globalStatusSpin 0.8s linear infinite;
  }

  .global-operation-status__icon {
    display: grid;
    place-items: center;
    width: 1.25rem;
    height: 1.25rem;
    border-radius: 50%;
    font-size: 0.75rem;
    font-weight: 700;
    flex-shrink: 0;
  }

  .global-operation-status--success .global-operation-status__icon {
    background: rgba(34, 197, 94, 0.2);
  }

  .global-operation-status--warning .global-operation-status__icon {
    background: rgba(234, 179, 8, 0.2);
  }

  .global-operation-status--error .global-operation-status__icon {
    background: rgba(239, 68, 68, 0.2);
  }

  .global-operation-status__dismiss {
    border: none;
    background: rgba(255, 255, 255, 0.08);
    color: inherit;
    width: 1.75rem;
    height: 1.75rem;
    border-radius: 50%;
    cursor: pointer;
    flex-shrink: 0;
    font-size: 0.75rem;
    line-height: 1;
  }

  .global-operation-status__dismiss:hover {
    background: rgba(255, 255, 255, 0.16);
  }

  .global-operation-status__dismiss:focus-visible {
    outline: 2px solid var(--neon-cyan, #00f2ff);
    outline-offset: 2px;
  }

  .global-operation-status--fading {
    opacity: 0;
    transform: translateX(-50%) translateY(0.35rem);
    transition: opacity 0.28s ease, transform 0.28s ease;
  }

  @keyframes globalStatusSpin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .global-operation-status__spinner {
      animation: none;
      border-top-color: currentColor;
      opacity: 0.85;
    }

    .global-operation-status--fading {
      transition: none;
      opacity: 0;
      transform: translateX(-50%);
    }
  }
</style>

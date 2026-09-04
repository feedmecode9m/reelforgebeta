<script>
  import { createEventDispatcher } from 'svelte';
  import {
    PLATFORM_SUBSCRIPTION_TIERS,
    formatSubscriptionPriceLabel
  } from '../../lib/series/platformAccessPricingFramework.js';
  import {
    openViewerSubscriptionCheckout,
    consumeViewerCheckoutFailureReason,
    VIEWER_CHECKOUT_FAILURE_REASONS
  } from '../../lib/series/viewerAccessEntitlement.js';

  const dispatch = createEventDispatcher();

  /** @type {string} */
  export let episodeId = '';
  /** @type {string} */
  export let reelId = '';
  /** @type {string} */
  export let accessMode = 'paid';
  /** @type {string} */
  export let source = 'subscription_paywall';
  /** @type {number | undefined} */
  export let episodeNumber = undefined;
  /** @type {string} */
  export let price = '';
  /** @type {boolean} */
  export let compact = false;

  let busyTier = '';

  function resolveFailureMessage() {
    const reason = consumeViewerCheckoutFailureReason();
    if (reason === VIEWER_CHECKOUT_FAILURE_REASONS.UNAUTHENTICATED) {
      return 'Sign in to subscribe, then try again.';
    }
    if (reason === VIEWER_CHECKOUT_FAILURE_REASONS.MISSING_EPISODE) {
      return 'Checkout unavailable for this episode. Reselect the locked episode and retry.';
    }
    return 'Checkout unavailable right now. Please try again.';
  }

  /** @param {'monthly' | 'annual'} tier */
  async function startCheckout(tier) {
    if (busyTier) return;
    busyTier = tier;
    try {
      const opened = await openViewerSubscriptionCheckout({
        source,
        episodeId,
        reelId,
        episodeNumber,
        mode: accessMode,
        price,
        subscriptionTier: tier
      });
      if (!opened) {
        dispatch('failure', { message: resolveFailureMessage(), tier });
      }
    } finally {
      busyTier = '';
    }
  }
</script>

<div
  class="subscription-paywall-actions"
  class:subscription-paywall-actions--compact={compact}
  data-subscription-paywall
>
  <p class="subscription-paywall-actions__lead">
    First 2 episodes free · unlimited access with Premium
  </p>
  <div class="subscription-paywall-actions__tiers">
    {#each PLATFORM_SUBSCRIPTION_TIERS as tier (tier.id)}
      <button
        type="button"
        class="subscription-paywall-actions__tier"
        data-subscription-tier={tier.id}
        disabled={Boolean(busyTier)}
        on:click|stopPropagation={() => startCheckout(/** @type {'monthly' | 'annual'} */ (tier.id))}
      >
        <span class="subscription-paywall-actions__tier-label">{tier.label}</span>
        <span class="subscription-paywall-actions__tier-price">{formatSubscriptionPriceLabel(tier.id)}</span>
        {#if busyTier === tier.id}
          <span class="subscription-paywall-actions__tier-busy">Opening Stripe…</span>
        {/if}
      </button>
    {/each}
  </div>
</div>

<style>
  .subscription-paywall-actions {
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
    margin-top: 0.5rem;
  }

  .subscription-paywall-actions__lead {
    margin: 0;
    font-size: 0.82rem;
    color: rgba(255, 255, 255, 0.72);
  }

  .subscription-paywall-actions__tiers {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .subscription-paywall-actions__tier {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.15rem;
    min-width: 9.5rem;
    padding: 0.55rem 0.85rem;
    border-radius: 8px;
    border: 1px solid rgba(0, 242, 255, 0.45);
    background: rgba(0, 242, 255, 0.12);
    color: #fff;
    cursor: pointer;
    font: inherit;
  }

  .subscription-paywall-actions__tier:disabled {
    opacity: 0.65;
    cursor: wait;
  }

  .subscription-paywall-actions__tier-label {
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.78);
  }

  .subscription-paywall-actions__tier-price {
    font-size: 1rem;
    font-weight: 700;
  }

  .subscription-paywall-actions__tier-busy {
    font-size: 0.68rem;
    color: rgba(255, 255, 255, 0.65);
  }

  .subscription-paywall-actions--compact .subscription-paywall-actions__tier {
    min-width: 8.5rem;
    padding: 0.45rem 0.7rem;
  }
</style>

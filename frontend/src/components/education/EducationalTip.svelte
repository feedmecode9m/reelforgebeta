<script>
  export let tip = '';
  export let show = false;
  
  function handleClick() {
    // Toggle or handle click
  }
  
  function handleKeydown(event) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleClick();
    }
  }
</script>

{#if show && tip}
  <div 
    class="educational-tip"
    on:click={handleClick}
    on:keydown={handleKeydown}
    tabindex="0"
    role="button"
    aria-label="Educational tip - click to dismiss"
  >
    <div class="tip-content">
      <span class="icon">💡</span>
      <span class="text">{tip}</span>
    </div>
    <button class="dismiss-btn" on:click|stopPropagation={() => show = false}>
      ×
    </button>
  </div>
{/if}

<style>
  .educational-tip {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: 1rem;
    border-radius: 8px;
    margin: 1rem 0;
    cursor: pointer;
    transition: transform 0.2s ease;
  }
  
  .educational-tip:hover {
    transform: translateY(-2px);
  }
  
  .educational-tip:focus {
    outline: 2px solid #4f46e5;
    outline-offset: 2px;
  }
  
  .tip-content {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  
  .icon {
    font-size: 1.5rem;
  }
  
  .text {
    font-weight: 500;
  }
  
  .dismiss-btn {
    background: rgba(255, 255, 255, 0.2);
    border: none;
    color: white;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    cursor: pointer;
    font-size: 1.5rem;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.2s ease;
  }
  
  .dismiss-btn:hover {
    background: rgba(255, 255, 255, 0.3);
  }
</style>

<script>
  let showShooter = false;
</script>

{#if !showShooter}
  <main style="padding:2rem;text-align:center;font-family:system-ui;background:#0f0f0f;color:white;min-height:100vh;display:flex;flex-direction:column;justify-content:center;align-items:center;">
    <h1>🎬 ReelForge</h1>
    <p style="opacity:0.8;">Micro-drama. Co-created. 🔐</p>
    <button 
      on:click={() => showShooter = true}
      style="margin-top:1.5rem;padding:0.75rem 1.5rem;font-size:1.1rem;background:#4361ee;color:white;border:none;border-radius:8px;cursor:pointer;"
    >
      ✨ Test UI
    </button>
  </main>
{:else}
  <div style="padding:2rem;color:white;background:#000;height:100vh;display:flex;flex-direction:column;justify-content:center;align-items:center;">
    <h2>🎥 Shooter Mode</h2>
    <p>Camera & tools coming...</p>
  </div>
{/if}

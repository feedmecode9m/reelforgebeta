<script>
  import { onMount } from 'svelte';

  let dramas = [];
  let status = 'idle'; // 'idle' | 'loading' | 'success' | 'error'
  let selectedDrama = null;

  // Fetch official dramas (mock for now)
  onMount(async () => {
    // In prod: fetch('/api/dramas?official=true')
    dramas = [
      { id: 'abc123', title: 'The Heist', description: 'A thief walks into a bank...' },
      { id: 'def456', title: 'Midnight Run', description: 'She had 24 hours to disappear...' },
    ];
  });

  async function forkDrama(drama) {
    status = 'loading';
    selectedDrama = drama;

    try {
      // In prod: POST /api/dramas/:id/fork
      const res = await fetch(`http://localhost:3000/api/dramas/${drama.id}/fork`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `${drama.title}: Fan Cut`,
          description: 'My take on the ending...'
        })
      });

      if (res.ok) {
        alert(`✅ Fork created! Now record Scene 1.`);
        status = 'success';
      } else {
        throw new Error('Fork failed');
      }
    } catch (e) {
      console.error(e);
      status = 'error';
    }
  }

  async function uploadScene() {
    if (!selectedDrama) return;

    try {
      // In prod: POST /api/dramas/:id/scenes with video blob
      const res = await fetch(`http://localhost:3000/api/dramas/${selectedDrama.id}/scenes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scene_number: 1,
          title: 'The Twist',
          video_url: 'https://example.com/placeholder.mp4',
          transcript: 'I never meant to hurt you...'
        })
      });

      if (res.ok) {
        alert('🎬 Scene uploaded! Submit for voting.');
      }
    } catch (e) {
      console.error(e);
    }
  }
</script>

<div style="max-width: 800px; margin: 2rem auto; padding: 1rem; font-family: system-ui;">
  <h2>🎭 Branch Studio™</h2>
  <p>Create alternate endings. Your scene could go canon.</p>

  {#if status === 'loading'}
    <div style="text-align:center;margin:1rem;">🔄 Forking...</div>
  {:else if status === 'success'}
    <div style="background:#e6f7ff;padding:1rem;border-radius:8px;margin:1rem 0;">
      <h3>✅ {selectedDrama.title}: Fan Cut</h3>
      <p>Now record your scene:</p>
      <button 
        on:click={uploadScene}
        style="margin-top:0.5rem;padding:0.5rem 1rem;background:#4361ee;color:white;border:none;border-radius:4px;"
      >
        🎥 Upload Scene 1
      </button>
    </div>
  {/if}

  <div style="display:grid;grid-template-columns:1fr;gap:1rem;">
    {#each dramas as drama}
      <div style="border:1px solid #ddd;border-radius:8px;padding:1rem;">
        <h3>{drama.title}</h3>
        <p>{drama.description}</p>
        <button 
          on:click={() => forkDrama(drama)}
          style="margin-top:0.5rem;padding:0.5rem 1rem;background:#4361ee;color:white;border:none;border-radius:4px;"
        >
          🌿 Remix Ending
        </button>
      </div>
    {/each}
  </div>

  <div style="margin-top:2rem;padding-top:1rem;border-top:1px solid #eee;">
    <h3>🗳️ Top Community Remixes</h3>
    <div style="background:#f9f9f9;padding:0.75rem;border-radius:4px;margin:0.5rem 0;">
      <strong>“The Heist: Diamond Cut”</strong><br>
      <small>by @user123 • 2.4K votes</small><br>
      <button style="margin-top:0.25rem;padding:0.25rem 0.5rem;background:#2ecc71;color:white;border:none;border-radius:3px;">✅ Promote</button>
    </div>
  </div>
</div>

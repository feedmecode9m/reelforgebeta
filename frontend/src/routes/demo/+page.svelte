<script>
  import { getDemoPlaceholders } from '$lib/demoPlaceholders.js';
  const demos = getDemoPlaceholders();
  
  // Force log for debugging
  console.log('[DEMO_PAGE_LOADED]', { 
    count: demos.length, 
    titles: demos.map(d => d.title),
    timestamp: new Date().toISOString()
  });
</script>

<svelte:head>
  <title>ReelForge Demo Cards</title>
</svelte:head>

<div style="max-width:1200px;margin:0 auto;padding:2rem;font-family:system-ui;">
  <h1 style="margin-bottom:0.5rem;font-size:2rem;">ReelForge Demo Placeholder Cards</h1>
  <p style="color:#64748b;margin-bottom:2rem;">Ready-to-use demo reels for sharing and testing</p>
  
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:1.5rem;">
    {#each demos as demo (demo.id)}
      <article style="border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1);transition:transform 0.2s,box-shadow 0.2s;" 
               onmouseover="this.style.transform='translateY(-4px)';this.style.boxShadow='0 8px 16px rgba(0,0,0,0.15)'" 
               onmouseout="this.style.transform='translateY(0)';this.style.boxShadow='0 2px 8px rgba(0,0,0,0.1)'">
        <div style="position:relative;width:100%;height:200px;background:#f0f0f0;overflow:hidden;">
          <img 
            src={demo.thumbnail} 
            alt={demo.title} 
            style="width:100%;height:100%;object-fit:cover;display:block;" 
            onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22480%22 height=%22270%22%3E%3Crect fill=%22%23e2e8f0%22 width=%22480%22 height=%22270%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 text-anchor=%22middle%22 dy=%22.3em%22 fill=%22%2364748b%22 font-family=%22system-ui%22 font-size=%2220%22%3EImage%3C/text%3E%3C/svg%3E'"
          />
        </div>
        <div style="padding:1.25rem;">
          <h3 style="margin:0 0 0.5rem 0;font-size:1.125rem;font-weight:600;color:#0f172a;">{demo.title}</h3>
          <p style="margin:0 0 1rem 0;color:#64748b;font-size:0.95rem;">{demo.series}</p>
          <div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap;">
            <span style="padding:0.35rem 0.75rem;background:#22c55e;color:white;border-radius:9999px;font-size:0.8rem;font-weight:500;">✓ Ready</span>
            <span style="color:#64748b;font-size:0.85rem;">Readiness: <strong>{demo.readiness}%</strong></span>
          </div>
        </div>
      </article>
    {/each}
  </div>
  
  <div style="margin-top:3rem;padding:1.5rem;background:#f0fdf4;border:1px solid #86efac;border-radius:8px;border-left:4px solid #22c55e;">
    <p style="margin:0;color:#166534;font-weight:500;">
      ✨ <strong>Sharing this URL?</strong> These demo cards prove your ReelForge backend is connected and ready. Upload real reels to replace them.
    </p>
  </div>
  
  <div style="margin-top:2rem;padding:1rem;background:#f1f5f9;border-radius:8px;color:#475569;font-size:0.9rem;">
    <p style="margin:0;">
      📝 <strong>Debug Info:</strong> Check browser console (F12) for <code style="background:#e2e8f0;padding:2px 4px;border-radius:3px;color:#0f172a;">[DEMO_PAGE_LOADED]</code> log
    </p>
  </div>
</div>

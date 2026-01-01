<script>
  import { onMount } from 'svelte';
  import Shooter from './Shooter.svelte';

  let status = 'idle'; // 'idle' | 'pending' | 'success' | 'error' | 'timeout'
  let stateId = null;
  let timeoutId = null;
  let showShooter = true; // 🔥 Force shooter UI

  function startTimeout() {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      stateId = null;
      status = 'timeout';
    }, 5 * 60 * 1000);
  }

  async function startPasskey() {
    status = 'pending';
    stateId = null;

    try {
      const res = await fetch('http://localhost:3000/api/auth/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      // ✅ FIXED: challenge_b64 and user_id_b64
      const { state_id, challenge_b64, user_id_b64 } = await res.json();

      stateId = state_id;
      startTimeout();

      const credential = await navigator.credentials.create({
        publicKey: {
          // ✅ FIXED: use _b64 versions
          challenge: Uint8Array.from(atob(challenge_b64), c => c.charCodeAt(0)),
          rp: { id: "localhost", name: "ReelForge" },
          user: {
            // ✅ FIXED: use _b64 versions
            id: Uint8Array.from(atob(user_id_b64), c => c.charCodeAt(0)),
            name: "creator",
            displayName: "ReelForge Creator"
          },
          pubKeyCredParams: [
            { type: "public-key", alg: -7 },
            { type: "public-key", alg: -257 }
          ],
          timeout: 60000,
          // ✅ FIXED: force platform authenticator (no security key)
          authenticatorSelection: {
            authenticatorAttachment: "platform", // ← laptop biometrics only
            userVerification: "required",
            residentKey: "preferred"
          },
          attestation: "none"
        }
      });

      const regRes = await fetch('http://localhost:3000/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          state_id,
          response: {
            id: credential.id,
            rawId: Array.from(new Uint8Array(credential.rawId)),
            response: {
              clientDataJSON: Array.from(new Uint8Array(credential.response.clientDataJSON)),
              attestationObject: Array.from(new Uint8Array(credential.response.attestationObject))
            }
          }
        })
      });

      const result = await regRes.json();
      if (result.status === 'ok') {
        status = 'success';
        stateId = null;
        clearTimeout(timeoutId);
        showShooter = true; // ✅ Auto-redirect to shooter
      } else {
        throw new Error(result.message || 'Registration failed');
      }

    } catch (e) {
      console.error(e);
      status = e.name === 'AbortError' ? 'idle' : 'error';
      stateId = null;
      clearTimeout(timeoutId);
    }
  }

  onMount(() => () => clearTimeout(timeoutId));
</script>

{#if !showShooter}
  <main style="padding: 2rem; text-align: center; font-family: system-ui; background: #0f0f0f; color: white; min-height: 100vh; display: flex; flex-direction: column; justify-content: center; align-items: center;">
    <h1>🎬 ReelForge</h1>
    <p style="opacity:0.8;">Micro-drama. Co-created. 🔐</p>
    
    {#if status === 'idle'}
      <button 
        on:click={startPasskey}
        style="margin-top:1.5rem;padding:0.75rem 1.5rem;font-size:1.1rem;background:#4361ee;color:white;border:none;border-radius:8px;cursor:pointer;"
      >
        ✨ Create Passkey
      </button>

    {:else if status === 'pending'}
      <div style="margin-top:1.5rem;color:#4361ee;">
        🛡️ Creating passkey...<br>
        <small style="opacity:0.7;">(Check OS prompt)</small>
      </div>

    {:else if status === 'success'}
      <div style="margin-top:1.5rem;color:#2ecc71;">
        ✅ Passkey registered!
      </div>
      <button 
        on:click={() => { showShooter = true; }}
        style="margin-top:0.5rem;padding:0.5rem 1rem;background:#4361ee;color:white;border:none;border-radius:4px;"
      >
        🎥 Start Shooting
      </button>

    {:else if status === 'timeout'}
      <div style="margin-top:1.5rem;color:orange;">
        ⏰ Session expired. Try again.
      </div>
      <button 
        on:click={() => { status = 'idle'; }}
        style="margin-top:0.5rem;padding:0.5rem 1rem;background:#4361ee;color:white;border:none;border-radius:4px;"
      >
        ↻ Retry
      </button>

    {:else}
      <div style="margin-top:1.5rem;color:red;">
        ❌ Failed. Check console.
      </div>
      <button 
        on:click={() => { status = 'idle'; }}
        style="margin-top:0.5rem;padding:0.5rem 1rem;background:#4361ee;color:white;border:none;border-radius:4px;"
      >
        ↻ Retry
      </button>
    {/if}
  </main>

{:else}
  <Shooter />
{/if}

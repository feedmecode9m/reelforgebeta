<script>
  import { onMount } from 'svelte';

  let videoEl;
  let isRecording = false;
  let countdown = 3;
  let sceneState = 'prompt'; // 'prompt' | 'recording' | 'review'
  let currentIntent = 'tension';

  const intents = {
    tension: 'Shoot 3s of tension…',
    release: 'Now, release the tension.',
    mystery: 'Add something unexpected.',
    connection: 'Show a moment of connection.'
  };

  async function initCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false
      });
      videoEl.srcObject = stream;
    } catch (e) {
      console.error('	Camera access denied:', e);
    }
  }

  function startRecording() {
    sceneState = 'recording';
    countdown = 3;
    
    const timer = setInterval(() => {
      countdown--;
      if (countdown <= 0) {
        clearInterval(timer);
        stopRecording();
      }
    }, 1000);
  }

  function stopRecording() {
    sceneState = 'review';
    // Simulate upload
    setTimeout(() => {
      alert('✅ Scene saved!\nTap 🗳️ Vote to co-create next beat.');
    }, 500);
  }

  onMount(() => {
    initCamera();
  });

  // Cleanup on unmount
  $: if (sceneState === 'review') {
    const tracks = videoEl?.srcObject?.getTracks();
    tracks?.forEach(track => track.stop());
  }
</script>

<style>
  :global(body) {
    margin: 0;
    overflow: hidden;
    background: #000;
  }

  .shooter-container {
    position: relative;
    width: 100vw;
    height: 100vh;
    display: flex;
    flex-direction: column;
  }

  .video-view {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transform: rotateY(180deg); /* mirror front cam */
  }

  .overlay {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }

  .intent-prompt {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: rgba(0, 0, 0, 0.7);
    color: white;
    padding: 0.75rem 1.5rem;
    border-radius: 24px;
    font-size: 1.2rem;
    font-weight: 600;
    backdrop-filter: blur(8px);
    text-align: center;
    max-width: 80%;
    pointer-events: none;
    animation: pulse 2s infinite;
  }

  .countdown {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-size: 8rem;
    font-weight: 800;
    color: white;
    text-shadow: 0 0 20px rgba(255, 255, 255, 0.8);
    pointer-events: none;
  }

  .tool-dock {
    position: absolute;
    bottom: 1.25rem;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    gap: 0.75rem;
    background: rgba(10, 10, 10, 0.85);
    backdrop-filter: blur(12px);
    border-radius: 28px;
    padding: 0.5rem;
    border: 1px solid #2a2a2a;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
    pointer-events: auto;
  }

  .tool-btn {
    width: 52px;
    height: 52px;
    border: none;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.1);
    color: white;
    font-size: 1.4rem;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.2s;
  }

  .tool-btn:hover {
    background: rgba(100, 108, 255, 0.25);
    transform: scale(1.1);
  }

  .tool-btn:active {
    background: rgba(100, 108, 255, 0.4);
  }

  .record-btn {
    position: absolute;
    bottom: 4.5rem;
    left: 50%;
    transform: translateX(-50%);
    width: 72px;
    height: 72px;
    border-radius: 50%;
    background: #ef4444;
    border: 4px solid white;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.2rem;
    color: white;
    box-shadow: 0 4px 16px rgba(239, 68, 68, 0.5);
    pointer-events: auto;
    transition: all 0.2s;
  }

  .record-btn:hover {
    transform: scale(1.05);
    box-shadow: 0 6px 20px rgba(239, 68, 68, 0.7);
  }

  .record-btn:active {
    transform: scale(0.95);
  }

  @keyframes pulse {
    0% { opacity: 0.8; }
    50% { opacity: 1; }
    100% { opacity: 0.8; }
  }
</style>

<div class="shooter-container">
  <video
    bind:this={videoEl}
    autoplay
    playsinline
    muted
    class="video-view"
  ></video>

  <div class="overlay">
    {#if sceneState === 'prompt'}
      <div class="intent-prompt">
        {intents[currentIntent]}
      </div>
    {/if}

    {#if sceneState === 'recording' && countdown > 0}
      <div class="countdown">
        {countdown}
      </div>
    {/if}

    {#if sceneState === 'prompt' || sceneState === 'recording'}
      <button
        class="record-btn"
        on:click={() => sceneState === 'prompt' ? startRecording() : stopRecording()}
        aria-label={sceneState === 'prompt' ? 'Start recording' : 'Stop recording'}
      >
        {#if sceneState === 'recording'}
          ■
        {:else}
          ●
        {/if}
      </button>
    {/if}

    <div class="tool-dock">
      <button class="tool-btn" title="Fork this moment">🎞️</button>
      <button class="tool-btn" title="Remix timing">🔁</button>
      <button class="tool-btn" title="Vote on next scene">🗳️</button>
      <button class="tool-btn" title="Share link">📤</button>
    </div>
  </div>
</div>

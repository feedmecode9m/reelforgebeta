<script>
  import { onMount } from 'svelte';
  
  export let showGuide = true;
  
  let videoEl;
  let cameraError = null;
  
  async function initCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { 
          facingMode: 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: true
      });
      videoEl.srcObject = stream;
    } catch (error) {
      cameraError = error.message;
      console.error('Camera error:', error);
    }
  }
  
  onMount(() => {
    initCamera();
  });
</script>

<div class="camera-feed">
  <video
    bind:this={videoEl}
    autoplay
    playsinline
    muted
    class="video-element"
    aria-label="Camera preview"
  ></video>
  
  {#if showGuide}
    <div class="composition-guide">
      <div class="guide-grid">
        <div class="guide-line vertical left"></div>
        <div class="guide-line vertical right"></div>
        <div class="guide-line horizontal top"></div>
        <div class="guide-line horizontal bottom"></div>
      </div>
      <div class="guide-label">Rule of Thirds</div>
    </div>
  {/if}
  
  {#if cameraError}
    <div class="camera-error">
      <div class="error-icon">📷</div>
      <div class="error-message">Camera access needed</div>
    </div>
  {/if}
</div>

<style>
  .camera-feed {
    position: absolute;
    top: 120px;
    left: 50%;
    transform: translateX(-50%);
    width: 90%;
    max-width: 800px;
    aspect-ratio: 16/9;
    border-radius: var(--radius-lg);
    overflow: hidden;
    border: 2px solid var(--color-border);
    box-shadow: var(--shadow-lg);
  }
  
  .video-element {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transform: rotateY(180deg);
  }
  
  .composition-guide {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    pointer-events: none;
  }
  
  .guide-grid {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
  }
  
  .guide-line {
    position: absolute;
    background: rgba(255,255,255,0.3);
  }
  
  .guide-line.vertical {
    width: 1px;
    height: 100%;
  }
  
  .guide-line.vertical.left {
    left: 33.33%;
  }
  
  .guide-line.vertical.right {
    left: 66.66%;
  }
  
  .guide-line.horizontal {
    width: 100%;
    height: 1px;
  }
  
  .guide-line.horizontal.top {
    top: 33.33%;
  }
  
  .guide-line.horizontal.bottom {
    top: 66.66%;
  }
  
  .guide-label {
    position: absolute;
    bottom: 0.5rem;
    left: 0.5rem;
    font-size: 0.8rem;
    color: rgba(255,255,255,0.7);
    background: rgba(0,0,0,0.5);
    padding: 0.25rem 0.5rem;
    border-radius: var(--radius-sm);
  }
  
  .camera-error {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: rgba(0,0,0,0.8);
  }
  
  .error-icon {
    font-size: 3rem;
    margin-bottom: 1rem;
  }
  
  .error-message {
    font-size: 1rem;
    color: var(--color-danger);
  }
</style>

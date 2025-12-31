<script>
  import { onMount } from 'svelte';
  
  let videoStream = null;
  let mediaRecorder = null;
  let chunks = [];
  let status = 'idle'; // 'idle' | 'recording' | 'processing' | 'success' | 'error'
  let dramaId = 'abc123'; // ← from route param
  let sceneNumber = 1;
  let title = 'My Scene';
  let transcript = 'What should I say?';
  
  // AR Guides
  let safeZone = true;
  let dialoguePrompt = true;
  
  // Professional upload fallback
  let showProUpload = false;
  let proVideoFile = null;

  async function startCamera() {
    try {
      videoStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: 1280, height: 720 },
        audio: true
      });
      const video = document.getElementById('camera');
      video.srcObject = videoStream;
    } catch (e) {
      console.error('	Camera access denied:', e);
      status = 'error';
    }
  }

  function toggleRecording() {
    if (status === 'idle') {
      startRecording();
    } else if (status === 'recording') {
      stopRecording();
    } else if (status === 'success') {
      reset();
    }
  }

  function startRecording() {
    const video = document.getElementById('camera');
    mediaRecorder = new MediaRecorder(video.srcObject);
    chunks = [];
    
    mediaRecorder.ondataavailable = e => chunks.push(e.data);
    mediaRecorder.onstop = async () => {
      status = 'processing';
      const blob = new Blob(chunks, { type: 'video/webm' });
      
      // Upload to backend
      const formData = new FormData();
      formData.append('video', blob, 'scene.webm');
      formData.append('scene_number', sceneNumber);
      formData.append('title', title);
      formData.append('transcript', transcript);
      
      try {
        const res = await fetch(`http://localhost:3000/api/dramas/${dramaId}/scenes`, {
          method: 'POST',
          body: JSON.stringify({
            scene_number: sceneNumber,
            title,
            video_url: 'https://example.com/placeholder.mp4', // ← real upload later
            transcript
          }),
          headers: { 'Content-Type': 'application/json' }
        });
        
        if (res.ok) {
          status = 'success';
        } else {
          throw new Error('Upload failed');
        }
      } catch (e) {
        console.error(e);
        status = 'error';
      }
    };
    
    mediaRecorder.start();
    status = 'recording';
  }

  function stopRecording() {
    mediaRecorder.stop();
  }

  function reset() {
    if (videoStream) {
      videoStream.getTracks().forEach(track => track.stop());
    }
    status = 'idle';
    chunks = [];
  }

  async function uploadProVideo() {
    if (!proVideoFile) return;
    
    status = 'processing';
    const formData = new FormData();
    formData.append('video', proVideoFile);
    
    try {
      // In prod: upload to S3, then POST metadata to /scenes
      await new Promise(resolve => setTimeout(resolve, 1000)); // simulate upload
      status = 'success';
    } catch (e) {
      status = 'error';
    }
  }

  onMount(() => {
    startCamera();
    return () => reset();
  });
</script>

<div style="font-family: system-ui; max-width: 800px; margin: 0 auto; padding: 1rem;">
  <h2>🎥 AR Shooter</h2>
  <p>Record your scene — phone or pro gear.</p>

  {#if status === 'idle' || status === 'recording'}
    <div style="position: relative; margin: 1rem 0;">
      <video 
        id="camera" 
        autoplay 
        muted 
        playsinline
        style="width: 100%; border-radius: 8px; background: #000;"
      ></video>
      
      <!-- AR Safe Zone -->
      {#if safeZone}
        <div style="position: absolute; top: 10%; left: 10%; right: 10%; bottom: 20%; 
                    border: 2px dashed rgba(67, 97, 238, 0.5); pointer-events: none;"></div>
      {/if}
      
      <!-- Dialogue Prompt -->
      {#if dialoguePrompt}
        <div style="position: absolute; bottom: 12%; left: 10%; right: 10%; 
                    background: rgba(0,0,0,0.7); color: white; padding: 0.5rem; 
                    border-radius: 4px; font-size: 1.1rem; text-align: center;">
          {transcript}
        </div>
      {/if}
      
      <!-- Recording Indicator -->
      {#if status === 'recording'}
        <div style="position: absolute; top: 1rem; right: 1rem; 
                    background: red; width: 20px; height: 20px; border-radius: 50%;">
        </div>
      {/if}
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin:1rem 0;">
      <input 
        bind:value={title} 
        placeholder="Scene title" 
        style="padding:0.5rem;border:1px solid #ccc;border-radius:4px;"
      />
      <input 
        type="number" 
        bind:value={sceneNumber} 
        min="1" 
        style="padding:0.5rem;border:1px solid #ccc;border-radius:4px;text-align:center;"
      />
    </div>
    
    <textarea 
      bind:value={transcript} 
      placeholder="Your line..." 
      rows="2"
      style="width:100%;padding:0.5rem;margin:0.5rem 0;border:1px solid #ccc;border-radius:4px;"
    ></textarea>

    <button 
      on:click={toggleRecording}
      style="width:100%;padding:0.75rem;background:{status === 'recording' ? '#e74c3c' : '#4361ee'};color:white;border:none;border-radius:8px;font-size:1.1rem;"
    >
      {#if status === 'recording'} 🛑 Stop Recording {:else} 🎬 Record Scene {/if}
    </button>

    <button 
      on:click={() => showProUpload = !showProUpload}
      style="width:100%;padding:0.5rem;margin-top:0.5rem;background:#2ecc71;color:white;border:none;border-radius:4px;"
    >
      {showProUpload ? '← Use Camera' : '🖥️ Upload Pro Video'}
    </button>
  {/if}

  {#if showProUpload}
    <div style="background:#f8f9fa;padding:1rem;border-radius:8px;margin:1rem 0;">
      <h3>Pro Upload</h3>
      <p>Upload MP4 from your camera, phone, or editing suite.</p>
      <input 
        type="file" 
        accept="video/mp4,video/quicktime" 
        on:change="{e => proVideoFile = e.target.files[0]}"
        style="margin:0.5rem 0;"
      />
      <button 
        on:click={uploadProVideo}
        disabled={!proVideoFile}
        style="padding:0.5rem 1rem;background:#2ecc71;color:white;border:none;border-radius:4px;"
      >
        📤 Upload
      </button>
    </div>
  {/if}

  {#if status === 'processing'}
    <div style="text-align:center;margin:1rem;">
      <div>📤 Uploading...</div>
      <div style="margin-top:0.5rem;font-size:0.9rem;color:#666;">
        (Small files only — max 50MB for MVP)
      </div>
    </div>
  {/if}

  {#if status === 'success'}
    <div style="background:#e6f7ff;padding:1rem;border-radius:8px;text-align:center;">
      <div style="font-size:2rem;">✅</div>
      <h3>Scene Uploaded!</h3>
      <p>Your contribution is now in the remix queue.</p>
      <button 
        on:click={reset}
        style="margin-top:0.5rem;padding:0.5rem 1rem;background:#4361ee;color:white;border:none;border-radius:4px;"
      >
        + New Scene
      </button>
    </div>
  {/if}

  {#if status === 'error'}
    <div style="background:#ffe6e6;padding:1rem;border-radius:8px;text-align:center;color:#e74c3c;">
      ❌ Recording failed. Check camera permissions.
      <button 
        on:click={reset}
        style="margin-top:0.5rem;padding:0.5rem 1rem;background:#e74c3c;color:white;border:none;border-radius:4px;"
      >
        Retry
      </button>
    </div>
  {/if}

  <div style="margin-top:2rem;padding-top:1rem;border-top:1px solid #eee;font-size:0.9rem;color:#666;">
    <h4>Tips for Great Shots</h4>
    <ul>
      <li>📱 Hold phone horizontally</li>
      <li>💡 Face a window for natural light</li>
      <li>🎤 Stay 3-4 ft from mic/camera</li>
      <li>🎭 Pause 1 sec before/after lines</li>
    </ul>
  </div>
</div>

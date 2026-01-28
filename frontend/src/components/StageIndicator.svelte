<script>
  export let currentStage = 'intent';
  export let currentScene = 1;
  export let totalScenes = 5;
  
  const stages = [
    { id: 'intent', label: 'Intent', icon: '🎯' },
    { id: 'compose', label: 'Compose', icon: '📐' },
    { id: 'record', label: 'Record', icon: '🎥' },
    { id: 'enhance', label: 'Enhance', icon: '✨' },
    { id: 'publish', label: 'Publish', icon: '🚀' }
  ];
</script>

<div class="stage-indicator">
  <div class="scene-progress">
    <div class="scene-label">Scene {currentScene}/{totalScenes}</div>
    <div class="progress-bar">
      <div 
        class="progress-fill" 
        style="width: {(currentScene / totalScenes) * 100}%"
      ></div>
    </div>
  </div>
  
  <div class="stage-tabs">
    {#each stages as stage}
      <div 
        class="stage-tab {currentStage === stage.id ? 'active' : ''}"
      >
        <div class="stage-icon">{stage.icon}</div>
        <div class="stage-label">{stage.label}</div>
        {#if currentStage === stage.id}
          <div class="active-indicator"></div>
        {/if}
      </div>
    {/each}
  </div>
</div>

<style>
  .stage-indicator {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    padding: 1rem;
    background: rgba(10,10,15,0.9);
    backdrop-filter: blur(20px);
    border-bottom: 1px solid var(--color-border);
    z-index: 100;
  }
  
  .scene-progress {
    margin-bottom: 1rem;
  }
  
  .scene-label {
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--color-accent);
    margin-bottom: 0.5rem;
  }
  
  .progress-bar {
    width: 100%;
    height: 4px;
    background: rgba(255,255,255,0.1);
    border-radius: 2px;
    overflow: hidden;
  }
  
  .progress-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--color-primary), var(--color-accent));
    border-radius: 2px;
    transition: width 0.3s ease;
  }
  
  .stage-tabs {
    display: flex;
    justify-content: space-between;
  }
  
  .stage-tab {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 0.5rem;
    opacity: 0.5;
    position: relative;
  }
  
  .stage-tab.active {
    opacity: 1;
  }
  
  .stage-icon {
    font-size: 1.2rem;
    margin-bottom: 0.25rem;
  }
  
  .stage-label {
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  
  .active-indicator {
    position: absolute;
    bottom: -1rem;
    width: 4px;
    height: 4px;
    background: var(--color-primary);
    border-radius: 50%;
  }
</style>

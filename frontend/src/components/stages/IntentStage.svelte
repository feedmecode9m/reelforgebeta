<script>
  // Intent stage logic will go here
  let selectedIntent = '';
</script>

<div class="intent-stage">
  <h2>🎯 Intent Stage</h2>
  <p>What story do you want to tell today?</p>
  <div class="intent-options">
    <button>Storytelling</button>
    <button>Educational</button>
    <button>Entertainment</button>
    <button>Promotional</button>
  </div>
</div>

<style>
  .intent-stage {
    padding: 20px;
  }
  
  .intent-options {
    display: flex;
    gap: 10px;
    margin-top: 20px;
  }
  
  button {
    padding: 10px 20px;
    background: #4f46e5;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
  }
</style>

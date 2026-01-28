<script>
  // Shooter.svelte - Complete AI-Powered ReelForge Ecosystem
  import { onMount, createEventDispatcher } from 'svelte'
  import { slide, fade, fly } from 'svelte/transition'

  const dispatch = createEventDispatcher()

  // ======== CORE STATE ========
  let appMode = 'recording'
  let ecosystemState = 'idle'
  
  // Recording State
  let videoEl = null
  let mediaRecorder = null
  let recordedChunks = []
  let recordedVideoUrl = null
  let isRecording = false
  let countdown = 3
  let sceneState = 'prompt'
  let currentIntent = 'tension'
  let beatDuration = 3
  let ruleSecond = 0
  let rulePhase = 'interrupt'
  let ruleProgress = 0

  // UI State
  let showMoodMenu = false
  let showUploadMenu = false
  let showShareDrawer = false
  let showFileBrowser = false
  let showSocialFeed = false
  let showChallengePanel = false
  let showTrophyCase = false
  let showSmartRecordMenu = false
  let showDockAIInsights = false
  let aiPrompt = ''
  let aiPromptType = 'instruction'
  let aiPromptVisible = false
  let selectedMood = ''
  let selectedFileName = ''
  let selectedFileSize = ''
  let fileInput = null
  let isUploading = false
  let uploadProgress = 0
  let isPlaying = false
  let currentTime = 0
  let duration = 0
  let showPlayerControls = true
  let playerControlsTimeout = null
  let notification = { show: false, title: '', message: '' }

  // AI State
  let aiRecordingAssistant = true
  let currentTake = 1
  let maxTakes = 5
  let recordingHistory = []
  let realTimeAnalysis = false
  let dockAIActive = false
  let aiDockPredictions = []
  let dockVoiceControl = false
  let dockAIContext = {
    efficiencyScore: 75,
    mostUsed: ['record', 'social'],
    preferredTime: 'Morning',
    predictions: []
  }

  // ======== CONSTANTS ========
  const rulePrompts = {
    interrupt: '🚨 0-3s → DROP THE SHOCK',
    hook: '🪝 3-7s → STATE THE STAKES',
    turn: '🔄 7-21s → DELIVER TWIST'
  }

  const smartRecordOptions = [
    { id: 'retake', icon: '🔄', label: 'Retake', action: 'retake', color: '#f59e0b', description: 'Start fresh with same setup' },
    { id: 'erase', icon: '❌', label: 'Erase', action: 'erase', color: '#ef4444', description: 'Clear current recording' },
    { id: 'enhance', icon: '✨', label: 'AI Enhance', action: 'enhance', color: '#8b5cf6', description: 'Get AI suggestions' },
    { id: 'analyze', icon: '📊', label: 'Analyze', action: 'analyze', color: '#06b6d4', description: 'Real-time feedback' },
    { id: 'perfect', icon: '🎯', label: 'Perfect Take', action: 'perfect', color: '#10b981', description: 'AI finds best moments' },
    { id: 'workflow', icon: '⚡', label: 'Smart Flow', action: 'workflow', color: '#f97316', description: 'Optimize recording sequence' }
  ]

  const dockItems = [
    { id: 'record', icon: '🎬', action: 'record', color: 'record', badge: null, ai_feature: 'smart_recording' },
    { id: 'player', icon: '▶️', action: 'player', color: 'player', badge: null, ai_feature: 'intelligent_playback' },
    { id: 'social', icon: '🔥', action: 'social', color: 'social', badge: '3', ai_feature: 'trend_prediction' },
    { id: 'challenges', icon: '🎯', action: 'challenges', color: 'challenges', badge: '1', ai_feature: 'challenge_optimizer' },
    { id: 'trophies', icon: '🏆', action: 'trophies', color: 'trophies', badge: null, ai_feature: 'achievement_analysis' },
    { id: 'ai-assistant', icon: '🧠', action: 'ai_assistant', color: 'ai', badge: 'AI', ai_feature: 'full_ai_mode' }
  ]

  const moodPresets = [
    { id: 'noir', name: 'Noir', color: '#e53e3e', icon: '🌑', filter: 'grayscale(1) contrast(1.4) brightness(0.8)' },
    { id: 'joy', name: 'Joy', color: '#38b2ac', icon: '☀️', filter: 'saturate(1.5) brightness(1.2) hue-rotate(-15deg)' },
    { id: 'dramatic', name: 'Dramatic', color: '#805ad5', icon: '🎭', filter: 'contrast(1.5) saturate(1.3) brightness(0.9)' },
    { id: 'vintage', name: 'Vintage', color: '#dd6b20', icon: '📽️', filter: 'sepia(0.8) contrast(1.2) brightness(1.1)' }
  ]

  const intents = {
    tension: 'Shoot 3s of tension…',
    release: 'Now, release.',
    mystery: 'Add something unexpected.',
    connection: 'Show a moment of connection.'
  }

  // ======== USER DATA ========
  let userStats = {
    streak: 7,
    points: 2450,
    rank: 'Silver Creator',
    trophies: ['🏆 First Reel', '🎬 7-Day Streak', '⭐ Trending Maker'],
    dailyViews: 1247,
    weeklyRank: 23,
    totalReels: 42,
    aiAssists: 15,
    perfectTakes: 3
  }

  let currentVideoStats = {
    views: 0, likes: 0, votes: 0, favorites: 0,
    isLiked: false, isFavorited: false, isVoted: false, aiScore: 0
  }

  let dailyChallenges = [
    {
      id: 1,
      title: 'Silent Story',
      description: 'Tell a story without dialogue',
      reward: 500,
      icon: '🤐',
      completed: false,
      ai_tip: 'Focus on facial expressions and body language'
    },
    {
      id: 2,
      title: 'One-Take Wonder',
      description: 'Film in single continuous shot',
      reward: 750,
      icon: '🎬',
      completed: true,
      ai_tip: 'Plan your movement path carefully'
    },
    {
      id: 3,
      title: 'Twist Master',
      description: 'Create unexpected ending',
      reward: 1000,
      icon: '🔄',
      completed: false,
      ai_tip: 'Subvert viewer expectations in final 3 seconds'
    }
  ]

  let socialFeed = {
    trending: [
      { id: 1, title: 'Midnight Knock', creator: '@noirmaster', views: 15.2, likes: 892, time: '2h ago', ai_tags: ['suspense', 'noir', 'twist'] },
      { id: 2, title: 'Echo Chamber', creator: '@twistqueen', views: 12.8, likes: 654, time: '4h ago', ai_tags: ['psychological', 'mind-bend', 'viral'] },
      { id: 3, title: 'Silent Decision', creator: '@drama_king', views: 9.4, likes: 521, time: '6h ago', ai_tags: ['drama', 'silent', 'emotional'] }
    ],
    friends: [
      { id: 4, title: 'Morning Rush', creator: '@friend1', views: 3.2, likes: 145, time: '1h ago', ai_tags: ['daily', 'relatable', 'comedy'] },
      { id: 5, title: 'Coffee Break', creator: '@friend2', views: 2.8, likes: 98, time: '3h ago', ai_tags: ['lifestyle', 'casual', 'fun'] }
    ]
  }

  // ======== CORE FUNCTIONS ========
  function switchMode(newMode) {
    appMode = newMode
    ecosystemState = 'transitioning'
    setTimeout(() => {
      ecosystemState = newMode === 'player' ? 'viewing' : 'creating'
      if (newMode === 'player') initializePlayerMode()
    }, 300)
  }

  function handleDockAction(action) {
    if (action === 'record') {
      switchMode('recording')
      enableAIRecordingMode()
    } else if (action === 'player') {
      switchMode('player')
      if (recordedVideoUrl) loadVideoForPlayback(recordedVideoUrl)
    } else if (action === 'social') {
      showSocialFeed = true
      analyzeSocialTrends()
    } else if (action === 'challenges') {
      showChallengePanel = true
      optimizeChallenges()
    } else if (action === 'trophies') {
      showTrophyCase = true
      analyzeAchievements()
    } else if (action === 'ai_assistant') {
      toggleAIAssistant()
    }
  }

  // ======== AI RECORDING FUNCTIONS ========
  function enableAIRecordingMode() {
    aiRecordingAssistant = true
    showAIOptions = true
    generateAIRecommendations()
    showNotification('🤖 AI Recording Activated', 'Smart suggestions enabled')
  }

  function handleSmartRecordAction(action) {
    switch (action) {
      case 'retake':
        if (currentTake < maxTakes) {
          currentTake++
          recordingHistory.push({ take: currentTake, timestamp: Date.now(), phase: rulePhase, duration: ruleSecond })
          resetCycle()
          updateAiPrompt(`🔄 Take ${currentTake}/${maxTakes} - Ready for retake`, 'feedback')
          showNotification('Retake Mode', `Take ${currentTake} ready - AI suggestions active`)
        } else {
          updateAiPrompt('📊 Maximum takes reached - AI analyzing best moments', 'feedback')
        }
        break
      case 'erase':
        if (recordedChunks.length > 0) {
          recordedChunks = []
          ruleSecond = 0
          ruleProgress = 0
          sceneState = 'prompt'
          updateAiPrompt('✅ Current recording erased - fresh start', 'feedback')
          showNotification('Recording Cleared', 'Ready for fresh take with AI guidance')
        }
        break
      case 'enhance':
        generateAIEnhancements()
        updateAiPrompt('✨ AI enhancements generated - check suggestions', 'feedback')
        break
      case 'analyze':
        realTimeAnalysis = !realTimeAnalysis
        updateAiPrompt(realTimeAnalysis ? '📊 Real-time analysis activated' : '📊 Real-time analysis deactivated', 'feedback')
        break
      case 'perfect':
        analyzeForPerfectTake()
        break
      case 'workflow':
        generateSmartWorkflow()
        break
    }
    showSmartRecordMenu = false
  }

  function generateAIRecommendations() {
    const recommendations = []
    if (userStats.totalReels < 5) recommendations.push({ type: 'beginner', title: 'Start Simple', description: 'Focus on one strong emotion' })
    if (userStats.streak > 3) recommendations.push({ type: 'streak', title: 'Streak Bonus', description: 'Your consistency is improving - try advanced techniques' })
    return recommendations
  }

  function generateAIEnhancements() {
    return [
      { id: 1, type: 'lighting', title: 'Improve Lighting', description: 'Face the light source for better clarity', impact: 'high' },
      { id: 2, type: 'composition', title: 'Rule of Thirds', description: 'Position yourself slightly off-center', impact: 'medium' },
      { id: 3, type: 'timing', title: 'Perfect Timing', description: 'Start recording 1 second earlier', impact: 'high' }
    ]
  }

  function analyzeForPerfectTake() {
    const perfectMoments = []
    if (ruleSecond > 15) perfectMoments.push({ time: '15s', reason: 'Good buildup detected', score: 85 })
    if (perfectMoments.length > 0) {
      updateAiPrompt(`🎯 Found ${perfectMoments.length} perfect moments!`, 'feedback')
      showNotification('Perfect Take Analysis', 'AI identified your best moments')
    } else {
      updateAiPrompt('🎯 Keep going - AI is learning your style', 'feedback')
    }
  }

  function generateSmartWorkflow() {
    const workflow = { nextAction: 'Focus on hook phase', recommendation: 'Build stronger emotional connection', settings: { beatDuration: 4, mood: 'dramatic', intent: 'connection' } }
    updateAiPrompt(`⚡ Smart workflow: ${workflow.nextAction}`, 'feedback')
    showNotification('Smart Workflow', `AI recommends: ${workflow.recommendation}`)
  }

  // ======== AI DOCK FUNCTIONS ========
  function toggleAIAssistant() {
    dockAIActive = !dockAIActive
    if (dockAIActive) {
      generatePredictiveSuggestions()
      showDockAIInsights = true
      showNotification('🧠 AI Assistant Activated', 'Predictive dock enabled')
    } else {
      showDockAIInsights = false
      showNotification('🧠 AI Assistant Deactivated', 'Manual mode')
    }
  }

  function generatePredictiveSuggestions() {
    const suggestions = []
    const currentHour = new Date().getHours()
    
    if (currentHour >= 6 && currentHour <= 9) suggestions.push({ id: 'morning_boost', title: '🌅 Morning Creator Boost', description: 'Your best content comes in the morning', action: 'morning_workflow', confidence: 85, priority: 'high' })
    if (userStats.streak > 5) suggestions.push({ id: 'streak_momentum', title: '🔥 Streak Momentum', description: 'Keep the streak alive with today\'s challenge', action: 'challenge_priority', confidence: 92, priority: 'high' })
    if (socialFeed.trending.some(reel => reel.ai_tags.includes('suspense'))) suggestions.push({ id: 'trend_opportunity', title: '🎯 Trend Opportunity', description: 'Suspense content is trending +40%', action: 'suggest_suspense', confidence: 78, priority: 'medium' })
    
    aiDockPredictions = suggestions
    dockAIContext.predictions = suggestions
  }

  function analyzeSocialTrends() {
    const trends = socialFeed.trending.filter(reel => reel.ai_tags.includes('twist') || reel.ai_tags.includes('suspense'))
    if (trends.length > 0) {
      aiDockPredictions.push({ id: Date.now(), title: 'Trending: Suspense', description: 'Twist endings are getting 2x engagement', action: 'suggest_intent', data: { intent: 'mystery' }, priority: 'high' })
    }
  }

  function optimizeChallenges() {
    dailyChallenges.forEach(challenge => {
      if (!challenge.completed && challenge.id === 3) {
        aiDockPredictions.push({ id: `challenge_${challenge.id}`, title: 'AI Challenge Tip', description: challenge.ai_tip, action: 'accept_challenge', data: { challenge }, priority: 'high' })
      }
    })
  }

  function analyzeAchievements() {
    if (userStats.aiAssists < 20) {
      aiDockPredictions.push({ id: 'achievement_ai', title: 'AI Mastery', description: `${20 - userStats.aiAssists} more AI assists for trophy`, action: 'promote_ai', priority: 'medium' })
    }
  }

  // ======== RECORDING FUNCTIONS ========
  onMount(() => {
    initCamera()
    resetCycle()
    dispatch('ecosystemReady', { userStats, dailyChallenges })
    
    return () => {
      if (recordedVideoUrl) URL.revokeObjectURL(recordedVideoUrl)
      if (pendingVideoUrl) URL.revokeObjectURL(pendingVideoUrl)
    }
  })

  async function initCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      if (videoEl) {
        videoEl.srcObject = stream
        videoEl.style.transform = 'rotateY(180deg)'
        videoEl.controls = false
      }
    } catch (error) {
      console.error('Camera access error:', error)
      updateAiPrompt('Allow camera access to record', 'feedback')
    }
  }

  function resetCycle() {
    sceneState = 'prompt'
    ruleSecond = 0
    ruleProgress = 0
    currentIntent = 'tension'
    countdown = 3
    isRecording = false
    realTimeAnalysis = false
    updateAiPrompt(rulePrompts.interrupt, 'instruction')
    if (aiRecordingAssistant) generateAIRecommendations()
  }

  function startRecording() {
    if (currentTake > maxTakes) {
      updateAiPrompt('📊 Maximum takes reached - review your best moments', 'feedback')
      return
    }
    
    sceneState = 'recording'
    countdown = 3
    isRecording = true
    recordedChunks = []
    showSmartRecordMenu = false
    
    updateAiPrompt(rulePrompts.interrupt, 'instruction')
    
    startCameraRecording()
    startProgressTracking()
    
    if (realTimeAnalysis) startRealTimeAnalysis()
  }

  async function startCameraRecording() {
    try {
      const stream = videoEl.srcObject
      mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8,opus' })

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordedChunks.push(event.data)
      }

      mediaRecorder.onstop = () => {
        const blob = new Blob(recordedChunks, {type: 'video/webm'})
        recordedVideoUrl = URL.createObjectURL(blob)
        sceneState = 'review'
        
        userStats.totalReels += 1
        userStats.points += 100
        currentVideoStats.aiScore = Math.floor(Math.random() * 30) + 70
        
        updateAiPrompt('✅ 21s complete — AI analyzing your take...', 'feedback')
        
        setTimeout(() => {
          updateAiPrompt('🎬 AI review complete! Check smart options', 'instruction')
          showSmartRecordMenu = true
        }, 2000)
      }

      const countdownInterval = setInterval(() => {
        countdown--
        if (countdown <= 0) {
          clearInterval(countdownInterval)
          mediaRecorder.start()
          setTimeout(() => {
            if (mediaRecorder && mediaRecorder.state === 'recording') {
              mediaRecorder.stop()
              isRecording = false
            }
          }, 21000)
        }
      }, 1000)

    } catch (error) {
      console.error('Recording failed:', error)
      updateAiPrompt('Recording failed - please try again', 'feedback')
      resetCycle()
    }
  }

  function startProgressTracking() {
    ruleSecond = 0
    ruleProgress = 0
    
    const progressInterval = setInterval(() => {
      if (sceneState !== 'recording') {
        clearInterval(progressInterval)
        return
      }
      
      ruleSecond++
      ruleProgress = Math.min((ruleSecond / 21) * 100, 100)
      
      if (ruleSecond <= 3) rulePhase = 'interrupt'
      else if (ruleSecond <= 7) rulePhase = 'hook'
      else rulePhase = 'turn'
      
      updateAiPrompt(rulePrompts[rulePhase], 'instruction')
      
      if (ruleSecond >= 21) clearInterval(progressInterval)
    }, 1000)
  }

  function startRealTimeAnalysis() {
    const analysisInterval = setInterval(() => {
      if (!realTimeAnalysis || sceneState !== 'recording') {
        clearInterval(analysisInterval)
        return
      }
      
      if (ruleSecond === 2) updateAiPrompt('🚨 Great start! Keep the energy high', 'instruction')
      else if (ruleSecond === 6) updateAiPrompt('🪝 Perfect time to reveal the stakes', 'instruction')
      else if (ruleSecond === 15) updateAiPrompt('🔄 Prepare for the twist - make it unexpected!', 'instruction')
    }, 1000)
  }

  // ======== PLAYER FUNCTIONS ========
  function initializePlayerMode() {
    if (videoEl && recordedVideoUrl) {
      videoEl.src = recordedVideoUrl
      videoEl.style.transform = 'none'
      videoEl.controls = false
      duration = 21
      currentVideoStats.views += 1
      userStats.points += 10
      videoEl.play().catch(e => console.log('Auto-play prevented:', e))
    }
  }

  function loadVideoForPlayback(url) {
    if (videoEl) {
      videoEl.src = url
      videoEl.style.transform = 'none'
      videoEl.controls = false
      duration = videoEl.duration || 21
      currentVideoStats.views += 1
      userStats.points += 10
      videoEl.play().catch(e => console.log('Auto-play prevented:', e))
    }
  }

  function handlePlayerAction(action) {
    if (action === 'like') {
      userStats.points += 25
      currentVideoStats.isLiked = !currentVideoStats.isLiked
      currentVideoStats.likes += currentVideoStats.isLiked ? 1 : -1
    } else if (action === 'vote') {
      if (!currentVideoStats.isVoted) {
        userStats.points += 50
        currentVideoStats.isVoted = true
        currentVideoStats.votes += 1
      }
    } else if (action === 'favorite') {
      userStats.points += 75
      currentVideoStats.isFavorited = !currentVideoStats.isFavorited
      currentVideoStats.favorites += currentVideoStats.isFavorited ? 1 : -1
    } else if (action === 'share') {
      userStats.points += 100
      showShareDrawer = true
    }
  }

  // ======== UPLOAD FUNCTIONS ========
  function triggerFileInput() {
    if (fileInput) fileInput.click()
    updateAiPrompt('Choose a video file', 'instruction')
    userStats.points += 10
  }

  function handleFileSelect(event) {
    const file = event.target.files[0]
    if (!file) return
    if (!file.type.startsWith('video/')) {
      updateAiPrompt('Please select a video file', 'feedback')
      return
    }
    
    selectedFileName = file.name
    selectedFileSize = `${(file.size / (1024 * 1024)).toFixed(1)} MB`
    showUploadMenu = true
    pendingVideoUrl = URL.createObjectURL(file)
    updateAiPrompt(`"${file.name}" selected`, 'feedback')
  }

  function commitUpload() {
    isUploading = true
    uploadProgress = 0
    
    const uploadInterval = setInterval(() => {
      uploadProgress += 20
      if (uploadProgress >= 100) {
        clearInterval(uploadInterval)
        setTimeout(() => {
          isUploading = false
          sceneState = 'review'
          showUploadMenu = false
          recordedVideoUrl = pendingVideoUrl
          userStats.points += 100
          updateAiPrompt('Upload complete! +100 points', 'feedback')
          setTimeout(() => showShareDrawer = true, 500)
        }, 500)
      }
    }, 200)
  }

  // ======== HELPER FUNCTIONS ========
  function updateAiPrompt(message, type = 'instruction') {
    aiPrompt = message
    aiPromptType = type
    aiPromptVisible = true
    if (type === 'feedback') setTimeout(() => aiPromptVisible = false, 3000)
  }

  function showNotification(title, message) {
    notification = { show: true, title, message }
    setTimeout(() => notification = { show: false, title: '', message: '' }, 4000)
  }

  // ======== REACTIVE STATEMENTS ========
  $: if (sceneState === 'prompt' && !aiPromptVisible && aiRecordingAssistant) {
    setTimeout(() => updateAiPrompt('🤖 AI Ready: Tap ● to record or hold for options', 'instruction'), 2000)
  }
</script>

<!-- ======== COMPLETE SHOOTER COMPONENT ======== -->
<div class="shooter-container" class:ai-mode={aiRecordingAssistant}>

  <!-- Header -->
  <div class="ecosystem-header">
    <div class="user-stats">
      <div class="stat-item">🔥 {userStats.streak} day streak</div>
      <div class="stat-item">⭐ {userStats.points} points</div>
      <div class="stat-item">🤖 {userStats.aiAssists} AI assists</div>
      <div class="rank-badge">{userStats.rank}</div>
    </div>
    <div class="daily-challenge" on:click={() => showChallengePanel = true}>
      🎯 Daily: {dailyChallenges[0].title}
    </div>
    {#if aiRecordingAssistant}
      <div class="ai-status active">🤖 AI Active</div>
    {/if}
  </div>

  <!-- AI Predictions Panel -->
  {#if aiDockPredictions.length > 0}
    <div class="ai-predictions-panel" transition:slide={{ duration: 300 }}>
      <div class="predictions-header">
        <div class="predictions-title">🤖 AI Predictions</div>
        <button class="predictions-close" on:click={() => aiDockPredictions = []}>✕</button>
      </div>
      <div class="predictions-content">
        {#each aiDockPredictions.slice(0, 2) as prediction}
          <div class="prediction-card" class:high-confidence={prediction.confidence > 85}>
            <div class="prediction-header">
              <span class="prediction-title">{prediction.title}</span>
              <span class="prediction-confidence">{prediction.confidence}%</span>
            </div>
            <div class="prediction-description">{prediction.description}</div>
            <button class="prediction-apply" on:click={() => executePrediction(prediction)}>Apply</button>
          </div>
        {/each}
      </div>
    </div>
  {/if}

  <!-- Mode Container -->
  <div class="mode-container" class:player-active={appMode === 'player'}>
    
    <!-- Recording Mode -->
    <div class="recording-mode">
      <input type="file" accept="video/*" bind:this={fileInput} on:change={handleFileSelect} style="display: none;" />

      <video bind:this={videoEl} autoplay playsinline muted class="video-view" />

      <div class="overlay">
        <!-- Mood Palette -->
        <div class="mood-palette">
          {#each moodPresets as mood}
            <button class="mood-dot" style="background: {mood.color}" on:click={() => selectedMood = mood.id; videoEl.style.filter = mood.filter} title={mood.name}>
              {mood.icon}
            </button>
          {/each}
        </div>

        <!-- Intent Prompt -->
        {#if sceneState === 'prompt'}
          <div class="intent-prompt">
            {intents[currentIntent]}
            {#if aiRecordingAssistant}
              <div class="ai-hint">AI: {getAIHint()}</div>
            {/if}
          </div>
        {/if}

        <!-- AI Guidance -->
        {#if aiPromptVisible}
          <div class="ai-prompt {aiPromptType} visible">
            {aiPrompt}
            {#if aiRecordingAssistant && aiPromptType === 'instruction'}
              <div class="ai-confidence">AI Confidence: {Math.floor(Math.random() * 20) + 80}%</div>
            {/if}
          </div>
        {/if}

        <!-- Countdown -->
        {#if sceneState === 'recording' && countdown > 0}
          <div class="countdown">{countdown}</div>
        {/if}

        <!-- Progress Bar -->
        {#if sceneState === 'recording'}
          <div class="rule-progress">
            <div class="rule-progress-fill" style="width: {ruleProgress}%"></div>
          </div>
        {/if}

        <!-- Smart Record Button -->
        {#if sceneState === 'prompt'}
          <div class="smart-record-container">
            <button class="record-btn {aiRecordingAssistant ? 'ai-enhanced' : ''}" on:click={startRecording} on:contextmenu|preventDefault={() => showSmartRecordMenu = !showSmartRecordMenu} title="Tap to record • Hold for AI options">
              {aiRecordingAssistant ? '🤖' : '●'}
            </button>
            
            {#if showSmartRecordMenu}
              <div class="smart-record-menu" transition:slide={{ duration: 200, axis: 'y' }}>
                <div class="smart-menu-header">
                  <div class="smart-menu-title">🤖 AI Recording Options</div>
                  <button class="smart-menu-close" on:click={() => showSmartRecordMenu = false}>✕</button>
                </div>
                <div class="smart-options-grid">
                  {#each smartRecordOptions as option}
                    <button class="smart-option" style="--option-color: {option.color}" on:click={() => handleSmartRecordAction(option.action)} title={option.description}>
                      <div class="smart-option-icon">{option.icon}</div>
                      <div class="smart-option-label">{option.label}</div>
                      <div class="smart-option-desc">{option.description}</div>
                    </button>
                  {/each}
                </div>
              </div>
            {/if}
          </div>
        {/if}

        <!-- Take Counter -->
        {#if currentTake > 1}
          <div class="take-counter">
            Take {currentTake}/{maxTakes}
            {#if aiRecordingAssistant}
              <div class="take-analysis">{currentTake === 1 ? 'Fresh start' : currentTake < 3 ? 'Building momentum' : currentTake < 5 ? 'Refining craft' : 'Final take'}</div>
            {/if}
          </div>
        {/if}
      </div>

      <!-- File Browser -->
      {#if showFileBrowser}
        <div class="file-browser" transition:slide={{ duration: 300 }}>
          <div class="browser-header">
            <div class="browser-title">📹 Video Library</div>
            <button class="browser-close" on:click={() => showFileBrowser = false}>✕</button>
          </div>
          <div class="browser-content">
            <div class="video-grid">
              {#each ['demo-reel-01.mp4', 'street-scene.mp4', 'sunset-timelapse.mp4'] as videoFile}
                <div class="video-item" on:click={() => selectedFileName = videoFile; selectedFileSize = '12.4 MB'; showFileBrowser = false; showUploadMenu = true}>
                  <div class="video-thumbnail">🎬</div>
                  <div class="video-info">
                    <div class="video-name">{videoFile}</div>
                    <div class="video-meta">
                      <span>{(Math.random() * 20 + 5).toFixed(1)} MB</span>
                      <span>{Math.floor(Math.random() * 30 + 10)}s</span>
                    </div>
                  </div>
                </div>
              {/each}
            </div>
            <button class="browse-all-btn" on:click={triggerFileInput}>📁 Browse All Videos</button>
          </div>
        </div>
      {/if}

      <!-- Upload Interface -->
      {#if showUploadMenu}
        <div class="upload-interface" transition:slide={{ duration: 300 }}>
          <div class="upload-dropzone" on:click={triggerFileInput} role="button" tabindex="0">
            <div style="font-size: 4rem; margin-bottom: 1rem;">📹</div>
            <div style="font-size: 1.5rem; font-weight: 700; margin-bottom: 0.5rem;">{selectedFileName || 'Drop video here'}</div>
            <div style="color: #a0aec0; font-size: 1rem;">{selectedFileSize || 'or click to browse'}</div>
            
            {#if isUploading}
              <div style="margin-top: 2rem; width: 80%;">
                <div style="background: rgba(255,255,255,0.2); height: 8px; border-radius: 4px; overflow: hidden;">
                  <div style="background: #38b2ac; height: 100%; width: {uploadProgress}%; transition: width 0.2s;"></div>
                </div>
                <div style="text-align: center; margin-top: 1rem; color: #38b2ac; font-weight: 600;">Uploading... {uploadProgress}%</div>
              </div>
            {/if}
          </div>
          
          <div class="upload-actions">
            <button class="upload-action-btn secondary" on:click={() => showUploadMenu = false}>Cancel</button>
            <button class="upload-action-btn primary" on:click={commitUpload} disabled={isUploading}>{isUploading ? 'Uploading...' : 'Upload Video'}</button>
          </div>
        </div>
      {/if}

      <!-- Share Drawer -->
      {#if showShareDrawer}
        <div class="share-drawer" class:open={showShareDrawer} transition:slide={{ duration: 300, axis: 'x' }}>
          <div class="drawer-header">
            <div class="drawer-title">📤 Share Your Story</div>
            <button class="drawer-close" on:click={() => showShareDrawer = false}>✕</button>
          </div>
          <div class="drawer-content">
            <div style="color: white; margin-bottom: 2rem;">
              <h3 style="margin-bottom: 1rem;">Your 21-second story is ready!</h3>
              <p style="color: #a0aec0; line-height: 1.6;">Share your cinematic moment with the world. Every frame tells a story.</p>
            </div>
            <div class="share-options">
              <button class="share-option">📱 Save to Device</button>
              <button class="share-option">🌐 Share to Web</button>
              <button class="share-option">📋 Copy Link</button>
              <button class="share-option">🎬 Add to Reel</button>
              <button class="share-option">📸 Export as GIF</button>
            </div>
          </div>
        </div>
      {/if}
    </div>

    <!-- Player Mode -->
    <div class="player-mode">
      <div class="player-integrated">
        <video bind:this={videoEl} class="player-video" on:loadedmetadata={() => duration = videoEl.duration} on:timeupdate={() => currentTime = videoEl.currentTime} on:play={() => isPlaying = true} on:pause={() => isPlaying = false} />

        <div class="player-controls-overlay" class:visible={showPlayerControls}>
          <div class="player-top-bar">
            <div class="video-stats">
              <button class="stat-button" class:active={currentVideoStats.isLiked} on:click={() => handlePlayerAction('like')}>❤️ {currentVideoStats.likes}</button>
              <button class="stat-button" class:active={currentVideoStats.isVoted} on:click={() => handlePlayerAction('vote')}>🗳️ {currentVideoStats.votes}</button>
              <button class="stat-button" class:active={currentVideoStats.isFavorited} on:click={() => handlePlayerAction('favorite')}>⭐ {currentVideoStats.favorites}</button>
              <button class="stat-button ai-score">🤖 {currentVideoStats.aiScore}%</button>
              <button class="stat-button" on:click={() => handlePlayerAction('share')}>📤 Share</button>
            </div>
            <button class="back-to-record" on:click={() => switchMode('recording')}>🎬 Back to Create</button>
          </div>

          <div class="player-bottom-bar">
            <div class="player-progress" on:click|stopPropagation={(e) => { const rect = e.currentTarget.getBoundingClientRect(); const percent = (e.clientX - rect.left) / rect.width; if (videoEl) videoEl.currentTime = percent * duration; }}>
              <div class="player-progress-fill" style="width: {(currentTime / duration) * 100}%"></div>
              {#if currentVideoStats.aiScore > 0}
                <div class="ai-score-indicator" style="left: {currentVideoStats.aiScore}%">🤖</div>
              {/if}
            </div>
            <div class="player-controls">
              <button class="player-control-btn" on:click={() => videoEl && (videoEl.currentTime = Math.max(0, currentTime - 10))}>⏪</button>
              <button class="player-control-btn play-pause-btn" on:click={() => videoEl && (isPlaying ? videoEl.pause() : videoEl.play())}>{isPlaying ? '⏸️' : '▶️'}</button>
              <button class="player-control-btn" on:click={() => videoEl && (videoEl.currentTime = Math.min(duration, currentTime + 10))}>⏩</button>
              {#if aiRecordingAssistant}
                <button class="player-control-btn ai-analyze" on:click={() => currentVideoStats.aiScore = Math.floor(Math.random() * 30) + 70}>🤖</button>
              {/if}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- AI-Powered Smart Dock -->
  <div class="smart-dock ai-enhanced">
    {#each dockItems as item}
      <button 
        class="dock-item {item.color}" 
        class:active={appMode === item.action}
        class:ai-recommended={aiDockPredictions.some(p => p.action.includes(item.action))}
        on:click={() => handleDockAction(item.action)}
        title={`${item.id} • ${item.ai_feature.replace('_', ' ')}`}
      >
        {item.icon}
        {#if item.badge}
          <span class="dock-badge">{item.badge}</span>
        {/if}
        {#if aiDockPredictions.some(p => p.action.includes(item.action))}
          <div class="ai-prediction-pulse"></div>
        {/if}
      </button>
    {/each}}
    
    {#if dockAIActive}
      <button class="dock-item ai-quick-access" on:click={() => showDockAIInsights = !showDockAIInsights}>
        🧠
        <span class="ai-brain-badge">AI</span>
        {#if aiDockPredictions.length > 0}
          <div class="ai-active-pulse"></div>
        {/if}
      </button>
    {/if}
  </div>

  <!-- Social Feed -->
  {#if showSocialFeed}
    <div class="social-feed-overlay" transition:fade={{ duration: 300 }}>
      <div class="social-header">
        <div class="social-title">🔥 Trending & Friends</div>
        <button class="close-social" on:click={() => showSocialFeed = false}>✕</button>
      </div>
      <div class="social-content">
        <div class="trending-section">
          <div class="section-title">🔥 Trending Now</div>
          {#each socialFeed.trending as reel}
            <div class="reel-card" on:click={() => loadAndPlayReel(reel)}>
              <div class="reel-header">
                <span class="reel-creator">{reel.creator}</span>
                <span class="reel-time">{reel.time}</span>
              </div>
              <div class="reel-title">{reel.title}</div>
              <div class="reel-stats">
                <span class="reel-stat">👁️ {reel.views}k</span>
                <span class="reel-stat">❤️ {reel.likes}</span>
                <span class="reel-ai-tags">🤖 {reel.ai_tags.join(', ')}</span>
              </div>
            </div>
          {/each}
        </div>
        <div class="friends-section">
          <div class="section-title">👥 Friends</div>
          {#each socialFeed.friends as reel}
            <div class="reel-card" on:click={() => loadAndPlayReel(reel)}>
              <div class="reel-header">
                <span class="reel-creator">{reel.creator}</span>
                <span class="reel-time">{reel.time}</span>
              </div>
              <div class="reel-title">{reel.title}</div>
              <div class="reel-stats">
                <span class="reel-stat">👁️ {reel.views}k</span>
                <span class="reel-stat">❤️ {reel.likes}</span>
              </div>
            </div>
          {/each}
        </div>
      </div>
    </div>
  {/if}

  <!-- Challenge Panel -->
  {#if showChallengePanel}
    <div class="challenge-panel" transition:fade={{ duration: 300 }}>
      <div class="challenge-header">
        <div class="challenge-title">🎯 Daily Challenges</div>
        <button class="challenge-panel-close" on:click={() => showChallengePanel = false}>✕</button>
      </div>
      <div class="challenge-content">
        {#each dailyChallenges as challenge}
          <div class="challenge-card" class:completed={challenge.completed}>
            <div class="challenge-header-info">
              <span class="challenge-icon">{challenge.icon}</span>
              <span class="challenge-reward">+{challenge.reward} pts</span>
            </div>
            <div class="challenge-name">{challenge.title}</div>
            <div class="challenge-description">{challenge.description}</div>
            {#if challenge.ai_tip}
              <div class="challenge-ai-tip">💡 AI Tip: {challenge.ai_tip}</div>
            {/if}
            <div class="challenge-actions">
              {#if challenge.completed}
                <button class="challenge-btn secondary" disabled>✅ Completed</button>
              {:else}
                <button class="challenge-btn primary" on:click={() => showChallengePanel = false; showNotification('🎯 Challenge Accepted!', `Complete: ${challenge.title} for +${challenge.reward} points`)}>Accept Challenge</button>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/if}

  <!-- Trophy Case -->
  {#if showTrophyCase}
    <div class="trophy-case" transition:fade={{ duration: 300 }}>
      <div class="trophy-header">
        <div class="trophy-title">🏆 Trophy Case</div>
        <button class="trophy-case-close" on:click={() => showTrophyCase = false}>✕</button>
      </div>
      <div class="trophy-content">
        <div class="stats-overview">
          <div class="stat-card">
            <div class="stat-value">{userStats.points}</div>
            <div class="stat-label">Total Points</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">{userStats.streak}</div>
            <div class="stat-label">Day Streak</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">{userStats.totalReels}</div>
            <div class="stat-label">Reels Created</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">{userStats.perfectTakes}</div>
            <div class="stat-label">Perfect Takes</div>
          </div>
        </div>

        <div class="trophies-grid">
          {#each userStats.trophies as trophy}
            <div class="trophy-item">
              <div class="trophy-emoji">{trophy}</div>
              <div class="trophy-name">{trophy.replace(/[^a-zA-Z\s]/g, '').trim()}</div>
            </div>
          {/each}
        </div>

        <div class="rank-progress">
          <div class="rank-info">
            <span>Current Rank: {userStats.rank}</span>
            <span>Next Rank: {userStats.points >= 5000 ? 'Max Rank' : userStats.points >= 2500 ? 'Gold Creator' : userStats.points >= 1000 ? 'Silver Creator' : 'Bronze Creator'}</span>
          </div>
          <div class="rank-bar">
            <div class="rank-fill" style="width: {Math.min((userStats.points / 5000) * 100, 100)}%"></div>
          </div>
          <div class="rank-points">{userStats.points} / 5000 points to next rank</div>
        </div>
      </div>
    </div>
  {/if}

  <!-- AI Dock Insights Panel -->
  {#if showDockAIInsights && dockAIActive}
    <div class="dock-ai-insights-panel" transition:slide={{ duration: 300, axis: 'y' }}>
      <div class="insights-header">
        <div class="insights-title">🧠 AI Dock Insights</div>
        <button class="insights-close" on:click={() => showDockAIInsights = false}>✕</button>
      </div>
      <div class="insights-content">
        <div class="efficiency-score">
          <div class="score-label">Dock Efficiency</div>
          <div class="score-value">{dockAIContext.efficiencyScore}%</div>
          <div class="score-bar">
            <div class="score-fill" style="width: {dockAIContext.efficiencyScore}%"></div>
          </div>
        </div>
        
        <div class="ai-predictions-section">
          <div class="predictions-title">🤖 AI Predictions</div>
          {#each aiDockPredictions.slice(0, 3) as prediction}
            <div class="prediction-item" class:high-confidence={prediction.confidence > 85}>
              <div class="prediction-header">
                <span class="prediction-title">{prediction.title}</span>
                <span class="prediction-confidence">{prediction.confidence}%</span>
              </div>
              <div class="prediction-description">{prediction.description}</div>
              <button class="prediction-action" on:click={() => executePrediction(prediction)}>Apply</button>
            </div>
          {/each}
        </div>
        
        <div class="usage-patterns">
          <div class="patterns-title">📊 Your Patterns</div>
          <div class="pattern-item"><span>Most used: {dockAIContext.mostUsed?.join(', ') || 'Learning...'}</span></div>
          <div class="pattern-item"><span>Peak time: {dockAIContext.preferredTime || 'Analyzing...'}</span></div>
        </div>
      </div>
    </div>
  {/if}

  <!-- Notification System -->
  {#if notification.show}
    <div class="notification" transition:slide={{ duration: 200 }}>
      <div class="notification-title">{notification.title}</div>
      <div class="notification-message">{notification.message}</div>
    </div>
  {/if}
</div>

<style>
  /* ======== COMPLETE SHOOTER STYLES ======== */
  .shooter-container {
    position: relative;
    width: 100%;
    height: 100vh;
    background: #000;
    color: white;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    overflow: hidden;
  }

  .shooter-container.ai-mode {
    --ai-glow: 0 0 20px rgba(139, 92, 246, 0.3);
  }

  /* Header */
  .ecosystem-header {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    z-index: 100;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem;
    background: linear-gradient(to bottom, rgba(0,0,0,0.9), transparent);
  }

  .user-stats {
    display: flex;
    gap: 1rem;
    align-items: center;
  }

  .stat-item {
    background: rgba(255,255,255,0.1);
    padding: 0.5rem 1rem;
    border-radius: 20px;
    font-size: 0.9rem;
    font-weight: 600;
  }

  .rank-badge {
    background: linear-gradient(45deg, #805ad5, #38b2ac);
    padding: 0.5rem 1rem;
    border-radius: 20px;
    font-size: 0.9rem;
    font-weight: 700;
  }

  .daily-challenge {
    background: rgba(56, 178, 172, 0.2);
    border: 1px solid #38b2ac;
    padding: 0.5rem 1rem;
    border-radius: 20px;
    font-size: 0.9rem;
    cursor: pointer;
    transition: all 0.2s;
  }

  .daily-challenge:hover {
    background: rgba(56, 178, 172, 0.3);
  }

  .ai-status {
    background: linear-gradient(45deg, #8b5cf6, #06b6d4);
    padding: 0.5rem 1rem;
    border-radius: 20px;
    font-size: 0.9rem;
    font-weight: 600;
    animation: ai-pulse 2s infinite;
  }

  .ai-status.active {
    box-shadow: var(--ai-glow);
  }

  @keyframes ai-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.7; }
  }

  /* AI Predictions Panel */
  .ai-predictions-panel {
    position: absolute;
    top: 80px;
    right: 20px;
    width: 350px;
    background: rgba(0,0,0,0.95);
    backdrop-filter: blur(20px);
    border-radius: 15px;
    border: 1px solid rgba(139, 92, 246, 0.3);
    z-index: 500;
    box-shadow: var(--ai-glow);
  }

  .predictions-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem;
    border-bottom: 1px solid rgba(255,255,255,0.1);
  }

  .predictions-title {
    font-size: 1.1rem;
    font-weight: 700;
    color: #8b5cf6;
  }

  .predictions-close {
    background: none;
    border: none;
    color: white;
    font-size: 1.2rem;
    cursor: pointer;
    padding: 0.5rem;
  }

  .predictions-content {
    padding: 1rem;
    max-height: 400px;
    overflow-y: auto;
  }

  .prediction-card {
    background: rgba(255,255,255,0.05);
    border-radius: 10px;
    padding: 1rem;
    margin-bottom: 0.8rem;
    border-left: 3px solid #6b7280;
  }

  .prediction-card.high-confidence {
    border-left-color: #10b981;
    background: rgba(16, 185, 129, 0.1);
  }

  .prediction-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.5rem;
  }

  .prediction-title {
    font-weight: 600;
    color: #f3f4f6;
  }

  .prediction-confidence {
    font-size: 0.8rem;
    color: #10b981;
    font-weight: 600;
  }

  .prediction-description {
    color: #d1d5db;
    font-size: 0.9rem;
    margin-bottom: 0.8rem;
  }

  .prediction-apply {
    width: 100%;
    padding: 0.5rem;
    background: linear-gradient(45deg, #8b5cf6, #06b6d4);
    border: none;
    border-radius: 8px;
    color: white;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }

  .prediction-apply:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(139, 92, 246, 0.3);
  }

  /* Mode Container */
  .mode-container {
    position: relative;
    width: 100%;
    height: 100%;
  }

  .mode-container.player-active .recording-mode {
    display: none;
  }

  .recording-mode {
    position: relative;
    width: 100%;
    height: 100%;
  }

  .player-mode {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    display: none;
  }

  .mode-container.player-active .player-mode {
    display: block;
  }

  /* Recording Mode Styles */
  .video-view {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    background: #000;
  }

  .overlay {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .overlay > * {
    pointer-events: auto;
  }

  .mood-palette {
    position: absolute;
    top: 80px;
    right: 20px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .mood-dot {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    border: 2px solid rgba(255,255,255,0.3);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.2rem;
    cursor: pointer;
    transition: all 0.2s;
  }

  .mood-dot:hover {
    transform: scale(1.1);
    border-color: white;
  }

  .intent-prompt {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-size: 1.5rem;
    font-weight: 600;
    text-align: center;
    background: rgba(0,0,0,0.7);
    padding: 1rem 2rem;
    border-radius: 10px;
    backdrop-filter: blur(10px);
  }

  .ai-hint {
    font-size: 0.9rem;
    color: #c4b5fd;
    margin-top: 0.5rem;
    font-weight: 500;
  }

  .ai-prompt {
    position: absolute;
    bottom: 120px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(0,0,0,0.8);
    padding: 0.8rem 1.5rem;
    border-radius: 25px;
    font-size: 1rem;
    font-weight: 500;
    text-align: center;
    backdrop-filter: blur(10px);
    transition: all 0.3s;
    opacity: 0;
    visibility: hidden;
  }

  .ai-prompt.visible {
    opacity: 1;
    visibility: visible;
  }

  .ai-prompt.feedback {
    background: rgba(56, 178, 172, 0.8);
  }

  .ai-confidence {
    font-size: 0.8rem;
    color: #c4b5fd;
    margin-top: 0.5rem;
    opacity: 0.9;
  }

  .countdown {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-size: 4rem;
    font-weight: 700;
    color: #38b2ac;
    text-shadow: 0 0 20px rgba(56, 178, 172, 0.5);
  }

  .rule-progress {
    position: absolute;
    bottom: 100px;
    left: 50%;
    transform: translateX(-50%);
    width: 80%;
    max-width: 400px;
    height: 6px;
    background: rgba(255,255,255,0.2);
    border-radius: ics: 3px;
    overflow: hidden;
  }

  .rule-progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #e53e3e 0%, #38b2ac 33%, #805ad5 66%);
    width: var(--progress, 0%);
    transition: width 0.1s;
    border-radius: 3px;
  }

  .smart-record-container {
    position: absolute;
    bottom: 40px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 200;
  }

  .record-btn {
    position: absolute;
    bottom: 40px;
    left: 50%;
    transform: translateX(-50%);
    width: 70px;
    height: 70px;
    border-radius: 50%;
    background: #e53e3e;
    border: 4px solid white;
    font-size: 2rem;
    color: white;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .record-btn:hover {
    transform: translateX(-50%) scale(1.1);
  }

  .record-btn:active {
    transform: translateX(-50%) scale(0.95);
  }

  .record-btn.ai-enhanced {
    background: linear-gradient(45deg, #8b5cf6, #06b6d4);
    box-shadow: 0 0 20px rgba(139, 92, 246, 0.3);
    animation: ai-record-pulse 3s infinite;
  }

  @keyframes ai-record-pulse {
    0%, 100% { 
      box-shadow: 0 0 20px rgba(139, 92, 246, 0.3);
      transform: translateX(-50%) scale(1);
    }
    50% { 
      box-shadow: 0 0 30px rgba(139, 92, 246, 0.6);
      transform: translateX(-50%) scale(1.05);
    }
  }

  .smart-record-menu {
    position: absolute;
    bottom: 90px;
    left: 50%;
    transform: translateX(-50%);
    width: 320px;
    background: rgba(0,0,0,0.95);
    backdrop-filter: blur(20px);
    border-radius: 20px;
    border: 1px solid rgba(139, 92, 246, 0.3);
    box-shadow: var(--ai-glow);
    z-index: 300;
  }

  .smart-menu-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem;
    border-bottom: 1px solid rgba(255,255,255,0.1);
  }

  .smart-menu-title {
    font-size: 1.1rem;
    font-weight: 700;
    color: #8b5cf6;
  }

  .smart-menu-close {
    background: none;
    border: none;
    color: white;
    font-size: 1.2rem;
    cursor: pointer;
    padding: 0.5rem;
  }

  .smart-options-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0.8rem;
    padding: 1rem;
  }

  .smart-option {
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 12px;
    padding: 1rem;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
  }

  .smart-option:hover {
    background: rgba(var(--option-color), 0.1);
    border-color: var(--option-color);
    transform: translateY(-2px);
  }

  .smart-option-icon {
    font-size: 1.5rem;
    margin-bottom: 0.5rem;
  }

  .smart-option-label {
    font-size: 0.9rem;
    font-weight: 600;
    margin-bottom: 0.3rem;
  }

  .smart-option-desc {
    font-size: 0.7rem;
    color: #9ca3af;
    line-height: 1.2;
  }

  .take-counter {
    position: absolute;
    top: 120px;
    right: 20px;
    background: rgba(0,0,0,0.8);
    padding: 1rem;
    border-radius: 15px;
    backdrop-filter: blur(10px);
    border: 1px solid rgba(139, 92, 246, 0.3);
  }

  .take-analysis {
    font-size: 0.8rem;
    color: #c4b5fd;
    margin-top: 0.5rem;
  }

  /* File Browser */
  .file-browser {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0,0,0,0.95);
    backdrop-filter: blur(20px);
    z-index: 200;
  }

  .browser-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1.5rem;
    border-bottom: 1px solid rgba(255,255,255,0.1);
  }

  .browser-title {
    font-size: 1.5rem;
    font-weight: 700;
  }

  .browser-close {
    background: none;
    border: none;
    color: white;
    font-size: 1.5rem;
    cursor: pointer;
    padding: 0.5rem;
  }

  .browser-content {
    padding: 1.5rem;
    height: calc(100% - 80px);
    overflow-y: auto;
  }

  .video-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 1rem;
    margin-bottom: 2rem;
  }

  .video-item {
    background: rgba(255,255,255,0.05);
    border-radius: 10px;
    padding: 1rem;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    gap: 1rem;
    align-items: center;
  }

  .video-item:hover {
    background: rgba(255,255,255,0.1);
  }

  .video-thumbnail {
    font-size: 2rem;
    width: 60px;
    height: 60px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(56, 178, 172, 0.2);
    border-radius: 10px;
  }

  .video-info {
    flex: 1;
  }

  .video-name {
    font-weight: 600;
    margin-bottom: 0.5rem;
  }

  .video-meta {
    display: flex;
    gap: 1rem;
    font-size: 0.9rem;
    color: #a0aec0;
  }

  .browse-all-btn {
    width: 100%;
    padding: 1rem;
    background: rgba(56, 178, 172, 0.2);
    border: 1px solid #38b2ac;
    color: white;
    border-radius: 10px;
    font-size: 1rem;
    cursor: pointer;
    transition: all 0.2s;
  }

  .browse-all-btn:hover {
    background: rgba(56, 178, 172, 0.3);
  }

  /* Upload Interface */
  .upload-interface {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0,0,0,0.95);
    backdrop-filter: blur(20px);
    z-index: 200;
    display: flex;
    flex-direction: column;
  }

  .upload-dropzone {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    border: 2px dashed rgba(255,255,255,0.3);
    border-radius: 20px;
    margin: 1.5rem;
    cursor: pointer;
    transition: all 0.2s;
  }

  .upload-dropzone:hover {
    border-color: #38b2ac;
    background: rgba(56, 178, 172, 0.05);
  }

  .upload-actions {
    display: flex;
    gap: 1rem;
    padding: 1.5rem;
    border-top: 1px solid rgba(255,255,255,0.1);
  }

  .upload-action-btn {
    flex: 1;
    padding: 1rem;
    border: none;
    border-radius: 10px;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }

  .upload-action-btn.primary {
    background: #38b2ac;
    color: white;
  }

  .upload-action-btn.primary:hover:not(:disabled) {
    background: #2c7a7b;
  }

  .upload-action-btn.secondary {
    background: rgba(255,255,255,0.1);
    color: white;
  }

  .upload-action-btn.secondary:hover {
    background: rgba(255,255,255,0.2);
  }

  .upload-action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Share Drawer */
  .share-drawer {
    position: absolute;
    top: 0;
    right: -100%;
    width: 100%;
    max-width: 
400px;
    height: 100%;
    background: rgba(0,0,0,0.95);
    backdrop-filter: blur(20px);
    z-index: 300;
    transition: right 0.3s;
  }

  .share-drawer.open {
    right: 0;
  }

  .drawer-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1.5rem;
    border-bottom: 1px solid rgba(255,255,255,0.1);
  }

  .drawer-title {
    font-size: 1.5rem;
    font-weight: 700;
  }

  .drawer-close {
    background: none;
    border: none;
    color: white;
    font-size: 1.5rem;
    cursor: pointer;
    padding: 0.5rem;
  }

  .drawer-content {
    padding: 1.5rem;
  }

  .share-options {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .share-option {
    padding: 1rem;
    background: rgba(255,255,255,0.1);
    border: 1px solid rgba(255,255,255,0.2);
    color: white;
    border-radius: 10px;
    font-size: 1rem;
    cursor: pointer;
    transition: all 0.2s;
    text-align: left;
  }

  .share-option:hover {
    background: rgba(255,255,255,0.15);
    border-color: #38b2ac;
  }

  /* Player Mode Styles */
  .player-integrated {
    position: relative;
    width: 100%;
    height: 100%;
    background: #000;
  }

  .player-video {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .player-controls-overlay {
    position: absolute;
    inset: 0;
    background: linear-gradient(to bottom, rgba(0,0,0,0.5) 0%, transparent 20%, transparent 80%, rgba(0,0,0,0.5) 100%);
    opacity: 0;
    visibility: hidden;
    transition: all 0.3s;
  }

  .player-controls-overlay.visible {
    opacity: 1;
    visibility: visible;
  }

  .player-top-bar {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1.5rem;
  }

  .video-stats {
    display: flex;
    gap: 1rem;
  }

  .stat-button {
    background: rgba(255,255,255,0.1);
    border: 1px solid rgba(255,255,255,0.2);
    color: white;
    padding: 0.5rem 1rem;
    border-radius: 20px;
    font-size: 0.9rem;
    cursor: pointer;
    transition: all 0.2s;
  }

  .stat-button:hover {
    background: rgba(255,255,255,0.2);
  }

  .stat-button.active {
    background: rgba(56, 178, 172, 0.3);
    border-color: #38b2ac;
  }

  .ai-score {
    background: rgba(139, 92, 246, 0.3) !important;
    border-color: #8b5cf6 !important;
  }

  .back-to-record {
    background: rgba(56, 178, 172, 0.2);
    border: 1px solid #38b2ac;
    color: white;
    padding: 0.5rem 1rem;
    border-radius: 20px;
    font-size: 0.9rem;
    cursor: pointer;
    transition: all 0.2s;
  }

  .back-to-record:hover {
    background: rgba(56, 178, 172, 0.3);
  }

  .player-bottom-bar {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    padding: 1.5rem;
  }

  .player-progress {
    height: 4px;
    background: rgba(255,255,255,0.2);
    border-radius: 2px;
    margin-bottom: 1rem;
    cursor: pointer;
  }

  .player-progress-fill {
    height: 100%;
    background: #38b2ac;
    border-radius: 2px;
    transition: width 0.1s;
  }

  .ai-score-indicator {
    position: absolute;
    top: -8px;
    transform: translateX(-50%);
    background: #8b5cf6;
    color: white;
    padding: 0.2rem 0.5rem;
    border-radius: 10px;
    font-size: 0.8rem;
    font-weight: 600;
  }

  .player-controls {
    display: flex;
    justify-content: center;
    gap: 1rem;
  }

  .player-control-btn {
    width: 50px;
    height: 50px;
    border-radius: 50%;
    background: rgba(255,255,255,0.1);
    border: 1px solid rgba(255,255,255,0.2);
    color: white;
    font-size: 1.2rem;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .player-control-btn:hover {
    background: rgba(255,255,255,0.2);
  }

  .play-pause-btn {
    width: 60px;
    height: 60px;
    font-size: 1.5rem;
  }

  .player-control-btn.ai-analyze {
    background: rgba(139, 92, 246, 0.3) !important;
    border-color: #8b5cf6 !important;
  }

  /* Smart Dock */
  .smart-dock.ai-enhanced {
    position: absolute;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    gap: 1rem;
    background: linear-gradient(135deg, rgba(0,0,0,0.9), rgba(139, 92, 246, 0.1));
    backdrop-filter: blur(20px);
    padding: 1rem;
    border-radius: 50px;
    border: 1px solid rgba(139, 92, 246, 0.3);
    box-shadow: var(--ai-glow);
  }

  .dock-item {
    width: 50px;
    height: 50px;
    border-radius: 50%;
    background: rgba(255,255,255,0.1);
    border: 1px solid rgba(255,255,255,0.2);
    color: white;
    font-size: 1.2rem;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
  }

  .dock-item:hover {
    transform: scale(1.1);
  }

  .dock-item.active {
    background: rgba(56, 178, 172, 0.3);
    border-color: #38b2ac;
  }

  .dock-item.record {
    background: rgba(229, 62, 62, 0.3);
    border-color: #e53e3e;
  }

  .dock-item.player {
    background: rgba(56, 178, 172, 0.3);
    border-color: #38b2ac;
  }

  .dock-item.social {
    background: rgba(221, 107, 32, 0.3);
    border-color: #dd6b20;
  }

  .dock-item.challenges {
    background: rgba(128, 90, 213, 0.3);
    border-color: #805ad5;
  }

  .dock-item.trophies {
    background: rgba(128, 90, 213, 0.3);
    border-color: #805ad5;
  }

  .dock-item.ai-assistant {
    background: linear-gradient(45deg, #8b5cf6, #06b6d4) !important;
    animation: ai-quick-pulse 2s infinite;
  }

  .dock-badge {
    position: absolute;
    top: -5px;
    right: -5px;
    background: #e53e3e;
    color: white;
    font-size: 0.7rem;
    font-weight: 700;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .ai-prediction-pulse {
    position: absolute;
    top: -5px;
    right: -5px;
    width: 10px;
    height: 10px;
    background: #f59e0b;
    border-radius: 50%;
    animation: ai-prediction-beat 1.5s infinite;
  }

  @keyframes ai-prediction-beat {
    0%, 100% { 
      transform: scale(1);
      opacity: 1;
    }
    50% { 
      transform: scale(1.3);
      opacity: 0.7;
    }
  }

  .ai-quick-access {
    background: linear-gradient(45deg, #8b5cf6, #06b6d4) !important;
    animation: ai-quick-pulse 2s infinite;
  }

  .ai-brain-badge {
    position: absolute;
    top: -8px;
    right: -8px;
    background: #8b5cf6;
    color: white;
    font-size: 0.6rem;
    font-weight: 700;
    padding: 0.2rem 0.4rem;
    border-radius: 10px;
    box-shadow: 0 2px 8px rgba(139, 92, 246, 0.4);
  }

  .ai-active-pulse {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 20px;
    height: 20px;
    background: rgba(139, 92, 246, 0.3);
    border-radius: 50%;
    transform: translate(-50%, -50%);
    animation: ai-active-expand 2s infinite;
  }

  @keyframes ai-quick-pulse {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.1); }
  }

  @keyframes ai-active-expand {
    0% { 
      width: 20px;
      height: 20px;
      opacity: 1;
    }
    100% { 
      width: 40px;
      height: 40px;
      opacity: 0;
    }
  }

  /* Social Feed */
  .social-feed-overlay {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0,0,0,0.95);
    backdrop-filter: blur(20px);
    z-index: 400;
  }

  .social-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1.5rem;
    border-bottom: 1px solid rgba(255,255,255,0.1);
  }

  .social-title {
    font-size: 1.5rem;
    font-weight: 700;
  }

  .close-social {
    background: none;
    border: none;
    color: white;
    font-size: 1.5rem;
    cursor: pointer;
    padding: 0.5rem;
  }

  .social-content {
    padding: 1.5rem;
    height: calc(100% - 80px);
    overflow-y: auto;
  }

  .section-title {
    font-size: 1.2rem;
    font-weight: 600;
    margin-bottom: 1rem;
    color: #38b2ac;
  }

  .reel-card {
    background: rgba(255,255,255,0.05);
    border-radius: 10px;
    padding: 1rem;
    margin-bottom: 1rem;
    cursor: pointer;
    transition: all 0.2s;
  }

  .reel-card:hover {
    background: rgba(255,255,255,0.1);
  }

  .reel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.5rem;
  }

  .reel-creator {
    font-weight: 600;
    color: #38b2ac;
  }

  .reel-time {
    font-size: 0.9rem;
    color: #a0aec0;
  }

  .reel-title {
    font-size: 1.1rem;
    font-weight: 600;
    margin-bottom: 0.5rem;
  }

  .reel-stats {
    display: flex;
    gap: 1rem;
    font-size: 0.9rem;
    color: #a0aec0;
  }

  .reel-ai-tags {
    font-size: 0.8rem;
    color: #8b5cf6;
  }

  /* Challenge Panel */
  .challenge-panel {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0,0,0,0.95);
    backdrop-filter: blur(20px);
    z-index: 400;
  }

  .challenge-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1.5rem;
    border-bottom: 1px solid rgba(255,255,255,0.1);
  }

  .challenge-title {
    font-size: 1.5rem;
    font-weight: 700;
  }

  .challenge-panel-close {
    background: none;
    border: none;
    color: white;
    font-size: 1.5rem;
    cursor: pointer;
    padding: 0.5rem;
  }

  .challenge-content {
    padding: 1.5rem;
    height: calc(100% - 80px);
    overflow-y: auto;
  }

  .challenge-card {
    background: rgba(255,255,255,0.05);
    border-radius: 10px;
    padding: 1.5rem;
    margin-bottom: 1rem;
    transition: all 0.2s;
  }

  .challenge-card.completed {
    opacity: 0.6;
  }

  .challenge-header-info {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.5rem;
  }

  .challenge-icon {
    font-size: 1.5rem;
  }

  .challenge-reward {
    color: #38b2ac;
    font-weight: 600;
  }

  .challenge-name {
    font-size: 1.2rem;
    font-weight: 600;
    margin-bottom: 0.5rem;
  }

  .challenge-description {
    color: #a0aec0;
    margin-bottom: 1rem;
  }

  .challenge-ai-tip {
    color: #c4b5fd;
    font-size: 0.9rem;
    margin-bottom: 1rem;
    font-style: italic;
  }

  .challenge-actions {
    display: flex;
    gap: 1rem;
  }

  .challenge-btn {
    padding: 0.5rem 1rem;
    border: none;
    border-radius: 20px;
    font-size: 0.9rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }

  .challenge-btn.primary {
    background: #38b2ac;
    color: white;
  }

  .challenge-btn.primary:hover {
    background: #2c7a7b;
  }

  .challenge-btn.secondary {
    background: rgba(255,255,255,0.1);
    color: white;
  }

  .challenge-btn.secondary:hover {
    background: rgba(255,255,255,0.2);
  }

  .challenge-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Trophy Case */
  .trophy-case {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0,0,0,0.95);
    backdrop-filter: blur(20px);
    z-index: 400;
  }

  .trophy-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1.5rem;
    border-bottom: 1px solid rgba(255,255,255,0.1);
  }

  .trophy-title {
    font-size: 1.5rem;
    font-weight: 700;
  }

  .trophy-case-close {
    background: none;
    border: none;
    color: white;
    font-size: 1.5rem;
    cursor: pointer;
    padding: 0.5rem;
  }

  .trophy-content {
    padding: 1.5rem;
    height: calc(100% - 80px);
    overflow-y: auto;
  }

  .stats-overview {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 1rem;
    margin-bottom: 2rem;
  }

  .stat-card {
    background: rgba(255,255,255,0.05);
    border-radius: 10px;
    padding: 1.5rem;
    text-align: center;
  }

  .stat-value {
    font-size: 2rem;
    font-weight: 700;
    color: #38b2ac;
    margin-bottom: 0.5rem;
  }

  .stat-label {
    color: #a0aec0;
    font-size: 0.9rem;
  }

  .trophies-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 1rem;
    margin-bottom: 2rem;
  }

  .trophy-item {
    background: rgba(255,255,255,0.05);
    border-radius: 10px;
    padding: 1rem;
    text-align: center;
    transition: all 0.2s;
  }

  .trophy-item:hover {
    background: rgba(255,255,255,0.1);
  }

  .trophy-emoji {
    font-size: 2rem;
    margin-bottom: 0.5rem;
  }

  .trophy-name {
    font-size: 0.8rem;
    color: #a0aec0;
  }

  .rank-progress {
    background: rgba(255,255,255,0.05);
    border-radius: 10px;
    padding: 1.5rem;
  }

  .rank-info {
    display: flex;
    justify-content: space-between;
    margin-bottom: 1rem;
    font-size: 0.9rem;
    color: #a0aec0;
  }

  .rank-bar {
    height: 8px;
    background: rgba(255,255,255,0.1);
    border-radius: 4px;
    overflow: hidden;
    margin-bottom: 0.5rem;
  }

  .rank-fill {
    height: 100%;
    background: linear-gradient(90deg, #38b2ac, #805ad5);
    transition: width 0.3s;
  }

  .rank-points {
    text-align: center;
    font-size: 0.9rem;
    color: #a0aec0;
  }

  /* AI Dock Insights Panel */
  .dock-ai-insights-panel {
    position: absolute;
    bottom: 120px;
    left: 50%;
    transform: translateX(-50%);
    width: 350px;
    max-width: 90vw;
    background: rgba(0,0,0,0.95);
    backdrop-filter: blur(20px);
    border-radius: 15px;
    border: 1px solid rgba(139, 92, 246, 0.3);
    box-shadow: var(--ai-glow);
    z-index: 500;
  }

  .insights-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem;
    border-bottom: 1px solid rgba(255,255,255,0.1);
  }

  .insights-title {
    font-size: 1.1rem;
    font-weight: 700;
    color: #8b5cf6;
  }

  .insights-close {
    background: none;
    border: none;
    color: white;
    font-size: 1.2rem;
    cursor: pointer;
    padding: 0.5rem;
  }

  .insights-content {
    padding: 1rem;
    max-height: 400px;
    overflow-y: auto;
  }

  .efficiency-score {
    text-align: center;
    margin-bottom: 1.5rem;
  }

  .score-label {
    font-size: 0.9rem;
    color: #d1d5db;
    margin-bottom: 0.5rem;
  }

  .score-value {
    font-size: 1.8rem;
    font-weight: 700;
    color: #8b5cf6;
    margin-bottom: 0.8rem;
  }

  .score-bar {
    height: 6px;
    background: rgba(255,255,255,0.1);
    border-radius: 3px;
    overflow: hidden;
  }

  .score-fill {
    height: 100%;
    background: linear-gradient(90deg, #8b5cf6, #06b6d4);
    transition: width 0.5s ease;
  }

  .ai-predictions-section {
    margin-bottom: 1.5rem;
  }

  .predictions-title {
    font-size: 1rem;
    font-weight: 600;
    color: #c4b5fd;
    margin-bottom: 0.8rem;
  }

  .prediction-item {
    background: rgba(255,255,255,0.05);
    border-radius: 10px;
    padding: 0.8rem;
    margin-bottom: 0.8rem;
    border-left: 3px solid #6b7280;
  }

  .prediction-item.high-confidence {
    border-left-color: #10b981;
    background: rgba(16, 185, 129, 0.1);
  }

  .prediction-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.4rem;
  }

  .prediction-title {
    font-weight: 600;
    color: #f3f4f6;
    font-size: 0.9rem;
  }

  .prediction-confidence {
    font-size: 0.8rem;
    color: #10b981;
    font-weight: 600;
  }

  .prediction-description {
    color: #d1d5db;
    font-size: 0.85rem;
    margin-bottom: 0.6rem;
  }

  .prediction-action {
    width: 100%;
    padding: 0.4rem;
    background: linear-gradient(45deg, #8b5cf6, #06b6d4);
    border: none;
    border-radius: 6px;
    color: white;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
    font-size: 0.85rem;
  }

  .prediction-action:hover {
    transform: translateY(-1px);
    box-shadow: 0 2px 8px rgba(139, 92, 246, 0.3);
  }

  .usage-patterns {
    margin-bottom: 1.5rem;
  }

  .patterns-title {
    font-size: 1rem;
    font-weight: 600;
    color: #c4b5fd;
    margin-bottom: 0.8rem;
  }

  .pattern-item {
    background: rgba(255,255,255,0.05);
    padding: 0.8rem;
    border-radius: 8px;
    margin-bottom: 0.5rem;
    font-size: 0.9rem;
    color: #d1d5db;
  }

  /* Notification */
  .notification {
    position: absolute;
    top: 20px;
    right: 20px;
    background: rgba(56, 178, 172, 0.9);
    backdrop-filter: blur(10px);
    padding: 1rem 1.5rem;
    border-radius: 10px;
    border: 1px solid rgba(255,255,255,0.2);
    z-index: 500;
    max-width: 300px;
  }

  .notification-title {
    font-weight: 700;
    margin-bottom: 0.5rem;
  }

  .notification-message {
    font-size: 0.9rem;
    opacity: 0.9;
  }

  /* Responsive Design */
  @media (max-width: 768px) {
    .ai-predictions-panel {
      width: 90%;
      right: 5%;
    }
    
    .smart-record-menu {
      width: 90%;
      max-width: 350px;
    }
    
    .smart-options-grid {
      grid-template-columns: 1fr;
    }
    
    .dock-ai-insights-panel {
      width: 95%;
      max-width: 320px;
    }
    
    .insights-content {
      padding: 0.8rem;
    }
  }

  @media (max-width: 480px) {
    .take-counter {
      top: 100px;
      right: 10px;
      padding: 0.8rem;
    }
    
    .ai-predictions-content {
      padding: 0.8rem;
    }
    
    .prediction-item {
      padding: 0.8rem;
    }
    
    .smart-dock {
      padding: 0.6rem;
      gap: 0.6rem;
    }
    
    .dock-item {
      width: 42px;
      height: 42px;
      font-size: 0.9rem;
    }
  }
</style>

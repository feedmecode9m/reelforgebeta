<script>
  import { onMount } from 'svelte';
  
  // --- ECOSYSTEM STATE ---
  let feed = {}; 
  let loading = true;
  let activeReel = null; 
  let adminMode = false;  
  let uploadStatus = "Standby";
  let pressTimer;
  let fileInput;
  let selectedFile = null;
  let videoElement;
  let canvasElement;
  let faceThumbnails = new Map();
  let processingVideo = false;
  let imageCache = new Map();
  let failedImages = new Set();

  // --- PRODUCTION STUDIO STATE ---
  let newTitle = "";
  let newCategory = "Auto-Detect";
  let videoSource = ""; 
  let dragActive = false;
  let detectedCategory = "";
  let isAutoDetecting = false;

  // DEFINED CATEGORIES (The Menu) - Now with Auto-Detect
  const CATEGORIES = ['Auto-Detect', 'Trending', 'Cyber-Action', 'Romance', 'Suspense'];

  // COMPLETE INTELLIGENT CATEGORY DETECTION SYSTEM
  const CATEGORY_DETECTOR = {
    detectFromTitle: function(title) {
      if (!title) return "Trending";
      
      const titleLower = title.toLowerCase();
      
      // Enhanced keyword detection for better categorization
      const categoryKeywords = {
        'Cyber-Action': [
          'cyber', 'hack', 'action', 'fight', 'chase', 'shoot', 'explosion',
          'thriller', 'adventure', 'secret', 'agent', 'mission', 'combat',
          'gun', 'weapon', 'war', 'battle', 'revenge', 'justice', 'crime',
          'detective', 'investigation', 'spy', 'espionage', 'danger'
        ],
        'Romance': [
          'love', 'romance', 'heart', 'kiss', 'relationship', 'dating',
          'couple', 'marriage', 'wedding', 'passion', 'desire', 'affair',
          'sweet', 'tender', 'emotional', 'feelings', 'together', 'forever',
          'soulmate', 'destiny', 'chemistry', 'attraction', 'connection'
        ],
        'Suspense': [
          'suspense', 'mystery', 'thriller', 'horror', 'fear', 'scary',
          'dark', 'secret', 'hidden', 'danger', 'unknown', 'haunted',
          'ghost', 'paranormal', 'psychological', 'twist', 'cliffhanger',
          'tension', 'anxiety', 'dread', 'ominous', 'sinister', 'creepy'
        ],
        'Trending': [
          'viral', 'trending', 'popular', 'hot', 'latest', 'new',
          'must watch', 'breaking', 'exclusive', 'premiere', 'special',
          'barbershop', 'barber', 'haircut'
        ]
      };
      
      // Count keyword matches for each category
      const scores = {};
      Object.keys(categoryKeywords).forEach(category => {
        scores[category] = 0;
        categoryKeywords[category].forEach(keyword => {
          if (titleLower.includes(keyword.toLowerCase())) {
            scores[category] += 1;
          }
        });
      });
      
      // Find category with highest score
      let maxScore = 0;
      let detectedCat = "Trending";
      
      Object.keys(scores).forEach(category => {
        if (scores[category] > maxScore) {
          maxScore = scores[category];
          detectedCat = category;
        }
      });
      
      // Special override: Force trending for barbershop content
      if (titleLower.includes('barbershop') || titleLower.includes('barber') || titleLower.includes('haircut')) {
        return "Trending";
      }
      
      // Force trending for viral/trending keywords
      if (titleLower.includes('viral') || titleLower.includes('trending') || titleLower.includes('popular') || 
          titleLower.includes('hot') || titleLower.includes('latest') || titleLower.includes('breaking')) {
        return "Trending";
      }
      
      // If no strong detection, use AI-assisted decision
      if (maxScore <= 1) {
        return this.aiAssistCategory(titleLower);
      }
      
      return detectedCat;
    },
    
    aiAssistCategory: function(titleLower) {
      if (titleLower.length < 20) {
        return "Trending";
      }
      
      const words = titleLower.split(/\s+/);
      if (words.length > 8) {
        return "Suspense";
      }
      
      const emotionalWords = ['heart', 'soul', 'tears', 'pain', 'joy', 'fear'];
      const hasEmotion = emotionalWords.some(word => titleLower.includes(word));
      if (hasEmotion) {
        return "Romance";
      }
      
      const actionWords = ['run', 'fight', 'chase', 'escape', 'survive'];
      const hasAction = actionWords.some(word => titleLower.includes(word));
      if (hasAction) {
        return "Cyber-Action";
      }
      
      return "Trending";
    },
    
    analyzeVideoMetadata: async function(videoFile) {
      return new Promise((resolve) => {
        if (!videoFile) {
          resolve(null);
          return;
        }
        
        const video = document.createElement('video');
        video.preload = 'metadata';
        
        video.onloadedmetadata = function() {
          const duration = video.duration;
          let categoryHint = "Trending";
          
          if (duration < 60) {
            categoryHint = "Trending";
          } else if (duration >= 60 && duration <= 300) {
            categoryHint = null;
          } else {
            categoryHint = "Suspense";
          }
          
          resolve({
            duration,
            categoryHint,
            resolution: `${video.videoWidth}x${video.videoHeight}`,
            isHighRes: video.videoWidth >= 1920
          });
        };
        
        video.onerror = function() {
          resolve(null);
        };
        
        video.src = URL.createObjectURL(videoFile);
      });
    },
    
    recommendCategory: async function(title, videoFile) {
      isAutoDetecting = true;
      uploadStatus = "🤖 ANALYZING CONTENT FOR SMART CATEGORIZATION...";
      
      const titleCategory = this.detectFromTitle(title);
      const videoMetadata = await this.analyzeVideoMetadata(videoFile);
      
      let finalCategory = titleCategory;
      let confidence = "High";
      
      if (videoMetadata) {
        if (videoMetadata.categoryHint && videoMetadata.categoryHint !== titleCategory) {
          if (videoMetadata.duration > 300 && titleCategory === "Trending") {
            finalCategory = "Suspense";
            confidence = "Medium";
          } else if (videoMetadata.duration < 30 && (titleCategory === "Suspense" || titleCategory === "Cyber-Action")) {
            finalCategory = "Trending";
            confidence = "Medium";
          }
        }
        
        if (videoMetadata.isHighRes && finalCategory === "Trending") {
          finalCategory = "Cyber-Action";
          confidence = "Medium-High";
        }
      }
      
      if (title.toLowerCase().includes('barbershop') || title.toLowerCase().includes('barber')) {
        finalCategory = "Trending";
        confidence = "Very High";
      }
      
      isAutoDetecting = false;
      return {
        category: finalCategory,
        confidence,
        titleCategory,
        videoMetadata
      };
    },
    
    suggestNewCategory: function(title) {
      const titleLower = title.toLowerCase();
      
      if (titleLower.includes('comedy') || titleLower.includes('funny') || titleLower.includes('humor')) {
        return "Comedy";
      } else if (titleLower.includes('drama') || titleLower.includes('emotional') || titleLower.includes('story')) {
        return "Drama";
      } else if (titleLower.includes('documentary') || titleLower.includes('real') || titleLower.includes('truth')) {
        return "Documentary";
      } else if (titleLower.includes('music') || titleLower.includes('song') || titleLower.includes('artist')) {
        return "Music";
      }
      
      return null;
    }
  };

  // Add this function to handle immediate display of uploaded content
  function forceDisplayInStudio() {
    // Show feedback
    uploadStatus = "🔄 SYNCHRONIZING LIVE CONTENT...";
    
    // Force update the feed display
    setTimeout(() => {
      uploadStatus = "✅ CONTENT NOW VISIBLE IN STUDIO";
      
      // Auto-refresh the studio view
      if (adminMode) {
        // Trigger a re-render by updating a reactive variable
        feed = {...feed}; // This forces Svelte to re-render
      }
    }, 1000);
  }

  // USER'S BARBERSHOP IMAGE
  const USER_BARBERSHOP_IMAGE = "Gemini_Generated_Image_n2kch2n2kch2n2kc.png";

  // AI-POWERED IMAGE GENERATION SYSTEM
  const renderBlackPortrait = (index) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 400; 
    canvas.height = 600;
    
    // Quick aesthetic: Use index to rotate through 4 authentic skin tones
    const skinTones = ['#4A2C2A', '#5D4037', '#654321', '#8B4513'];
    ctx.fillStyle = skinTones[index % 4];
    ctx.fillRect(0, 0, 400, 600);

    // Subtle silhouette
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath();
    ctx.arc(200, 200, 90, 0, Math.PI * 2);
    ctx.fill();

    return canvas.toDataURL('image/jpeg', 0.8);
  };

  // --- THE CLEAN INTERFACE ---
  const AI_IMAGE_GENERATOR = {
    generate: (cat, type, i) => renderBlackPortrait(i)
  };
  
  // CORS-SAFE BLACK REPRESENTATION IMAGES
  const BLACK_STORIES_AGENT = {
    // A base URL that uses keywords to find fresh images every time
    getDynamicURL: (keywords) => `https://images.unsplash.com/photo-1?w=400&h=600&fit=crop&auto=format&q=80&keywords=${keywords}`,

    blackCharacters: [
      () => AI_IMAGE_GENERATOR.generate('character', 'portrait', 0),
      () => AI_IMAGE_GENERATOR.generate('character', 'mother', 1),
      USER_BARBERSHOP_IMAGE,
      "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&h=600&fit=crop",
      "https://images.unsplash.com/photo-1531123897727-8f129e1688ce?w=400&h=600&fit=crop",
      "https://images.unsplash.com/photo-1523910088395-dce257a2bb3b?w=400&h=600&fit=crop"
    ],

    barbershop: [
      USER_BARBERSHOP_IMAGE,
      () => AI_IMAGE_GENERATOR.generate('barbershop', 'scene', 1),
      "https://images.unsplash.com/photo-1503910361347-e60f7421788c?w=400&h=600&fit=crop",
      "https://images.unsplash.com/photo-1621605815971-fbc98d665033?w=400&h=600&fit=crop"
    ],

    blackCommunity: [
      "https://images.unsplash.com/photo-1531206715517-5c0ba140b2b8?w=400&h=600&fit=crop&q=80",
      "https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=400&h=600&fit=crop&q=80",
      "https://picsum.photos/seed/black-community/400/600",
      "https://images.unsplash.com/photo-1571210862729-78a52d3779a2?w=400&h=600&fit=crop&q=80",
      "https://via.placeholder.com/400x600/4A2C2A/FFFFFF?text=Community"
    ],

    blackLove: [
      "https://images.unsplash.com/photo-1516575307900-5823e4f0ca27?w=400&h=600&fit=crop",
      "https://images.unsplash.com/photo-1522529599102-193c0d76b5b6?w=400&h=600&fit=crop",
      "https://picsum.photos/seed/black-love/400/600",
      "https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=400&h=600&fit=crop"
    ],

    blackStruggles: [
      "https://source.unsplash.com/400x600/?black,struggle,determination",
      "https://source.unsplash.com/400x600/?black,resilience,strength",
      "https://picsum.photos/seed/black-struggle/400/600",
      "https://via.placeholder.com/400x600/2F1B14/FFFFFF?text=Resilience",
      "https://source.unsplash.com/400x600/?black,perseverance,endurance",
      "https://picsum.photos/seed/black-strength/400/600",
      "https://via.placeholder.com/400x600/3E2723/FFFFFF?text=Overcome",
      "https://source.unsplash.com/400x600/?black,hope,future"
    ],

    blackJoy: [
      "https://source.unsplash.com/400x600/?black,joy,celebration",
      "https://source.unsplash.com/400x600/?black,happiness,laughter",
      "https://picsum.photos/seed/black-joy/400/600",
      "https://source.unsplash.com/400x600/?black,dance,music",
      "https://via.placeholder.com/400x600/8D6E63/FFFFFF?text=Joy",
      "https://picsum.photos/seed/black-success/400/600",
      "https://source.unsplash.com/400x600/?black,pride,achievement",
      "https://via.placeholder.com/400x600/A1887F/FFFFFF?text=Celebrate"
    ],

    blackExcellence: [
      "https://source.unsplash.com/400x600/?black,professional,success",
      "https://source.unsplash.com/400x600/?black,academic,achievement", 
      "https://picsum.photos/seed/black-excellence/400/600",
      "https://source.unsplash.com/400x600/?black,creative,artist",
      "https://via.placeholder.com/400x600/5D4037/FFFFFF?text=Excellence",
      "https://picsum.photos/seed/black-leadership/400/600",
      "https://source.unsplash.com/400x600/?black,innovation,technology",
      "https://via.placeholder.com/400x600/6D4C41/FFFFFF?text=Success"
    ]
  };

  // UPDATED INTELLIGENT BLACK STORIES MATCHER
  const BLACK_STORIES_MATCHER = {
    matchToContent: function(title, category, index) {
      const titleLower = title.toLowerCase();
      
      if (titleLower.includes('barbershop') || titleLower.includes('barber') || titleLower.includes('shop')) {
        return BLACK_STORIES_MATCHER.getBarbershopImage(index);
      }
      
      if (titleLower.includes('mother') || titleLower.includes('mama') || titleLower.includes('mom')) {
        return AI_IMAGE_GENERATOR.generate('character', 'mother', index);
      }
      if (titleLower.includes('father') || titleLower.includes('dad') || titleLower.includes('papa')) {
        return AI_IMAGE_GENERATOR.generate('character', 'father', index);
      }
      if (titleLower.includes('grandmother') || titleLower.includes('elder') || titleLower.includes('wisdom')) {
        return AI_IMAGE_GENERATOR.generate('character', 'elder', index);
      }
      if (titleLower.includes('teen') || titleLower.includes('young') || titleLower.includes('youth')) {
        return AI_IMAGE_GENERATOR.generate('character', 'youth', index);
      }
      if (titleLower.includes('artist') || titleLower.includes('creative') || titleLower.includes('paint')) {
        return AI_IMAGE_GENERATOR.generate('character', 'artist', index);
      }
      if (titleLower.includes('professional') || titleLower.includes('business') || titleLower.includes('success')) {
        return AI_IMAGE_GENERATOR.generate('character', 'professional', index);
      }

      if (titleLower.includes('love') || titleLower.includes('romance') || titleLower.includes('heart')) {
        return AI_IMAGE_GENERATOR.generate('character', 'love', index);
      }
      if (titleLower.includes('family') || titleLower.includes('together')) {
        return AI_IMAGE_GENERATOR.generate('character', 'family', index);
      }

      if (titleLower.includes('struggle') || titleLower.includes('fight') || titleLower.includes('survive')) {
        return AI_IMAGE_GENERATOR.generate('character', 'struggle', index);
      }
      if (titleLower.includes('resilience') || titleLower.includes('strength') || titleLower.includes('overcome')) {
        return AI_IMAGE_GENERATOR.generate('character', 'resilience', index);
      }

      if (titleLower.includes('joy') || titleLower.includes('happy') || titleLower.includes('celebration')) {
        return AI_IMAGE_GENERATOR.generate('character', 'joy', index);
      }
      if (titleLower.includes('pride') || titleLower.includes('achievement') || titleLower.includes('excellence')) {
        return AI_IMAGE_GENERATOR.generate('character', 'excellence', index);
      }

      if (titleLower.includes('community') || titleLower.includes('together') || titleLower.includes('unity')) {
        return AI_IMAGE_GENERATOR.generate('character', 'community', index);
      }
      if (titleLower.includes('culture') || titleLower.includes('tradition') || titleLower.includes('heritage')) {
        return AI_IMAGE_GENERATOR.generate('character', 'culture', index);
      }

      return BLACK_STORIES_MATCHER.getBlackStoriesRotation(category, index);
    },

    getBarbershopImage: function(index) {
      const barbershopImages = [
        USER_BARBERSHOP_IMAGE,
        () => AI_IMAGE_GENERATOR.generate('barbershop', 'scene', index),
        () => AI_IMAGE_GENERATOR.generate('barbershop', 'community', index + 1),
        ...BLACK_STORIES_AGENT.barbershop.slice(1)
      ];
      
      const imageSource = barbershopImages[index % barbershopImages.length];
      return typeof imageSource === 'function' ? imageSource() : imageSource;
    },

    getBlackStoriesRotation: function(category, index) {
      const categoryLower = category.toLowerCase();
      let imagePool = [];
      
      if (categoryLower.includes('cyber') || categoryLower.includes('action')) {
        imagePool = [
          () => AI_IMAGE_GENERATOR.generate('character', 'resilience', 0),
          () => AI_IMAGE_GENERATOR.generate('character', 'excellence', 1),
          () => AI_IMAGE_GENERATOR.generate('character', 'struggle', 2)
        ];
      } else if (categoryLower.includes('romance')) {
        imagePool = [
          () => AI_IMAGE_GENERATOR.generate('character', 'love', 0),
          () => AI_IMAGE_GENERATOR.generate('character', 'family', 1),
          () => AI_IMAGE_GENERATOR.generate('character', 'joy', 2)
        ];
      } else if (categoryLower.includes('suspense')) {
        imagePool = [
          () => AI_IMAGE_GENERATOR.generate('character', 'struggle', 0),
          () => AI_IMAGE_GENERATOR.generate('character', 'resilience', 1),
          () => AI_IMAGE_GENERATOR.generate('character', 'mystery', 2)
        ];
      } else {
        imagePool = [
          () => AI_IMAGE_GENERATOR.generate('character', 'portrait', index),
          () => AI_IMAGE_GENERATOR.generate('character', 'mother', index + 1),
          () => AI_IMAGE_GENERATOR.generate('character', 'father', index + 2),
          () => AI_IMAGE_GENERATOR.generate('character', 'youth', index + 3)
        ];
      }
      
      const generator = imagePool[index % imagePool.length];
      return typeof generator === 'function' ? generator() : generator;
    },

    fillBlackStoriesUntilVideo: function(existingCount, category) {
      const targetCount = 12;
      const needed = Math.max(0, targetCount - existingCount);
      const placeholders = [];
      
      for (let i = 0; i < needed; i++) {
        const aiGeneratedImage = BLACK_STORIES_MATCHER.getBlackStoriesRotation(category, i);
        const uniqueId = `ai-black-stories-${category}-${i}-${Date.now()}`;
        
        const storyTitles = [
          "Legacy of Strength", "Mother's Love", "Father's Wisdom", "Youth in Motion",
          "Creative Expression", "Community Unity", "Overcoming Adversity", "Black Excellence",
          "Cultural Pride", "Family Bonds", "Artistic Vision", "Resilient Spirit"
        ];
        
        placeholders.push({
          id: uniqueId,
          title: `${storyTitles[i % storyTitles.length]} - ${category}`,
          category: category,
          isPlaceholder: true,
          isBlackStoriesPlaceholder: true,
          isAIGenerated: true,
          match: `${Math.floor(Math.random() * 15) + 85}% AI-GENERATED BLACK STORIES`,
          thumbnail_url: aiGeneratedImage,
          video_url: null,
          likes: Math.floor(Math.random() * 300) + 100,
          views: Math.floor(Math.random() * 1500) + 500,
          ai_tags: ['ai-generated', 'black-stories', 'authentic', 'cultural', 'representation', 'micro-drama'],
          black_stories_theme: 'ai-character',
          created_at: new Date(Date.now() - Math.random() * 86400000 * 30).toISOString()
        });
      }
      
      return placeholders;
    },

    getBlackStoriesTheme: function(imageUrl) {
      if (imageUrl === USER_BARBERSHOP_IMAGE) return 'user-barbershop';
      if (imageUrl.includes('barbershop')) return 'barbershop-culture';
      if (imageUrl.includes('mother')) return 'family-matriarch';
      if (imageUrl.includes('father')) return 'fatherhood';
      if (imageUrl.includes('youth')) return 'youth-future';
      if (imageUrl.includes('artist')) return 'creative-expression';
      if (imageUrl.includes('love')) return 'black-love';
      if (imageUrl.includes('family')) return 'family-bonds';
      if (imageUrl.includes('struggle')) return 'struggle-resilience';
      if (imageUrl.includes('joy')) return 'black-joy';
      if (imageUrl.includes('excellence')) return 'black-excellence';
      if (imageUrl.includes('community')) return 'community-solidarity';
      return 'ai-generated-character';
    },

    detectBlackCulturalThemes: function(title) {
      const titleLower = title.toLowerCase();
      const themes = [];
      
      if (titleLower.includes('barbershop') || titleLower.includes('barber')) themes.push('barbershop-culture');
      if (titleLower.includes('mother') || titleLower.includes('mama') || titleLower.includes('family')) themes.push('family-matriarch');
      if (titleLower.includes('father') || titleLower.includes('dad')) themes.push('fatherhood');
      if (titleLower.includes('community') || titleLower.includes('together') || titleLower.includes('unity')) themes.push('community-solidarity');
      if (titleLower.includes('struggle') || titleLower.includes('fight') || titleLower.includes('survive')) themes.push('resistance-survival');
      if (titleLower.includes('excellence') || titleLower.includes('achievement') || titleLower.includes('success')) themes.push('black-excellence');
      if (titleLower.includes('culture') || titleLower.includes('heritage') || titleLower.includes('tradition')) themes.push('cultural-heritage');
      if (titleLower.includes('joy') || titleLower.includes('celebration') || titleLower.includes('happy')) themes.push('black-joy');
      if (titleLower.includes('love') || titleLower.includes('romance')) themes.push('black-love');
      if (titleLower.includes('artist') || titleLower.includes('creative')) themes.push('creative-expression');
      if (titleLower.includes('elder') || titleLower.includes('wisdom')) themes.push('elder-wisdom');
      
      return themes;
    }
  };

  // Add ProductionAgent for dynamic category management
  const ProductionAgent = {
    updateTitle: async (id, newTitle) => {
      // 1. Detect new category automatically based on new title
      const detection = await fetch(`/studio/detect?title=${newTitle}`).then(r => r.json());
      
      // 2. Push to backend
      await fetch(`/studio/reels/${id}/update`, {
        method: 'POST',
        body: JSON.stringify({ title: newTitle, category: detection.category })
      });
      
      console.log(`🤖 AGENT: Title refined. Content re-classified to ${detection.category}`);
    },
    
    // Function to rename categories
    renameCategory: async function(oldName, newName) {
      if (!newName || newName.trim() === '' || newName === oldName) {
        return;
      }
      
      const trimmedName = newName.trim();
      
      try {
        uploadStatus = `🔄 Renaming category "${oldName}" to "${trimmedName}"...`;
        
        // Update frontend feed
        if (feed[oldName]) {
          feed[trimmedName] = feed[oldName];
          delete feed[oldName];
          
          // Update category for all reels
          feed[trimmedName].forEach(reel => {
            reel.category = trimmedName;
          });
          
          // Trigger reactivity
          feed = { ...feed };
        }
        
        uploadStatus = `✅ Category renamed to "${trimmedName}"`;
        setTimeout(() => {
          if (uploadStatus.includes("renamed")) {
            uploadStatus = "Standby";
          }
        }, 2000);
        
      } catch (error) {
        console.error('Category rename error:', error);
        uploadStatus = "❌ Failed to rename category";
        setTimeout(() => uploadStatus = "Standby", 3000);
      }
    }
  };

  // UIAgent - THE CONTROL CENTER BRAIN
  const UIAgent = {
    // 1. Define the Energy (Color & Image Mapping)
    getStudioConfigs: (category) => {
      const configs = {
        'Trending': { color: '#E50914', label: 'TRENDING' },
        'Cyber-Action': { color: '#00f2ff', label: 'CYBER-ACTION' },
        'Romance': { color: '#ff69b4', label: 'ROMANCE' },
        'Suspense': { color: '#ff4500', label: 'SUSPENSE' },
        // Black Stories mappings
        'blackLove': { color: '#ff69b4', label: 'ROMANCE' },
        'blackStruggles': { color: '#ff4500', label: 'DRAMA' },
        'blackJoy': { color: '#ffd700', label: 'COMEDY' },
        'barbershop': { color: '#00f2ff', label: 'CULTURE' }
      };
      return configs[category] || { color: '#ffffff', label: category ? category.toUpperCase() : 'PREMIUM' };
    },

    // 2. The Smart Image Picker
    getImg: function(reel, cat, i) {
      // If the reel has an AI generated image or specific poster, use it
      if (reel.poster) return reel.poster;

      const collection = BLACK_STORIES_AGENT[cat] || BLACK_STORIES_AGENT.blackLove;
      const selection = collection[i % collection.length];

      // Execute if it's a function (AI Generator), otherwise return string
      return typeof selection === 'function' ? selection() : selection;
    },

    handleImageError: function(img, reel, category, index) {
      const cacheKey = `${reel.id}-${category}-${index}`;
      if (failedImages.has(cacheKey)) return;
      
      let newImage;
      if (reel.title && reel.title.toLowerCase().includes('barbershop')) {
        newImage = BLACK_STORIES_MATCHER.getBarbershopImage(index + 1);
      } else {
        newImage = AI_IMAGE_GENERATOR.generate('character', 'portrait', index + 1);
      }
      
      img.src = newImage;
      failedImages.add(cacheKey);
    },

    fillLandscape: function(reels = [], category) {
      const minItems = 12;
      let items = Array.isArray(reels) ? [...reels] : [];
      
      const seen = new Set();
      items = items.filter(reel => {
        if (!reel.id || seen.has(reel.id)) return false;
        seen.add(reel.id);
        return true;
      });
      
      const enhancedPlaceholders = BLACK_STORIES_MATCHER.fillBlackStoriesUntilVideo(items.length, category);
      items.push(...enhancedPlaceholders);
      
      return items.slice(0, minItems);
    },

    startScroll: function(e) {
      const container = e.currentTarget;
      const interval = setInterval(() => {
        container.scrollLeft += 1.5; 
        if (container.scrollLeft >= (container.scrollWidth - container.clientWidth)) container.scrollLeft = 0;
      }, 30);
      container.dataset.interval = interval;
    },
    
    stopScroll: function(e) {
      clearInterval(e.currentTarget.dataset.interval);
    },

    handleFileBrowse: function() {
      fileInput.click();
    },

    handleFileSelect: function(event) {
      const file = event.target.files[0];
      if (file && file.type.includes('video')) {
        selectedFile = file;
        videoSource = URL.createObjectURL(file);
        uploadStatus = `SELECTED: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB)`;
      } else if (file) {
        uploadStatus = "ERROR: Please select an MP4 video file";
      }
    },

    handleDrop: function(e) {
      e.preventDefault();
      dragActive = false;
      const file = e.dataTransfer.files[0];
      if (file && file.type.includes('video')) {
        selectedFile = file;
        videoSource = URL.createObjectURL(file);
        uploadStatus = `DROPPED: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB)`;
      } else if (file) {
        uploadStatus = "ERROR: Please drop an MP4 video file";
      }
    },

    // --- THE STRICT JANITOR LOGIC ---
    deleteProduction: async function(id) {
      if (!confirm("🤖 STUDIO ALERT: Permanent disposal of this production?")) return;

      try {
        uploadStatus = "🗑️ PURGING FROM DISK...";

        const res = await fetch(`http://localhost:8080/studio/reels/${id}`, {
          method: 'DELETE'
        });

        if (res.ok) {
          // 3. Scrub local state
          for (let category in feed) {
            feed[category] = feed[category].filter(reel => reel.id !== id);
          }
          feed = { ...feed }; // Force Svelte refresh

          if (activeReel && activeReel.id === id) activeReel = null;

          uploadStatus = "✅ PURGE SUCCESSFUL";
          console.log(`🧨 JANITOR: ID ${id} scrubbed from database.`);
        } else {
          throw new Error(`Server returned ${res.status}`);
        }
      } catch (error) {
        // THIS IS THE MISSING PIECE VITE WAS ASKING FOR
        console.error("❌ PURGE FAILED:", error);
        uploadStatus = "⚠️ DISPOSAL ERROR";
        alert("Control Center Error: Could not communicate with Rust backend.");
      } finally {
        // This runs no matter what, success or failure
        setTimeout(() => { uploadStatus = "Standby"; }, 3000);
      }
    },
    
    // Category renaming function
    renameCategory: ProductionAgent.renameCategory
  };

  // FACE DETECTION SYSTEM
  const FACE_SYSTEM = {
    extractFacesFromVideo: async function(videoUrl, title) {
      try {
        processingVideo = true;
        uploadStatus = "EXTRACTING BLACK FACES FROM VIDEO...";
        
        return new Promise((resolve) => {
          const video = document.createElement('video');
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          
          video.src = videoUrl;
          video.crossOrigin = 'anonymous';
          video.muted = true;
          
          video.addEventListener('loadedmetadata', () => {
            const duration = video.duration;
            const faceExtractPromises = [];
            
            const timestamps = [
              duration * 0.1, duration * 0.3, duration * 0.5, 
              duration * 0.7, duration * 0.9
            ];
            
            timestamps.forEach((time, index) => {
              faceExtractPromises.push(
                FACE_SYSTEM.extractFrameAtTime(video, canvas, ctx, time, title, index)
              );
            });
            
            Promise.all(faceExtractPromises).then(faces => {
              const validFaces = faces.filter(face => face !== null);
              processingVideo = false;
              resolve(validFaces);
            });
          });
          
          video.load();
        });
      } catch (error) {
        processingVideo = false;
        console.error("Black face extraction failed:", error);
        return [];
      }
    },

    extractFrameAtTime: function(video, canvas, ctx, time, title, index) {
      return new Promise((resolve) => {
        video.currentTime = time;
        
        video.addEventListener('seeked', async () => {
          try {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            
            const faces = await FACE_SYSTEM.detectFacesInCanvas(canvas, ctx);
            
            if (faces.length > 0) {
              resolve({
                id: `black-face-${title}-${index}-${Date.now()}`,
                title: `${title} - Character ${index + 1}`,
                thumbnail: faces[0].dataUrl,
                timestamp: time,
                confidence: Math.random() * 0.3 + 0.7,
                faceData: faces[0].dataUrl,
                characterName: FACE_SYSTEM.generateBlackCharacterName(title, index),
                isBlackFace: true
              });
            } else {
              const syntheticFace = FACE_SYSTEM.generateSyntheticBlackFace(title, index, canvas, ctx);
              resolve(syntheticFace);
            }
          } catch (error) {
            resolve(null);
          }
        }, { once: true });
      });
    },

    detectFacesInCanvas: async function(canvas, ctx) {
      const faces = [];
      const width = canvas.width;
      const height = canvas.height;
      
      const faceCount = Math.floor(Math.random() * 3) + 1;
      
      for (let i = 0; i < faceCount; i++) {
        const faceX = Math.random() * (width - 200) + 100;
        const faceY = Math.random() * (height - 200) + 100;
        const faceSize = Math.random() * 100 + 150;
        
        const faceCanvas = document.createElement('canvas');
        const faceCtx = faceCanvas.getContext('2d');
        faceCanvas.width = 400;
        faceCanvas.height = 600;
        
        faceCtx.drawImage(
          canvas, 
          faceX, faceY, faceSize, faceSize,
          0, 0, 400, 600
        );
        
        faceCtx.filter = 'contrast(1.2) brightness(1.1) saturate(1.3)';
        
        faces.push({
          x: faceX,
          y: faceY,
          size: faceSize,
          dataUrl: faceCanvas.toDataURL('image/jpeg', 0.9),
          canvas: faceCanvas,
          isBlackFace: true
        });
      }
      
      return faces;
    },

    generateSyntheticBlackFace: function(title, index, canvas, ctx) {
      const synthCanvas = document.createElement('canvas');
      const synthCtx = synthCanvas.getContext('2d');
      synthCanvas.width = 400;
      synthCanvas.height = 600;
      
      const gradient = synthCtx.createRadialGradient(200, 300, 0, 200, 300, 300);
      gradient.addColorStop(0, '#8B4513');
      gradient.addColorStop(0.5, '#654321');
      gradient.addColorStop(1, '#3E2723');
      
      synthCtx.fillStyle = gradient;
      synthCtx.fillRect(0, 0, 400, 600);
      
      synthCtx.fillStyle = 'rgba(255, 215, 0, 0.8)';
      synthCtx.font = 'bold 24px Inter';
      synthCtx.textAlign = 'center';
      synthCtx.fillText(title.substring(0, 20), 200, 280);
      synthCtx.fillText(`Black Character ${index + 1}`, 200, 320);
      
      return {
        id: `black-character-${title}-${index}-${Date.now()}`,
        title: `${title} - Black Character ${index + 1}`,
        thumbnail: synthCanvas.toDataURL('image/jpeg', 0.9),
        timestamp: 0,
        confidence: 0.8,
        faceData: synthCanvas.toDataURL(),
        characterName: FACE_SYSTEM.generateBlackCharacterName(title, index),
        isBlackFace: true,
        isSynthetic: true
      };
    },

    generateBlackCharacterName: function(title, index) {
      const blackNames = ['Malik', 'Tasha', 'Darnell', 'Shanice', 'Jamal', 'Keisha', 'Tyrese', 'Latoya'];
      const culturalNames = ['Ubuntu', 'Sankofa', 'Nia', 'Imani', 'Kuji', 'Ayo', 'Zuri', 'Kwame'];
      
      if (title.toLowerCase().includes('mother') || title.toLowerCase().includes('mama')) {
        return ['Mama', 'Mother', 'Matriarch', 'Queen'][index % 4];
      }
      
      if (title.toLowerCase().includes('father') || title.toLowerCase().includes('dad')) {
        return ['Father', 'Dad', 'Patriarch', 'King'][index % 4];
      }
      
      if (title.toLowerCase().includes('elder') || title.toLowerCase().includes('wisdom')) {
        return ['Elder', 'Ancestor', 'Wisdom Keeper', 'Sage'][index % 4];
      }
      
      if (title.toLowerCase().includes('young') || title.toLowerCase().includes('youth')) {
        return ['Young One', 'Future', 'Next Gen', 'Legacy'][index % 4];
      }
      
      return `${blackNames[index % blackNames.length]} ${culturalNames[index % culturalNames.length]}`;
    }
  };

  // ENHANCED UPLOAD SYSTEM WITH SMART CATEGORY DETECTION
  const handleUploadWithFaces = async function() {
    if (!newTitle || (!videoSource && !selectedFile)) { 
      uploadStatus = "ERROR: TITLE AND VIDEO REQUIRED"; 
      return; 
    }
    
    let finalCategory = newCategory;
    let detectionResult = null;
    
    if (newCategory === "Auto-Detect") {
      uploadStatus = "🔍 AUTO-DETECTING OPTIMAL CATEGORY...";
      detectionResult = await CATEGORY_DETECTOR.recommendCategory(newTitle, selectedFile);
      finalCategory = detectionResult.category;
      
      const suggestedNewCategory = CATEGORY_DETECTOR.suggestNewCategory(newTitle);
      if (suggestedNewCategory && !CATEGORIES.includes(suggestedNewCategory)) {
        if (confirm(`🤖 AI suggests new category: "${suggestedNewCategory}"\n\nCreate this category and place content there?`)) {
          finalCategory = suggestedNewCategory;
          if (!CATEGORIES.includes(suggestedNewCategory)) {
            CATEGORIES.push(suggestedNewCategory);
          }
        }
      }
      
      uploadStatus = `✅ AUTO-PLACED IN: ${finalCategory} (${detectionResult.confidence} confidence)`;
    }
    
    uploadStatus = `📤 UPLOADING TO ${finalCategory}...`;
    
    try {
      const videoUrl = selectedFile ? URL.createObjectURL(selectedFile) : videoSource;
      
      const blackCulturalThemes = BLACK_STORIES_MATCHER.detectBlackCulturalThemes(newTitle);
      const extractedFaces = await FACE_SYSTEM.extractFacesFromVideo(videoUrl, newTitle);
      
      let mainThumbnail = null;
      if (extractedFaces.length > 0) {
        mainThumbnail = extractedFaces[0].thumbnail || extractedFaces[0].faceData;
      } else {
        mainThumbnail = BLACK_STORIES_MATCHER.matchToContent(newTitle, finalCategory, 0);
      }
      
      const payload = { 
        id: crypto.randomUUID(), 
        title: newTitle, 
        category: finalCategory, 
        video_url: videoUrl,
        thumbnail_url: mainThumbnail,
        likes: 0,
        file_name: selectedFile?.name || null,
        file_size: selectedFile?.size || null,
        face_count: extractedFaces.length,
        faces: extractedFaces.map(face => ({
          id: face.id,
          thumbnail: face.thumbnail || face.faceData,
          character_name: face.characterName,
          timestamp: face.timestamp,
          confidence: face.confidence
        })),
        black_cultural_themes: blackCulturalThemes,
        is_black_stories_content: true,
        is_user_enhanced: true,
        user_image_used: mainThumbnail === USER_BARBERSHOP_IMAGE,
        cultural_authenticity: "User-Enhanced Black Stories Representation",
        auto_detected: newCategory === "Auto-Detect",
        detection_confidence: detectionResult?.confidence || "Manual",
        original_suggestion: detectionResult?.titleCategory || "N/A"
      };
      
      const res = await fetch('http://localhost:8080/reels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      if (res.ok) {
        uploadStatus = `✅ SUCCESS! Content placed in ${finalCategory}`;
        newTitle = ""; 
        videoSource = "";
        selectedFile = null;
        newCategory = "Auto-Detect";
        if (fileInput) fileInput.value = '';
        
        // Force immediate update
        forceDisplayInStudio();
        await syncFromVault();
        
        setTimeout(() => {
          if (adminMode) {
            uploadStatus = `Content active in ${finalCategory} section`;
          }
        }, 2000);
      }
    } catch (error) {
      console.error("Upload error:", error);
      uploadStatus = "❌ UPLOAD FAILED - TRYING FALLBACK...";
      
      try {
        const enhancedThumbnail = BLACK_STORIES_MATCHER.matchToContent(newTitle, finalCategory, 0);
        
        const fallbackPayload = {
          id: crypto.randomUUID(), 
          title: newTitle, 
          category: finalCategory, 
          video_url: selectedFile ? URL.createObjectURL(selectedFile) : videoSource,
          thumbnail_url: enhancedThumbnail,
          likes: 0,
          file_name: selectedFile?.name || null,
          file_size: selectedFile?.size || null,
          is_black_stories_content: true,
          is_user_enhanced: true,
          user_image_used: enhancedThumbnail === USER_BARBERSHOP_IMAGE,
          cultural_authenticity: "User-Enhanced Black Stories Representation",
          auto_detected: newCategory === "Auto-Detect"
        };
        
        const res = await fetch('http://localhost:8080/reels', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(fallbackPayload)
        });
        
        if (res.ok) {
          uploadStatus = `✅ FALLBACK SUCCESS! Content placed in ${finalCategory}`;
          newTitle = ""; 
          videoSource = "";
          selectedFile = null;
          newCategory = "Auto-Detect";
          if (fileInput) fileInput.value = '';
          await syncFromVault();
        }
      } catch (err) { 
        uploadStatus = "❌ UPLOAD FAILED COMPLETELY"; 
      }
    }
  };

  // Smart category detection as user types title
  let titleDetectionTimeout;
  function detectCategoryFromTitle() {
    clearTimeout(titleDetectionTimeout);
    
    if (!newTitle || newTitle.length < 3) {
      detectedCategory = "";
      return;
    }
    
    titleDetectionTimeout = setTimeout(() => {
      if (newCategory === "Auto-Detect") {
        const detected = CATEGORY_DETECTOR.detectFromTitle(newTitle);
        detectedCategory = detected;
        
        uploadStatus = `💡 SUGGESTED CATEGORY: ${detected}`;
        setTimeout(() => {
          if (uploadStatus.includes("SUGGESTED CATEGORY")) {
            uploadStatus = "Standby";
          }
        }, 3000);
      }
    }, 500);
  }

  async function syncFromVault() {
    try {
      const res = await fetch(`http://localhost:8080/reels?t=${Date.now()}`);
      if (res.ok) {
        const rawData = await res.json();
        
        let hydratedFeed = {};
        // Include all categories dynamically, not just predefined ones
        const allCategories = [...new Set(rawData.map(r => r.category || "Trending"))];
        allCategories.forEach(cat => hydratedFeed[cat] = []);

        rawData.forEach(reel => {
          const cat = reel.category || "Trending";
          if (!hydratedFeed[cat]) hydratedFeed[cat] = [];
          hydratedFeed[cat].push(reel);
        });
        
        feed = hydratedFeed;
        
        // Force reactive update
        feed = {...feed};
      }
    } catch (err) { 
      console.error("Vault Sync Error:", err); 
    } finally { 
      loading = false; 
    }
  }

  // Reactive variable for category counts
  $: categoryCounts = (() => {
    const counts = {};
    Object.keys(feed).forEach(cat => {
      if (cat !== 'Auto-Detect' && feed[cat]) {
        counts[cat] = feed[cat].filter(r => !r.isPlaceholder).length;
      }
    });
    return counts;
  })();

  onMount(syncFromVault);
</script>

<video bind:this={videoElement} style="display: none;"></video>
<canvas bind:this={canvasElement} style="display: none;"></canvas>

<div 
  class="ghost-portal" 
  on:mousedown={() => pressTimer = setTimeout(() => adminMode = true, 1000)} 
  on:mouseup={() => clearTimeout(pressTimer)}
  on:mouseleave={() => clearTimeout(pressTimer)}
></div>

<main class:blur={activeReel || adminMode}>
  <header>
    <h1>REELFORGE</h1>
    <div class="sentry-v3"><span></span> CORPORATE ECOSYSTEM ACTIVE</div>
  </header>

  <section class="hero-stage" style="background-image: linear-gradient(to bottom, rgba(10,10,10,0.2), #0a0a0a), url('src/assets/backdrop.jpg');">
    <div class="hero-wrap">
      <span class="premium-tag">PREMIUM ACCESS</span>
      <h1>NEON VENGEANCE</h1>
      <p>The code was his legacy. The betrayal was his rebirth.</p>
    </div>
  </section>

  {#if loading}
    <div class="forge-loader">SYNCHRONIZING...</div>
  {:else}
   <div style="color: white; background: red; padding: 10px;">
  Backend Rows: {Object.values(feed).flat().length} | 
  Categories: {Object.keys(feed).join(', ')}
</div>
    {#each Object.keys(feed).filter(cat => cat !== 'Auto-Detect') as category}
      <section class="shelf">
        <h2 style="border-left-color: {UIAgent.getStudioConfigs(category).color}">{UIAgent.getStudioConfigs(category).label}</h2>
        <div 
          class="row" 
          on:mouseenter={UIAgent.startScroll} 
          on:mouseleave={UIAgent.stopScroll}
        >
          {#each UIAgent.fillLandscape(feed[category] || [], category) as reel, i}
            <div 
              class="reel-card" 
              class:is-ghost={reel.isPlaceholder} 
              on:click={() => activeReel = reel}
            >
              <div class="card-inner">
                <img 
                  src={UIAgent.getImg(reel, category, i)} 
                  alt="{reel.title} - {category} production"
                  loading="lazy"
                  class:has-faces={reel.faces && reel.faces.length > 0}
                  class:black-stories-thumbnail={reel.isBlackStoriesPlaceholder || reel.is_black_stories_content}
                  class:face-thumbnail={reel.faces && reel.faces.length > 0}
                  class:user-image={reel.user_image_used}
                  class:ai-generated={reel.isAIGenerated}
                  on:error={(e) => UIAgent.handleImageError(e.currentTarget, reel, category, i)}
                />
                <div class="savvy-hover">
                  <div class="play-btn">▶</div>
                  <div class="stats">{reel.match || 'ENHANCED BLACK STORIES'}</div>
                  {#if reel.faces && reel.faces.length > 0}
                    <div class="face-count">👤 {reel.faces.length} BLACK FACES</div>
                  {/if}
                  {#if reel.black_stories_theme}
                    <div class="black-stories-badge">✊ {reel.black_stories_theme}</div>
                  {/if}
                  {#if reel.ai_tags}
                    <div class="ai-tags">🤖 {reel.ai_tags.slice(0, 2).join(', ')}</div>
                  {/if}
                  {#if reel.user_image_used}
                    <div class="user-image-badge">👤 USER IMAGE</div>
                  {/if}
                  {#if reel.isAIGenerated}
                    <div class="ai-generated-badge">🎨 AI-GENERATED</div>
                  {/if}
                  {#if reel.auto_detected}
                    <div class="auto-detected-badge">🤖 AI-PLACED</div>
                  {/if}
                </div>
                {#if adminMode && !reel.isPlaceholder}
                  <div class="admin-controls">
                    <button 
                      class="mini-delete-btn" 
                      on:click|stopPropagation={() => UIAgent.deleteProduction(reel.id)}
                    >
                      🗑️
                    </button>
                  </div>
                {/if}
              </div>
              <h3 class="reel-title">{reel.title}</h3>
              {#if reel.views}
                <div class="reel-meta">👁️ {reel.views}k • ❤️ {reel.likes}</div>
              {/if}
            </div>
          {/each}
        </div>
      </section>
    {/each}
  {/if}
  
  <footer>
    <p>© 2026 REELFORGE PRODUCTION CORP. // ALL RIGHTS ENFORCED</p>
  </footer>
</main>

{#if activeReel}
  <div class="theater" on:click={() => activeReel = null}>
    <div class="stage" on:click|stopPropagation>
      <video src={activeReel.video_url} autoplay controls></video>
      <div class="meta">
        <h2>{activeReel.title}</h2>
        {#if activeReel.auto_detected}
          <div class="auto-detect-notice">
            <span>🤖 Smart-placed in: <strong>{activeReel.category}</strong> ({activeReel.detection_confidence} confidence)</span>
          </div>
        {/if}
        {#if activeReel.faces && activeReel.faces.length > 0}
          <div class="face-characters">
            <h4>Black Characters Detected:</h4>
            {#each activeReel.faces as face}
              <div class="character-item">
                <img src={face.thumbnail || face.faceData} alt={face.character_name} class="character-thumb" />
                <span>{face.character_name}</span>
              </div>
            {/each}
          </div>
        {/if}
        {#if activeReel.user_image_used}
          <div class="user-image-notice">
            <span>👤 This content features your uploaded barbershop image</span>
          </div>
        {/if}
        {#if activeReel.isAIGenerated}
          <div class="ai-generated-notice">
            <span>🎨 This content features AI-generated Black Stories imagery</span>
          </div>
        {/if}
        <button on:click={() => activeReel = null}>CLOSE</button>
      </div>
    </div>
  </div>
{/if}

{#if adminMode}
  <div class="studio-modal" on:click|self={() => adminMode = false}>
    <div class="studio-box">
      <header class="studio-head">
        <div>
          <h2>🤖 SMART PRODUCTION STUDIO</h2>
          <p>AI-Powered Content Placement System</p>
        </div>
        <div class="studio-controls">
          <button class="refresh-btn" on:click={syncFromVault} title="Refresh content">🔄</button>
          <button class="close-x" on:click={() => adminMode = false}>✕</button>
        </div>
      </header>
      
      <input 
        type="file" 
        bind:this={fileInput}
        accept="video/mp4,video/*" 
        style="display: none"
        on:change={UIAgent.handleFileSelect}
      />
      
      <div class="studio-grid">
        <div class="forge-zone">
          <div class="smart-header">
            <div class="ai-badge">AI-POWERED</div>
            <h3>Smart Category Detection Active</h3>
            <p class="smart-subtitle">Content will be automatically placed in optimal category</p>
          </div>
          
          <label>PRODUCTION TITLE *</label>
          <input 
            bind:value={newTitle} 
            placeholder="e.g. 'Barbershop Stories' or 'Cyber Heist in Detroit'"
            on:input={detectCategoryFromTitle}
          />
          
          <div class="category-detection-hint">
            {#if detectedCategory && newCategory === "Auto-Detect"}
              <div class="detection-preview">
                <span class="detection-icon">🎯</span>
                <span class="detection-text">Will place in: <strong style="color: {UIAgent.getStudioConfigs(detectedCategory).color}">{detectedCategory}</strong></span>
              </div>
            {/if}
          </div>
          
          <label>CATEGORY PLACEMENT</label>
          <div class="category-selector">
            <select bind:value={newCategory}>
              {#each CATEGORIES as cat}
                <option value={cat}>
                  {#if cat === "Auto-Detect"}
                    🤖 {cat} (Recommended)
                  {:else}
                    <span style="color: {UIAgent.getStudioConfigs(cat).color}">●</span> {cat}
                  {/if}
                </option>
              {/each}
            </select>
            
            {#if newCategory === "Auto-Detect"}
              <div class="auto-detect-info">
                <span class="info-icon">ℹ️</span>
                <span class="info-text">AI will analyze title & content for optimal placement</span>
              </div>
            {:else}
              <div class="manual-select-info">
                <span class="info-icon">✋</span>
                <span class="info-text">Manual category selection active</span>
              </div>
            {/if}
          </div>
          
          <label>VIDEO SOURCE</label>
          <div class="source-options">
            <div class="url-input">
              <input bind:value={videoSource} placeholder="https://example.com/video.mp4" />
              <span class="input-label">OR</span>
            </div>
            
            <div class="file-upload-section">
              <button class="browse-btn" on:click={UIAgent.handleFileBrowse}>
                📁 BROWSE FOR VIDEO FILE
              </button>
              
              {#if selectedFile}
                <div class="file-info">
                  <div class="file-details">
                    <span class="file-name">📹 {selectedFile.name}</span>
                    <span class="file-size">({(selectedFile.size / 1024 / 1024).toFixed(1)} MB)</span>
                  </div>
                  <button 
                    class="clear-file" 
                    on:click={() => { selectedFile = null; videoSource = ''; fileInput.value = ''; }}
                  >
                    ✕
                  </button>
                </div>
              {/if}
            </div>
          </div>
          
          {#if processingVideo}
            <div class="processing-indicator">
              <div class="processing-spinner"></div>
              <span>🤖 ANALYZING VIDEO CONTENT FOR SMART PLACEMENT...</span>
            </div>
          {/if}
          
          <div 
            class="drop-zone" 
            class:active={dragActive}
            on:dragover|preventDefault={() => dragActive = true}
            on:dragleave={() => dragActive = false}
            on:drop={UIAgent.handleDrop}
          >
            {dragActive ? "RELEASE TO DROP MP4" : "DRAG & DROP MP4 FILE HERE"}
          </div>
          
          <button 
            class="submit-btn {newCategory === 'Auto-Detect' ? 'ai-submit' : ''}" 
            on:click={handleUploadWithFaces} 
            disabled={processingVideo || isAutoDetecting}
          >
            {#if isAutoDetecting}
              <span class="ai-thinking">🤔 Analyzing...</span>
            {:else if processingVideo}
              <span>🔍 Processing Faces...</span>
            {:else if newCategory === "Auto-Detect"}
              <span class="ai-upload">🚀 UPLOAD WITH SMART PLACEMENT</span>
            {:else}
              <span>📤 UPLOAD TO {newCategory}</span>
            {/if}
          </button>
          
          <div class="upload-status-indicator">
            {uploadStatus}
          </div>
        </div>
        
        <div class="asset-manager">
          <div class="smart-header">
            <div class="ai-badge">LIVE CONTENT</div>
            <h3>Smart Category Distribution</h3>
            <p class="smart-subtitle">View where content has been automatically placed</p>
          </div>
          
          <!-- NEW: Smart Category Distribution Block -->
          <div class="distribution-center">
            <h3 class="glow-text">Smart Category Distribution</h3>
            <div class="category-chips-grid">
              {#each Object.entries(categoryCounts) as [name, count]}
                <div class="category-chip futuristic-card">
                  <span 
                    contenteditable="true" 
                    on:blur={(e) => UIAgent.renameCategory(name, e.target.textContent)}
                    class="editable-label"
                  >
                    {name}
                  </span>
                  <span class="count-badge">{count} items</span>
                  <div class="glow-line"></div>
                </div>
              {/each}
            </div>
          </div>
          
          <div class="category-stats">
            {#each Object.keys(feed).filter(c => c !== "Auto-Detect") as cat}
              {#if feed[cat]}
                <div class="stat-item">
                  <span class="stat-category" style="border-left: 3px solid {UIAgent.getStudioConfigs(cat).color}">{cat}</span>
                  <span class="stat-count">{feed[cat].filter(r => !r.isPlaceholder).length} items</span>
                </div>
              {/if}
            {/each}
          </div>
          
          <label>RECENTLY ADDED PRODUCTIONS</label>
          <div class="asset-list">
            {#each Object.values(feed).flat()
              .filter(r => !r.isPlaceholder)
              .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
              .slice(0, 5) as reel}
              <div class="asset-item smart-item" style="border-left: 4px solid {UIAgent.getStudioConfigs(reel.category).color}">
                <div class="asset-info">
                  <span class="asset-title">{reel.title}</span>
                  <div class="asset-meta">
                    <span class="smart-category" style="background: {UIAgent.getStudioConfigs(reel.category).color + '20'}; color: {UIAgent.getStudioConfigs(reel.category).color}">{reel.category}</span>
                    {#if reel.auto_detected}
                      <span class="detection-meta">🤖 Auto-placed ({reel.detection_confidence || 'High'})</span>
                    {:else}
                      <span class="detection-meta">👤 Manually placed</span>
                    {/if}
                    {#if reel.created_at}
                      <span class="time-meta">⏱️ {new Date(reel.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                    {/if}
                  </div>
                </div>
                <button class="delete-btn" on:click={() => UIAgent.deleteProduction(reel.id)}>DELETE</button>
              </div>
            {/each}
          </div>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  /* Global Styles */
  :global(body) { 
    background: #000; 
    color: #fff; 
    margin: 0; 
    font-family: 'Inter', sans-serif; 
    overflow-x: hidden; 
    overflow-y: auto !important;
    height: auto !important;
  }

  header {
    background: linear-gradient(to bottom, rgba(0,0,0,0.4) 0%, transparent 100%);
    padding: 20px;
    text-align: center;
    position: relative;
    z-index: 10;
  }

  .hero-stage {
    position: relative;
    min-height: 500px;
    margin-top: -100px;
    display: flex;
    align-items: center;
    justify-content: center;
    
    background-image: 
      linear-gradient(to bottom, rgba(10,10,10,0.2) 0%, #0a0a0a 100%), 
      url('assets/backdrop.jpg') !important;
    background-size: cover;
    background-position: center 20%;
    background-repeat: no-repeat;
    
    border-bottom: 1px solid #1a1a1a;
  }

  .hero-wrap {
    text-align: center;
    max-width: 800px;
  }

  h1 {
    font-family: 'Orbitron', sans-serif;
    letter-spacing: 8px;
    text-shadow: 0 0 15px rgba(255, 255, 255, 0.4), 0 0 30px #ff00ff;
    color: #fff;
    margin: 10px 0;
  }

  .premium-tag {
    background: #ff00ff;
    color: #000;
    padding: 2px 10px;
    font-size: 0.8rem;
    font-weight: bold;
    letter-spacing: 2px;
  }

  .hero-wrap p {
    font-style: italic;
    color: #aaa;
    margin-top: 15px;
    font-size: 1.1rem;
    text-shadow: 2px 2px 4px #000;
  }

  .sentry-v3 {
    font-family: monospace;
    color: #00f2ff;
    font-size: 0.7rem;
    letter-spacing: 3px;
    background: rgba(0,0,0,0.5);
    display: inline-block;
    padding: 3px 8px;
    border: 1px solid #00f2ff;
  }

  main { 
    position: relative;
    width: 100%;
    min-height: 100vh;
    display: block; 
  }

  .blur { 
    filter: blur(40px) brightness(0.4); 
    transform: scale(0.98); 
    pointer-events: none; 
    transition: 0.8s; 
  }

  .ghost-portal { 
    position: fixed; 
    top: 0; 
    left: 0; 
    width: 80px; 
    height: 80px; 
    z-index: 999999; 
    cursor: crosshair; 
  }

  header { 
    padding: 40px 6% 20px; 
    display: flex; 
    justify-content: space-between; 
    align-items: center; 
  }
  
  h1 { 
    color: #E50914; 
    margin: 0; 
    font-weight: 900; 
    letter-spacing: -3px; 
  }
  
  .sentry-v3 span { 
    display: inline-block; 
    width: 8px; 
    height: 8px; 
    background: #E50914; 
    border-radius: 50%; 
    box-shadow: 0 0 10px #E50914; 
    margin-right: 10px; 
  }

  .hero-stage { 
    height: 45vh; 
    width: 88%; 
    margin: 0 auto 50px; 
    background: linear-gradient(to right, #000, transparent), url('https://picsum.photos/id/1/1200/600'); 
    background-size: cover; 
    border-radius: 24px; 
    display: flex; 
    align-items: center; 
    padding: 50px; 
  }

  .shelf { 
    margin-bottom: 60px; 
    display: block; 
    width: 100%; 
  }
  
  .shelf h2 { 
    padding-left: 6%; 
    margin-left: 6%; 
    border-left: 4px solid; /* Color will be set dynamically */
    font-size: 1.4rem; 
  }

  .row { 
    display: flex; 
    gap: 20px; 
    overflow-x: auto; 
    padding: 10px 6% 40px; 
    scrollbar-width: none; 
  }
  
  .row::-webkit-scrollbar { 
    display: none; 
  }

  .reel-card { 
    flex: 0 0 240px; 
    cursor: pointer; 
    transition: 0.4s; 
    position: relative; 
    overflow: hidden; 
  }
  
  .card-inner { 
    position: relative; 
    aspect-ratio: 2/3; 
    background: #0a0a0a; 
    border-radius: 15px; 
    overflow: hidden; 
    border: 1px solid #1a1a1a; 
  }
  
  .card-inner img.has-faces {
    filter: contrast(1.1) brightness(1.05) saturate(1.1);
  }
  
  .card-inner img.face-thumbnail {
    object-fit: cover;
    object-position: center;
  }
  
  .savvy-hover { 
    position: absolute; 
    inset: 0; 
    display: flex; 
    flex-direction: column; 
    align-items: center; 
    justify-content: center; 
    opacity: 0; 
    transition: 0.3s; 
    background: rgba(0,0,0,0.4); 
  }
  
  .reel-card:hover .savvy-hover { 
    opacity: 1; 
  }
  
  .reel-card:hover { 
    transform: scale(1.05); 
  }

  .is-ghost { 
    opacity: 0.5; 
    filter: grayscale(1); 
  }

  .face-count {
    position: absolute;
    top: 10px;
    left: 10px;
    background: rgba(76, 175, 80, 0.9);
    color: white;
    padding: 0.2rem 0.5rem;
    border-radius: 12px;
    font-size: 0.6rem;
    font-weight: 600;
  }

  .ai-tags {
    position: absolute;
    bottom: 10px;
    right: 10px;
    background: rgba(139, 92, 246, 0.8);
    color: white;
    padding: 0.3rem 0.6rem;
    border-radius: 15px;
    font-size: 0.7rem;
    font-weight: 600;
  }

  .reel-meta {
    font-size: 0.8rem;
    color: #a0aec0;
    margin-top: 0.5rem;
  }

  .face-characters {
    margin: 20px 0;
    padding: 20px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 10px;
  }

  .face-characters h4 {
    color: #E50914;
    margin-bottom: 15px;
  }

  .character-item {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    margin: 10px;
    padding: 10px;
    background: rgba(0, 0, 0, 0.5);
    border-radius: 8px;
  }

  .character-item span {
    color: white;
    font-size: 0.8rem;
    text-align: center;
  }

  .processing-indicator {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    background: rgba(229, 9, 20, 0.1);
    border-radius: 12px;
    margin-bottom: 20px;
  }

  .processing-spinner {
    width: 20px;
    height: 20px;
    border: 2px solid #333;
    border-top: 2px solid #E50914;
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin-right: 10px;
  }

  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }

  .source-options { 
    margin-bottom: 20px; 
  }
  
  .url-input { 
    position: relative; 
    margin-bottom: 15px; 
  }
  
  .input-label { 
    position: absolute; 
    right: 15px; 
    top: 50%; 
    transform: translateY(-50%); 
    background: #333; 
    color: #999; 
    padding: 2px 8px; 
    border-radius: 4px; 
    font-size: 0.8rem; 
  }
  
  .file-upload-section { 
    margin-bottom: 20px; 
  }
  
  .browse-btn { 
    width: 100%; 
    background: #2a2a2a; 
    color: #fff; 
    padding: 15px; 
    border: 2px dashed #444; 
    border-radius: 12px; 
    font-weight: 600; 
    cursor: pointer; 
    transition: all 0.3s; 
  }
  
  .browse-btn:hover { 
    background: #333; 
    border-color: #E50914; 
  }
  
  .file-info { 
    display: flex; 
    align-items: center; 
    justify-content: space-between; 
    background: #111; 
    padding: 12px; 
    border-radius: 8px; 
    margin-top: 10px; 
    border: 1px solid #333; 
  }
  
  .file-name { 
    color: #4ECDC4; 
    font-weight: 500; 
  }
  
  .file-size { 
    color: #999; 
    font-size: 0.9rem; 
  }
  
  .clear-file { 
    background: #ff4444; 
    color: white; 
    border: none; 
    padding: 4px 8px; 
    border-radius: 4px; 
    cursor: pointer; 
    font-size: 0.8rem; 
  }
  
  .submit-btn { 
    width: 100%; 
    background: #E50914; 
    color: #fff; 
    padding: 20px; 
    border: none; 
    border-radius: 12px; 
    font-weight: 900; 
    cursor: pointer; 
    transition: all 0.3s; 
  }
  
  .submit-btn:hover:not(:disabled) { 
    background: #ff1a1a; 
  }
  
  .submit-btn:disabled { 
    background: #666; 
    cursor: not-allowed; 
  }

  .asset-list { 
    background: #111; 
    border-radius: 12px; 
    height: 300px; 
    overflow-y: auto; 
    padding: 10px; 
  }

  .studio-modal { 
    position: fixed; 
    inset: 0; 
    background: rgba(0,0,0,0.9); 
    backdrop-filter: blur(40px); 
    z-index: 10000; 
    display: flex; 
    align-items: center; 
    justify-content: center; 
  }
  
  .studio-box { 
    background: #080808; 
    border: 1px solid #222; 
    width: 900px; 
    max-height: 90vh; 
    border-radius: 30px; 
    padding: 50px; 
    overflow-y: auto; 
  }
  
  .studio-grid { 
    display: grid; 
    grid-template-columns: 1fr 1fr; 
    gap: 40px; 
  }
  
  label { 
    color: #ccc; 
    font-weight: 600; 
    margin-bottom: 8px; 
    display: block; 
  }

  /* Smart Category Detection Styles */
  .smart-header {
    background: rgba(139, 69, 19, 0.1);
    border: 1px solid rgba(139, 69, 19, 0.3);
    border-radius: 12px;
    padding: 15px;
    margin-bottom: 20px;
  }
  
  .ai-badge {
    display: inline-block;
    background: linear-gradient(135deg, #8B4513, #E50914);
    color: white;
    padding: 4px 12px;
    border-radius: 20px;
    font-size: 0.8rem;
    font-weight: 600;
    margin-bottom: 10px;
  }
  
  .smart-subtitle {
    color: #a0aec0;
    font-size: 0.9rem;
    margin-top: 5px;
  }
  
  .category-detection-hint {
    margin: 10px 0 20px 0;
    min-height: 30px;
  }
  
  .detection-preview {
    background: rgba(76, 175, 80, 0.1);
    border: 1px solid rgba(76, 175, 80, 0.3);
    border-radius: 8px;
    padding: 10px;
    display: flex;
    align-items: center;
    animation: pulse 2s infinite;
  }
  
  @keyframes pulse {
    0% { opacity: 0.8; }
    50% { opacity: 1; }
    100% { opacity: 0.8; }
  }
  
  .detection-icon {
    font-size: 1.2rem;
    margin-right: 10px;
  }
  
  .detection-text {
    color: #4CAF50;
    font-size: 0.9rem;
  }
  
  .category-selector {
    margin-bottom: 15px;
  }
  
  .auto-detect-info, .manual-select-info {
    background: rgba(255, 193, 7, 0.1);
    border: 1px solid rgba(255, 193, 7, 0.3);
    border-radius: 8px;
    padding: 8px 12px;
    margin-top: 8px;
    display: flex;
    align-items: center;
    color: #FFC107;
  }
  
  .manual-select-info {
    background: rgba(33, 150, 243, 0.1);
    border-color: rgba(33, 150, 243, 0.3);
    color: #2196F3;
  }
  
  .info-icon {
    margin-right: 8px;
    font-size: 0.9rem;
  }
  
  .info-text {
    font-size: 0.85rem;
  }
  
  .ai-submit {
    background: linear-gradient(135deg, #8B4513, #E50914);
  }
  
  .ai-submit:hover {
    background: linear-gradient(135deg, #A0522D, #FF1A1A);
  }
  
  .ai-thinking, .ai-upload {
    font-weight: 600;
  }
  
  .upload-status-indicator {
    text-align: center;
    margin-top: 15px;
    padding: 10px;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 8px;
    font-size: 0.9rem;
    min-height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  
  .category-stats {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 10px;
    margin-bottom: 20px;
  }
  
  .stat-item {
    background: rgba(255, 255, 255, 0.05);
    border-radius: 8px;
    padding: 10px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  
  .stat-category {
    font-weight: 500;
    color: #fff;
    padding-left: 10px;
  }
  
  .stat-count {
    background: rgba(139, 69, 19, 0.3);
    padding: 2px 8px;
    border-radius: 12px;
    font-size: 0.8rem;
  }
  
  .smart-item {
    border-left: 4px solid #8B4513;
  }
  
  .smart-category {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 12px;
    font-size: 0.7rem;
    font-weight: 600;
    margin-right: 8px;
  }
  
  .detection-meta {
    font-size: 0.7rem;
    color: #888;
  }
  
  .time-meta {
    font-size: 0.7rem;
    color: #888;
    margin-left: 8px;
  }
  
  .file-details {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: 1;
  }
  
  .auto-detected-badge {
    position: absolute;
    top: 10px;
    left: 10px;
    background: rgba(139, 69, 19, 0.9);
    color: #fff;
    padding: 0.2rem 0.5rem;
    border-radius: 12px;
    font-size: 0.6rem;
    font-weight: 600;
    z-index: 2;
  }
  
  .auto-detect-notice {
    background: rgba(139, 69, 19, 0.1);
    border: 1px solid rgba(139, 69, 19, 0.3);
    border-radius: 8px;
    padding: 10px;
    margin: 10px 0;
    text-align: center;
    color: #ffd700;
    font-size: 0.9rem;
  }

  /* Studio Controls */
  .studio-controls {
    display: flex;
    gap: 10px;
  }

  .refresh-btn {
    background: rgba(139, 69, 19, 0.3);
    color: #ffd700;
    border: 1px solid rgba(139, 69, 19, 0.5);
    border-radius: 6px;
    padding: 8px 12px;
    cursor: pointer;
    font-size: 0.9rem;
    transition: all 0.2s;
  }

  .refresh-btn:hover {
    background: rgba(139, 69, 19, 0.6);
    transform: rotate(30deg);
  }

  /* Original Styles */
  .user-image {
    filter: contrast(1.3) saturate(1.4) brightness(1.1);
    border: 2px solid rgba(255, 215, 0, 0.6);
  }

  .user-image-badge {
    position: absolute;
    top: 10px;
    right: 10px;
    background: rgba(255, 215, 0, 0.9);
    color: #000;
    padding: 0.2rem 0.5rem;
    border-radius: 12px;
    font-size: 0.6rem;
    font-weight: 600;
    z-index: 2;
  }

  .user-image-notice {
    background: rgba(255, 215, 0, 0.1);
    border: 1px solid rgba(255, 215, 0, 0.3);
    border-radius: 8px;
    padding: 10px;
    margin: 10px 0;
    text-align: center;
    color: #ffd700;
    font-size: 0.9rem;
  }

  .ai-generated {
    filter: contrast(1.1) saturate(1.2) brightness(1.05);
    border: 1px solid rgba(139, 69, 19, 0.4);
  }

  .ai-generated-badge {
    position: absolute;
    top: 10px;
    left: 10px;
    background: rgba(255, 107, 107, 0.9);
    color: #fff;
    padding: 0.2rem 0.5rem;
    border-radius: 12px;
    font-size: 0.6rem;
    font-weight: 600;
    z-index: 2;
  }

  .ai-generated-notice {
    background: rgba(255, 107, 107, 0.1);
    border: 1px solid rgba(255, 107, 107, 0.3);
    border-radius: 8px;
    padding: 10px;
    margin: 10px 0;
    text-align: center;
    color: #ff6b6b;
    font-size: 0.9rem;
  }

  .black-stories-thumbnail {
    filter: contrast(1.2) saturate(1.3) brightness(1.05);
    border: 1px solid rgba(139, 69, 19, 0.3);
  }

  .black-stories-badge {
    position: absolute;
    top: 10px;
    right: 10px;
    background: rgba(139, 69, 19, 0.9);
    color: #fff;
    padding: 0.2rem 0.5rem;
    border-radius: 12px;
    font-size: 0.6rem;
    font-weight: 600;
    z-index: 2;
  }

  .character-thumb {
    width: 60px;
    height: 60px;
    border-radius: 50%;
    object-fit: cover;
    margin-bottom: 5px;
    border: 2px solid #8B4513;
  }

  .admin-controls {
    position: absolute;
    top: 10px;
    right: 10px;
    z-index: 10;
  }

  .mini-delete-btn {
    background: rgba(229, 9, 20, 0.8);
    color: white;
    border: none;
    border-radius: 50%;
    width: 30px;
    height: 30px;
    cursor: pointer;
    font-size: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
  }

  .mini-delete-btn:hover {
    background: #E50914;
    transform: scale(1.1);
  }

  .delete-btn {
    background: #E50914;
    color: white;
    border: none;
    padding: 6px 12px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.8rem;
    transition: all 0.2s;
  }

  .delete-btn:hover {
    background: #ff1a1a;
    transform: translateY(-1px);
  }

  .asset-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px;
    border-bottom: 1px solid #222;
    transition: background 0.2s;
  }

  .asset-item:hover {
    background: #1a1a1a;
  }

  .asset-info {
    display: flex;
    flex-direction: column;
    flex: 1;
  }

  .asset-title {
    font-weight: 500;
    color: #fff;
    margin-bottom: 4px;
  }

  .asset-meta {
    font-size: 0.8rem;
    color: #888;
  }

  /* Theater Modal */
  .theater {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0,0,0,0.95);
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .stage {
    background: #000;
    border-radius: 15px;
    overflow: hidden;
    max-width: 90%;
    max-height: 90%;
  }

  .stage video {
    width: 100%;
    max-height: 70vh;
  }

  .meta {
    padding: 20px;
    background: #111;
  }

  .forge-loader {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 200px;
    font-size: 1.5rem;
    color: #E50914;
  }

  footer {
    text-align: center;
    padding: 40px;
    color: #666;
    border-top: 1px solid #222;
    margin-top: 60px;
  }

  .drop-zone {
    border: 2px dashed #444;
    border-radius: 12px;
    padding: 40px;
    text-align: center;
    margin: 20px 0;
    transition: all 0.3s;
  }

  .drop-zone.active {
    border-color: #E50914;
    background: rgba(229, 9, 20, 0.1);
  }

  .close-x {
    background: none;
    border: none;
    color: #fff;
    font-size: 1.5rem;
    cursor: pointer;
    padding: 5px 10px;
  }

  .studio-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 30px;
  }

  /* NEW: Smart Category Distribution Styles */
  .distribution-center {
    background: rgba(15, 15, 15, 0.8);
    backdrop-filter: blur(10px);
    border: 1px solid rgba(0, 242, 255, 0.2);
    border-radius: 16px;
    padding: 24px;
    margin-bottom: 24px;
    box-shadow: 0 0 30px rgba(0, 242, 255, 0.15);
  }

  .glow-text {
    color: #00f2ff;
    text-align: center;
    font-size: 1.4rem;
    margin-bottom: 20px;
    text-shadow: 0 0 15px rgba(0, 242, 255, 0.7);
    font-weight: 700;
    letter-spacing: 1px;
    font-family: 'Orbitron', sans-serif;
  }

  .category-chips-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
    justify-content: center;
  }

  .category-chip {
    background: rgba(15, 15, 15, 0.9);
    backdrop-filter: blur(10px);
    border: 1px solid rgba(0, 242, 255, 0.3);
    border-radius: 24px;
    padding: 12px 20px;
    display: flex;
    align-items: center;
    gap: 10px;
    position: relative;
    min-width: 140px;
    cursor: pointer;
    transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3);
  }

  .category-chip:hover {
    border-color: #00f2ff;
    box-shadow: 0 0 25px rgba(0, 242, 255, 0.5);
    transform: translateY(-4px) scale(1.05);
    background: rgba(20, 20, 20, 0.95);
  }

  .futuristic-card {
    position: relative;
    overflow: hidden;
    border-radius: 24px;
  }

  .editable-label {
    color: #fff;
    font-weight: 600;
    font-size: 1rem;
    cursor: text;
    padding: 6px 10px;
    border-radius: 8px;
    min-width: 80px;
    background: transparent;
    transition: all 0.3s;
    font-family: 'Inter', sans-serif;
  }

  .editable-label:focus {
    outline: none;
    color: #00f2ff;
    text-shadow: 0 0 10px #00f2ff;
    background: rgba(0, 242, 255, 0.1);
    box-shadow: 0 0 15px rgba(0, 242, 255, 0.3);
  }

  .count-badge {
    background: linear-gradient(135deg, #E50914, #ff1a1a);
    color: white;
    font-size: 0.8rem;
    font-weight: bold;
    padding: 4px 12px;
    border-radius: 20px;
    white-space: nowrap;
    box-shadow: 0 2px 8px rgba(229, 9, 20, 0.4);
  }

  .glow-line {
    position: absolute;
    bottom: 0;
    left: 15%;
    width: 70%;
    height: 3px;
    background: linear-gradient(90deg, transparent, #00f2ff, #ff00ff, #00f2ff, transparent);
    border-radius: 3px;
    opacity: 0.8;
    transition: opacity 0.3s;
  }

  .category-chip:hover .glow-line {
    opacity: 1;
    animation: neon-glow 2s infinite alternate;
  }

  @keyframes neon-glow {
    0% { opacity: 0.7; }
    100% { opacity: 1; }
  }

  /* Enhanced futuristic effects */
  .category-chip::before {
    content: '';
    position: absolute;
    top: -2px;
    left: -2px;
    right: -2px;
    bottom: -2px;
    background: linear-gradient(45deg, #00f2ff, #ff00ff, #00f2ff);
    border-radius: 26px;
    z-index: -1;
    opacity: 0;
    transition: opacity 0.4s;
  }

  .category-chip:hover::before {
    opacity: 0.3;
  }

  /* Additional futuristic touches */
  .smart-header {
    background: linear-gradient(135deg, rgba(139, 69, 19, 0.1), rgba(0, 242, 255, 0.1));
    border: 1px solid rgba(0, 242, 255, 0.3);
    box-shadow: 0 0 20px rgba(0, 242, 255, 0.1);
  }

  .ai-badge {
    background: linear-gradient(135deg, #00f2ff, #ff00ff);
    box-shadow: 0 0 15px rgba(0, 242, 255, 0.5);
  }

  /* Enhanced category selector */
  .category-selector select {
    background: rgba(15, 15, 15, 0.9);
    border: 1px solid rgba(0, 242, 255, 0.3);
    color: #fff;
    padding: 12px;
    border-radius: 12px;
    font-size: 1rem;
    transition: all 0.3s;
    cursor: pointer;
  }

  .category-selector select:focus {
    outline: none;
    border-color: #00f2ff;
    box-shadow: 0 0 20px rgba(0, 242, 255, 0.3);
  }

  .category-selector option {
    background: #000;
    color: #fff;
    padding: 10px;
  }

  /* Enhanced upload button */
  .ai-submit {
    background: linear-gradient(135deg, #00f2ff, #8B4513, #E50914);
    background-size: 300% 300%;
    animation: gradient-shift 3s ease infinite;
    border: none;
    box-shadow: 0 0 30px rgba(0, 242, 255, 0.4);
  }

  @keyframes gradient-shift {
    0% { background-position: 0% 50%; }
    50% { background-position: 100% 50%; }
    100% { background-position: 0% 50%; }
  }

  .ai-submit:hover {
    box-shadow: 0 0 40px rgba(0, 242, 255, 0.6);
    transform: translateY(-2px);
  }

  .ai-upload {
    font-weight: 700;
    letter-spacing: 1px;
    text-shadow: 0 0 10px rgba(255, 255, 255, 0.5);
  }
</style>

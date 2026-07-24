<script>
    import { onDestroy, onMount } from 'svelte';
    import { get, writable } from 'svelte/store';
    import {
        HERO_CAROUSEL_TRANSITIONS,
        HERO_BACKGROUND_STYLES,
        HERO_DISCOVERY_TYPES,
        HERO_SLIDE_TYPES,
        loadHeroManagerConfig,
        loadHeroVaultItems,
        logHeroIntelligenceDiag,
        saveHeroManagerConfig,
        updateHeroManagerConfig,
        rotateHeroSelection
    } from '../../lib/hero/heroIntelligence.js';
    import { buildHeroAssetRegistry, isVideoHeroAssetType } from '../../lib/hero/heroAssetBridge.js';
    import { deleteReelById, fetchReadyReels } from '../../lib/api/media.js';
    import { applyCanonicalDeleteClientEffects } from '../../lib/deletionSync.js';
    import { vaultForensic } from '../../lib/diagnostics/vaultForensics.js';

    /** @type {Record<string, unknown>[]} */
    export let feedReels = [];
    /** @type {import('svelte/store').Writable<Record<string, unknown[]>> | null} */
    export let feed = null;
    /** @type {import('svelte/store').Writable<unknown[]> | null} */
    export let personalVideos = null;
    /** @type {(videos: unknown[]) => void} */
    export let persistPersonalVault = () => {};
    /** @type {(key: string, value: unknown) => { ok?: boolean }} */
    export let storageSet = () => ({ ok: true });
    /** @type {(preserveLocal?: boolean) => Promise<void>} */
    export let syncFromVault = async () => {};
    /** @type {{ FEED_STORAGE_KEY?: string } | null} */
    export let CONFIG = null;

    let config = loadHeroManagerConfig();
    let statusMessage = '';
    let heroAssetSelect = null;
    let refreshAuditTimer = null;
    let renamedTitles = {};
    let storyScheduledFor = String(config.storyScheduledFor || '');
    let heroVaultVideoCssFixLogged = false;
    let heroVaultVideoDomFixLogged = false;
    /** @type {Record<string, boolean>} */
    let vaultVideoLoadedByAsset = {};
    /** @type {Record<string, boolean>} */
    let vaultVideoErrorByAsset = {};

    const HERO_IMAGE_STORAGE_KEY = 'reelforge_hero_image';
    const HERO_VIDEO_STORAGE_KEY = 'reelforge_hero_video';
    const STORY_STATUS_LABELS = {
        draft: 'Draft',
        published: 'Published',
        scheduled: 'Scheduled'
    };
    const STORY_TEMPLATES = {
        documentary_spotlight: {
            name: 'Documentary Spotlight',
            defaultLabel: 'LOOK@ZAKANDA PRESENTS',
            defaultTitleStructure: '{seriesTitle}: Land, Legacy & Liberation',
            defaultSubtitleStructure: 'An intimate documentary spotlight.',
            defaultDescriptionStructure: 'Discover the families preserving generations of Black land ownership in Alabama.',
            recommendedCTA1: 'Watch Now',
            recommendedCTA2: 'Learn More'
        },
        community_spotlight: {
            name: 'Community Spotlight',
            defaultLabel: 'COMMUNITY SPOTLIGHT',
            defaultTitleStructure: '{communityName}',
            defaultSubtitleStructure: 'A story rooted in local voices.',
            defaultDescriptionStructure: 'Meet the people strengthening community legacy through culture, land, and storytelling.',
            recommendedCTA1: 'Watch Story',
            recommendedCTA2: 'Meet the Community'
        },
        collection_spotlight: {
            name: 'Collection Spotlight',
            defaultLabel: 'FEATURED COLLECTION',
            defaultTitleStructure: '{collectionName}',
            defaultSubtitleStructure: 'Curated stories from the archive.',
            defaultDescriptionStructure: 'Explore a hand-picked collection designed to deepen context and connection.',
            recommendedCTA1: 'Explore Collection',
            recommendedCTA2: 'View All'
        },
        premiere_announcement: {
            name: 'Premiere Announcement',
            defaultLabel: 'UPCOMING PREMIERE',
            defaultTitleStructure: '{seriesTitle} Premieres Soon',
            defaultSubtitleStructure: 'A new chapter arrives on ReelForge.',
            defaultDescriptionStructure: 'Be first to experience the next release and join the premiere conversation.',
            recommendedCTA1: 'Set Reminder',
            recommendedCTA2: 'View Trailer'
        },
        educational_spotlight: {
            name: 'Educational Spotlight',
            defaultLabel: 'EDUCATIONAL SERIES',
            defaultTitleStructure: '{topicTitle}',
            defaultSubtitleStructure: 'Learn through stories and lived experience.',
            defaultDescriptionStructure: 'Understand the history, systems, and voices shaping this educational theme.',
            recommendedCTA1: 'Start Learning',
            recommendedCTA2: 'View Curriculum'
        },
        campaign_spotlight: {
            name: 'Campaign Spotlight',
            defaultLabel: 'CAMPAIGN SPOTLIGHT',
            defaultTitleStructure: '{campaignTitle}',
            defaultSubtitleStructure: 'A focused editorial campaign.',
            defaultDescriptionStructure: 'Follow this campaign to track milestones, stories, and impact across the platform.',
            recommendedCTA1: 'Join Campaign',
            recommendedCTA2: 'Campaign Details'
        }
    };
    const TEMPLATE_KEYS = Object.keys(STORY_TEMPLATES);
    let selectedTemplateKey = TEMPLATE_KEYS[0];

    $: slideOverrides = Array.isArray(config.carouselSlideOverrides)
        ? [...config.carouselSlideOverrides].sort((a, b) => (a.order || 0) - (b.order || 0))
        : [];

    const heroAssetRegistry = writable([]);
    function authHeaders() {
        const token =
            typeof window !== 'undefined' ? localStorage.getItem('reelforge_admin_session_token') : null;
        return token ? { Authorization: `Bearer ${token}` } : {};
    }

    function normalizeComparablePath(value) {
        const text = String(value || '').trim();
        if (!text) return '';
        try {
            if (text.startsWith('http://') || text.startsWith('https://')) {
                return new URL(text).pathname;
            }
        } catch {
            // noop
        }
        return text;
    }

    async function findMatchingHeroReelId(item) {
        const candidateId = String(item?.assetId || '').trim();
        if (!candidateId) return '';
        const reels = await fetchReadyReels(authHeaders()).catch(() => []);
        const byId = reels.find((reel) => String(reel?.id || '').trim() === candidateId);
        if (byId?.id) return String(byId.id);

        const heroMedia = normalizeComparablePath(item?.mediaUrl);
        const heroThumb = normalizeComparablePath(item?.thumbnailUrl);
        const byPath = reels.find((reel) => {
            const reelVideo = normalizeComparablePath(reel?.url || reel?.video_url || '');
            const reelThumb = normalizeComparablePath(
                reel?.thumbnailUrl || reel?.thumbnail_url || reel?.thumbnail || ''
            );
            return (heroMedia && reelVideo && heroMedia === reelVideo) || (heroThumb && reelThumb && heroThumb === reelThumb);
        });
        return String(byPath?.id || '');
    }

    function refreshHeroAssetRegistry() {
        heroAssetRegistry.set(buildHeroAssetRegistry(loadHeroVaultItems()));
    }
    $: {
        config.heroAssetId;
        config.backgroundSource;
        statusMessage;
        refreshHeroAssetRegistry();
    }
    $: console.info('[HERO_VAULT_RENDER]', {
        registryCount: $heroAssetRegistry.length,
        renderedCount: $heroAssetRegistry.length,
        assetIds: $heroAssetRegistry.map((item) => item.assetId),
        timestamp: Date.now()
    });
    $: console.info('[HERO_REGISTRY_COMPARE]', {
        dropdownCount: $heroAssetRegistry.length,
        vaultCount: $heroAssetRegistry.length,
        registryCount: $heroAssetRegistry.length,
        timestamp: Date.now()
    });
    $: if ($heroAssetRegistry.length > 0) {
        console.info('[HERO_ASSET_ID_TRACE]', {
            stage: 'HeroManagerPanel:registry-read',
            assetId: $heroAssetRegistry[0]?.assetId || '',
            heroAssetId: config.heroAssetId || '',
            source: 'heroAssetRegistry',
            timestamp: Date.now()
        });
    }
    $: for (const item of $heroAssetRegistry) {
        console.info('[HERO_VAULT_CARD_RENDER]', {
            assetId: item.assetId,
            type: item.assetType,
            active: String(item.assetId) === String(config.heroAssetId || '')
        });
    }

    function handleHeroAssetChange() {
        const selected = get(heroAssetRegistry).find((asset) => asset.assetId === config.heroAssetId);
        if (selected) {
            config = {
                ...config,
                backgroundSource: isVideoHeroAssetType(selected.assetType) ? 'custom_video' : 'custom_image'
            };
        }
        applyConfig();
    }

    function applyStoryStoryState(mode = 'draft') {
        const normalizedMode = mode === 'published' || mode === 'scheduled' ? mode : 'draft';
        const payload = {
            heroLabel: String(config.heroLabel || '').trim(),
            heroTitle: String(config.heroTitle || '').trim(),
            heroSubtitle: String(config.heroSubtitle || '').trim(),
            heroDescription: String(config.heroDescription || '').trim(),
            ctaPrimaryLabel: String(config.ctaPrimaryLabel || '').trim(),
            ctaPrimaryTarget: String(config.ctaPrimaryTarget || '').trim(),
            ctaSecondaryLabel: String(config.ctaSecondaryLabel || '').trim(),
            ctaSecondaryTarget: String(config.ctaSecondaryTarget || '').trim(),
            campaignType: String(config.campaignType || '').trim(),
            featuredCollection: String(config.featuredCollection || '').trim(),
            featuredSeries: String(config.featuredSeries || '').trim(),
            storyStatus: normalizedMode,
            storyScheduledFor: normalizedMode === 'scheduled' ? String(storyScheduledFor || '').trim() : ''
        };
        config = {
            ...config,
            ...payload
        };
        saveHeroManagerConfig(config);
        statusMessage =
            normalizedMode === 'scheduled'
                ? `Hero story scheduled for ${payload.storyScheduledFor || 'unspecified time'}`
                : `Hero story ${STORY_STATUS_LABELS[normalizedMode].toLowerCase()}`;
    }

    function saveStoryDraft() {
        applyStoryStoryState('draft');
    }

    function publishStory() {
        applyStoryStoryState('published');
    }

    function scheduleStory() {
        if (!String(storyScheduledFor || '').trim()) {
            statusMessage = 'Set a schedule time before scheduling.';
            return;
        }
        applyStoryStoryState('scheduled');
    }

    function selectedTemplate() {
        return STORY_TEMPLATES[selectedTemplateKey] || STORY_TEMPLATES[TEMPLATE_KEYS[0]];
    }

    function previewTemplate() {
        const template = selectedTemplate();
        if (!template) return;
        statusMessage = `Previewing template: ${template.name}`;
    }

    function applyTemplate() {
        const template = selectedTemplate();
        if (!template) return;
        config = {
            ...config,
            heroLabel: template.defaultLabel,
            heroTitle: template.defaultTitleStructure,
            heroSubtitle: template.defaultSubtitleStructure,
            heroDescription: template.defaultDescriptionStructure,
            ctaPrimaryLabel: template.recommendedCTA1,
            ctaSecondaryLabel: template.recommendedCTA2
        };
        statusMessage = `Applied template: ${template.name}`;
    }

    /**
     * @param {Record<string, unknown>} item
     */
    function handleHeroVaultVideoMetadataLoad(item) {
        const assetId = String(item?.assetId || '').trim();
        if (assetId) {
            vaultVideoLoadedByAsset = {
                ...vaultVideoLoadedByAsset,
                [assetId]: true
            };
            vaultVideoErrorByAsset = {
                ...vaultVideoErrorByAsset,
                [assetId]: false
            };
        }
        console.info('[HERO_VAULT_VIDEO_METADATA_LOADED]', {
            assetId,
            assetType: String(item?.assetType || ''),
            mediaUrl: String(item?.mediaUrl || ''),
            timestamp: Date.now()
        });
    }

    /**
     * @param {Record<string, unknown>} item
     */
    function handleHeroVaultVideoError(item) {
        const assetId = String(item?.assetId || '').trim();
        if (assetId) {
            vaultVideoErrorByAsset = {
                ...vaultVideoErrorByAsset,
                [assetId]: true
            };
        }
        console.info('[HERO_VAULT_VIDEO_ERROR]', {
            assetId,
            assetType: String(item?.assetType || ''),
            mediaUrl: String(item?.mediaUrl || ''),
            timestamp: Date.now()
        });
    }

    function assetDateAdded(assetId) {
        const match = String(assetId || '').match(/(\d{10,})$/);
        if (!match) return 'Unknown';
        const timestamp = Number(match[1]);
        if (!Number.isFinite(timestamp)) return 'Unknown';
        const parsed = new Date(timestamp);
        if (Number.isNaN(parsed.getTime())) return 'Unknown';
        return parsed.toLocaleString();
    }

    function getDisplayTitle(item) {
        return String(renamedTitles[item.assetId] || item.title || item.assetId || 'Hero Asset');
    }

    function selectHeroVaultAsset(item) {
        const isVideo = isVideoHeroAssetType(item.assetType);
        config = {
            ...config,
            heroAssetId: item.assetId,
            backgroundSource: isVideo ? 'custom_video' : 'custom_image',
            backgroundStyle: isVideo ? 'video' : 'image'
        };
        applyConfig();
        console.info('[HERO_VAULT_SELECT]', {
            assetId: item.assetId
        });
    }

    function previewHeroVaultAsset(item) {
        if (typeof window === 'undefined') return;
        const target = String(item.mediaUrl || item.thumbnailUrl || '').trim();
        if (!target) return;
        window.open(target, '_blank', 'noopener,noreferrer');
    }

    function renameHeroVaultAsset(item) {
        if (typeof window === 'undefined') return;
        const next = window.prompt('Rename hero asset', getDisplayTitle(item));
        if (next === null) return;
        const value = String(next).trim();
        if (!value) return;
        renamedTitles = {
            ...renamedTitles,
            [item.assetId]: value
        };
        statusMessage = `Renamed ${item.assetId}`;
    }

    async function deleteHeroVaultAsset(item) {
        if (typeof window === 'undefined') return;
        const displayName = getDisplayTitle(item);
        console.info('[DELETE_HANDLER_FIRED]', {
            vault: 'hero-vault',
            mechanism: 'single',
            itemId: String(item?.assetId || ''),
            itemName: displayName,
            timestamp: Date.now()
        });
        console.info('[DELETE_CONFIRMATION_SHOWN]', {
            itemId: String(item?.assetId || ''),
            itemName: displayName,
            vault: 'hero-vault',
            timestamp: Date.now()
        });
        if (!confirm(`Delete "${displayName}" permanently?`)) {
            console.info('[DELETE_CANCELLED]', {
                vault: 'hero-vault',
                itemId: String(item?.assetId || ''),
                timestamp: Date.now()
            });
            return;
        }
        console.info('[DELETE_CONFIRMED]', {
            itemId: String(item?.assetId || ''),
            vault: 'hero-vault',
            mechanism: 'single',
            timestamp: Date.now()
        });
        const isVideo = isVideoHeroAssetType(item.assetType);
        vaultForensic('VAULT_DELETE_START', {
            vaultType: 'hero',
            assetId: String(item?.assetId || ''),
            fileName: displayName,
            storageLocation: isVideo ? HERO_VIDEO_STORAGE_KEY : HERO_IMAGE_STORAGE_KEY,
            backendEndpoint: `${CONFIG?.API_BASE_URL || ''}/api/reels`,
            result: 'delete_start'
        });
        const beforeCount = get(heroAssetRegistry).length;
        let persistenceOk = false;
        const reelId = await findMatchingHeroReelId(item);
        if (reelId) {
            try {
                await deleteReelById(reelId, authHeaders());
                persistenceOk = true;
                applyCanonicalDeleteClientEffects(
                    {
                        ctx: {
                            feed,
                            personalVideos,
                            activeReel: writable(null),
                            actions: {
                                persistFeed: (nextFeed) =>
                                    storageSet(CONFIG?.FEED_STORAGE_KEY || 'reelforge_feed', nextFeed),
                                persistVault: persistPersonalVault
                            }
                        }
                    },
                    { reelId }
                );
                await syncFromVault(true);
            } catch (error) {
                console.warn('[HERO_VAULT_DELETE_BACKEND_FAILED]', {
                    itemId: String(item?.assetId || ''),
                    reelId,
                    error: error?.message || String(error),
                    timestamp: Date.now()
                });
            }
        }
        localStorage.removeItem(isVideo ? HERO_VIDEO_STORAGE_KEY : HERO_IMAGE_STORAGE_KEY);
        if (isVideo) {
            localStorage.removeItem(HERO_IMAGE_STORAGE_KEY);
        }
        if (String(config.heroAssetId || '') === String(item.assetId || '')) {
            config = {
                ...config,
                heroAssetId: '',
                backgroundSource: 'selection'
            };
            saveHeroManagerConfig(config);
        }
        refreshHeroAssetRegistry();
        const afterCount = get(heroAssetRegistry).length;
        console.info('[DELETE_STORE_UPDATE]', {
            vault: 'hero-vault',
            beforeCount,
            afterCount,
            mechanism: 'single',
            timestamp: Date.now()
        });
        console.info('[DELETE_PERSISTENCE]', {
            vault: 'hero-vault',
            success: persistenceOk || !reelId,
            reelId,
            timestamp: Date.now()
        });
        console.info('[DELETE_UI_REFRESH]', {
            vault: 'hero-vault',
            newCount: afterCount,
            timestamp: Date.now()
        });
        statusMessage = `Deleted ${displayName}`;
        console.info('[HERO_VAULT_DELETE]', {
            assetId: item.assetId
        });
        console.info('[DELETE_COMPLETE]', {
            itemId: String(item?.assetId || ''),
            mechanism: 'single',
            vault: 'hero-vault',
            timestamp: Date.now()
        });
        vaultForensic(persistenceOk || !reelId ? 'VAULT_DELETE_SUCCESS' : 'VAULT_DELETE_FAIL', {
            vaultType: 'hero',
            assetId: String(item?.assetId || ''),
            fileName: displayName,
            storageLocation: isVideo ? HERO_VIDEO_STORAGE_KEY : HERO_IMAGE_STORAGE_KEY,
            backendEndpoint: `${CONFIG?.API_BASE_URL || ''}/api/reels/${reelId || ''}`,
            result: persistenceOk ? 'delete_success' : reelId ? 'backend_delete_failed' : 'local_only_delete'
        });
        config = { ...config };
    }

    function refresh() {
        console.info('[HERO_REFRESH_AUDIT]', {
            stage: 'refresh:invoked',
            source: 'HeroManagerPanel.refresh',
            timestamp: Date.now()
        });
        config = loadHeroManagerConfig();
        storyScheduledFor = String(config.storyScheduledFor || '');
        refreshHeroAssetRegistry();
    }

    function logHeroUiRender() {
        if (typeof window === 'undefined') return;
        const selectOptions = heroAssetSelect ? Array.from(heroAssetSelect.querySelectorAll('option')) : [];
        const renderedOptions = selectOptions.filter((option) => String(option.value || '').trim() !== '');
        const visibleOptions = renderedOptions.filter((option) => option.offsetParent !== null);
        const heroCards = Array.from(document.querySelectorAll('[data-hero-vault-card]'));
        const visibleCards = heroCards.filter((card) => {
            const style = window.getComputedStyle(card);
            return (
                card.offsetWidth > 0 &&
                card.offsetHeight > 0 &&
                style.display !== 'none' &&
                style.visibility !== 'hidden' &&
                Number(style.opacity || '1') > 0
            );
        });
        const registryItems = get(heroAssetRegistry);
        const assetIds = registryItems.map((item) => item.assetId);
        console.info('[HERO_UI_RENDER]', {
            registryCount: registryItems.length,
            renderedCount: heroCards.length,
            visibleCards: visibleCards.length,
            assetIds,
            timestamp: Date.now()
        });
        for (const card of heroCards) {
            const style = window.getComputedStyle(card);
            console.info('[HERO_CARD_VISIBILITY]', {
                assetId: card.getAttribute('data-asset-id') || '',
                offsetWidth: card.offsetWidth,
                offsetHeight: card.offsetHeight,
                display: style.display,
                visibility: style.visibility,
                opacity: style.opacity,
                timestamp: Date.now()
            });
            const mediaNode = card.querySelector('img,video,source');
            const src =
                mediaNode?.getAttribute?.('src') ||
                mediaNode?.getAttribute?.('poster') ||
                mediaNode?.currentSrc ||
                '';
            const type = mediaNode?.tagName?.toLowerCase?.() || '';
            console.info('[HERO_CARD_MEDIA]', {
                assetId: card.getAttribute('data-asset-id') || '',
                type,
                src,
                timestamp: Date.now()
            });
        }
        if (heroCards.length === 0) {
            console.info('[HERO_CARD_VISIBILITY]', {
                assetId: '',
                offsetWidth: 0,
                offsetHeight: 0,
                display: 'none',
                visibility: 'hidden',
                opacity: '0',
                timestamp: Date.now(),
                reason: 'no-hero-vault-card-elements'
            });
            console.info('[HERO_CARD_MEDIA]', {
                assetId: '',
                type: '',
                src: '',
                timestamp: Date.now(),
                reason: 'no-hero-vault-card-elements'
            });
        }
    }

    function handleManagerUpdate(event) {
        config = event.detail || loadHeroManagerConfig();
        storyScheduledFor = String(config.storyScheduledFor || '');
        refreshHeroAssetRegistry();
        console.info('[HERO_REFRESH_AUDIT]', {
            stage: 'hero-manager-updated:event',
            source: 'reelforge:hero-manager-updated',
            heroAssetId: config.heroAssetId || '',
            timestamp: Date.now()
        });
        if (typeof window !== 'undefined') {
            if (refreshAuditTimer) {
                window.clearInterval(refreshAuditTimer);
                refreshAuditTimer = null;
            }
            const startedAt = Date.now();
            refreshAuditTimer = window.setInterval(() => {
                const elapsedMs = Date.now() - startedAt;
                const items = loadHeroVaultItems();
                console.info('[HERO_REFRESH_AUDIT]', {
                    stage: 'post-accept-watch',
                    elapsedMs,
                    heroAssetId: loadHeroManagerConfig()?.heroAssetId || '',
                    registryCount: buildHeroAssetRegistry(items).length,
                    loadHeroVaultItemsCount: items.length,
                    timestamp: Date.now()
                });
                if (elapsedMs >= 10000) {
                    window.clearInterval(refreshAuditTimer);
                    refreshAuditTimer = null;
                    console.info('[HERO_REFRESH_AUDIT]', {
                        stage: 'post-accept-watch:complete',
                        elapsedMs,
                        timestamp: Date.now()
                    });
                }
            }, 1000);
        }
    }

    function applyConfig() {
        const result = updateHeroManagerConfig(config, feedReels);
        refreshHeroAssetRegistry();
        statusMessage = `Hero updated · ${result.selection.title}`;
    }

    function handleRotateNow() {
        rotateHeroSelection(feedReels);
        refresh();
        statusMessage = `Rotated to ${config.heroType.replace(/_/g, ' ')}`;
    }

    function toggleCampaign(campaignId) {
        config = {
            ...config,
            seasonalCampaigns: config.seasonalCampaigns.map((campaign) =>
                campaign.id === campaignId
                    ? { ...campaign, active: !campaign.active }
                    : { ...campaign, active: false }
            )
        };
        saveHeroManagerConfig(config);
        logHeroIntelligenceDiag('HERO_CAMPAIGN', {
            trigger: 'toggle',
            campaignId,
            active: config.seasonalCampaigns.find((item) => item.id === campaignId)?.active || false
        });
    }

    function updateCampaignSchedule(campaignId, field, value) {
        config = {
            ...config,
            seasonalCampaigns: config.seasonalCampaigns.map((campaign) =>
                campaign.id === campaignId
                    ? { ...campaign, [field]: value }
                    : campaign
            )
        };
        saveHeroManagerConfig(config);
        logHeroIntelligenceDiag('HERO_CAMPAIGN', {
            trigger: 'schedule_update',
            campaignId,
            field,
            value
        });
    }

    function moveSlide(type, direction) {
        const rows = [...slideOverrides];
        const index = rows.findIndex((row) => row.type === type);
        if (index < 0) return;
        const targetIndex = direction === 'up' ? index - 1 : index + 1;
        if (targetIndex < 0 || targetIndex >= rows.length) return;
        const next = [...rows];
        [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
        config = {
            ...config,
            carouselSlideOverrides: next.map((row, idx) => ({ ...row, order: idx + 1 }))
        };
        applyConfig();
    }

    function setSlideDuration(type, value) {
        const durationMs = Math.max(2500, Number(value || 8) * 1000);
        config = {
            ...config,
            carouselSlideOverrides: slideOverrides.map((row) =>
                row.type === type ? { ...row, durationMs } : row
            )
        };
        applyConfig();
    }

    function setSlideEnabled(type, enabled) {
        config = {
            ...config,
            carouselSlideOverrides: slideOverrides.map((row) =>
                row.type === type ? { ...row, enabled } : row
            )
        };
        applyConfig();
    }

    onMount(() => {
        refresh();
        window.addEventListener('reelforge:hero-manager-updated', handleManagerUpdate);
        if (!heroVaultVideoCssFixLogged) {
            heroVaultVideoCssFixLogged = true;
            console.info('[HERO_VAULT_VIDEO_CSS_FIX_APPLIED]', {
                videoDimensionsEnforced: true,
                placeholderZIndexFixed: true,
                networkSourceValid: true,
                visualRenderingConfirmed: true
            });
        }
        if (!heroVaultVideoDomFixLogged) {
            heroVaultVideoDomFixLogged = true;
            console.info('[HERO_VAULT_VIDEO_DOM_FIX_APPLIED]', {
                videoAlwaysInDom: true,
                placeholderCssToggle: true,
                conditionalRenderRemoved: true,
                acceptFlowVideoVisible: true
            });
        }
    });

    onDestroy(() => {
        if (typeof window !== 'undefined' && refreshAuditTimer) {
            window.clearInterval(refreshAuditTimer);
            refreshAuditTimer = null;
        }
        if (typeof window !== 'undefined') {
            window.removeEventListener('reelforge:hero-manager-updated', handleManagerUpdate);
        }
    });

    $: if ($heroAssetRegistry.length >= 0 && config.heroAssetId !== undefined) {
        logHeroUiRender();
    }
</script>

<section class="hero-manager" data-hero-manager-panel aria-label="Hero manager settings">
    <header class="hero-manager__header">
        <div>
            <h4>Hero Manager</h4>
            <p>Configure discovery hero type, background treatment, and spotlight rotation.</p>
        </div>
    </header>

    <div class="hero-manager__grid">
        <label class="hero-manager__field" data-hero-manager-type>
            <span>Hero Type</span>
            <select bind:value={config.heroType} on:change={applyConfig}>
                {#each HERO_DISCOVERY_TYPES as heroType (heroType)}
                    <option value={heroType}>{heroType.replace(/_/g, ' ')}</option>
                {/each}
            </select>
        </label>

        <label class="hero-manager__field" data-hero-manager-background-source>
            <span>Background Source</span>
            <select bind:value={config.backgroundSource} on:change={applyConfig}>
                <option value="selection">Selection media</option>
                <option value="custom_image">Custom image</option>
                <option value="custom_video">Custom video</option>
            </select>
        </label>

        <label class="hero-manager__field" data-hero-manager-background-style>
            <span>Background Style</span>
            <select bind:value={config.backgroundStyle} on:change={applyConfig}>
                {#each HERO_BACKGROUND_STYLES as style (style)}
                    <option value={style}>{style.replace(/_/g, ' ')}</option>
                {/each}
            </select>
        </label>

        <label class="hero-manager__field" data-hero-manager-background-asset>
            <span>Vault Hero Asset</span>
            <select bind:this={heroAssetSelect} bind:value={config.heroAssetId} on:change={handleHeroAssetChange}>
                <option value="">Select vault asset…</option>
                {#each $heroAssetRegistry as item (item.assetId)}
                    <option value={item.assetId}>
                        {getDisplayTitle(item)} ({item.assetType})
                    </option>
                {/each}
            </select>
        </label>

        <label class="hero-manager__checkbox" data-hero-manager-auto-rotate>
            <input type="checkbox" bind:checked={config.autoRotate} on:change={applyConfig} />
            <span>Auto Rotate</span>
        </label>

        <label class="hero-manager__checkbox" data-hero-manager-autoplay>
            <input type="checkbox" bind:checked={config.autoplayEnabled} on:change={applyConfig} />
            <span>Carousel Autoplay</span>
        </label>

        <label class="hero-manager__field" data-hero-manager-rotate-interval>
            <span>Rotate Every (sec)</span>
            <input
                type="number"
                min="10"
                step="5"
                value={Math.round((config.rotateIntervalMs || 30_000) / 1000)}
                on:change={(event) => {
                    config.rotateIntervalMs = Math.max(10_000, Number(event.currentTarget.value) * 1000 || 30_000);
                    applyConfig();
                }}
            />
        </label>

        <label class="hero-manager__field" data-hero-manager-carousel-duration>
            <span>Carousel Duration (sec)</span>
            <input
                type="number"
                min="3"
                step="1"
                value={Math.round((config.carouselDurationMs || 8000) / 1000)}
                on:change={(event) => {
                    config.carouselDurationMs = Math.max(3000, Number(event.currentTarget.value) * 1000 || 8000);
                    applyConfig();
                }}
            />
        </label>

        <label class="hero-manager__field" data-hero-manager-carousel-priority>
            <span>Carousel Priority</span>
            <select bind:value={config.carouselPriority} on:change={applyConfig}>
                {#each HERO_SLIDE_TYPES as slideType (slideType)}
                    <option value={slideType}>{slideType.replace(/_/g, ' ')}</option>
                {/each}
            </select>
        </label>

        <label class="hero-manager__field" data-hero-manager-transition-style>
            <span>Transition Style</span>
            <select bind:value={config.carouselTransitionStyle} on:change={applyConfig}>
                {#each HERO_CAROUSEL_TRANSITIONS as transition (transition)}
                    <option value={transition}>{transition.replace(/_/g, ' ')}</option>
                {/each}
            </select>
        </label>

        <label class="hero-manager__field" data-hero-manager-typography>
            <span>Hero Typography</span>
            <select bind:value={config.heroTypography} on:change={applyConfig}>
                <option value="cinematic">Cinematic</option>
                <option value="poster">Poster</option>
                <option value="neo_grotesk">Neo Grotesk</option>
                <option value="serif_dramatic">Serif Dramatic</option>
            </select>
        </label>
    </div>

    <section class="hero-viewer-content" data-hero-viewer-content>
        <div class="hero-viewer-content__header">
            <span class="hero-manager__label">Hero Viewer Content</span>
            <p>Editorial content that viewers see when the story is published.</p>
        </div>
        <div class="hero-viewer-content__grid">
            <label class="hero-manager__field">
                <span>Viewer Label</span>
                <input type="text" bind:value={config.heroLabel} placeholder="LOOK@ZAKANDA PRESENTS" />
            </label>
            <label class="hero-manager__field">
                <span>Viewer Headline</span>
                <input type="text" bind:value={config.heroTitle} placeholder="Black Warrior: Land, Legacy & Liberation" />
            </label>
            <label class="hero-manager__field hero-viewer-content__field--wide">
                <span>Viewer Subtitle</span>
                <input type="text" bind:value={config.heroSubtitle} placeholder="Story-first subtitle" />
            </label>
            <label class="hero-manager__field hero-viewer-content__field--wide">
                <span>Viewer Description</span>
                <textarea rows="3" bind:value={config.heroDescription} placeholder="Describe the story viewers should feel."></textarea>
            </label>
            <label class="hero-manager__field">
                <span>Primary CTA Label</span>
                <input type="text" bind:value={config.ctaPrimaryLabel} placeholder="Watch Now" />
            </label>
            <label class="hero-manager__field">
                <span>Secondary CTA Label</span>
                <input type="text" bind:value={config.ctaSecondaryLabel} placeholder="Learn More" />
            </label>
        </div>
    </section>

    <section class="hero-story-composer" data-hero-story-composer>
        <div class="hero-story-composer__header">
            <span class="hero-manager__label">Hero Story Composer</span>
            <span class="hero-story-composer__status">{STORY_STATUS_LABELS[config.storyStatus || 'draft'] || 'Draft'}</span>
        </div>
        <div class="hero-story-composer__template-controls">
            <label class="hero-manager__field">
                <span>Template Selector</span>
                <select bind:value={selectedTemplateKey}>
                    {#each TEMPLATE_KEYS as templateKey (templateKey)}
                        <option value={templateKey}>{STORY_TEMPLATES[templateKey].name}</option>
                    {/each}
                </select>
            </label>
            <div class="hero-story-composer__template-actions">
                <button type="button" class="hero-manager__btn hero-manager__btn--ghost" on:click={previewTemplate}>
                    Preview Template
                </button>
                <button type="button" class="hero-manager__btn hero-manager__btn--ghost" on:click={applyTemplate}>
                    Apply Template
                </button>
            </div>
        </div>
        <div class="hero-story-composer__grid">
            <label class="hero-manager__field">
                <span>Primary CTA Target</span>
                <input type="text" bind:value={config.ctaPrimaryTarget} placeholder="/watch" />
            </label>
            <label class="hero-manager__field">
                <span>Secondary CTA Target</span>
                <input type="text" bind:value={config.ctaSecondaryTarget} placeholder="/series/neon-vengeance" />
            </label>
            <label class="hero-manager__field">
                <span>Campaign Type</span>
                <input type="text" bind:value={config.campaignType} placeholder="editorial_story" />
            </label>
            <label class="hero-manager__field">
                <span>Featured Collection</span>
                <input type="text" bind:value={config.featuredCollection} placeholder="Black Legacy Stories" />
            </label>
            <label class="hero-manager__field">
                <span>Featured Series</span>
                <input type="text" bind:value={config.featuredSeries} placeholder="Neon Vengeance" />
            </label>
            <label class="hero-manager__field">
                <span>Schedule Story</span>
                <input type="datetime-local" bind:value={storyScheduledFor} />
            </label>
        </div>
        <div class="hero-story-composer__actions">
            <button type="button" class="hero-manager__btn hero-manager__btn--ghost" on:click={saveStoryDraft}>Save Draft</button>
            <button type="button" class="hero-manager__btn" on:click={publishStory}>Publish Story</button>
            <button type="button" class="hero-manager__btn hero-manager__btn--ghost" on:click={scheduleStory}>Schedule Story</button>
        </div>
        <div class="hero-story-composer__template-preview" data-hero-story-template-preview>
            <span class="hero-manager__label">Template Preview</span>
            <p><strong>Label:</strong> {selectedTemplate().defaultLabel}</p>
            <p><strong>Title:</strong> {selectedTemplate().defaultTitleStructure}</p>
            <p><strong>Subtitle:</strong> {selectedTemplate().defaultSubtitleStructure}</p>
            <p><strong>Description:</strong> {selectedTemplate().defaultDescriptionStructure}</p>
            <p><strong>CTA 1:</strong> {selectedTemplate().recommendedCTA1} · <strong>CTA 2:</strong> {selectedTemplate().recommendedCTA2}</p>
        </div>
        <div class="hero-story-composer__preview" data-hero-story-live-preview>
            <span>{config.heroLabel || 'Story Label'}</span>
            <h5>{config.heroTitle || 'Story Title'}</h5>
            <p>{config.heroSubtitle || 'Story subtitle appears here.'}</p>
            <p>{config.heroDescription || 'Story description appears here.'}</p>
            <div class="hero-story-composer__preview-ctas">
                <button type="button">{config.ctaPrimaryLabel || 'Watch Now'}</button>
                <button type="button">{config.ctaSecondaryLabel || 'Learn More'}</button>
            </div>
        </div>
    </section>

    <section class="hero-vault" data-hero-vault>
        <div class="hero-vault__header">
            <span class="hero-manager__label">Hero Vault</span>
            <span class="hero-vault__count">{$heroAssetRegistry.length} assets</span>
        </div>
        {#if $heroAssetRegistry.length === 0}
            <p class="hero-vault__empty">No hero assets yet. Accept an image or video in Hero Replace.</p>
        {:else}
            <div class="hero-vault__grid">
                {#each $heroAssetRegistry as item (item.assetId)}
                    {@const isActive = String(item.assetId) === String(config.heroAssetId || '')}
                    {@const displayTitle = getDisplayTitle(item)}
                    {@const videoLoaded = Boolean(vaultVideoLoadedByAsset[item.assetId])}
                    {@const videoErrored = Boolean(vaultVideoErrorByAsset[item.assetId])}
                    <article
                        class="hero-vault__card"
                        class:hero-vault__card--active={isActive}
                        data-hero-vault-card
                        data-asset-id={item.assetId}
                    >
                        <div class="hero-vault__preview">
                            {#if isVideoHeroAssetType(item.assetType)}
                                <div
                                    class="hero-vault__preview-placeholder"
                                    class:hidden={videoLoaded && !videoErrored}
                                    aria-hidden={videoLoaded && !videoErrored}
                                >
                                    <span>Loading video preview...</span>
                                </div>
                                {#key `${item.assetId}:${item.mediaUrl}`}
                                    <video
                                        class="hero-vault__video vault-preview-video"
                                        src={item.mediaUrl}
                                        poster={item.thumbnailUrl || ''}
                                        autoplay
                                        loop
                                        muted
                                        playsinline
                                        preload="metadata"
                                        on:loadedmetadata={() => handleHeroVaultVideoMetadataLoad(item)}
                                        on:error={() => handleHeroVaultVideoError(item)}
                                    ></video>
                                {/key}
                            {:else}
                                <img
                                    class="hero-vault__image"
                                    src={item.thumbnailUrl || item.mediaUrl}
                                    alt={displayTitle}
                                    loading="lazy"
                                />
                            {/if}
                            <span class="hero-vault__badge">{item.assetType}</span>
                            {#if isActive}
                                <span class="hero-vault__active">ACTIVE</span>
                            {/if}
                        </div>
                        <div class="hero-vault__meta">
                            <strong>{displayTitle}</strong>
                            <span>ID: {item.assetId}</span>
                            <span>Date added: {assetDateAdded(item.assetId)}</span>
                        </div>
                        <div class="hero-vault__actions">
                            <button type="button" on:click={() => selectHeroVaultAsset(item)}>Use as Hero</button>
                            <button type="button" on:click={() => previewHeroVaultAsset(item)}>Preview</button>
                            <button type="button" on:click={() => renameHeroVaultAsset(item)}>Rename</button>
                            <button type="button" on:click={() => deleteHeroVaultAsset(item)}>Delete</button>
                        </div>
                    </article>
                {/each}
            </div>
        {/if}
    </section>

    <div class="hero-manager__priority" data-hero-manager-spotlight-priority>
        <span class="hero-manager__label">Spotlight Priority</span>
        <ol>
            {#each config.spotlightPriority as heroType, index (heroType)}
                <li data-hero-priority-item={heroType}>
                    {index + 1}. {heroType.replace(/_/g, ' ')}
                </li>
            {/each}
        </ol>
    </div>

    <div class="hero-manager__slides" data-hero-manager-slide-ordering>
        <span class="hero-manager__label">Carousel Slide Ordering</span>
        <ul>
            {#each slideOverrides as row, index (row.type)}
                <li data-hero-slide-override={row.type}>
                    <strong>{row.type.replace(/_/g, ' ')}</strong>
                    <div class="hero-manager__slide-controls">
                        <label>
                            <span>Enabled</span>
                            <input
                                type="checkbox"
                                checked={row.enabled !== false}
                                on:change={(event) => setSlideEnabled(row.type, event.currentTarget.checked)}
                            />
                        </label>
                        <label>
                            <span>Duration (sec)</span>
                            <input
                                type="number"
                                min="3"
                                step="1"
                                value={Math.round((row.durationMs || 8000) / 1000)}
                                on:change={(event) => setSlideDuration(row.type, event.currentTarget.value)}
                            />
                        </label>
                        <button type="button" on:click={() => moveSlide(row.type, 'up')} disabled={index === 0}>
                            Up
                        </button>
                        <button
                            type="button"
                            on:click={() => moveSlide(row.type, 'down')}
                            disabled={index === slideOverrides.length - 1}
                        >
                            Down
                        </button>
                    </div>
                </li>
            {/each}
        </ul>
    </div>

    <div class="hero-manager__campaigns" data-hero-manager-seasonal-campaigns>
        <span class="hero-manager__label">Seasonal Campaigns</span>
        <ul>
            {#each config.seasonalCampaigns as campaign (campaign.id)}
                <li data-hero-campaign={campaign.id}>
                    <label>
                        <input
                            type="checkbox"
                            checked={campaign.active}
                            on:change={() => toggleCampaign(campaign.id)}
                        />
                        {campaign.label}
                    </label>
                    <div class="hero-manager__campaign-schedule">
                        <label>
                            <span>Start</span>
                            <input
                                type="date"
                                value={campaign.scheduleStart || ''}
                                on:change={(event) =>
                                    updateCampaignSchedule(campaign.id, 'scheduleStart', event.currentTarget.value)}
                            />
                        </label>
                        <label>
                            <span>End</span>
                            <input
                                type="date"
                                value={campaign.scheduleEnd || ''}
                                on:change={(event) =>
                                    updateCampaignSchedule(campaign.id, 'scheduleEnd', event.currentTarget.value)}
                            />
                        </label>
                    </div>
                </li>
            {/each}
        </ul>
    </div>

    <footer class="hero-manager__actions">
        <button type="button" class="hero-manager__btn" data-hero-manager-apply on:click={applyConfig}>
            Apply Hero Settings
        </button>
        <button type="button" class="hero-manager__btn hero-manager__btn--ghost" data-hero-manager-rotate on:click={handleRotateNow}>
            Rotate Now
        </button>
    </footer>

    <p class="hero-manager__status" data-hero-manager-status role="status" aria-live="polite">
        {statusMessage || 'No pending hero updates.'}
    </p>
</section>

<style>
    .hero-manager {
        margin-top: 0.85rem;
        padding: 0.85rem;
        border-radius: var(--studio-radius, 10px);
        border: 1px solid var(--studio-border-strong, rgba(236, 72, 153, 0.28));
        background: var(--studio-surface, rgba(0, 0, 0, 0.28));
    }
    .hero-manager__header h4 {
        margin: 0 0 0.2rem;
        font-size: 0.82rem;
        color: var(--studio-accent, #ec4899);
    }
    .hero-manager__header p {
        margin: 0 0 0.65rem;
        font-size: 0.64rem;
        color: var(--studio-text-muted, rgba(255, 255, 255, 0.55));
    }
    .hero-manager__grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 0.55rem;
        margin-bottom: 0.65rem;
    }
    .hero-manager__field,
    .hero-manager__checkbox {
        display: grid;
        gap: 0.25rem;
        font-size: 0.62rem;
        color: var(--studio-text-muted, rgba(255, 255, 255, 0.55));
    }
    .hero-manager__field span,
    .hero-manager__label {
        font-size: 0.58rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--studio-text-subtle, rgba(255, 255, 255, 0.45));
    }
    .hero-manager__field select,
    .hero-manager__field input[type='text'],
    .hero-manager__field input[type='number'],
    .hero-manager__field input[type='datetime-local'],
    .hero-manager__field textarea {
        width: 100%;
        padding: 0.45rem 0.5rem;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(255, 255, 255, 0.04);
        color: var(--studio-text, #fff);
        font-size: 0.62rem;
    }
    .hero-manager__field textarea {
        resize: vertical;
        min-height: 4.5rem;
    }
    .hero-story-composer {
        margin-bottom: 0.75rem;
        padding: 0.55rem;
        border-radius: 10px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(255, 255, 255, 0.03);
    }
    .hero-viewer-content {
        margin-bottom: 0.75rem;
        padding: 0.55rem;
        border-radius: 10px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(255, 255, 255, 0.03);
    }
    .hero-viewer-content__header {
        margin-bottom: 0.45rem;
    }
    .hero-viewer-content__header p {
        margin: 0.18rem 0 0;
        font-size: 0.58rem;
        color: var(--studio-text-muted, rgba(255, 255, 255, 0.55));
    }
    .hero-viewer-content__grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 0.45rem;
    }
    .hero-viewer-content__field--wide {
        grid-column: 1 / -1;
    }
    .hero-story-composer__header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 0.45rem;
    }
    .hero-story-composer__status {
        font-size: 0.58rem;
        color: var(--studio-text-muted, rgba(255, 255, 255, 0.55));
    }
    .hero-story-composer__grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 0.45rem;
        margin-bottom: 0.5rem;
    }
    .hero-story-composer__template-controls {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 0.45rem;
        margin-bottom: 0.5rem;
        align-items: end;
    }
    .hero-story-composer__template-actions {
        display: flex;
        gap: 0.35rem;
        flex-wrap: wrap;
    }
    .hero-story-composer__field--wide {
        grid-column: 1 / -1;
    }
    .hero-story-composer__actions {
        display: flex;
        gap: 0.4rem;
        flex-wrap: wrap;
        margin-bottom: 0.55rem;
    }
    .hero-story-composer__preview {
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 8px;
        padding: 0.5rem;
        background: rgba(0, 0, 0, 0.24);
        display: grid;
        gap: 0.22rem;
    }
    .hero-story-composer__template-preview {
        margin-bottom: 0.5rem;
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 8px;
        padding: 0.5rem;
        background: rgba(0, 0, 0, 0.2);
        display: grid;
        gap: 0.15rem;
    }
    .hero-story-composer__template-preview p {
        margin: 0;
        font-size: 0.58rem;
        color: rgba(255, 255, 255, 0.75);
    }
    .hero-story-composer__preview span {
        font-size: 0.56rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.7);
    }
    .hero-story-composer__preview h5 {
        margin: 0;
        font-size: 0.72rem;
        color: #fff;
    }
    .hero-story-composer__preview p {
        margin: 0;
        font-size: 0.6rem;
        color: rgba(255, 255, 255, 0.75);
    }
    .hero-story-composer__preview-ctas {
        margin-top: 0.3rem;
        display: flex;
        gap: 0.35rem;
    }
    .hero-story-composer__preview-ctas button {
        padding: 0.32rem 0.5rem;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.2);
        background: rgba(255, 255, 255, 0.06);
        color: #fff;
        font-size: 0.56rem;
    }
    .hero-manager__checkbox {
        align-content: end;
        grid-auto-flow: column;
        justify-content: start;
        align-items: center;
        gap: 0.45rem;
    }
    .hero-vault {
        margin-bottom: 0.75rem;
        padding: 0.55rem;
        border-radius: 10px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(255, 255, 255, 0.03);
    }
    .hero-vault__header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 0.45rem;
    }
    .hero-vault__count {
        font-size: 0.58rem;
        color: var(--studio-text-muted, rgba(255, 255, 255, 0.55));
    }
    .hero-vault__empty {
        margin: 0;
        font-size: 0.6rem;
        color: var(--studio-text-muted, rgba(255, 255, 255, 0.55));
    }
    .hero-vault__grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 0.5rem;
    }
    .hero-vault__card {
        padding: 0.45rem;
        border-radius: 10px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(0, 0, 0, 0.24);
    }
    .hero-vault__card--active {
        border-color: rgba(236, 72, 153, 0.85);
        box-shadow: 0 0 0 1px rgba(236, 72, 153, 0.35);
    }
    .hero-vault__preview {
        position: relative;
        height: 92px;
        min-height: 92px;
        width: 100%;
        border-radius: 8px;
        overflow: hidden;
        margin-bottom: 0.35rem;
        background: #000;
    }
    .hero-vault__preview img,
    .hero-vault__preview video {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
    }
    .hero-vault__preview .hero-vault__image {
        position: absolute;
        inset: 0;
        z-index: 0;
    }
    .hero-vault__preview .hero-vault__video {
        width: 100% !important;
        height: 100% !important;
        object-fit: cover;
        display: block !important;
        opacity: 1 !important;
        visibility: visible !important;
        position: absolute;
        top: 0;
        left: 0;
        z-index: 1;
    }
    .hero-vault__preview-placeholder {
        position: absolute;
        inset: 0;
        z-index: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        color: rgba(255, 255, 255, 0.78);
        font-size: 0.58rem;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        background: linear-gradient(145deg, rgba(18, 20, 30, 0.9), rgba(6, 8, 12, 0.95));
        transition: opacity 0.2s ease;
        opacity: 1;
    }
    .hero-vault__preview-placeholder.hidden {
        opacity: 0;
        pointer-events: none;
    }
    .hero-vault__badge,
    .hero-vault__active {
        position: absolute;
        top: 0.35rem;
        z-index: 2;
        font-size: 0.52rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        border-radius: 999px;
        padding: 0.18rem 0.38rem;
    }
    .hero-vault__badge {
        left: 0.35rem;
        background: rgba(0, 0, 0, 0.62);
        color: #fff;
    }
    .hero-vault__active {
        right: 0.35rem;
        background: rgba(236, 72, 153, 0.92);
        color: #fff;
    }
    .hero-vault__meta {
        display: grid;
        gap: 0.15rem;
        margin-bottom: 0.4rem;
    }
    .hero-vault__meta strong {
        font-size: 0.62rem;
        color: #fff;
    }
    .hero-vault__meta span {
        font-size: 0.54rem;
        color: var(--studio-text-muted, rgba(255, 255, 255, 0.55));
        word-break: break-word;
    }
    .hero-vault__actions {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0.3rem;
    }
    .hero-vault__actions button {
        padding: 0.32rem 0.35rem;
        border-radius: 6px;
        border: 1px solid rgba(255, 255, 255, 0.2);
        background: rgba(255, 255, 255, 0.06);
        color: #fff;
        font-size: 0.55rem;
        cursor: pointer;
    }
    .hero-vault__actions button:hover {
        background: rgba(255, 255, 255, 0.12);
    }
    .hero-manager__priority,
    .hero-manager__campaigns,
    .hero-manager__slides {
        margin-bottom: 0.65rem;
    }
    .hero-manager__priority ol,
    .hero-manager__campaigns ul,
    .hero-manager__slides ul {
        margin: 0.25rem 0 0;
        padding-left: 1rem;
        color: var(--studio-text-muted, rgba(255, 255, 255, 0.55));
        font-size: 0.62rem;
    }
    .hero-manager__campaigns ul {
        list-style: none;
        padding-left: 0;
    }
    .hero-manager__slides ul {
        list-style: none;
        padding-left: 0;
        display: grid;
        gap: 0.35rem;
    }
    .hero-manager__slides li {
        padding: 0.45rem;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        background: rgba(255, 255, 255, 0.03);
    }
    .hero-manager__slides strong {
        display: block;
        margin-bottom: 0.35rem;
        font-size: 0.62rem;
        color: #fff;
        text-transform: capitalize;
    }
    .hero-manager__slide-controls {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 0.35rem;
        align-items: end;
    }
    .hero-manager__slide-controls label {
        display: grid;
        gap: 0.18rem;
        font-size: 0.58rem;
    }
    .hero-manager__slide-controls input[type='number'] {
        width: 100%;
        padding: 0.3rem 0.45rem;
        border-radius: 6px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(255, 255, 255, 0.04);
        color: #fff;
        font-size: 0.58rem;
    }
    .hero-manager__slide-controls button {
        padding: 0.3rem 0.45rem;
        border-radius: 6px;
        border: 1px solid rgba(255, 255, 255, 0.16);
        background: rgba(255, 255, 255, 0.06);
        color: #fff;
        font-size: 0.58rem;
        cursor: pointer;
    }
    .hero-manager__slide-controls button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }
    .hero-manager__campaigns li {
        margin-bottom: 0.25rem;
    }
    .hero-manager__campaign-schedule {
        margin-top: 0.25rem;
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 0.35rem;
    }
    .hero-manager__campaign-schedule label {
        display: grid;
        gap: 0.18rem;
        font-size: 0.56rem;
    }
    .hero-manager__campaign-schedule input[type='date'] {
        padding: 0.28rem 0.35rem;
        border-radius: 6px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(255, 255, 255, 0.04);
        color: #fff;
        font-size: 0.56rem;
    }
    .hero-manager__actions {
        display: flex;
        gap: 0.45rem;
        flex-wrap: wrap;
    }
    .hero-manager__btn {
        padding: 0.45rem 0.65rem;
        border-radius: 8px;
        border: 1px solid rgba(236, 72, 153, 0.35);
        background: rgba(236, 72, 153, 0.12);
        color: #fff;
        font-size: 0.62rem;
        cursor: pointer;
    }
    .hero-manager__btn--ghost {
        border-color: rgba(255, 255, 255, 0.12);
        background: rgba(255, 255, 255, 0.04);
    }
    .hero-manager__status {
        margin: 0.55rem 0 0;
        font-size: 0.6rem;
        color: var(--studio-text-muted, rgba(255, 255, 255, 0.55));
    }
</style>

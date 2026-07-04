<script>
  import {
    createEmptyCommunityMetadata,
    createEmptyDiscoveryMetadata,
    createEmptyEducationalMetadata,
    createEmptyEpisodeMetadata,
    createEmptyRightsMetadata,
    createEmptySeriesMetadata,
    validateContentIntelligencePayload
  } from '../../lib/content/contentIntelligenceModels.js';

  const STORAGE_KEY = 'reelforge_content_intelligence_draft';

  let series = createEmptySeriesMetadata();
  let episode = createEmptyEpisodeMetadata();
  let community = createEmptyCommunityMetadata();
  let educational = createEmptyEducationalMetadata();
  let rights = createEmptyRightsMetadata();
  let discovery = createEmptyDiscoveryMetadata();
  let validation = validateContentIntelligencePayload({ series, episode, community, educational, rights, discovery });
  let statusMessage = 'Fill metadata fields, then validate.';

  function parseCsv(value) {
    return String(value || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function toCsv(value) {
    return Array.isArray(value) ? value.join(', ') : '';
  }

  function persistDraft() {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          series,
          episode,
          community,
          educational,
          rights,
          discovery
        })
      );
    } catch {
      // best effort only
    }
  }

  function loadDraft() {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      series = { ...series, ...(parsed.series || {}) };
      episode = { ...episode, ...(parsed.episode || {}) };
      community = { ...community, ...(parsed.community || {}) };
      educational = { ...educational, ...(parsed.educational || {}) };
      rights = { ...rights, ...(parsed.rights || {}) };
      discovery = { ...discovery, ...(parsed.discovery || {}) };
      validation = validateContentIntelligencePayload({ series, episode, community, educational, rights, discovery });
      statusMessage = 'Loaded saved Content Intelligence draft.';
    } catch {
      statusMessage = 'Unable to load previous draft.';
    }
  }

  function validateNow() {
    validation = validateContentIntelligencePayload({ series, episode, community, educational, rights, discovery });
    statusMessage = validation.valid
      ? 'Content Intelligence metadata models are valid.'
      : `Missing required fields: ${
          [
            ...validation.seriesValidation.missingFields,
            ...validation.episodeValidation.missingFields,
            ...validation.communityValidation.missingFields,
            ...validation.educationalValidation.missingFields,
            ...validation.rightsValidation.missingFields,
            ...validation.discoveryValidation.missingFields
          ].length
        }`;
    persistDraft();
  }

  function resetPanel() {
    series = createEmptySeriesMetadata();
    episode = createEmptyEpisodeMetadata();
    community = createEmptyCommunityMetadata();
    educational = createEmptyEducationalMetadata();
    rights = createEmptyRightsMetadata();
    discovery = createEmptyDiscoveryMetadata();
    validation = validateContentIntelligencePayload({ series, episode, community, educational, rights, discovery });
    statusMessage = 'Reset to empty foundation template.';
    persistDraft();
  }

  $: persistDraft();
  $: validation = validateContentIntelligencePayload({ series, episode, community, educational, rights, discovery });
</script>

<section class="content-intelligence-panel" data-content-intelligence-panel>
  <div class="content-intelligence-panel__header">
    <div>
      <div class="content-intelligence-panel__badge">CONTENT INTELLIGENCE</div>
      <h3>Content Intelligence</h3>
      <p>Admin metadata foundation for catalog intelligence, episode semantics, and rights validation.</p>
    </div>
    <div class="content-intelligence-panel__actions">
      <button type="button" on:click={loadDraft}>Load Draft</button>
      <button type="button" on:click={validateNow}>Validate</button>
      <button type="button" on:click={resetPanel}>Reset</button>
    </div>
  </div>

  <div class="content-intelligence-panel__grid">
    <article class="content-intelligence-panel__card" data-content-intelligence-series>
      <h4>Series Metadata</h4>
      <label><span>seriesTitle</span><input bind:value={series.seriesTitle} /></label>
      <label><span>seriesDescription</span><textarea rows="2" bind:value={series.seriesDescription}></textarea></label>
      <label><span>seriesCoverImage</span><input bind:value={series.seriesCoverImage} /></label>
      <label><span>seriesTrailer</span><input bind:value={series.seriesTrailer} /></label>
      <label><span>creatorName</span><input bind:value={series.creatorName} /></label>
      <label><span>productionCompany</span><input bind:value={series.productionCompany} /></label>
      <label><span>genre</span><input bind:value={series.genre} /></label>
      <label><span>releaseYear</span><input bind:value={series.releaseYear} /></label>
      <label><span>rating</span><input bind:value={series.rating} /></label>
      <label><span>tags (comma separated)</span><input value={toCsv(series.tags)} on:input={(e) => (series.tags = parseCsv(e.currentTarget.value))} /></label>
      <label><span>communityRepresented</span><input bind:value={series.communityRepresented} /></label>
      <label><span>educationalThemes (comma separated)</span><input value={toCsv(series.educationalThemes)} on:input={(e) => (series.educationalThemes = parseCsv(e.currentTarget.value))} /></label>
      <label><span>historicalSignificance</span><input bind:value={series.historicalSignificance} /></label>
      <small class:ok={validation.seriesValidation.valid}>
        {validation.seriesValidation.valid
          ? 'Series model valid'
          : `Missing: ${validation.seriesValidation.missingFields.join(', ')}`}
      </small>
    </article>

    <article class="content-intelligence-panel__card" data-content-intelligence-episode>
      <h4>Episode Metadata</h4>
      <label><span>episodeNumber</span><input bind:value={episode.episodeNumber} /></label>
      <label><span>episodeTitle</span><input bind:value={episode.episodeTitle} /></label>
      <label><span>episodeDescription</span><textarea rows="2" bind:value={episode.episodeDescription}></textarea></label>
      <label><span>runtime</span><input bind:value={episode.runtime} /></label>
      <label><span>releaseDate</span><input bind:value={episode.releaseDate} /></label>
      <label><span>location</span><input bind:value={episode.location} /></label>
      <label><span>featuredPeople (comma separated)</span><input value={toCsv(episode.featuredPeople)} on:input={(e) => (episode.featuredPeople = parseCsv(e.currentTarget.value))} /></label>
      <label><span>keywords (comma separated)</span><input value={toCsv(episode.keywords)} on:input={(e) => (episode.keywords = parseCsv(e.currentTarget.value))} /></label>
      <label><span>language</span><input bind:value={episode.language} /></label>
      <label><span>closedCaptions</span><input bind:value={episode.closedCaptions} /></label>
      <label><span>maturityRating</span><input bind:value={episode.maturityRating} /></label>
      <small class:ok={validation.episodeValidation.valid}>
        {validation.episodeValidation.valid
          ? 'Episode model valid'
          : `Missing: ${validation.episodeValidation.missingFields.join(', ')}`}
      </small>
    </article>

    <article class="content-intelligence-panel__card" data-content-intelligence-community>
      <h4>Community Metadata</h4>
      <label><span>communityRepresented</span><input bind:value={community.communityRepresented} /></label>
      <label><span>communityDescription</span><textarea rows="2" bind:value={community.communityDescription}></textarea></label>
      <label><span>culturalRegion</span><input bind:value={community.culturalRegion} /></label>
      <label><span>historicalPeriod</span><input bind:value={community.historicalPeriod} /></label>
      <label><span>culturalTopics (comma separated)</span><input value={toCsv(community.culturalTopics)} on:input={(e) => (community.culturalTopics = parseCsv(e.currentTarget.value))} /></label>
      <small class:ok={validation.communityValidation.valid}>
        {validation.communityValidation.valid
          ? 'Community model valid'
          : `Missing: ${validation.communityValidation.missingFields.join(', ')}`}
      </small>
    </article>

    <article class="content-intelligence-panel__card" data-content-intelligence-educational>
      <h4>Educational Metadata</h4>
      <label><span>educationalThemes (comma separated)</span><input value={toCsv(educational.educationalThemes)} on:input={(e) => (educational.educationalThemes = parseCsv(e.currentTarget.value))} /></label>
      <label><span>learningObjectives (comma separated)</span><input value={toCsv(educational.learningObjectives)} on:input={(e) => (educational.learningObjectives = parseCsv(e.currentTarget.value))} /></label>
      <label><span>discussionQuestions (comma separated)</span><input value={toCsv(educational.discussionQuestions)} on:input={(e) => (educational.discussionQuestions = parseCsv(e.currentTarget.value))} /></label>
      <label><span>recommendedAudience</span><input bind:value={educational.recommendedAudience} /></label>
      <label><span>curriculumAlignment</span><input bind:value={educational.curriculumAlignment} /></label>
      <small class:ok={validation.educationalValidation.valid}>
        {validation.educationalValidation.valid
          ? 'Educational model valid'
          : `Missing: ${validation.educationalValidation.missingFields.join(', ')}`}
      </small>
    </article>

    <article class="content-intelligence-panel__card" data-content-intelligence-rights>
      <h4>Rights Metadata</h4>
      <label><span>copyrightOwner</span><input bind:value={rights.copyrightOwner} /></label>
      <label><span>rightsHolder</span><input bind:value={rights.rightsHolder} /></label>
      <label><span>licensingStatus</span><input bind:value={rights.licensingStatus} /></label>
      <label><span>licensingContact</span><input bind:value={rights.licensingContact} /></label>
      <label class="check"><input type="checkbox" bind:checked={rights.musicRightsCleared} /><span>musicRightsCleared</span></label>
      <label class="check"><input type="checkbox" bind:checked={rights.talentReleasesObtained} /><span>talentReleasesObtained</span></label>
      <label class="check"><input type="checkbox" bind:checked={rights.locationReleasesObtained} /><span>locationReleasesObtained</span></label>
      <small class:ok={validation.rightsValidation.valid}>
        {validation.rightsValidation.valid
          ? 'Rights model valid'
          : `Missing: ${validation.rightsValidation.missingFields.join(', ')}`}
      </small>
    </article>
  </div>

  <article class="content-intelligence-panel__card content-intelligence-panel__card--discovery" data-content-intelligence-discovery>
    <h4>Discovery Fields</h4>
    <label><span>mood (comma separated)</span><input value={toCsv(discovery.mood)} on:input={(e) => (discovery.mood = parseCsv(e.currentTarget.value))} /></label>
    <label><span>topics (comma separated)</span><input value={toCsv(discovery.topics)} on:input={(e) => (discovery.topics = parseCsv(e.currentTarget.value))} /></label>
    <label><span>audienceInterests (comma separated)</span><input value={toCsv(discovery.audienceInterests)} on:input={(e) => (discovery.audienceInterests = parseCsv(e.currentTarget.value))} /></label>
    <label><span>searchKeywords (comma separated)</span><input value={toCsv(discovery.searchKeywords)} on:input={(e) => (discovery.searchKeywords = parseCsv(e.currentTarget.value))} /></label>
    <label><span>sponsorshipCategories (comma separated)</span><input value={toCsv(discovery.sponsorshipCategories)} on:input={(e) => (discovery.sponsorshipCategories = parseCsv(e.currentTarget.value))} /></label>
    <label><span>collectionCategories (comma separated)</span><input value={toCsv(discovery.collectionCategories)} on:input={(e) => (discovery.collectionCategories = parseCsv(e.currentTarget.value))} /></label>
    <small class:ok={validation.discoveryValidation.valid}>
      {validation.discoveryValidation.valid
        ? 'Discovery fields valid'
        : `Missing: ${validation.discoveryValidation.missingFields.join(', ')}`}
    </small>
  </article>

  <p class="content-intelligence-panel__status" role="status">{statusMessage}</p>
</section>

<style>
  .content-intelligence-panel {
    margin: 0.9rem 0;
    padding: 0.9rem;
    border-radius: 12px;
    border: 1px solid rgba(163, 119, 255, 0.35);
    background: rgba(163, 119, 255, 0.08);
  }
  .content-intelligence-panel__header {
    display: flex;
    justify-content: space-between;
    gap: 0.8rem;
    align-items: flex-start;
    margin-bottom: 0.8rem;
  }
  .content-intelligence-panel__badge {
    font-size: 0.56rem;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: #c9a6ff;
  }
  .content-intelligence-panel h3 {
    margin: 0.15rem 0 0.2rem;
    font-size: 0.9rem;
    color: #fff;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .content-intelligence-panel p {
    margin: 0;
    font-size: 0.68rem;
    color: rgba(255, 255, 255, 0.7);
  }
  .content-intelligence-panel__actions {
    display: flex;
    gap: 0.35rem;
    flex-wrap: wrap;
  }
  .content-intelligence-panel__actions button {
    border: 1px solid rgba(201, 166, 255, 0.55);
    background: rgba(201, 166, 255, 0.16);
    color: #f4ecff;
    border-radius: 999px;
    padding: 0.28rem 0.56rem;
    font-size: 0.58rem;
    cursor: pointer;
  }
  .content-intelligence-panel__grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.6rem;
  }
  .content-intelligence-panel__card {
    border: 1px solid rgba(255, 255, 255, 0.13);
    border-radius: 9px;
    background: rgba(10, 10, 18, 0.5);
    padding: 0.6rem;
    display: grid;
    gap: 0.35rem;
    align-content: start;
  }
  .content-intelligence-panel__card h4 {
    margin: 0 0 0.2rem;
    font-size: 0.66rem;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: #e7d8ff;
  }
  .content-intelligence-panel__card label {
    display: grid;
    gap: 0.22rem;
  }
  .content-intelligence-panel__card label span {
    font-size: 0.54rem;
    color: rgba(255, 255, 255, 0.64);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .content-intelligence-panel__card input,
  .content-intelligence-panel__card textarea {
    width: 100%;
    border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.18);
    background: rgba(0, 0, 0, 0.3);
    color: #fff;
    font: inherit;
    font-size: 0.62rem;
    padding: 0.36rem 0.45rem;
  }
  .content-intelligence-panel__card .check {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }
  .content-intelligence-panel__card small {
    color: #ffb3b3;
    font-size: 0.56rem;
  }
  .content-intelligence-panel__card small.ok {
    color: #84ffca;
  }
  .content-intelligence-panel__status {
    margin-top: 0.7rem;
    font-size: 0.62rem;
    color: rgba(255, 255, 255, 0.78);
  }
  .content-intelligence-panel__card--discovery {
    margin-top: 0.6rem;
  }
  @media (max-width: 1200px) {
    .content-intelligence-panel__grid {
      grid-template-columns: 1fr;
    }
  }
</style>

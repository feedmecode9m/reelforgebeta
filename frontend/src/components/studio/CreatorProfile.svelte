<script>
    import { onMount } from 'svelte';
    import {
        buildCreatorProfile,
        initCreatorProfileEngine,
        updateCreatorProfile,
        viewCreatorProfile
    } from '../../lib/creator/creatorProfileEngine.js';
    import { getStudioCreatorId } from '../../lib/marketplace/marketplaceEngine.js';

    /** @type {Record<string, unknown>[]} */
    export let feedReels = [];
    /** @type {string} */
    export let seriesId = 'series-neon-vengeance';
    /** @type {string | null} */
    export let creatorId = null;

    let profile = null;
    let editBio = '';
    let editSkills = '';
    let saveMessage = '';

    function resolvedCreatorId() {
        return creatorId || getStudioCreatorId();
    }

    function refresh(reason = 'component_refresh') {
        const id = resolvedCreatorId();
        profile = viewCreatorProfile(id, { seriesId, feedReels, reason });
        editBio = profile?.bio || '';
        editSkills = Array.isArray(profile?.skills) ? profile.skills.join(', ') : '';
    }

    function saveProfilePatch() {
        const id = resolvedCreatorId();
        profile = updateCreatorProfile(id, {
            bio: String(editBio || '').trim(),
            skills: String(editSkills || '')
                .split(',')
                .map((item) => item.trim())
                .filter(Boolean)
                .slice(0, 16)
        });
        saveMessage = 'Profile updated';
    }

    function handleProfileUpdated() {
        refresh('event_profile_updated');
    }

    onMount(() => {
        initCreatorProfileEngine({ creatorId: resolvedCreatorId(), seriesId, feedReels });
        buildCreatorProfile({ creatorId: resolvedCreatorId(), seriesId, feedReels, reason: 'mount' });
        refresh('mount');
        window.addEventListener('reelforge:creator-profile-updated', handleProfileUpdated);
        return () => window.removeEventListener('reelforge:creator-profile-updated', handleProfileUpdated);
    });

    $: creatorId, seriesId, feedReels, refresh('props_update');
</script>

<section class="creator-profile" data-creator-profile>
    <header class="creator-profile__header">
        <img src={profile?.avatar} alt={`${profile?.displayName || 'Creator'} avatar`} data-profile-avatar />
        <div>
            <h4 data-profile-name>{profile?.displayName || 'Creator'}</h4>
            <p data-profile-bio>{profile?.bio || 'Profile loading...'}</p>
        </div>
    </header>

    <div class="creator-profile__grid">
        <article data-profile-marketplace>
            <h5>Marketplace Rating</h5>
            <strong>{profile?.marketplace?.rating ?? 0}/5</strong>
            <p>
                {profile?.marketplace?.reviewCount ?? 0} reviews ·
                {profile?.marketplace?.activeListings ?? 0} listings ·
                {profile?.marketplace?.completedGigs ?? 0} completed gigs
            </p>
        </article>
        <article data-profile-revenue>
            <h5>Revenue Stats</h5>
            <strong>{profile?.revenue?.netFormatted || '$0'}</strong>
            <p>Gross {profile?.revenue?.grossFormatted || '$0'} · MRR {profile?.revenue?.mrrFormatted || '$0'}</p>
            <small>ARR {profile?.revenue?.arrFormatted || '$0'}</small>
        </article>
        <article data-profile-teams>
            <h5>Team Memberships</h5>
            <ul>
                {#if profile?.teamMemberships?.length}
                    {#each profile.teamMemberships as team (team.teamId)}
                        <li>{team.teamName} · {team.role}</li>
                    {/each}
                {:else}
                    <li>No active team memberships</li>
                {/if}
            </ul>
        </article>
        <article data-profile-skills>
            <h5>Skills</h5>
            <p>{profile?.skills?.join(', ') || 'No skills listed yet.'}</p>
        </article>
    </div>

    <div class="creator-profile__sections">
        <article data-profile-portfolio>
            <h5>Portfolio</h5>
            <ul>
                {#if profile?.portfolio?.length}
                    {#each profile.portfolio as item (item.id)}
                        <li>
                            <strong>{item.title}</strong>
                            <span>{item.category}</span>
                            <p>{item.summary}</p>
                        </li>
                    {/each}
                {:else}
                    <li>No portfolio samples yet.</li>
                {/if}
            </ul>
        </article>

        <article data-profile-projects>
            <h5>Published Projects</h5>
            <ul>
                {#if profile?.publishedProjects?.length}
                    {#each profile.publishedProjects as project (project.id)}
                        <li>
                            <strong>{project.title}</strong>
                            <span>{project.status}</span>
                        </li>
                    {/each}
                {:else}
                    <li>No published projects tracked.</li>
                {/if}
            </ul>
        </article>

        <article data-profile-history>
            <h5>Production History</h5>
            <ul>
                {#if profile?.productionHistory?.length}
                    {#each profile.productionHistory as event (event.id)}
                        <li>
                            <strong>{event.title}</strong>
                            <span>{event.type} · {event.status}</span>
                        </li>
                    {/each}
                {:else}
                    <li>No production history yet.</li>
                {/if}
            </ul>
        </article>
    </div>

    <footer class="creator-profile__editor">
        <label>
            <span>Bio</span>
            <textarea bind:value={editBio} rows="2"></textarea>
        </label>
        <label>
            <span>Skills (comma-separated)</span>
            <input type="text" bind:value={editSkills} />
        </label>
        <button type="button" on:click={saveProfilePatch} data-profile-save>Save Profile</button>
        <p data-profile-save-status>{saveMessage || 'Ready'}</p>
    </footer>
</section>

<style>
    .creator-profile {
        margin-bottom: 0.85rem;
        padding: 0.85rem;
        border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.03);
    }
    .creator-profile__header {
        display: grid;
        grid-template-columns: 3rem 1fr;
        gap: 0.6rem;
        align-items: center;
        margin-bottom: 0.7rem;
    }
    .creator-profile__header img {
        width: 3rem;
        height: 3rem;
        border-radius: 50%;
        border: 1px solid rgba(255, 255, 255, 0.2);
        object-fit: cover;
    }
    .creator-profile__header h4 {
        margin: 0;
        font-size: 0.78rem;
        color: #fff;
    }
    .creator-profile__header p {
        margin: 0.2rem 0 0;
        font-size: 0.62rem;
        color: rgba(255, 255, 255, 0.65);
    }
    .creator-profile__grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 0.45rem;
        margin-bottom: 0.6rem;
    }
    .creator-profile__grid article,
    .creator-profile__sections article {
        border: 1px solid rgba(255, 255, 255, 0.09);
        border-radius: 8px;
        background: rgba(0, 0, 0, 0.2);
        padding: 0.45rem;
    }
    .creator-profile h5 {
        margin: 0 0 0.2rem;
        font-size: 0.58rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: rgba(255, 255, 255, 0.56);
    }
    .creator-profile strong {
        font-size: 0.68rem;
        color: #fff;
    }
    .creator-profile p,
    .creator-profile span,
    .creator-profile li,
    .creator-profile small {
        font-size: 0.6rem;
        color: rgba(255, 255, 255, 0.68);
    }
    .creator-profile__sections {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 0.45rem;
        margin-bottom: 0.55rem;
    }
    .creator-profile ul {
        margin: 0;
        padding-left: 0.9rem;
        display: grid;
        gap: 0.2rem;
    }
    .creator-profile__editor {
        display: grid;
        grid-template-columns: 2fr 2fr auto;
        gap: 0.45rem;
        align-items: end;
    }
    .creator-profile__editor label {
        display: grid;
        gap: 0.2rem;
    }
    .creator-profile__editor span {
        font-size: 0.56rem;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: rgba(255, 255, 255, 0.5);
    }
    .creator-profile__editor textarea,
    .creator-profile__editor input {
        width: 100%;
        padding: 0.35rem 0.45rem;
        border-radius: 6px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(255, 255, 255, 0.04);
        color: #fff;
        font-size: 0.61rem;
    }
    .creator-profile__editor button {
        border: 1px solid rgba(0, 242, 255, 0.38);
        background: rgba(0, 242, 255, 0.1);
        color: #00f2ff;
        border-radius: 6px;
        padding: 0.35rem 0.55rem;
        font-size: 0.58rem;
        cursor: pointer;
    }
    .creator-profile__editor p {
        margin: 0;
        font-size: 0.56rem;
        color: rgba(255, 255, 255, 0.6);
    }
    @media (max-width: 1100px) {
        .creator-profile__grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .creator-profile__sections {
            grid-template-columns: 1fr;
        }
        .creator-profile__editor {
            grid-template-columns: 1fr;
        }
    }
</style>

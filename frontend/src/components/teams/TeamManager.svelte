<script>
    import { onMount } from 'svelte';
    import {
        TEAM_ROLES,
        addMemberToTeam,
        assignTaskToMember,
        changeMemberRole,
        ensureTeamForSeries,
        getAssignedTasksForMember,
        getCurrentTeamUserId,
        getOpenTasksForAssignment,
        setCurrentTeamUserId
    } from '../../lib/teams/creatorTeams.js';

    /** @type {string} */
    export let seriesId = '';

    /** @type {import('../../lib/teams/creatorTeams.js').TeamSnapshot | null} */
    let team = null;
    let selectedUserId = getCurrentTeamUserId();
    let selectedMemberId = '';
    let selectedTaskId = '';
    let newMemberUserId = '';
    let newMemberRole = 'EDITOR';
    let loading = true;

    /** @type {Record<string, unknown>[]} */
    let assignedTasks = [];

    /** @type {Record<string, string>} */
    let memberRoles = {};

    async function refreshTeam() {
        if (!seriesId) return;
        loading = true;
        team = await ensureTeamForSeries(seriesId);
        memberRoles = Object.fromEntries((team?.members || []).map((member) => [member.userId, member.role]));
        if (!selectedMemberId && team?.members?.length) {
            selectedMemberId = team.members[0].userId;
        }
        await refreshAssignedTasks();
        loading = false;
    }

    async function refreshAssignedTasks() {
        if (!team?.id || !selectedMemberId) {
            assignedTasks = [];
            return;
        }
        assignedTasks = await getAssignedTasksForMember(team.id, selectedMemberId, seriesId);
    }

    onMount(() => {
        void refreshTeam();
        const onUpdate = () => void refreshTeam();
        window.addEventListener('reelforge:teams-updated', onUpdate);
        window.addEventListener('reelforge:workflow-tasks-updated', onUpdate);
        return () => {
            window.removeEventListener('reelforge:teams-updated', onUpdate);
            window.removeEventListener('reelforge:workflow-tasks-updated', onUpdate);
        };
    });

    $: seriesId, refreshTeam();

    function handleCurrentUserChange() {
        setCurrentTeamUserId(selectedUserId);
    }

    async function handleAddMember() {
        if (!team?.id || !newMemberUserId) return;
        await addMemberToTeam(team.id, newMemberUserId, /** @type {import('../../lib/teams/creatorTeams.js').TeamRole} */ (newMemberRole));
        newMemberUserId = '';
        await refreshTeam();
    }

    /** @param {string} userId @param {string} role */
    async function handleRoleChange(userId, role) {
        if (!team?.id) return;
        await changeMemberRole(
            team.id,
            userId,
            /** @type {import('../../lib/teams/creatorTeams.js').TeamRole} */ (role)
        );
        await refreshTeam();
    }

    async function handleAssignTask() {
        if (!team?.id || !selectedTaskId || !selectedMemberId) return;
        await assignTaskToMember(team.id, selectedTaskId, selectedMemberId, seriesId);
        selectedTaskId = '';
        await refreshTeam();
    }

    $: openTasks = team ? getOpenTasksForAssignment(seriesId) : [];
    $: availableUsers = (team?.users || []).filter(
        (user) => !team?.members?.some((member) => member.userId === user.id)
    );
</script>

{#if team}
    <div class="team-manager" data-team-manager>
        <div class="team-manager__header">
            <h4 class="team-manager__title">Creator Teams</h4>
            <span class="team-manager__hint">{team.name}</span>
        </div>

        <label class="team-manager__field">
            <span>Acting as</span>
            <select bind:value={selectedUserId} on:change={handleCurrentUserChange} data-team-current-user>
                {#each team.users.length ? team.users : team.members as user (user.id || user.userId)}
                    <option value={user.id || user.userId}>
                        {user.displayName || user.display_name || user.id || user.userId}
                    </option>
                {/each}
            </select>
        </label>

        <div class="team-manager__section" data-team-members>
            <span class="team-manager__label">Team Members</span>
            <ul class="team-manager__member-list">
                {#each team.members as member (member.userId)}
                    <li class="team-manager__member" data-team-member data-member-id={member.userId}>
                        <div class="team-manager__member-main">
                            <strong>{member.displayName}</strong>
                            <span class="team-manager__member-role" data-team-member-role>{member.role}</span>
                        </div>
                        <select
                            class="team-manager__role-select"
                            bind:value={memberRoles[member.userId]}
                            data-team-role-select
                            on:change={() => handleRoleChange(member.userId, memberRoles[member.userId])}
                        >
                            {#each TEAM_ROLES as role}
                                <option value={role}>{role}</option>
                            {/each}
                        </select>
                    </li>
                {/each}
            </ul>
        </div>

        {#if availableUsers.length > 0}
            <div class="team-manager__section" data-team-add-member>
                <span class="team-manager__label">Add Member</span>
                <div class="team-manager__add-row">
                    <select bind:value={newMemberUserId} data-team-add-user>
                        <option value="">Select user...</option>
                        {#each availableUsers as user (user.id)}
                            <option value={user.id}>{user.displayName || user.display_name}</option>
                        {/each}
                    </select>
                    <select bind:value={newMemberRole} data-team-add-role>
                        {#each TEAM_ROLES as role}
                            <option value={role}>{role}</option>
                        {/each}
                    </select>
                    <button
                        type="button"
                        class="team-manager__btn"
                        data-team-add-member-btn
                        disabled={!newMemberUserId}
                        on:click={handleAddMember}
                    >
                        Add
                    </button>
                </div>
            </div>
        {/if}

        <div class="team-manager__section" data-team-task-assignment>
            <span class="team-manager__label">Assign Workflow Task</span>
            <div class="team-manager__add-row">
                <select bind:value={selectedTaskId} data-team-task-select>
                    <option value="">Select task...</option>
                    {#each openTasks as task (task.id)}
                        <option value={task.id}>{task.title || task.id}</option>
                    {/each}
                </select>
                <select bind:value={selectedMemberId} data-team-assignee-select>
                    {#each team.members as member (member.userId)}
                        <option value={member.userId}>{member.displayName}</option>
                    {/each}
                </select>
                <button
                    type="button"
                    class="team-manager__btn team-manager__btn--primary"
                    data-team-assign-task
                    disabled={!selectedTaskId || !selectedMemberId}
                    on:click={handleAssignTask}
                >
                    Assign
                </button>
            </div>
        </div>

        <div class="team-manager__section" data-team-assigned-tasks>
            <span class="team-manager__label">Assigned Tasks</span>
            <label class="team-manager__field team-manager__field--inline">
                <span>Member</span>
                <select
                    bind:value={selectedMemberId}
                    on:change={refreshAssignedTasks}
                    data-team-assigned-member
                >
                    {#each team.members as member (member.userId)}
                        <option value={member.userId}>{member.displayName}</option>
                    {/each}
                </select>
            </label>
            {#if assignedTasks.length > 0}
                <ul class="team-manager__task-list">
                    {#each assignedTasks as task (task.id)}
                        <li class="team-manager__task" data-team-assigned-task data-task-id={task.id}>
                            <span>{task.title || task.id}</span>
                            <span class="team-manager__task-meta">{task.status || 'IN_PROGRESS'}</span>
                        </li>
                    {/each}
                </ul>
            {:else}
                <p class="team-manager__empty" data-team-no-assigned-tasks>No assigned tasks yet.</p>
            {/if}
        </div>

        <div class="team-manager__section" data-team-activity>
            <span class="team-manager__label">Team Activity</span>
            {#if team.activity.length > 0}
                <ul class="team-manager__activity-list">
                    {#each team.activity.slice(0, 8) as item (item.id)}
                        <li class="team-manager__activity" data-team-activity-item data-activity-type={item.activityType || item.activity_type}>
                            <span class="team-manager__activity-type">
                                {item.activityType || item.activity_type}
                            </span>
                            <span class="team-manager__activity-user">
                                {item.displayName || item.display_name || 'System'}
                            </span>
                        </li>
                    {/each}
                </ul>
            {:else if !loading}
                <p class="team-manager__empty">No team activity recorded yet.</p>
            {/if}
        </div>
    </div>
{/if}

<style>
    .team-manager {
        margin-top: 0.85rem;
        padding: 0.85rem;
        border-radius: 8px;
        border: 1px solid rgba(157, 255, 176, 0.22);
        background: rgba(157, 255, 176, 0.04);
    }
    .team-manager__header {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 0.35rem;
        margin-bottom: 0.5rem;
    }
    .team-manager__title {
        margin: 0;
        font-size: 0.72rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #9dffb0;
    }
    .team-manager__hint {
        font-size: 0.62rem;
        color: rgba(255, 255, 255, 0.45);
        text-transform: uppercase;
    }
    .team-manager__section {
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
        margin-top: 0.55rem;
    }
    .team-manager__label {
        font-size: 0.62rem;
        text-transform: uppercase;
        letter-spacing: 0.07em;
        color: rgba(255, 255, 255, 0.55);
    }
    .team-manager__field {
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
        margin-bottom: 0.35rem;
    }
    .team-manager__field--inline {
        max-width: 240px;
    }
    .team-manager__field span {
        font-size: 0.58rem;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.45);
    }
    .team-manager__field select,
    .team-manager__add-row select {
        padding: 0.35rem 0.5rem;
        border-radius: 6px;
        border: 1px solid rgba(255, 255, 255, 0.15);
        background: rgba(0, 0, 0, 0.28);
        color: #fff;
        font: inherit;
        font-size: 0.72rem;
    }
    .team-manager__member-list,
    .team-manager__task-list,
    .team-manager__activity-list {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
    }
    .team-manager__member,
    .team-manager__task,
    .team-manager__activity {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.45rem;
        padding: 0.45rem 0.55rem;
        border-radius: 6px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        background: rgba(0, 0, 0, 0.2);
    }
    .team-manager__member-main {
        display: flex;
        flex-direction: column;
        gap: 0.1rem;
        min-width: 8rem;
    }
    .team-manager__member-main strong {
        font-size: 0.74rem;
        color: rgba(255, 255, 255, 0.92);
    }
    .team-manager__member-role {
        font-size: 0.58rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: #9dffb0;
    }
    .team-manager__role-select {
        min-width: 7rem;
    }
    .team-manager__add-row {
        display: flex;
        flex-wrap: wrap;
        gap: 0.35rem;
        align-items: center;
    }
    .team-manager__btn {
        padding: 0.35rem 0.65rem;
        border-radius: 6px;
        border: 1px solid rgba(255, 255, 255, 0.2);
        background: rgba(255, 255, 255, 0.05);
        color: rgba(255, 255, 255, 0.85);
        font-size: 0.62rem;
        font-weight: 700;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        cursor: pointer;
    }
    .team-manager__btn--primary {
        border-color: #9dffb0;
        background: rgba(157, 255, 176, 0.12);
        color: #9dffb0;
    }
    .team-manager__btn:disabled {
        opacity: 0.45;
        cursor: not-allowed;
    }
    .team-manager__task-meta,
    .team-manager__activity-type {
        font-size: 0.58rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: rgba(255, 255, 255, 0.5);
    }
    .team-manager__activity-user {
        font-size: 0.68rem;
        color: rgba(255, 255, 255, 0.75);
    }
    .team-manager__empty {
        margin: 0;
        font-size: 0.68rem;
        color: rgba(255, 255, 255, 0.45);
    }
</style>

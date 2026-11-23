<script lang="ts">
  /** The profession selector: the actions a lesson can train, grouped by skill. */

  import { ACCENT } from '#lib/theme'
  import { href } from '#lib/paths'
  import { groupedActions, usableActions } from '#lib/learnview'

  interface Props {
    groups: ReturnType<typeof groupedActions>
    selected: ReturnType<typeof usableActions>[number] | undefined
    actionId: string
    onChoose: (e: Event) => void
  }

  let { groups, selected, actionId, onChoose }: Props = $props()
</script>

<section class="panel mb-4 p-4" style="--accent: {ACCENT.arcane}">
  <div class="flex items-baseline justify-between">
    <p class="eyebrow">Profession</p>
    {#if selected}
      <span class="chip" style="--accent: {ACCENT.arcane}">
        {selected.skill.icon}
        {selected.skill.name}
      </span>
    {/if}
  </div>
  {#if groups.length === 0}
    <p class="mt-2 text-sm text-ink-400">
      No profession is ready to train.
      <a href={href('/skills')} class="link">Unlock one in Skills</a>.
    </p>
  {:else}
    <select value={actionId} onchange={onChoose} class="field mt-2">
      <option value="">Choose a profession…</option>
      {#each groups as group (group.skill.id)}
        <optgroup label="{group.skill.icon} {group.skill.name}">
          {#each group.actions as action (action.id)}
            <option value={action.id}>{action.name}</option>
          {/each}
        </optgroup>
      {/each}
    </select>
    {#if selected}
      <p class="mt-2 text-xs text-ink-400">{selected.action.description}</p>
    {:else}
      <p class="mt-2 text-xs text-brass-300">
        Pick a profession first — lessons train that profession.
      </p>
    {/if}
  {/if}
</section>

<script lang="ts">
  import { ACCENT, accentStyle } from '#lib/theme'
  import type { GearResponse } from '#lib/skills'

  interface Props {
    sets: GearResponse['sets']
    name: string
    onSave: () => void
    onApply: (setId: string) => void
    onRemove: (setId: string) => void
  }

  let { sets, name = $bindable(), onSave, onApply, onRemove }: Props = $props()
</script>

<section class="mt-6" style={accentStyle(ACCENT.violet)}>
  <div class="flex items-center justify-between border-b border-ink-700 pb-2">
    <h2 class="eyebrow" style="color: var(--accent)">Loadouts</h2>
    <span class="text-xs text-ink-400">{sets.length} saved</span>
  </div>
  <div class="mt-3 flex gap-2">
    <label class="sr-only" for="loadout-name">Loadout name</label>
    <input
      id="loadout-name"
      class="field flex-1"
      placeholder="Set name (e.g. Ranged)"
      bind:value={name}
      onkeydown={(e) => e.key === 'Enter' && onSave()}
    />
    <button type="button" class="btn btn-primary" onclick={onSave}>Save</button>
  </div>
  <div class="mt-3 space-y-2">
    {#if sets.length === 0}
      <p class="text-xs text-ink-400">
        Save the current loadout, then swap the whole outfit in one tap.
      </p>
    {/if}
    {#each sets as set (set.id)}
      <div class="flex items-center justify-between gap-3 border-b border-ink-700 pb-2">
        <div class="min-w-0">
          <p class="display truncate text-sm text-ink-100">{set.name}</p>
          <p class="text-[11px] text-ink-400">
            {set.combatStyle} · {Object.keys(set.slots).length} slots
          </p>
        </div>
        <div class="flex shrink-0 gap-1">
          <button
            type="button"
            class="btn btn-primary px-2 py-1 text-[11px]"
            onclick={() => onApply(set.id)}
          >
            Wear
          </button>
          <button
            type="button"
            class="btn btn-ghost px-2 py-1 text-[11px]"
            onclick={() => onRemove(set.id)}
          >
            Delete
          </button>
        </div>
      </div>
    {/each}
  </div>
</section>

<script lang="ts">
  import { ACCENT, accentStyle, tierAccent } from '#lib/theme'
  import Icon from '#lib/components/Icon.svelte'
  import { itemIcon, itemName } from './itemName'
  import type { HitResult } from '#lib/combat'
  import type { ItemDTO } from '#lib/skills'

  interface Props {
    hit: HitResult
    itemMap: Map<string, ItemDTO>
    onLeave: () => void
  }

  let { hit, itemMap, onLeave }: Props = $props()

  const name = (id: string) => itemName(itemMap, id)
  const icon = (id: string) => itemIcon(itemMap, id)
</script>

<div
  class="panel panel-accent p-5"
  style="--accent: {hit.outcome === 'won' ? ACCENT.jade : ACCENT.ember}"
>
  <p
    class="display flex items-center gap-2 text-lg {hit.outcome === 'won'
      ? 'text-jade-300'
      : 'text-ember-300'}"
  >
    <Icon name={hit.outcome === 'won' ? 'trophy' : 'skull'} size={18} />
    {hit.outcome === 'won' ? 'Victory!' : 'Defeated'}
  </p>
  {#if hit.drops.length}
    <p class="mt-2 text-sm text-ink-300">Loot:</p>
    <div class="mt-1 flex flex-wrap gap-2">
      {#each hit.drops as d (d.item)}
        <span class="chip" style={accentStyle(tierAccent(itemMap.get(d.item)?.tier))}>
          +{d.count}
          {icon(d.item)}
          {name(d.item)}
        </span>
      {/each}
    </div>
  {/if}
</div>
<button onclick={onLeave} class="btn btn-primary mt-4 w-full py-3">Back to monsters</button>

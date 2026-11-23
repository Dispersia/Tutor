<script lang="ts">
  /** A profession's actions: banded (Smithing) or a flat list, each an ActionRow. */

  import { ACCENT } from '#lib/theme'
  import { bandBuff } from '#lib/skillview'
  import ActionRow from '#lib/components/skill/ActionRow.svelte'
  import type { ActionDTO, ItemDTO, SkillDTO } from '#lib/skills'

  interface Props {
    skill: SkillDTO
    bandGroups: {
      groups: { band: NonNullable<SkillDTO['bands']>[number]; actions: ActionDTO[] }[]
      other: ActionDTO[]
    } | null
    accent: string
    itemMap: Map<string, ItemDTO>
    ownedMap: Map<string, number>
    sources: Record<string, { skillId: string; actionId: string }>
    firstTrainableId: string | undefined
    flash: string | null
    now: number
    busy: boolean
    onTrain: (a: ActionDTO) => void
    onPickChoice: (a: ActionDTO, choiceId: string) => void
    onCancelRig: (a: ActionDTO) => void
  }

  let {
    skill,
    bandGroups,
    accent,
    itemMap,
    ownedMap,
    sources,
    firstTrainableId,
    flash,
    now,
    busy,
    onTrain,
    onPickChoice,
    onCancelRig,
  }: Props = $props()
</script>

{#snippet row(a: ActionDTO)}
  <ActionRow
    {a}
    {accent}
    {itemMap}
    {ownedMap}
    {sources}
    {firstTrainableId}
    {flash}
    {now}
    {busy}
    {onTrain}
    {onPickChoice}
    {onCancelRig}
  />
{/snippet}

<h2 class="mt-6 eyebrow xl:mt-0" style="color: {accent}">Actions</h2>
<p class="mt-1 border-b border-ink-700 pb-2 text-xs text-ink-400">
  {skill.actions.length} action{skill.actions.length === 1 ? '' : 's'} · {skill.actions.filter(
    (a) => a.unlocked,
  ).length} unlocked
</p>

{#if bandGroups}
  <!-- A metal is a band (§13.5.3): one shared score, a dropdown of the whole
       set, and the next metal opening at Lv 40. -->
  <div class="mt-3 flex flex-col gap-3">
    {#each bandGroups.groups as g (g.band.id)}
      {@const b = g.band}
      {@const open = b.gearUnlocked < b.gearTotal || g.actions.some((a) => a.unlocked)}
      <details class="panel px-2.5 py-2" {open}>
        <summary class="flex cursor-pointer flex-wrap items-center gap-x-2 gap-y-0.5 select-none">
          <span class="text-base" aria-hidden="true">{b.icon}</span>
          <span class="display text-sm font-semibold text-ink-100">{b.name}</span>
          <span class="display text-sm font-bold tabular-nums" style="color: {accent}"
            >Lv {b.level}</span
          >
          <span class="text-[11px] text-ink-400">{b.gearUnlocked}/{b.gearTotal} gear</span>
          <span class="ml-auto text-[11px]" style="color: {ACCENT.jade}"
            >{bandBuff(b) ? `now ${bandBuff(b)}` : b.buffLabel}</span
          >
        </summary>
        <div class="bar mt-1.5 h-1.5"><i style="width: {b.progress * 100}%"></i></div>
        <p class="mt-1 text-[11px] text-ink-400">
          {#if b.nextUnlock}
            Next: {b.nextUnlock.name} at {b.name} {b.nextUnlock.level}.
          {/if}
          {#if b.level < b.gearUnlockLevel}
            All {b.name} gear by Lv {b.gearUnlockLevel}; the next metal opens then.
          {:else}
            Gear unlocked · keeps giving {b.buffLabel} and {b.enchantLabel} reagents to Lv 100.
          {/if}
        </p>
        <ul class="mt-2 flex flex-col gap-1.5">
          {#each g.actions as a (a.id)}{@render row(a)}{/each}
        </ul>
      </details>
    {/each}
    {#if bandGroups.other.length}
      <ul class="flex flex-col gap-1.5">
        {#each bandGroups.other as a (a.id)}{@render row(a)}{/each}
      </ul>
    {/if}
  </div>
{:else}
  <ul class="mt-2 flex flex-col gap-1.5">
    {#each skill.actions as a (a.id)}{@render row(a)}{/each}
  </ul>
{/if}

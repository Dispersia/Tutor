<script lang="ts">
  import { href } from '#lib/paths'
  import { ACCENT } from '#lib/theme'
  import Icon from '#lib/components/Icon.svelte'
  import type { HitResult } from '#lib/combat'
  import type { ItemDTO, SkillsResponse } from '#lib/skills'

  interface Props {
    hit: HitResult
    skillMap: Map<string, SkillsResponse['skills'][number]>
    itemMap: Map<string, ItemDTO>
  }

  let { hit, skillMap, itemMap }: Props = $props()

  const name = (id: string) => itemMap.get(id)?.name ?? id
</script>

<div class="mb-3 flex flex-wrap gap-2">
  {#if hit.correct}
    <span class="chip gap-1" style="--accent: {ACCENT.jade}"
      ><Icon name="sword" size={12} /> you hit for {hit.damage}</span
    >
    {#if hit.crit}
      <span class="chip" style="--accent: {ACCENT.ember}">Critical!</span>
    {/if}
    {#if hit.haste}
      <span class="chip" style="--accent: {ACCENT.azure}">Haste strike</span>
    {/if}
  {/if}
  {#if hit.playerDamage > 0}
    <span class="chip gap-1" style="--accent: {ACCENT.ember}"
      ><Icon name="burst" size={12} /> it hit you for {hit.playerDamage}</span
    >
  {/if}
  {#if hit.xp > 0}
    <span class="chip" style="--accent: {ACCENT.azure}">
      {skillMap.get(hit.skill)?.icon ?? ''} +{hit.xp}
      {skillMap.get(hit.skill)?.name ?? hit.skill}
    </span>
  {/if}
  {#if hit.defenceXp > 0}
    <span class="chip gap-1" style="--accent: {ACCENT.jade}">
      <Icon name="shield" size={12} /> +{hit.defenceXp} Defence
    </span>
  {/if}
  {#if hit.constitutionXp > 0}
    <span class="chip gap-1" style="--accent: {ACCENT.ember}">
      <Icon name="heart" size={12} /> +{hit.constitutionXp} Constitution
    </span>
  {/if}
  {#if hit.ate}
    <span class="chip gap-1" style="--accent: {ACCENT.brass}">
      <Icon name="food" size={12} /> auto-ate {name(hit.ate.item)} (+{hit.ate.heal})
    </span>
  {/if}
  {#if hit.talentUnlocked}
    <a href={href(`/skills/${hit.skill}`)} class="chip" style="--accent: {ACCENT.gold}">
      Talent unlocked — choose one
    </a>
  {/if}
</div>

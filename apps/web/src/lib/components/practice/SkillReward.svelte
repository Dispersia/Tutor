<script lang="ts">
  /** The reward strip after a graded answer: the skill chip, gains, rig report. */

  import { href } from '#lib/paths'
  import { ACCENT, categoryAccent } from '#lib/theme'
  import RigReport from '#lib/components/practice/RigReport.svelte'
  import type { SkillOutcome, SkillsResponse } from '#lib/skills'

  interface Props {
    skill: SkillOutcome
    skillMap: Map<string, SkillsResponse['skills'][number]>
    actionName: string | null
    itemMap: Map<string, SkillsResponse['items'][number]>
  }

  let { skill, skillMap, actionName, itemMap }: Props = $props()
</script>

<div class="mb-3 flex flex-wrap gap-2">
  <span class="chip" style="--accent: {ACCENT.azure}">
    {skillMap.get(skill.skillId)?.icon ?? ''}
    {actionName ?? skillMap.get(skill.skillId)?.name ?? skill.skillId}
    +{skill.xp} xp
    {#if skill.leveledUp && skill.level}· Lv {skill.level}!{/if}
  </span>
  {#each skill.gained as g (g.item)}
    <span class="chip" style="--accent: {ACCENT.jade}">
      +{g.count}
      {itemMap.get(g.item)?.icon ?? ''}
      {itemMap.get(g.item)?.name ?? g.item}
    </span>
  {/each}
  {#if skill.idleXp > 0}
    <span class="chip" style="--accent: {ACCENT.gold}">Rigs earned +{skill.idleXp} xp</span>
  {/if}
  {#if skill.talentUnlocked}
    <a href={href(`/skills/${skill.skillId}`)} class="chip" style="--accent: {ACCENT.gold}">
      Talent unlocked — choose one
    </a>
  {/if}
</div>
{#if skill.idle}
  <RigReport
    idle={skill.idle}
    accent={skill.idle.maxed
      ? ACCENT.jade
      : categoryAccent(skillMap.get(skill.skillId)?.category ?? '')}
    rigsRunning={skill.rigsRunning ?? 1}
    maxLiveRigs={skill.maxLiveRigs ?? 2}
    stoppedName={skill.stoppedRig?.name}
  />
{/if}

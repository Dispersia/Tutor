<script lang="ts">
  import { href } from '#lib/paths'
  import { ACCENT, accentStyle } from '#lib/theme'
  import { pct } from '#lib/skillview'
  import Icon from '#lib/components/Icon.svelte'
  import type { RigsSummary, SkillDTO, SkillPageResponse } from '#lib/skills'

  interface Props {
    skill: SkillDTO
    accent: string
    rigs: RigsSummary
    fedBy: SkillPageResponse['fedBy']
  }

  let { skill, accent, rigs, fedBy }: Props = $props()
</script>

<section style={accentStyle(accent)}>
  <div class="border-b border-ink-700 py-3">
    <div class="flex items-baseline justify-between gap-2 text-sm">
      <span class="text-ink-300"
        >Level {skill.level}/100 · average of {skill.actions.length} action{skill.actions.length ===
        1
          ? ''
          : 's'}</span
      >
      <span class="text-ink-400 tabular-nums">{pct(skill.progress)} avg</span>
    </div>
    <div class="bar mt-2"><i style="width: {skill.progress * 100}%"></i></div>
  </div>
  <div class="flex items-baseline justify-between gap-2 border-b border-ink-700 py-3 text-sm">
    <span class="min-w-0 text-ink-300">{skill.effectLabel}</span>
    <span class="display shrink-0 text-lg font-bold" style="color: {accent}"
      >{pct(skill.effect.value)}/lv</span
    >
  </div>
  <div class="flex items-baseline justify-between gap-2 border-b border-ink-700 py-3 text-sm">
    <span class="text-ink-300">XP total</span>
    <span class="display text-lg font-bold text-gold-200 tabular-nums">{skill.xp}</span>
  </div>
  <div class="flex items-baseline justify-between gap-2 border-b border-ink-700 py-3 text-sm">
    <span class="text-ink-300">Rigs running</span>
    <span class="display shrink-0 tabular-nums" style="color: {accent}"
      >{rigs.live}/{rigs.maxLive}</span
    >
  </div>
  {#if skill.category === 'combat'}
    <a
      href={href('/combat')}
      class="flex items-center gap-2 border-b border-ink-700 py-3 text-sm"
      style={accentStyle(accent)}
    >
      <Icon name="skull" size={17} />
      <span class="flex-1 text-ink-100">Go to combat</span>
      <span class="text-ink-400">→</span>
    </a>
  {/if}
</section>

{#if skill.talent.synergy.taken.length}
  <a
    href={href(`/skills/${skill.talent.synergy.target}`)}
    class="flex items-center gap-2.5 border-b border-ink-700 py-3 text-sm"
    style={accentStyle(ACCENT.violet)}
  >
    <Icon name="link" size={16} cls="text-violet-300" />
    <span class="min-w-0 flex-1 text-ink-300">
      Feeds <span class="text-ink-100">{skill.talent.synergy.name}</span>
      <span class="text-ink-400">· {skill.talent.synergy.label}</span>
    </span>
    <span class="text-ink-400">→</span>
  </a>
{/if}

{#each fedBy.filter((f) => f.taken.length) as f (f.skillId)}
  <a
    href={href(`/skills/${f.skillId}`)}
    class="flex items-center gap-2.5 border-b border-ink-700 py-3 text-sm"
    style={accentStyle(ACCENT.violet)}
  >
    <Icon name="link" size={16} cls="text-violet-300" />
    <span class="min-w-0 flex-1 text-ink-300">
      Fed by <span class="text-ink-100">{f.name}</span>
      <span class="text-ink-400">· {f.label}</span>
    </span>
    <span class="text-ink-400">←</span>
  </a>
{/each}

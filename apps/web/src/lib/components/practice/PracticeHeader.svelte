<script lang="ts">
  /** The practice header: title, the skill/quiet/XP/queue chips and the quiet banner. */

  import type { LessonDTO, SrsStats } from '#lib/curriculum'
  import type { SkillOutcome, SkillsResponse } from '#lib/skills'
  import type { Stats } from '#lib/exercises'
  import { lessonLabel } from '#lib/practiceview'
  import { ACCENT } from '#lib/theme'
  import Icon from '#lib/components/Icon.svelte'

  interface Props {
    actionId?: string
    skillName: string
    lesson: LessonDTO | null
    actionName: string | null
    skill: SkillOutcome | null
    skillMap: Map<string, SkillsResponse['skills'][number]>
    quietActive: boolean
    quietLeft: string
    stats: Stats | null
    srsStats: SrsStats | null
    onQuiet: (enabled: boolean) => void
  }

  let {
    actionId,
    skillName,
    lesson,
    actionName,
    skill,
    skillMap,
    quietActive,
    quietLeft,
    stats,
    srsStats,
    onQuiet,
  }: Props = $props()
</script>

<div
  class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-ink-700 pt-4 pb-4 mb-4"
>
  <div class="min-w-0">
    <h1 class="display text-3xl text-ink-100">
      {actionId ? skillName : lesson ? lesson.title : 'Free practice'}
    </h1>
    <p class="sub mt-2">
      {actionId
        ? actionName
        : lesson
          ? `${lessonLabel(lesson)} · ${lesson.learned}/${lesson.cards} learned`
          : 'Spaced repetition picks what’s due'}
    </p>
  </div>
  <div class="flex flex-wrap items-center gap-2 text-xs">
    {#if skillMap.get(skill?.skillId ?? '')}
      <span class="chip" style="--accent: {ACCENT.violet}">
        {skillMap.get(skill!.skillId)!.icon}
        {skillMap.get(skill!.skillId)!.name}
        {skill!.level ?? ''}
      </span>
    {/if}
    <button
      type="button"
      onclick={() => onQuiet(!quietActive)}
      class="chip chip--press gap-1"
      style="--accent: {quietActive ? ACCENT.brass : ACCENT.azure}"
      title={quietActive
        ? 'Listen & speak cards return when this ends — turn it off now'
        : 'Hide listen & speak cards for 15 min'}
      aria-pressed={quietActive}
    >
      <Icon name="mute" size={12} />
      {quietActive ? quietLeft : 'Can’t speak?'}
    </button>
    <span
      class="chip"
      style="--accent: {ACCENT.gold}"
      title="Study XP from graded cards and won fights — fills your daily goal"
    >
      {stats?.xp ?? 0} XP
    </span>
    {#if srsStats}
      <span
        class="chip"
        style="--accent: {srsStats.due > 0 ? ACCENT.azure : ACCENT.jade}"
        title="Cards due for review across your decks"
      >
        {srsStats.due} due
      </span>
      {#if srsStats.budget && !srsStats.budget.newUnlimited}
        <span
          class="chip"
          style="--accent: {srsStats.budget.newRemaining > 0 ? ACCENT.violet : ACCENT.jade}"
          title="New cards left in today's budget"
        >
          {srsStats.budget.newRemaining} new
        </span>
      {/if}
    {/if}
  </div>
</div>

{#if quietActive}
  <div class="panel panel-accent mb-4 p-3 text-xs" style="--accent: {ACCENT.brass}">
    <span class="text-brass-300">Text-only mode</span>
    — listen &amp; speak cards are hidden for
    <span class="gold">{quietLeft}</span>.
    <button type="button" onclick={() => onQuiet(false)} class="cursor-pointer underline"
      >Turn off</button
    >
  </div>
{/if}

<script lang="ts">
  /** The talent rail: one row per milestone, Lv 10 to Lv 100, plus the capstones. */

  import { ACCENT, accentStyle } from '#lib/theme'
  import { isBlocked, unmetOf, type TalentRow } from '#lib/skillview'
  import Icon from '#lib/components/Icon.svelte'
  import type { SkillDTO } from '#lib/skills'

  interface Props {
    skill: SkillDTO
    rail: TalentRow[]
    changing: string | null
    busy: boolean
    onPick: (talentId: string) => void
    onChange: (talentId: string | null) => void
  }

  let { skill, rail, changing, busy, onPick, onChange }: Props = $props()
</script>

<h2 class="mt-6 eyebrow" style="color: {ACCENT.violet}">Talents</h2>
<p class="mt-2 border-b border-ink-700 pb-3 text-xs text-ink-400">
  A choice every 10 levels. At <span class="text-violet-300">Lv 50</span> and
  <span class="text-violet-300">Lv 100</span> a capstone also opens — each gated on a level in
  {skill.talent.synergy.name}.
</p>

<ul style={accentStyle(ACCENT.violet)}>
  {#each rail as r (`${r.kind}:${r.milestone}`)}
    <li class="flex items-start gap-3 border-b border-ink-700 py-3">
      <div
        class="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border tabular-nums {r.state ===
        'locked'
          ? 'border-ink-700 text-ink-400'
          : 'border-violet-400/60 text-violet-300'}"
      >
        {#if r.kind === 'mastery'}
          <Icon name="trophy" size={17} />
        {:else}
          <span class="display text-sm font-bold">{r.milestone}</span>
        {/if}
      </div>

      <div class="min-w-0 flex-1">
        {#if r.kind === 'mastery'}
          <p class="eyebrow mb-1 text-violet-300">Capstone · Lv {r.milestone}</p>
        {/if}

        {#if r.state === 'done' && r.owned}
          {@const t = r.owned}
          <div class="flex items-baseline justify-between gap-2">
            <span class="display text-sm text-ink-100">{t.name}</span>
            {#if r.kind === 'choice'}
              <span class="text-xs text-ink-400 tabular-nums">Lv {t.milestone}</span>
            {/if}
          </div>
          <p class="mt-0.5 text-xs text-ink-400">{t.description}</p>
          <button
            onclick={() => onChange(changing === t.id ? null : t.id)}
            class="mt-1 text-xs text-ink-400 underline hover:text-ink-200"
          >
            {changing === t.id ? 'Cancel' : 'Change'}
          </button>
          {#if changing === t.id}
            <div class="mt-2">
              {#each t.options.filter((o) => o.id !== t.id) as o (o.id)}
                <button
                  onclick={() => onPick(o.id)}
                  disabled={busy || isBlocked(o)}
                  class="flex w-full items-center gap-3 border-t border-ink-700 py-2.5 text-left"
                >
                  <span class="min-w-0 flex-1">
                    <span class="display block text-sm text-ink-200">{o.name}</span>
                    <span class="block text-xs text-ink-400">{o.description}</span>
                  </span>
                  <span class="shrink-0 text-xs {isBlocked(o) ? 'text-ember-300' : 'text-ink-400'}">
                    {isBlocked(o) ? unmetOf(o) : 'Pick'}
                  </span>
                </button>
              {/each}
            </div>
          {/if}
        {:else if r.state === 'open'}
          {#each r.options as o (o.id)}
            <button
              onclick={() => onPick(o.id)}
              disabled={busy || isBlocked(o)}
              class="flex w-full items-center gap-3 py-2 text-left first:pt-0"
            >
              <span class="h-2 w-2 shrink-0 rounded-[2px] bg-violet-400"></span>
              <span class="min-w-0 flex-1">
                <span class="display block text-sm text-ink-100">{o.name}</span>
                <span class="mt-0.5 block text-xs text-ink-400">{o.description}</span>
              </span>
              <span class="shrink-0 text-xs {isBlocked(o) ? 'text-ember-300' : 'text-violet-300'}">
                {isBlocked(o) ? unmetOf(o) : 'Choose'}
              </span>
            </button>
          {/each}
        {:else}
          <p class="flex items-center gap-1.5 text-xs text-ink-400">
            <Icon name="lock" size={13} />
            Reach Lv {r.milestone}
          </p>
        {/if}
      </div>
    </li>
  {/each}
</ul>

{#if !skill.talent.pendingChoice}
  <p class="mt-2 pb-1 text-xs text-ink-400">
    {#if skill.talent.nextMilestone}
      Next talent choice at <span class="gold">Lv {skill.talent.nextMilestone}</span>.
    {:else}
      Every level-10 talent is taken.
    {/if}
  </p>
{/if}

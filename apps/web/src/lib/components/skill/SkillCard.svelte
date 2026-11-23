<script lang="ts">
  import { href } from '#lib/paths'
  import { EFFECT_SHORT, type SkillDTO } from '#lib/skills'
  import { ACCENT, accentStyle } from '#lib/theme'

  interface Live {
    count: number
    rate: string
    gained: number
  }

  let { skill: s, accent, live }: { skill: SkillDTO; accent: string; live?: Live } = $props()

  const pctShort = (v: number) => {
    const n = v * 100
    return `${n < 1 && n > 0 ? n.toFixed(1) : Math.round(n)}%`
  }

  const pending = $derived(s.talent.pendingChoice || s.talent.mastery.pending.length > 0)
  const unlocked = $derived(s.actions.filter((a) => a.unlocked).length)
  const progress = $derived(Math.round(Math.min(1, Math.max(0, s.progress)) * 100))
</script>

<a
  href={href(`/skills/${s.id}`)}
  class="gcard p-3 pt-3.5"
  style={accentStyle(accent)}
  aria-label="{s.name}, level {s.level}"
>
  <div class="flex items-center gap-3.5">
    <span class="medal" aria-hidden="true">
      {s.icon}
      <span class="medal__lvl">{s.level}</span>
    </span>
    <div class="min-w-0 flex-1">
      <div class="display truncate text-[0.98rem] leading-tight text-ink-100">{s.name}</div>
      <div class="mt-0.5 truncate text-xs text-ink-400">
        {unlocked}/{s.actions.length} actions
      </div>
    </div>
  </div>

  <div class="mt-3 flex items-center gap-2">
    <div class="xpbar flex-1" aria-hidden="true"><i style="width: {progress}%"></i></div>
    <span class="w-9 shrink-0 text-right text-xs text-ink-300 tabular-nums">{progress}%</span>
  </div>

  <div class="mt-2.5 flex flex-wrap items-center gap-1.5">
    <span class="chip chip--tight" title={s.effectLabel}>
      +{pctShort(s.effect.value)}
      {EFFECT_SHORT[s.effect.kind]}
    </span>
    {#if live}
      <span
        class="chip chip--tight"
        style={accentStyle(ACCENT.jade)}
        title="{live.count} rig{live.count === 1
          ? ''
          : 's'} running · {live.rate} · {live.gained} made since you opened this page"
      >
        <span class="livedot"></span>
        {live.gained > 0 ? `+${live.gained}` : live.rate}
      </span>
    {:else if pending}
      <span class="chip chip--tight" style={accentStyle(ACCENT.violet)}>★ Talent</span>
    {/if}
  </div>
</a>

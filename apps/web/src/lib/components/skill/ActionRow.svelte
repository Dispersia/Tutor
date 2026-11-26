<script lang="ts">
  import { href } from '#lib/paths'
  import { fmtClock, fmtInterval, rigSecondsLeft } from '#lib/idle'
  import { ACCENT, accentStyle } from '#lib/theme'
  import { EFFECT_LABEL, actionGate, lockedReason, pct } from '#lib/skillview'
  import type { ActionDTO, ItemDTO } from '#lib/skills'

  interface Props {
    a: ActionDTO
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
    a,
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

  const nameOf = (itemId: string) => itemMap.get(itemId)?.name ?? itemId

  const trainable = $derived(a.unlocked && a.affordable)
  const isPrimary = $derived(trainable && a.id === firstTrainableId)
  const made = $derived(a.produces?.[0])
  const gate = $derived(actionGate(a))
  const showGate = $derived(!!gate && !a.description.toLowerCase().includes(gate.toLowerCase()))
  const blocked = $derived(trainable ? '' : lockedReason(a, nameOf))
</script>

<li
  id="action-{a.id}"
  class="panel px-2 py-1.5 transition-colors sm:px-2.5 sm:py-2"
  class:panel-accent={isPrimary}
  class:bg-ink-900={!a.unlocked}
  class:border-seal-400={flash === a.id}
  style={accentStyle(accent)}
>
  <div class="flex items-start gap-2.5">
    <div
      class="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-ink-700 bg-ink-900 text-base"
      aria-hidden="true"
    >
      {#if made}
        {itemMap.get(made.item)?.icon ?? '◆'}
      {:else}
        <span class="display text-sm font-bold text-ink-300">{a.tier}</span>
      {/if}
    </div>
    <div class="min-w-0 flex-1">
      <div class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span class="display text-base font-semibold {a.unlocked ? 'text-ink-100' : 'text-ink-300'}"
          >{a.name}</span
        >
        {#if showGate}
          <span class="text-[11px] text-brass-300">needs {gate}</span>
        {/if}
        {#if blocked && !showGate}
          <span class="text-[11px] text-brass-300">{blocked}</span>
        {/if}
        <span class="display ml-auto shrink-0 text-sm font-bold" style="color: {accent}"
          >Lv {a.level}</span
        >
      </div>
      <div class="bar mt-1 h-1.5"><i style="width: {a.progress * 100}%"></i></div>
      <div
        class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-ink-400 sm:text-xs"
      >
        <span>Tier {a.tier}</span>
        <span class="tabular-nums">+{a.xp} xp a drill</span>
        {#if (a.success ?? 1) < 1}
          <span style="color: {ACCENT.ember}">{Math.round((a.success ?? 1) * 100)}% odds</span>
        {/if}
        {#if a.level >= 100}
          <span>Max level</span>
        {:else}
          <span class="tabular-nums">{a.intoLevel}/{a.forNext} XP to Lv {a.level + 1}</span>
        {/if}
        {#if a.effect.value > 0}
          <span style="color: {accent}">+{pct(a.effect.value)} {EFFECT_LABEL[a.effect.kind]}</span>
        {/if}
        {#if a.description}
          <span class="text-ink-500">· {a.description}</span>
        {/if}
        {#if (a.consumes ?? []).length || (a.produces ?? []).length}
          <span class="flex flex-wrap items-center gap-1">
            {#each a.consumes ?? [] as c (c.item)}
              {@const src = sources[c.item]}
              {@const have = ownedMap.get(c.item) ?? 0}
              {@const short = have < c.count}
              {@const label = itemMap.get(c.item)?.name ?? c.item}
              {#if src}
                <a
                  href={href(`/skills/${src.skillId}#action-${src.actionId}`)}
                  class="chip chip--tight"
                  style={accentStyle(short ? ACCENT.ember : ACCENT.ink)}
                  title="You have {have} {label} · tap to see where it comes from"
                >
                  −{c.count}
                  {itemMap.get(c.item)?.icon ?? ''}
                  {label}
                  <span class="chip__have"><span class="hidden sm:inline">have </span>{have}</span>
                </a>
              {:else}
                <span
                  class="chip chip--tight"
                  style={accentStyle(short ? ACCENT.ember : ACCENT.ink)}
                  title="You have {have} {label}"
                >
                  −{c.count}
                  {itemMap.get(c.item)?.icon ?? ''}
                  {label}
                  <span class="chip__have"><span class="hidden sm:inline">have </span>{have}</span>
                </span>
              {/if}
            {/each}
            {#each a.produces ?? [] as p (p.item)}
              <span class="chip chip--tight" style={accentStyle(ACCENT.jade)}>
                +{p.count}
                {itemMap.get(p.item)?.icon ?? ''}
                {itemMap.get(p.item)?.name ?? p.item}
              </span>
            {/each}
          </span>
        {/if}
        {#if (a.table ?? []).length}
          <span class="flex flex-wrap items-center gap-1">
            <span class="text-ink-500">finds one of:</span>
            {#each a.table ?? [] as e (e.item)}
              <span class="chip chip--tight" style={accentStyle(ACCENT.violet)}>
                {itemMap.get(e.item)?.icon ?? '💎'}
                {itemMap.get(e.item)?.name ?? e.item}
              </span>
            {/each}
          </span>
        {/if}
        {#if (a.choices ?? []).length}
          <span class="flex items-center gap-1">
            <span class="text-ink-500">using</span>
            <select
              class="field px-1 py-0.5 text-[10px]"
              value={a.choice}
              disabled={busy}
              onchange={(e) => onPickChoice(a, (e.currentTarget as HTMLSelectElement).value)}
              aria-label="Choose the input"
            >
              {#each a.choices ?? [] as ch (ch.id)}
                <option value={ch.id}>{ch.label}</option>
              {/each}
            </select>
          </span>
        {/if}
      </div>
      {#if a.idle}
        {@const idleLeft = rigSecondsLeft(a.idle, now)}
        <div
          class="mt-1"
          style={accentStyle(accent)}
          role="group"
          aria-label={a.idle.active
            ? `Rig running: ${fmtInterval(a.idle.intervalSec)} per item, ${fmtClock(idleLeft)} left`
            : 'Rig still'}
        >
          <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-ink-400">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
              width="11"
              height="11"
              class="inline-block shrink-0"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="3" />
              <path
                d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"
              />
            </svg>
            <span class="display tabular-nums" style="color: {accent}"
              >{fmtInterval(a.idle.intervalSec)}</span
            >
            <span class="display text-gold-200 tabular-nums">+{a.idle.xpPerCraft} xp / item</span>
            {#if a.idle.active}
              <span class="display tabular-nums" style="color: {accent}"
                >{fmtClock(idleLeft)} left</span
              >
            {:else}
              <span class="text-ink-400">still</span>
            {/if}
            {#if a.idle.maxed}
              <span class="display" style="color: {ACCENT.jade}" title="Run is at the cap"
                >maxed</span
              >
            {:else}
              <span class="tabular-nums">{Math.round(a.idle.runProgress * 100)}% full</span>
            {/if}
            {#if a.idle.active}
              <button
                type="button"
                class="btn btn-ghost min-h-5 px-1.5 py-0 text-[11px] text-ink-400 hover:text-ember-300"
                disabled={busy}
                onclick={() => onCancelRig(a)}
                title="Stop this rig now and free its slot"
              >
                Stop
              </button>
            {/if}
          </div>
          <div class="bar mt-1 h-1" role="progressbar" aria-label="Rig run filled toward the cap">
            {#if a.idle.active}
              <i style="width: {a.idle.runProgress * 100}%; background: {accent}"></i>
            {/if}
          </div>
        </div>
      {/if}
    </div>
    <button
      onclick={() => onTrain(a)}
      disabled={!trainable}
      title={!trainable ? blocked : undefined}
      aria-label={trainable ? `Train ${a.name}` : `Train ${a.name} — ${blocked}`}
      class="btn {isPrimary ? 'btn-primary' : 'btn-ghost'} min-h-8 shrink-0 px-2.5 py-1 text-xs"
    >
      Train
    </button>
  </div>
</li>

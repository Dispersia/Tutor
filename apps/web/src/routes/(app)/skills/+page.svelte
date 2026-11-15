<script lang="ts">
  import { href } from '#lib/paths'
  import { onMount } from 'svelte'
  import { equipItem, getSkills, type SkillsResponse, unequipSlot } from '#lib/skills'
  import { ACCENT, CATEGORY, accentStyle, tierAccent, type SkillCategory } from '#lib/theme'
  import Icon from '#lib/components/Icon.svelte'
  import Spinner from '#lib/components/Spinner.svelte'

  let data = $state<SkillsResponse | null>(null)
  let error = $state('')
  let note = $state('')
  let loading = $state(true)

  const pct = (v: number) => `${Math.round(v * 100)}%`
  const itemMap = $derived(new Map((data?.items ?? []).map((i) => [i.id, i])))
  const bank = $derived((data?.inventory ?? []).filter((i) => i.count > 0))
  const totalLevel = $derived((data?.skills ?? []).reduce((n, s) => n + s.level, 0))
  const pendingTalents = $derived((data?.skills ?? []).filter((s) => s.talent.pendingChoice))

  const groups = $derived(
    (['gathering', 'artisan', 'support', 'combat'] as SkillCategory[]).map((key) => ({
      key,
      ...CATEGORY[key],
      skills: (data?.skills ?? []).filter((s) => s.category === key),
    })),
  )

  onMount(refresh)

  async function refresh() {
    try {
      data = await getSkills()
    } catch (e) {
      error = (e as Error).message
    } finally {
      loading = false
    }
  }

  async function equip(itemId: string) {
    note = ''
    try {
      await equipItem(itemId)
      await refresh()
    } catch (e) {
      error = (e as Error).message
    }
  }

  async function unequip(slot: string) {
    await unequipSlot(slot).catch(() => {})
    await refresh()
  }
</script>

<div class="flex items-center justify-between border-b border-ink-700 pt-5 pb-4">
  <div>
    <h1 class="display text-3xl text-ink-100">Skills</h1>
    <p class="mt-1 text-xs text-ink-400">Train a trade, gather materials, grow stronger.</p>
  </div>
  <div class="seal h-14 w-14 shrink-0" aria-label="Total level {totalLevel}">
    <span class="text-2xl leading-none font-bold">{totalLevel}</span>
    <span class="text-[8px] tracking-[0.16em]">TOTAL</span>
  </div>
</div>

{#if error}
  <p class="mt-3 rounded-[4px] bg-ember-950 px-3 py-2 text-sm text-ember-300">{error}</p>
{/if}
{#if note}
  <p class="mt-3 rounded-[4px] bg-jade-950 px-3 py-2 text-sm text-jade-300">{note}</p>
{/if}

{#if pendingTalents.length}
  <a
    href={href(`/skills/${pendingTalents[0]!.id}`)}
    class="mt-3 flex items-center gap-2 border-b border-ink-700 pb-3 text-sm"
    style={accentStyle(ACCENT.gold)}
  >
    <span class="h-2 w-2 shrink-0 rounded-[2px]" style="background: var(--accent)"></span>
    A talent is ready for <span class="gold">{pendingTalents.map((s) => s.name).join(', ')}</span>
    <span class="ml-auto text-ink-500">→</span>
  </a>
{/if}

<a
  href={href('/combat')}
  class="mt-3 flex items-center gap-3 border-b border-ink-700 pb-3 text-sm"
  style={accentStyle(CATEGORY.combat.accent)}
>
  <Icon name="skull" size={18} />
  <span class="flex-1 text-ink-100">Combat — fight monsters for bones, hides and gems</span>
  <span class="text-ink-500">→</span>
</a>

{#if loading}
  <p class="mt-4 flex items-center gap-2 text-sm text-ink-400">
    <Spinner size={14} label="Loading skills" /> Loading…
  </p>
{:else}
  {#each groups as g (g.key)}
    {#if g.skills.length}
      <div class="mt-5 mb-2 flex items-center gap-2">
        <span class="h-2.5 w-2.5 rounded-[2px]" style="background: {g.accent}"></span>
        <h2 class="text-xs font-bold tracking-widest uppercase" style="color: {g.accent}">
          {g.label}
        </h2>
        <span class="ml-auto text-[11px] text-ink-500">{g.skills.length}</span>
      </div>
      <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {#each g.skills as s (s.id)}
          <a href={href(`/skills/${s.id}`)} class="tile p-2.5" style={accentStyle(g.accent)}>
            <div class="flex items-center justify-between gap-2">
              <span class="min-w-0 truncate text-[13px] font-medium text-ink-100">{s.name}</span>
              <span class="display shrink-0 text-base font-bold" style="color: {g.accent}"
                >{s.level}</span
              >
            </div>
            <div class="bar mt-2"><i style="width: {s.progress * 100}%"></i></div>
            <div class="mt-1.5 text-[10px] text-ink-400">
              now <span class="font-bold" style="color: {g.accent}">{pct(s.effect.value)}</span>
              {#if s.talent.pendingChoice}
                <span class="ml-1 text-gold-300">· talent</span>
              {:else if s.talent.owned.length}
                <span class="ml-1 text-ink-500">· {s.talent.owned.length}★</span>
              {/if}
            </div>
          </a>
        {/each}
      </div>
    {/if}
  {/each}

  <!-- Equipment -->
  <section class="mt-6" style={accentStyle(ACCENT.gold)}>
    <div class="flex items-center justify-between border-b border-ink-700 pb-2">
      <h2 class="text-xs font-bold tracking-widest uppercase" style="color: var(--accent)">
        Equipment
      </h2>
    </div>
    <div class="pt-3">
      {#if (data?.equipment ?? []).length === 0}
        <p class="text-xs text-ink-400">
          Nothing equipped. Forge a weapon (Smithing) or a bow (Fletching) to train combat.
        </p>
      {/if}
      <div class="flex flex-wrap gap-2">
        {#each data?.equipment ?? [] as e (e.slot)}
          {@const eq = itemMap.get(e.itemId)}
          <button
            onclick={() => unequip(e.slot)}
            class="chip"
            style={accentStyle(tierAccent(eq?.tier))}
          >
            {eq?.icon ?? ''}
            {eq?.name ?? e.itemId}
            <span class="opacity-70">· {e.slot} ✕</span>
          </button>
        {/each}
      </div>
    </div>
  </section>

  <!-- Bank -->
  <section class="mt-5" style={accentStyle(ACCENT.brass)}>
    <div class="flex items-center justify-between border-b border-ink-700 pb-2">
      <h2 class="text-xs font-bold tracking-widest uppercase" style="color: var(--accent)">Bank</h2>
      <span class="text-[11px] text-ink-500">{bank.length} kinds</span>
    </div>
    <div class="pt-3">
      {#if bank.length === 0}
        <p class="text-xs text-ink-400">Empty. Train a gathering profession to gather materials.</p>
      {/if}
      <div class="flex flex-wrap gap-1.5">
        {#each bank as b (b.itemId)}
          {@const it = itemMap.get(b.itemId)}
          <span class="chip" style={accentStyle(tierAccent(it?.tier))}>
            {it?.icon ?? ''}
            {it?.name ?? b.itemId}
            <span class="opacity-70">×{b.count}</span>
            {#if it?.slot}
              <button onclick={() => equip(b.itemId)} class="ml-1 font-semibold underline"
                >equip</button
              >
            {/if}
          </span>
        {/each}
      </div>
    </div>
  </section>

  {#if data}
    <p class="mt-6 mb-6 text-center text-[11px] text-ink-400">
      Bonuses · global XP <span class="gold">+{pct(data.bonuses.globalXp)}</span> · power
      <span class="text-combat-400">+{pct(data.bonuses.damage)}</span> · drop
      <span class="text-support-400">+{pct(data.bonuses.drop)}</span>
    </p>
  {/if}
{/if}

<script lang="ts">
  import { href } from '#lib/paths'
  import { onMount } from 'svelte'
  import { equipItem, getSkills, type SkillsResponse, unequipSlot } from '#lib/skills'
  import { CATEGORY, accentStyle, type SkillCategory } from '#lib/theme'

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

<div class="flex items-center justify-between pt-5 pb-4">
  <div>
    <p class="eyebrow">The guild</p>
    <h1 class="display text-2xl text-gold-200">Professions</h1>
    <p class="text-xs text-ink-400">Train a trade, gather materials, grow stronger.</p>
  </div>
  <div class="text-center">
    <div class="display text-2xl text-gold-200">{totalLevel}</div>
    <div class="eyebrow">total level</div>
  </div>
</div>

{#if error}
  <p class="mb-3 rounded-lg bg-red-950/60 px-3 py-2 text-sm text-red-300">{error}</p>
{/if}
{#if note}
  <p class="mb-3 rounded-lg bg-emerald-950/60 px-3 py-2 text-sm text-emerald-300">{note}</p>
{/if}

{#if pendingTalents.length}
  <a
    href={href(`/skills/${pendingTalents[0]!.id}`)}
    class="panel panel-accent mb-4 block p-3 text-sm"
    style={accentStyle('#e8c264')}
  >
    🎉 A talent is ready to choose for
    <span class="gold">{pendingTalents.map((s) => s.name).join(', ')}</span> — tap to open.
  </a>
{/if}

<a
  href={href('/combat')}
  class="tile mb-5 flex items-center gap-3 p-3 text-sm"
  style={accentStyle(CATEGORY.combat.accent)}
>
  <span class="text-xl">⚔️</span>
  <span class="flex-1">Combat — fight monsters for bones, hides and gems</span>
  <span class="text-ink-400">→</span>
</a>

{#if loading}
  <p class="text-sm text-ink-400">Loading…</p>
{:else}
  {#each groups as g (g.key)}
    {#if g.skills.length}
      <div class="mt-5 mb-2 flex items-center gap-2">
        <span
          class="h-2.5 w-2.5 rounded-full"
          style="background: {g.accent}; box-shadow: 0 0 8px {g.accent}"
        ></span>
        <h2 class="eyebrow">{g.label}</h2>
      </div>
      <div class="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {#each g.skills as s (s.id)}
          <a href={href(`/skills/${s.id}`)} class="tile p-3" style={accentStyle(g.accent)}>
            {#if s.talent.pendingChoice}
              <span
                class="absolute top-2 right-2 z-10 grid h-4 w-4 place-items-center rounded-full bg-gold-400 text-[10px] font-bold text-ink-950 shadow"
                title="Talent to choose">!</span
              >
            {/if}
            <div class="flex items-center gap-2">
              <span class="text-2xl drop-shadow">{s.icon}</span>
              <div class="min-w-0 flex-1">
                <div class="display truncate text-sm text-ink-300">{s.name}</div>
              </div>
              <span class="level-badge text-[11px]">{s.level}</span>
            </div>
            <div class="bar mt-2">
              <i style="width: {s.progress * 100}%"></i>
            </div>
            <div class="mt-1.5 text-[11px] text-ink-400">
              now <span style="color: {g.accent}">{pct(s.effect.value)}</span>
              {#if s.talent.owned.length}
                · {s.talent.owned.length}★
              {/if}
            </div>
          </a>
        {/each}
      </div>
    {/if}
  {/each}

  <!-- Equipment -->
  <section class="panel mt-6 mb-4">
    <div class="panel-hd text-sm">Equipment</div>
    <div class="p-3">
      {#if (data?.equipment ?? []).length === 0}
        <p class="text-xs text-ink-400">
          Nothing equipped. Forge a weapon (Smithing) or a bow (Fletching) to train combat.
        </p>
      {/if}
      <div class="flex flex-wrap gap-2">
        {#each data?.equipment ?? [] as e (e.slot)}
          <button onclick={() => unequip(e.slot)} class="btn btn-ghost px-2 py-1 text-xs">
            {itemMap.get(e.itemId)?.icon ?? ''}
            {itemMap.get(e.itemId)?.name ?? e.itemId}
            <span class="text-ink-400">· {e.slot} ✕</span>
          </button>
        {/each}
      </div>
    </div>
  </section>

  <!-- Bank -->
  <section class="panel mb-6">
    <div class="panel-hd text-sm">
      <span>Bank</span>
      <span class="text-xs text-ink-400">{bank.length} kinds</span>
    </div>
    <div class="p-3">
      {#if bank.length === 0}
        <p class="text-xs text-ink-400">Empty. Train a gathering profession to gather materials.</p>
      {/if}
      <div class="flex flex-wrap gap-1.5">
        {#each bank as b (b.itemId)}
          {@const it = itemMap.get(b.itemId)}
          <span
            class="inline-flex items-center gap-1 rounded-lg border border-ink-700 bg-ink-900/70 px-2 py-1 text-xs"
          >
            {it?.icon ?? ''}
            {it?.name ?? b.itemId}
            <span class="text-ink-400">×{b.count}</span>
            {#if it?.slot}
              <button onclick={() => equip(b.itemId)} class="ml-1 text-emerald-400">equip</button>
            {/if}
          </span>
        {/each}
      </div>
    </div>
  </section>

  {#if data}
    <p class="mb-6 text-center text-[11px] text-ink-400">
      Bonuses · global XP <span class="gold">+{pct(data.bonuses.globalXp)}</span> · power
      <span class="text-combat-400">+{pct(data.bonuses.damage)}</span> · drop
      <span class="text-support-400">+{pct(data.bonuses.drop)}</span>
    </p>
  {/if}
{/if}

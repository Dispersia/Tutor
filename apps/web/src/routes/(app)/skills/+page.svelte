<script lang="ts">
  import { href } from '#lib/paths'
  import { onMount } from 'svelte'
  import { equipItem, getSkills, type SkillsResponse, unequipSlot } from '#lib/skills'

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
    (
      [
        ['gathering', 'Gathering'],
        ['artisan', 'Artisan'],
        ['support', 'Support'],
        ['combat', 'Combat'],
      ] as const
    ).map(([key, label]) => ({
      key,
      label,
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

<div class="flex items-baseline justify-between pt-4 pb-3">
  <div>
    <h1 class="text-lg font-semibold">Professions</h1>
    <p class="text-xs text-neutral-500">Train a trade, earn materials, get stronger.</p>
  </div>
  <span class="text-xs text-neutral-400">total level {totalLevel}</span>
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
    class="mb-4 block rounded-2xl border border-amber-700 bg-amber-950/30 p-3 text-sm text-amber-200"
  >
    🎉 A talent is ready to choose for
    {pendingTalents.map((s) => s.name).join(', ')} — tap to open.
  </a>
{/if}

<a
  href={href('/combat')}
  class="mb-4 block rounded-2xl border border-neutral-800 bg-neutral-900/50 px-4 py-3 text-sm"
>
  ⚔️ Combat — fight monsters for bones, hides and gems →
</a>

{#if loading}
  <p class="text-sm text-neutral-500">Loading…</p>
{:else}
  {#each groups as g (g.key)}
    {#if g.skills.length}
      <h2 class="mt-5 mb-2 text-xs tracking-wide text-neutral-500 uppercase">{g.label}</h2>
      <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {#each g.skills as s (s.id)}
          <a
            href={href(`/skills/${s.id}`)}
            class="relative flex flex-col gap-2 rounded-2xl border p-3 transition-colors hover:bg-neutral-900 {s
              .talent.pendingChoice
              ? 'border-amber-600'
              : 'border-neutral-800'} bg-neutral-900/50"
          >
            {#if s.talent.pendingChoice}
              <span
                class="absolute top-2 right-2 grid h-4 w-4 place-items-center rounded-full bg-amber-500 text-[10px] font-bold text-black"
                title="Talent to choose">!</span
              >
            {/if}
            <div class="flex items-center gap-2">
              <span class="text-2xl">{s.icon}</span>
              <div class="min-w-0">
                <div class="truncate text-sm font-medium">{s.name}</div>
                <div class="text-[11px] text-neutral-500">Lv {s.level}</div>
              </div>
            </div>
            <div class="h-1.5 overflow-hidden rounded-full bg-neutral-800">
              <div
                class="h-full rounded-full bg-emerald-500"
                style="width: {s.progress * 100}%"
              ></div>
            </div>
            <div class="text-[11px] leading-tight text-neutral-500">
              now <span class="text-emerald-300">{pct(s.effect.value)}</span>
              {#if s.talent.owned.length}
                · {s.talent.owned.length} talent{s.talent.owned.length === 1 ? '' : 's'}
              {/if}
            </div>
          </a>
        {/each}
      </div>
    {/if}
  {/each}

  <!-- Equipment -->
  <h2 class="mt-6 mb-2 text-xs tracking-wide text-neutral-500 uppercase">Equipment</h2>
  <div class="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-3">
    {#if (data?.equipment ?? []).length === 0}
      <p class="text-xs text-neutral-500">
        Nothing equipped. Forge a weapon (Smithing) or a bow (Fletching) to train combat.
      </p>
    {/if}
    <div class="flex flex-wrap gap-2">
      {#each data?.equipment ?? [] as e (e.slot)}
        <button
          onclick={() => unequip(e.slot)}
          class="rounded-lg border border-neutral-700 px-2 py-1 text-xs"
        >
          {itemMap.get(e.itemId)?.icon ?? ''}
          {itemMap.get(e.itemId)?.name ?? e.itemId} · {e.slot} ✕
        </button>
      {/each}
    </div>
  </div>

  <!-- Bank -->
  <h2 class="mt-6 mb-2 text-xs tracking-wide text-neutral-500 uppercase">Bank</h2>
  <div class="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-3">
    {#if bank.length === 0}
      <p class="text-xs text-neutral-500">
        Empty. Train a gathering profession to gather materials.
      </p>
    {/if}
    <div class="flex flex-wrap gap-2">
      {#each bank as b (b.itemId)}
        {@const it = itemMap.get(b.itemId)}
        <span class="flex items-center gap-1 rounded-lg bg-neutral-800 px-2 py-1 text-xs">
          {it?.icon ?? ''}
          {it?.name ?? b.itemId}
          <span class="text-neutral-400">×{b.count}</span>
          {#if it?.slot}
            <button onclick={() => equip(b.itemId)} class="ml-1 text-emerald-400">equip</button>
          {/if}
        </span>
      {/each}
    </div>
  </div>

  {#if data}
    <p class="mt-4 text-[11px] text-neutral-600">
      Bonuses · global XP +{pct(data.bonuses.globalXp)} · power +{pct(data.bonuses.damage)} · drop +{pct(
        data.bonuses.drop,
      )}
    </p>
  {/if}
{/if}

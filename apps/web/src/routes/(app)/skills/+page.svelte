<script lang="ts">
  import { onMount } from 'svelte'
  import { goto } from '$app/navigation'
  import {
    chooseTalent,
    equipItem,
    getSkills,
    type ActionDTO,
    type SkillDTO,
    type SkillsResponse,
    unequipSlot,
  } from '#lib/skills'

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

  async function pick(skill: SkillDTO, talentId: string) {
    note = ''
    try {
      await chooseTalent(talentId)
      note = `Talent chosen for ${skill.name}.`
      await refresh()
    } catch (e) {
      error = (e as Error).message
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

  function train(a: ActionDTO) {
    void goto(`/practice?action=${a.id}`)
  }

  function lockedReason(a: ActionDTO): string {
    if (a.missingUnlocks.length) {
      return a.missingUnlocks.map((u) => `${u.skill} ${u.level}`).join(', ')
    }
    if (a.equipMissing) return `equip a ${a.equipMissing.tag} ${a.equipMissing.slot}`
    if (a.missing.length)
      return `need ${a.missing.map((m) => `${m.count}× ${itemMap.get(m.item)?.name ?? m.item}`).join(', ')}`
    return ''
  }
</script>

<div class="flex items-baseline justify-between pt-4 pb-3">
  <h1 class="text-lg font-semibold">Professions</h1>
  <span class="text-xs text-neutral-400">total level {totalLevel}</span>
</div>

{#if error}
  <p class="mb-3 rounded-lg bg-red-950/60 px-3 py-2 text-sm text-red-300">{error}</p>
{/if}
{#if note}
  <p class="mb-3 rounded-lg bg-emerald-950/60 px-3 py-2 text-sm text-emerald-300">{note}</p>
{/if}

{#if pendingTalents.length}
  <div class="mb-4 rounded-2xl border border-amber-700 bg-amber-950/30 p-3 text-sm text-amber-200">
    🎉 You have a talent to choose for
    {pendingTalents.map((s) => s.name).join(', ')} — open the profession below.
  </div>
{/if}

{#if loading}
  <p class="text-sm text-neutral-500">Loading…</p>
{:else}
  {#each groups as g (g.key)}
    {#if g.skills.length}
      <h2 class="mt-4 mb-2 text-xs tracking-wide text-neutral-500 uppercase">{g.label}</h2>
      <div class="space-y-2">
        {#each g.skills as s (s.id)}
          <details
            class="rounded-2xl border {s.talent.pendingChoice
              ? 'border-amber-600'
              : 'border-neutral-800'} bg-neutral-900/50"
          >
            <summary class="flex cursor-pointer items-center gap-3 p-3">
              <span class="text-xl">{s.icon}</span>
              <span class="flex-1">
                <span class="flex items-baseline justify-between">
                  <span class="text-sm font-medium">{s.name}</span>
                  <span class="text-xs text-neutral-400">Lv {s.level}</span>
                </span>
                <span class="mt-1 block h-1.5 overflow-hidden rounded-full bg-neutral-800">
                  <span
                    class="block h-full rounded-full bg-emerald-500"
                    style="width: {s.progress * 100}%"
                  ></span>
                </span>
                <span class="mt-1 block text-[11px] text-neutral-500">
                  {s.effectLabel} · now {pct(s.effect.value)}
                </span>
              </span>
            </summary>

            <div class="space-y-2 border-t border-neutral-800 p-3">
              {#if s.talent.pendingChoice}
                <div class="rounded-xl border border-amber-700 bg-amber-950/20 p-3">
                  <p class="mb-2 text-xs text-amber-200">
                    Level {s.talent.milestone} — choose one talent:
                  </p>
                  <div class="grid gap-2">
                    {#each s.talent.options as o (o.id)}
                      <button
                        onclick={() => pick(s, o.id)}
                        class="rounded-xl border border-amber-700/60 px-3 py-2 text-left text-sm hover:bg-amber-900/20"
                      >
                        <span class="font-medium">{o.name}</span>
                        <span class="block text-xs text-neutral-400">{o.description}</span>
                      </button>
                    {/each}
                  </div>
                </div>
              {/if}

              {#each s.actions as a (a.id)}
                <div class="rounded-xl border border-neutral-800 p-3">
                  <div class="flex items-start justify-between gap-3">
                    <div>
                      <div class="text-sm">{a.name}</div>
                      <div class="text-[11px] text-neutral-500">{a.description}</div>
                      <div class="mt-1 flex flex-wrap gap-1 text-[11px]">
                        {#each a.consumes ?? [] as c (c.item)}
                          <span class="rounded bg-neutral-800 px-1.5 py-0.5">
                            −{c.count}
                            {itemMap.get(c.item)?.icon ?? ''}
                            {itemMap.get(c.item)?.name ?? c.item}
                          </span>
                        {/each}
                        {#each a.produces ?? [] as p (p.item)}
                          <span class="rounded bg-emerald-900/40 px-1.5 py-0.5 text-emerald-200">
                            +{p.count}
                            {itemMap.get(p.item)?.icon ?? ''}
                            {itemMap.get(p.item)?.name ?? p.item}
                          </span>
                        {/each}
                        <span class="rounded bg-sky-900/40 px-1.5 py-0.5 text-sky-200"
                          >+{a.xp} xp</span
                        >
                      </div>
                    </div>
                    <button
                      onclick={() => train(a)}
                      disabled={!a.unlocked || !a.affordable}
                      class="shrink-0 rounded-xl bg-emerald-500 px-3 py-2 text-sm text-black disabled:opacity-40"
                    >
                      Train
                    </button>
                  </div>
                  {#if !a.unlocked || !a.affordable}
                    <p class="mt-1 text-[11px] text-amber-400">
                      {a.unlocked ? 'needs' : 'locked —'}
                      {lockedReason(a)}
                    </p>
                  {/if}
                </div>
              {/each}
            </div>
          </details>
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

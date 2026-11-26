<script lang="ts">
  import { onMount } from 'svelte'
  import type { Stats } from '#lib/exercises'
  import { useSkills } from '#lib/skills/store.svelte'
  import { stopRig, type StopRigResponse } from '#lib/skills'
  import { session } from '#lib/session.svelte'
  import { activeDeckOf, loadActiveDeck } from '#lib/activeDeck.svelte'
  import { ACCENT, accentStyle } from '#lib/theme'
  import { langName } from '#lib/voices'
  import { htmlLang } from '#lib/lang'
  import { cachedResource } from '#lib/resource.svelte'
  import { bankSummary, levelLabelFor, rigRows, xpToGoal, type RigRow } from '#lib/homeview'
  import ActivityPanel from '#lib/components/home/ActivityPanel.svelte'
  import ProgressList from '#lib/components/home/ProgressList.svelte'
  import RigList from '#lib/components/home/RigList.svelte'
  import BankStrip from '#lib/components/home/BankStrip.svelte'
  import ConfirmDialog from '#lib/components/ConfirmDialog.svelte'
  import Spinner from '#lib/components/Spinner.svelte'

  const progress = cachedResource<Stats>('/api/stats', {
    auto: false,
    fallback: 'Could not load your progress.',
  })
  const stats = $derived(progress.data ?? null)
  const board = useSkills()
  const skills = $derived(board.data ?? null)

  let busy = $state(false)
  let rigError = $state('')
  let pendingRig = $state<RigRow | null>(null)

  function cancelRig(r: RigRow) {
    pendingRig = r
  }

  async function confirmStopRig() {
    const r = pendingRig
    if (!r) return
    pendingRig = null
    busy = true
    rigError = ''
    try {
      applyRig(await stopRig(r.actionId))
    } catch (e) {
      rigError = (e as Error).message
    } finally {
      busy = false
    }
  }

  function applyRig(res: StopRigResponse) {
    board.patch({ skills: res.skills, rigs: res.rigs, items: res.items, inventory: res.inventory })
  }

  const lang = $derived(activeDeckOf()?.targetLang ?? 'zh')
  const deckName = $derived(activeDeckOf()?.name)
  const levelLabel = $derived(levelLabelFor(lang, session.user?.level))
  const toGoal = $derived(xpToGoal(stats))
  const days = $derived(stats?.activity?.days ?? [])
  const rigs = $derived(rigRows(skills, board.now))
  const bank = $derived(bankSummary(skills))

  onMount(() => {
    void load()
    void loadActiveDeck()
  })

  async function load() {
    progress.error = ''
    await progress.refresh()
    await board.refresh()
  }
</script>

<header class="border-b border-ink-700 pt-4 pb-4">
  <div class="flex items-start justify-between gap-4">
    <div class="min-w-0">
      <h1 class="display min-w-0 truncate text-3xl text-ink-100">{session.user?.handle}</h1>
      <p class="sub mt-2">
        {langName(lang)} · {levelLabel}{#if deckName}
          · studying <span lang={htmlLang(lang)}>{deckName}</span>{/if}
      </p>
    </div>
    <div class="shrink-0 text-center">
      <div class="seal h-14 w-14" role="img" aria-label="Account level {stats?.level ?? 1}">
        <span class="display text-xl leading-none font-bold">{stats?.level ?? 1}</span>
      </div>
      <p class="seal__label" aria-hidden="true">Account</p>
    </div>
  </div>
</header>

{#if progress.error}
  <div class="banner mt-3" style={accentStyle(ACCENT.brass)} role="alert">
    <p class="banner__text flex-1">Couldn’t load your progress — {progress.error}</p>
    <button type="button" class="btn btn-ghost px-3 py-2 text-xs" onclick={load}>Retry</button>
  </div>
{:else if !stats}
  <p class="banner mt-3 flex items-center gap-2" style={accentStyle(ACCENT.azure)}>
    <Spinner size={16} label="Loading your progress" /> Loading…
  </p>
{:else}
  <div class="lg:grid lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:gap-5">
    <ActivityPanel {days} today={stats?.activity?.today} goal={stats?.dailyGoal} />

    <div class="min-w-0">
      <ProgressList {stats} {toGoal} />

      {#if rigError}
        <p class="banner mt-4" style={accentStyle(ACCENT.ember)} role="alert">{rigError}</p>
      {/if}

      <RigList {rigs} {busy} onCancel={cancelRig} />

      <BankStrip coins={bank.coins} kinds={bank.kinds} worn={bank.worn} />
    </div>
  </div>
{/if}

<ConfirmDialog
  open={pendingRig !== null}
  title="Stop rig"
  message={`Stop the ${pendingRig?.actionName ?? 'this'} rig? Its run ends now and frees a slot.`}
  confirmLabel="Stop rig"
  {busy}
  onConfirm={confirmStopRig}
  onCancel={() => (pendingRig = null)}
/>

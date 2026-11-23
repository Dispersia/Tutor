<script lang="ts">
  import { onMount } from 'svelte'
  import { api } from '#lib/api'
  import { href } from '#lib/paths'
  import type { CurriculumDeck, SrsStats } from '#lib/curriculum'
  import {
    createDeck,
    growDeck,
    importDeck,
    inspectDeck,
    type AnkiInspection,
  } from '#lib/exercises'
  import { useSkills } from '#lib/skills/store.svelte'
  import { session } from '#lib/session.svelte'
  import { activeDeck, loadActiveDeck, setActiveDeck } from '#lib/activeDeck.svelte'
  import { ACCENT } from '#lib/theme'
  import Spinner from '#lib/components/Spinner.svelte'
  import CardEditor from '#lib/components/CardEditor.svelte'
  import DeckSettings from '#lib/components/DeckSettings.svelte'
  import PathDeck from '#lib/components/learn/PathDeck.svelte'
  import DeckBuilder from '#lib/components/learn/DeckBuilder.svelte'
  import ImportPanel from '#lib/components/learn/ImportPanel.svelte'
  import ProfessionPicker from '#lib/components/learn/ProfessionPicker.svelte'
  import { groupedActions, orderDecks, usableActions } from '#lib/learnview'
  import { cachedResource } from '#lib/resource.svelte'

  const path = cachedResource<{ decks: CurriculumDeck[] }>('/api/curriculum', { auto: false })
  const totals = cachedResource<SrsStats>('/api/srs/stats', { auto: false })
  let decks = $state<CurriculumDeck[]>(path.data?.decks ?? [])
  const stats = $derived(totals.data ?? null)
  const board = useSkills()
  const ref = $derived(board.data ?? null)
  let actionId = $state('')
  let loading = $state(path.loading && totals.loading)
  let error = $state('')
  let instruction = $state('')
  let building = $state(false)
  let buildError = $state('')
  let growing = $state('')
  let deckError = $state('')
  let settingsDeck = $state<CurriculumDeck | null>(null)
  let editing = $state<CurriculumDeck | null>(null)
  let importFile = $state<File | null>(null)
  let inspection = $state<AnkiInspection | null>(null)
  let wordField = $state(0)
  let readingField = $state(-1)
  let meaningField = $state(-1)
  let importing = $state(false)
  let importError = $state('')
  let buildLang = $state('')
  let importLang = $state('')

  const storageKey = $derived(`tutor.profession.${session.user?.id ?? 'anon'}`)

  const usable = $derived(usableActions(ref))
  const selected = $derived(usable.find((u) => u.action.id === actionId))

  const groups = $derived(groupedActions(ref))

  onMount(() => {
    void init()
  })

  onMount(() => {
    const timer = setInterval(() => {
      if (decks.some((d) => d.settings?.building)) reload().catch(() => {})
    }, 4000)
    return () => clearInterval(timer)
  })

  async function init() {
    try {
      const [c, , prefs] = await Promise.all([
        path.load(),
        totals.load(),
        api<{ deckInstruction?: string }>('/api/settings').catch(() => null),
        board.refresh(),
      ])
      await applyLoaded(c, prefs?.deckInstruction)
    } catch (e) {
      error = (e as Error).message
    } finally {
      loading = false
    }
  }

  async function applyLoaded(c: { decks: CurriculumDeck[] }, prompt?: string) {
    await loadActiveDeck()
    decks = orderDecks(c.decks, activeDeck.id)
    if (prompt) instruction = prompt
    buildLang = session.user?.targetLang ?? 'zh'
    const saved = localStorage.getItem(storageKey)
    if (saved && usable.some((u) => u.action.id === saved)) actionId = saved
  }

  function chooseProfession(e: Event) {
    actionId = (e.target as HTMLSelectElement).value
    if (actionId) localStorage.setItem(storageKey, actionId)
    else localStorage.removeItem(storageKey)
  }

  function practiceHref(params: { lesson?: string; deck?: string }): string {
    const query = new URLSearchParams()
    if (params.lesson) query.set('lesson', params.lesson)
    if (params.deck) query.set('deck', params.deck)
    if (actionId) query.set('action', actionId)
    return href(`/practice?${query.toString()}`)
  }

  async function reload() {
    const [c] = await Promise.all([path.load(), totals.load()])
    decks = orderDecks(c.decks, activeDeck.id)
    void loadActiveDeck()
  }

  async function build() {
    const text = instruction.trim()
    if (!text || building) return
    building = true
    buildError = ''
    try {
      await createDeck({ instruction: text, targetLang: buildLang || undefined })
      await reload()
    } catch (e) {
      buildError = (e as Error).message
    } finally {
      building = false
    }
  }

  const grow = (d: CurriculumDeck, topic: string) =>
    growWith(d, { topic: topic.trim() || undefined })

  const finish = (d: CurriculumDeck, topic: string) =>
    growWith(d, { all: true, topic: topic.trim() || undefined })

  async function growWith(d: CurriculumDeck, opts: Parameters<typeof growDeck>[1]) {
    if (growing) return false
    growing = d.deckId
    deckError = ''
    try {
      await growDeck(d.deckId, opts)
      await reload()
      return true
    } catch (e) {
      deckError = (e as Error).message
      return false
    } finally {
      growing = ''
    }
  }

  async function inspectApkg(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (!file || importing) return
    importing = true
    importError = ''
    try {
      const info = await readApkg(file)
      importFile = file
      applyInspection(info)
    } catch (err) {
      importError = (err as Error).message
    } finally {
      importing = false
    }
  }

  function readApkg(file: File): Promise<AnkiInspection> {
    const form = new FormData()
    form.set('file', file, file.name)
    return inspectDeck(form)
  }

  function applyInspection(info: AnkiInspection) {
    inspection = info
    wordField = info.suggested.wordField
    readingField = info.suggested.readingField
    meaningField = info.suggested.meaningField
    importLang = info.suggestedLang ?? session.user?.targetLang ?? 'zh'
  }

  async function confirmImport() {
    if (!importFile || !inspection || importing) return
    importing = true
    importError = ''
    try {
      await importDeck(importForm(importFile))
      importFile = null
      inspection = null
      await reload()
    } catch (err) {
      importError = (err as Error).message
    } finally {
      importing = false
    }
  }

  function importForm(file: File): FormData {
    const form = new FormData()
    form.set('file', file, file.name)
    form.set('wordField', String(wordField))
    form.set('readingField', String(readingField))
    form.set('meaningField', String(meaningField))
    if (instruction.trim()) form.set('instruction', instruction.trim())
    if (importLang) form.set('targetLang', importLang)
    return form
  }

  function cancelImport() {
    importFile = null
    inspection = null
    importError = ''
  }
</script>

<div class="border-b border-ink-700 pt-4 pb-4 mb-4">
  <div class="flex items-start justify-between gap-4">
    <div class="min-w-0">
      <h1 class="display min-w-0 text-3xl text-ink-100">Learn</h1>
      <div class="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <p class="sub">One new word at a time — tap next and go.</p>
        {#if stats}
          <span class="text-xs text-ink-500">·</span>
          <span class="text-xs text-ink-400">{stats.learned}/{stats.total} learned</span>
          {#if stats.budget && !stats.budget.newUnlimited}
            <span class="text-xs text-ink-500">·</span>
            <span class="text-xs text-ink-400"
              >{stats.budget.newToday}/{stats.budget.newPerDay} new today</span
            >
          {/if}
        {/if}
      </div>
    </div>
    {#if stats}
      <div class="shrink-0 text-center">
        <div class="seal h-14 w-14" aria-label="Cards due for review">
          <span class="display text-lg leading-none font-bold">{stats.due}</span>
        </div>
        <p class="seal__label" aria-hidden="true">Due</p>
      </div>
    {/if}
  </div>
</div>

{#if error}
  <p class="banner mb-3" style="--accent: {ACCENT.ember}" role="alert">{error}</p>
{/if}

{#if loading}
  <p class="banner flex items-center gap-2" style="--accent: {ACCENT.azure}">
    <Spinner size={14} label="Loading your path" /> Loading…
  </p>
{:else}
  <div class="xl:grid xl:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] xl:items-start xl:gap-24">
    <div>
      <DeckBuilder
        bind:instruction
        bind:buildLang
        {building}
        {buildError}
        {importing}
        {importError}
        onBuild={build}
        onInspect={inspectApkg}
      />

      {#if inspection}
        <ImportPanel
          {inspection}
          bind:importLang
          bind:wordField
          bind:readingField
          bind:meaningField
          {importing}
          onConfirm={confirmImport}
          onCancel={cancelImport}
        />
      {/if}
    </div>

    <div>
      {#if decks.length === 0}
        <p class="empty">No decks yet. Describe one and build it, or import an Anki deck.</p>
      {:else}
        <ProfessionPicker {groups} {selected} {actionId} onChoose={chooseProfession} />

        {#each decks as d (d.deckId)}
          <PathDeck
            {d}
            {actionId}
            activeDeckId={activeDeck.id}
            {growing}
            {practiceHref}
            onSetActive={setActiveDeck}
            onGrow={grow}
            onFinish={finish}
            onSettings={(x) => (settingsDeck = x)}
            onEdit={(x) => (editing = x)}
          />
        {/each}
      {/if}
      {#if deckError}
        <p class="banner mb-3" style="--accent: var(--color-ember-400)" role="alert">{deckError}</p>
      {/if}
    </div>
  </div>
{/if}
{#if editing}
  <CardEditor
    deck={{ id: editing.deckId, name: editing.name, targetLang: editing.targetLang }}
    onclose={() => (editing = null)}
  />
{/if}
{#if settingsDeck}
  <DeckSettings deck={settingsDeck} onclose={() => (settingsDeck = null)} onchanged={reload} />
{/if}
<div class="h-4"></div>

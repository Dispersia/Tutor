<script lang="ts">
  import { onMount } from 'svelte'
  import { api } from '#lib/api'
  import { href } from '#lib/paths'
  import { getCurriculum, getSrsStats, type CurriculumDeck, type SrsStats } from '#lib/curriculum'
  import {
    createDeck,
    growDeck,
    importDeck,
    inspectDeck,
    type AnkiInspection,
  } from '#lib/exercises'
  import { getSkills, type SkillsResponse } from '#lib/skills'
  import { session } from '#lib/session.svelte'
  import { activeDeck, loadActiveDeck, setActiveDeck } from '#lib/activeDeck.svelte'
  import { ACCENT, accentStyle } from '#lib/theme'
  import { autoGrow } from '#lib/grow'
  import Spinner from '#lib/components/Spinner.svelte'
  import CharCell from '#lib/components/CharCell.svelte'
  import CardEditor from '#lib/components/CardEditor.svelte'
  import DeckSettings from '#lib/components/DeckSettings.svelte'

  let decks = $state<CurriculumDeck[]>([])
  let stats = $state<SrsStats | null>(null)
  let ref = $state<SkillsResponse | null>(null)
  let actionId = $state('')
  let loading = $state(true)
  let error = $state('')
  /** Deck builder: the instruction the user types. */
  let instruction = $state('')
  let building = $state(false)
  let buildError = $state('')
  /** Organic growth: which deck is growing, and the optional topic to focus on. */
  let growing = $state('')
  let growTopic = $state('')
  let deckError = $state('')
  /** The deck whose settings (readings, pitch accent, delete) are open. */
  let settingsDeck = $state<CurriculumDeck | null>(null)
  /** The deck whose card metadata is open in the editor. */
  let editing = $state<CurriculumDeck | null>(null)
  /** Anki import: the file, its inspected fields, and the chosen field mapping. */
  let importFile = $state<File | null>(null)
  let inspection = $state<AnkiInspection | null>(null)
  let wordField = $state(0)
  let readingField = $state(-1)
  let meaningField = $state(-1)
  let importing = $state(false)
  let importError = $state('')
  /** Target language for a new deck: built or imported. */
  let buildLang = $state('')
  let importLang = $state('')

  const LANGUAGES = [
    { code: 'zh', label: 'Mandarin Chinese' },
    { code: 'ja', label: 'Japanese' },
    { code: 'ko', label: 'Korean' },
    { code: 'es', label: 'Spanish' },
    { code: 'fr', label: 'French' },
    { code: 'de', label: 'German' },
    { code: 'it', label: 'Italian' },
    { code: 'pt', label: 'Portuguese' },
    { code: 'ru', label: 'Russian' },
  ] as const

  const storageKey = $derived(`tutor.profession.${session.user?.id ?? 'anon'}`)

  /** Actions you can actually train: unlocked and with materials in the bank. */
  const usable = $derived(
    (ref?.skills ?? []).flatMap((skill) =>
      skill.actions
        .filter((action) => action.unlocked && action.affordable)
        .map((action) => ({ skill, action })),
    ),
  )
  const selected = $derived(usable.find((u) => u.action.id === actionId))

  /** Decks still generating their cards in the background. */
  const generating = $derived(decks.filter((d) => d.settings?.building))

  /** The same actions grouped by profession, for the selector. */
  const groups = $derived(
    (ref?.skills ?? [])
      .map((skill) => ({
        skill,
        actions: skill.actions.filter((action) => action.unlocked && action.affordable),
      }))
      .filter((group) => group.actions.length > 0),
  )

  onMount(async () => {
    try {
      const [c, s, sk, prefs] = await Promise.all([
        getCurriculum(),
        getSrsStats(),
        getSkills().catch(() => null),
        api<{ deckInstruction?: string }>('/api/settings').catch(() => null),
      ])
      // the active deck leads; then the frequency path — that is where you start
      await loadActiveDeck()
      decks = orderDecks(c.decks)
      stats = s
      ref = sk
      // the prompt you gave on an earlier deck follows you into every new one
      if (prefs?.deckInstruction) instruction = prefs.deckInstruction
      buildLang = session.user?.targetLang ?? 'zh'
      const saved = localStorage.getItem(storageKey)
      if (saved && usable.some((u) => u.action.id === saved)) actionId = saved
    } catch (e) {
      error = (e as Error).message
    } finally {
      loading = false
    }
  })

  /** While a deck is generating in the background, follow its progress. */
  onMount(() => {
    const timer = setInterval(() => {
      if (decks.some((d) => d.settings?.building)) void reload()
    }, 4000)
    return () => clearInterval(timer)
  })

  function chooseProfession(e: Event) {
    actionId = (e.target as HTMLSelectElement).value
    if (actionId) localStorage.setItem(storageKey, actionId)
    else localStorage.removeItem(storageKey)
  }

  /** A practice URL that carries the selected profession action. */
  function practiceHref(params: { lesson?: string; deck?: string }): string {
    const query = new URLSearchParams()
    if (params.lesson) query.set('lesson', params.lesson)
    if (params.deck) query.set('deck', params.deck)
    if (actionId) query.set('action', actionId)
    return href(`/practice?${query.toString()}`)
  }

  const rank = (level: string | null) => (level === 'zhfreq' ? 0 : level === 'jafreq' ? 1 : 2)

  /** The active deck first; then the frequency path before generated decks. */
  function orderDecks(list: CurriculumDeck[]): CurriculumDeck[] {
    const lead = (d: CurriculumDeck) => (d.deckId === activeDeck.id ? 0 : 1)
    return list.sort((a, b) => lead(a) - lead(b) || rank(a.level) - rank(b.level))
  }

  const deckAccent = (level: string | null) =>
    level === 'zhfreq' ? ACCENT.green : level === 'jafreq' ? ACCENT.level : ACCENT.arcane

  /** The next step of the path: the first lesson not yet finished. */
  const nextLesson = (d: CurriculumDeck) =>
    d.lessons.find((l) => !l.complete) ?? d.lessons[d.lessons.length - 1]

  const done = (d: CurriculumDeck) => d.cardCount > 0 && d.learned >= d.cardCount

  async function reload() {
    const [c, s] = await Promise.all([getCurriculum(), getSrsStats()])
    decks = orderDecks(c.decks)
    stats = s
    // A deck that was just built should reach the profile menu's picker too.
    void loadActiveDeck()
  }

  /** Build a deck from the instruction (the server pulls a frequency list). */
  async function build() {
    const text = instruction.trim()
    if (!text || building) return
    building = true
    buildError = ''
    try {
      await createDeck({ instruction: text, targetLang: buildLang || undefined })
      // keep the prompt in the box: it is the deck's constitution, reused below
      await reload()
    } catch (e) {
      buildError = (e as Error).message
    } finally {
      building = false
    }
  }

  /** Grow a deck organically, optionally focusing on a topic. */
  async function grow(d: CurriculumDeck) {
    if (growing) return
    growing = d.deckId
    deckError = ''
    try {
      await growDeck(d.deckId, { topic: growTopic.trim() || undefined })
      growTopic = ''
      await reload()
    } catch (e) {
      deckError = (e as Error).message
    } finally {
      growing = ''
    }
  }

  /** Finish a partly-built deck (an interrupted import) in the background. */
  async function finish(d: CurriculumDeck) {
    if (growing) return
    growing = d.deckId
    deckError = ''
    try {
      await growDeck(d.deckId, { all: true, topic: growTopic.trim() || undefined })
      growTopic = ''
      await reload()
    } catch (e) {
      deckError = (e as Error).message
    } finally {
      growing = ''
    }
  }

  /** Step 1: read the .apkg's fields so the learner can pick the real word. */
  async function inspectApkg(e: Event) {
    const input = e.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file || importing) return
    importing = true
    importError = ''
    try {
      const form = new FormData()
      form.set('file', file, file.name)
      const info = await inspectDeck(form)
      importFile = file
      inspection = info
      wordField = info.suggested.wordField
      readingField = info.suggested.readingField
      meaningField = info.suggested.meaningField
      // the deck's own script wins over the profile's target language
      importLang = info.suggestedLang ?? session.user?.targetLang ?? 'zh'
    } catch (err) {
      importError = (err as Error).message
    } finally {
      importing = false
    }
  }

  /** Step 2: build the deck from the chosen fields. */
  async function confirmImport() {
    if (!importFile || !inspection || importing) return
    importing = true
    importError = ''
    try {
      const form = new FormData()
      form.set('file', importFile, importFile.name)
      form.set('wordField', String(wordField))
      form.set('readingField', String(readingField))
      form.set('meaningField', String(meaningField))
      if (instruction.trim()) form.set('instruction', instruction.trim())
      if (importLang) form.set('targetLang', importLang)
      await importDeck(form)
      importFile = null
      inspection = null
      await reload()
    } catch (err) {
      importError = (err as Error).message
    } finally {
      importing = false
    }
  }

  function cancelImport() {
    importFile = null
    inspection = null
    importError = ''
  }

  /** A preview cell: the cleaned value of a field, trimmed for display. */
  const cell = (value: string | undefined) => (value ?? '').slice(0, 40) || '—'

  const langLabel = (code: string) => LANGUAGES.find((l) => l.code === code)?.label ?? code
</script>

<div class="border-b border-ink-700 pt-4 pb-4 mb-4">
  <div class="flex items-start justify-between gap-4">
    <h1 class="display min-w-0 text-3xl text-ink-100">Learn</h1>
    {#if stats}
      <div class="shrink-0 text-center">
        <div class="seal h-14 w-14" aria-label="Cards due for review">
          <span class="display text-lg leading-none font-bold">{stats.due}</span>
        </div>
        <p class="seal__label" aria-hidden="true">Due</p>
      </div>
    {/if}
  </div>
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

{#if error}
  <p class="banner mb-3" style="--accent: {ACCENT.ember}" role="alert">{error}</p>
{/if}

{#if loading}
  <p class="banner flex items-center gap-2" style="--accent: {ACCENT.azure}">
    <Spinner size={14} label="Loading your path" /> Loading…
  </p>
{:else}
  <!-- Desktop: the composer sits in a left rail, the path fills the page. -->
  <div class="xl:grid xl:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] xl:items-start xl:gap-24">
    <div>
      <section class="panel panel-accent mb-4 p-4" style="--accent: {ACCENT.azure}">
        <p class="eyebrow">Build a deck</p>
        <p class="mt-1 text-xs text-ink-400">
          Describe what you want. It pulls a real frequency list and writes the cards — one new word
          at a time.
        </p>
        <label class="mt-2 block text-xs text-ink-400">
          Language
          <select bind:value={buildLang} class="field mt-1">
            {#each LANGUAGES as l (l.code)}<option value={l.code}>{l.label}</option>{/each}
          </select>
        </label>
        <label class="mt-2 block text-xs text-ink-400">
          What to learn
          <textarea
            bind:value={instruction}
            use:autoGrow={160}
            rows="2"
            placeholder="a traditional Chinese frequency list, with grammar, using only traditional characters and zhuyin"
            class="field mt-1 resize-none"
          ></textarea>
        </label>
        <button
          type="button"
          onclick={build}
          disabled={building || !instruction.trim()}
          class="btn btn-primary mt-2 w-full py-3"
        >
          {#if building}<Spinner size={15} label="Building the deck" /> Pulling the list &amp; writing
            cards…{:else}Build deck{/if}
        </button>
        {#if buildError}
          <p class="banner mt-2" style="--accent: {ACCENT.ember}" role="alert">{buildError}</p>
        {/if}
        <label class="link link-btn mt-3 w-full justify-center text-xs">
          {#if importing}<Spinner size={12} label="Reading the deck" /> Reading the deck…{:else}…or
            import an Anki deck (.apkg){/if}
          <input
            type="file"
            accept=".apkg,.colpkg"
            class="hidden"
            onchange={inspectApkg}
            disabled={importing}
          />
        </label>
        {#if importError}
          <p class="banner mt-2" style="--accent: {ACCENT.ember}" role="alert">{importError}</p>
        {/if}
      </section>

      {#if inspection}
        <section class="panel panel-accent mb-4 p-4" style="--accent: {ACCENT.violet}">
          <div class="flex items-baseline justify-between">
            <p class="eyebrow">Import {inspection.name ?? 'Anki deck'}</p>
            <span class="text-xs text-ink-400">{inspection.noteCount} notes</span>
          </div>
          <p class="mt-1 text-xs text-ink-400">
            Pick the deck's language and which field is the real word. The whole deck is imported —
            the AI weaves sentence and grammar cards through its words and fills it in the
            background.
          </p>

          <label class="mt-3 block text-xs text-ink-400">
            Language
            <select bind:value={importLang} class="field mt-1">
              {#if importLang && !LANGUAGES.some((l) => l.code === importLang)}
                <option value={importLang}>{importLang}</option>
              {/if}
              {#each LANGUAGES as l (l.code)}<option value={l.code}>{l.label}</option>{/each}
            </select>
          </label>
          {#if inspection.suggestedLang}
            <p class="mt-1 text-xs text-jade-400">
              Detected {langLabel(inspection.suggestedLang)} from the deck.
            </p>
          {/if}

          <label class="mt-3 block text-xs text-ink-400">
            Word field
            <select bind:value={wordField} class="field mt-1">
              {#each inspection.fields as f, i (i)}<option value={i}>{f}</option>{/each}
            </select>
          </label>

          <div class="mt-2 grid grid-cols-2 gap-2">
            <label class="block text-xs text-ink-400">
              Reading (optional)
              <select bind:value={readingField} class="field mt-1">
                <option value={-1}>None</option>
                {#each inspection.fields as f, i (i)}<option value={i}>{f}</option>{/each}
              </select>
            </label>
            <label class="block text-xs text-ink-400">
              Meaning (optional)
              <select bind:value={meaningField} class="field mt-1">
                <option value={-1}>None</option>
                {#each inspection.fields as f, i (i)}<option value={i}>{f}</option>{/each}
              </select>
            </label>
          </div>

          <div class="mt-3 overflow-x-auto">
            <table class="w-full text-left text-xs text-ink-400">
              <thead>
                <tr
                  >{#each inspection.fields as f (f)}<th class="pr-2 font-normal">{f}</th
                    >{/each}</tr
                >
              </thead>
              <tbody>
                {#each inspection.sample.slice(0, 3) as row, r (r)}
                  <tr>
                    {#each row as value, i (i)}<td class="pr-2 text-ink-300">{cell(value)}</td
                      >{/each}
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>

          <div class="mt-3 flex gap-2">
            <button
              type="button"
              onclick={confirmImport}
              disabled={importing}
              class="btn btn-primary flex-1 py-3"
            >
              {#if importing}<Spinner size={15} label="Building the deck" /> Building…{:else}Build
                deck
              {/if}
            </button>
            <button
              type="button"
              onclick={cancelImport}
              disabled={importing}
              class="btn btn-ghost px-4"
            >
              Cancel
            </button>
          </div>
        </section>
      {/if}
    </div>

    <div>
      {#if decks.length === 0}
        <p class="text-sm text-ink-400">No decks yet — describe one above and build it.</p>
      {:else}
        <section class="panel mb-4 p-4" style="--accent: {ACCENT.arcane}">
          <div class="flex items-baseline justify-between">
            <p class="eyebrow">Profession</p>
            {#if selected}
              <span class="chip" style="--accent: {ACCENT.arcane}">
                {selected.skill.icon}
                {selected.skill.name}
              </span>
            {/if}
          </div>
          {#if groups.length === 0}
            <p class="mt-2 text-sm text-ink-400">
              No profession is ready to train.
              <a href={href('/skills')} class="link">Unlock one in Skills</a>.
            </p>
          {:else}
            <select value={actionId} onchange={chooseProfession} class="field mt-2">
              <option value="">Choose a profession…</option>
              {#each groups as group (group.skill.id)}
                <optgroup label="{group.skill.icon} {group.skill.name}">
                  {#each group.actions as action (action.id)}
                    <option value={action.id}>{action.name}</option>
                  {/each}
                </optgroup>
              {/each}
            </select>
            {#if selected}
              <p class="mt-2 text-xs text-ink-400">{selected.action.description}</p>
            {:else}
              <p class="mt-2 text-xs text-brass-300">
                Pick a profession first — lessons train that profession.
              </p>
            {/if}
          {/if}
        </section>

        {#each decks as d (d.deckId)}
          {@const acc = deckAccent(d.level ?? '')}
          {@const next = nextLesson(d)}
          {@const progress = d.cardCount > 0 ? (d.learned / d.cardCount) * 100 : 0}
          <section class="panel panel-accent mb-5 p-4" style={accentStyle(acc)}>
            <div class="flex items-baseline justify-between gap-3">
              <h2 class="display min-w-0 truncate text-lg" style="color: {acc}">{d.name}</h2>
              <div class="flex shrink-0 items-center gap-2">
                {#if d.deckId === activeDeck.id}
                  <span class="chip" style="--accent: {ACCENT.jade}">Studying</span>
                {/if}
                <span class="text-xs text-ink-400">{d.learned}/{d.cardCount} learned</span>
              </div>
            </div>
            <div class="bar mt-2">
              <i style="width: {progress}%"></i>
            </div>

            {#if d.settings?.building}
              {@const built = d.settings.cursor ?? 0}
              {@const total = d.settings.buildTotal ?? 0}
              <div class="mt-2">
                <div class="flex items-baseline justify-between text-xs text-ink-400">
                  <span class="flex items-center gap-1.5">
                    <Spinner size={12} label="Generating cards" /> Generating cards…
                  </span>
                  <span>{built}{total > 0 ? ` / ${total}` : ''} words</span>
                </div>
                <div class="bar mt-1">
                  <i style="width: {total > 0 ? (built / total) * 100 : 0}%"></i>
                </div>
              </div>
            {:else if d.settings?.buildError}
              <p class="banner mt-2" style="--accent: {ACCENT.ember}" role="alert">
                Generation stopped: {d.settings.buildError}
              </p>
            {/if}

            {#if d.settings?.instruction}
              <p class="mt-2 line-clamp-2 text-xs text-ink-400" title={d.settings.instruction}>
                Prompt · {d.settings.instruction}
              </p>
            {/if}

            {#if next}
              {#if next.newWord}
                <div class="mt-3 flex justify-center">
                  <CharCell
                    word={next.newWord}
                    reading={next.reading && next.reading !== next.newWord ? next.reading : ''}
                    lang={d.targetLang}
                    size="sm"
                    wordish={next.newWord.length > 1}
                    accent={acc}
                  />
                </div>
              {/if}
              {#if actionId}
                <a
                  href={practiceHref({ lesson: next.id })}
                  onclick={() => void setActiveDeck(d.deckId)}
                  class="btn btn-primary mt-3 w-full py-3"
                >
                  {d.learned > 0 ? 'Next' : 'Start'} · {next.newWord ?? next.title}
                </a>
              {:else}
                <button disabled class="btn btn-ghost mt-3 w-full py-3">
                  Select a profession to start
                </button>
              {/if}
              {#if next.newWord}
                <p class="mt-1.5 text-center text-xs text-ink-400">new word · {next.description}</p>
              {:else if next.description}
                <p class="mt-1.5 text-center text-xs text-ink-400">{next.description}</p>
              {/if}
              {#if next.cards > 1}
                <p class="mt-1.5 text-center text-xs text-ink-400">
                  {next.learned}/{next.cards} in this lesson
                </p>
              {/if}
            {:else}
              <p class="mt-3 text-center text-sm text-ink-400">Course complete</p>
            {/if}

            {#if d.due > 0}
              {#if actionId}
                <a
                  href={practiceHref({ deck: d.deckId })}
                  onclick={() => void setActiveDeck(d.deckId)}
                  class="btn btn-ghost mt-2 w-full"
                >
                  Review {d.due} due
                </a>
              {:else}
                <button disabled class="btn btn-ghost mt-2 w-full">
                  Select a profession to review
                </button>
              {/if}
            {/if}

            {#if done(d)}
              <p class="mt-2 text-center text-xs text-jade-400">All words learned ✓</p>
            {/if}

            {#if !d.settings?.building && (d.remaining ?? 0) > 0}
              <button
                type="button"
                onclick={() => finish(d)}
                disabled={Boolean(growing)}
                class="btn btn-ghost mt-3 w-full py-3"
              >
                {#if growing === d.deckId}
                  <Spinner size={13} label="Finishing the deck" /> Finishing…
                {:else}
                  Finish importing · {d.remaining} left
                {/if}
              </button>
            {/if}

            <div class="mt-3 flex items-center gap-2">
              <input
                bind:value={growTopic}
                placeholder="grow on a topic (optional)"
                class="field min-w-0 flex-1 text-xs"
              />
              <button
                type="button"
                onclick={() => grow(d)}
                disabled={Boolean(growing) || Boolean(d.settings?.building)}
                class="btn btn-ghost px-3 py-2 text-xs"
              >
                {#if growing === d.deckId}<Spinner size={13} label="Growing the deck" /> Growing…{:else}Grow
                {/if}
              </button>
            </div>
            <div class="mt-3 flex items-center justify-center gap-4">
              <button
                type="button"
                onclick={() => (settingsDeck = d)}
                class="link link-btn text-xs"
              >
                Deck settings
              </button>
              <button type="button" onclick={() => (editing = d)} class="link link-btn text-xs">
                Card metadata
              </button>
            </div>
          </section>
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

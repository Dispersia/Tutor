<script lang="ts">
  import { onMount } from 'svelte'
  import { api } from '#lib/api'
  import { href } from '#lib/paths'
  import { getCurriculum, getSrsStats, type CurriculumDeck, type SrsStats } from '#lib/curriculum'
  import {
    createDeck,
    deleteDeck,
    growDeck,
    importDeck,
    inspectDeck,
    updateDeck,
    type AnkiInspection,
  } from '#lib/exercises'
  import { getSkills, type SkillsResponse } from '#lib/skills'
  import { session } from '#lib/session.svelte'
  import { ACCENT, accentStyle } from '#lib/theme'
  import Spinner from '#lib/components/Spinner.svelte'
  import CardEditor from '#lib/components/CardEditor.svelte'

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
  /** Which deck is being deleted (shows a spinner and blocks double taps). */
  let deleting = $state('')
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
      // the frequency path first — that is where you start
      decks = c.decks.sort((a, b) => rank(a.level) - rank(b.level))
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

  const deckAccent = (level: string | null) =>
    level === 'zhfreq' ? ACCENT.green : level === 'jafreq' ? ACCENT.level : ACCENT.arcane

  /** The next step of the path: the first lesson not yet finished. */
  const nextLesson = (d: CurriculumDeck) =>
    d.lessons.find((l) => !l.complete) ?? d.lessons[d.lessons.length - 1]

  const done = (d: CurriculumDeck) => d.cardCount > 0 && d.learned >= d.cardCount

  /** Whether a deck shows native readings (its own override, else the default). */
  const showsReadings = (d: CurriculumDeck) => d.settings?.showReadings ?? true

  async function reload() {
    const [c, s] = await Promise.all([getCurriculum(), getSrsStats()])
    decks = c.decks.sort((a, b) => rank(a.level) - rank(b.level))
    stats = s
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

  /** Delete a deck and all of its cards, SRS state, history and deck chats. */
  async function removeDeck(d: CurriculumDeck) {
    if (deleting) return
    const ok = confirm(
      `Delete “${d.name}” and all its cards, reviews and history? This cannot be undone.`,
    )
    if (!ok) return
    deleting = d.deckId
    deckError = ''
    try {
      await deleteDeck(d.deckId)
      await reload()
    } catch (e) {
      deckError = (e as Error).message
    } finally {
      deleting = ''
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

  /** Flip a deck's own reading (ruby) rule. */
  async function toggleReadings(d: CurriculumDeck) {
    deckError = ''
    try {
      await updateDeck(d.deckId, { settings: { showReadings: !showsReadings(d) } })
      await reload()
    } catch (e) {
      deckError = (e as Error).message
    }
  }
</script>

<div class="flex items-center justify-between border-b border-ink-700 pt-5 pb-4">
  <div>
    <h1 class="display text-3xl text-ink-100">Learn</h1>
    <p class="mt-1 text-xs text-ink-400">One new word at a time — tap next and go.</p>
  </div>
  {#if stats}
    <div class="text-right">
      <div class="display text-2xl {stats.due > 0 ? 'text-brass-300' : 'text-ink-100'}">
        {stats.due}
      </div>
      <div class="eyebrow">due · {stats.learned}/{stats.total} learned</div>
    </div>
  {/if}
</div>

{#if error}
  <p class="mb-3 rounded-md bg-ember-950 px-3 py-2 text-sm text-ember-300">{error}</p>
{/if}

{#if loading}
  <p class="flex items-center gap-2 text-sm text-ink-400">
    <Spinner size={14} label="Loading your path" /> Loading…
  </p>
{:else}
  <section class="panel panel-accent mb-4 p-4" style="--accent: {ACCENT.azure}">
    <p class="eyebrow">Build a deck</p>
    <p class="mt-1 text-xs text-ink-400">
      Describe what you want. It pulls a real frequency list and writes the cards — one new word at a
      time.
    </p>
    <label class="mt-2 block text-[11px] text-ink-400">
      Language
      <select
        bind:value={buildLang}
        class="mt-1 w-full rounded-md border border-ink-700 bg-ink-900 px-3 py-2 text-sm"
      >
        {#each LANGUAGES as l (l.code)}<option value={l.code}>{l.label}</option>{/each}
      </select>
    </label>
    <textarea
      bind:value={instruction}
      rows="2"
      placeholder="a traditional Chinese frequency list, with grammar, using only traditional characters and zhuyin"
      class="mt-2 w-full rounded-md border border-ink-700 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-seal-400"
    ></textarea>
    <button
      type="button"
      onclick={build}
      disabled={building || !instruction.trim()}
      class="btn btn-primary mt-2 w-full py-3 disabled:opacity-60"
    >
      {#if building}<Spinner size={15} label="Building the deck" /> Pulling the list &amp; writing
        cards…{:else}Build deck{/if}
    </button>
    {#if buildError}
      <p class="mt-2 rounded-md bg-ember-950 px-3 py-2 text-xs text-ember-300">{buildError}</p>
    {/if}
    <label class="mt-3 block cursor-pointer text-center text-[11px] text-ink-400 underline">
      {#if importing}<Spinner size={12} label="Reading the deck" /> Reading the deck…{:else}…or import
        an Anki deck (.apkg){/if}
      <input
        type="file"
        accept=".apkg,.colpkg"
        class="hidden"
        onchange={inspectApkg}
        disabled={importing}
      />
    </label>
    {#if importError}
      <p class="mt-2 rounded-md bg-ember-950 px-3 py-2 text-xs text-ember-300">{importError}</p>
    {/if}
  </section>

  {#if inspection}
    <section class="panel panel-accent mb-4 p-4" style="--accent: {ACCENT.violet}">
      <div class="flex items-baseline justify-between">
        <p class="eyebrow">Import {inspection.name ?? 'Anki deck'}</p>
        <span class="text-[11px] text-ink-400">{inspection.noteCount} notes</span>
      </div>
      <p class="mt-1 text-xs text-ink-400">
        Pick the deck's language and which field is the real word. The prompt above is applied to this
        deck too.
      </p>

      <label class="mt-3 block text-[11px] text-ink-400">
        Language
        <select
          bind:value={importLang}
          class="mt-1 w-full rounded-md border border-ink-700 bg-ink-900 px-3 py-2 text-sm"
        >
          {#if importLang && !LANGUAGES.some((l) => l.code === importLang)}
            <option value={importLang}>{importLang}</option>
          {/if}
          {#each LANGUAGES as l (l.code)}<option value={l.code}>{l.label}</option>{/each}
        </select>
      </label>
      {#if inspection.suggestedLang}
        <p class="mt-1 text-[11px] text-jade-400">
          Detected {langLabel(inspection.suggestedLang)} from the deck.
        </p>
      {/if}

      <label class="mt-3 block text-[11px] text-ink-400">
        Word field
        <select
          bind:value={wordField}
          class="mt-1 w-full rounded-md border border-ink-700 bg-ink-900 px-3 py-2 text-sm"
        >
          {#each inspection.fields as f, i (i)}<option value={i}>{f}</option>{/each}
        </select>
      </label>

      <div class="mt-2 grid grid-cols-2 gap-2">
        <label class="block text-[11px] text-ink-400">
          Reading (optional)
          <select
            bind:value={readingField}
            class="mt-1 w-full rounded-md border border-ink-700 bg-ink-900 px-3 py-2 text-sm"
          >
            <option value={-1}>None</option>
            {#each inspection.fields as f, i (i)}<option value={i}>{f}</option>{/each}
          </select>
        </label>
        <label class="block text-[11px] text-ink-400">
          Meaning (optional)
          <select
            bind:value={meaningField}
            class="mt-1 w-full rounded-md border border-ink-700 bg-ink-900 px-3 py-2 text-sm"
          >
            <option value={-1}>None</option>
            {#each inspection.fields as f, i (i)}<option value={i}>{f}</option>{/each}
          </select>
        </label>
      </div>

      <div class="mt-3 overflow-x-auto">
        <table class="w-full text-left text-[11px] text-ink-400">
          <thead>
            <tr>{#each inspection.fields as f (f)}<th class="pr-2 font-normal">{f}</th>{/each}</tr>
          </thead>
          <tbody>
            {#each inspection.sample.slice(0, 3) as row, r (r)}
              <tr>
                {#each row as value, i (i)}<td class="pr-2 text-ink-300">{cell(value)}</td>{/each}
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
          class="btn btn-primary flex-1 py-3 disabled:opacity-60"
        >
          {#if importing}<Spinner size={15} label="Building the deck" /> Building…{:else}Build deck
          {/if}
        </button>
        <button type="button" onclick={cancelImport} disabled={importing} class="btn btn-ghost px-4">
          Cancel
        </button>
      </div>
    </section>
  {/if}

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
        <a href={href('/skills')} class="gold">Unlock one in Skills</a>.
      </p>
    {:else}
      <select
        value={actionId}
        onchange={chooseProfession}
        class="mt-2 w-full rounded-md border border-ink-700 bg-ink-900 px-3 py-2 text-sm"
      >
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
      <div class="flex items-baseline justify-between">
        <h2 class="display text-lg" style="color: {acc}">{d.name}</h2>
        <span class="text-xs text-ink-400">{d.learned}/{d.cardCount} learned</span>
      </div>
      <div class="bar mt-2">
        <i style="width: {progress}%"></i>
      </div>

      {#if d.settings?.instruction}
        <p class="mt-2 line-clamp-2 text-[11px] text-ink-500" title={d.settings.instruction}>
          Prompt · {d.settings.instruction}
        </p>
      {/if}

      {#if next}
        {#if actionId}
          <a href={practiceHref({ lesson: next.id })} class="btn btn-primary mt-3 w-full py-3">
            {d.learned > 0 ? 'Next' : 'Start'} · {next.newWord ?? next.title}
            {#if next.reading && next.reading !== next.newWord}
              <span class="ml-1 text-xs opacity-75">{next.reading}</span>
            {/if}
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
          <p class="mt-1.5 text-center text-[11px] text-ink-500">
            {next.learned}/{next.cards} in this lesson
          </p>
        {/if}
      {:else}
        <p class="mt-3 text-center text-sm text-ink-400">Course complete</p>
      {/if}

      {#if d.due > 0}
        {#if actionId}
          <a href={practiceHref({ deck: d.deckId })} class="btn btn-ghost mt-2 w-full">
            Review {d.due} due
          </a>
        {:else}
          <button disabled class="btn btn-ghost mt-2 w-full">
            Select a profession to review
          </button>
        {/if}
      {/if}

      {#if done(d)}
        <p class="mt-2 text-center text-[11px] text-jade-400">All words learned ✓</p>
      {/if}

      <div class="mt-3 flex items-center gap-2">
        <input
          bind:value={growTopic}
          placeholder="grow on a topic (optional)"
          class="min-w-0 flex-1 rounded-md border border-ink-700 bg-ink-900 px-3 py-2 text-xs outline-none focus:border-seal-400"
        />
        <button
          type="button"
          onclick={() => grow(d)}
          disabled={Boolean(growing)}
          class="btn btn-ghost px-3 py-2 text-xs disabled:opacity-60"
        >
          {#if growing === d.deckId}<Spinner size={13} label="Growing the deck" /> Growing…{:else}Grow
          {/if}
        </button>
      </div>
      <button
        type="button"
        onclick={() => toggleReadings(d)}
        class="mt-2 w-full text-center text-[11px] text-ink-400 underline"
      >
        {showsReadings(d)
          ? 'Hide readings (ruby) for this deck'
          : 'Show readings (ruby) for this deck'}
      </button>
      <button
        type="button"
        onclick={() => (editing = d)}
        class="mt-2 w-full text-center text-[11px] text-ink-400 underline"
      >
        Edit card metadata (pitch accent, notes)
      </button>
      <button
        type="button"
        onclick={() => removeDeck(d)}
        disabled={Boolean(deleting)}
        class="mt-2 w-full text-center text-[11px] text-ember-400 underline disabled:opacity-60"
      >
        {#if deleting === d.deckId}Deleting…{:else}Delete this deck{/if}
      </button>
    </section>
  {/each}
  {/if}
  {#if deckError}
    <p class="mb-3 rounded-md bg-ember-950 px-3 py-2 text-sm text-ember-300">{deckError}</p>
  {/if}
{/if}
{#if editing}
  <CardEditor
    deck={{ id: editing.deckId, name: editing.name, targetLang: editing.targetLang }}
    onclose={() => (editing = null)}
  />
{/if}
<div class="h-4"></div>

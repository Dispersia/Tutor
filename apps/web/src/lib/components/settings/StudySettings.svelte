<script lang="ts">
  import { accentStyle, ACCENT } from '#lib/theme'
  import { MODALITY_LABEL, drillGroupsOf } from '#lib/settingsview'
  import type { ExerciseInfo, StudyPrefs } from '#lib/types'

  interface Props {
    study: StudyPrefs
    stepsText: string
    exercises: ExerciseInfo[]
    onsave: () => void
  }

  let { study = $bindable(), stepsText = $bindable(), exercises, onsave }: Props = $props()

  const drillGroups = $derived(drillGroupsOf(exercises))
  const isDisabled = (id: string) => study.disabledExercises.includes(id)

  function setExercise(id: string, enabled: boolean) {
    const next = new Set(study.disabledExercises)
    if (enabled) next.delete(id)
    else next.add(id)
    study = { ...study, disabledExercises: [...next] }
  }

  function setGroup(modality: string, enabled: boolean) {
    const ids =
      drillGroups
        .find((g) => g.modality === modality)
        ?.items.filter((i) => !i.disabled)
        .map((i) => i.id) ?? []
    const next = new Set(study.disabledExercises)
    for (const id of ids) {
      if (enabled) next.delete(id)
      else next.add(id)
    }
    study = { ...study, disabledExercises: [...next] }
  }
</script>

<section class="mb-5 panel panel-accent p-4" style={accentStyle(ACCENT.brass)}>
  <h2 class="display text-sm text-ink-100">Study</h2>
  <p class="mt-1 text-xs text-ink-400">
    Shape how decks are drilled. These apply to your account across every deck.
  </p>

  <div class="mt-3 space-y-2">
    <label class="flex min-h-11 items-center justify-between gap-3 py-1">
      <span class="text-sm">Show Zhuyin under Chinese</span>
      <input type="checkbox" bind:checked={study.showZhuyin} class="h-4 w-4 accent-seal-400" />
    </label>
    <label class="flex min-h-11 items-center justify-between gap-3 py-1">
      <span class="text-sm">Show furigana over Japanese kanji</span>
      <input type="checkbox" bind:checked={study.showFurigana} class="h-4 w-4 accent-seal-400" />
    </label>
  </div>

  <p class="mt-4 text-xs text-ink-400">Daily budget — how much you do before the goal is met.</p>
  <div class="mt-2 grid grid-cols-2 gap-3">
    <label class="block text-xs text-ink-400">
      New cards / day <span class="text-ink-400">(0 = ∞)</span>
      <input type="number" min="0" bind:value={study.newPerDay} class="field mt-1" />
    </label>
    <label class="block text-xs text-ink-400">
      Max reviews / day <span class="text-ink-400">(0 = ∞)</span>
      <input type="number" min="0" bind:value={study.maxReviewsPerDay} class="field mt-1" />
    </label>
  </div>
  <label class="mt-3 block text-xs text-ink-400">
    Learning steps (minutes, comma-separated)
    <input bind:value={stepsText} placeholder="1, 10, 60, 240" class="field mt-1" />
  </label>
  <p class="mt-1 text-xs text-ink-400">
    A new card repeats once per step before it graduates (Anki’s default is <code>1, 10</code>).
  </p>

  <label class="mt-3 flex min-h-11 items-center justify-between gap-3 py-1">
    <span class="text-sm">Add a card automatically when a word keeps lapsing</span>
    <input type="checkbox" bind:checked={study.autoReinforce} class="h-4 w-4 accent-seal-400" />
  </label>

  <p class="mt-4 text-xs text-ink-400">Exercise kinds offered when you practise.</p>
  <div class="mt-2 space-y-3">
    {#each drillGroups as group (group.modality)}
      {@const enabledCount = group.items.filter((i) => !i.disabled && !isDisabled(i.id)).length}
      <div class="rounded-[12px] border border-ink-700 p-3">
        <div class="flex items-center justify-between">
          <span class="eyebrow text-ink-300">
            {MODALITY_LABEL[group.modality] ?? group.modality}
          </span>
          <button
            type="button"
            onclick={() => setGroup(group.modality, enabledCount === 0)}
            class="link link-btn text-xs"
          >
            {enabledCount === 0 ? 'turn all on' : 'turn all off'}
          </button>
        </div>
        <div class="mt-2 space-y-1.5">
          {#each group.items as ex (ex.id)}
            <label class="flex min-h-11 items-center justify-between gap-3 py-1">
              <span class="text-sm {ex.disabled || isDisabled(ex.id) ? 'text-ink-400' : ''}">
                {ex.title}{#if ex.disabled}<span class="text-ink-500"> · off for now</span>{/if}
              </span>
              <input
                type="checkbox"
                checked={!ex.disabled && !isDisabled(ex.id)}
                disabled={ex.disabled}
                onchange={(e) => setExercise(ex.id, e.currentTarget.checked)}
                class="h-4 w-4 accent-seal-400"
              />
            </label>
          {/each}
        </div>
      </div>
    {/each}
  </div>

  <button onclick={onsave} class="btn btn-ghost mt-3 px-3 py-2 text-xs">Save study options</button>
</section>

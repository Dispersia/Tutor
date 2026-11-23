<script lang="ts">
  /** Which model each LLM role uses, with the OpenRouter catalogue as a datalist. */

  import { accentStyle, ACCENT } from '#lib/theme'
  import { ROLE_KEYS, ROLE_LABEL } from '#lib/settingsview'
  import Spinner from '#lib/components/Spinner.svelte'
  import type { ModelInfo, Roles } from '#lib/types'

  interface Props {
    models: ModelInfo[]
    modelFilter: string
    modelsLoading: boolean
    roles: Roles
    roleDefaults: Roles | null
    onFilter: () => void
    onSave: () => void
  }

  let {
    models,
    modelFilter = $bindable(),
    modelsLoading,
    roles = $bindable(),
    roleDefaults,
    onFilter,
    onSave,
  }: Props = $props()
</script>

<section class="mb-5 panel panel-accent p-4" style={accentStyle(ACCENT.gold)}>
  <h2 class="display text-sm text-ink-100">Models per role</h2>
  <p class="mt-1 text-xs text-ink-400">
    Pick any model your OpenRouter key can use. The list comes from the API and follows your
    account's provider preferences, privacy settings and guardrails.
  </p>
  <input
    bind:value={modelFilter}
    onchange={onFilter}
    placeholder="filter models (e.g. qwen, deepseek)"
    class="field mt-3"
  />
  {#if modelsLoading}
    <p class="mt-2 flex items-center gap-2 text-xs text-ink-400">
      <Spinner size={12} label="Loading the model catalogue" /> Loading the model catalogue…
    </p>
  {/if}
  <datalist id="models">
    {#each models as m (m.id)}<option value={m.id}>{m.name}</option>{/each}
  </datalist>
  <div class="mt-3 space-y-2">
    {#each ROLE_KEYS as role (role)}
      <label class="block">
        <span class="mb-1 block text-xs text-ink-400">{ROLE_LABEL[role]}</span>
        <input list="models" bind:value={roles[role]} class="field" />
      </label>
    {/each}
  </div>
  <div class="mt-3 flex items-center justify-between">
    <button onclick={onSave} class="btn btn-ghost px-3 py-2 text-xs">Save models</button>
    {#if roleDefaults}
      <button onclick={() => (roles = { ...roleDefaults! })} class="link link-btn text-xs"
        >reset to defaults</button
      >
    {/if}
  </div>
</section>

<script lang="ts">
  /** Voice mode (built-in vs designed) and the per-language voice descriptions. */

  import { accentStyle, ACCENT } from '#lib/theme'
  import { LANG_NAMES } from '#lib/voices'

  interface Props {
    voiceMode: 'preset' | 'design'
    voices: Record<string, string>
    onSave: () => void
  }

  let { voiceMode = $bindable(), voices = $bindable(), onSave }: Props = $props()
</script>

<section class="mb-5 panel panel-accent p-4" style={accentStyle(ACCENT.violet)}>
  <h2 class="display text-sm text-ink-100">Voice</h2>
  <div class="mt-2 flex gap-2">
    <button
      onclick={() => (voiceMode = 'preset')}
      class="btn flex-1 px-3 py-2 text-xs {voiceMode === 'preset' ? 'btn-primary' : 'btn-ghost'}"
      >Built-in voice</button
    >
    <button
      onclick={() => (voiceMode = 'design')}
      class="btn flex-1 px-3 py-2 text-xs {voiceMode === 'design' ? 'btn-primary' : 'btn-ghost'}"
      >Voice design</button
    >
  </div>
  <p class="mt-2 text-xs text-ink-400">
    {voiceMode === 'preset'
      ? 'VoxCPM2 ships one voice, styled as a calm teacher. Switch to Voice design to describe your own.'
      : 'Describe a voice in the text box (e.g. "a warm, patient Mandarin teacher"). One per language; the model invents it.'}
  </p>
  {#if voiceMode === 'design'}
    <div class="mt-3 space-y-2">
      {#each Object.keys(LANG_NAMES) as lc (lc)}
        <label class="block">
          <span class="mb-1 block text-xs text-ink-400">{lc.toUpperCase()} · voice description</span
          >
          <input
            bind:value={voices[lc]}
            placeholder="a calm, professional teacher with a clear, warm voice"
            class="field"
          />
        </label>
      {/each}
    </div>
  {/if}
  <button onclick={onSave} class="btn btn-ghost mt-3 px-3 py-2 text-xs">Save voice</button>
</section>

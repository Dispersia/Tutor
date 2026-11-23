<script lang="ts">
  import { accentStyle } from '#lib/theme'
  import { ACCENT } from '#lib/theme'

  interface Props {
    keyStatus: 'user' | 'server' | false
    keyInput: string
    onSave: () => void
  }

  let { keyStatus, keyInput = $bindable(), onSave }: Props = $props()
</script>

<section class="mb-5 panel panel-accent p-4" style={accentStyle(ACCENT.azure)}>
  <h2 class="display text-sm text-ink-100">Your OpenRouter key</h2>
  <p class="mt-1 text-xs text-ink-400">
    Status:
    {#if keyStatus === 'user'}<span class="text-jade-400">using your own key</span>
    {:else if keyStatus === 'server'}<span class="text-brass-400">using the server's key</span>
    {:else}<span class="text-ember-400">not set — chat is disabled</span>{/if}
  </p>
  <div class="mt-3 flex gap-2">
    <input
      type="password"
      bind:value={keyInput}
      placeholder={keyStatus === 'user' ? 'Replace key…' : 'sk-or-…'}
      class="field flex-1"
    />
    <button onclick={onSave} class="btn btn-ghost px-3 py-2 text-xs">Save</button>
  </div>
</section>

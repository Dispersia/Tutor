<script lang="ts">
  import { accentStyle, ACCENT } from '#lib/theme'
  import { session } from '#lib/session.svelte'

  interface Props {
    handle: string
    onSave: () => void
    onLogout: () => void
  }

  let { handle = $bindable(), onSave, onLogout }: Props = $props()
</script>

<section class="mb-5 panel panel-accent p-4" style={accentStyle(ACCENT.violet)}>
  <h2 class="display text-sm text-ink-100">Account</h2>
  <label class="mt-3 block">
    <span class="mb-1 block text-xs text-ink-400">Display name</span>
    <div class="flex gap-2">
      <input bind:value={handle} class="field flex-1" />
      <button onclick={onSave} class="btn btn-ghost px-3 py-2 text-xs">Save</button>
    </div>
  </label>
  <p class="mt-3 text-xs text-ink-400">@{session.user?.username} · {session.user?.role}</p>
  <button onclick={onLogout} class="btn btn-danger mt-3 px-3 py-2 text-xs">Sign out</button>
</section>

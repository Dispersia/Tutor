<script lang="ts">
  /** Admin only: the member list, with delete for everyone but yourself. */

  import { accentStyle, ACCENT } from '#lib/theme'
  import { session } from '#lib/session.svelte'
  import type { PublicUser } from '#lib/types'

  interface Props {
    users: PublicUser[]
    onRemove: (id: string) => void
  }

  let { users, onRemove }: Props = $props()
</script>

<section class="mb-5 panel panel-accent p-4" style={accentStyle(ACCENT.brass)}>
  <h2 class="display text-sm text-ink-100">Users ({users.length})</h2>
  <ul class="mt-3 space-y-2">
    {#each users as u (u.id)}
      <li class="flex items-center justify-between rounded-[12px] border border-ink-700 px-3 py-2">
        <div>
          <div class="text-sm">{u.handle}</div>
          <div class="text-xs text-ink-400">@{u.username} · {u.role}</div>
        </div>
        {#if u.id !== session.user?.id}
          <button onclick={() => onRemove(u.id)} class="btn btn-danger px-3 py-2 text-xs"
            >Delete</button
          >
        {/if}
      </li>
    {/each}
  </ul>
  <p class="mt-3 text-xs text-ink-400">
    Everyone's conversations, settings and keys are stored separately.
  </p>
</section>

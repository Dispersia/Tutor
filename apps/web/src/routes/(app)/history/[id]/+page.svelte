<script lang="ts">
  import { href } from '#lib/paths'
  import { onMount } from 'svelte'
  import { page } from '$app/state'
  import { goto } from '$app/navigation'
  import { api } from '#lib/api'
  import type { Message } from '#lib/types'

  let messages = $state<Message[]>([])
  let error = $state('')

  const id = $derived(page.params.id)

  onMount(async () => {
    try {
      const r = await api<{ messages: Message[] }>(`/api/sessions/${id}`)
      messages = r.messages.filter((m) => m.role !== 'system')
    } catch (e) {
      error = (e as Error).message
    }
  })
</script>

<div class="flex items-center gap-3 pt-4 pb-4">
  <button onclick={() => goto(href('/history'))} class="text-sm text-neutral-400">← Back</button>
  <h1 class="text-sm font-medium text-neutral-400">Conversation</h1>
</div>

{#if error}
  <p class="text-sm text-red-300">{error}</p>
{:else}
  <div class="space-y-3 pb-10">
    {#each messages as m (m.id)}
      <div class={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
        <div
          class="max-w-[85%] rounded-2xl px-4 py-2.5 text-[15px] whitespace-pre-wrap {m.role ===
          'user'
            ? 'bg-emerald-600/90 text-white'
            : 'border border-neutral-800 bg-neutral-900'}"
        >
          {m.text}
        </div>
      </div>
    {/each}
  </div>
{/if}

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

<div class="flex items-center gap-3 pt-4 pb-4 lg:mx-auto lg:max-w-3xl">
  <button onclick={() => goto(href('/history'))} class="text-sm text-ink-400">← Back</button>
  <h1 class="text-sm font-medium text-ink-400">Conversation</h1>
</div>

{#if error}
  <p class="text-sm text-ember-300 lg:mx-auto lg:max-w-3xl">{error}</p>
{:else}
  <div class="space-y-3 pb-10 lg:mx-auto lg:max-w-3xl">
    {#each messages as m (m.id)}
      <div class={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
        <div
          class="max-w-[85%] rounded-lg px-4 py-2.5 text-[15px] whitespace-pre-wrap {m.role ===
          'user'
            ? 'bg-seal-500/90 text-white'
            : 'border border-ink-700 bg-ink-900 text-ink-100'}"
        >
          {m.text}
        </div>
      </div>
    {/each}
  </div>
{/if}

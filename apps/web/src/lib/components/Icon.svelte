<script lang="ts">
  /** One drawn icon set, single stroke and weight — never emoji. */
  let { name, size = 16, cls = '' }: { name: string; size?: number; cls?: string } = $props()

  const PATHS: Record<string, string> = {
    chat: '<path d="M4 5h16v11H9l-5 4z" />',
    skills: '<path d="m14.5 5.5 4 4M3 21l6.5-6.5M11.5 3.5l9 9-3 3-9-9zM6 14l4 4" />',
    sword: '<path d="m14.5 5.5 4 4M3 21l6.5-6.5M11.5 3.5l9 9-3 3-9-9zM6 14l4 4" />',
    mute: '<path d="M4 9v6h3l5 4V5L7 9H4zM17 9l4 6M21 9l-4 6" />',
    sound: '<path d="M4 9v6h3l5 4V5L7 9H4zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />',
    mic: '<path d="M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM6 11a6 6 0 0 0 12 0M12 17v4M9 21h6" />',
    star: '<path d="m12 3 2.6 5.6 6 .8-4.4 4.2 1.1 6L12 16.9 6.7 19.6l1.1-6L3.4 9.4l6-.8z" />',
    calendar: '<path d="M4 6h16v14H4zM4 10h16M8 3v4M16 3v4" />',
    heart: '<path d="M12 20s-7-4.3-7-9a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 4.7-7 9-7 9z" />',
    shield: '<path d="M12 3 5 6v6c0 4.2 3 7.3 7 9 4-1.7 7-4.8 7-9V6z" />',
    food: '<path d="M5 4v7a3 3 0 0 0 6 0V4M8 4v16M16 4c-1.5 1.5-2 3-2 5s.5 3 2 3 2-1 2-3-.5-3.5-2-5zM16 12v8" />',
    potion: '<path d="M9 3h6M10 3v5l-4 8a3 3 0 0 0 2.7 4.3h6.6A3 3 0 0 0 18 16l-4-8V3" />',
    burst: '<path d="m12 2 2 6 6-2-4.5 4.5L22 14l-6 1 1 6-5-3.5L7 21l1-6-6-1 6.5-3.5L4 6l6 2z" />',
    trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 5H5v2a3 3 0 0 0 3 3M16 5h3v2a3 3 0 0 1-3 3M9 20h6M12 13v7" />',
    skull: '<path d="M12 3a7 7 0 0 0-7 7v4l2 2v3h10v-3l2-2v-4a7 7 0 0 0-7-7zM9.5 11h.01M14.5 11h.01M10 17h4" />',
    dot: '<circle cx="12" cy="12" r="3" />',
    mark: '<path d="M5 12h14" />',
  }
</script>

<svg
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.6"
  stroke-linecap="round"
  stroke-linejoin="round"
  width={size}
  height={size}
  class="inline-block shrink-0 {cls}"
  aria-hidden="true">{@html PATHS[name] ?? ''}</svg
>

<script lang="ts">
  let {
    size = 16,
    label = 'Loading',
    cls = '',
  }: { size?: number; label?: string; cls?: string } = $props()
</script>

<span class="spinner {cls}" style="--spinner-size: {size}px" role="status" aria-label={label}
></span>

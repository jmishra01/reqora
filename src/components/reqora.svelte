<script lang="ts">
  let { width = 24, height = 24 }: { width?: number | string; height?: number | string } = $props();
</script>

<svg xmlns="http://www.w3.org/2000/svg" {width} {height} viewBox="0 0 24 24" fill="none">
  <defs>
    <linearGradient id="reqora-mark" x1="0" y1="0" x2="24" y2="24">
      <stop offset="0" stop-color="#6D5EF0" />
      <stop offset="1" stop-color="#22D3C7" />
    </linearGradient>
  </defs>
  <rect width="24" height="24" rx="5" fill="url(#reqora-mark)" />
  <g transform="translate(4,4) scale(0.6667)">
    <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" fill="#fff" />
  </g>
</svg>

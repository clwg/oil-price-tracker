<script lang="ts">
	let {
		points = [] as [string, number][],
		width = 104,
		height = 30,
		color = 'var(--text-muted)'
	} = $props();

	const path = $derived.by(() => {
		if (points.length < 2) return '';
		const values = points.map(([, v]) => v);
		const min = Math.min(...values);
		const max = Math.max(...values);
		const span = max - min || 1;
		const step = (width - 3) / (points.length - 1);
		return values
			.map((v, i) => {
				const x = 1.5 + i * step;
				const y = height - 3 - ((v - min) / span) * (height - 6);
				return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
			})
			.join('');
	});
</script>

{#if path}
	<svg {width} {height} aria-hidden="true" class="spark">
		<path d={path} fill="none" stroke={color} stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" />
	</svg>
{/if}

<style>
	.spark {
		display: block;
		opacity: 0.85;
	}
</style>

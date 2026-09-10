<script lang="ts">
	import { formatAxis, formatDate, formatValue, unitScale } from '$lib/format';
	import { seriesColor } from '$lib/theme';

	import type { ChartSeries } from '$lib/types';

	let {
		series = [] as ChartSeries[],
		height = 300,
		/** 'value' plots the raw unit on one axis. 'indexed' rebases every series
		 *  to 100 at the first shared point, which is how you compare measures of
		 *  different scale WITHOUT a second y-axis. */
		mode = 'value' as 'value' | 'indexed',
		labelEnds = true
	} = $props();

	const BASE_PAD = { top: 22, right: 16, bottom: 28, left: 60 };

	let width = $state(760);
	let hoverX = $state<number | null>(null);
	let plotEl = $state<HTMLDivElement | null>(null);

	function measure(node: HTMLDivElement) {
		plotEl = node;
		const ro = new ResizeObserver(([entry]) => {
			width = Math.max(240, entry.contentRect.width);
		});
		ro.observe(node);
		return { destroy: () => ro.disconnect() };
	}

	const toTime = (iso: string) => Date.parse(iso + 'T00:00:00Z');

	// Rebasing happens before scaling so the axis reflects what is drawn.
	const prepared = $derived(
		series.map((s) => {
			const base = mode === 'indexed' ? (s.points.find(([, v]) => v !== 0)?.[1] ?? 1) : 1;
			return {
				...s,
				values: s.points.map(([d, v]) => ({
					t: toTime(d),
					iso: d,
					v: mode === 'indexed' ? (v / base) * 100 : v
				}))
			};
		})
	);

	const unit = $derived(mode === 'indexed' ? 'Index' : (series[0]?.unit ?? ''));

	/** Largest magnitude on screen decides the axis scale, once, for every tick. */
	const magnitude = $derived(
		Math.max(0, ...prepared.flatMap((s) => s.values.map((p) => Math.abs(p.v))))
	);
	const scale = $derived(
		mode === 'indexed'
			? { divisor: 1, label: 'index, first = 100', longLabel: '', decimals: 0, prefix: '', suffix: '' }
			: unitScale(unit, magnitude)
	);

	const domain = $derived.by(() => {
		let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
		for (const s of prepared) {
			for (const p of s.values) {
				if (p.t < x0) x0 = p.t;
				if (p.t > x1) x1 = p.t;
				if (p.v < y0) y0 = p.v;
				if (p.v > y1) y1 = p.v;
			}
		}
		if (!Number.isFinite(x0)) return null;
		if (y0 === y1) { y0 -= 1; y1 += 1; }
		// Headroom so the line never grazes the frame.
		const pad = (y1 - y0) * 0.08;
		return { x0, x1, y0: y0 - pad, y1: y1 + pad };
	});

	/** Round tick steps to 1/2/5 x 10^n so labels read as clean numbers. */
	function ticks(min: number, max: number, count: number): number[] {
		const raw = (max - min) / count;
		const mag = Math.pow(10, Math.floor(Math.log10(raw)));
		const norm = raw / mag;
		const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
		const out: number[] = [];
		for (let v = Math.ceil(min / step) * step; v <= max; v += step) out.push(v);
		return out;
	}

	/** End-labels only earn their place when the plot is wide enough to give them
	 *  a gutter; below that they would be clipped, so the tooltip and the table
	 *  view carry the values instead. */
	const showEndLabels = $derived(labelEnds && prepared.length <= 2 && width >= 420);
	const PAD = $derived({ ...BASE_PAD, right: showEndLabels ? 62 : BASE_PAD.right });

	const plotW = $derived(width - PAD.left - PAD.right);
	const plotH = $derived(height - PAD.top - PAD.bottom);

	const sx = $derived((t: number) =>
		domain ? PAD.left + ((t - domain.x0) / (domain.x1 - domain.x0 || 1)) * plotW : 0
	);
	const sy = $derived((v: number) =>
		domain ? PAD.top + plotH - ((v - domain.y0) / (domain.y1 - domain.y0 || 1)) * plotH : 0
	);

	const yTicks = $derived(domain ? ticks(domain.y0, domain.y1, Math.max(5, Math.floor(plotH / 32))) : []);
	const xTicks = $derived.by(() => {
		if (!domain) return [];
		const n = Math.max(2, Math.floor(plotW / 110));
		const out: { t: number; label: string }[] = [];
		for (let i = 0; i <= n; i++) {
			const t = domain.x0 + ((domain.x1 - domain.x0) * i) / n;
			const d = new Date(t);
			const span = domain.x1 - domain.x0;
			const label =
				span > 1000 * 60 * 60 * 24 * 365 * 3
					? String(d.getUTCFullYear())
					: d.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', year: '2-digit' });
			out.push({ t, label });
		}
		return out;
	});

	const paths = $derived(
		prepared.map((s) => ({
			id: s.id,
			d: s.values.map((p, i) => `${i ? 'L' : 'M'}${sx(p.t).toFixed(1)},${sy(p.v).toFixed(1)}`).join('')
		}))
	);

	// Crosshair: readers aim at a date, so snap to the nearest point per series.
	const hover = $derived.by(() => {
		if (hoverX === null || !domain) return null;
		const t = domain.x0 + ((hoverX - PAD.left) / (plotW || 1)) * (domain.x1 - domain.x0);
		const rows = prepared
			.map((s, i) => {
				let best = s.values[0];
				let bestDist = Infinity;
				for (const p of s.values) {
					const dist = Math.abs(p.t - t);
					if (dist < bestDist) { bestDist = dist; best = p; }
				}
				return best ? { label: s.label, unit: s.unit, point: best, color: seriesColor(i) } : null;
			})
			.filter((r): r is NonNullable<typeof r> => Boolean(r));
		if (!rows.length) return null;
		const anchor = rows[0].point;
		return { rows, x: sx(anchor.t), iso: anchor.iso };
	});

	function onMove(event: PointerEvent) {
		if (!plotEl) return;
		const rect = plotEl.getBoundingClientRect();
		const x = event.clientX - rect.left;
		hoverX = x >= PAD.left - 8 && x <= PAD.left + plotW + 8 ? x : null;
	}

	const tooltipSide = $derived(hover && hover.x > width * 0.6 ? 'left' : 'right');
</script>

<div class="chart" use:measure>
	{#if !domain}
		<p class="empty muted">No data in this range.</p>
	{:else}
		<svg
			{width}
			{height}
			role="img"
			aria-label={`${series.map((s) => s.label).join(', ')} over time`}
			onpointermove={onMove}
			onpointerleave={() => (hoverX = null)}
		>
			<!-- gridlines: solid hairlines, one step off the surface -->
			{#each yTicks as tick}
				<line
					x1={PAD.left} x2={PAD.left + plotW}
					y1={sy(tick)} y2={sy(tick)}
					stroke="var(--gridline)" stroke-width="1" shape-rendering="crispEdges"
				/>
				<text x={PAD.left - 10} y={sy(tick)} class="tick" text-anchor="end" dominant-baseline="middle">
					{formatAxis(tick, scale)}
				</text>
			{/each}

			<!-- The axis states its own unit, so the scale is never inferred. -->
			{#if scale.label}
				<text x={PAD.left - 10} y={PAD.top - 3} class="tick axis-caption" text-anchor="end">
					{scale.label}
				</text>
			{/if}

			<line
				x1={PAD.left} x2={PAD.left + plotW}
				y1={PAD.top + plotH} y2={PAD.top + plotH}
				stroke="var(--baseline)" stroke-width="1" shape-rendering="crispEdges"
			/>

			{#each xTicks as tick}
				<text x={sx(tick.t)} y={height - 8} class="tick" text-anchor="middle">{tick.label}</text>
			{/each}

			{#if hover}
				<line
					x1={hover.x} x2={hover.x} y1={PAD.top} y2={PAD.top + plotH}
					stroke="var(--baseline)" stroke-width="1" shape-rendering="crispEdges"
				/>
			{/if}

			{#each paths as path, i}
				<path
					d={path.d} fill="none" stroke={seriesColor(i)}
					stroke-width="2" stroke-linejoin="round" stroke-linecap="round"
				/>
			{/each}

			<!-- end marker: >=8px, with a 2px surface ring so overlaps stay legible -->
			{#each prepared as s, i}
				{@const last = s.values[s.values.length - 1]}
				{#if last}
					<circle cx={sx(last.t)} cy={sy(last.v)} r="4.5" fill={seriesColor(i)}
						stroke="var(--surface-1)" stroke-width="2" />
				{/if}
			{/each}

			{#if hover}
				{#each hover.rows as row, i}
					<circle cx={sx(row.point.t)} cy={sy(row.point.v)} r="4.5"
						fill={seriesColor(i)} stroke="var(--surface-1)" stroke-width="2" />
				{/each}
			{/if}
		</svg>

		<!-- Direct end-labels, only when they will not collide: past a few
		     converging series they detach from their lines and read as noise. -->
		{#if showEndLabels}
			{#each prepared as s, i}
				{@const last = s.values[s.values.length - 1]}
				{#if last}
					<span class="end-label tabular" style="left:{sx(last.t) + 8}px; top:{sy(last.v) - 9}px">
						{formatValue(last.v, mode === 'indexed' ? '' : s.unit)}
					</span>
				{/if}
			{/each}
		{/if}

		{#if hover}
			<div
				class="tooltip"
				style:left={tooltipSide === 'right' ? `${hover.x + 14}px` : 'auto'}
				style:right={tooltipSide === 'left' ? `${width - hover.x + 14}px` : 'auto'}
			>
				<div class="tt-date">{formatDate(hover.iso)}</div>
				{#each hover.rows as row}
					<div class="tt-row">
						<span class="tt-key" style:background={row.color}></span>
						<span class="tt-value tabular">{formatValue(row.point.v, mode === 'indexed' ? '' : row.unit)}</span>
						<span class="tt-label">{row.label}</span>
					</div>
				{/each}
			</div>
		{/if}
	{/if}
</div>

<style>
	.chart {
		position: relative;
		width: 100%;
		min-width: 0;
	}

	svg {
		display: block;
		touch-action: none;
		max-width: 100%;
	}

	.tick {
		fill: var(--text-muted);
		font-size: 11px;
		font-variant-numeric: tabular-nums;
	}

	.axis-caption {
		font-size: 10px;
		font-variant-numeric: normal;
	}

	.empty {
		padding: 40px 0;
		text-align: center;
		font-size: 13px;
	}

	.end-label {
		position: absolute;
		font-size: 11.5px;
		font-weight: 600;
		color: var(--text-secondary);
		pointer-events: none;
		white-space: nowrap;
	}

	.tooltip {
		position: absolute;
		top: 8px;
		background: var(--surface-1);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 8px 10px;
		pointer-events: none;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
		min-width: 150px;
		z-index: 2;
	}

	.tt-date {
		font-size: 11px;
		color: var(--text-muted);
		margin-bottom: 5px;
	}

	.tt-row {
		display: grid;
		grid-template-columns: 10px auto;
		gap: 2px 7px;
		align-items: baseline;
		margin-top: 4px;
	}

	/* A short stroke keys the series; at tooltip density a filled box is
	   data-weight ink doing a label's job. */
	.tt-key {
		width: 10px;
		height: 2px;
		border-radius: 1px;
		align-self: center;
	}

	/* Values lead, labels follow - the reader has the series and wants the number. */
	.tt-value {
		font-size: 13px;
		font-weight: 600;
		color: var(--text-primary);
	}

	.tt-label {
		grid-column: 2;
		font-size: 11px;
		color: var(--text-secondary);
		line-height: 1.3;
	}
</style>

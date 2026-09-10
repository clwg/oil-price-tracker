<script lang="ts">
	import { formatDate } from '$lib/format';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	/** Values arrive already rounded the way EIA printed them, so they are shown
	 *  verbatim rather than re-derived - this page is the report of record. */
	function show(value: number | null, kind: string): string {
		if (value === null) return '-';
		const text = value.toLocaleString('en-US', { maximumFractionDigits: 3 });
		return kind === 'percent_change' || kind === 'share' ? `${text}%` : text;
	}

	function tone(value: number | null, kind: string): string {
		if (value === null || (kind !== 'difference' && kind !== 'percent_change')) return '';
		return value > 0 ? 'pos' : value < 0 ? 'neg' : '';
	}
</script>

<svelte:head><title>{data.meta.label} - U.S. Petroleum Dashboard</title></svelte:head>

<header class="intro">
	<h1>Weekly report</h1>
	<p class="muted">
		As published for the week ending {data.reportDate
			? formatDate(data.reportDate, 'long')
			: '-'}, with EIA's own week-over-week and year-over-year comparisons.
	</p>
</header>

<div class="layout">
	<nav class="picker" aria-label="Report sections">
		{#each data.groups as group}
			<!-- Label and its items are one element so they stay together when the
			     picker reflows into columns on narrow screens. -->
			<div class="group">
				<p class="group-label">{group.label}</p>
				<ul>
					{#each group.tables as t}
						<li>
							<a href="?table={t.id}" aria-current={data.table === t.id ? 'page' : undefined}>
								{t.label}
							</a>
						</li>
					{/each}
				</ul>
			</div>
		{/each}
	</nav>

	<section class="card">
		<h2 class="card-title">{data.meta.label}</h2>
		<p class="card-sub">{data.meta.blurb}</p>

		{#each data.sections as section}
			<div class="scroll-x">
				<table class="data">
					<thead>
						{#if section.header}
							<!-- EIA prints these measures side by side under spanning headers.
							     Without them the repeated dates read as a jump back in time. -->
							<tr class="spans">
								<th></th>
								{#if section.header.leading}<th colspan={section.header.leading}></th>{/if}
								{#each section.header.groups as group}
									<th colspan={group.span} class="span-head">{group.label}</th>
								{/each}
							</tr>
						{/if}
						<tr>
							<th class="stub">Item</th>
							{#each section.columns as column}
								<th
									class="num"
									class:derived={column.kind !== 'observation'}
									class:boundary={column.boundary}
								>
									{column.label}
									{#if column.rel}<span class="rel">{column.rel}</span>{/if}
								</th>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each section.rows as row, i}
							{#if row.group && row.group !== section.rows[i - 1]?.group}
								<tr class="section-row">
									<th scope="rowgroup" colspan={section.columns.length + 1}>{row.group}</th>
								</tr>
							{/if}
							<tr>
								<td class="stub" style:padding-left="{row.depth * 16}px" title={row.path}>
									{row.label}
								</td>
								{#each row.values as value, i}
									<td
										class="num {tone(value, section.columns[i].kind)}"
										class:boundary={section.columns[i].boundary}
									>
										{show(value, section.columns[i].kind)}
									</td>
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			{#if section.index < data.sections.length - 1}<hr />{/if}
		{:else}
			<p class="muted">No figures for this section in the current report.</p>
		{/each}

		<footer class="footnote muted">
			Volumes are thousand barrels per day and stocks million barrels unless a column says otherwise.
			Colour marks the direction of a change, not whether it is favourable. Source: EIA table
			{data.meta.ref} - {data.meta.official}.
		</footer>
	</section>
</div>

<style>
	.intro {
		padding: 4px 0 18px;
	}

	.intro h1 {
		font-size: 22px;
	}

	.intro p {
		margin: 4px 0 0;
		font-size: 13px;
		max-width: 72ch;
	}

	.layout {
		display: grid;
		grid-template-columns: 208px minmax(0, 1fr);
		gap: 20px;
		align-items: start;
	}

	.picker {
		position: sticky;
		top: 12px;
	}

	.group-label {
		font-size: 10.5px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-muted);
		margin: 0 0 5px 10px;
	}

	.picker ul {
		list-style: none;
		margin: 0 0 18px;
		padding: 0;
	}

	.picker li + li {
		margin-top: 1px;
	}

	.picker a {
		display: block;
		text-decoration: none;
		font-size: 12.5px;
		line-height: 1.35;
		padding: 6px 10px;
		border-radius: 7px;
		color: var(--text-secondary);
		border-left: 2px solid transparent;
	}

	.picker a:hover {
		background: var(--wash);
		color: var(--text-primary);
	}

	/* A solid accent fill would put white text under 4.5:1 in both modes, so
	   selection is carried by fill, weight and an accent edge together. */
	.picker a[aria-current='page'] {
		background: var(--wash);
		border-left-color: var(--series-1);
		color: var(--text-primary);
		font-weight: 600;
	}

	.card-title {
		font-size: 15px;
	}

	.stub {
		white-space: nowrap;
		padding-right: 24px;
	}

	th.derived {
		font-weight: 400;
		font-style: italic;
		color: var(--text-muted);
	}

	/* Says what each date is, so a date appearing twice reads as a comparison
	   rather than as an ordering mistake. */
	.rel {
		display: block;
		font-weight: 400;
		font-size: 10px;
		color: var(--text-muted);
		font-variant-numeric: normal;
	}

	.section-row th {
		text-align: left;
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-secondary);
		background: var(--wash);
		padding: 7px 10px;
		border-bottom: 1px solid var(--gridline);
	}

	/* The rule plus the extra gutter is what stops six columns reading as one
	   continuous run of dates when a measure restarts at the latest week. */
	:global(table.data th.boundary),
	:global(table.data td.boundary) {
		border-left: 1px solid var(--baseline);
		padding-left: 26px;
	}

	.spans th {
		border-bottom: 0;
		padding-bottom: 2px;
	}

	.spans .span-head + .span-head {
		border-left: 1px solid var(--baseline);
	}

	/* A hairline under each span shows exactly which columns it covers. */
	.spans .span-head {
		text-align: center;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.02em;
		color: var(--text-secondary);
		border-bottom: 1px solid var(--baseline);
		padding: 0 10px 3px;
	}

	.pos {
		color: var(--up);
	}

	.neg {
		color: var(--down);
	}

	hr {
		border: 0;
		border-top: 1px solid var(--border);
		margin: 22px 0;
	}

	.footnote {
		display: block;
		font-size: 11px;
		line-height: 1.5;
		margin-top: 16px;
		padding-top: 12px;
		border-top: 1px solid var(--border);
		max-width: 90ch;
	}

	@media (max-width: 860px) {
		.layout {
			grid-template-columns: 1fr;
		}

		.picker {
			position: static;
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
			gap: 4px 18px;
			align-items: start;
		}
	}
</style>

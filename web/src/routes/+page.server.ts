import { getHeadlines, getReportMeta, getSeriesData } from '$lib/server/queries';
import { sql } from '$lib/server/db';
import type { PageServerLoad } from './$types';

/** The stat-tile row. Weekly values (not 4-week averages) so the numbers match
 *  what the report's headline table prints. */
const HEADLINES = [
	{ sourcekey: 'RWTC', frequency: 'daily', label: 'WTI crude spot' },
	{ sourcekey: 'RBRTE', frequency: 'daily', label: 'Brent crude spot' },
	{ sourcekey: 'EMM_EPMR_PTE_NUS_DPG', frequency: 'weekly', label: 'Retail gasoline, regular' },
	{ sourcekey: 'WCESTUS1', frequency: 'weekly', label: 'Commercial crude stocks' },
	{ sourcekey: 'WCSSTUS1', frequency: 'weekly', label: 'Strategic Petroleum Reserve' },
	{ sourcekey: 'WCRFPUS2', frequency: 'weekly', label: 'Crude oil production' },
	{ sourcekey: 'WPULEUS3', frequency: 'weekly', label: 'Refinery utilization' },
	{ sourcekey: 'WRPUPUS2', frequency: 'weekly', label: 'Total products supplied' }
];

/** Charts on the overview. Each group shares one unit so it needs one axis. */
const GROUPS: Record<string, { sourcekey: string; frequency: string; label: string }[]> = {
	prices: [
		{ sourcekey: 'RWTC', frequency: 'daily', label: 'WTI (Cushing)' },
		{ sourcekey: 'RBRTE', frequency: 'daily', label: 'Brent' }
	],
	crudeStocks: [
		{ sourcekey: 'WCESTUS1', frequency: 'weekly', label: 'Commercial (ex-SPR)' },
		{ sourcekey: 'WCSSTUS1', frequency: 'weekly', label: 'Strategic Petroleum Reserve' }
	],
	supply: [
		{ sourcekey: 'WCRFPUS2', frequency: 'weekly', label: 'Field production' },
		{ sourcekey: 'WCEIMUS2', frequency: 'weekly', label: 'Commercial imports' },
		{ sourcekey: 'WCREXUS2', frequency: 'weekly', label: 'Exports' }
	],
	refining: [{ sourcekey: 'WPULEUS3', frequency: 'weekly', label: 'Refinery utilization' }],
	productStocks: [
		{ sourcekey: 'WGTSTUS1', frequency: 'weekly', label: 'Total gasoline' },
		{ sourcekey: 'WDISTUS1', frequency: 'weekly', label: 'Distillate fuel oil' },
		{ sourcekey: 'WKJSTUS1', frequency: 'weekly', label: 'Kerosene-type jet fuel' }
	],
	demand: [
		{ sourcekey: 'WGFUPUS2', frequency: '4-week average', label: 'Finished motor gasoline' },
		{ sourcekey: 'WDIUPUS2', frequency: '4-week average', label: 'Distillate fuel oil' },
		{ sourcekey: 'WKJUPUS2', frequency: '4-week average', label: 'Kerosene-type jet fuel' }
	],
	retail: [
		{ sourcekey: 'EMM_EPMR_PTE_NUS_DPG', frequency: 'weekly', label: 'Gasoline, regular' },
		{ sourcekey: 'EMD_EPD2D_PTE_NUS_DPG', frequency: 'weekly', label: 'On-highway diesel' }
	]
};

export const load: PageServerLoad = async ({ url }) => {
	const years = Number(url.searchParams.get('years') ?? 5);

	const wanted = [...new Set(Object.values(GROUPS).flat().map((g) => g.sourcekey))];
	const resolved = await sql<{ id: number; sourcekey: string; frequency: string }[]>`
		SELECT id, sourcekey, frequency FROM series WHERE sourcekey = ANY(${wanted})
	`;

	const idFor = (sourcekey: string, frequency: string) =>
		resolved.find((r) => r.sourcekey === sourcekey && r.frequency === frequency)?.id;

	const from = years
		? new Date(Date.UTC(new Date().getUTCFullYear() - years, new Date().getUTCMonth(), 1))
				.toISOString()
				.slice(0, 10)
		: undefined;

	const groupIds = Object.fromEntries(
		Object.entries(GROUPS).map(([key, specs]) => [
			key,
			specs.map((s) => ({ ...s, id: idFor(s.sourcekey, s.frequency) })).filter((s) => s.id)
		])
	);

	const [headlines, meta, ...groupData] = await Promise.all([
		getHeadlines(HEADLINES),
		getReportMeta(),
		...Object.values(groupIds).map((specs) =>
			getSeriesData(specs.map((s) => s.id as number), { from, maxPoints: 700 })
		)
	]);

	const charts = Object.fromEntries(
		Object.keys(groupIds).map((key, i) => [
			key,
			groupData[i].map((s) => {
				const spec = groupIds[key].find((g) => g.id === s.id);
				return { id: s.id, label: spec?.label ?? s.short_name, unit: s.unit, points: s.points };
			})
		])
	);

	return { headlines, meta, charts, years };
};

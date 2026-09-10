import { getFacets, getSeriesData, listSeries } from '$lib/server/queries';
import type { PageServerLoad } from './$types';

/** Opens on a recognisable pair rather than an empty plot. */
const DEFAULT_IDS = ['WCESTUS1', 'WCSSTUS1'];

export const load: PageServerLoad = async ({ url }) => {
	const search = url.searchParams.get('q') ?? '';
	const category = url.searchParams.get('category') ?? '';
	const area = url.searchParams.get('area') ?? '';
	const product = url.searchParams.get('product') ?? '';
	const frequency = url.searchParams.get('frequency') ?? '';
	const years = Number(url.searchParams.get('years') ?? 10);
	const mode = (url.searchParams.get('mode') ?? 'value') as 'value' | 'indexed';

	const [matches, facets] = await Promise.all([
		listSeries({ search, category, area, product, frequency, limit: 300 }),
		getFacets()
	]);

	const idParam = url.searchParams.get('ids');
	let selected = idParam
		? idParam.split(',').map(Number).filter(Boolean).slice(0, 4)
		: matches.filter((m) => DEFAULT_IDS.includes(m.sourcekey) && m.frequency === 'weekly').map((m) => m.id).slice(0, 2);

	if (selected.length === 0 && matches.length) selected = [matches[0].id];

	const from = years
		? new Date(Date.UTC(new Date().getUTCFullYear() - years, new Date().getUTCMonth(), 1))
				.toISOString()
				.slice(0, 10)
		: undefined;

	const chosen = await getSeriesData(selected, { from, maxPoints: 900 });

	return {
		matches,
		facets,
		chosen: chosen.map((s) => ({
			id: s.id,
			label: s.short_name,
			unit: s.unit,
			sourcekey: s.sourcekey,
			frequency: s.frequency,
			points: s.points
		})),
		filters: { search, category, area, product, frequency, years, mode },
		selected
	};
};

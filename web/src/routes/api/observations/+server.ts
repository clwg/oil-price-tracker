import { error, json } from '@sveltejs/kit';
import { getSeriesData } from '$lib/server/queries';
import { sql } from '$lib/server/db';
import type { RequestHandler } from './$types';

/** GET /api/observations?ids=1,2  or  ?keys=RWTC,RBRTE
 *  Optional: from, to (YYYY-MM-DD), points (downsample target, default 800). */
export const GET: RequestHandler = async ({ url }) => {
	const idParam = url.searchParams.get('ids');
	const keyParam = url.searchParams.get('keys');

	let ids: number[] = [];
	if (idParam) {
		ids = idParam.split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0);
	} else if (keyParam) {
		const keys = keyParam.split(',').map((k) => k.trim()).filter(Boolean);
		const rows = await sql<{ id: number }[]>`
			SELECT id FROM series WHERE sourcekey = ANY(${keys}) ORDER BY obs_count DESC
		`;
		ids = rows.map((r) => r.id);
	}

	if (ids.length === 0) error(400, 'provide ids= or keys=');
	if (ids.length > 12) error(400, 'at most 12 series per request');

	const data = await getSeriesData(ids.slice(0, 12), {
		from: url.searchParams.get('from') ?? undefined,
		to: url.searchParams.get('to') ?? undefined,
		maxPoints: Number(url.searchParams.get('points') ?? 800)
	});

	return json({
		series: data.map((s) => ({
			id: s.id,
			sourcekey: s.sourcekey,
			name: s.short_name,
			unit: s.unit,
			frequency: s.frequency,
			points: s.points
		}))
	});
};

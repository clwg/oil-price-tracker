import { json } from '@sveltejs/kit';
import { listSeries } from '$lib/server/queries';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const series = await listSeries({
		search: url.searchParams.get('q') ?? '',
		category: url.searchParams.get('category') ?? '',
		area: url.searchParams.get('area') ?? '',
		product: url.searchParams.get('product') ?? '',
		frequency: url.searchParams.get('frequency') ?? '',
		limit: Number(url.searchParams.get('limit') ?? 200)
	});
	return json({ count: series.length, series });
};

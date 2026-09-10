import postgres from 'postgres';
import { env } from '$env/dynamic/private';

const url = env.DATABASE_URL ?? 'postgres://oil:oil@localhost:5432/oil';

export const sql = postgres(url, {
	max: 8,
	idle_timeout: 30,
	// Dates come back as 'YYYY-MM-DD' strings; the charts want them as-is, and
	// this avoids every row paying for a Date allocation plus timezone shifting.
	types: {
		date: {
			to: 1082,
			from: [1082],
			serialize: (x: string) => x,
			parse: (x: string) => x
		}
	}
});

export type Series = {
	id: number;
	sourcekey: string;
	short_name: string;
	name: string;
	unit: string;
	frequency: string;
	table_id: string;
	table_title: string;
	category: string;
	area: string;
	product: string;
	first_period: string;
	last_period: string;
	obs_count: number;
};

export type Point = [string, number];

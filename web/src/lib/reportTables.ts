/** How the report's tables are presented in the UI.
 *
 *  EIA identifies these by number, but a number tells a reader nothing about
 *  what is inside, so the navigation is labelled by subject and grouped by
 *  theme. The official number is kept as `ref` and shown where it is useful
 *  context - on the table itself, next to the official title - rather than
 *  being the label you have to decode. */
export type ReportTable = {
	id: string;
	/** What the navigation says. */
	label: string;
	/** One line describing what the reader will find. */
	blurb: string;
	/** EIA's own table number, for cross-referencing the published report. */
	ref: string;
	/** EIA's official table title. */
	official: string;
};

export type ReportGroup = { label: string; tables: ReportTable[] };

export const REPORT_GROUPS: ReportGroup[] = [
	{
		label: 'Supply & balance',
		tables: [
			{
				id: '1',
				label: 'Petroleum balance sheet',
				blurb: 'Where every barrel came from and where it went, for the U.S. as a whole.',
				ref: '1',
				official: 'U.S. Petroleum Balance Sheet'
			},
			{
				id: '9',
				label: 'All weekly estimates',
				blurb:
					'EIA’s summary sheet: production, refining, stocks, trade and demand on one page. ' +
					'Values only - for week-over-week differences and percent changes, use the topic ' +
					'tables above.',
				ref: '9',
				official: 'U.S. and PAD District Weekly Estimates'
			},
			{
				id: '2',
				label: 'Refinery inputs & production',
				blurb: 'What refineries took in and put out, broken out by PAD district.',
				ref: '2',
				official: 'U.S. Inputs and Production by PAD District'
			},
			{
				id: '3',
				label: 'Refiner & blender output',
				blurb: 'Net production of finished products by refiners and blenders.',
				ref: '3',
				official: 'Refiner and Blender Net Production'
			}
		]
	},
	{
		label: 'Inventories',
		tables: [
			{
				id: '4',
				label: 'Crude oil & products',
				blurb: 'Crude stocks by region, including Cushing and the SPR, plus product totals.',
				ref: '4',
				official: 'Stocks of Crude Oil by PAD District, and Stocks of Petroleum Products'
			},
			{
				id: '5',
				label: 'Gasoline & ethanol',
				blurb: 'Motor gasoline and fuel ethanol stocks by PAD district.',
				ref: '5',
				official: 'Stocks of Total Motor Gasoline and Fuel Ethanol by PAD District'
			},
			{
				id: '5a',
				label: 'Gasoline by sub-region',
				blurb: 'The same gasoline stocks, split down to sub-PADD level.',
				ref: '5A',
				official:
					'Stocks of Total Motor Gasoline and Fuel Ethanol by PAD District with Total Gasoline by Sub-PADD'
			},
			{
				id: '6',
				label: 'Distillate, jet & propane',
				blurb: 'Distillate, kerosene-type jet fuel, residual fuel oil and propane stocks.',
				ref: '6',
				official:
					'Stocks of Distillate, Kerosene-Type Jet Fuel, Residual Fuel Oil, and Propane/Propylene by PAD District'
			}
		]
	},
	{
		label: 'Trade',
		tables: [
			{
				id: '7',
				label: 'Imports & exports',
				blurb: 'Crude and product imports and exports, by PAD district.',
				ref: '7',
				official: 'Imports and Exports of Crude Oil and Products'
			},
			{
				id: '8',
				label: 'Imports by country',
				blurb: 'Which countries the week’s crude imports came from.',
				ref: '8',
				official: 'Preliminary Crude Imports by Country of Origin'
			}
		]
	},
	{
		label: 'Prices',
		tables: [
			{
				id: '11',
				label: 'Spot: crude & gasoline',
				blurb: 'Daily spot prices for crude, conventional gasoline and heating oil.',
				ref: '11',
				official: 'Spot Prices of Crude Oil, Motor Gasoline, and Heating Oil'
			},
			{
				id: '12',
				label: 'Spot: diesel, jet & propane',
				blurb: 'Daily spot prices for ultra-low sulfur diesel, jet fuel and propane.',
				ref: '12',
				official: 'Spot Prices of Ultra-Low Sulfur Diesel Fuel, Kerosene-Type Jet Fuel, and Propane'
			},
			{
				id: '14',
				label: 'Retail pump prices',
				blurb: 'What drivers actually paid for gasoline and on-highway diesel.',
				ref: '14',
				official: 'U.S. Retail Motor Gasoline and On-Highway Diesel Fuel Prices'
			}
		]
	}
];

export const REPORT_TABLES: Record<string, ReportTable> = Object.fromEntries(
	REPORT_GROUPS.flatMap((g) => g.tables).map((t) => [t.id, t])
);

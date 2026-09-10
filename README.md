# U.S. Petroleum Dashboard

A dashboard over the [EIA Weekly Petroleum Status Report][wpsr] - U.S. crude and
product supply, stocks, refining, trade and prices.

![](screenshots/overview.png)

**1,118 series · 1.38M observations · weekly data back to August 1982 · daily spot
prices back to 1986.**

Three moving parts, deliberately kept separate:

| Part | What it is | Runs where |
|---|---|---|
| `ingest/eia_ingest.py` | One Python file, two dependencies. Downloads the report and loads Postgres. | Anywhere with Python + network |
| `db/` + `docker-compose.yml` | Postgres 17 with the schema applied on first start | Docker |
| `web/` | SvelteKit dashboard reading Postgres directly | Docker, or `npm run dev` |

## Quick start

```bash
cp .env.example .env
docker compose up -d db                 # Postgres, schema auto-applied

python3 -m venv ingest/.venv
ingest/.venv/bin/pip install -r ingest/requirements.txt
DATABASE_URL=postgres://oil:oil@localhost:5432/oil \
  ingest/.venv/bin/python ingest/eia_ingest.py       # ~35s, downloads ~20 MB

docker compose up -d                    # dashboard on http://localhost:3000
```

The ingest script also runs under [uv][uv] with no setup at all - dependencies are
declared inline (PEP 723):

```bash
uv run ingest/eia_ingest.py --database-url postgres://oil:oil@localhost:5432/oil
```

## Where the data comes from

The report publishes 13 live tables (10 and 13 were discontinued by EIA and now
return an access-denied page). Each table is offered as **both** a `.csv` and an
`.xls`, and they are not the same data:

- **`.csv` - the current week only.** This week, last week, a year ago, plus EIA's
  own difference and percent-change columns.
- **`.xls` - the full history.** The same tables, one column per series, back to
  1982, each tagged with EIA's canonical **sourcekey** (`WCRFPUS2`, `RWTC`, …).

Both are ingested. The XLS workbooks make "track each metric over time" work on day
one instead of accumulating a point a week; the CSVs preserve the published
snapshot, deltas and rounding exactly as printed, which is what the *Weekly report*
page shows.

```
ingest --mode xls   → series, series_source, observation   (history)
ingest --mode csv   → csv_snapshot                         (this week, as printed)
ingest --mode all   → both (default)
```

## Data model

One row per (series, period, value) - and the source's wide
shape is offered back as views:

```
series          1,118 rows   one per real-world series, keyed (sourcekey, name)
series_source   1,545 rows   which tables/sheets each series appears in
observation     1.38M rows   (series_id, period)
csv_snapshot    7,808 rows   the current week's printed cells
```

**Why not a table per source?** Table-per-source means 45 tables (one per workbook sheet), 
up to 177 columns wide, **38.9% of cells NULL** - because series start anywhere from 1982 to 2024 - and an `ALTER TABLE` every time EIA adds a series (10 appeared in 2023, 18 in 2024). 
It also fights the main use case, which is cross-source: WTI price (table 11) beside crude stocks (table 4) beside refinery utilization (table 9).

Every source sheet is exposed as a **generated wide view** with a column per sourcekey - 
the spreadsheet shape, no duplication:

```sql
SELECT period, "RWTC", "RBRTE" FROM wpsr_t11_data1 ORDER BY period DESC LIMIT 5;
```

`series_source` exists because 343 series appear in more than one table (table 9
restates most of tables 1–7). Storing them once removes ~670k redundant rows while
keeping every sheet reproducible in full. `v_observation` denormalises everything
for ad-hoc SQL.

Note that EIA publishes some series twice under one sourcekey - the weekly value
and its 4-week average (`WCRFPUS2` is both 13,804 and 13,815 for the same week).
They are separate rows, told apart by `frequency`.

## The dashboard

- **Overview** - headline figures, and charts for prices, crude and product
  inventories, the supply balance, refinery utilization, demand and pump prices.
  One time-range control scopes every chart.
- **Explore** - search and facet all 1,118 series by category, region, product and
  frequency; compare up to four. Mixing units switches the chart to indexed-to-100
  rather than growing a second y-axis.
- **Weekly report** - the published tables for the current week, reproduced with
  EIA's own comparison columns.

### JSON API

```
GET /api/series?q=cushing&category=prices&limit=20
GET /api/observations?keys=RWTC,RBRTE&from=2020-01-01&points=500
GET /api/observations?ids=1487,1488
```

## Dependencies

Kept deliberately short.

**Ingest (2):** `xlrd` reads the legacy `.xls` workbooks; `psycopg` talks to Postgres

**Web (1 runtime):** `postgres` (zero-dependency client). Plus SvelteKit, Svelte,
Vite and TypeScript as build tooling. **No charting library** - charts are hand-rolled
SVG.

## Operating it

The script is idempotent: re-running overwrites values for periods it sees again,
which is what you want because EIA revises recent weeks. A new report lands
Wednesdays around 10:30 ET.

```bash
# weekly refresh (crontab)
30 11 * * 3  cd /path/to/oil-prices && ingest/.venv/bin/python ingest/eia_ingest.py

ingest/eia_ingest.py --help          # --tables, --mode, --offline, --delay, -v
ingest/eia_ingest.py --offline       # re-parse cached downloads, no network
```

Downloads are cached in `ingest/.cache/`. EIA rate-limits bursts with an HTML block
page, so requests are serialised (`--delay`, default 1s) and retried with backoff;
the block page is detected rather than parsed as data. Every run is recorded in
`ingest_run`.

## Caveats

- Weekly figures are EIA **estimates** and get revised; the 4-week averages are
  steadier for trend reading.
- Refinery utilization above 100% is normal - capacity is a rated figure.
- "Product supplied" is EIA's consumption proxy (volumes leaving primary storage),
  not measured end-use demand.
- Tables 10 and 13 are discontinued upstream and are not collected.

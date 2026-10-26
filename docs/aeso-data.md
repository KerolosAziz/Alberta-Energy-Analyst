# AESO data notes

What we learned about the AESO public API in build step 2 (8 October 2026). Everything here was checked against live responses; the probe scripts and saved samples stayed outside the repo. Numbers and limits are as observed on that date.

## Access

- Portal: https://developer-apim.aeso.ca/ (Azure API Management). Sign up, subscribe to the product **AESO Public API**, copy the primary and secondary keys from your profile. Both keys work; either can be rotated.
- Base URL: `https://apimgw.aeso.ca/public/`
- Auth: HTTP header `API-KEY: <key>`. Other header names return 401 `{"statusCode":401,"message":"Access denied due to missing subscription key..."}`.
- The old host `api.aeso.ca` no longer resolves.
- Every product's OpenAPI 3 definition can be downloaded from the portal after sign-in (not fetched yet; the portal is JavaScript-only, so `curl` sees nothing).
- Terms: https://www.aeso.ca/legal (use and copying allowed for non-commercial, personal or educational purposes; public display and attribution are not addressed). Support: info@aeso.ca.
- Official guide: https://www.aeso.ca/assets/downloads/external/api/API-Access-Instructions-APIM-API-Gateway.pdf (v40, June 2026). It covers registration and keys only; no rate limits, quotas or endpoint list.

## Conventions shared by every report

- `startDate` and `endDate` are `yyyy-MM-dd`, Alberta local calendar days, **inclusive on both ends**. `endDate` is optional on the pool price report (defaults to one day). Other formats give 400 `"... is not a valid date, please enter a valid date in yyyy-MM-dd format"`. End before start gives 400 `"Report end date must be after begin date."`
- Success envelope: `{"timestamp": "...", "responseCode": "200", "return": {"<Report name>": [rows]}}` for the time-series reports, or `"return": [rows]` / `"return": {...}` for list and snapshot reports.
- Errors: 400 is `{"timestamp", "message", "details"}` (message is human-readable and specific: range too long, start too early, no data). 401 and 404 come from the gateway as `{"statusCode", "message"}`.
- Timestamps are strings `"YYYY-MM-DD HH:MM"` with no zone marker, always in pairs: `begin_datetime_utc` and `begin_datetime_mpt` (Mountain Prevailing Time, the Alberta clock). Hourly rows are stamped with the **hour beginning**.
- **All values are strings**, including numbers (`"87.35"`, `"9459"`). Parse them.
- A value that is not yet known is the **empty string** `""`, never `null`. Seen for the current and future hours (actuals and rolling average) and for `volume` in early SMP history.
- Rows come in ascending time order, except the system marginal price report, which is **descending**.
- No rate-limit, quota or `Retry-After` headers were seen. 15 back-to-back one-day calls all returned 200 in 70 to 95 ms each. Keep the backfill polite anyway (a short pause between calls); the portal shows no published policy.
- Latency: about 60 to 130 ms for small ranges, 0.4 to 1.4 s for a full year of hourly data (about 1.3 MB of JSON).

## Endpoints tried

| Report | Path (under the base URL) | Params | Grain | Max range | Earliest | Verdict |
|---|---|---|---|---|---|---|
| Pool price | `poolprice-api/v1.1/price/poolPrice` | startDate, [endDate] | hourly | 366 days | 2000-01-01 | **v1** |
| Alberta internal load, actual and forecast | `actualforecast-api/v1/load/albertaInternalLoad` | startDate, endDate | hourly | 366 days | 2000-01-01 | **v1** |
| System marginal price | `systemmarginalprice-api/v1.1/price/systemMarginalPrice` | startDate, endDate | per change (minutes) | 183 days | 2000-01-01 | v1 if time allows |
| Current supply and demand, summary | `currentsupplydemand-api/v2/csd/summary/current` | none | live snapshot | n/a | now only | optional (see below) |
| Current supply and demand, assets | `currentsupplydemand-api/v1/csd/generation/assets/current` | none | live snapshot, per asset | n/a | now only | later |
| Generation capability and outages | `aiesgencapacity-api/v1/AIESGenCapacity` | startDate, endDate | hourly by fuel and sub-fuel | 31 days | 2011-01-01 | later |
| Energy merit order | `energymeritorder-api/v1/meritOrder/energy` | startDate only | one day, 24 hourly offer stacks | 1 day, ~1.7 MB | ? | later |
| Asset list | `assetlist-api/v1/assetlist` | none | 3,752 assets | n/a | n/a | later |
| Pool participant list | `poolparticipant-api/v1/poolparticipantlist` | none | 411 participants | n/a | n/a | not needed |
| Metered volumes | `meteredvolume-api/v1/meteredvolume/details` | startDate, endDate, [asset_ID], [pool_participant_ID] | hourly MWh per asset | ? | ? | **returns `[]` for every date and filter we tried** (2024, 2025, 2026; with and without asset filters). Possibly a separate product or participant-only data. Not needed for v1. |
| `currentsupplydemand-api/v1/csd/summary/current`, `systemmarginalprice-api/v1.1/price/currentSystemMarginalPrice` | | | | | | 404; the v2 summary and the ranged SMP report replace them |

### Pool price report

Fields per row: `begin_datetime_utc`, `begin_datetime_mpt`, `pool_price`, `forecast_pool_price`, `rolling_30day_avg`. Dollars per MWh, two decimals.

- Rows exist through the hour after the current one. For the current hour and the next, `pool_price` and `rolling_30day_avg` are `""` and only `forecast_pool_price` is filled. So the pool price forecast is only one to two hours ahead.
- The price for hour H appears shortly after H ends. At 22:21 MPT the 21:00 row was final and the 22:00 row was empty. Run the hourly job a few minutes past the hour.
- Range observed: 0.00 to 999.99 in every year, **except 2012 and 2013, which contain hours at exactly 1000.00**. Treat the cap as data, not as a validation rule.
- Completeness: every year 2000 to 2025 has exactly the expected number of rows (8,760 or 8,784), no duplicate UTC stamps, no empty values. 2026 to 7 October: 6,719 rows (6,720 hours minus the spring-forward hour).

### Actual forecast report (Alberta internal load)

Fields: `begin_datetime_utc`, `begin_datetime_mpt`, `alberta_internal_load`, `forecast_alberta_internal_load`. Integer MW.

- Forecast extends about **14 days** ahead (rows through 2026-10-21 23:00 when asked on 2026-10-08, regardless of a later `endDate`). Actuals are `""` for the current hour onward.
- Range: 4,999 MW (2000) to 12,785 MW (December 2025, the record). Completeness identical to the pool price report.
- Because forecast rows change as the AESO revises them, re-pulling the last two weeks on every run and upserting is the right pattern.

### System marginal price report

Fields: `begin_datetime_utc`, `end_datetime_utc`, `begin_datetime_mpt`, `end_datetime_mpt`, `system_marginal_price`, `volume`.

- One row per price change: about 100 to 125 rows a day, 3,769 rows and 770 KB for September 2026. A full history is roughly 1.2 million rows and 250 MB of JSON, pulled in 183-day pages (54 calls).
- `volume` is the MW of the marginal block; `""` in the 2000 sample.
- Descending order within a response.

### Current supply and demand (v2 summary)

A single live object: `effective_datetime_utc/mpt`, `total_max_generation_capability`, `total_net_generation`, `net_to_grid_generation`, `net_actual_interchange`, `alberta_internal_load`, contingency reserve fields, `generation_data_list` (one row per fuel type: COGENERATION, COMBINED CYCLE, ENERGY STORAGE, GAS FIRED STEAM, HYDRO, OTHER, SIMPLE CYCLE, SOLAR, WIND with `aggregated_maximum_capability` and `aggregated_net_generation`), `interchange_list` (British Columbia, Montana, Saskatchewan with `actual_flow`).

Snapshot only. If the hourly job stores one snapshot per run, the project builds its own generation-by-fuel history from launch onward. Not done in v1.

### Generation capability (AIESGenCapacity)

One element per fuel and sub-fuel (GAS has COGENERATION, COMBINED_CYCLE, SIMPLE_CYCLE, GAS_FIRED_STEAM), each with 24 `Hours` carrying `outage_grouping` {`MC` maximum capability, `AC` available capability, `OP OUT` operational outage, `MBO OUT` mothball outage} in MW. This is capability and outages, **not** output. 31-day cap, history from 2011.

### Energy merit order

`startDate` only. `return.data` holds 24 hourly objects (`begin_dateTime_utc`, `begin_dateTime_mpt`, note the camel-case difference) each with about 300 `energy_blocks` (`asset_ID`, `block_number`, `block_price`, `from_MW`, `to_MW`, `block_size`, `available_MW`, `dispatched?`, `dispatched_MW`, `flexible?`, `offer_control`, `import_or_export`). 1 July 2026 was available; 1 September 2026 returned 400 `"No Data available for this day."` on 8 October, consistent with the documented 60-day publication lag.

## Daylight saving

Verified on the two 2025 transition days.

- Fall back (2025-11-02): 25 rows. `begin_datetime_mpt` shows `01:00` twice (UTC 07:00 and 08:00).
- Spring forward (2025-03-09): 23 rows. There is no `02:00` local row.

So `begin_datetime_mpt` is not unique and must not be a key. Key on UTC, filter on MPT, exactly as the README's data model proposes. Full years net out to 8,760 or 8,784 rows.

## Historical generation by fuel type (README open question)

**No API endpoint returns it.** The API has only the live snapshot (CSD) and capability/outage history. AESO publishes the history as static files instead:

1. **Historical Generation Data (CSD)**, https://www.aeso.ca/market/market-and-system-reporting/data-requests/historical-generation-data/ . A Box folder (https://aeso.box.com/s/qofgn9axnnw6uq3ip1goiq2ngb11txe5, no account needed) with monthly files of per-asset average MW at 1-hour and 5-minute resolution, same source as the live CSD page. Updated monthly. Operational data, not settlement. Per-asset rows need the asset-to-fuel mapping (fuel type is in the files and in the CSD assets endpoint).
2. **Hourly Generation Metered Volumes and Pool Price and AIL, 2001 to July 2025**, https://www.aeso.ca/market/market-and-system-reporting/data-requests/hourly-generation-metered-volumes-and-pool-price-and-ail-data-2001-to-july-2025/ . Three CSVs (2001 to 2009, 42 MB; 2010 to 2019, 67 MB; 2020 to July 2025, 52 MB) of settlement metered volumes for generators over 5 MW. Wide format: `Date_Begin_GMT`, `Date_Begin_Local`, then one column per asset code (`AIG1`, `APS1`, ...) with hourly MWh; pool price and AIL columns at the far right. The 2010 to 2019 file uses `1/1/2010 7:00` dates, the other two use `2001-01-01 7:00`. Asset codes must be mapped to fuel types (the CSD assets endpoint has the mapping for current assets). AESO says no further updates are planned. April to July 2025 not final.
3. **Hourly Metered Volumes by Generation Type**, November 2012 to November 2017 only, one xlsx with known data errors. Not useful.

Recommendation: leave generation out of v1 (the README already says "if time allows"). If it is added later, option 1 plus hourly CSD snapshots going forward is the sustainable path; option 2 is a one-off backfill.

## What v1 should load

Three or four endpoints, as the README asked:

1. Pool price (hourly). Matches the README `pool_price` table column for column.
2. Alberta internal load, actual and forecast (hourly). Matches `system_load`.
3. System marginal price, if time allows. Different grain (intervals with begin and end), so it needs its own table keyed on `begin_utc` with an `end_utc` column; 183-day paging.
4. Optional: one CSD summary snapshot per hourly run, for a "live grid" trust strip and to start a fuel-mix history.

Backfill size: 27 calls per hourly report (one per year, 2000 to 2026), about 236,000 rows each; a few seconds of API time in total. SMP: 54 calls, about 1.2 million rows.

Ingestion notes for step 3:

- Convert `""` to NULL and strings to numerics at load time.
- `begin_utc` = `begin_datetime_utc` interpreted as UTC; `begin_mpt` = `begin_datetime_mpt` as a naive local timestamp. Both come straight from the API; no conversion in our code.
- Re-pull a trailing window on every run (at least the last 15 days for load, because of the forecast horizon; the last 2 days for price) and upsert on `begin_utc`.
- No automated tests in this repo (a project decision), so no saved fixtures. Check ingestion by running the commands against the live API and comparing row counts with the expectations above (8,760 or 8,784 rows per full year).

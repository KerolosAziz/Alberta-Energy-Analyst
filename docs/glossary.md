# Glossary

Plain-language definitions of the market terms used in this project, with a note on how each one shows up in the data where that applies. Written in October 2026 from the AESO API responses and public AESO material. The Info page's dotted terms carry a shorter version of a few entries; keep the two consistent.

## The market

**AESO (Alberta Electric System Operator).** The not-for-profit that runs the Alberta grid and the wholesale electricity market, and publishes the data this project uses.

**AIES (Alberta Interconnected Electric System).** The province-wide grid the AESO operates. Appears in API names such as `AIESGenCapacity`.

**Energy-only market.** Alberta's wholesale market design through 2026: generators are paid only for the energy they produce, at the pool price, with no separate payment for being available. The AESO is building a restructured market due to start in 2027.

**Pool price.** The hourly wholesale price of electricity in Alberta, in Canadian dollars per megawatt-hour ($/MWh). It is set after each hour as the time-weighted average of the system marginal prices during that hour. Every generator that produced in the hour is paid this price. Floor $0, cap $999.99.
*In the data:* `pool_price` in the pool price report, one row per hour.

**System marginal price (SMP).** The price of the last offer block the AESO dispatched to meet demand at a given minute. It changes whenever dispatch changes, so there are many values per hour; the pool price is their time-weighted average.
*In the data:* `system_marginal_price` and `volume` (MW of the marginal block) in the system marginal price report, one row per interval with begin and end times.

**Forecast pool price.** The AESO's short-term forecast of the pool price for an hour, published before the hour.
*In the data:* `forecast_pool_price`, present for the next hour or two beyond the current hour.

**Rolling 30-day average.** The average pool price over the previous 30 days, as published by the AESO alongside each hour.
*In the data:* `rolling_30day_avg`.

**Merit order.** All the offers to generate for an hour, sorted from cheapest to most expensive. The AESO dispatches from the bottom up until supply meets demand; the price of the last block dispatched is the system marginal price. Published with a lag of about two months.
*In the data:* the energy merit order report, one call per day, 24 hourly sets of offer blocks (not loaded in v1).

**Offer, block.** A generator's offer to produce a quantity of power (a block, in MW) at a price. A single asset can offer several blocks at different prices.

**Price cap and floor.** The pool price is bounded between $0 and $999.99/MWh. Note: the published data for 2012 and 2013 contains hours at exactly 1000.00.

## Demand and supply

**Alberta internal load (AIL).** The total electricity demand inside Alberta in a given hour, in megawatts (MW). The record is 12,785 MW, set in December 2025.
*In the data:* `alberta_internal_load` in the actual forecast report, one row per hour; integer MW.

**Forecast AIL.** The AESO's forecast of internal load for an hour. Published up to about two weeks ahead.
*In the data:* `forecast_alberta_internal_load`.

**Generation, net generation.** Power produced by a plant, measured at the point it enters the grid, after the plant's own use. Reported in MW (a rate) for operational data and MWh (an amount) for settlement data.

**Fuel type.** The AESO's grouping of generators: gas (further split into cogeneration, combined cycle, simple cycle and gas-fired steam), wind, solar, hydro, energy storage, and other (biomass, waste heat and similar). Alberta's last coal unit converted to gas in 2024, so coal no longer appears in current data.

**Current supply and demand (CSD).** The AESO's live snapshot of the grid: total generation by fuel type, load, interchange, reserves, and each generating asset's current output. Snapshot only; history is published separately as monthly files.

**Maximum capability (MC), available capability (AC).** MC is the most a plant can produce; AC is what it can produce right now after outages and derates.

**Intertie, interchange.** The transmission links to British Columbia, Saskatchewan and Montana, and the power flowing over them. Imports count as supply in Alberta; exports count as demand.

**Operating reserve, contingency reserve.** Capacity the AESO keeps in hand to cover a sudden loss of a generator or an intertie. Reported in MW as required and dispatched amounts.

**Supply cushion.** How much available supply exceeds demand plus reserves at a given time. A thin cushion is when prices spike and the AESO issues alerts.

**Energy emergency alert (EEA).** The AESO's escalating warnings (levels 1 to 3) when supply is short. January 2024 reached level 3, with a public appeal to cut use.

**Dispatch.** The AESO's instruction to a generator to produce a given amount. "Dispatched MW" in merit order data is what was actually called on.

## Time

**Hour beginning.** The AESO API timestamps every hourly row with the time the hour *begins*. AESO's older ETS reports and most market talk use *hour ending* (HE 1 to HE 24). HE 1 is the hour beginning 00:00.
*In the data:* `begin_datetime_utc` and `begin_datetime_mpt`.

**MPT (Mountain Prevailing Time).** Alberta local time: Mountain Standard Time (UTC−7) in winter and Mountain Daylight Time (UTC−6) in summer. The AESO's local-time column follows the clock, so the fall-back day has 25 rows with the 01:00 hour repeated, and the spring-forward day has 23 rows with no 02:00 hour.
*In the data:* `begin_datetime_mpt`. Use it for questions about days, months and times of day.

**UTC.** Universal time, no daylight saving. Every hour has a unique UTC timestamp, which is why rows are keyed on it.
*In the data:* `begin_datetime_utc`. Use it as the primary key and for durations.

**Report day.** The API's `startDate` and `endDate` are Alberta local calendar days, inclusive on both ends.

## Units

**MW (megawatt).** A rate of power. Load and generation at an instant or averaged over an interval.

**MWh (megawatt-hour).** An amount of energy: one MW sustained for one hour. Hourly MW averages and hourly MWh are numerically equal.

**$/MWh.** Dollars per megawatt-hour, the unit of the pool price and the system marginal price. A home uses roughly 7 MWh a year, so $100/MWh is about 10 cents per kilowatt-hour.

## Participants and retail

**Asset.** A registered generator or load on the grid, identified by a short code (for example `ACD1`). The asset list has about 3,750 entries, including retired ones.

**Pool participant.** A company registered to trade in the market. Each asset belongs to one participant; some participants act through agents.

**Metered volume.** Settlement-quality measurement of what an asset produced or consumed in an hour, in MWh. Published later than operational data. The API's metered volume report returned no rows for any date we tried.

**Rate of Last Resort (RLR).** The default regulated retail price for customers without a contract, renamed from the Regulated Rate Option (RRO) in 2025 and now set for two years at a time.

**Competitive retailer.** A company that buys power from the market and sells it to customers on fixed or variable contracts.

**AUC (Alberta Utilities Commission).** The regulator that approves new facilities and sets transmission and distribution rates.

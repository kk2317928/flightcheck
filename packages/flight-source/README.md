# Flight source contracts

`@flightcheck/flight-source` is the boundary between external airport data and FlightCheck domain logic.

- `RawAirportFlight` preserves untrusted source text for the parser implemented in T-007.
- `NormalizedFlight` contains parser-independent, typed values consumed by synchronization and domain services.
- `FlightSourceFetchResult` distinguishes complete, partial and failed observations. A failed result contains no flights, so downstream code cannot interpret a source outage as an empty airport board.
- `FlightSourceAdapter` hides HTTP and HTML parsing from consumers.
- `MacauAirportHttpClient` fetches the official Departures and Arrivals boards with a per-attempt timeout, bounded retries and explicit complete/partial/failed document results.

The client records `fetchedAt` after each successful response and converts the board's Macau-local `Last updated on` value to the UTC `sourceUpdatedAt` instant. A failed direction never produces an empty successful document. Sanitized structural fixtures live under `fixtures/macau-airport`; flight-row parsing remains the responsibility of T-007.

Flight numbers remain strings throughout the boundary, including suffixes such as `NX862D`. All timestamps are JavaScript `Date` values representing UTC instants; `serviceDate` is the Macau-local calendar date in `YYYY-MM-DD` form.

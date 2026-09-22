# Flight source contracts

`@flightcheck/flight-source` is the boundary between external airport data and FlightCheck domain logic.

- `RawAirportFlight` preserves untrusted source text for the parser implemented in T-007.
- `NormalizedFlight` contains parser-independent, typed values consumed by synchronization and domain services.
- `FlightSourceFetchResult` distinguishes complete, partial and failed observations. A failed result contains no flights, so downstream code cannot interpret a source outage as an empty airport board.
- `FlightSourceAdapter` hides HTTP and HTML parsing from consumers.
- `MacauAirportHttpClient` fetches the official Departures and Arrivals boards with a per-attempt timeout, bounded retries and explicit complete/partial/failed document results.

The client records `fetchedAt` after each successful response and converts the board's Macau-local `Last updated on` value to the UTC `sourceUpdatedAt` instant. A failed direction never produces an empty successful document. Sanitized structural fixtures live under `fixtures/macau-airport`.

`MacauAirportFlightSource` composes the HTTP client with the fixture-driven Cheerio parser. It keeps only Air Macau (`NX`) rows, resolves known airport names through a local IATA dictionary, interprets Macau-local scheduled and operational times as UTC instants, normalizes source statuses, and deduplicates by service date, direction and flight number. Delay-until timestamps cannot precede the scheduled instant; conflicting duplicates are suppressed instead of choosing an arbitrary status. Unknown airports/statuses, ambiguous times, malformed or structurally unrecognized rows, duplicates, and missing service-date coverage produce structured warnings rather than guessed values. Any such warning or a missing board direction makes the observation `PARTIAL`.

Flight numbers remain strings throughout the boundary, including suffixes such as `NX862D`. All timestamps are JavaScript `Date` values representing UTC instants; `serviceDate` is the Macau-local calendar date in `YYYY-MM-DD` form.

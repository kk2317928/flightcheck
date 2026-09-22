# Flight source contracts

`@flightcheck/flight-source` is the boundary between external airport data and FlightCheck domain logic.

- `RawAirportFlight` preserves untrusted source text for the parser implemented in T-007.
- `NormalizedFlight` contains parser-independent, typed values consumed by synchronization and domain services.
- `FlightSourceFetchResult` distinguishes complete, partial and failed observations. A failed result contains no flights, so downstream code cannot interpret a source outage as an empty airport board.
- `FlightSourceAdapter` hides HTTP and HTML parsing from consumers.

Flight numbers remain strings throughout the boundary, including suffixes such as `NX862D`. All timestamps are JavaScript `Date` values representing UTC instants; `serviceDate` is the Macau-local calendar date in `YYYY-MM-DD` form.

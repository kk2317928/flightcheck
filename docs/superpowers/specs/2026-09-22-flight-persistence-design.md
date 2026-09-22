# T-008 Flight Persistence Design

Date: 2026-09-22  
Status: Approved architecture; implementation pending  
Branch: `feat/t-008-flight-persistence`

## Purpose

Persist normalized airport observations as durable flight records, flight instances, immutable snapshots, and explicit status transitions. The persistence layer must be replay-safe, preserve arrival/departure separation, and commit each observation batch atomically.

## Scope

T-008 delivers a database-facing `FlightObservationRepository` that:

- upserts `Flight` and `FlightInstance` records from normalized observations;
- updates only mutable observation fields on an existing instance;
- stores a `Snapshot` only when the material payload changes;
- records operational/performance status history only for real transitions;
- persists source warnings on the associated `ScrapeRun`; and
- performs each batch operation within one Prisma transaction.

## Non-goals

- Deriving operational or performance status from source data. T-009 owns these rules.
- Creating or scheduling scrape runs. T-010 owns orchestration.
- Treating fetch time, observation time, or run metadata as a material flight change.
- Adding a warning table. Warnings remain structured JSON on `ScrapeRun`.
- Changing the Prisma schema unless implementation exposes a proven schema gap.

## Public Interface

The database package exposes a repository with two explicit operations:

```ts
interface FlightObservationRepository {
  persistObservationBatch(
    input: PersistObservationBatchInput,
  ): Promise<PersistObservationBatchResult>;
  recordStatusTransition(
    input: RecordStatusTransitionInput,
  ): Promise<StatusTransitionResult>;
}
```

The observation input contains:

- `scrapeRunId`: the existing run receiving warning metadata;
- `observedAt`: the timestamp shared by the batch;
- `flights`: normalized flights from the source adapter;
- `warnings`: structured `FlightSourceWarning[]` emitted by parsing/normalization.

The result reports counts for processed instances, inserted snapshots, unchanged snapshots, and persisted warnings. It does not expose Prisma models as the public contract.

`recordStatusTransition` accepts a flight-instance identifier, the expected operational/performance/delay state evaluated by T-009, the target state, a reason, and `observedAt`. Its result indicates whether a transition was written. An expected-state mismatch rejects stale policy work unless the requested target is already current.

## Flight Identity

`Flight` is identified by normalized `flightNumber`.

`FlightInstance` uses the existing database natural key:

```text
(flightId, serviceDate, direction, scheduledAt)
```

This key intentionally includes `direction`, so an arrival and a departure with the same flight number, service date, and scheduled time cannot merge. `serviceDate` is stored as the normalized service-day value and `scheduledAt` as the normalized scheduled instant.

For directional schedule fields:

- arrival observations populate `scheduledArrivalAt`;
- departure observations populate `scheduledDepartureAt`;
- the field for the opposite direction remains unset unless later domain requirements explicitly provide it.

## Mutable Observation Fields

On every successful observation, the repository updates only source-observed mutable fields:

- `estimatedAt`;
- `actualAt`;
- origin and destination airport codes;
- `lastObservedAt`.

Observation persistence does not overwrite cancellation flags, cancellation timestamps, operational status, performance status, delay minutes, or other T-009-owned derived values.

## Canonical Snapshot and Hashing

Snapshots preserve a canonical material payload. The repository constructs the payload itself rather than hashing arbitrary caller JSON.

The canonical payload contains:

- normalized flight number;
- service date;
- direction;
- scheduled timestamp;
- estimated timestamp or `null`;
- actual timestamp or `null`;
- origin `{ code, name }`;
- destination `{ code, name }`;
- normalized source status;
- raw source status.

All dates are encoded as ISO-8601 UTC strings. Object keys are serialized in a deterministic order, `undefined` is normalized away or to the field's defined `null` representation, and SHA-256 of the resulting UTF-8 JSON becomes `payloadHash`.

The hash excludes `observedAt`, fetch timestamps, scrape-run identifiers, and other ingestion metadata. Replaying the same material payload therefore resolves to the same `(flightInstanceId, payloadHash)` unique key and creates no new snapshot.

When any canonical material field changes, exactly one snapshot is inserted for the new hash. The database unique constraint is the concurrency authority; implementation must not rely solely on a check-then-create sequence.

## Observation Transaction

`persistObservationBatch` opens one Prisma transaction and performs the following work:

1. Validate that the referenced `ScrapeRun` exists.
2. For each normalized observation, upsert its `Flight`.
3. Upsert the `FlightInstance` using the natural key and update mutable observation fields.
4. Build the canonical payload and insert its snapshot if the instance/hash pair does not already exist.
5. Replace the run's warning JSON with the supplied structured warning array and set `warningCount` to its length.
6. Commit and return aggregate counts.

Any failure rolls back flight, instance, snapshot, and warning changes together. An invalid or missing run ID is an error rather than permission to write orphaned observations.

Snapshot insertion uses the unique constraint with a race-safe Prisma mechanism, such as `createMany({ skipDuplicates: true })` where supported. The implementation must derive inserted/unchanged counts from the database result rather than a preflight existence check.

## Warning Persistence

Warnings are stored on `ScrapeRun.warnings` as the structured `FlightSourceWarning[]` contract from the source layer. `ScrapeRun.warningCount` always equals the stored array length, including zero. Reprocessing the run replaces warning metadata rather than appending duplicates.

## Status Transitions

`recordStatusTransition` is persistence-only. T-009 calculates the target state and reason.

Within one transaction, the repository locks or conditionally updates the current `FlightInstance`, compares all persisted status dimensions, and:

- returns `changed: false` without a history row when the target values equal the current values; or
- updates the instance and inserts one `FlightStatusHistory` row containing the previous values, new values, reason, and observation timestamp.

The comparison includes operational status, performance status, and delay minutes. Cancellation-specific fields remain governed by the T-009 policy and are changed only when explicitly included in the transition contract.

Concurrent calls must not produce duplicate transitions from the same prior state. A conditional update compares the caller's expected state; if another transition wins, an identical target is deduplicated and a different stale target is rejected for policy recomputation.

## Error Contract

Repository errors retain their cause and add operation context. Expected failures include:

- missing `ScrapeRun`;
- missing `FlightInstance` for a status transition;
- invalid normalized input that violates the repository contract;
- transaction or database constraint failures.

Partial success is not returned for a failed batch.

## Testing Strategy

T-008 requires integration tests against the configured test database for transaction and constraint behavior, plus focused unit tests for canonicalization.

Required cases:

1. Persisting a new observation creates its flight, instance, and one snapshot.
2. Replaying an identical material payload creates no additional snapshot.
3. Changing one material field creates exactly one additional snapshot.
4. Arrival and departure observations on the same date remain separate instances.
5. Updating an observation preserves T-009-owned status fields.
6. A batch failure rolls back all flight, instance, snapshot, and warning writes.
7. Warnings replace the run JSON and keep `warningCount` consistent.
8. An unchanged status request creates no history.
9. A changed status request updates the instance and creates exactly one history row.
10. Canonical serialization is stable across object construction order and metadata-only changes.
11. Concurrent identical snapshot attempts remain idempotent.

## Handoff to Later Tasks

- T-009 supplies status classification and calls `recordStatusTransition` with an explicit target state.
- T-010 creates the `ScrapeRun`, invokes source acquisition/normalization, then calls `persistObservationBatch` with that run ID.
- Later APIs query the persisted models; they do not need to understand source parser payloads.

## Acceptance Mapping

| Requirement                          | Design mechanism                                             |
| ------------------------------------ | ------------------------------------------------------------ |
| Identical replay creates no snapshot | Canonical material hash plus instance/hash unique constraint |
| Material change creates one snapshot | Deterministic canonical payload and race-safe insert         |
| Arrival/departure do not merge       | Direction is part of the instance natural key                |
| Status history tracks real changes   | Compare-and-write transition transaction                     |
| Warnings are durable                 | Structured JSON and count on the referenced scrape run       |
| Batch writes are consistent          | One Prisma transaction with rollback on any failure          |

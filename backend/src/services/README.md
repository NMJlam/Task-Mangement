# services/

Business logic lives here — one module per domain area (tasks, teams, events,
audit). Routes stay thin: they wire middleware and call a service. Services own
the db access (via `httpDb()` on request paths) and are the unit-test seam.

Empty for now — populated in Increment 1 as R1–R15 land. `TODO(Rn)`.

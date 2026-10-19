# Activity index qualification

Status: validation in progress on `feature/background-activity-index`. No publication, deployment or production benchmarks. Final measured results will replace this working record before review.

The first separate commit synchronizes current documentation with published v0.5.2. The design and backend are separate commits. Existing protection/approval services and standalone loading are unchanged.

## Observed failures and corrections

- The first official browser run found an assertion that counted every checked input rather than the status-filter controls. The new older-interest checkbox exposed that invalid selector. Restricting the selector to `.watchguard-filter input:checked` preserves the original zero/three status assertions.
- The second complete official-image run passed settings/preferences, the existing native browser deletion and cancellation paths, and uninstall checks. Newer focused changes still require final qualification.
- The first native benchmark attempt could not download the baseline through this machine's Python certificate configuration. It produced no comparison result. The fixture now uses verified TLS through `curl`, retaining mandatory SHA-256 verification and downloading before expensive seeding. No insecure certificate bypass was added.

Unit and browser-model results are not native SQL timing claims. The user-supplied production observation remains separate from these fixtures.
- The second native run completed population but its one-second readiness polling allocated full result snapshots, exhausting the eight-per-account pagination quota. The assertion correctly failed at 25 results with `PaginationCapacity`. A separate authenticated `/ActivityIndex/Status` endpoint now reports scoped progress without allocating snapshots or querying episodes; fixtures use that endpoint. The quota was not increased.

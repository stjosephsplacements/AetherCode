# Assessment migrations

Apply paired migrations with `aether_assessment_migrator`:

```sh
make migrate SVC=assessment DIR=up
```

`000008_authorization_projection_resync` adds the target-bound recovery
request, durable item ledger, and projection-ready RLS gate. The dedicated
`aether_assessment_projection_worker` is the only runtime role with the
narrow state/item and function privileges; an incomplete batch remains denied.

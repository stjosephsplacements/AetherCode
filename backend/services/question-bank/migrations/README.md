# Question Bank migrations

Run paired migrations with the dedicated `aether_question_bank_migrator`:

```sh
make migrate SVC=question-bank DIR=up
```

`000004_authorization_projection_resync` installs the shared complete-grant
snapshot inbox and a global-scope recovery gate. Only
`aether_question_bank_projection_worker` can apply snapshots, persist resync
items, or invoke the target-bound outbox request function. Question Bank opens
global RLS only after a User-issued count/SHA-256 manifest verifies.

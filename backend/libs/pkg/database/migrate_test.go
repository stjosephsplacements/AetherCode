package database

import "testing"

func TestMigrationLedgerIdentityValidate(t *testing.T) {
	valid := migrationLedgerIdentity{
		migratorName:       "aether_submission_migrator",
		migratorIdentifier: "aether_submission_migrator",
		ownerName:          "aether_submission_owner",
		ownerIdentifier:    "aether_submission_owner",
		migratorCanLogin:   true,
		canAssumeOwner:     true,
		ownerCanCreate:     true,
	}

	tests := []struct {
		name     string
		identity migrationLedgerIdentity
		wantErr  bool
	}{
		{name: "valid dedicated migrator", identity: valid},
		{
			name: "same owner and migrator",
			identity: func() migrationLedgerIdentity {
				identity := valid
				identity.migratorName = identity.ownerName
				return identity
			}(),
			wantErr: true,
		},
		{
			name: "non-login migrator",
			identity: func() migrationLedgerIdentity {
				identity := valid
				identity.migratorCanLogin = false
				return identity
			}(),
			wantErr: true,
		},
		{
			name: "migrator bypasses RLS",
			identity: func() migrationLedgerIdentity {
				identity := valid
				identity.migratorBypassRLS = true
				return identity
			}(),
			wantErr: true,
		},
		{
			name: "login owner",
			identity: func() migrationLedgerIdentity {
				identity := valid
				identity.ownerCanLogin = true
				return identity
			}(),
			wantErr: true,
		},
		{
			name: "migrator cannot assume owner",
			identity: func() migrationLedgerIdentity {
				identity := valid
				identity.canAssumeOwner = false
				return identity
			}(),
			wantErr: true,
		},
		{
			name: "owner cannot create ledger",
			identity: func() migrationLedgerIdentity {
				identity := valid
				identity.ownerCanCreate = false
				return identity
			}(),
			wantErr: true,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := test.identity.validate()
			if (err != nil) != test.wantErr {
				t.Fatalf("validate() error = %v, want error = %t", err, test.wantErr)
			}
		})
	}
}

func TestValidateMigrationLedgerURL(t *testing.T) {
	tests := []struct {
		name    string
		url     string
		wantErr bool
	}{
		{name: "postgres URL", url: "postgres://migrator:password@localhost:5432/aether_submission?sslmode=disable"},
		{name: "postgresql URL", url: "postgresql://migrator:password@localhost:5432/aether_submission?sslmode=disable"},
		{name: "non PostgreSQL URL", url: "mysql://migrator:password@localhost/aether_submission", wantErr: true},
		{name: "custom migration table", url: "postgres://migrator:password@localhost/aether_submission?x-migrations-table=custom", wantErr: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := validateMigrationLedgerURL(test.url)
			if (err != nil) != test.wantErr {
				t.Fatalf("validateMigrationLedgerURL() error = %v, want error = %t", err, test.wantErr)
			}
		})
	}
}

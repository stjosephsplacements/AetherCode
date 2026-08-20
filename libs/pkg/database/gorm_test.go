package database

import (
	"context"
	"testing"

	centralauthz "github.com/aethercode/aethercode/libs/pkg/authz"
)

func TestOpenORMRejectsNilPool(t *testing.T) {
	if _, err := OpenORM(nil); err == nil {
		t.Fatal("OpenORM() accepted a nil pgx pool")
	}
}

func TestWithTenantGormTxRejectsUninitializedORM(t *testing.T) {
	if err := WithTenantGormTx(context.Background(), nil, centralauthz.Capability{}, func(*GormDB) error {
		return nil
	}); err == nil {
		t.Fatal("WithTenantGormTx() accepted an uninitialized ORM")
	}
}

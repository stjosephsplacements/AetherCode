package database

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	centralauthz "github.com/aethercode/aethercode/libs/pkg/authz"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// GormDB is an alias used by service adapters for ordinary model persistence.
// It is never used to create schemas: service-owned paired migrations remain
// the sole schema authority.
type GormDB = gorm.DB

// ORM provides GORM over the existing pgx pool. The database/sql wrapper has
// no idle connections of its own, so pgx remains the sole connection-pool
// owner and continues enforcing its configured global limit.
type ORM struct {
	db    *gorm.DB
	sqlDB *sql.DB
}

// OpenORM opens a quiet GORM facade backed by an existing pgx pool. It neither
// runs AutoMigrate nor creates a second PostgreSQL connection pool.
func OpenORM(pool *pgxpool.Pool) (*ORM, error) {
	if pool == nil {
		return nil, fmt.Errorf("PostgreSQL pool is required for ORM")
	}

	sqlDB := stdlib.OpenDBFromPool(pool)
	db, err := gorm.Open(postgres.New(postgres.Config{
		Conn:                 sqlDB,
		PreferSimpleProtocol: true,
	}), &gorm.Config{
		DisableForeignKeyConstraintWhenMigrating: true,
		Logger:                                   logger.Default.LogMode(logger.Silent),
		PrepareStmt:                              false,
		SkipDefaultTransaction:                   true,
	})
	if err != nil {
		_ = sqlDB.Close()
		return nil, fmt.Errorf("open GORM PostgreSQL facade: %w", err)
	}
	return &ORM{db: db, sqlDB: sqlDB}, nil
}

// Close releases the database/sql facade. It does not close the shared pgx
// pool, whose lifecycle remains owned by the calling service.
func (orm *ORM) Close() error {
	if orm == nil || orm.sqlDB == nil {
		return nil
	}
	return orm.sqlDB.Close()
}

// Ping proves the ORM facade can acquire a connection from its shared pool.
func (orm *ORM) Ping(contextValue context.Context) error {
	if orm == nil || orm.sqlDB == nil {
		return fmt.Errorf("ORM is not initialized")
	}
	if err := orm.sqlDB.PingContext(contextValue); err != nil {
		return fmt.Errorf("ping ORM PostgreSQL facade: %w", err)
	}
	return nil
}

// WithTenantGormTx applies the same signed, transaction-scoped RLS context as
// WithTenantTx, then provides a GORM transaction for ordinary persistence.
// It deliberately retains raw invocation of authz.set_context because that
// database-owned verification binds the capability to this exact backend and
// transaction; an ORM must not emulate or bypass that control.
func WithTenantGormTx(
	contextValue context.Context,
	orm *ORM,
	capability centralauthz.Capability,
	fn func(*GormDB) error,
) error {
	if orm == nil || orm.db == nil {
		return fmt.Errorf("ORM is not initialized")
	}
	if fn == nil {
		return fmt.Errorf("GORM tenant transaction callback is required")
	}
	if err := capability.ValidateAt(time.Now()); err != nil {
		return err
	}

	return orm.db.WithContext(contextValue).Transaction(func(transaction *gorm.DB) error {
		var tenantID any
		if capability.TenantID != "" {
			tenantID = capability.TenantID
		}
		if err := transaction.Exec(`
			SELECT authz.set_context($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		`, capability.ActorID, tenantID, capability.AuthzRevision,
			capability.Decision, capability.CapabilityID, capability.Action, capability.Resource,
			capability.IssuedAt.UTC(), capability.ExpiresAt.UTC(), capability.KeyID, capability.Signature).Error; err != nil {
			return fmt.Errorf("set signed transaction authorization context: %w", err)
		}
		return fn(transaction)
	})
}

// IsORMNotFound keeps service error mapping independent of the selected ORM.
func IsORMNotFound(err error) bool {
	return errors.Is(err, gorm.ErrRecordNotFound)
}

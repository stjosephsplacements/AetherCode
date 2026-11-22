package repo

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	apperrors "github.com/stjosephsplacements/AetherCode/libs/pkg/errors"
	"github.com/stjosephsplacements/AetherCode/services/tenant/internal/app"
)

func (repository *Postgres) GetBranding(contextValue context.Context, transaction pgx.Tx, tenantID *string) (app.BrandingView, error) {
	row := transaction.QueryRow(contextValue, `
		SELECT tenant_id::text, app_name, accent_color, updated_by::text, updated_at
		FROM tenant.branding
		WHERE tenant_id IS NOT DISTINCT FROM $1::uuid
	`, tenantID)
	var view app.BrandingView
	var rowTenantID *string
	var appName string
	var accent *string
	var updatedBy *string
	var updatedAt sql.NullTime
	if err := row.Scan(&rowTenantID, &appName, &accent, &updatedBy, &updatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			view.TenantID = tenantID
			logos, err := repository.listBrandingLogos(contextValue, transaction, tenantID)
			if err != nil {
				return app.BrandingView{}, err
			}
			view.Logos = logos
			return view, nil
		}
		return app.BrandingView{}, err
	}
	if appName != "" {
		view.AppName = &appName
	}
	view.AccentColor = accent
	view.TenantID = rowTenantID
	view.UpdatedBy = updatedBy
	if updatedAt.Valid {
		view.UpdatedAt = &updatedAt.Time
	}
	logos, err := repository.listBrandingLogos(contextValue, transaction, tenantID)
	if err != nil {
		return app.BrandingView{}, err
	}
	view.Logos = logos
	return view, nil
}

func (repository *Postgres) UpsertBranding(contextValue context.Context, transaction pgx.Tx, command app.UpsertBranding) (app.BrandingView, error) {
	_, err := transaction.Exec(contextValue, `
		INSERT INTO tenant.branding (tenant_id, app_name, accent_color, updated_by)
		VALUES ($1::uuid, $2, $3, $4::uuid)
		ON CONFLICT (tenant_id) DO UPDATE
		SET app_name = EXCLUDED.app_name,
		    accent_color = EXCLUDED.accent_color,
		    updated_by = EXCLUDED.updated_by,
		    updated_at = clock_timestamp()
	`, command.TenantID, command.AppName, command.AccentColor, command.UpdatedBy)
	if err != nil {
		return app.BrandingView{}, mapWriteError(err, "branding already exists")
	}
	return repository.GetBranding(contextValue, transaction, command.TenantID)
}

func (repository *Postgres) InsertBrandingLogo(contextValue context.Context, transaction pgx.Tx, tenantID *string, logoID, updatedBy, altText, objectKey string, sha []byte, contentType string) (app.BrandingView, error) {
	count, err := countBrandingLogos(contextValue, transaction, tenantID)
	if err != nil {
		return app.BrandingView{}, err
	}
	if count >= 5 {
		return app.BrandingView{}, apperrors.New(apperrors.CodeInvalidArgument, "at most five logos are allowed")
	}
	position := int16(count)
	if _, err := transaction.Exec(contextValue, `
		INSERT INTO tenant.branding_logos (id, tenant_id, object_key, sha256, content_type, position, alt_text)
		VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7)
	`, logoID, tenantID, objectKey, sha, contentType, position, altText); err != nil {
		return app.BrandingView{}, mapWriteError(err, "branding logo already exists")
	}
	if _, err := transaction.Exec(contextValue, `
		INSERT INTO tenant.branding (tenant_id, app_name, updated_by)
		VALUES ($1::uuid, '', $2::uuid)
		ON CONFLICT (tenant_id) DO UPDATE SET updated_by = EXCLUDED.updated_by, updated_at = clock_timestamp()
	`, tenantID, updatedBy); err != nil {
		return app.BrandingView{}, fmt.Errorf("touch branding row: %w", err)
	}
	return repository.GetBranding(contextValue, transaction, tenantID)
}

func (repository *Postgres) ReorderBrandingLogos(contextValue context.Context, transaction pgx.Tx, tenantID *string, logoIDs []string) (app.BrandingView, error) {
	existing, err := repository.listBrandingLogos(contextValue, transaction, tenantID)
	if err != nil {
		return app.BrandingView{}, err
	}
	if len(existing) != len(logoIDs) {
		return app.BrandingView{}, apperrors.New(apperrors.CodeInvalidArgument, "logo order must list every current logo once")
	}
	known := make(map[string]struct{}, len(existing))
	for _, logo := range existing {
		known[logo.ID] = struct{}{}
	}
	for _, id := range logoIDs {
		if _, ok := known[id]; !ok {
			return app.BrandingView{}, apperrors.New(apperrors.CodeInvalidArgument, "unknown logo in order")
		}
	}
	for index, id := range logoIDs {
		if _, err := transaction.Exec(contextValue, `
			UPDATE tenant.branding_logos
			SET position = $3
			WHERE tenant_id IS NOT DISTINCT FROM $1::uuid AND id = $2::uuid
		`, tenantID, id, int16(index)); err != nil {
			return app.BrandingView{}, mapWriteError(err, "reorder branding logos")
		}
	}
	return repository.GetBranding(contextValue, transaction, tenantID)
}

func (repository *Postgres) DeleteBrandingLogo(contextValue context.Context, transaction pgx.Tx, tenantID *string, logoID string) (string, app.BrandingView, error) {
	var objectKey string
	err := transaction.QueryRow(contextValue, `
		DELETE FROM tenant.branding_logos
		WHERE tenant_id IS NOT DISTINCT FROM $1::uuid AND id = $2::uuid
		RETURNING object_key
	`, tenantID, logoID).Scan(&objectKey)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", app.BrandingView{}, apperrors.New(apperrors.CodeNotFound, "logo was not found")
	}
	if err != nil {
		return "", app.BrandingView{}, mapWriteError(err, "delete branding logo")
	}
	rows, err := transaction.Query(contextValue, `
		SELECT id::text
		FROM tenant.branding_logos
		WHERE tenant_id IS NOT DISTINCT FROM $1::uuid
		ORDER BY position
	`, tenantID)
	if err != nil {
		return objectKey, app.BrandingView{}, err
	}
	defer rows.Close()
	position := int16(0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return objectKey, app.BrandingView{}, err
		}
		if _, err := transaction.Exec(contextValue, `
			UPDATE tenant.branding_logos SET position = $3 WHERE tenant_id IS NOT DISTINCT FROM $1::uuid AND id = $2::uuid
		`, tenantID, id, position); err != nil {
			return objectKey, app.BrandingView{}, mapWriteError(err, "compact branding logo positions")
		}
		position++
	}
	view, err := repository.GetBranding(contextValue, transaction, tenantID)
	return objectKey, view, err
}

func countBrandingLogos(contextValue context.Context, transaction pgx.Tx, tenantID *string) (int, error) {
	var count int
	err := transaction.QueryRow(contextValue, `
		SELECT count(*) FROM tenant.branding_logos WHERE tenant_id IS NOT DISTINCT FROM $1::uuid
	`, tenantID).Scan(&count)
	return count, err
}

func (repository *Postgres) listBrandingLogos(contextValue context.Context, transaction pgx.Tx, tenantID *string) ([]app.BrandingLogo, error) {
	rows, err := transaction.Query(contextValue, `
		SELECT id::text, content_type, position, alt_text
		FROM tenant.branding_logos
		WHERE tenant_id IS NOT DISTINCT FROM $1::uuid
		ORDER BY position
	`, tenantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var logos []app.BrandingLogo
	for rows.Next() {
		var logo app.BrandingLogo
		if err := rows.Scan(&logo.ID, &logo.ContentType, &logo.Position, &logo.AltText); err != nil {
			return nil, err
		}
		logos = append(logos, logo)
	}
	return logos, rows.Err()
}
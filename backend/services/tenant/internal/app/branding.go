package app

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	centralauthz "github.com/stjosephsplacements/AetherCode/libs/pkg/authz"
	"github.com/stjosephsplacements/AetherCode/libs/pkg/database"
	apperrors "github.com/stjosephsplacements/AetherCode/libs/pkg/errors"
	"github.com/stjosephsplacements/AetherCode/libs/pkg/storage"
	"github.com/stjosephsplacements/AetherCode/services/tenant/internal/domain/branding"
)

type BrandingLogo struct {
	ID          string `json:"id"`
	URL         string `json:"url"`
	ContentType string `json:"content_type"`
	Position    int16  `json:"position"`
	AltText     string `json:"alt_text"`
}

type BrandingView struct {
	TenantID    *string        `json:"tenant_id,omitempty"`
	AppName     *string        `json:"app_name,omitempty"`
	AccentColor *string        `json:"accent_color,omitempty"`
	Logos       []BrandingLogo `json:"logos"`
	UpdatedAt   *time.Time     `json:"updated_at,omitempty"`
	UpdatedBy   *string        `json:"updated_by,omitempty"`
}

type UpsertBranding struct {
	TenantID    *string
	AppName     string
	AccentColor *string
	UpdatedBy   string
}

type UploadBrandingLogo struct {
	TenantID    *string
	LogoID      string
	AltText     string
	ContentType string
	Data        []byte
	UpdatedBy   string
}

type ReorderBrandingLogos struct {
	TenantID *string
	LogoIDs  []string
}

type DeleteBrandingLogo struct {
	TenantID *string
	LogoID   string
}

type BrandingLogoObject struct {
	TenantID    *string
	ObjectKey   string
	ContentType string
	SHA256      []byte
}

func (service *Service) PublicBranding(contextValue context.Context, tenantID *string) (BrandingView, error) {
	if tenantID != nil && !isUUID(*tenantID) {
		return BrandingView{}, apperrors.New(apperrors.CodeInvalidArgument, "tenant ID must be a UUID")
	}
	var raw []byte
	err := service.pool.QueryRow(contextValue, `SELECT tenant.public_branding($1::uuid)`, tenantID).Scan(&raw)
	if err != nil {
		return BrandingView{}, fmt.Errorf("load public branding: %w", err)
	}
	return service.materializePublicBranding(contextValue, tenantID, raw)
}

func (service *Service) GetBranding(contextValue context.Context, capability centralauthz.Capability, tenantID *string) (BrandingView, error) {
	if err := service.validateBrandingScope(tenantID); err != nil {
		return BrandingView{}, err
	}
	var result BrandingView
	err := database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		row, err := service.store.GetBranding(contextValue, transaction, tenantID)
		if err != nil {
			return err
		}
		result = row
		return nil
	})
	if err != nil {
		return BrandingView{}, err
	}
	return service.attachLogoURLs(contextValue, result)
}

func (service *Service) UpsertBranding(contextValue context.Context, capability centralauthz.Capability, command UpsertBranding) (BrandingView, error) {
	if err := service.validateBrandingScope(command.TenantID); err != nil {
		return BrandingView{}, err
	}
	name, err := branding.NormalizeAppName(command.AppName)
	if err != nil {
		return BrandingView{}, apperrors.New(apperrors.CodeInvalidArgument, err.Error())
	}
	accentInput := ""
	if command.AccentColor != nil {
		accentInput = *command.AccentColor
	}
	color, err := branding.NormalizeAccent(accentInput)
	if err != nil {
		return BrandingView{}, apperrors.New(apperrors.CodeInvalidArgument, err.Error())
	}
	if !isUUID(command.UpdatedBy) {
		return BrandingView{}, apperrors.New(apperrors.CodeInvalidArgument, "updated_by must be a UUID")
	}
	var result BrandingView
	err = database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		var err error
		result, err = service.store.UpsertBranding(contextValue, transaction, UpsertBranding{
			TenantID: command.TenantID, AppName: name, AccentColor: color, UpdatedBy: command.UpdatedBy,
		})
		return err
	})
	if err != nil {
		return BrandingView{}, err
	}
	return service.attachLogoURLs(contextValue, result)
}

func (service *Service) UploadBrandingLogo(contextValue context.Context, capability centralauthz.Capability, command UploadBrandingLogo) (BrandingView, error) {
	if service.storage == nil {
		return BrandingView{}, apperrors.New(apperrors.CodeUnavailable, "logo storage is not configured")
	}
	if err := service.validateBrandingScope(command.TenantID); err != nil {
		return BrandingView{}, err
	}
	if len(command.Data) > branding.MaxLogoBytes {
		return BrandingView{}, apperrors.New(apperrors.CodeInvalidArgument, "logo must be at most 1 MB")
	}
	if !isUUID(command.LogoID) || !isUUID(command.UpdatedBy) {
		return BrandingView{}, apperrors.New(apperrors.CodeInvalidArgument, "logo ID and updated_by must be UUIDs")
	}
	alt := strings.TrimSpace(command.AltText)
	if len(alt) > branding.MaxAltText {
		return BrandingView{}, apperrors.New(apperrors.CodeInvalidArgument, "alt text is too long")
	}
	detected, err := branding.DetectImageType(command.Data)
	if err != nil {
		return BrandingView{}, apperrors.New(apperrors.CodeInvalidArgument, err.Error())
	}
	contentType := detected
	if strings.TrimSpace(command.ContentType) != "" {
		normalized, normalizeErr := branding.NormalizeContentType(command.ContentType)
		if normalizeErr != nil {
			return BrandingView{}, apperrors.New(apperrors.CodeInvalidArgument, normalizeErr.Error())
		}
		if normalized != detected {
			return BrandingView{}, apperrors.New(apperrors.CodeInvalidArgument, "content type does not match logo bytes")
		}
		contentType = normalized
	}
	payload := command.Data
	if contentType == "image/svg+xml" {
		sanitized, sanitizeErr := branding.SanitizeSVG(payload)
		if sanitizeErr != nil {
			return BrandingView{}, apperrors.New(apperrors.CodeInvalidArgument, sanitizeErr.Error())
		}
		payload = sanitized
	}
	sum := sha256.Sum256(payload)
	objectKey := brandingObjectKey(command.TenantID, command.LogoID)
	if err := service.storage.Put(contextValue, objectKey, bytes.NewReader(payload), int64(len(payload)), contentType); err != nil {
		return BrandingView{}, fmt.Errorf("store branding logo: %w", err)
	}
	var result BrandingView
	err = database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		var err error
		result, err = service.store.InsertBrandingLogo(contextValue, transaction, command.TenantID, command.LogoID, command.UpdatedBy, alt, objectKey, sum[:], contentType)
		if err != nil {
			_ = service.storage.Delete(context.WithoutCancel(contextValue), objectKey)
			return err
		}
		return nil
	})
	if err != nil {
		return BrandingView{}, err
	}
	return service.attachLogoURLs(contextValue, result)
}

func (service *Service) ReorderBrandingLogos(contextValue context.Context, capability centralauthz.Capability, command ReorderBrandingLogos) (BrandingView, error) {
	if err := service.validateBrandingScope(command.TenantID); err != nil {
		return BrandingView{}, err
	}
	if len(command.LogoIDs) == 0 || len(command.LogoIDs) > branding.MaxLogos {
		return BrandingView{}, apperrors.New(apperrors.CodeInvalidArgument, "logo order must contain 1 to 5 ids")
	}
	for _, id := range command.LogoIDs {
		if !isUUID(id) {
			return BrandingView{}, apperrors.New(apperrors.CodeInvalidArgument, "logo ID must be a UUID")
		}
	}
	var result BrandingView
	err := database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		var err error
		result, err = service.store.ReorderBrandingLogos(contextValue, transaction, command.TenantID, command.LogoIDs)
		return err
	})
	if err != nil {
		return BrandingView{}, err
	}
	return service.attachLogoURLs(contextValue, result)
}

func (service *Service) DeleteBrandingLogo(contextValue context.Context, capability centralauthz.Capability, command DeleteBrandingLogo) (BrandingView, error) {
	if err := service.validateBrandingScope(command.TenantID); err != nil {
		return BrandingView{}, err
	}
	if !isUUID(command.LogoID) {
		return BrandingView{}, apperrors.New(apperrors.CodeInvalidArgument, "logo ID must be a UUID")
	}
	var objectKey string
	var result BrandingView
	err := database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		var err error
		objectKey, result, err = service.store.DeleteBrandingLogo(contextValue, transaction, command.TenantID, command.LogoID)
		return err
	})
	if err != nil {
		return BrandingView{}, err
	}
	if objectKey != "" && service.storage != nil {
		_ = service.storage.Delete(context.WithoutCancel(contextValue), objectKey)
	}
	return service.attachLogoURLs(contextValue, result)
}

func (service *Service) PublicBrandingLogo(contextValue context.Context, logoID string) (BrandingLogoObject, error) {
	if !isUUID(logoID) {
		return BrandingLogoObject{}, apperrors.New(apperrors.CodeInvalidArgument, "logo ID must be a UUID")
	}
	if service.storage == nil {
		return BrandingLogoObject{}, apperrors.New(apperrors.CodeUnavailable, "logo storage is not configured")
	}
	var tenantID *string
	var objectKey string
	var contentType string
	var sha []byte
	err := service.pool.QueryRow(contextValue, `
		SELECT tenant_id::text, object_key, content_type, sha256
		FROM tenant.public_branding_logo($1::uuid)
	`, logoID).Scan(&tenantID, &objectKey, &contentType, &sha)
	if err != nil {
		return BrandingLogoObject{}, apperrors.New(apperrors.CodeNotFound, "logo was not found")
	}
	return BrandingLogoObject{TenantID: tenantID, ObjectKey: objectKey, ContentType: contentType, SHA256: sha}, nil
}

func (service *Service) BrandingLogoContent(contextValue context.Context, logoID string) ([]byte, string, error) {
	meta, err := service.PublicBrandingLogo(contextValue, logoID)
	if err != nil {
		return nil, "", err
	}
	reader, _, err := service.storage.Get(contextValue, meta.ObjectKey)
	if err != nil {
		return nil, "", apperrors.New(apperrors.CodeNotFound, "logo was not found")
	}
	defer reader.Close()
	data, err := io.ReadAll(io.LimitReader(reader, branding.MaxLogoBytes+1))
	if err != nil {
		return nil, "", err
	}
	if len(data) > branding.MaxLogoBytes {
		return nil, "", apperrors.New(apperrors.CodeInvalidArgument, "logo is too large")
	}
	sum := sha256.Sum256(data)
	if !bytes.Equal(sum[:], meta.SHA256) {
		return nil, "", apperrors.New(apperrors.CodeFailedPrecondition, "stored logo checksum mismatch")
	}
	return data, meta.ContentType, nil
}

func (service *Service) validateBrandingScope(tenantID *string) error {
	if tenantID != nil && !isUUID(*tenantID) {
		return apperrors.New(apperrors.CodeInvalidArgument, "tenant ID must be a UUID")
	}
	return nil
}

func brandingObjectKey(tenantID *string, logoID string) string {
	scope := "platform"
	if tenantID != nil {
		scope = *tenantID
	}
	return fmt.Sprintf("branding/%s/logos/%s", scope, logoID)
}

func (service *Service) materializePublicBranding(contextValue context.Context, tenantID *string, raw []byte) (BrandingView, error) {
	var payload struct {
		AppName     *string `json:"app_name"`
		AccentColor *string `json:"accent_color"`
		Logos       []struct {
			ID          string `json:"id"`
			ContentType string `json:"content_type"`
			Position    int16  `json:"position"`
			AltText     string `json:"alt_text"`
		} `json:"logos"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return BrandingView{}, fmt.Errorf("decode public branding: %w", err)
	}
	view := BrandingView{TenantID: tenantID, AppName: payload.AppName, AccentColor: payload.AccentColor}
	for _, logo := range payload.Logos {
		view.Logos = append(view.Logos, BrandingLogo{
			ID: logo.ID, URL: service.publicLogoURL(logo.ID), ContentType: logo.ContentType, Position: logo.Position, AltText: logo.AltText,
		})
	}
	return view, nil
}

func (service *Service) attachLogoURLs(contextValue context.Context, view BrandingView) (BrandingView, error) {
	for index := range view.Logos {
		if service.storage != nil {
			url, err := service.storage.PresignGet(contextValue, brandingObjectKeyFromLogo(view.TenantID, view.Logos[index].ID), 15*time.Minute)
			if err == nil {
				view.Logos[index].URL = url
				continue
			}
		}
		view.Logos[index].URL = service.publicLogoURL(view.Logos[index].ID)
	}
	return view, nil
}

func brandingObjectKeyFromLogo(tenantID *string, logoID string) string {
	return brandingObjectKey(tenantID, logoID)
}

func (service *Service) publicLogoURL(logoID string) string {
	return "/v1/branding/logos/" + logoID
}

// Storage configures optional object storage for branding assets.
func (service *Service) Storage(client storage.Object) {
	if service != nil {
		service.storage = client
	}
}
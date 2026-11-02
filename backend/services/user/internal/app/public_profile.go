package app

import (
	"context"
	"encoding/json"
	"errors"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	centralauthz "github.com/aethercode/aethercode/libs/pkg/authz"
	"github.com/aethercode/aethercode/libs/pkg/database"
	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Public profiles (ADR-0062): a student chooses to publish a card at /u/<slug>. The
// content is what the student chose to show; the service keeps its shape and size
// in bounds and never adds anything of its own.

var slugPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{2,30}$`)

// reservedSlugs would collide with routes or read as official.
var reservedSlugs = map[string]struct{}{"admin": {}, "api": {}, "login": {}, "staff": {}, "student": {}, "support": {}, "security": {}, "status": {}, "help": {}, "about": {}, "aethercode": {}}

type PublicProfileLink struct {
	Platform string `json:"platform"`
	Handle   string `json:"handle"`
	URL      string `json:"url,omitempty"`
}

type PublicProfileContent struct {
	Name     string              `json:"name"`
	Headline string              `json:"headline,omitempty"`
	Bio      string              `json:"bio,omitempty"`
	College  string              `json:"college,omitempty"`
	Batch    string              `json:"batch,omitempty"`
	Skills   []string            `json:"skills,omitempty"`
	Links    []PublicProfileLink `json:"links,omitempty"`
}

type SetPublicProfile struct {
	Slug    string
	Enabled bool
	Content PublicProfileContent
}

type PublicProfile struct {
	Slug      string               `json:"slug"`
	Enabled   bool                 `json:"enabled"`
	Content   PublicProfileContent `json:"content"`
	UpdatedAt *time.Time           `json:"updated_at,omitempty"`
}

type PublicProfiles struct{ pool *pgxpool.Pool }

func NewPublicProfiles(pool *pgxpool.Pool) (*PublicProfiles, error) {
	if pool == nil {
		return nil, errors.New("user database pool is required")
	}
	return &PublicProfiles{pool: pool}, nil
}

func clean(value string, limit int) string {
	value = strings.TrimSpace(value)
	if utf8.RuneCountInString(value) > limit {
		value = string([]rune(value)[:limit])
	}
	return value
}

// Normalise bounds every field. A profile is public, so it is strict about what it keeps.
func (command SetPublicProfile) Normalise() (SetPublicProfile, error) {
	command.Slug = strings.ToLower(strings.TrimSpace(command.Slug))
	if !slugPattern.MatchString(command.Slug) {
		return command, apperrors.New(apperrors.CodeInvalidArgument, "the profile address must be 3 to 31 lowercase letters, digits or dashes")
	}
	if _, reserved := reservedSlugs[command.Slug]; reserved {
		return command, apperrors.New(apperrors.CodeInvalidArgument, "that profile address is taken")
	}
	content := command.Content
	content.Name = clean(content.Name, 80)
	if content.Name == "" {
		return command, apperrors.New(apperrors.CodeInvalidArgument, "a profile needs a name")
	}
	content.Headline = clean(content.Headline, 120)
	content.Bio = clean(content.Bio, 600)
	content.College = clean(content.College, 120)
	content.Batch = clean(content.Batch, 80)
	skills := make([]string, 0, 12)
	for _, skill := range content.Skills {
		if skill = clean(skill, 30); skill != "" && len(skills) < 12 {
			skills = append(skills, skill)
		}
	}
	content.Skills = skills
	links := make([]PublicProfileLink, 0, 12)
	for _, link := range content.Links {
		link.Platform, link.Handle, link.URL = clean(link.Platform, 30), clean(link.Handle, 60), clean(link.URL, 200)
		if link.URL != "" && !strings.HasPrefix(link.URL, "https://") {
			link.URL = ""
		}
		if link.Platform != "" && link.Handle != "" && len(links) < 12 {
			links = append(links, link)
		}
	}
	content.Links = links
	command.Content = content
	return command, nil
}

func parseProfile(raw []byte) (PublicProfile, error) {
	var stored struct {
		Slug      string               `json:"slug"`
		Enabled   bool                 `json:"enabled"`
		Content   PublicProfileContent `json:"content"`
		UpdatedAt *time.Time           `json:"updated_at"`
	}
	if err := json.Unmarshal(raw, &stored); err != nil {
		return PublicProfile{}, err
	}
	return PublicProfile{Slug: stored.Slug, Enabled: stored.Enabled, Content: stored.Content, UpdatedAt: stored.UpdatedAt}, nil
}

// Own is the signed-in student's settings, public or not.
func (service *PublicProfiles) Own(contextValue context.Context, capability centralauthz.Capability, tenantID string) (PublicProfile, error) {
	if !isUUID(tenantID) {
		return PublicProfile{}, apperrors.New(apperrors.CodeInvalidArgument, "college must be a valid ID")
	}
	var raw []byte
	err := database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		return transaction.QueryRow(contextValue, `SELECT users.own_public_profile($1::uuid)`, tenantID).Scan(&raw)
	})
	if err != nil {
		return PublicProfile{}, err
	}
	if raw == nil {
		return PublicProfile{}, apperrors.New(apperrors.CodeForbidden, "authorization denied")
	}
	return parseProfile(raw)
}

func (service *PublicProfiles) Set(contextValue context.Context, capability centralauthz.Capability, tenantID string, command SetPublicProfile) (PublicProfile, error) {
	if !isUUID(tenantID) {
		return PublicProfile{}, apperrors.New(apperrors.CodeInvalidArgument, "college must be a valid ID")
	}
	command, err := command.Normalise()
	if err != nil {
		return PublicProfile{}, err
	}
	content, err := json.Marshal(command.Content)
	if err != nil {
		return PublicProfile{}, err
	}
	var raw []byte
	err = database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		return transaction.QueryRow(contextValue, `SELECT users.set_own_public_profile($1::uuid, $2, $3, $4::jsonb)`, tenantID, command.Slug, command.Enabled, content).Scan(&raw)
	})
	var postgresError *pgconn.PgError
	if errors.As(err, &postgresError) {
		switch postgresError.Code {
		case "23505":
			return PublicProfile{}, apperrors.New(apperrors.CodeConflict, "that profile address is taken")
		case "42501":
			return PublicProfile{}, apperrors.New(apperrors.CodeForbidden, "authorization denied")
		}
	}
	if err != nil {
		return PublicProfile{}, err
	}
	return parseProfile(raw)
}

// BySlug is the public read: no sign-in, only an enabled profile, nothing but its content.
func (service *PublicProfiles) BySlug(contextValue context.Context, slug string) (PublicProfile, error) {
	slug = strings.ToLower(strings.TrimSpace(slug))
	if !slugPattern.MatchString(slug) {
		return PublicProfile{}, apperrors.New(apperrors.CodeNotFound, "profile not found")
	}
	var raw []byte
	if err := service.pool.QueryRow(contextValue, `SELECT users.public_profile_by_slug($1)`, slug).Scan(&raw); err != nil {
		return PublicProfile{}, err
	}
	if raw == nil {
		return PublicProfile{}, apperrors.New(apperrors.CodeNotFound, "profile not found")
	}
	profile, err := parseProfile(raw)
	profile.Enabled = true
	return profile, err
}

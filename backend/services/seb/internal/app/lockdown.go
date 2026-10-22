package app

import (
	"context"
	"net/netip"
	"net/url"
	"slices"
	"strings"
	"time"

	centralauthz "github.com/aethercode/aethercode/libs/pkg/authz"
	"github.com/aethercode/aethercode/libs/pkg/database"
	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
	"github.com/aethercode/aethercode/services/seb/internal/domain/launchfile"
	"github.com/jackc/pgx/v5"
)

// Exam lockdown (ADR-0022): staff lock an exam to Safe Exam Browser by saving
// the keys their SEB configuration reports; Gateway then checks every
// protected request of a candidate sitting that exam.

const maxAcceptedKeys = 16

// maxAllowedNetworks bounds an exam's lab networks (ADR-0030).
const maxAllowedNetworks = 50

// Check results. Gateway lets a request through on CheckNotRequired or
// CheckMatched only.
const (
	CheckNotRequired = "not_required"
	CheckMissing     = "missing"
	CheckMatched     = "matched"
	CheckMismatched  = "mismatched"
	// CheckNetworkRefused: the candidate has an open exam limited to lab
	// networks and the request comes from outside them (ADR-0030).
	CheckNetworkRefused = "network_refused"
)

type ExamPolicy struct {
	TenantID     string   `json:"tenant_id"`
	ExamID       string   `json:"exam_id"`
	Title        string   `json:"title"`
	Enabled      bool     `json:"enabled"`
	AcceptedKeys []string `json:"accepted_keys"`
	// AllowedNetworks, when not empty, are the only networks candidates may
	// sit the exam from, as CIDR prefixes.
	AllowedNetworks []string  `json:"allowed_networks"`
	UpdatedBy       string    `json:"updated_by"`
	UpdatedAt       time.Time `json:"updated_at"`
	Version         int       `json:"version"`
}

type PutExamPolicy struct {
	TenantID        string
	ExamID          string
	Title           string
	Enabled         bool
	AcceptedKeys    []string
	AllowedNetworks []string
	ActorID         string
}

type CheckExamRequest struct {
	TenantID      string
	URL           string
	RequestHash   string
	ConfigKeyHash string
	// ClientIP is the address Gateway trusts for the request; empty when unknown.
	ClientIP string
}

// LaunchSettings are the deployment's values for .seb files: BaseURL is the
// public origin of the web app, Password encrypts the file and quits SEB.
type LaunchSettings struct {
	BaseURL  string
	Password string
}

type LaunchFile struct {
	Filename string
	Content  []byte
}

type LockdownStore interface {
	PutExamPolicy(context.Context, pgx.Tx, PutExamPolicy) (ExamPolicy, error)
	GetExamPolicy(context.Context, pgx.Tx, string, string) (ExamPolicy, error)
	CheckExamRequest(context.Context, pgx.Tx, CheckExamRequest) (string, error)
	CandidateExamTitle(context.Context, pgx.Tx, string, string) (string, error)
}

func (service *Service) PutExamPolicy(ctx context.Context, capability centralauthz.Capability, command PutExamPolicy) (ExamPolicy, error) {
	command.Title = strings.TrimSpace(command.Title)
	if !isUUID(command.TenantID) || !isUUID(command.ExamID) || !isUUID(command.ActorID) || !validLength(command.Title, 1, 200) {
		return ExamPolicy{}, invalid("an exam policy needs a tenant, an exam and a title of at most 200 characters")
	}
	keys := make([]string, 0, len(command.AcceptedKeys))
	for _, key := range command.AcceptedKeys {
		key = strings.ToLower(strings.TrimSpace(key))
		if !checksumPattern.MatchString(key) {
			return ExamPolicy{}, invalid("each accepted key must be a 64-character hexadecimal Browser Exam Key or Config Key")
		}
		if !slices.Contains(keys, key) {
			keys = append(keys, key)
		}
	}
	if len(keys) > maxAcceptedKeys {
		return ExamPolicy{}, invalid("an exam accepts at most 16 keys")
	}
	if command.Enabled && len(keys) == 0 {
		return ExamPolicy{}, invalid("locking an exam needs at least one accepted key")
	}
	command.AcceptedKeys = keys
	networks, err := normalizeNetworks(command.AllowedNetworks)
	if err != nil {
		return ExamPolicy{}, err
	}
	command.AllowedNetworks = networks
	var policy ExamPolicy
	err = database.WithTenantTx(ctx, service.pool, capability, func(transaction pgx.Tx) error {
		var err error
		policy, err = service.lockdown.PutExamPolicy(ctx, transaction, command)
		return err
	})
	return policy, err
}

func (service *Service) GetExamPolicy(ctx context.Context, capability centralauthz.Capability, tenantID, examID string) (ExamPolicy, error) {
	if !isUUID(tenantID) || !isUUID(examID) {
		return ExamPolicy{}, invalid("tenant and exam IDs are required")
	}
	var policy ExamPolicy
	err := database.WithTenantTx(ctx, service.pool, capability, func(transaction pgx.Tx) error {
		var err error
		policy, err = service.lockdown.GetExamPolicy(ctx, transaction, tenantID, examID)
		return err
	})
	return policy, err
}

// CheckExamRequest tells Gateway whether a candidate's request may proceed.
// URL is the absolute URL the browser requested; SEB hashes it without the
// fragment.
func (service *Service) CheckExamRequest(ctx context.Context, capability centralauthz.Capability, command CheckExamRequest) (string, error) {
	parsed, err := url.Parse(command.URL)
	if !isUUID(command.TenantID) || err != nil || (parsed.Scheme != "https" && parsed.Scheme != "http") ||
		parsed.Host == "" || parsed.Fragment != "" || strings.Contains(command.URL, "#") || len(command.URL) > 8192 {
		return "", invalid("an SEB request check needs a tenant and an absolute URL without a fragment")
	}
	command.ClientIP = strings.TrimSpace(command.ClientIP)
	if command.ClientIP != "" {
		address, parseErr := netip.ParseAddr(command.ClientIP)
		if parseErr != nil {
			return "", invalid("client_ip must be an IP address")
		}
		command.ClientIP = address.Unmap().String()
	}
	for _, hash := range []*string{&command.RequestHash, &command.ConfigKeyHash} {
		*hash = strings.ToLower(strings.TrimSpace(*hash))
		if *hash != "" && !checksumPattern.MatchString(*hash) {
			return "", invalid("SEB header hashes must be 64 hexadecimal characters")
		}
	}
	var result string
	err = database.WithTenantTx(ctx, service.pool, capability, func(transaction pgx.Tx) error {
		var err error
		result, err = service.lockdown.CheckExamRequest(ctx, transaction, command)
		return err
	})
	return result, err
}

// CandidateLaunchFile is the .seb file for a locked exam the signed
// candidate is assigned to.
func (service *Service) CandidateLaunchFile(ctx context.Context, capability centralauthz.Capability, tenantID, examID string) (LaunchFile, error) {
	if !isUUID(tenantID) || !isUUID(examID) {
		return LaunchFile{}, invalid("tenant and exam IDs are required")
	}
	var title string
	err := database.WithTenantTx(ctx, service.pool, capability, func(transaction pgx.Tx) error {
		var err error
		title, err = service.lockdown.CandidateExamTitle(ctx, transaction, tenantID, examID)
		return err
	})
	if err != nil {
		return LaunchFile{}, err
	}
	return service.launchFile(examID, title)
}

// StaffLaunchFile is the .seb file staff open in the SEB Config Tool to read
// the exam's Browser Exam Key and Config Key, and can hand to candidates.
func (service *Service) StaffLaunchFile(ctx context.Context, capability centralauthz.Capability, tenantID, examID string) (LaunchFile, error) {
	policy, err := service.GetExamPolicy(ctx, capability, tenantID, examID)
	if err != nil {
		return LaunchFile{}, err
	}
	return service.launchFile(examID, policy.Title)
}

// launchFile mirrors the exam app: SEB starts on the exam page and quits on
// the student home page.
func (service *Service) launchFile(examID, title string) (LaunchFile, error) {
	if service.launch.BaseURL == "" || service.launch.Password == "" {
		return LaunchFile{}, apperrors.New(apperrors.CodeUnavailable, "SEB launch files are not configured")
	}
	content, err := launchfile.Build(launchfile.Settings{
		StartURL: service.launch.BaseURL + "/exam/" + strings.ToLower(examID),
		QuitURL:  service.launch.BaseURL + "/student",
		Password: service.launch.Password,
	})
	if err != nil {
		return LaunchFile{}, err
	}
	return LaunchFile{Filename: launchfile.Filename(title), Content: content}, nil
}

// normalizeNetworks accepts addresses ("10.20.3.4") and CIDR ranges
// ("10.20.0.0/16"), IPv4 or IPv6, and returns them as canonical prefixes.
func normalizeNetworks(entries []string) ([]string, error) {
	networks := make([]string, 0, len(entries))
	for _, entry := range entries {
		entry = strings.TrimSpace(entry)
		if entry == "" {
			continue
		}
		var prefix netip.Prefix
		if strings.Contains(entry, "/") {
			parsed, err := netip.ParsePrefix(entry)
			if err != nil {
				return nil, invalid("each lab network must be an IP address or a range like 10.20.0.0/16")
			}
			prefix = parsed.Masked()
		} else {
			address, err := netip.ParseAddr(entry)
			if err != nil {
				return nil, invalid("each lab network must be an IP address or a range like 10.20.0.0/16")
			}
			address = address.Unmap()
			prefix = netip.PrefixFrom(address, address.BitLen())
		}
		if !slices.Contains(networks, prefix.String()) {
			networks = append(networks, prefix.String())
		}
	}
	if len(networks) > maxAllowedNetworks {
		return nil, invalid("an exam allows at most 50 lab networks")
	}
	return networks, nil
}

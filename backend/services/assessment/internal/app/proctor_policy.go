package app

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"
)

// proctorViolationKinds are the policy names for the kinds the proctor service
// emits (backend/services/proctor/src/proctor/detector.py); the snake_case
// detector names are accepted too.
var proctorViolationKinds = map[string]bool{
	"MULTIPLE_FACES": true, "NO_FACE": true, "PROHIBITED_DEVICE": true, "GAZE_AWAY": true,
	"multiple_faces": true, "face_missing": true, "phone_detected": true, "gaze_away": true,
}

// proctorPolicy is the typed view of a policy version body. Fields are
// pointers so an omitted key keeps the proctor service default; unknown keys
// (for example seb_required) are tolerated for existing published versions.
type proctorPolicy struct {
	Enabled                  *bool    `json:"enabled"`
	ViolationCooldownSeconds *int     `json:"violation_cooldown_seconds"`
	MaxViolations            *int     `json:"max_violations"`
	AutoSubmitOnBreach       *bool    `json:"auto_submit_on_breach"`
	CountedViolationKinds    []string `json:"counted_violation_kinds"`
}

// proctorPolicyKeys are matched exactly by the proctor service, while
// encoding/json would also accept other letter cases or an explicit null.
var proctorPolicyKeys = []string{"enabled", "violation_cooldown_seconds", "max_violations", "auto_submit_on_breach", "counted_violation_kinds"}

func validateProctorPolicy(raw json.RawMessage) error {
	var keys map[string]json.RawMessage
	if err := json.Unmarshal(raw, &keys); err != nil {
		return fmt.Errorf("decode proctor policy: %w", err)
	}
	for key, value := range keys {
		for _, known := range proctorPolicyKeys {
			if key != known && strings.EqualFold(key, known) {
				return fmt.Errorf("policy key %q must be written %q", key, known)
			}
			if key == known && string(bytes.TrimSpace(value)) == "null" {
				return fmt.Errorf("%s must not be null", known)
			}
		}
	}
	var policy proctorPolicy
	if err := json.NewDecoder(bytes.NewReader(raw)).Decode(&policy); err != nil {
		return fmt.Errorf("decode proctor policy: %w", err)
	}
	if policy.ViolationCooldownSeconds != nil && (*policy.ViolationCooldownSeconds < 1 || *policy.ViolationCooldownSeconds > 3600) {
		return fmt.Errorf("violation_cooldown_seconds must be between 1 and 3600")
	}
	if policy.MaxViolations != nil && (*policy.MaxViolations < 1 || *policy.MaxViolations > 1000) {
		return fmt.Errorf("max_violations must be between 1 and 1000")
	}
	if policy.AutoSubmitOnBreach != nil && *policy.AutoSubmitOnBreach && policy.MaxViolations == nil {
		return fmt.Errorf("auto_submit_on_breach requires max_violations")
	}
	if len(policy.CountedViolationKinds) > len(proctorViolationKinds) {
		return fmt.Errorf("counted_violation_kinds has too many entries")
	}
	for _, kind := range policy.CountedViolationKinds {
		if !proctorViolationKinds[kind] {
			return fmt.Errorf("counted_violation_kinds contains unknown kind %q", kind)
		}
	}
	return nil
}

package app

import (
	"encoding/json"
	"testing"
)

func TestValidateProctorPolicy(t *testing.T) {
	tests := []struct {
		name    string
		policy  string
		wantErr bool
	}{
		{"legacy body", `{"seb_required":false}`, false},
		{"full", `{"enabled":true,"violation_cooldown_seconds":15,"max_violations":5,"auto_submit_on_breach":true,"counted_violation_kinds":["MULTIPLE_FACES","NO_FACE","PROHIBITED_DEVICE","GAZE_AWAY","phone_detected"]}`, false},
		{"cooldown zero", `{"violation_cooldown_seconds":0}`, true},
		{"max too large", `{"max_violations":1001}`, true},
		{"auto submit without max", `{"auto_submit_on_breach":true}`, true},
		{"unknown kind", `{"counted_violation_kinds":["LOOKING_UP"]}`, true},
		{"mis-cased key", `{"Auto_Submit_On_Breach":true}`, true},
		{"explicit null", `{"max_violations":null}`, true},
		{"wrong type", `{"max_violations":"5"}`, true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if err := validateProctorPolicy(json.RawMessage(test.policy)); (err != nil) != test.wantErr {
				t.Fatalf("validateProctorPolicy(%s) error = %v, wantErr %v", test.policy, err, test.wantErr)
			}
		})
	}
}

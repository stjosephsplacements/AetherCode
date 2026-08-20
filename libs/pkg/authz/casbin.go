// Package authz provides the central, typed Casbin policy evaluation primitive.
package authz

import (
	"fmt"
	"strings"

	"github.com/casbin/casbin/v2"
	"github.com/casbin/casbin/v2/model"
)

// Role is a medallion-role assignment persisted by the user service.
type Role string

const (
	RoleSuperAdmin     Role = "super_admin"
	RolePlacementUser  Role = "placement_user"
	RoleCollegeAdmin   Role = "college_admin"
	RoleDepartmentUser Role = "department_user"
	RoleMentor         Role = "mentor"
	RoleStudent        Role = "student"
)

const policyModel = `
[request_definition]
r = sub, dom, obj, act

[policy_definition]
p = sub, dom, obj, act

[policy_effect]
e = some(where (p.eft == allow))

[matchers]
m = r.sub == p.sub && (p.dom == "*" || r.dom == p.dom) && keyMatch2(r.obj, p.obj) && (p.act == "*" || r.act == p.act)
`

// PolicyRule is one active, canonical Casbin row loaded from
// users.authorization_policy_rules. The User service never relies on a
// process-local positive authorization cache.
type PolicyRule struct {
	PType  string
	Values []string
}

// Engine is an in-memory evaluator built from a snapshot of the canonical
// policy rows for one request. Typed role/scope bindings are resolved by the
// User service before it reaches this evaluator.
type Engine struct {
	enforcer *casbin.Enforcer
}

// NewEngine creates a policy-less Casbin evaluator. A missing canonical policy
// means deny: production does not ship a hidden fallback allow policy.
func NewEngine() (*Engine, error) {
	policyModel, err := model.NewModelFromString(policyModel)
	if err != nil {
		return nil, fmt.Errorf("build Casbin model: %w", err)
	}
	enforcer, err := casbin.NewEnforcer(policyModel)
	if err != nil {
		return nil, fmt.Errorf("build Casbin enforcer: %w", err)
	}
	return &Engine{enforcer: enforcer}, nil
}

// NewEngineFromRules creates an evaluator from active policy rows. Only the
// narrow p form used by this model is accepted; malformed policy data fails the
// authorization decision closed instead of being ignored.
func NewEngineFromRules(rules []PolicyRule) (*Engine, error) {
	engine, err := NewEngine()
	if err != nil {
		return nil, err
	}
	for _, rule := range rules {
		if rule.PType != "p" || len(rule.Values) != 4 {
			return nil, fmt.Errorf("unsupported canonical Casbin policy rule %q", rule.PType)
		}
		for _, value := range rule.Values {
			if strings.TrimSpace(value) == "" {
				return nil, fmt.Errorf("canonical Casbin policy rule contains an empty value")
			}
		}
		if _, err := engine.enforcer.AddPolicy(rule.Values[0], rule.Values[1], rule.Values[2], rule.Values[3]); err != nil {
			return nil, fmt.Errorf("add canonical Casbin policy: %w", err)
		}
	}
	return engine, nil
}

// Authorize evaluates a role against a verified scope domain and resource.
func (engine *Engine) Authorize(role Role, scopeKind, resource, action string) (bool, error) {
	if strings.TrimSpace(string(role)) == "" || strings.TrimSpace(scopeKind) == "" {
		return false, fmt.Errorf("role and scope kind are required")
	}
	if strings.TrimSpace(resource) == "" || strings.TrimSpace(action) == "" {
		return false, fmt.Errorf("resource and action are required")
	}
	return engine.enforcer.Enforce(string(role), scopeKind, resource, action)
}

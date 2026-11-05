package app

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	centralauthz "github.com/stjosephsplacements/AetherCode/libs/pkg/authz"
)

// uncalledRoleStore proves input validation happens before any database work.
type uncalledRoleStore struct{ RoleStore }

func (uncalledRoleStore) CreateRole(context.Context, pgx.Tx, CreateRole) (Role, error) {
	panic("the store must not be reached")
}

func (uncalledRoleStore) UpdateRole(context.Context, pgx.Tx, UpdateRole) (Role, error) {
	panic("the store must not be reached")
}

func (uncalledRoleStore) PutOverwrite(context.Context, pgx.Tx, PutOverwrite) (Overwrite, error) {
	panic("the store must not be reached")
}

func TestRolesServiceRejectsInvalidInputBeforeTheDatabase(t *testing.T) {
	t.Parallel()
	service := &RolesService{pool: &pgxpool.Pool{}, store: uncalledRoleStore{}}
	capability := centralauthz.Capability{}
	name := "Lead"
	empty := ""
	high := 1000
	node := "018f4b0d-08f8-7c09-9ba7-efdf9c223366"

	if _, err := service.Create(context.Background(), capability, CreateRole{TenantID: node, Name: " ", Tier: 2, Position: 10}); err == nil {
		t.Error("a blank name was accepted")
	}
	if _, err := service.Create(context.Background(), capability, CreateRole{TenantID: node, Name: name, Tier: 3, Position: 10}); err == nil {
		t.Error("a Gold college role was accepted")
	}
	if _, err := service.Create(context.Background(), capability, CreateRole{TenantID: node, Name: name, Tier: 2, Position: 1000}); err == nil {
		t.Error("position 1000 was accepted")
	}
	if _, err := service.Update(context.Background(), capability, UpdateRole{TenantID: node, RoleID: node}); err == nil {
		t.Error("an empty update was accepted")
	}
	if _, err := service.Update(context.Background(), capability, UpdateRole{TenantID: node, RoleID: node, Name: &empty}); err == nil {
		t.Error("an empty name was accepted")
	}
	if _, err := service.Update(context.Background(), capability, UpdateRole{TenantID: node, RoleID: node, Position: &high}); err == nil {
		t.Error("position 1000 was accepted on update")
	}
	base := PutOverwrite{TenantID: node, NodeKind: "department", NodeID: node, TargetKind: "role", TargetID: node, GrantedBy: node}
	for name, mutate := range map[string]func(*PutOverwrite){
		"platform node":      func(p *PutOverwrite) { p.NodeKind = "platform" },
		"unknown target":     func(p *PutOverwrite) { p.TargetKind = "group" },
		"other college node": func(p *PutOverwrite) { p.NodeKind = "college"; p.NodeID = "018f4b0d-08f8-7c09-9ba7-efdf9c223399" },
		"bad node id":        func(p *PutOverwrite) { p.NodeID = "x" },
	} {
		command := base
		mutate(&command)
		if _, err := service.Put(context.Background(), capability, command); err == nil {
			t.Errorf("%s was accepted", name)
		}
	}
}

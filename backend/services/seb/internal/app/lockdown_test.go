package app

import (
	"context"
	"strings"
	"testing"

	centralauthz "github.com/stjosephsplacements/AetherCode/libs/pkg/authz"
)

const testValidUUID = "018f4b0d-08f8-7c09-9ba7-efdf9c229001"

func TestPutExamPolicyRejectsInvalidIDs(t *testing.T) {
	t.Parallel()
	service := &Service{}
	for name, cmd := range map[string]PutExamPolicy{
		"non-UUID TenantID": {TenantID: "bad", ExamID: testValidUUID, ActorID: testValidUUID, Title: "T"},
		"non-UUID ExamID":   {TenantID: testValidUUID, ExamID: "bad", ActorID: testValidUUID, Title: "T"},
		"non-UUID ActorID":  {TenantID: testValidUUID, ExamID: testValidUUID, ActorID: "bad", Title: "T"},
		"blank Title":       {TenantID: testValidUUID, ExamID: testValidUUID, ActorID: testValidUUID, Title: ""},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			_, err := service.PutExamPolicy(context.Background(), centralauthz.Capability{}, cmd)
			if err == nil {
				t.Fatalf("PutExamPolicy accepted invalid input for case %q", name)
			}
		})
	}
}

func TestGetExamPolicyRejectsInvalidIDs(t *testing.T) {
	t.Parallel()
	service := &Service{}
	for name, ids := range map[string][2]string{
		"non-UUID TenantID": {"bad", testValidUUID},
		"non-UUID ExamID":   {testValidUUID, "bad"},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			_, err := service.GetExamPolicy(context.Background(), centralauthz.Capability{}, ids[0], ids[1])
			if err == nil {
				t.Fatalf("GetExamPolicy accepted invalid input for case %q", name)
			}
		})
	}
}

type ticketStore struct {
	LockdownStore
	title    string
	consumed int
}

func (store *ticketStore) ConsumeLaunchTicket(context.Context, Queryer, string, string, []byte) (string, error) {
	store.consumed++
	return store.title, nil
}

func launchService(store LockdownStore) *Service {
	return &Service{lockdown: store, launch: LaunchSettings{BaseURL: "https://exam.example", QuitSecret: strings.Repeat("ab", 24)}}
}

func TestTicketLaunchFileRefusesWithoutSpendingOnBadInput(t *testing.T) {
	t.Parallel()
	store := &ticketStore{title: "Mid term"}
	service := launchService(store)
	for name, ticket := range map[string]string{
		"empty":     "",
		"too short": "abc",
		"not b64":   strings.Repeat("!", launchTicketLength),
		"too long":  strings.Repeat("A", launchTicketLength+1),
	} {
		if _, err := service.TicketLaunchFile(context.Background(), testValidUUID, testValidUUID, ticket); err == nil {
			t.Errorf("%s ticket was accepted", name)
		}
	}
	if store.consumed != 0 {
		t.Errorf("a malformed ticket reached the database %d times", store.consumed)
	}
}

func TestTicketLaunchFileSpentOrUnknownTicketIsDenied(t *testing.T) {
	t.Parallel()
	valid := strings.Repeat("A", launchTicketLength)
	if _, err := launchService(&ticketStore{}).TicketLaunchFile(context.Background(), testValidUUID, testValidUUID, valid); err == nil {
		t.Fatal("a ticket the database did not honour opened the file")
	}
	file, err := launchService(&ticketStore{title: "Mid term"}).TicketLaunchFile(context.Background(), testValidUUID, testValidUUID, valid)
	if err != nil || len(file.Content) == 0 {
		t.Fatalf("honoured ticket: %v", err)
	}
}

// A misconfigured server must not burn the candidate's ticket.
func TestTicketLaunchFileUnconfiguredKeepsTheTicket(t *testing.T) {
	t.Parallel()
	store := &ticketStore{title: "Mid term"}
	service := &Service{lockdown: store}
	if _, err := service.TicketLaunchFile(context.Background(), testValidUUID, testValidUUID, strings.Repeat("A", launchTicketLength)); err == nil || store.consumed != 0 {
		t.Fatalf("err = %v, consumed = %d", err, store.consumed)
	}
}

func TestIssueLaunchTicketRejectsInvalidIDs(t *testing.T) {
	t.Parallel()
	if _, err := launchService(&ticketStore{}).IssueLaunchTicket(context.Background(), centralauthz.Capability{}, "bad", testValidUUID); err == nil {
		t.Fatal("invalid tenant accepted")
	}
}

// The start URL, and so the Config Key, is pinned to the configured origin and the exam's own page.
func TestLaunchSettingsPinStartURL(t *testing.T) {
	t.Parallel()
	settings := launchService(&ticketStore{}).launchSettings("018F4B0D-08F8-7C09-9BA7-EFDF9C229001")
	if want := "https://exam.example/exam/018f4b0d-08f8-7c09-9ba7-efdf9c229001"; settings.StartURL != want {
		t.Fatalf("StartURL = %q, want %q", settings.StartURL, want)
	}
}

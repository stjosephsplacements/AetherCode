package app

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	centralauthz "github.com/stjosephsplacements/AetherCode/libs/pkg/authz"
	apperrors "github.com/stjosephsplacements/AetherCode/libs/pkg/errors"
)

func TestListSnapshotsRejectsInvalidInputBeforeTransaction(t *testing.T) {
	t.Parallel()
	service, err := NewService(&pgxpool.Pool{}, validationStore{}, &memoryStorage{objects: map[string][]byte{}}, &fakeKMS{})
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	const id = validSubmissionTestUUID
	cases := []struct {
		name string
		cmd  ListSnapshots
	}{
		{"bad tenant", ListSnapshots{TenantID: "x", AttemptID: id, Limit: 50}},
		{"bad attempt", ListSnapshots{TenantID: id, AttemptID: "x", Limit: 50}},
		{"bad before cursor", ListSnapshots{TenantID: id, AttemptID: id, Limit: 50, BeforeID: "not-a-uuid"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := service.ListSnapshots(context.Background(), centralauthz.Capability{}, tc.cmd)
			var appErr *apperrors.Error
			if !errors.As(err, &appErr) || appErr.Code != apperrors.CodeInvalidArgument {
				t.Fatalf("error = %v, want invalid argument", err)
			}
		})
	}
}

func TestListSnapshotsRequiresStorage(t *testing.T) {
	t.Parallel()
	service, err := NewService(&pgxpool.Pool{}, validationStore{}, nil, nil)
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	_, err = service.ListSnapshots(context.Background(), centralauthz.Capability{}, ListSnapshots{
		TenantID: validSubmissionTestUUID, AttemptID: validSubmissionTestUUID, Limit: 10,
	})
	var appErr *apperrors.Error
	if !errors.As(err, &appErr) || appErr.Code != apperrors.CodeUnavailable {
		t.Fatalf("error = %v, want unavailable without storage", err)
	}
}

func TestWalkSnapshotPages(t *testing.T) {
	t.Parallel()
	mk := func(ids ...string) []Snapshot {
		out := make([]Snapshot, len(ids))
		for i, id := range ids {
			out[i] = Snapshot{ID: id, CapturedAt: time.Unix(int64(i), 0).UTC(), URL: "https://example/" + id}
		}
		return out
	}
	t.Run("single short page", func(t *testing.T) {
		calls := 0
		got, err := walkSnapshotPages(200, func(before string) ([]Snapshot, error) {
			calls++
			if before != "" {
				t.Fatalf("first page before = %q, want empty", before)
			}
			return mk("a", "b"), nil
		})
		if err != nil || calls != 1 || len(got) != 2 || got[0].ID != "a" {
			t.Fatalf("got=%v calls=%d err=%v", got, calls, err)
		}
	})
	t.Run("walks until short page", func(t *testing.T) {
		var befores []string
		page1 := mk("s1", "s2", "s3")
		page2 := mk("s4")
		got, err := walkSnapshotPages(3, func(before string) ([]Snapshot, error) {
			befores = append(befores, before)
			if before == "" {
				return page1, nil
			}
			if before != "s3" {
				t.Fatalf("second before = %q, want s3", before)
			}
			return page2, nil
		})
		if err != nil {
			t.Fatal(err)
		}
		if len(befores) != 2 || befores[0] != "" || befores[1] != "s3" {
			t.Fatalf("befores = %v", befores)
		}
		if len(got) != 4 || got[3].ID != "s4" {
			t.Fatalf("got = %v", got)
		}
	})
	t.Run("propagates fetch error", func(t *testing.T) {
		want := errors.New("boom")
		_, err := walkSnapshotPages(10, func(string) ([]Snapshot, error) { return nil, want })
		if !errors.Is(err, want) {
			t.Fatalf("error = %v, want boom", err)
		}
	})
	t.Run("exact page then empty", func(t *testing.T) {
		calls := 0
		got, err := walkSnapshotPages(2, func(before string) ([]Snapshot, error) {
			calls++
			if calls == 1 {
				return mk("a", "b"), nil
			}
			if before != "b" {
				t.Fatalf("before = %q", before)
			}
			return nil, nil
		})
		if err != nil || calls != 2 || len(got) != 2 {
			t.Fatalf("got=%v calls=%d err=%v", got, calls, err)
		}
	})
}

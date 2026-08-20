package authzprojection

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"testing"
	"time"

	"github.com/aethercode/aethercode/libs/pkg/messaging"
)

const (
	resyncTestEventID = "018f4b0d-08f8-7c09-9ba7-efdf9c223101"
	resyncTestID      = "018f4b0d-08f8-7c09-9ba7-efdf9c223102"
	resyncTestActorID = "018f4b0d-08f8-7c09-9ba7-efdf9c223103"
)

func TestParseResyncRequestRequiresExactTargetSubjectAndUUIDv7(t *testing.T) {
	subject, err := ResyncRequestSubject("submission")
	if err != nil {
		t.Fatalf("ResyncRequestSubject() error = %v", err)
	}
	event := messaging.Event{
		ID: resyncTestEventID, Type: subject, SchemaVersion: 1,
		AggregateType: "authz_resync", AggregateID: resyncTestID,
		OccurredAt: time.Now().UTC(),
		Payload:    []byte(`{"resync_id":"018f4b0d-08f8-7c09-9ba7-efdf9c223102","target_service":"submission","reason":"startup"}`),
	}
	request, err := ParseResyncRequest(event)
	if err != nil {
		t.Fatalf("ParseResyncRequest() error = %v", err)
	}
	if request.TargetService != "submission" || request.ResyncID != resyncTestID {
		t.Fatalf("ParseResyncRequest() = %#v", request)
	}

	event.Type = "authz.grants_snapshot.resync_requested.user.v1"
	if _, err := ParseResyncRequest(event); err == nil {
		t.Fatal("ParseResyncRequest() accepted a subject/payload target mismatch")
	}

	event.Type = subject
	event.ID = "018f4b0d-08f8-4c09-9ba7-efdf9c223101"
	if _, err := ParseResyncRequest(event); err == nil {
		t.Fatal("ParseResyncRequest() accepted a non-v7 request event ID")
	}
}

func TestParseResyncSnapshotRejectsPayloadTamperingAndUnknownFields(t *testing.T) {
	inner := []byte(`{"principal_id":"018f4b0d-08f8-7c09-9ba7-efdf9c223103","authz_revision":7,"reason":"role_changed","grants":[]}`)
	innerHash := sha256.Sum256(inner)
	subject, err := ResyncSnapshotSubject("submission")
	if err != nil {
		t.Fatalf("ResyncSnapshotSubject() error = %v", err)
	}
	payload, err := json.Marshal(resyncSnapshotPayload{
		ResyncID: resyncTestID, TargetService: "submission", Snapshot: inner,
		SnapshotSHA: hex.EncodeToString(innerHash[:]),
	})
	if err != nil {
		t.Fatalf("marshal resync snapshot = %v", err)
	}
	event := messaging.Event{
		ID: resyncTestEventID, Type: subject, SchemaVersion: 1,
		AggregateType: "authz_resync", AggregateID: resyncTestID,
		OccurredAt: time.Now().UTC(), Payload: payload,
	}
	parsed, err := parseResyncSnapshot(event)
	if err != nil {
		t.Fatalf("parseResyncSnapshot() error = %v", err)
	}
	if parsed.Snapshot.PrincipalID != resyncTestActorID || parsed.Snapshot.AuthorizationRev != 7 {
		t.Fatalf("parseResyncSnapshot() = %#v", parsed)
	}

	tamperedPayload, err := json.Marshal(resyncSnapshotPayload{
		ResyncID: resyncTestID, TargetService: "submission", Snapshot: inner,
		SnapshotSHA: hex.EncodeToString(make([]byte, sha256.Size)),
	})
	if err != nil {
		t.Fatalf("marshal tampered resync snapshot = %v", err)
	}
	event.Payload = tamperedPayload
	if _, err := parseResyncSnapshot(event); err == nil {
		t.Fatal("parseResyncSnapshot() accepted a tampered snapshot hash")
	}

	event.Payload = []byte(`{"resync_id":"018f4b0d-08f8-7c09-9ba7-efdf9c223102","target_service":"submission","snapshot":{"principal_id":"018f4b0d-08f8-7c09-9ba7-efdf9c223103","authz_revision":7,"reason":"role_changed","grants":[]},"snapshot_sha256":"` + hex.EncodeToString(innerHash[:]) + `","unexpected":true}`)
	if _, err := parseResyncSnapshot(event); err == nil {
		t.Fatal("parseResyncSnapshot() accepted an unknown outer field")
	}
}

func TestResyncManifestFailsClosedUntilFullMatchingSet(t *testing.T) {
	firstHash := sha256.Sum256([]byte("first"))
	secondHash := sha256.Sum256([]byte("second"))
	items := []resyncManifestItem{
		{PrincipalID: "018f4b0d-08f8-7c09-9ba7-efdf9c223104", Revision: 3, SnapshotSHA: hex.EncodeToString(firstHash[:])},
		{PrincipalID: "018f4b0d-08f8-7c09-9ba7-efdf9c223105", Revision: 4, SnapshotSHA: hex.EncodeToString(secondHash[:])},
	}
	lines := "018f4b0d-08f8-7c09-9ba7-efdf9c223104|3|" + hex.EncodeToString(firstHash[:]) + "\n" +
		"018f4b0d-08f8-7c09-9ba7-efdf9c223105|4|" + hex.EncodeToString(secondHash[:])
	manifest := sha256.Sum256([]byte(lines))

	ready, err := resyncManifestReady(2, manifest[:], items[:1])
	if err != nil || ready {
		t.Fatalf("incomplete batch = ready:%t err:%v, want fail closed", ready, err)
	}

	ready, err = resyncManifestReady(2, manifest[:], []resyncManifestItem{items[1], items[0]})
	if err != nil || !ready {
		t.Fatalf("complete matching batch = ready:%t err:%v, want ready", ready, err)
	}

	wrongManifest := sha256.Sum256([]byte("wrong"))
	ready, err = resyncManifestReady(2, wrongManifest[:], items)
	if err == nil || ready {
		t.Fatalf("wrong manifest = ready:%t err:%v, want fail closed", ready, err)
	}
}

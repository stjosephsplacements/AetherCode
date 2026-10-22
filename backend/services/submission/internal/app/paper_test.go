package app

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"testing"
	"time"
)

func TestBuildPaperFillsLegacyItemsAndDecryptsAnswers(t *testing.T) {
	t.Parallel()
	title, prompt, second := "Sum two numbers", "Print a + b.", 2
	stored := StoredPaper{
		AttemptID: "a", ExamID: "e",
		Items: []StoredPaperItem{
			{ExamItemID: "one", Title: &title, PromptMarkdown: &prompt, MaximumScore: "10.0000", SupportedLanguages: []string{"python3"},
				LatestAnswer: &StoredAnswerRef{Language: "python3", RevisionNumber: 3, SourceObjectKey: "k"}},
			{ExamItemID: "two", Position: &second, MaximumScore: "5.0000"},
		},
	}
	paper, err := buildPaper(t.Context(), stored, func(_ context.Context, reference StoredAnswerRef) (string, error) {
		if reference.SourceObjectKey != "k" {
			t.Fatalf("unexpected object key %q", reference.SourceObjectKey)
		}
		return "print(1)", nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if paper.Title != "" || len(paper.Items) != 2 {
		t.Fatalf("paper = %+v", paper)
	}
	first, legacy := paper.Items[0], paper.Items[1]
	if first.Position != 1 || first.Title != title || first.LatestAnswer == nil || first.LatestAnswer.Source != "print(1)" || first.LatestAnswer.RevisionNumber != 3 {
		t.Fatalf("first item = %+v", first)
	}
	if legacy.Position != 2 || legacy.Title != "Question 2" || legacy.PromptMarkdown != "" || legacy.LatestAnswer != nil || legacy.SupportedLanguages == nil {
		t.Fatalf("legacy item = %+v", legacy)
	}
}

func TestBuildPaperFailsWhenASourceCannotBeRead(t *testing.T) {
	t.Parallel()
	stored := StoredPaper{Items: []StoredPaperItem{{ExamItemID: "one", LatestAnswer: &StoredAnswerRef{}}}}
	_, err := buildPaper(t.Context(), stored, func(context.Context, StoredAnswerRef) (string, error) {
		return "", errors.New("kms down")
	})
	if err == nil {
		t.Fatal("expected the read error")
	}
}

type memoryObjects map[string][]byte

func (objects memoryObjects) Put(context.Context, string, io.Reader, int64, string) error { return nil }
func (objects memoryObjects) Get(_ context.Context, key string) (io.ReadCloser, int64, error) {
	return io.NopCloser(bytes.NewReader(objects[key])), int64(len(objects[key])), nil
}
func (objects memoryObjects) Delete(context.Context, string) error { return nil }
func (objects memoryObjects) Exists(_ context.Context, key string) (bool, error) {
	_, ok := objects[key]
	return ok, nil
}
func (objects memoryObjects) PresignGet(context.Context, string, time.Duration) (string, error) {
	return "", nil
}

type reversingKMS struct{}

func (reversingKMS) Encrypt(_ context.Context, plaintext []byte) ([]byte, string, error) {
	return reverse(plaintext), "test/key", nil
}
func (reversingKMS) Decrypt(_ context.Context, ciphertext []byte, keyRef string) ([]byte, error) {
	if keyRef != "test/key" {
		return nil, errors.New("unknown key")
	}
	return reverse(ciphertext), nil
}

func reverse(value []byte) []byte {
	out := make([]byte, len(value))
	for index, b := range value {
		out[len(value)-1-index] = b
	}
	return out
}

func TestReadSourceVerifiesTheChecksum(t *testing.T) {
	t.Parallel()
	ciphertext := reverse([]byte("print(42)"))
	digest := sha256.Sum256(ciphertext)
	service := &Service{storage: memoryObjects{"k": ciphertext}, kms: reversingKMS{}}
	reference := StoredAnswerRef{SourceObjectKey: "k", SourceChecksum: hex.EncodeToString(digest[:]), EncryptionKeyReference: "test/key"}
	source, err := service.readSource(t.Context(), reference)
	if err != nil || source != "print(42)" {
		t.Fatalf("source = %q, err = %v", source, err)
	}
	reference.SourceChecksum = hex.EncodeToString(make([]byte, 32))
	if _, err := service.readSource(t.Context(), reference); err == nil {
		t.Fatal("a checksum mismatch must be refused")
	}
}

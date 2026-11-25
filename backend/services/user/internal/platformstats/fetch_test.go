package platformstats

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestParseSkillrackProgramsSolved(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name string
		html string
		want []string
	}{
		{
			name: "primary markup",
			html: `<div>PROGRAMS SOLVED</div><i>badge</i>1,234</span>`,
			want: []string{"1,234 programs solved"},
		},
		{
			name: "plain text",
			html: `<p>Programs solved: 42</p>`,
			want: []string{"42 programs solved"},
		},
		{
			name: "missing",
			html: `<p>Nothing here</p>`,
			want: nil,
		},
	} {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := parseSkillrackProgramsSolved(tc.html)
			if len(got) != len(tc.want) {
				t.Fatalf("got %v want %v", got, tc.want)
			}
			for i := range got {
				if got[i] != tc.want[i] {
					t.Fatalf("got %q want %q", got[i], tc.want[i])
				}
			}
		})
	}
}

func TestGetHTML(t *testing.T) {
	t.Parallel()
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Content-Type", "text/html")
		_, _ = writer.Write([]byte(`<html>PROGRAMS SOLVED<i></i>12</html>`))
	}))
	t.Cleanup(server.Close)

	html, err := getHTML(context.Background(), server.Client(), server.URL)
	if err != nil {
		t.Fatal(err)
	}
	lines := parseSkillrackProgramsSolved(html)
	if len(lines) != 1 || lines[0] != "12 programs solved" {
		t.Fatalf("lines %v", lines)
	}
}

func TestSkillrackUnparseableIsFailed(t *testing.T) {
	t.Parallel()
	lines, status, err := skillrackFromHTML(`<p>Nothing here</p>`)
	if err == nil || status != "failed" || lines != nil {
		t.Fatalf("lines=%v status=%q err=%v", lines, status, err)
	}
}

func TestStaleOnRateLimit(t *testing.T) {
	t.Parallel()
	if staleOnRateLimit(nil) != "failed" {
		t.Fatal("expected failed for nil")
	}
	if staleOnRateLimit(errString("rate limited")) != "stale" {
		t.Fatal("expected stale for rate limit")
	}
}

type errString string

func (value errString) Error() string { return string(value) }

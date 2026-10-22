package httpadapter

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCommunityArgumentsPathValuesWinOverTheBody(t *testing.T) {
	t.Parallel()
	request := httptest.NewRequest(http.MethodPatch, "/x?limit=5&mine=true&q=go", strings.NewReader(`{"id":"from-body","done":true}`))
	request.SetPathValue("id", "from-path")
	args, err := communityArguments(request)
	if err != nil {
		t.Fatal(err)
	}
	if args["id"] != "from-path" || args["done"] != true || args["limit"] != 5 || args["mine"] != true || args["q"] != "go" {
		t.Fatalf("unexpected arguments: %v", args)
	}
}

func TestCommunityArgumentsRejectBadInput(t *testing.T) {
	t.Parallel()
	for name, target := range map[string]*http.Request{
		"flag":   httptest.NewRequest(http.MethodGet, "/x?mine=maybe", nil),
		"limit":  httptest.NewRequest(http.MethodGet, "/x?limit=many", nil),
		"array":  httptest.NewRequest(http.MethodPost, "/x", strings.NewReader(`[1]`)),
		"string": httptest.NewRequest(http.MethodPost, "/x", strings.NewReader(`"x"`)),
	} {
		if _, err := communityArguments(target); err == nil {
			t.Errorf("%s: expected an error", name)
		}
	}
}

func TestWrapItemsOnlyWrapsLists(t *testing.T) {
	t.Parallel()
	if got := string(wrapItems([]byte(`[{"a":1}]`))); got != `{"items":[{"a":1}]}` {
		t.Fatalf("list: %s", got)
	}
	if got := string(wrapItems([]byte(`{"a":1}`))); got != `{"a":1}` {
		t.Fatalf("object: %s", got)
	}
}

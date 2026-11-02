package app

import (
	"strings"
	"testing"
)

func TestSetPublicProfileNormalise(t *testing.T) {
	t.Parallel()
	good := SetPublicProfile{Slug: " Asha-Menon ", Enabled: true, Content: PublicProfileContent{
		Name: " Asha Menon ", Bio: strings.Repeat("x", 900), Skills: []string{" go ", "", "rust"},
		Links: []PublicProfileLink{{Platform: "GitHub", Handle: "asha", URL: "http://insecure.example"}, {Platform: "", Handle: "x"}},
	}}
	got, err := good.Normalise()
	if err != nil {
		t.Fatalf("Normalise() error = %v", err)
	}
	if got.Slug != "asha-menon" || got.Content.Name != "Asha Menon" || len(got.Content.Bio) != 600 {
		t.Fatalf("not normalised: %#v", got)
	}
	if len(got.Content.Skills) != 2 || len(got.Content.Links) != 1 || got.Content.Links[0].URL != "" {
		t.Fatalf("lists not cleaned (http links are dropped): %#v", got.Content)
	}
	for _, slug := range []string{"ab", "-bad", "Has Space", "admin", strings.Repeat("a", 40)} {
		if _, err := (SetPublicProfile{Slug: slug, Content: PublicProfileContent{Name: "N"}}).Normalise(); err == nil {
			t.Errorf("slug %q accepted", slug)
		}
	}
	if _, err := (SetPublicProfile{Slug: "valid-slug"}).Normalise(); err == nil {
		t.Error("a profile without a name was accepted")
	}
}

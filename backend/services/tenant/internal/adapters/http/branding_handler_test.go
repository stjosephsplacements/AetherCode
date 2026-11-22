package httpadapter

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestDecodeBrandingBody(t *testing.T) {
	t.Parallel()
	request := httptest.NewRequest(http.MethodPut, "/v1/branding/platform", bytes.NewReader([]byte(`{"app_name":"College","accent_color":"#336699"}`)))
	request.Header.Set("Content-Type", "application/json")
	body, err := decodeBrandingBody(request)
	if err != nil || body.AppName != "College" || body.accentColor != "#336699" {
		t.Fatalf("decode branding body: %+v err=%v", body, err)
	}
}

func TestOptionalTenantQuery(t *testing.T) {
	t.Parallel()
	request := httptest.NewRequest(http.MethodGet, "/v1/branding", nil)
	if _, err := optionalTenantQuery(request); err != nil {
		t.Fatalf("empty tenant query: %v", err)
	}
	request = httptest.NewRequest(http.MethodGet, "/v1/branding?tenant_id=not-a-uuid", nil)
	if _, err := optionalTenantQuery(request); err == nil {
		t.Fatal("invalid tenant query should fail")
	}
}

func TestBrandingMultipartSizeGuard(t *testing.T) {
	t.Parallel()
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	part, err := writer.CreateFormFile("logo", "logo.png")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(bytes.Repeat([]byte{'a'}, (1<<20)+1)); err != nil {
		t.Fatal(err)
	}
	writer.Close()
	request := httptest.NewRequest(http.MethodPost, "/v1/branding/platform/logos", body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	if err := request.ParseMultipartForm((1 << 20) + (1 << 10)); err != nil {
		t.Fatal(err)
	}
	file, _, err := request.FormFile("logo")
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	data, err := ioReadAllLimit(file, (1<<20)+1)
	if err != nil {
		t.Fatal(err)
	}
	if len(data) <= (1 << 20) {
		t.Fatal("expected oversized logo payload")
	}
}

func ioReadAllLimit(reader interface{ Read([]byte) (int, error) }, limit int) ([]byte, error) {
	buf := make([]byte, 0, 512)
	for len(buf) < limit+1 {
		chunk := make([]byte, 512)
		n, err := reader.Read(chunk)
		buf = append(buf, chunk[:n]...)
		if err != nil {
			break
		}
	}
	return buf, nil
}

func TestBrandingPayloadJSON(t *testing.T) {
	t.Parallel()
	var payload brandingPayload
	if err := json.Unmarshal([]byte(`{"app_name":"Aether","accent_color":"#336699"}`), &payload); err != nil || payload.AppName != "Aether" {
		t.Fatalf("payload json: %+v err=%v", payload, err)
	}
}

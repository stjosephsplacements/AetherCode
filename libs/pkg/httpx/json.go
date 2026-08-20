package httpx

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
)

const maximumJSONBodyBytes = 1 << 20

// Problem is the stable public error shape emitted by every REST adapter.
type Problem struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// DecodeJSON reads one strict JSON object from a bounded request body.
func DecodeJSON(request *http.Request, destination any) error {
	_, err := DecodeJSONRaw(request, destination)
	return err
}

// DecodeJSONRaw decodes one strict bounded JSON value and returns its exact
// bytes. Mutating handlers use the raw representation as their durable
// idempotency request fingerprint after validation.
func DecodeJSONRaw(request *http.Request, destination any) ([]byte, error) {
	if request == nil || request.Body == nil {
		return nil, apperrors.New(apperrors.CodeInvalidArgument, "JSON request body is required")
	}
	body, err := io.ReadAll(io.LimitReader(request.Body, maximumJSONBodyBytes+1))
	if err != nil {
		return nil, apperrors.New(apperrors.CodeInvalidArgument, "JSON request body is invalid")
	}
	if len(body) > maximumJSONBodyBytes {
		return nil, apperrors.New(apperrors.CodeInvalidArgument, "JSON request body is too large")
	}
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		if errors.Is(err, io.EOF) {
			return nil, apperrors.New(apperrors.CodeInvalidArgument, "JSON request body is required")
		}
		return nil, apperrors.New(apperrors.CodeInvalidArgument, "JSON request body is invalid")
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return nil, apperrors.New(apperrors.CodeInvalidArgument, "JSON request body must contain one value")
	}
	return body, nil
}

// WriteJSON serializes a response and always includes a JSON content type.
func WriteJSON(writer http.ResponseWriter, status int, value any) {
	writer.Header().Set("Content-Type", "application/json; charset=utf-8")
	writer.WriteHeader(status)
	if err := json.NewEncoder(writer).Encode(value); err != nil {
		return
	}
}

// WriteError maps a transport-independent application error to its REST
// status. Unexpected errors intentionally reveal no implementation details.
func WriteError(writer http.ResponseWriter, err error) {
	status := http.StatusInternalServerError
	problem := Problem{Code: "internal", Message: "internal server error"}
	var applicationError *apperrors.Error
	if errors.As(err, &applicationError) {
		problem.Code = string(applicationError.Code)
		problem.Message = applicationError.Message
		switch applicationError.Code {
		case apperrors.CodeInvalidArgument:
			status = http.StatusBadRequest
		case apperrors.CodeUnauthorized:
			status = http.StatusUnauthorized
		case apperrors.CodeForbidden:
			status = http.StatusForbidden
		case apperrors.CodeNotFound:
			status = http.StatusNotFound
		case apperrors.CodeConflict:
			status = http.StatusConflict
		case apperrors.CodeFailedPrecondition:
			status = http.StatusPreconditionFailed
		case apperrors.CodeUnavailable:
			status = http.StatusServiceUnavailable
		}
	}
	WriteJSON(writer, status, problem)
}

// BearerToken extracts one non-empty bearer credential without attempting to
// validate it. Validation belongs to the authenticated service boundary.
func BearerToken(request *http.Request) (string, error) {
	if request == nil {
		return "", apperrors.New(apperrors.CodeUnauthorized, "authorization bearer token is required")
	}
	parts := strings.Fields(request.Header.Get("Authorization"))
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") || strings.TrimSpace(parts[1]) == "" {
		return "", apperrors.New(apperrors.CodeUnauthorized, "authorization bearer token is required")
	}
	return parts[1], nil
}

// ParseUUIDPathValue retrieves a required, normalized UUID-style path value.
// It is intentionally generic so service adapters can decide whether an ID is
// a principal, tenant, or aggregate identifier.
func ParseUUIDPathValue(request *http.Request, name string) (string, error) {
	if request == nil {
		return "", apperrors.New(apperrors.CodeInvalidArgument, "request is required")
	}
	return ParseUUIDValue(request.PathValue(name), name)
}

// ParseUUIDValue validates a UUID supplied outside a path, such as a query
// parameter or a JSON field that selects a tenant authorization scope.
func ParseUUIDValue(raw, name string) (string, error) {
	value := strings.ToLower(strings.TrimSpace(raw))
	if len(value) != 36 {
		return "", apperrors.New(apperrors.CodeInvalidArgument, fmt.Sprintf("%s must be a UUID", name))
	}
	for index, character := range value {
		if index == 8 || index == 13 || index == 18 || index == 23 {
			if character != '-' {
				return "", apperrors.New(apperrors.CodeInvalidArgument, fmt.Sprintf("%s must be a UUID", name))
			}
			continue
		}
		if !(character >= '0' && character <= '9') && !(character >= 'a' && character <= 'f') {
			return "", apperrors.New(apperrors.CodeInvalidArgument, fmt.Sprintf("%s must be a UUID", name))
		}
	}
	return value, nil
}

// ParseEnumQuery validates an optional enumerated query filter. An absent
// parameter is not an error and returns "". A present value outside the allowed
// set is rejected, so a mistyped filter never silently returns an empty page.
// An empty value (?name=) is indistinguishable from absent, since url.Values
// cannot tell them apart, and is likewise treated as absent-or-empty, not an error.
func ParseEnumQuery(request *http.Request, name string, allowed ...string) (string, error) {
	raw := strings.TrimSpace(request.URL.Query().Get(name))
	if raw == "" {
		return "", nil
	}
	for _, candidate := range allowed {
		if raw == candidate {
			return raw, nil
		}
	}
	return "", apperrors.New(apperrors.CodeInvalidArgument,
		fmt.Sprintf("%s must be one of: %s", name, strings.Join(allowed, ", ")))
}

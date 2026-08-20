// Package errors defines transport-independent typed application errors.
package errors

import "fmt"

// Code is a stable machine-readable domain error identifier.
type Code string

const (
	CodeInvalidArgument    Code = "invalid_argument"
	CodeUnauthorized       Code = "unauthorized"
	CodeForbidden          Code = "forbidden"
	CodeNotFound           Code = "not_found"
	CodeConflict           Code = "conflict"
	CodeFailedPrecondition Code = "failed_precondition"
	CodeUnavailable        Code = "unavailable"
)

// Error preserves a stable code while retaining an optional underlying cause.
type Error struct {
	Code    Code
	Message string
	Cause   error
}

func (errorValue *Error) Error() string {
	if errorValue.Cause == nil {
		return fmt.Sprintf("%s: %s", errorValue.Code, errorValue.Message)
	}
	return fmt.Sprintf("%s: %s: %v", errorValue.Code, errorValue.Message, errorValue.Cause)
}

func (errorValue *Error) Unwrap() error { return errorValue.Cause }

// New constructs a domain error without exposing implementation details.
func New(code Code, message string) *Error {
	return &Error{Code: code, Message: message}
}

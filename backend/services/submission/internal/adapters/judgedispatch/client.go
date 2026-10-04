package judgedispatch

import (
	"context"
	"fmt"
	"time"

	judgev1 "github.com/aethercode/aethercode/libs/proto/gen/go/aethercode/judge/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// Client is the narrow submit surface used by the worker.
type Client interface {
	// Submit returns the job Judge accepted. A permanent rejection is reported
	// as a PermanentError; any other error is worth retrying.
	Submit(context.Context, *judgev1.SubmitExecutionRequest) (string, error)
}

// PermanentError wraps a rejection that no retry can fix: Judge found the
// request invalid, or its idempotency key already names a different request.
// Every other Judge status (unavailable, rate limited, language not yet
// enabled, internal) is transient.
type PermanentError struct{ Err error }

func (err *PermanentError) Error() string { return err.Err.Error() }
func (err *PermanentError) Unwrap() error { return err.Err }

type grpcClient struct {
	client     judgev1.JudgeServiceClient
	rpcTimeout time.Duration
}

// NewClient wraps a connection from judgecompletion.DialConnection.
func NewClient(connection grpc.ClientConnInterface, rpcTimeout time.Duration) Client {
	return &grpcClient{client: judgev1.NewJudgeServiceClient(connection), rpcTimeout: rpcTimeout}
}

func (client *grpcClient) Submit(contextValue context.Context, request *judgev1.SubmitExecutionRequest) (string, error) {
	callContext, cancel := context.WithTimeout(contextValue, client.rpcTimeout)
	defer cancel()
	response, err := client.client.SubmitExecution(callContext, request)
	if err != nil {
		wrapped := fmt.Errorf("submit Judge execution: %w", err)
		switch status.Code(err) {
		case codes.InvalidArgument, codes.AlreadyExists:
			return "", &PermanentError{Err: wrapped}
		}
		return "", wrapped
	}
	return response.GetJobId(), nil
}

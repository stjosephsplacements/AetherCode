package questionbank

import (
	"context"
	"errors"
	"net"
	"testing"

	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
	questionbankv1 "github.com/aethercode/aethercode/libs/proto/gen/go/aethercode/questionbank/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/status"
	"google.golang.org/grpc/test/bufconn"
)

type fakeServer struct {
	questionbankv1.UnimplementedQuestionBankInternalServiceServer
	response *questionbankv1.ResolvePublishedQuestionVersionResponse
	err      error
}

func (server *fakeServer) ResolvePublishedQuestionVersion(context.Context, *questionbankv1.ResolvePublishedQuestionVersionRequest) (*questionbankv1.ResolvePublishedQuestionVersionResponse, error) {
	return server.response, server.err
}

func clientFor(t *testing.T, server *fakeServer) *Client {
	t.Helper()
	listener := bufconn.Listen(1 << 20)
	grpcServer := grpc.NewServer()
	questionbankv1.RegisterQuestionBankInternalServiceServer(grpcServer, server)
	go func() { _ = grpcServer.Serve(listener) }()
	t.Cleanup(grpcServer.Stop)
	connection, err := grpc.NewClient("passthrough:///bufnet",
		grpc.WithContextDialer(func(context.Context, string) (net.Conn, error) { return listener.Dial() }),
		grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatalf("grpc.NewClient() error = %v", err)
	}
	t.Cleanup(func() { _ = connection.Close() })
	return New(connection)
}

func TestResolvePublishedQuestionVersion(t *testing.T) {
	t.Parallel()
	response := &questionbankv1.ResolvePublishedQuestionVersionResponse{
		QuestionId: "q", QuestionVersionId: "qv",
		EvaluationBundle: &questionbankv1.EncryptedBundle{ObjectKey: "eval", Sha256: "e", KeyReference: "k1"},
		SampleBundle:     &questionbankv1.EncryptedBundle{ObjectKey: "sample", Sha256: "s", KeyReference: "k2"},
		TimeLimitMs:      2000, MemoryLimitKib: 262144, SupportedLanguages: []string{"c", "python3"},
	}
	testCases := []struct {
		name     string
		server   *fakeServer
		wantCode apperrors.Code
	}{
		{name: "resolved", server: &fakeServer{response: response}},
		{name: "not found", server: &fakeServer{err: status.Error(codes.NotFound, "x")}, wantCode: apperrors.CodeNotFound},
		{name: "invalid argument", server: &fakeServer{err: status.Error(codes.InvalidArgument, "x")}, wantCode: apperrors.CodeInvalidArgument},
		{name: "server failure", server: &fakeServer{err: status.Error(codes.Internal, "x")}, wantCode: apperrors.CodeUnavailable},
		{name: "unavailable", server: &fakeServer{err: status.Error(codes.Unavailable, "x")}, wantCode: apperrors.CodeUnavailable},
	}
	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			resolved, err := clientFor(t, tc.server).ResolvePublishedQuestionVersion(t.Context(), "qv")
			if tc.wantCode == "" {
				if err != nil {
					t.Fatalf("error = %v", err)
				}
				if resolved.QuestionID != "q" || resolved.EvaluationBundle.KeyReference != "k1" ||
					resolved.SampleBundle.ObjectKey != "sample" || resolved.SampleBundle.KeyReference != "k2" ||
					resolved.TimeLimitMS != 2000 || resolved.MemoryLimitKiB != 262144 || len(resolved.SupportedLanguages) != 2 {
					t.Fatalf("resolved = %+v", resolved)
				}
				return
			}
			var appErr *apperrors.Error
			if !errors.As(err, &appErr) || appErr.Code != tc.wantCode {
				t.Fatalf("error = %v, want code %s", err, tc.wantCode)
			}
		})
	}
}

func TestLoadRuntime(t *testing.T) {
	testCases := []struct {
		name        string
		environment string
		env         map[string]string
		wantErr     bool
		wantMTLS    bool
	}{
		{name: "development defaults to insecure", environment: "development"},
		{name: "production requires certificates", environment: "production", wantErr: true},
		{name: "production with certificates", environment: "production", wantMTLS: true, env: map[string]string{
			"ASSESSMENT_QBANK_TLS_CERT_FILE": "c", "ASSESSMENT_QBANK_TLS_KEY_FILE": "k", "ASSESSMENT_QBANK_TLS_CA_FILE": "ca",
		}},
		{name: "partial certificates are rejected", environment: "development", wantErr: true, env: map[string]string{
			"ASSESSMENT_QBANK_TLS_CERT_FILE": "c",
		}},
		{name: "address without port is rejected", environment: "development", wantErr: true, env: map[string]string{
			"ASSESSMENT_QBANK_GRPC_ADDR": "qbank",
		}},
	}
	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("ASSESSMENT_QBANK_GRPC_ADDR", "qbank:9445")
			for _, key := range []string{"ASSESSMENT_QBANK_TLS_CERT_FILE", "ASSESSMENT_QBANK_TLS_KEY_FILE", "ASSESSMENT_QBANK_TLS_CA_FILE", "ASSESSMENT_QBANK_TLS_SERVER_NAME"} {
				t.Setenv(key, "")
			}
			for key, value := range tc.env {
				t.Setenv(key, value)
			}
			runtime, err := LoadRuntime(tc.environment)
			if (err != nil) != tc.wantErr {
				t.Fatalf("error = %v, wantErr %t", err, tc.wantErr)
			}
			if err == nil && runtime.RequireMTLS != tc.wantMTLS {
				t.Fatalf("RequireMTLS = %t, want %t", runtime.RequireMTLS, tc.wantMTLS)
			}
		})
	}
}

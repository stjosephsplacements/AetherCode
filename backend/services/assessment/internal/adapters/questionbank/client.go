// Package questionbank is Assessment's client for the Question Bank's private
// gRPC contract. It resolves published question versions into the encrypted
// bundle references an exam item pins.
package questionbank

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"net"
	"os"
	"strings"
	"time"

	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
	questionbankv1 "github.com/aethercode/aethercode/libs/proto/gen/go/aethercode/questionbank/v1"
	"github.com/aethercode/aethercode/services/assessment/internal/app"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/status"
)

const rpcTimeout = 5 * time.Second

// Runtime is the fail-closed Question Bank client configuration. Staging and
// production require a complete mutual-TLS identity; insecure transport is for
// isolated development profiles only.
type Runtime struct {
	Endpoint        string
	CertificateFile string
	KeyFile         string
	CAFile          string
	ServerName      string
	RequireMTLS     bool
}

// LoadRuntime reads the ASSESSMENT_QBANK_* settings.
func LoadRuntime(environment string) (Runtime, error) {
	environment = strings.ToLower(strings.TrimSpace(environment))
	runtime := Runtime{
		Endpoint:        strings.TrimSpace(env("ASSESSMENT_QBANK_GRPC_ADDR", "127.0.0.1:9445")),
		CertificateFile: strings.TrimSpace(env("ASSESSMENT_QBANK_TLS_CERT_FILE", "")),
		KeyFile:         strings.TrimSpace(env("ASSESSMENT_QBANK_TLS_KEY_FILE", "")),
		CAFile:          strings.TrimSpace(env("ASSESSMENT_QBANK_TLS_CA_FILE", "")),
		ServerName:      strings.TrimSpace(env("ASSESSMENT_QBANK_TLS_SERVER_NAME", "")),
		RequireMTLS:     environment == "staging" || environment == "production",
	}
	host, _, splitErr := net.SplitHostPort(runtime.Endpoint)
	if splitErr != nil || strings.Trim(host, "[]") == "" {
		return Runtime{}, fmt.Errorf("ASSESSMENT_QBANK_GRPC_ADDR must include a host and port")
	}
	configuredFiles := 0
	for _, path := range []string{runtime.CertificateFile, runtime.KeyFile, runtime.CAFile} {
		if path != "" {
			configuredFiles++
		}
	}
	if runtime.RequireMTLS && configuredFiles != 3 {
		return Runtime{}, fmt.Errorf("ASSESSMENT_QBANK_TLS_CERT_FILE, _KEY_FILE and _CA_FILE are required in %s", environment)
	}
	if configuredFiles != 0 && configuredFiles != 3 {
		return Runtime{}, fmt.Errorf("ASSESSMENT_QBANK_TLS_CERT_FILE, _KEY_FILE and _CA_FILE must be configured together")
	}
	runtime.RequireMTLS = configuredFiles == 3
	return runtime, nil
}

// Client implements app.QuestionBank over gRPC.
type Client struct {
	client questionbankv1.QuestionBankInternalServiceClient
}

// New wraps an established connection. Dial builds the production one.
func New(connection grpc.ClientConnInterface) *Client {
	return &Client{client: questionbankv1.NewQuestionBankInternalServiceClient(connection)}
}

// Dial configures a lazy connection: Assessment starts without the Question
// Bank, and calls fail as unavailable until it is reachable.
func Dial(runtime Runtime) (*Client, *grpc.ClientConn, error) {
	transportCredentials := insecure.NewCredentials()
	if runtime.RequireMTLS {
		tlsConfig, err := loadTLS(runtime)
		if err != nil {
			return nil, nil, err
		}
		transportCredentials = credentials.NewTLS(tlsConfig)
	}
	connection, err := grpc.NewClient(runtime.Endpoint, grpc.WithTransportCredentials(transportCredentials))
	if err != nil {
		return nil, nil, fmt.Errorf("configure Question Bank client: %w", err)
	}
	return New(connection), connection, nil
}

// ResolvePublishedQuestionVersion maps the contract's NOT_FOUND to an Assessment
// not-found error and every transport failure to unavailable.
func (client *Client) ResolvePublishedQuestionVersion(ctx context.Context, questionVersionID string) (app.ResolvedQuestionVersion, error) {
	callContext, cancel := context.WithTimeout(ctx, rpcTimeout)
	defer cancel()
	response, err := client.client.ResolvePublishedQuestionVersion(callContext, &questionbankv1.ResolvePublishedQuestionVersionRequest{
		QuestionVersionId: questionVersionID,
	})
	if err != nil {
		switch status.Code(err) {
		case codes.NotFound:
			return app.ResolvedQuestionVersion{}, apperrors.New(apperrors.CodeNotFound, "question version was not found or is not published")
		case codes.InvalidArgument:
			return app.ResolvedQuestionVersion{}, apperrors.New(apperrors.CodeInvalidArgument, "question version id is invalid")
		}
		return app.ResolvedQuestionVersion{}, apperrors.New(apperrors.CodeUnavailable, "question bank is unavailable")
	}
	return app.ResolvedQuestionVersion{
		QuestionID:        response.GetQuestionId(),
		QuestionVersionID: response.GetQuestionVersionId(),
		EvaluationBundle:  bundle(response.GetEvaluationBundle()),
		SampleBundle:      bundle(response.GetSampleBundle()),
	}, nil
}

func bundle(value *questionbankv1.EncryptedBundle) app.EncryptedBundle {
	return app.EncryptedBundle{
		ObjectKey: value.GetObjectKey(), SHA256: value.GetSha256(), KeyReference: value.GetKeyReference(),
	}
}

func loadTLS(runtime Runtime) (*tls.Config, error) {
	certificate, err := tls.LoadX509KeyPair(runtime.CertificateFile, runtime.KeyFile)
	if err != nil {
		return nil, fmt.Errorf("load Question Bank client certificate: %w", err)
	}
	caPEM, err := os.ReadFile(runtime.CAFile)
	if err != nil {
		return nil, fmt.Errorf("read Question Bank server CA: %w", err)
	}
	rootCAs := x509.NewCertPool()
	if !rootCAs.AppendCertsFromPEM(caPEM) {
		return nil, fmt.Errorf("question bank server CA contains no certificates")
	}
	serverName := runtime.ServerName
	if serverName == "" {
		host, _, _ := net.SplitHostPort(runtime.Endpoint) // LoadRuntime validated the endpoint.
		serverName = strings.Trim(host, "[]")
	}
	return &tls.Config{
		MinVersion:   tls.VersionTLS13,
		Certificates: []tls.Certificate{certificate},
		RootCAs:      rootCAs,
		ServerName:   serverName,
	}, nil
}

func env(key, fallback string) string {
	if value, found := os.LookupEnv(key); found {
		return value
	}
	return fallback
}

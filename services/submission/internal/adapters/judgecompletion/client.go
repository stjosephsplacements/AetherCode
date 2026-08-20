package judgecompletion

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"net"
	"os"
	"strings"
	"time"

	judgev1 "github.com/aethercode/aethercode/libs/proto/gen/go/aethercode/judge/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
)

// Client is the narrow receive/acknowledge surface used by the worker.
// SubmitExecution is deliberately absent so this bridge cannot admit work.
type Client interface {
	Pull(context.Context, string, uint32, uint32) ([]Completion, error)
	Acknowledge(context.Context, string, Completion) error
	Close() error
}

type grpcClient struct {
	client     judgev1.JudgeServiceClient
	connection *grpc.ClientConn
	rpcTimeout time.Duration
}

// Dial opens a verified TLS 1.3 connection to the private wrapper API.
func Dial(contextValue context.Context, runtime Runtime) (Client, error) {
	if !runtime.Enabled {
		return nil, fmt.Errorf("Judge completion bridge is disabled")
	}
	tlsConfig, err := loadClientTLS(runtime)
	if err != nil {
		return nil, err
	}
	dialContext, cancel := context.WithTimeout(contextValue, runtime.RPCTimeout)
	defer cancel()
	connection, err := grpc.DialContext(
		dialContext,
		runtime.Endpoint,
		grpc.WithTransportCredentials(credentials.NewTLS(tlsConfig)),
		grpc.WithBlock(),
	)
	if err != nil {
		return nil, fmt.Errorf("dial Judge completion API: %w", err)
	}
	return &grpcClient{
		client: judgev1.NewJudgeServiceClient(connection), connection: connection, rpcTimeout: runtime.RPCTimeout,
	}, nil
}

func (client *grpcClient) Pull(contextValue context.Context, consumerID string, limit, leaseSeconds uint32) ([]Completion, error) {
	callContext, cancel := context.WithTimeout(contextValue, client.rpcTimeout)
	defer cancel()
	response, err := client.client.PullCompletedExecutions(callContext, &judgev1.PullCompletedExecutionsRequest{
		ConsumerId: consumerID, Limit: limit, LeaseSeconds: leaseSeconds,
	})
	if err != nil {
		return nil, fmt.Errorf("pull Judge completions: %w", err)
	}
	completions := make([]Completion, 0, len(response.GetCompletions()))
	for _, value := range response.GetCompletions() {
		completion, parseErr := parseCompletion(value)
		if parseErr != nil {
			return nil, parseErr
		}
		completions = append(completions, completion)
	}
	return completions, nil
}

func (client *grpcClient) Acknowledge(contextValue context.Context, consumerID string, completion Completion) error {
	callContext, cancel := context.WithTimeout(contextValue, client.rpcTimeout)
	defer cancel()
	_, err := client.client.AcknowledgeCompletion(callContext, &judgev1.AcknowledgeCompletionRequest{
		ConsumerId: consumerID,
		EventId:    completion.JudgeEventID,
		DeliveryId: completion.DeliveryID,
		LeaseId:    completion.LeaseID,
	})
	if err != nil {
		return fmt.Errorf("acknowledge Judge completion: %w", err)
	}
	return nil
}

func (client *grpcClient) Close() error {
	if client == nil || client.connection == nil {
		return nil
	}
	return client.connection.Close()
}

func loadClientTLS(runtime Runtime) (*tls.Config, error) {
	certificate, err := tls.LoadX509KeyPair(runtime.CertificateFile, runtime.KeyFile)
	if err != nil {
		return nil, fmt.Errorf("load Judge completion client certificate: %w", err)
	}
	caPEM, err := os.ReadFile(runtime.CAFile)
	if err != nil {
		return nil, fmt.Errorf("read Judge completion server CA: %w", err)
	}
	rootCAs := x509.NewCertPool()
	if !rootCAs.AppendCertsFromPEM(caPEM) {
		return nil, fmt.Errorf("Judge completion server CA contains no certificates")
	}
	serverName := runtime.ServerName
	if serverName == "" {
		host, _, splitErr := net.SplitHostPort(runtime.Endpoint)
		if splitErr != nil {
			return nil, fmt.Errorf("split Judge completion endpoint: %w", splitErr)
		}
		serverName = strings.Trim(host, "[]")
	}
	return &tls.Config{
		MinVersion:   tls.VersionTLS13,
		Certificates: []tls.Certificate{certificate},
		RootCAs:      rootCAs,
		ServerName:   serverName,
	}, nil
}

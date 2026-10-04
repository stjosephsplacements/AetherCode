package grpcmtls

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"testing"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/peer"
	"google.golang.org/grpc/status"
)

func peerContext(version uint16, verified bool, commonName string) context.Context {
	certificate := &x509.Certificate{Subject: pkix.Name{CommonName: commonName}}
	state := tls.ConnectionState{Version: version, PeerCertificates: []*x509.Certificate{certificate}}
	if verified {
		state.VerifiedChains = [][]*x509.Certificate{{certificate}}
	}
	return peer.NewContext(context.Background(), &peer.Peer{AuthInfo: credentials.TLSInfo{State: state}})
}

func TestValidateClientSubject(t *testing.T) {
	t.Parallel()
	for name, scenario := range map[string]struct {
		context context.Context
		want    codes.Code
	}{
		"allowed subject":  {peerContext(tls.VersionTLS13, true, "assessment"), codes.OK},
		"other subject":    {peerContext(tls.VersionTLS13, true, "submission"), codes.PermissionDenied},
		"unverified chain": {peerContext(tls.VersionTLS13, false, "assessment"), codes.Unauthenticated},
		"TLS 1.2":          {peerContext(tls.VersionTLS12, true, "assessment"), codes.Unauthenticated},
		"no peer at all":   {context.Background(), codes.Unauthenticated},
	} {
		if got := status.Code(validateClientSubject(scenario.context, "Question Bank", []string{"assessment"})); got != scenario.want {
			t.Fatalf("%s: code = %s, want %s", name, got, scenario.want)
		}
	}
}

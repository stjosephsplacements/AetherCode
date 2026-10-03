package grpc

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"net/url"
	"testing"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/peer"
	"google.golang.org/grpc/status"
)

const submissionSPIFFEID = "spiffe://aethercode.local/ns/platform/sa/submission"

func TestRequireCallerTargetSPIFFEIDsRejectsCommonNameOnlyCertificate(t *testing.T) {
	t.Parallel()
	interceptor := RequireCallerTargetSPIFFEIDs(map[string]string{submissionSPIFFEID: "submission"})
	contextValue := verifiedPeerContext(t, "submission", nil)

	called := false
	_, err := interceptor(contextValue, nil, &grpc.UnaryServerInfo{}, func(context.Context, any) (any, error) {
		called = true
		return nil, nil
	})
	if status.Code(err) != codes.Unauthenticated {
		t.Fatalf("interceptor error code = %s, want %s", status.Code(err), codes.Unauthenticated)
	}
	if called {
		t.Fatal("handler ran for a certificate authorized only by Common Name")
	}
}

func TestRequireCallerTargetSPIFFEIDsBindsVerifiedCallerToTargetService(t *testing.T) {
	t.Parallel()
	interceptor := RequireCallerTargetSPIFFEIDs(map[string]string{submissionSPIFFEID: "submission"})
	contextValue := verifiedPeerContext(t, "untrusted-common-name", []string{submissionSPIFFEID})

	called := false
	_, err := interceptor(contextValue, nil, &grpc.UnaryServerInfo{}, func(contextValue context.Context, _ any) (any, error) {
		called = true
		identity, found := CallerIdentityFromContext(contextValue)
		if !found {
			t.Fatal("trusted caller identity was not attached to context")
		}
		if identity.SPIFFEID != submissionSPIFFEID || identity.TargetService != "submission" {
			t.Fatalf("caller identity = %#v", identity)
		}
		return nil, nil
	})
	if err != nil {
		t.Fatalf("interceptor error = %v", err)
	}
	if !called {
		t.Fatal("handler did not run for the configured SPIFFE URI SAN")
	}
}

func TestRequireCallerTargetSPIFFEIDsRejectsUnmappedOrAmbiguousSANs(t *testing.T) {
	t.Parallel()
	interceptor := RequireCallerTargetSPIFFEIDs(map[string]string{
		submissionSPIFFEID: "submission",
		"spiffe://aethercode.local/ns/platform/sa/assessment": "assessment",
	})

	for _, testCase := range []struct {
		name string
		uris []string
	}{
		{name: "unmapped", uris: []string{"spiffe://aethercode.local/ns/platform/sa/unknown"}},
		{name: "ambiguous", uris: []string{submissionSPIFFEID, "spiffe://aethercode.local/ns/platform/sa/assessment"}},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			contextValue := verifiedPeerContext(t, "submission", testCase.uris)
			_, err := interceptor(contextValue, nil, &grpc.UnaryServerInfo{}, func(context.Context, any) (any, error) {
				t.Fatal("handler ran for an unauthorized caller identity")
				return nil, nil
			})
			if status.Code(err) != codes.Unauthenticated {
				t.Fatalf("interceptor error code = %s, want %s", status.Code(err), codes.Unauthenticated)
			}
		})
	}
}

func verifiedPeerContext(t *testing.T, commonName string, rawURIs []string) context.Context {
	t.Helper()
	certificate := &x509.Certificate{Subject: pkixName(commonName)}
	for _, rawURI := range rawURIs {
		uri, err := url.Parse(rawURI)
		if err != nil {
			t.Fatalf("parse URI %q: %v", rawURI, err)
		}
		certificate.URIs = append(certificate.URIs, uri)
	}
	return peer.NewContext(context.Background(), &peer.Peer{AuthInfo: credentials.TLSInfo{
		State: tls.ConnectionState{
			Version:        tls.VersionTLS13,
			VerifiedChains: [][]*x509.Certificate{{certificate}},
		},
	}})
}

func pkixName(commonName string) pkix.Name {
	return pkix.Name{CommonName: commonName}
}

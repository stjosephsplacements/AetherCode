package authn

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func tokenExpiringAt(expiry time.Time) string {
	payload, _ := json.Marshal(map[string]int64{"exp": expiry.Unix()})
	return "h." + base64.RawURLEncoding.EncodeToString(payload) + ".s"
}

func cachingValidator(t *testing.T, ttl time.Duration, answer func() int) (*SessionValidator, *atomic.Int32, *time.Time) {
	t.Helper()
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		w.WriteHeader(answer())
	}))
	t.Cleanup(server.Close)
	endpoint, _ := url.Parse(server.URL)
	clock := time.Now()
	validator := &SessionValidator{
		endpoint: endpoint, client: server.Client(), ttl: ttl, now: func() time.Time { return clock },
		valid: make(map[[sha256.Size]byte]time.Time), inflight: make(map[[sha256.Size]byte]*validation),
	}
	return validator, &calls, &clock
}

func TestValidateWithoutATTLAsksIdentityEveryTime(t *testing.T) {
	validator, calls, clock := cachingValidator(t, 0, func() int { return http.StatusNoContent })
	token := tokenExpiringAt(clock.Add(time.Hour))
	for range 3 {
		if err := validator.Validate(context.Background(), token); err != nil {
			t.Fatal(err)
		}
	}
	if calls.Load() != 3 {
		t.Fatalf("identity was asked %d times, want 3", calls.Load())
	}
}

func TestValidateReusesASuccessUntilTheTTLThenAsksAgain(t *testing.T) {
	status := http.StatusNoContent
	validator, calls, clock := cachingValidator(t, 10*time.Second, func() int { return status })
	token := tokenExpiringAt(clock.Add(time.Hour))
	for range 5 {
		if err := validator.Validate(context.Background(), token); err != nil {
			t.Fatal(err)
		}
	}
	if calls.Load() != 1 {
		t.Fatalf("identity was asked %d times inside the TTL, want 1", calls.Load())
	}
	*clock = clock.Add(11 * time.Second)
	status = http.StatusUnauthorized // revoked meanwhile
	if err := validator.Validate(context.Background(), token); err == nil {
		t.Fatal("a revoked token was accepted after the TTL")
	}
	if calls.Load() != 2 {
		t.Fatalf("identity was asked %d times, want a second after the TTL", calls.Load())
	}
}

func TestValidateNeverCachesFailuresOrOutlivesTheToken(t *testing.T) {
	status := http.StatusUnauthorized
	validator, calls, clock := cachingValidator(t, 30*time.Second, func() int { return status })
	token := tokenExpiringAt(clock.Add(5 * time.Second))
	for range 2 {
		if validator.Validate(context.Background(), token) == nil {
			t.Fatal("a rejected token was accepted")
		}
	}
	if calls.Load() != 2 {
		t.Fatalf("a failure was cached: %d calls", calls.Load())
	}
	status = http.StatusNoContent
	if err := validator.Validate(context.Background(), token); err != nil {
		t.Fatal(err)
	}
	*clock = clock.Add(6 * time.Second) // past the token's own expiry, well inside the 30 s TTL
	validator.Validate(context.Background(), token)
	if calls.Load() != 4 {
		t.Fatalf("a cached answer outlived the token: %d calls", calls.Load())
	}
	if err := validator.Validate(context.Background(), "not-a-jwt"); err != nil {
		t.Fatal(err)
	}
	validator.Validate(context.Background(), "not-a-jwt")
	if calls.Load() != 6 {
		t.Fatalf("a token with no readable expiry was cached: %d calls", calls.Load())
	}
}

func TestValidateSharesOneCallBetweenConcurrentChecks(t *testing.T) {
	release := make(chan struct{})
	validator, calls, clock := cachingValidator(t, 10*time.Second, func() int { <-release; return http.StatusNoContent })
	token := tokenExpiringAt(clock.Add(time.Hour))
	var wg sync.WaitGroup
	for range 20 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := validator.Validate(context.Background(), token); err != nil {
				t.Error(err)
			}
		}()
	}
	time.Sleep(100 * time.Millisecond)
	close(release)
	wg.Wait()
	if calls.Load() != 1 {
		t.Fatalf("20 concurrent checks made %d calls, want 1", calls.Load())
	}
}

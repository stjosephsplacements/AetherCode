package telemetry

import (
	"time"

	"github.com/prometheus/client_golang/prometheus"
)

// stageDuration times the stages of an authorization decision (client round trip, the User service's handling, the
// identity introspection it makes, the database transaction's set_context), so a slow request can be attributed to a
// stage instead of guessed at. Buckets run from 1 ms to 30 s.
var stageDuration = prometheus.NewHistogramVec(prometheus.HistogramOpts{
	Name:    "authz_stage_duration_seconds",
	Help:    "Duration of one stage of an authorization decision, by stage and outcome (ok or error).",
	Buckets: []float64{.001, .0025, .005, .01, .025, .05, .1, .25, .5, 1, 2.5, 5, 10, 30},
}, []string{"stage", "outcome"})

func init() { prometheus.MustRegister(stageDuration) }

// ObserveStage records how long a stage took since start. Call it with the error the stage returned.
func ObserveStage(stage string, start time.Time, err error) {
	outcome := "ok"
	if err != nil {
		outcome = "error"
	}
	stageDuration.WithLabelValues(stage, outcome).Observe(time.Since(start).Seconds())
}

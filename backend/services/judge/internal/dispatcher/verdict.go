package dispatcher

import "slices"

// verdictPrecedence ranks unit verdicts from most to least severe. It mirrors
// the exam-v1 grader (apps/exam-v1/lib/grade.ts) so a job's overall verdict
// does not depend on which unit happened to fail first.
// memory_limit_exceeded sits beside time_limit_exceeded, the other resource
// limit, which exam-v1 has no separate verdict for.
var verdictPrecedence = []string{
	"compile_error", "internal_error", "runtime_error",
	"time_limit_exceeded", "memory_limit_exceeded", "wrong_answer",
}

// OverallVerdict reduces unit verdicts to the job's verdict: the most severe
// one present, or accepted when every unit passed. Verdicts outside the
// precedence list (such as cancelled) count as internal_error rather than
// being mistaken for a pass.
func OverallVerdict(unitVerdicts []string) string {
	overall := "accepted"
	overallRank := len(verdictPrecedence)
	for _, verdict := range unitVerdicts {
		if verdict == "accepted" {
			continue
		}
		rank := slices.Index(verdictPrecedence, verdict)
		if rank < 0 {
			verdict = "internal_error"
			rank = slices.Index(verdictPrecedence, verdict)
		}
		if rank < overallRank {
			overall, overallRank = verdict, rank
		}
	}
	return overall
}

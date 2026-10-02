-- The one scoring rule, per attempt and slot:
--   coding: best graded submission, points × passed weight ÷ total weight;
--   multiple choice: full points when the selected set equals the correct set.
CREATE VIEW slot_scores AS
SELECT attempt_id, slot, max(score) AS score
FROM (
    SELECT s.attempt_id, aq.slot,
        round(aq.points * s.earned_weight::numeric / nullif(s.total_weight, 0), 2) AS score
    FROM submissions s
    JOIN attempt_questions aq ON aq.attempt_id = s.attempt_id AND aq.question_id = s.question_id
    WHERE s.kind = 'submit' AND s.status = 'done'
    UNION ALL
    SELECT m.attempt_id, aq.slot,
        CASE WHEN (SELECT array_agg(DISTINCT x ORDER BY x) FROM unnest(m.selected) x)
                = (SELECT array_agg(DISTINCT x ORDER BY x) FROM unnest(q.mcq_correct) x)
            THEN aq.points ELSE 0 END::numeric
    FROM mcq_answers m
    JOIN attempt_questions aq ON aq.attempt_id = m.attempt_id AND aq.question_id = m.question_id
    JOIN questions q ON q.id = m.question_id AND q.kind = 'mcq'
) scored
GROUP BY attempt_id, slot;

// Response shapes of the platform endpoints the frontend uses. The services'
// api/openapi.yaml files are the source of truth.

export type Problem = { code: string; message: string };

export type Page<T> = { items: T[]; next_cursor?: string };

export type RoleName =
  | "super_admin"
  | "placement_user"
  | "college_admin"
  | "department_user"
  | "mentor"
  | "student";

/** GET /user/v1/me */
export type Me = {
  principal_id: string;
  roles: {
    role_name: RoleName;
    scope_kind: string;
    tenant_id?: string;
    scope_id?: string;
  }[];
  student: { tenant_id: string } | null;
};

/** GET /identity/v1/principals/{self} */
export type Principal = {
  id: string;
  username?: string;
  email?: string;
  display_name: string;
};

/** GET /assessment/v1/tenants/{t}/candidate-assignments */
export type CandidateAssignment = {
  id: string;
  tenant_id: string;
  exam_id: string;
  exam_version_id: string;
  title: string;
  instructions_markdown: string;
  duration_seconds: number;
  available_from: string;
  available_until: string;
  lifecycle_state: "assigned" | "revoked" | "started" | "completed" | "expired";
};

export type AttemptState = "created" | "active" | "submitted" | "grading" | "graded" | "expired" | "cancelled";

/** GET /submission/v1/tenants/{t}/attempts/{id} */
export type Attempt = {
  id: string;
  tenant_id: string;
  exam_id: string;
  exam_version_id: string;
  candidate_assignment_id: string;
  attempt_number: number;
  lifecycle_state: AttemptState;
  submission_deadline: string;
  started_at: string | null;
  submitted_at: string | null;
  completed_at: string | null;
  version: number;
};

/** GET /submission/v1/tenants/{t}/attempts/{id}/paper */
export type Paper = {
  attempt_id: string;
  exam_id: string;
  title: string;
  instructions_markdown: string;
  items: PaperItem[];
};

export type PaperItem = {
  exam_item_id: string;
  position: number;
  title: string;
  prompt_markdown: string;
  maximum_score: string;
  supported_languages: string[];
  time_limit_ms: number;
  memory_limit_kib: number;
  /** The candidate's latest saved answer, so a reload or a crashed browser resumes where it left off. */
  latest_answer: { language: string; source: string; revision_number: number } | null;
  /** "coding" or "mcq" (ADR-0035). Options come in this student's order with their authored index. */
  kind: "coding" | "mcq";
  choices?: { index: number; text: string }[];
  multiple_choice: boolean;
  latest_choice: number[] | null;
};

/** PUT .../answers/{item}: one saved answer revision (metadata only). */
export type AnswerRevision = {
  id: string;
  exam_item_id: string;
  revision_number: number;
  language_id: string;
  created_at: string;
  attempt_version: number;
};

export type RunUnit = {
  unit_number: number;
  verdict: string;
  stdin: string | null;
  expected_output: string | null;
  stdout: string | null;
  stderr: string | null;
  compile_output: string | null;
  execution_time_ms: number | null;
  memory_kib: number | null;
};

export type CodeRun = {
  id: string;
  exam_item_id: string;
  language_id: string;
  lifecycle_state: "queued" | "dispatched" | "completed" | "failed" | "cancelled";
  verdict: string | null;
  passed_units?: number;
  total_units?: number;
  created_at: string;
  completed_at: string | null;
  units?: RunUnit[];
};

/** GET .../items/{item}/submissions: evaluations of one question, newest first. */
export type ItemSubmission = {
  id: string;
  origin: "item_submit" | "final";
  lifecycle_state: "queued" | "dispatched" | "completed" | "failed" | "cancelled";
  language_id?: string;
  revision_number?: number;
  queued_at: string;
  completed_at: string | null;
  verdict: string | null;
  score: string | null;
  maximum_score?: string;
  passed_units: number | null;
  total_units: number | null;
  /** Hidden tests are reported as counts per verdict only. */
  verdict_counts: Record<string, number>;
};

// ---- Staff --------------------------------------------------------------

export type Tenant = { id: string; slug: string; legal_name: string; display_name: string; status: string };

export type Department = {
  id: string;
  tenant_id?: string;
  placement_organization_id?: string;
  department_type: "college" | "placement";
  code: string;
  name: string;
  status: string;
};

export type Batch = { id: string; tenant_id: string; department_id: string; code: string; name: string; academic_year: string; status: string };

export type PlacementOrganization = { id: string; code: string; legal_name: string; status: string };

export type Student = {
  id: string;
  principal_id: string;
  enrollment_number: string;
  status: string;
  college_department_id?: string;
  placement_department_id?: string;
};

export type IssuedCredential = { principal_id: string; username?: string; display_name: string; password: string };

export type ImportedStudent = { student_id: string; principal_id: string; roll_number: string; name: string; username: string; password: string };

export type StudentImportResult = { imported: ImportedStudent[]; skipped: string[] };

export type QuestionVersion = {
  id: string;
  question_id: string;
  version_number: number;
  title: string;
  prompt_markdown: string;
  difficulty: "easy" | "medium" | "hard";
  supported_languages: string[];
  time_limit_ms: number;
  memory_limit_kib: number;
  status: "draft" | "published" | "retired";
  published_at?: string;
  /** Set once the author asks for a review (ADR-0044). */
  review_requested_at?: string;
  review_requested_by?: string;
  /** Who the review request waits for; a hint, any other staff member may approve. */
  assigned_reviewer_id?: string;
  version: number;
  sample_test_case_count: number;
  hidden_test_case_count: number;
  /** "coding" or "mcq" (ADR-0035); authors see the answer key. */
  kind: "coding" | "mcq";
  choices: string[] | null;
  correct_choices: number[] | null;
  multiple_choice: boolean;
  /** The question's: test questions never reach practice (ADR-0041). */
  audience?: Audience;
};

export type Audience = "test" | "practice";

export type QuestionDetail = {
  question: { id: string; slug: string; lifecycle_state: string; version: number; audience?: Audience };
  question_version: QuestionVersion;
};

/** GET /question-bank/v1/tenants/{t}/practice/questions: the catalogue with the student's progress. */
export type PracticeProblem = {
  question_id: string;
  slug: string;
  title: string;
  difficulty: "easy" | "medium" | "hard";
  tags: string[];
  solved: boolean;
  attempted: boolean;
};

export type PracticeQuestion = {
  question_id: string;
  question_version_id: string;
  title: string;
  prompt_markdown: string;
  difficulty: "easy" | "medium" | "hard";
  languages: string[];
  time_limit_ms: number;
  memory_limit_kib: number;
  tags: string[];
  samples: { input: string; expected_output: string }[];
};

export type PracticeUnit = {
  unit_number: number;
  verdict: string;
  weight: number;
  time_ms?: number;
  memory_kib?: number;
  stdin?: string;
  expected_output?: string;
  stdout?: string;
  stderr?: string;
  compile_output?: string;
};

export type PracticeRun = {
  id: string;
  question_id: string;
  mode: "run" | "submit";
  custom_input: boolean;
  language: string;
  lifecycle_state: "queued" | "completed" | "failed";
  verdict: string | null;
  units: PracticeUnit[];
  passed_units: number;
  total_units: number;
  requested_at: string;
  completed_at: string | null;
  /** Only on GET .../practice/submissions/{id}. */
  source?: string;
};

export type PracticeProgress = {
  available: number;
  solved: number;
  by_difficulty: Partial<Record<"easy" | "medium" | "hard", { available: number; solved: number }>>;
  submissions: number;
  accepted: number;
  /** Days with practice activity in the last year, YYYY-MM-DD in IST. */
  active_days: string[];
};

export type Exam = { id: string; tenant_id: string; external_reference?: string; lifecycle_state: string; version: number; created_at: string };

export type ExamVersion = {
  id: string;
  exam_id: string;
  version_number: number;
  content_version: number;
  title: string;
  instructions_markdown: string;
  opens_at: string;
  closes_at: string;
  duration_seconds: number;
  proctor_policy_version_id: string;
  status: "draft" | "published" | "retired";
};

export type ExamVersionContent = {
  sections: {
    id: string;
    position: number;
    title: string;
    /** A pool: each student gets this many of the section's questions (ADR-0034). */
    draw_count: number | null;
    items: { id: string; position: number; question_version_id: string; question_title: string | null; maximum_score: string }[];
  }[];
  assignment_rules: {
    id: string;
    target_type: "batch" | "department" | "placement_department" | "student";
    target_id: string;
    available_from: string;
    available_until: string;
    disabled_at: string | null;
    assigned_candidates: number;
  }[];
};

export type ProctorPolicy = { id: string; name: string; version: number; lifecycle_state: string };
export type ProctorPolicyVersion = { id: string; proctor_policy_id: string; version_number: number; status: string };

export type SebPolicy = { enabled: boolean; accepted_keys: string[]; allowed_networks: string[]; title: string };

/** GET /analytics/v1/tenants/{t}/exam-results?exam_version_id= */
export type ExamResult = {
  candidate_id: string;
  attempt_id: string;
  attempt_number: number;
  lifecycle_state: string;
  score: string;
  maximum_score: string;
  submitted_at: string | null;
  graded_at: string | null;
};

/** A message staff post to everyone sitting an exam (ADR-0027). */
export type Announcement = { id: string; body: string; created_at: string };

/** One assigned candidate on the live monitor; attempt fields are null until they start. */
export type MonitorCandidate = {
  candidate_id: string;
  attempt_id: string | null;
  lifecycle_state: string | null;
  started_at: string | null;
  submission_deadline: string | null;
  submitted_at: string | null;
  items_answered: number;
  score: number | null;
  maximum_score: number | null;
  /** Integrity events: left the window, left fullscreen, blocked pastes (ADR-0037). */
  flags: number;
};

export type ExamMonitor = {
  exam_version_id: string;
  require_fullscreen: boolean;
  block_external_paste: boolean;
  results_released_at: string | null;
  announcements: Announcement[];
  candidates: MonitorCandidate[];
};

/** What an open exam screen polls: staff may extend the deadline or post a message. */
export type AttemptLiveState = {
  lifecycle_state: string;
  submission_deadline: string;
  announcements: Announcement[];
  /** Exam integrity (ADR-0037). */
  require_fullscreen: boolean;
  block_external_paste: boolean;
};

/** A candidate's score, present only after staff release results. */
export type AttemptResult =
  | { released: false }
  | {
      released: true;
      released_at: string;
      score: number;
      maximum_score: number;
      items: {
        exam_item_id: string;
        position: number | null;
        title: string | null;
        score: number;
        maximum_score: number;
        kind?: "coding" | "mcq";
        /** The best evaluation's verdict per test, by number only (ADR-0038). */
        tests?: { number: number; verdict: string }[];
      }[];
    };

/** GET /submission/v1/tenants/{t}/attempts/{a}/review: the staff view of one attempt (ADR-0029). */
export type AttemptReview = {
  attempt: {
    id: string;
    exam_id: string;
    exam_version_id: string;
    candidate_id: string;
    attempt_number: number;
    lifecycle_state: string;
    started_at: string | null;
    submission_deadline: string;
    submitted_at: string | null;
    completed_at: string | null;
    title: string | null;
  };
  score: { score: string; maximum_score: string } | null;
  items: {
    exam_item_id: string;
    position: number | null;
    title: string | null;
    maximum_score: string;
    best_score: string | null;
    latest_answer: { language: string; revision_number: number; saved_at: string; source: string } | null;
    evaluations: {
      origin: "final" | "item_submit";
      lifecycle_state: string;
      language: string;
      revision_number: number;
      queued_at: string;
      verdict: string | null;
      score: string | null;
      verdict_counts: Record<string, number>;
    }[];
  }[];
  events: { occurred_at: string; event_type: string; actor_id: string | null; payload: Record<string, unknown> }[];
};

/** GET /submission/v1/tenants/{t}/exam-versions/{v}/similarity (ADR-0031). */
export type QuestionSimilarity = {
  exam_item_id: string;
  position: number | null;
  title: string | null;
  programs: number;
  pairs: {
    score: number;
    shared: number;
    a: { attempt_id: string; candidate_id: string; language: string };
    b: { attempt_id: string; candidate_id: string; language: string };
  }[];
};

/** GET /question-bank/v1/question-versions/{id}/model-checks (ADR-0033). */
export type ModelCheck = {
  id: string;
  language: string;
  lifecycle_state: "queued" | "completed" | "failed";
  verdict: string | null;
  units: { unit_number: number; verdict: string; weight: number; time_ms?: number }[];
  requested_at: string;
  completed_at: string | null;
  /** True when it ran on the version's tests as they are now (ADR-0047). */
  current?: boolean;
};

/** One kind of Judge work in GET /submission/v1/tenants/{t}/grading-queue (ADR-0043). */
export type QueueStats = {
  queued: number;
  dispatched: number;
  oldest_waiting_at: string | null;
  completed_last_hour: number;
  failed_last_hour: number;
  median_seconds_last_hour: number | null;
  p95_seconds_last_hour: number | null;
};

export type GradingQueue = { checked_at: string; evaluations: QueueStats; runs: QueueStats };

/** GET /user/v1/role-assignments (X-Tenant-ID). */
export type RoleAssignment = {
  id: string;
  principal_id: string;
  role_name: RoleName;
  scope_kind: string;
  tenant_id?: string;
  scope_id?: string;
  status: string;
  created_at: string;
};

/** POST /user/v1/tenants/{t}/accounts/describe (ADR-0043). */
export type AccountSummary = { principal_id: string; username?: string; email?: string; display_name: string; status: string };

/** GET /user/v1/tenants/{t}/staff-audit (ADR-0043): one staff write decision. */
export type AuditEntry = {
  occurred_at: string;
  principal_id: string;
  service: string;
  resource_type: string;
  resource_id: string;
  allowed: boolean;
};

/** Community content, served by the notification service (ADR-0048). */
export type InterviewRound = { title: string; description?: string };

export type InterviewExperience = {
  id: string;
  company: string;
  role: string;
  experience_level: "intern" | "fresher" | "experienced";
  drive_type: "on-campus" | "off-campus" | "pool-campus";
  package_offered: string | null;
  year_of_interview: number | null;
  preparation_resources: string | null;
  rounds: InterviewRound[];
  verdict: "selected" | "rejected" | "waitlisted";
  tips: string | null;
  status: "pending" | "approved" | "rejected";
  review_note: string | null;
  mine: boolean;
  created_at: string;
  /** Only staff see who wrote it. */
  author_id: string | null;
};

export type CommunityPost = {
  id: string;
  title: string;
  tags: string[];
  status: "draft" | "published";
  published_at: string | null;
  updated_at: string;
  excerpt: string;
  body_markdown?: string;
};

export type FeedKind = "contest" | "hackathon" | "opensource";

export type FeedItem = {
  id: string;
  kind: FeedKind;
  title: string;
  description: string | null;
  url: string;
  platform: string | null;
  starts_at: string | null;
  ends_at: string | null;
  tags: string[];
  bookmarked: boolean;
  phase: "upcoming" | "live" | "ended";
};

export type PlatformName = "leetcode" | "github" | "codeforces" | "codechef" | "hackerrank";
export type ProfileLink = { platform: PlatformName; handle: string };

export type PersonalTask = { id: string; title: string; due_at: string | null; done: boolean };

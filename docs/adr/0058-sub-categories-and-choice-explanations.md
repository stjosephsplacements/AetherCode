# ADR-0058: Sub-categories, and an explanation for each multiple-choice option

- Status: proposed
- Date: 2026-11-02

## Context

Comparing the question library with the reference product (`siva0990/finalized-codepro`)
leaves two gaps. Everything else it has (guided authoring, categories, tags, hidden and
sample tests, verification, import, delete, edit, practice or test audience) we already do.

1. **Two levels of grouping.** The reference files a question under a main module and a
   sub-module (Algorithms, then Trees). Our `qbank.categories` is one flat list
   (ADR-0052), so a library with many topics becomes a long row of folders.
2. **Explaining a multiple-choice answer.** The reference lets the author write why an
   option is right or wrong, and shows it to the student after they answer. Our
   `question_versions.choices` is a list of plain strings with `correct_choices` beside it.

## Decision

### Sub-categories: one level of nesting

`qbank.categories` gains `parent_id uuid REFERENCES qbank.categories(id) ON DELETE RESTRICT`,
null for a top-level category. Rules, enforced in the database so every path honours them:

- Depth is two at most. A category with a parent cannot be a parent (a trigger checks it).
- A name is unique among its siblings: the existing global unique `normalized_name` becomes
  unique on `(coalesce(parent_id, nil-uuid), normalized_name)`. Two different parents may each
  have "Basics".
- "Uncategorised" stays a top-level category and cannot be given a parent or children.
- A question still points at exactly one category (`category_id`); it may point at a top-level
  category or a sub-category. Filing under a parent directly stays valid.

Routes (the existing ones keep working and treat a missing parent as top level):

| Route | Change |
| --- | --- |
| `GET /v1/categories` | each item gains `parent_id`; `question_count` is the category's own count, and top-level items add `question_count_total` (own plus children) |
| `POST /v1/categories` | accepts optional `parent_id` |
| `PATCH /v1/categories/{id}` | renames; accepts `parent_id` to move (top level to sub-category only if it has no children; sub-category to another parent or to top level) |
| `DELETE /v1/categories/{id}` | refused while it has questions **or** children (ADR-0053's "only while nothing depends on it") |

Authorisation is unchanged: the same permission that creates a category creates a
sub-category, and every write is in the staff audit log with the parent in the entry.

The folder view shows top-level categories as folders, and opening one shows its
sub-categories as folders above its questions. A breadcrumb replaces the back button. The
question wizard's category picker becomes a grouped list (parent, then its children).

### Option explanations

`question_versions` gains `choice_explanations jsonb`, null or an array the same length as
`choices` whose entries are text (up to 1,000 characters) or null. A check keeps the lengths
equal, so an option can never lose its explanation by index drift.

- **Authoring.** Create, update-draft and replace-choices accept `explanations`, optional per
  option. The choices editor shows an optional "why" field under each option.
- **Immutability.** Explanations are part of the published version like the choices, so a
  published version refuses edits and a new draft is the way to change them.
- **Who sees them.** Explanations are *not* in the capability or snapshot the exam runner
  receives, so they never reach a student during a test. They are returned only where the
  correct answers already are: a practice question after the student has answered, and an
  exam attempt's review once the exam has ended and results are released. Both checks reuse
  the existing release rules; this ADR adds no new visibility rule.
- **Export and import.** The question export format (ADR-0032) gains an optional
  `explanations` list; an import without it produces none.

## Not doing

- Unlimited nesting. One level covers the reference product and keeps the folder UI and
  counts simple; deeper trees can wait for a real need.
- Explanations for coding questions. The reference has none, and the statement and a model
  solution already do that job.
- Giving each option rich text. Plain text with line breaks matches the options themselves.

## Migrations

- question-bank `000025_category_parent.up.sql`: the column, the depth trigger, the sibling
  unique index, the updated list function.
- question-bank `000026_choice_explanations.up.sql`: the column and length check, and the
  functions that create, update, replace and read a version.
- Down migrations drop the columns, the trigger and the new index, and restore the global
  unique name. A down that finds two same-named siblings fails with a message rather than
  deleting data.

## Consequences

- Existing categories and questions are untouched: every current category is top level, every
  current version has no explanations.
- The category list response grows a field, which older web builds ignore.
- Tests: depth and sibling-uniqueness cases in the repository tests, a move that would orphan
  children, delete refusal with children, explanations length mismatch rejected, and a check
  that an exam capability payload and a pre-release review contain no explanation text.

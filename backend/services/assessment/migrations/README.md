

`000028_exam_version_content` adds `assessment.get_exam_version_content`,
behind `GET .../exam-versions/{id}/content`: sections, items with their pinned
titles, and assignment rules with candidate counts, under the exam_versions
read capability.

`000029_question_pools` adds `exam_sections.draw_count` and question pools
(ADR-0034): `item_drawn` picks each student's items by hash, both snapshot
builders apply it, a nine-argument `add_exam_section` takes the draw count,
publication checks pools, and `get_exam_version_content` returns it. Rollback
restores the 000026 to 000028 functions and drops the column.

`000030_mcq_items` adds multiple-choice exam items (ADR-0035): the item kind,
options, key and multiple flag with a constraint per kind,
`add_exam_mcq_item`, and both snapshot builders carrying them. Rollback
refuses while mcq items exist and restores the 000029 builders.

`000031_repin_exam_item` adds `repin_exam_item` (ADR-0039): an item of a
published exam may take a corrected published version of its own coding
question; the immutability trigger lets exactly that update through, and
every assignment of the exam version is snapshotted again. The snapshot
builder sends started, completed and expired assignments as active.
Rollback drops the function and restores the trigger and builder.

`000032_move_assignment_window` adds `move_assignment_window` (ADR-0040):
staff move an assignment rule's close time after publication; its
assignments follow and are snapshotted again. Rollback drops it.

`000033_exam_list_latest_version` adds `latest_exam_versions(tenant, exam
IDs)`, readable with a read capability on `exams` (ADR-0043). The exam list
then carries each exam's latest version, so staff pages list exams in one
request instead of one per exam. Rollback drops it.

"use client";

import { useState } from "react";
import { Field, Select } from "@/components/staff/form";
import { companiesIn, companyName, matchesCompany } from "@/lib/companies";

export type PickableQuestion = { id: string; title: string; difficulty: string; tags: string[] };

/**
 * The "Published question" field of the add-question form, with a Company filter
 * when any question carries a company: tag (ADR-0081). The chosen question is
 * submitted as question_version_id exactly as before.
 */
export function QuestionPicker({ questions }: { questions: PickableQuestion[] }) {
  const [company, setCompany] = useState("all");
  const companies = companiesIn(questions.map((question) => question.tags));
  const shown = questions.filter((question) => matchesCompany(question.tags, company));

  return (
    <div className="space-y-3">
      {companies.length > 0 && (
        <Field label="Company" htmlFor="add-company">
          <Select id="add-company" className="capitalize" value={company} onValueChange={setCompany}>
            <option value="all">Any company</option>
            {companies.map((entry) => (
              <option key={entry} value={entry}>
                {companyName(entry)}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label="Published question" htmlFor="add-question">
        <Select id="add-question" name="question_version_id" required key={company}>
          {shown.map((question) => (
            <option key={question.id} value={question.id}>
              {question.title} ({question.difficulty})
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
}

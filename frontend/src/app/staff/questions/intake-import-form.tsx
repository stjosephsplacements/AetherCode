"use client";

import { Database } from "@phosphor-icons/react/ssr";
import { useActionState, useEffect, useState } from "react";
import { FormMessage, SelectField, SubmitButton, initialActionState } from "@/components/staff/form";
import { importIntakeTopic, loadIntakeTopics, type IntakeTopicOption } from "./actions";

export function IntakeImportForm({ topics: initial }: { topics: IntakeTopicOption[] }) {
  const [topics, setTopics] = useState(initial);
  const [state, action] = useActionState(importIntakeTopic, initialActionState);
  useEffect(() => {
    if (initial.length > 0) return;
    loadIntakeTopics().then(setTopics).catch(() => setTopics([]));
  }, [initial.length]);
  return (
    <form action={action} className="space-y-4">
      <SelectField label="Intake topic" name="topic_id" required hint="Questions the judge verified in the intake app. Re-importing is idempotent.">
        <option value="">Choose a topic…</option>
        {topics.map((topic) => (
          <option key={topic.id} value={topic.id}>
            {topic.parentName ? `${topic.parentName} / ${topic.name}` : topic.name} ({topic.questionCount})
          </option>
        ))}
      </SelectField>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton variant="secondary">
          <Database />
          Import topic into bank
        </SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
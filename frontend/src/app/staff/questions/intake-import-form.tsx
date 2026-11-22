"use client";

import { Database } from "@phosphor-icons/react/ssr";
import { useActionState, useEffect, useState } from "react";
import { Field, FormMessage, Select, SubmitButton, initialActionState } from "@/components/staff/form";
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
      <Field label="Intake topic" htmlFor="intake_topic" hint="Questions the judge verified in the intake app. Re-importing is idempotent.">
        <Select id="intake_topic" name="topic_id" defaultValue="" required>
          <option value="">Choose a topic…</option>
          {topics.map((topic) => (
            <option key={topic.id} value={topic.id}>
              {topic.parentName ? `${topic.parentName} / ${topic.name}` : topic.name} ({topic.questionCount})
            </option>
          ))}
        </Select>
      </Field>
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
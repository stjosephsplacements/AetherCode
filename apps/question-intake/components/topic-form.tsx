"use client";

import { Plus } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createTopic } from "@/app/topics/actions";
import { Select } from "@/components/select";
import { Button, field } from "@/components/ui";

/** Creates a topic, optionally inside another. Topics come first: every question is filed under one. */
export function TopicForm({ parents }: { parents: { id: string; name: string }[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [parent, setParent] = useState("none");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="flex flex-wrap items-start gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        start(async () => {
          const result = await createTopic(name, parent === "none" ? null : parent);
          if ("error" in result) return setError(result.error);
          setName("");
          setError(null);
          router.push(`/topics/${result.id}`);
        });
      }}
    >
      <div className="min-w-[220px] flex-1">
        <input aria-label="Topic name" value={name} onChange={(event) => { setName(event.target.value); setError(null); }} placeholder="New topic, for example Arrays" maxLength={80} className={field} />
        {error && <p role="alert" className="mt-1 text-[12.5px] text-danger">{error}</p>}
      </div>
      <div className="w-[220px]">
        <Select aria-label="Parent topic" value={parent} onValueChange={setParent} options={[{ value: "none", label: "Top level" }, ...parents.map((entry) => ({ value: entry.id, label: `Inside ${entry.name}` }))]} />
      </div>
      <Button type="submit" disabled={pending || !name.trim()} className="h-10">
        <Plus className="size-4" /> Create topic
      </Button>
    </form>
  );
}

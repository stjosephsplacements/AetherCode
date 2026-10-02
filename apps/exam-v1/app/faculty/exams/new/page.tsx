import { requireUser } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/ui";
import { ExamForm } from "../exam-form";
import { formOptions } from "../load";
import { clientIp } from "@/lib/client-ip";

export default async function NewExamPage() {
  const user = await requireUser("faculty", "admin");
  const options = await formOptions();
  const start = new Date(Date.now() + 24 * 3600_000);
  start.setMinutes(0, 0, 0);
  return (
    <AppShell user={user}>
      <PageHeader eyebrow="Assessments" title="New exam" />
      <ExamForm
        id={null}
        locked={false}
        viewerIp={await clientIp()}
        {...options}
        initial={{
          title: "",
          instructions: "Read each problem carefully. Use Run to test against the samples, then Submit. Your best submission per question counts.",
          startsAt: start.toISOString(),
          endsAt: new Date(start.getTime() + 3 * 3600_000).toISOString(),
          durationMinutes: 90,
          languages: ["c", "cpp", "java", "python"],
          batches: [],
          published: false,
          allowedNetworks: [],
          requireFullscreen: true,
          blockExternalPaste: true,
          questions: [],
        }}
      />
    </AppShell>
  );
}

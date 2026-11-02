import { PageHeader } from "@/components/staff/page-header";
import { RosterSkeleton } from "./skeleton";

export default function StudentsLoading() {
  return (
    <>
      <PageHeader title="Students" />
      <RosterSkeleton />
    </>
  );
}

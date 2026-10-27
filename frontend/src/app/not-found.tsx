import { ErrorView } from "@/components/site/error-view";

export default function NotFound() {
  return <ErrorView code="404" title="This page doesn't exist" message="The link may be old, or the address mistyped. Your exams and results are on your dashboard." />;
}

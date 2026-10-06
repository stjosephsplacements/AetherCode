import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { publicOrigin } from "@/lib/public-url";
import { buildSebConfig } from "@/lib/seb";

// The config is identical for every student and holds no secret, so it needs no
// auth: SEB downloads it without cookies, and SEB for macOS drops the link's query.
// Students are signed in by the login token SEB appends to the Start URL instead.

// SEB for Windows probes a config URL with HEAD before downloading it.
export function HEAD() {
  return new NextResponse(null, { headers: { "Content-Type": "application/seb", "Cache-Control": "no-store" } });
}

export async function GET(_request: Request, { params }: { params: Promise<{ examId: string }> }) {
  const { examId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(examId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const [exam] = await sql<{ title: string }[]>`SELECT title FROM exams WHERE id = ${examId} AND require_seb`;
  if (!exam) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const buffer = buildSebConfig(await publicOrigin());
  const slug = exam.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40) || "exam";

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/seb",
      "Content-Disposition": `attachment; filename="${slug}.seb"`,
      "Cache-Control": "no-store",
      "Content-Encoding": "identity",
    },
  });
}

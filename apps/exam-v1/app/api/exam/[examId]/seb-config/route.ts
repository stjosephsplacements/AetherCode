import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { sql } from "@/lib/db";
import { buildSebConfig } from "@/lib/seb";

// SEB exam launch password — used to encrypt the .seb file and as the hashed quit password.
// Students never see or need to enter this; it is only used internally for config encryption.
const SEB_CONFIG_PASSWORD = process.env.SEB_CONFIG_PASSWORD ?? "REDACTED";

export async function GET(request: NextRequest, { params }: { params: Promise<{ examId: string }> }) {
  // Must be an authenticated student (or staff previewing).
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { examId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(examId))
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const isStaff = user.role !== "student";
  const [exam] = await sql<Array<{ title: string; seb_exam_key: string }>>`
    SELECT e.title, e.seb_exam_key
    FROM exams e
    WHERE e.id = ${examId}
      AND (${isStaff} OR (e.published AND ${user.batch} = ANY(e.batches)))`;

  if (!exam) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!exam.seb_exam_key)
    return NextResponse.json({ error: "SEB not required for this exam" }, { status: 400 });

  const host = request.headers.get("host") ?? "localhost";
  const proto = request.headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const base = `${proto}://${host}`;

  const config = buildSebConfig({
    title: exam.title,
    password: SEB_CONFIG_PASSWORD,
    startUrl: `${base}/exam/${examId}`,
    quitUrl: `${base}/student`,
  });

  const slug = exam.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40) || "exam";

  return new NextResponse(new Uint8Array(config), {
    headers: {
      "Content-Type": "application/seb",
      "Content-Disposition": `attachment; filename="${slug}.seb"`,
      "Cache-Control": "no-store",
      // The .seb format is itself gzip-compressed. Tell the browser/proxy
      // this is opaque binary content — NOT HTTP-level gzip encoding — so
      // it must not decompress it before saving.
      "Content-Encoding": "identity",
    },
  });
}

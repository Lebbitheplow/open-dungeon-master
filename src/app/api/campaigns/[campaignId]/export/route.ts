import { z } from "zod";
import { isErrorResponse, requireMember } from "@/lib/campaign-api";
import { buildStoryDocument, exportFilename } from "@/lib/export/story-document";
import { renderStoryHtml } from "@/lib/export/html";
import { renderStoryOdt } from "@/lib/export/odt";
import { renderStoryDocx } from "@/lib/export/docx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const formatSchema = z.enum(["html", "odt", "docx"]).catch("html");

const CONTENT_TYPES = {
  html: "text/html; charset=utf-8",
  odt: "application/vnd.oasis.opendocument.text",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
} as const;

// Exports a campaign's player-safe story (premise, chapters, transcript) as a
// stylized, indexed document. Any campaign member may export; DM secrets are
// never included (see buildStoryDocument).
export async function GET(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }

  const format = formatSchema.parse(new URL(request.url).searchParams.get("format") ?? "html");

  const doc = buildStoryDocument(campaignId);
  if (!doc) {
    return Response.json({ error: "Campaign not found." }, { status: 404 });
  }

  const body: string | Uint8Array =
    format === "html"
      ? renderStoryHtml(doc)
      : format === "odt"
        ? await renderStoryOdt(doc)
        : await renderStoryDocx(doc);

  return new Response(body as BodyInit, {
    headers: {
      "Content-Type": CONTENT_TYPES[format],
      "Content-Disposition": `attachment; filename="${exportFilename(doc, format)}"`,
    },
  });
}

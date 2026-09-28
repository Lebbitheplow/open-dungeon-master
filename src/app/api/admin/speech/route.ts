import { isErrorResponse, requireAdmin } from "@/lib/admin-api";
import { currentSttBackend } from "@/lib/stt-backend";
import { builtinSpeechStatus, installBuiltinSpeech } from "@/lib/stt-builtin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The built-in speech engine, for admins: GET reports whether its model is
// installed (and which engine dictation uses right now), POST starts the
// download. The admin panel's Speech section and the desktop app's Local AI
// screen both drive it, polling GET while the model comes down.
export async function GET() {
  const admin = await requireAdmin();
  if (isErrorResponse(admin)) {
    return admin;
  }
  return Response.json({ builtin: builtinSpeechStatus(), active: await currentSttBackend() });
}

export async function POST() {
  const admin = await requireAdmin();
  if (isErrorResponse(admin)) {
    return admin;
  }
  return Response.json({ builtin: installBuiltinSpeech(), active: await currentSttBackend() });
}

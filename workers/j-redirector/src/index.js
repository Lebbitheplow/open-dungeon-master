// The /j invite redirector.
//
// An ODM invite is really two facts: which server, and which room code. A
// link like  https://opendungeonmaster.com/j?s=https://host&c=CODE  carries
// both through one stable domain, which buys three things:
//
//   1. The client apps can register ONE domain for deep links (Android App
//      Links, Windows/macOS protocol association) instead of somehow
//      registering every self-hosted server and every trycloudflare URL.
//   2. Someone without the app lands on a page that still works: a browser
//      join button plus a pointer at the downloads.
//   3. QR codes and share links survive the app-vs-browser question.
//
// SECURITY: this is deliberately an interstitial, not a redirect. A blind
// redirector on a trusted domain is a phishing primitive (the link reads as
// opendungeonmaster.com but lands anywhere), so the page always shows the
// real destination host and makes the person click it. The server URL is
// parsed, allowlisted to http/https, and re-serialized; the code is
// uppercased and checked against the invite alphabet before either is
// echoed into HTML, and everything is escaped on the way out anyway.

const DOWNLOAD_URL = "https://opendungeonmaster.com";

// Campaign room codes: 4 to 12 chars from the unambiguous alphabet
// (src/lib/db/campaigns.ts). Account invite codes never appear in /j links.
const CODE_SHAPE = /^[A-HJ-NP-Z2-9]{4,12}$/;

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// Returns a clean origin string, or null for anything that is not a plain
// http(s) URL. Re-serializing from URL (rather than echoing the raw query
// value) strips userinfo tricks like https://good.com@evil.com.
export function parseServer(raw) {
  if (typeof raw !== "string" || raw.length > 300) {
    return null;
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return null;
  }
  if (url.username || url.password) {
    return null;
  }
  return url.origin;
}

export function parseCode(raw) {
  if (typeof raw !== "string") {
    return null;
  }
  const code = raw.trim().toUpperCase();
  return CODE_SHAPE.test(code) ? code : null;
}

function page(title, body) {
  return new Response(
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
         background: #181420; color: #e7e5e4; font: 16px/1.5 system-ui, sans-serif; }
  main { max-width: 22rem; padding: 2rem; text-align: center; }
  h1 { font-size: 1.25rem; color: #fef3c7; letter-spacing: 0.02em; }
  .host { font-family: ui-monospace, monospace; color: #fcd34d; word-break: break-all; }
  .code { font-family: ui-monospace, monospace; font-size: 1.4rem; letter-spacing: 0.3em; color: #fef3c7; }
  a.btn { display: block; margin: 0.6rem 0; padding: 0.7rem 1rem; border-radius: 0.6rem;
          text-decoration: none; font-weight: 600; }
  a.primary { background: linear-gradient(#fde68a, #f59e0b); color: #451a03; }
  a.secondary { border: 1px solid #57534e; color: #d6d3d1; }
  p.fine { font-size: 0.8rem; color: #a8a29e; }
</style>
</head>
<body><main>${body}</main></body>
</html>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

const worker = {
  fetch(request) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/j")) {
      return Response.redirect(DOWNLOAD_URL, 302);
    }

    // Both shapes are accepted: /j?s=...&c=CODE and /j/CODE?s=...
    const pathCode = url.pathname.split("/")[2] ?? "";
    const server = parseServer(url.searchParams.get("s") ?? "");
    const code = parseCode(url.searchParams.get("c") ?? pathCode);

    if (!server || !code) {
      return page(
        "Open Dungeon Master",
        `<h1>That invite link is incomplete</h1>
         <p>Ask whoever sent it to share it again from their campaign.</p>
         <a class="btn secondary" href="${DOWNLOAD_URL}">About Open Dungeon Master</a>`,
      );
    }

    const browserLink = `${server}/join/${code}`;
    const appLink = `odm://join?s=${encodeURIComponent(server)}&c=${code}`;
    const host = escapeHtml(new URL(server).host);

    return page(
      "Join the party",
      `<h1>You are invited to a campaign</h1>
       <p>Hosted at <span class="host">${host}</span></p>
       <p class="code">${escapeHtml(code)}</p>
       <a class="btn primary" href="${escapeHtml(browserLink)}">Join in your browser</a>
       <a class="btn secondary" href="${escapeHtml(appLink)}">Open in the app</a>
       <p class="fine">No app yet? The browser works fully. Downloads live at
         <a href="${DOWNLOAD_URL}" style="color:#fcd34d">opendungeonmaster.com</a>.</p>
       <p class="fine">Only continue if you expected this invite. This game server is run by
         whoever shared the link, not by Open Dungeon Master.</p>`,
    );
  },
};

export default worker;

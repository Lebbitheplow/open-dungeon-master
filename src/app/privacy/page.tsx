import Link from "next/link";

export const metadata = {
  title: "Privacy Policy | Open Dungeon Master",
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <Link href="/" className="text-sm text-amber-200 hover:text-amber-400">
        Back to Open Dungeon Master
      </Link>
      <h1 className="mt-4 font-serif text-3xl text-stone-100">Privacy policy</h1>

      <section className="mt-6 space-y-4">
        <p className="text-sm leading-6 text-stone-400">
          Open Dungeon Master is an open source (MIT licensed), self-hosted application. You run
          it on your own server, and your data stays on that server. The creator of Open Dungeon
          Master does not collect, sell, or share any user data, and has no access to the data of
          anyone running the app.
        </p>
        <p className="text-sm leading-6 text-stone-400">
          The{" "}
          <Link href="/terms" className="text-amber-200 hover:text-amber-400">
            terms of service
          </Link>{" "}
          cover who is responsible for what on a given server.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="font-serif text-xl text-stone-100">What data is stored</h2>
        <p className="mt-2 text-sm leading-6 text-stone-400">
          Open Dungeon Master stores only the information needed to run your server, in a local
          database on your machine:
        </p>
        <ul className="mt-3 list-disc space-y-2 pl-6 text-sm leading-6 text-stone-400">
          <li>
            Account credentials: the usernames of accounts you create, and salted hashes of their
            passwords. Passwords are never stored in plain text.
          </li>
          <li>
            Content you create: campaigns, characters, and other game data, including any files
            you upload.
          </li>
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="font-serif text-xl text-stone-100">What we do not do</h2>
        <ul className="mt-3 list-disc space-y-2 pl-6 text-sm leading-6 text-stone-400">
          <li>No analytics, telemetry, or usage tracking.</li>
          <li>No cookies or tracking technologies.</li>
          <li>No advertising or third-party services.</li>
          <li>
            No data is sold, shared, or transmitted to any third party, including the creator of
            Open Dungeon Master.
          </li>
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="font-serif text-xl text-stone-100">
          Optional integrations configured by your server operator
        </h2>
        <p className="mt-2 text-sm leading-6 text-stone-400">
          By default the AI Dungeon Master runs on your own hardware and nothing leaves your
          server. A server operator may optionally enable additional integrations, in which case
          the relevant data flows to the corresponding provider:
        </p>
        <ul className="mt-3 list-disc space-y-2 pl-6 text-sm leading-6 text-stone-400">
          <li>
            <span className="text-stone-200">Discord sign-in.</span> If the operator enables it,
            signing in through Discord shares your Discord username and avatar with your server.
          </li>
          <li>
            <span className="text-stone-200">Public AI model API keys.</span> The server owner
            can enter an API key for a public AI model provider (for example, OpenRouter or any
            OpenAI-compatible endpoint) instead of running models on their own hardware. When
            this is configured, prompts and game content are sent to that provider, and its own
            privacy policy applies to that data.
          </li>
        </ul>
        <p className="mt-3 text-sm leading-6 text-stone-400">
          These are choices made by the operator of the server you are using, not by Open Dungeon
          Master or its creator. If you are unsure which integrations are enabled on your server,
          ask your operator.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="font-serif text-xl text-stone-100">You are the server operator</h2>
        <p className="mt-2 text-sm leading-6 text-stone-400">
          Because the app is self-hosted, you control who can access your server and the data it
          holds. You are responsible for keeping your server secure: use strong passwords, keep
          the software updated, and do not expose the app to the internet without protection (for
          example, a reverse proxy with TLS). Anyone with access to your database has access to
          all of the stored data.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="font-serif text-xl text-stone-100">Your data</h2>
        <p className="mt-2 text-sm leading-6 text-stone-400">
          All data belongs to you. You can delete any account, campaign, character, or file at
          any time from within the app, or delete the entire database from your server. No data
          is retained anywhere else.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="font-serif text-xl text-stone-100">Changes to this policy</h2>
        <p className="mt-2 text-sm leading-6 text-stone-400">
          This policy is part of the open source project and changes only when the code changes.
          You can review the current version and its history in the project repository at any
          time.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="font-serif text-xl text-stone-100">Contact</h2>
        <p className="mt-2 text-sm leading-6 text-stone-400">
          There is no company, support address, or email behind this project. For questions,
          reports, or concerns, please open an issue in the project repository:
        </p>
        <p className="mt-2 text-sm leading-6">
          <a
            href="https://github.com/Lebbitheplow/open-dungeon-master"
            target="_blank"
            rel="noopener noreferrer"
            className="text-amber-200 hover:text-amber-400"
          >
            github.com/Lebbitheplow/open-dungeon-master
          </a>
        </p>
      </section>
    </main>
  );
}

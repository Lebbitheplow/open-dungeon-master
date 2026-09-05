import Link from "next/link";
import { PIXEL_ICONS } from "@/lib/ui";
import { PageSection, PageShell } from "@/components/PageShell";

export const metadata = {
  title: "Privacy Policy | Open Dungeon Master",
};

export default function PrivacyPage() {
  return (
    <PageShell
      icon={PIXEL_ICONS.localData}
      title="Privacy policy"
      blurb="What this server stores, what it never does, and who is responsible for it."
      actions={
        <Link href="/" className="text-sm text-amber-200 hover:text-amber-100">
          Back to Open Dungeon Master
        </Link>
      }
    >
      <PageSection bodyClassName="space-y-4">
        <p className="text-sm leading-6 text-stone-400">
          Open Dungeon Master is an open source (MIT licensed), self-hosted application. You run
          it on your own server, or on your own phone or computer, and your data stays there. The
          creator of Open Dungeon Master does not collect, sell, or share any user data, and has
          no access to the data on any server or device running the app. The one exception is
          described under &quot;Sharing a world from your device&quot; below.
        </p>
        <p className="text-sm leading-6 text-stone-400">
          The{" "}
          <Link href="/terms" className="text-amber-200 hover:text-amber-400">
            terms of service
          </Link>{" "}
          cover who is responsible for what on a given server.
        </p>
      </PageSection>

      <PageSection heading="What data is stored">
        <p className="text-sm leading-6 text-stone-400">
          Open Dungeon Master stores only the information needed to run your server, in a local
          database on your machine:
        </p>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-stone-400">
          <li>
            Account credentials: the usernames of accounts you create, and salted hashes of their
            passwords. Passwords are never stored in plain text.
          </li>
          <li>
            Content you create: campaigns, characters, and other game data, including any files
            you upload.
          </li>
        </ul>
      </PageSection>

      <PageSection heading="What we do not do">
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-stone-400">
          <li>No analytics, telemetry, or usage tracking.</li>
          <li>No cookies or tracking technologies.</li>
          <li>No advertising or third-party services.</li>
          <li>
            No data is sold or shared with any third party, including the creator of Open
            Dungeon Master. The only things that ever leave your server or device are the
            optional integrations and the sharing tunnel described below, each of which you or
            your operator switches on.
          </li>
        </ul>
      </PageSection>

      <PageSection heading="The desktop and Android apps">
        <p className="text-sm leading-6 text-stone-400">
          The Open Dungeon Master apps are a shell around this same server. They can run a
          world on your own device, share it with friends, or connect to a server somebody
          else runs. Everything a world stores stays in the app&apos;s private storage on that
          device, and is excluded from Android and desktop cloud backups. The apps ask for
          these device permissions, each only when you use the feature:
        </p>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-stone-400">
          <li>
            <span className="text-stone-200">Microphone</span> for voice chat with your party
            and push-to-talk speech to text. Audio goes directly to the players in your session
            and, for speech to text, to the server you are connected to. Nothing is recorded.
          </li>
          <li>
            <span className="text-stone-200">Camera</span> to scan a QR invite card. Frames
            are read on the device and never stored or sent anywhere.
          </li>
          <li>
            <span className="text-stone-200">Bluetooth</span> to pair Pixels smart dice so
            physical rolls reach the game. The app never reads your location; the Bluetooth
            permission on older Android versions requires a location grant only because that is
            how Android gates Bluetooth scanning there.
          </li>
          <li>
            <span className="text-stone-200">Notifications</span> for turn alerts, session
            reminders, and the persistent notice that your device is hosting a world.
          </li>
        </ul>
        <p className="mt-3 text-sm leading-6 text-stone-400">
          The apps contain no advertising, analytics, or crash reporting, and no tracking
          identifiers.
        </p>
      </PageSection>

      <PageSection heading="Sharing a world from your device">
        <p className="text-sm leading-6 text-stone-400">
          When you tap Share, the app opens an outbound tunnel so friends can reach the world
          on your device from anywhere. That involves two things the creator of Open Dungeon
          Master runs, and this is the only place where anything reaches infrastructure that is
          not yours:
        </p>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-stone-400">
          <li>
            <span className="text-stone-200">The tunnel broker</span> is a small service that
            hands your device a temporary address such as{" "}
            <span className="font-mono text-xs">play-CODE.opendungeonmaster.com</span>. It sees
            the port your world listens on and the IP address the request comes from. The IP
            address is used only to limit how many addresses one network can request per day,
            and it is stored only as a salted hash that expires within 24 hours. No account,
            device identifier, or game content is sent to it.
          </li>
          <li>
            <span className="text-stone-200">Cloudflare</span> carries the tunnel. While your
            world is shared, traffic between your friends and your device transits
            Cloudflare&apos;s network, encrypted in transit, under{" "}
            <a
              href="https://www.cloudflare.com/privacypolicy/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-amber-200 hover:text-amber-400"
            >
              Cloudflare&apos;s privacy policy
            </a>
            . Cloudflare also answers a single DNS lookup that confirms your new address works.
          </li>
        </ul>
        <p className="mt-3 text-sm leading-6 text-stone-400">
          Stop sharing, and both end. Nothing about the session is kept by the creator of Open
          Dungeon Master once the temporary address expires.
        </p>
      </PageSection>

      <PageSection heading="Optional integrations configured by your server operator">
        <p className="text-sm leading-6 text-stone-400">
          By default the AI Dungeon Master runs on your own hardware and nothing leaves your
          server. A server operator may optionally enable additional integrations, in which case
          the relevant data flows to the corresponding provider:
        </p>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-stone-400">
          <li>
            <span className="text-stone-200">Discord sign-in.</span> If the operator enables it,
            signing in through Discord shares your Discord username and avatar with your server.
          </li>
          <li>
            <span className="text-stone-200">Public AI model API keys.</span> The server owner
            can enter an API key for a public AI model provider (for example, OpenAI, OpenRouter
            or any OpenAI-compatible endpoint) instead of running models on their own hardware.
            When this is configured, prompts and game content are sent to that provider, and its
            own privacy policy applies to that data. In the apps, a key you enter for a world on
            your own device is stored only in that world&apos;s database on the device.
          </li>
        </ul>
        <p className="mt-3 text-sm leading-6 text-stone-400">
          These are choices made by the operator of the server you are using, not by Open Dungeon
          Master or its creator. If you are unsure which integrations are enabled on your server,
          ask your operator.
        </p>
      </PageSection>

      <PageSection heading="You are the server operator">
        <p className="text-sm leading-6 text-stone-400">
          Because the app is self-hosted, you control who can access your server and the data it
          holds. You are responsible for keeping your server secure: use strong passwords, keep
          the software updated, and do not expose the app to the internet without protection (for
          example, a reverse proxy with TLS). Anyone with access to your database has access to
          all of the stored data.
        </p>
      </PageSection>

      <PageSection heading="Your data, and deleting it">
        <p className="text-sm leading-6 text-stone-400">
          All data belongs to you. You can delete any account, campaign, character, or file at
          any time from within the app, or delete the entire database from your server. No data
          is retained anywhere else.
        </p>
        <p className="mt-3 text-sm leading-6 text-stone-400">
          To delete your account, open{" "}
          <Link href="/settings" className="text-amber-200 hover:text-amber-400">
            Account settings
          </Link>{" "}
          and choose Delete account. That signs the account out everywhere and erases it, with
          everything it owns, after the grace period this server has set (the settings page
          states the number of days; the default is 14). Signing in before then lets you keep
          it. Messages you wrote at other people&apos;s tables stay in their transcripts without
          your name on them. Accounts are per server: if you play on several, delete on each.
          A server admin can also erase any account at once from the admin panel.
        </p>
        <p className="mt-3 text-sm leading-6 text-stone-400">
          To delete a world hosted on your own device, uninstall the app or clear its storage;
          the world lives nowhere else.
        </p>
      </PageSection>

      <PageSection heading="Reports and blocks">
        <p className="text-sm leading-6 text-stone-400">
          You can report a Dungeon Master passage, a message, or a player from the table, and
          block a player so their messages are hidden from you and neither of you can contact
          the other. Reports are stored on this server with a copy of the reported text and go
          to this server&apos;s admins, who are the only moderators: there is no central
          service behind the app.
        </p>
      </PageSection>

      <PageSection heading="Changes to this policy">
        <p className="text-sm leading-6 text-stone-400">
          This policy is part of the open source project and changes only when the code changes.
          You can review the current version and its history in the project repository at any
          time.
        </p>
      </PageSection>

      <PageSection heading="Contact">
        <p className="text-sm leading-6 text-stone-400">
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
      </PageSection>
    </PageShell>
  );
}

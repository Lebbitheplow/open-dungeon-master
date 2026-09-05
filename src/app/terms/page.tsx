import Link from "next/link";
import { PIXEL_ICONS } from "@/lib/ui";
import { PageSection, PageShell } from "@/components/PageShell";

export const metadata = {
  title: "Terms of Service | Open Dungeon Master",
};

export default function TermsPage() {
  return (
    <PageShell
      icon={PIXEL_ICONS.story}
      title="Terms of service"
      blurb="What the software is, what it is not, and who is responsible for what."
      actions={
        <Link href="/" className="text-sm text-amber-200 hover:text-amber-100">
          Back to Open Dungeon Master
        </Link>
      }
    >
      <PageSection bodyClassName="space-y-4">
        <p className="text-sm leading-6 text-stone-400">
          Open Dungeon Master is open source (MIT licensed), self-hosted software. There is no
          hosted service to sign up for, no company behind it, and no account with the project
          itself. You download the code and run it on hardware you control. These terms explain
          what the software is, what it is not, and who is responsible for what.
        </p>
        <p className="text-sm leading-6 text-stone-400">
          By installing, running, or playing on an install of Open Dungeon Master, you accept
          these terms. If you do not accept them, do not use the software.
        </p>
      </PageSection>

      <PageSection heading="Who these terms are between">
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-stone-400">
          <li>
            <span className="text-stone-200">If you run the server.</span> Your relationship with
            this project is the{" "}
            <a
              href="https://github.com/Lebbitheplow/open-dungeon-master/blob/main/LICENSE"
              target="_blank"
              rel="noopener noreferrer"
              className="text-amber-200 hover:text-amber-400"
            >
              MIT license
            </a>{" "}
            and nothing more. You are free to use, modify, and redistribute the code under that
            license, and the software comes with no warranty of any kind.
          </li>
          <li>
            <span className="text-stone-200">If you play on someone else&apos;s server.</span> The
            person or group operating that server is who you are actually dealing with. They
            control the accounts, the data, the rules of the table, and whether the server keeps
            running. The creator of Open Dungeon Master is not a party to that arrangement, has no
            access to that server, and cannot moderate, recover, or delete anything on it.
          </li>
        </ul>
      </PageSection>

      <PageSection heading="No service, no support, no uptime">
        <p className="text-sm leading-6 text-stone-400">
          Nothing here is a subscription or a hosted product. There is no service level, no
          guaranteed availability, no support desk, and no promise that future versions will keep
          any particular feature, remain compatible with your data, or be released at all. The
          project may change or stop at any time.
        </p>
      </PageSection>

      <PageSection heading="If you run a server">
        <p className="text-sm leading-6 text-stone-400">
          Running an install makes you the operator, and the obligations that would normally fall
          on a service provider fall on you:
        </p>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-stone-400">
          <li>
            Comply with the laws that apply where you and your players are. That includes data
            protection law, which generally treats you, not this project, as the controller of
            everything your players store.
          </li>
          <li>
            Secure the server: strong credentials, current software, access control, and TLS if it
            is reachable from the internet. Anyone with access to the database has access to every
            campaign, character, and uploaded file in it.
          </li>
          <li>
            Set the rules for your table, including any age limit, and be responsible for what
            happens on your server. You decide who gets an account and who keeps it.
          </li>
          <li>
            Tell your players which optional integrations you have enabled, since those send data
            off your machine. See the{" "}
            <Link href="/privacy" className="text-amber-200 hover:text-amber-400">
              privacy policy
            </Link>{" "}
            for what those are.
          </li>
          <li>
            Keep your own backups. Campaign data lives only on your server, and a lost disk or a
            bug means a lost campaign.
          </li>
          <li>
            If you open your server to people beyond friends, publish your own terms and privacy
            notice. This page describes the software; it cannot speak for how you run it.
          </li>
        </ul>
      </PageSection>

      <PageSection heading="Acceptable use">
        <p className="text-sm leading-6 text-stone-400">
          Whether you are the operator or a player, do not use Open Dungeon Master to:
        </p>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-stone-400">
          <li>break the law, or to create, store, or share material that is illegal where you are;</li>
          <li>
            produce sexual content involving minors, or sexual or abusive depictions of real
            people who have not consented;
          </li>
          <li>harass, threaten, defame, or impersonate other players or anyone else;</li>
          <li>
            upload or generate material you have no right to use, including copyrighted rulebooks,
            art, or audio;
          </li>
          <li>
            attack the install or the people on it: bypassing access controls, reading other
            players&apos; private content, taking over accounts, or disrupting sessions.
          </li>
        </ul>
        <p className="mt-3 text-sm leading-6 text-stone-400">
          Your operator may add rules of their own, and those apply too. An operator may suspend or
          remove any account on their server at their discretion.
        </p>
      </PageSection>

      <PageSection heading="AI generated content">
        <p className="text-sm leading-6 text-stone-400">
          The Dungeon Master is a language model. Its narration is fiction produced by software,
          and it can be wrong, inconsistent, unfair, or upsetting. It is not advice of any kind,
          and nothing it says should be relied on outside the game.
        </p>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-stone-400">
          <li>
            What the model produces depends on the model your operator chose, its settings, and
            what players type. This project applies no content filter that could guarantee any
            particular output, and makes no promise about what a model will say.
          </li>
          <li>
            Generated text, images, and audio are not guaranteed to be original or free of other
            people&apos;s rights. Who owns model output, if anyone, is unsettled in many places,
            and this project makes no claim either way.
          </li>
          <li>
            Agree on the limits for your table before you play, and treat the AI DM as a tool the
            table steers rather than an authority.
          </li>
        </ul>
      </PageSection>

      <PageSection heading="Optional third-party services">
        <p className="text-sm leading-6 text-stone-400">
          By default everything runs on your own hardware. An operator can enable integrations that
          reach outside it, for example Discord sign-in, a hosted OpenAI-compatible model provider,
          or content and audio downloaded from public archives. When one of those is enabled, that
          provider&apos;s own terms and privacy policy govern the data it receives, and the
          operator is responsible for their own accounts, API keys, and the costs those run up.
        </p>
      </PageSection>

      <PageSection heading="Game content and trademarks">
        <p className="text-sm leading-6 text-stone-400">
          The code is MIT licensed. The bundled rules data derives from the System Reference
          Document 5.1 by Wizards of the Coast LLC, licensed under Creative Commons Attribution
          4.0. Content packs an operator imports carry their own licenses. Full attribution is on
          the{" "}
          <Link href="/licenses" className="text-amber-200 hover:text-amber-400">
            licenses page
          </Link>
          .
        </p>
        <p className="mt-3 text-sm leading-6 text-stone-400">
          This project is not affiliated with, endorsed by, or sponsored by Wizards of the Coast.
          Dungeons &amp; Dragons and D&amp;D are trademarks of Wizards of the Coast LLC. No
          official published material ships with the software, and you should not upload material
          you do not have the right to use.
        </p>
      </PageSection>

      <PageSection heading="Your content">
        <p className="text-sm leading-6 text-stone-400">
          You keep whatever rights you already have in what you write and upload. It is stored in
          your operator&apos;s database and nowhere else. This project takes no license in it,
          never receives a copy, and cannot retrieve or erase it for you. Requests to delete or
          export your data go to your operator.
        </p>
      </PageSection>

      <PageSection heading="No warranty and no liability">
        <p className="text-sm leading-6 text-stone-400">
          As stated in the MIT license, the software is provided &quot;as is&quot;, without
          warranty of any kind, express or implied, including the warranties of merchantability,
          fitness for a particular purpose, and noninfringement. To the fullest extent the law
          allows, the authors and copyright holders are not liable for any claim, damages, or other
          liability arising from the software or its use, including lost campaigns, lost data,
          downtime, or anything a model generates.
        </p>
        <p className="mt-3 text-sm leading-6 text-stone-400">
          Some jurisdictions do not allow certain disclaimers to be excluded. Where that is the
          case, the exclusions above apply only as far as that law permits.
        </p>
      </PageSection>

      <PageSection heading="Stopping">
        <p className="text-sm leading-6 text-stone-400">
          You can stop using the software at any time, delete your account and content from within
          the app, or delete the whole database from your server. An operator can shut a server
          down at any time, with or without notice, and the campaigns on it go with it.
        </p>
      </PageSection>

      <PageSection heading="Changes to these terms">
        <p className="text-sm leading-6 text-stone-400">
          These terms are part of the open source project and change only when the code changes.
          Each release carries the version of these terms that shipped with it, and you can review
          the current text and its full history in the project repository. If a part of these terms
          is unenforceable where you live, the rest still stands.
        </p>
        <p className="mt-3 text-sm leading-6 text-stone-400">
          This page is written in plain language and is not legal advice. If you run a public or
          commercial server, get advice that fits your situation.
        </p>
      </PageSection>

      <PageSection heading="Contact">
        <p className="text-sm leading-6 text-stone-400">
          There is no company, support address, or email behind this project. Questions about the
          software, including license and security reports, belong in the project repository.
          Questions about a specific server belong to whoever runs it.
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

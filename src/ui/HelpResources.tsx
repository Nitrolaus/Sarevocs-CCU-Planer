import React, { useContext, useState } from 'react';
import type { HelpDocument, HelpResource } from '../main/help-resources';
import { LanguageContext } from './i18n';
import { APP_VERSION } from '../domain/model';

export type HelpSection = 'guide' | 'security' | 'guardian' | 'community';
type InfoCard = { title: string; body: string };
type CommunityCard = InfoCard & { resource: HelpResource; kind: string };

const releaseHash = '3ede28bc5388df522765a10c5dc2c61f8b68a2cb75ef18731ac534a949bac016';
const hashCommand = `Get-FileHash -Algorithm SHA256 -LiteralPath '.\\Sarevocs-CCU-Planer-Setup-${APP_VERSION}.exe'`;

export const helpSectionLabels = {
  de: { guide: 'Einstieg', security: 'Sicherheit & Download', guardian: 'Joystick Guardian', community: 'Community & Tools' },
  en: { guide: 'Getting started', security: 'Security & Downloads', guardian: 'Joystick Guardian', community: 'Community & Tools' },
} satisfies Record<'de' | 'en', Record<HelpSection, string>>;

const copy = {
  de: {
    securityIntro: 'Was der Planer liest, wie er deine Daten schützt und wie du deinen Installer prüfst.',
    securityCards: [
      { title: 'Dein Hangar bleibt in deiner Hand', body: 'Der Planer liest Hangar, Buy Back und Store Credits für deine Planung. Kaufen, Anwenden, Verschenken und Einschmelzen sind im Planer gesperrt. Shop-Links öffnen deinen Standardbrowser.' },
      { title: 'Anmeldung direkt bei RSI', body: 'Passwort und MFA gibst du bei RSI ein. Mit „Angemeldet bleiben“ speichert der Planer die wiederverwendbare Sitzung verschlüsselt mit Windows-Schutz und getrennt vom Bestand. Unter „Sitzung & Sicherheit“ kannst du sie löschen. RSI bestimmt ihre Gültigkeit.' },
      { title: 'Bestand und Exporte bleiben bei dir', body: 'Bestand, Planungen und Einstellungen liegen lokal in deinem Windows-Benutzerprofil. Die ausgewählten Daten und dein Profilname stehen im Excel- oder PDF-Export. Du entscheidest, ob du die Datei teilst.' },
    ],
    hashTitle: 'Installer mit SHA-256 prüfen',
    hashIntro: 'Öffne PowerShell im Ordner des heruntergeladenen Installers. Vergleiche den ausgegebenen Hash mit der veröffentlichten SHA256.txt derselben Version. Gleiche Werte bestätigen, dass beide Dateien bytegleich sind.',
    hashExample: 'Beispiel einer früheren Version · Installer 0.3.59',
    hashLink: 'Microsoft-Anleitung zu Get-FileHash',
    rightsTitle: 'Nutzungsbedingungen und Lizenzen',
    rightsCards: [
      { title: 'Kostenlos nutzen und weitergeben', body: 'Die Bedingungen der Fan-Testversion erlauben die private Planung und die kostenlose Weitergabe des unveränderten Installers. Programmname und Urhebervermerk bleiben erhalten. Der Programmcode ist derzeit ohne Open-Source-Lizenz.' },
      { title: 'Star Citizen und Fan-Illustrationen', body: 'Sarevoc´s CCU Planer ist ein unabhängiges Fan-Projekt. Rechte an Star Citizen, Squadron 42 und den zugrunde liegenden Schiffdesigns liegen bei den jeweiligen Rechteinhabern. Für offizielle Fan-Kit-Inhalte gelten die Bedingungen von RSI.' },
      { title: 'Lizenzen der Fremdkomponenten', body: 'Die Lizenzhinweise führen die mitgelieferten Komponenten und ihre jeweiligen Bedingungen auf, darunter die Lucide-Symbole und die Orbitron-Schrift.' },
    ],
    documentLabels: { terms: 'Nutzungsbedingungen', privacy: 'Datenschutz', notices: 'Fremdkomponenten und Lizenzen' },
    fankit: 'RSI-Hinweise zu Fan-Projekten',
    loading: 'Wird geladen …',
    documentError: 'Dieses Dokument konnte nicht geladen werden.',
    linkError: 'Der Link konnte nicht geöffnet werden.',
    guardianIntro: 'Ein separates Windows-Projekt für Joysticks, Schubregler und Pedale. Es hilft dir, deine Eingabegeräte und Setups für Star Citizen im Blick zu behalten.',
    guardianCards: [
      { title: 'Geräte im Blick', body: 'Sieh, welche Geräte dein Setup erkennt und wie deine Sticks, Regler und Pedale zugeordnet sind.' },
      { title: 'Setups verwalten', body: 'Organisiere verschiedene Gerätekonfigurationen, etwa für HOTAS oder HOSAS.' },
      { title: 'Belegungen prüfen', body: 'Vergleiche die Zuordnung der Geräte mit den Star-Citizen-Belegungen, wenn sich dein Setup ändert.' },
    ],
    communityIntro: 'Organisationen, Streams und Werkzeuge rund um Star Citizen. Die Links öffnen deinen Standardbrowser.',
    communityCards: [
      { title: 'The Eternal Companions', body: 'Offizielles Organisationsprofil auf RSI.', resource: 'teces', kind: 'Organisation · TECES' },
      { title: 'Kerberos', body: 'Offizielles Organisationsprofil auf RSI.', resource: 'kerberos', kind: 'Organisation · KERNAVY' },
      { title: 'Die Bauaufsicht', body: 'Offizielles Organisationsprofil auf RSI.', resource: 'bauaufsicht', kind: 'Organisation · BAUORG' },
      { title: 'Arasil', body: 'Streams, Videos und Clips auf Twitch.', resource: 'arasil', kind: 'Twitch' },
      { title: 'Erkul', body: 'Schiffsausrüstung zusammenstellen und Komponenten vergleichen.', resource: 'erkul', kind: 'Loadout-Planer' },
    ] satisfies CommunityCard[],
  },
  en: {
    securityIntro: 'What the planner reads, how it stores your data, and how to verify your installer.',
    securityCards: [
      { title: 'You stay in control of your hangar', body: 'The planner reads your hangar, Buy Back and store credit for planning. Purchases, upgrades, gifts and reclaims are blocked inside the planner. Shop links open in your default browser.' },
      { title: 'Sign in directly at RSI', body: 'You enter your password and MFA at RSI. With “Stay signed in”, the planner encrypts the reusable session using Windows protection and stores it separately from your inventory. You can delete it under “Session & Security”. RSI controls its validity.' },
      { title: 'Your inventory and reports stay local', body: 'Inventory, plans and settings are kept in your Windows user profile. Excel and PDF exports contain the selected data and your profile name. You decide whether to share the file.' },
    ],
    hashTitle: 'Verify the installer with SHA-256',
    hashIntro: 'Open PowerShell in the folder containing the downloaded installer. Match the reported hash against the published SHA256.txt for the same version. A match confirms that both files are byte-for-byte identical.',
    hashExample: 'Example from an earlier release · Installer 0.3.59',
    hashLink: 'Microsoft guide to Get-FileHash',
    rightsTitle: 'Terms and licenses',
    rightsCards: [
      { title: 'Free to use and share', body: 'The fan test release terms allow private planning and free sharing of the unmodified installer with the program name and copyright notice intact. The program source currently has no open-source license.' },
      { title: 'Star Citizen and fan illustrations', body: 'Sarevoc´s CCU Planer is an independent fan project. Rights in Star Citizen, Squadron 42 and the underlying ship designs belong to their respective owners. Official Fan Kit material is subject to RSI’s terms.' },
      { title: 'Third-party licenses', body: 'The third-party notices list the included components and their individual terms, including the Lucide icons and Orbitron typeface.' },
    ],
    documentLabels: { terms: 'Terms of use (German)', privacy: 'Privacy information (German)', notices: 'Third-party notices and licenses' },
    fankit: 'RSI fan project guidelines',
    loading: 'Loading …',
    documentError: 'Could not load this document.',
    linkError: 'Could not open this link.',
    guardianIntro: 'A separate Windows project for joysticks, throttles and pedals. It helps you manage your input devices and setups for Star Citizen.',
    guardianCards: [
      { title: 'See your devices', body: 'See which devices your setup detects and how your sticks, throttles and pedals are assigned.' },
      { title: 'Manage setups', body: 'Organize different device configurations, including HOTAS and HOSAS setups.' },
      { title: 'Check bindings', body: 'Compare device assignments with Star Citizen bindings when your setup changes.' },
    ],
    communityIntro: 'Organizations, streams and tools for Star Citizen. Links open in your default browser.',
    communityCards: [
      { title: 'The Eternal Companions', body: 'Official organization profile on RSI.', resource: 'teces', kind: 'Organization · TECES' },
      { title: 'Kerberos', body: 'Official organization profile on RSI.', resource: 'kerberos', kind: 'Organization · KERNAVY' },
      { title: 'Die Bauaufsicht', body: 'Official organization profile on RSI.', resource: 'bauaufsicht', kind: 'Organization · BAUORG' },
      { title: 'Arasil', body: 'Streams, videos and clips on Twitch.', resource: 'arasil', kind: 'Twitch' },
      { title: 'Erkul', body: 'Build loadouts and compare ship components.', resource: 'erkul', kind: 'Loadout planner' },
    ] satisfies CommunityCard[],
  },
};

function InfoCards({ cards }: { cards: InfoCard[] }) {
  return <div className="help-resource-grid">
    {cards.map(card => <article className="help-resource-card" key={card.title}>
      <h3>{card.title}</h3><p>{card.body}</p>
    </article>)}
  </div>;
}

async function requestDocument(document: HelpDocument) {
  const response = await window.ccu.request({ action: 'help.readDocument', document });
  if (!response.ok || typeof response.data !== 'string') throw new Error('HELP_DOCUMENT_UNAVAILABLE');
  return response.data;
}

export function HelpResources({ section }: { section: Exclude<HelpSection, 'guide'> }) {
  const language = useContext(LanguageContext);
  const labels = helpSectionLabels[language];
  const info = copy[language];
  const [failed, setFailed] = useState<HelpResource | null>(null);
  const [documents, setDocuments] = useState<Partial<Record<HelpDocument, string | false>>>({});

  async function open(resource: HelpResource) {
    setFailed(null);
    try {
      const result = await window.ccu.request({ action: 'help.openResource', resource });
      if (!result.ok) setFailed(resource);
    } catch { setFailed(resource); }
  }

  async function load(document: HelpDocument) {
    try {
      const content = await requestDocument(document);
      setDocuments(previous => ({ ...previous, [document]: content }));
    } catch { setDocuments(previous => ({ ...previous, [document]: false })); }
  }

  return <section className="panel help-resource-panel" aria-labelledby="help-resource-title">
    <h2 id="help-resource-title">{labels[section]}</h2>
    {section === 'security' && <>
      <p>{info.securityIntro}</p>
      <InfoCards cards={info.securityCards} />
      <section className="help-hash">
        <h3>{info.hashTitle}</h3>
        <p>{info.hashIntro}</p>
        <code>{hashCommand}</code>
        <p>{info.hashExample}</p>
        <code>{releaseHash}</code>
        <button type="button" className="help-reference" onClick={() => void open('fileHash')}>{info.hashLink} ↗</button>
      </section>
      <h3>{info.rightsTitle}</h3>
      <InfoCards cards={info.rightsCards} />
      <div className="help-documents">
        {(Object.keys(info.documentLabels) as HelpDocument[]).map(document => <details key={document}
          onToggle={event => { if (event.currentTarget.open && !documents[document]) void load(document); }}>
          <summary>{info.documentLabels[document]}</summary>
          <pre>{documents[document] === false ? info.documentError : documents[document] ?? info.loading}</pre>
        </details>)}
      </div>
      <button type="button" className="help-reference" onClick={() => void open('fankit')}>{info.fankit} ↗</button>
    </>}
    {section === 'guardian' && <>
      <p>{info.guardianIntro}</p><InfoCards cards={info.guardianCards} />
    </>}
    {section === 'community' && <>
      <p>{info.communityIntro}</p>
      <div className="help-resource-grid">
        {info.communityCards.map(card => <article className="help-resource-card" key={card.resource}>
          <small>{card.kind}</small>
          <h3><button type="button" className="help-reference" onClick={() => void open(card.resource)}>
            <span className="help-link-label">{card.title}</span>
            <span className="help-link-icon" aria-hidden="true">↗</span>
          </button></h3>
          <p>{card.body}</p>
        </article>)}
      </div>
    </>}
    {failed && <p className="help-error" role="alert">{info.linkError}</p>}
  </section>;
}

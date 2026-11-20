import React, { useContext, useState } from 'react';
import type { RsiHelpTopic } from '../main/rsi-help';
import { LanguageContext, useText } from './i18n';
import { HelpResources, helpSectionLabels, type HelpSection } from './HelpResources';
import './help.css';

type Chapter = {
  id: 'access' | 'ccu' | 'chain' | 'payment' | 'planner' | 'apply';
  label?: string;
  title: string;
  paragraphs?: readonly string[];
  steps?: readonly string[];
  reference?: { topic: RsiHelpTopic; label: string };
};
type HelpCopy = {
  intro: string;
  topics: string;
  error: string;
  bugReport: { label: string; error: string };
  example: { caption: string; description: string; ships: readonly { name: string; price: string }[] };
  chapters: readonly Chapter[];
};

const copy: Record<'de' | 'en', HelpCopy> = {
  de: {
    intro: 'Star Citizen · Vom ersten Schiff zur CCU-Kette',
    topics: 'Themen',
    error: 'Die RSI-Hilfeseite konnte nicht geöffnet werden.',
    bugReport: { label: 'Fehler melden', error: 'Das GitHub-Formular konnte nicht geöffnet werden.' },
    example: {
      caption: 'Fiktives Beispiel · USD vor Steuer',
      description: 'Schiff A zu Schiff B zu Schiff C',
      ships: [{ name: 'Schiff A', price: 'Startwert 50 $' }, { name: 'Schiff B', price: 'Standard-CCU 50 $' }, { name: 'Schiff C', price: 'Warbond-CCU 30 $' }],
    },
    chapters: [
      { id: 'access', label: 'Spielzugang', title: 'Erst den Spielzugang prüfen',
        paragraphs: ['Für den regulären Einstieg brauchst du ein RSI-Konto mit einem Spielpaket, das Star Citizen enthält. Prüfe beim Kauf die Zeile „Star Citizen Digital Download“. Ein Einzelschiff oder CCU allein gewährt keinen Spielzugang.'],
        reference: { topic: 'gettingStarted', label: 'RSI-Einstiegscheckliste' } },
      { id: 'ccu', label: 'Was ist ein CCU?', title: 'Ein CCU ist ein Schiffsupgrade',
        paragraphs: ['CCU steht für Cross Chassis Upgrade. Bei RSI wählst du links das exakte Ausgangsmodell und rechts das höherwertige Zielschiff. Das Upgrade liegt nach dem Kauf in deinem Hangar. Du wendest es später auf ein passendes Schiff an.'],
        reference: { topic: 'upgrades', label: 'RSI-Anleitung zu Schiffsupgrades' } },
      { id: 'chain', label: 'Beispielkette', title: 'So entsteht eine Kette',
        paragraphs: ['Das Ziel jedes CCUs muss das Ausgangsmodell des nächsten sein. Kostet B → C regulär 50 $, sinkt der Zukauf im Beispiel von 100 $ auf 80 $. Hast du A → B bereits im Bestand, fehlt nur noch B → C.'] },
      { id: 'payment', label: 'Preise & Versicherung', title: 'Warbond, Store Credits und LTI',
        paragraphs: ['Warbond erfordert Frischgeld. Standard-CCUs kannst du in der Regel ganz oder teilweise mit Store Credits bezahlen. Prüfe im Warenkorb den Endbetrag samt MwSt.', 'LTI steht für Lifetime Insurance. Die vorhandene Versicherung bleibt beim normalen Upgrade erhalten. Prüfe bei beworbenen Boni, ob der konkrete CCU eine zusätzliche Versicherung enthält.'],
        reference: { topic: 'storeCredit', label: 'RSI-Zahlungsregeln' } },
      { id: 'planner', label: 'Im Planer', title: 'Deinen ersten Weg im Planer bauen',
        steps: ['Bestand lesen, Zielschiff und passende Startbasis wählen.', 'Türkis zeigt vorhandene CCUs. Orange zeigt Schritte, für die du noch einen CCU brauchst. Jedes Exemplar passt nur in eine Zielkette zugleich.', 'Bei Messeangeboten den gesamten Zukauf und alle Anschlüsse vergleichen. Kaufpreis und Verfügbarkeit vor dem Kauf bei RSI prüfen.'] },
      { id: 'apply', title: 'Vor dem Anwenden',
        paragraphs: ['Prüfe die Reihenfolge und das genaue Startschiff. Angewendete CCUs lassen sich nicht einzeln zurücknehmen. Prüfe vor einem Reclaim, an welchem Paket dein Spielzugang hängt. Der Planer verändert deinen Hangar nicht.'],
        reference: { topic: 'revert', label: 'RSI-Hinweise zum Rückweg' } },
    ],
  },
  en: {
    intro: 'Star Citizen · From your first ship to a CCU chain',
    topics: 'Topics',
    error: 'Could not open the RSI help page.',
    bugReport: { label: 'Report a bug', error: 'Could not open the GitHub form.' },
    example: {
      caption: 'Fictional example · USD before tax',
      description: 'Ship A to Ship B to Ship C',
      ships: [{ name: 'Ship A', price: '$50 starting value' }, { name: 'Ship B', price: '$50 standard CCU' }, { name: 'Ship C', price: '$30 Warbond CCU' }],
    },
    chapters: [
      { id: 'access', label: 'Game access', title: 'Check game access first',
        paragraphs: ['To get started normally, you need an RSI account with a game package that includes Star Citizen. Check for “Star Citizen Digital Download” when buying a package. A standalone ship or CCU alone does not grant game access.'],
        reference: { topic: 'gettingStarted', label: 'RSI getting started checklist' } },
      { id: 'ccu', label: 'What is a CCU?', title: 'A CCU is a ship upgrade',
        paragraphs: ['CCU stands for Cross Chassis Upgrade. On RSI, select the exact starting model on the left and a higher-value target on the right. After purchase, the upgrade appears in your hangar. You apply it when you are ready and have a matching ship.'],
        reference: { topic: 'upgrades', label: 'RSI guide to ship upgrades' } },
      { id: 'chain', label: 'Example chain', title: 'How a chain fits together',
        paragraphs: ['Each CCU must end at the exact model required by the next one. If B → C usually costs $50, the example cuts the total from $100 to $80. If you already own A → B, only B → C remains to buy.'] },
      { id: 'payment', label: 'Prices & insurance', title: 'Warbond, store credit and LTI',
        paragraphs: ['Warbond requires new money. You can usually pay for standard CCUs fully or partly with store credit. Check the final amount and any tax at checkout.', 'LTI stands for Lifetime Insurance. A standard upgrade keeps existing insurance. If a bonus is advertised, check whether the specific CCU includes additional insurance.'],
        reference: { topic: 'storeCredit', label: 'RSI store credit rules' } },
      { id: 'planner', label: 'Using the planner', title: 'Build your first route in the planner',
        steps: ['Read your inventory, pick a target and choose a starting ship.', 'Turquoise marks owned CCUs. Orange marks steps that still need a CCU. Each owned copy can only be assigned to one target chain at a time.', 'Compare total remaining cost and check how the steps connect. Confirm the actual price and availability on RSI before buying.'] },
      { id: 'apply', title: 'Before applying an upgrade',
        paragraphs: ['Check the order and exact starting ship. Applied CCUs cannot be reverted individually. Before reclaiming anything, check which package provides your game access. The planner leaves your hangar as it is.'],
        reference: { topic: 'revert', label: 'RSI guidance on reversing upgrades' } },
    ],
  },
};

export function HelpView() {
  const t = useText();
  const language = useContext(LanguageContext);
  const guide = copy[language];
  const labels = helpSectionLabels[language];
  const [section, setSection] = useState<HelpSection>('guide');
  const [currentChapter, setCurrentChapter] = useState<Chapter['id'] | null>(null);
  const [failed, setFailed] = useState<RsiHelpTopic | null>(null);
  const [bugReportState, setBugReportState] = useState<'opening' | 'failed' | null>(null);
  async function open(topic: RsiHelpTopic) {
    setFailed(null);
    try {
      const result = await window.ccu.request({ action: 'help.openRsi', topic });
      if (!result.ok) setFailed(topic);
    } catch { setFailed(topic); }
  }

  async function openBugReport() {
    setBugReportState('opening');
    try {
      const result = await window.ccu.request({ action: 'help.openResource', resource: language === 'de' ? 'bugReportDe' : 'bugReportEn' });
      setBugReportState(result.ok ? null : 'failed');
    } catch { setBugReportState('failed'); }
  }

  return <section className="help-view" aria-labelledby="help-title">
    <header className="help-head">
      <div className="help-heading-text"><h1 id="help-title">{t('Hilfe & Einstieg')}</h1><p>{guide.intro}</p></div>
      <div className="help-report">
        <button type="button" disabled={bugReportState === 'opening'} onClick={() => void openBugReport()}>
          {guide.bugReport.label} <span aria-hidden="true">↗</span>
        </button>
        {bugReportState === 'failed' && <p className="help-error" role="alert">{guide.bugReport.error}</p>}
      </div>
    </header>
    <nav className="help-sections" aria-label={t('Hilfe & Einstieg')}>
      {(Object.keys(labels) as HelpSection[]).map(key => <button key={key} type="button"
        aria-pressed={section === key} onClick={() => setSection(key)}>{labels[key]}</button>)}
    </nav>
    {section === 'guide' ? <>
    <nav className="help-topics panel" aria-label={guide.topics}>
      {guide.chapters.filter(chapter => chapter.label).map(chapter => <a key={chapter.id} href={'#help-' + chapter.id}
        aria-current={currentChapter === chapter.id ? 'location' : undefined}
        onClick={event => {
          event.preventDefault();
          setCurrentChapter(chapter.id);
          const section = document.getElementById(event.currentTarget.hash.slice(1));
          section?.focus({ preventScroll: true });
          section?.scrollIntoView({ block: 'start' });
        }}>{chapter.label}</a>)}
    </nav>
    <div className="help-chapters">
      {guide.chapters.map(chapter => <section key={chapter.id} id={'help-' + chapter.id} tabIndex={-1}
        data-current={currentChapter === chapter.id || undefined}
        aria-labelledby={'help-heading-' + chapter.id} className={'panel help-chapter help-' + chapter.id}>
        <h2 id={'help-heading-' + chapter.id}>{chapter.title}</h2>
        {chapter.id === 'chain' && <>
          <small className="help-example-caption">{guide.example.caption}</small>
          <div className="help-route" role="group" aria-label={guide.example.description}>
            {guide.example.ships.map((ship, index) => <React.Fragment key={ship.name}>
              {index > 0 && <span className="help-arrow" aria-hidden="true">→</span>}
              <div className="help-ship"><strong>{ship.name}</strong><small>{ship.price}</small></div>
            </React.Fragment>)}
          </div>
        </>}
        {chapter.paragraphs?.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
        {chapter.steps && <ol>{chapter.steps.map(step => <li key={step}>{step}</li>)}</ol>}
        {chapter.reference && <button type="button" className="help-reference"
          onClick={() => void open(chapter.reference!.topic)}>{chapter.reference.label} ↗</button>}
        {failed && failed === chapter.reference?.topic && <p className="help-error" role="alert">{guide.error}</p>}
      </section>)}
    </div>
    </> : <HelpResources key={section} section={section} />}
  </section>;
}

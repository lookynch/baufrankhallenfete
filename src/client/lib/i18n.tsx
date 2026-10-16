import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

const de = {
  'lang.name': 'Deutsch',
  'guest.scan.title': 'Scanne den QR-Code am Bildschirm',
  'guest.scan.text':
    'Zum Mitmachen einfach den QR-Code auf dem großen Bildschirm in der Halle mit der Handykamera scannen.',
  'guest.joining': 'Einen Moment …',
  'guest.qrExpired': 'Der QR-Code ist abgelaufen. Bitte einfach nochmal scannen.',
  'guest.retry': 'Erneut versuchen',
  'guest.tab.vote': 'Abstimmen',
  'guest.tab.wish': 'Wunsch',
  'guest.vote.title': 'Welcher Song soll laufen?',
  'guest.vote.hint': 'Tippe auf deinen Favoriten. Du kannst deine Stimme bis zum Ende der Runde ändern.',
  'guest.vote.mine': 'Deine Stimme',
  'guest.vote.saved': 'Stimme gespeichert!',
  'guest.vote.endsIn': 'Runde endet in',
  'guest.vote.round': 'Runde {seq}',
  'guest.vote.notStarted': 'Das Voting startet um {time} Uhr',
  'guest.vote.none': 'Gleich geht die nächste Runde los …',
  'guest.vote.ended': 'Das Voting ist für heute beendet. Danke fürs Mitmachen!',
  'guest.error.ip_limit':
    'Von diesem Netz wurde in dieser Runde schon abgestimmt. In der nächsten Runde klappt es wieder.',
  'guest.error.round_closed': 'Diese Runde ist gerade zu Ende gegangen – die nächste startet sofort.',
  'guest.error.rate_limited': 'Kurz durchatmen – bitte gleich nochmal versuchen.',
  'guest.error.vote_invalidated': 'Deine Stimme in dieser Runde wurde von der Moderation ungültig gesetzt.',
  'guest.error.generic': 'Das hat nicht geklappt. Bitte nochmal versuchen.',
  'guest.error.network': 'Keine Verbindung. Wir versuchen es automatisch erneut.',
  'guest.nowPlaying': 'Läuft gerade',
  'guest.wish.title': 'Dein Songwunsch',
  'guest.wish.hint': 'Song suchen, antippen, fertig. Das Orga-Team prüft den Wunsch, danach kommt er ins Voting.',
  'guest.wish.search': 'Song oder Künstler suchen',
  'guest.wish.send': 'Wünschen',
  'guest.wish.sent': 'Wunsch {key} angelegt!',
  'guest.wish.merged': 'Gibt es schon – deine Stimme wurde dazugezählt ({key})',
  'guest.wish.mine': 'Meine Wünsche',
  'guest.wish.public': 'Freigegebene Wünsche',
  'guest.wish.upvote': '+1',
  'guest.wish.limited': 'Gerade sehr viele Suchen – bitte gleich nochmal.',
  'guest.wish.error.too_many_open_wishes': 'Du hast schon 3 offene Wünsche. Warte, bis das Team sie geprüft hat.',
  'guest.wish.error.already_played': 'Der Song lief heute schon.',
  'guest.wish.error.limited': 'Gerade sehr viele Wünsche – bitte gleich nochmal.',
  'guest.wish.upvoteLimited': 'Von diesem Netz wurde dieser Wunsch schon unterstützt.',
  'guest.wish.empty': 'Noch keine Wünsche.',
  'status.open': 'In Prüfung',
  'status.approved': 'Freigegeben',
  'status.rejected': 'Abgelehnt',
  'status.played': 'Im Voting',
  'privacy.short':
    'Privat betrieben von {name}. Zum Mitmachen speichern wir ein Geräte-Cookie und einen pseudonymisierten Netz-Schlüssel. Daten deines Geräts löschen wir spätestens {days} Tage nach deiner letzten Aktivität.',
  'privacy.note':
    'Datenschutz: {name} betreibt diese App privat. Damit jedes Gerät nur einmal pro Runde abstimmt, speichern wir eine zufällige Geräte-ID im Cookie und einen pseudonymisierten Netz-Schlüssel, der aus deiner IP-Adresse berechnet wird. Stimmen und Geräte-Daten löschen wir spätestens {days} Tage nach deiner letzten Aktivität, Wünsche werden dann anonymisiert. Details, deine Rechte und dein Widerspruchsrecht stehen in der Datenschutzerklärung.',
  'privacy.forget': 'Meine Daten auf diesem Gerät löschen',
  'privacy.forget.confirm':
    'Deine Stimmen, deine Geräte-ID und das Cookie werden sofort gelöscht, deine Wünsche anonymisiert. Zum Mitmachen musst du danach den QR-Code neu scannen. Fortfahren?',
  'legal.privacy': 'Datenschutz',
  'legal.imprint': 'Impressum',
  'legal.back': 'Zurück',
  'spotify.open': 'Open Spotify',
  'spotify.attribution': 'Musikdaten von Spotify',
  'mood.1': 'Chill',
  'mood.2': 'Warm',
  'mood.3': 'Groove',
  'mood.4': 'Party',
  'mood.5': 'Eskalation',
  'tv.scan': 'Scannen & mitvoten',
  'tv.upNext': 'Als Nächstes',
  'tv.round': 'Runde {seq}',
  'tv.endsIn': 'endet in',
  'tv.votes': 'Stimmen: {count}',
  'tv.votingStarts': 'Voting startet um {time} Uhr',
  'tv.votingEnded': 'Voting beendet – danke!',
  'tv.waiting': 'Nächste Runde startet gleich',
  'tv.spotifyIssue': 'Spotify-Verbindung prüfen',
  'tv.wishes': 'Neu freigegeben',
  'tv.mood': 'Stimmung',
  'tv.noMusic': 'Musik startet gleich',
  'tv.upNextEmpty': 'Hier erscheinen die Gewinner-Songs der Runde.',
  'tv.more': '+{count} weitere Songs zur Wahl',
  'tv.privacy': 'Datenschutz & Impressum: {host}/datenschutz',
  'display.pair.title': 'Bildschirm koppeln',
  'display.pair.text': 'Im Adminbereich unter „Displays“ diesen Code eingeben und die Rolle des Bildschirms wählen.',
  'display.pair.expired': 'Code abgelaufen – neuer Code wird erzeugt.',
  'display.offline': 'Offline – zeige letzten Stand',
  'bar.crates': 'Kästen',
  'bar.cumulative': 'Kästen gesamt',
  'bar.perQuarter': 'pro 15 Minuten',
  'bar.rate': 'Tempo',
  'bar.perHour': 'Kästen/Stunde',
  'bar.forecast': 'Prognose bis Ende',
  'bar.peak': 'Peak',
  'bar.last': 'Zuletzt geholt',
  'bar.cost': 'Kosten',
  'bar.budget': 'Budget',
  'bar.journal': 'Journal',
  'bar.accounts': 'Konten (Soll / Haben)',
  'bar.debit': 'Soll',
  'bar.credit': 'Haben',
  'bar.costPerHour': 'Kosten/Stunde',
  'bar.remaining': 'verbleibend',
  'bar.statistic': 'Neben- und Statistikbuchhaltung – Kostenschätzung',
  'player.title': 'Player-Taktgeber',
  'player.text': 'Dieses Fenster offen lassen. Es sorgt dafür, dass die Gewinner-Songs pünktlich eingereiht werden.',
  'player.next': 'Nächster Song',
};

const en: Record<keyof typeof de, string> = {
  'lang.name': 'English',
  'guest.scan.title': 'Scan the QR code on the screen',
  'guest.scan.text': 'To join, scan the QR code on the big screen in the hall with your phone camera.',
  'guest.joining': 'One moment …',
  'guest.qrExpired': 'The QR code has expired. Please scan it again.',
  'guest.retry': 'Try again',
  'guest.tab.vote': 'Vote',
  'guest.tab.wish': 'Request',
  'guest.vote.title': 'Which song should play?',
  'guest.vote.hint': 'Tap your favourite. You can change your vote until the round ends.',
  'guest.vote.mine': 'Your vote',
  'guest.vote.saved': 'Vote saved!',
  'guest.vote.endsIn': 'Round ends in',
  'guest.vote.round': 'Round {seq}',
  'guest.vote.notStarted': 'Voting starts at {time}',
  'guest.vote.none': 'The next round starts in a moment …',
  'guest.vote.ended': 'Voting has ended for tonight. Thanks for joining!',
  'guest.error.ip_limit': 'Someone on this network already voted this round. Try again next round.',
  'guest.error.round_closed': 'This round just ended – the next one starts right away.',
  'guest.error.rate_limited': 'Take a breath – please try again in a moment.',
  'guest.error.vote_invalidated': 'Your vote in this round was invalidated by the moderators.',
  'guest.error.generic': 'That did not work. Please try again.',
  'guest.error.network': 'No connection. Retrying automatically.',
  'guest.nowPlaying': 'Now playing',
  'guest.wish.title': 'Your song request',
  'guest.wish.hint': 'Search, tap, done. The team reviews your request, then it enters the vote.',
  'guest.wish.search': 'Search song or artist',
  'guest.wish.send': 'Request',
  'guest.wish.sent': 'Request {key} created!',
  'guest.wish.merged': 'Already requested – your vote was added ({key})',
  'guest.wish.mine': 'My requests',
  'guest.wish.public': 'Approved requests',
  'guest.wish.upvote': '+1',
  'guest.wish.limited': 'Lots of searches right now – please try again shortly.',
  'guest.wish.error.too_many_open_wishes': 'You already have 3 open requests. Wait until the team has reviewed them.',
  'guest.wish.error.already_played': 'This song already played tonight.',
  'guest.wish.error.limited': 'Lots of requests right now – please try again shortly.',
  'guest.wish.upvoteLimited': 'This request has already been supported from your network.',
  'guest.wish.empty': 'No requests yet.',
  'status.open': 'In review',
  'status.approved': 'Approved',
  'status.rejected': 'Rejected',
  'status.played': 'In the vote',
  'privacy.short':
    'Run privately by {name}. To take part we store a device cookie and a pseudonymised network key. We delete your device’s data no later than {days} days after your last activity.',
  'privacy.note':
    'Privacy: {name} runs this app privately. To make sure each device votes only once per round, we store a random device ID in a cookie and a pseudonymised network key derived from your IP address. Votes and device data are deleted no later than {days} days after your last activity; requests are then anonymised. Details, your rights and your right to object are in the privacy policy.',
  'privacy.forget': 'Delete my data on this device',
  'privacy.forget.confirm':
    'Your votes, your device ID and the cookie will be deleted immediately and your requests anonymised. To take part again you will need to scan the QR code. Continue?',
  'legal.privacy': 'Privacy',
  'legal.imprint': 'Legal notice',
  'legal.back': 'Back',
  'spotify.open': 'Open Spotify',
  'spotify.attribution': 'Music data from Spotify',
  'mood.1': 'Chill',
  'mood.2': 'Warm',
  'mood.3': 'Groove',
  'mood.4': 'Party',
  'mood.5': 'Wild',
  'tv.scan': 'Scan & vote',
  'tv.upNext': 'Up next',
  'tv.round': 'Round {seq}',
  'tv.endsIn': 'ends in',
  'tv.votes': 'Votes: {count}',
  'tv.votingStarts': 'Voting starts at {time}',
  'tv.votingEnded': 'Voting ended – thank you!',
  'tv.waiting': 'Next round starts shortly',
  'tv.spotifyIssue': 'Check Spotify connection',
  'tv.wishes': 'Newly approved',
  'tv.mood': 'Mood',
  'tv.noMusic': 'Music starts shortly',
  'tv.upNextEmpty': 'The winning songs of the round appear here.',
  'tv.more': '+{count} more songs to vote on',
  'tv.privacy': 'Privacy & legal notice: {host}/datenschutz',
  'display.pair.title': 'Pair this screen',
  'display.pair.text': 'Enter this code in the admin area under “Displays” and choose the screen role.',
  'display.pair.expired': 'Code expired – creating a new one.',
  'display.offline': 'Offline – showing last state',
  'bar.crates': 'Crates',
  'bar.cumulative': 'Crates total',
  'bar.perQuarter': 'per 15 minutes',
  'bar.rate': 'Pace',
  'bar.perHour': 'crates/hour',
  'bar.forecast': 'Forecast until end',
  'bar.peak': 'Peak',
  'bar.last': 'Last fetched',
  'bar.cost': 'Cost',
  'bar.budget': 'Budget',
  'bar.journal': 'Journal',
  'bar.accounts': 'Accounts (debit / credit)',
  'bar.debit': 'Debit',
  'bar.credit': 'Credit',
  'bar.costPerHour': 'Cost/hour',
  'bar.remaining': 'remaining',
  'bar.statistic': 'Subsidiary ledger – cost estimate',
  'player.title': 'Player ticker',
  'player.text': 'Keep this window open. It makes sure winning songs are queued on time.',
  'player.next': 'Next song',
};

export type MessageKey = keyof typeof de;
export type Language = 'de' | 'en';
const dictionaries: Record<Language, Record<MessageKey, string>> = { de, en };

function initialLanguage(): Language {
  try {
    const stored = localStorage.getItem('lang');
    if (stored === 'de' || stored === 'en') return stored;
  } catch {
    return navigator.language.toLowerCase().startsWith('de') ? 'de' : 'en';
  }
  return navigator.language.toLowerCase().startsWith('de') ? 'de' : 'en';
}

interface I18n {
  lang: Language;
  setLang: (lang: Language) => void;
  t: (key: MessageKey, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ children, fixed }: { children: ReactNode; fixed?: Language }) {
  const [lang, setLangState] = useState<Language>(() => fixed ?? initialLanguage());
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  const setLang = useCallback((next: Language) => {
    setLangState(next);
    try {
      localStorage.setItem('lang', next);
    } catch {
      return;
    }
  }, []);
  const value = useMemo<I18n>(
    () => ({
      lang,
      setLang,
      t: (key, params) =>
        Object.entries(params ?? {}).reduce(
          (text, [name, v]) => text.replaceAll(`{${name}}`, String(v)),
          dictionaries[lang][key],
        ),
    }),
    [lang, setLang],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const context = useContext(I18nContext);
  if (!context) throw new Error('I18nProvider missing');
  return context;
}

export function hasMessage(key: string): key is MessageKey {
  return key in de;
}

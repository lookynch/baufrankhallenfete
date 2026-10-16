import { legal } from '../../../shared/legal.ts';
import { theme } from '../../../shared/theme.ts';

export type Block =
  | string
  | { heading: string }
  | { lines: string[] }
  | { list: string[] }
  | { facts: Array<readonly [string, string]> }
  | { table: string[][] }
  | { notice: string; text: string[] };

export interface LegalSection {
  id?: string;
  title: string;
  blocks: Block[];
}

export interface LegalDocument {
  title: string;
  updated?: string;
  sections: LegalSection[];
}

const { controller: c, authority: a, retention: r, cookies: k } = legal;
const { name: eventName, hosts } = theme.event;
const address = [c.name, c.street, c.city, c.country];
const authority = [a.name, a.street, a.city, a.web];
const cloudflare = 'Cloudflare, Inc., 101 Townsend St., San Francisco, CA 94107, USA';
const spotify = 'Spotify AB, Regeringsgatan 19, 111 53 Stockholm';

function updated(locale: string, label: string): string {
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(
    new Date(legal.updatedAt),
  );
  return `${label} ${date}`;
}

const privacyDe: LegalDocument = {
  title: 'Datenschutzerklärung',
  updated: updated('de-DE', 'Stand:'),
  sections: [
    {
      title: '1. Verantwortlicher',
      blocks: [
        'Verantwortlich für die Datenverarbeitung in dieser App ist:',
        { lines: [...address, `E-Mail: ${c.email}`] },
        `Die App ist ein privates, nicht-kommerzielles Projekt von ${c.name}. Ausrichter der ${eventName} ist ${hosts}; betrieben wird die App von ${c.name}. Wer im Adminbereich mithilft, handelt auf Weisung des Betreibers (Art. 29 DSGVO).`,
        'Einen Datenschutzbeauftragten gibt es nicht, weil keine Pflicht dazu besteht.',
      ],
    },
    {
      title: '2. Kurz zusammengefasst',
      blocks: [
        'Zum Mitmachen scannst du den QR-Code am Bildschirm. Dein Gerät erhält dann ein Cookie mit einer zufälligen Geräte-ID. Damit niemand mehrfach abstimmt, speichern wir außerdem einen pseudonymisierten Netz-Schlüssel, der aus deiner IP-Adresse berechnet wird. Deinen Namen oder deine Kontaktdaten erfragen wir nicht.',
        'Die Teilnahme ist freiwillig. Du bist weder gesetzlich noch vertraglich verpflichtet, Daten bereitzustellen. Ohne das Geräte-Cookie kannst du allerdings nicht abstimmen und keine Wünsche abgeben.',
        'Die App lädt Inhalte nur von dieser Domain. Sie enthält keine Werbung, kein Tracking und keine Skripte, Schriften oder Bilder von Drittanbietern.',
        `Daten deines Geräts löschen wir automatisch spätestens ${r.guestDays} Tage nach deiner letzten Aktivität (Abschnitt 7). Sofort löschen kannst du sie in der App mit „Meine Daten auf diesem Gerät löschen“.`,
      ],
    },
    {
      title: '3. Was wir verarbeiten und warum',
      blocks: [
        'Rechtsgrundlage ist jeweils Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse), für Speicher auf deinem Gerät zusätzlich § 25 Abs. 2 Nr. 2 TDDDG. Wie lange wir die Daten speichern, steht in Abschnitt 7.',
        { heading: 'a) Aufruf der App (Hosting)' },
        {
          facts: [
            [
              'Daten',
              'IP-Adresse, Zeitpunkt, aufgerufene Adresse, Browser-Kennung (User-Agent) und weitere technische Verbindungsdaten bei jedem Aufruf.',
            ],
            ['Zweck', 'Auslieferung der App und Schutz vor Angriffen und Überlastung.'],
            [
              'Rechtsgrundlage',
              'Art. 6 Abs. 1 lit. f DSGVO. Berechtigtes Interesse: ein sicherer, funktionierender Betrieb.',
            ],
            [
              'Empfänger',
              'Cloudflare als Auftragsverarbeiter (Abschnitt 5). Netzwerk- und Sicherheitsdaten verarbeitet Cloudflare zusätzlich in eigener Verantwortung, etwa zur Abwehr von Angriffen: https://www.cloudflare.com/privacypolicy/',
            ],
            [
              'Speicherdauer',
              'Die App selbst führt kein Zugriffsprotokoll und speichert IP-Adressen nie im Klartext. Wie lange Cloudflare Verbindungsdaten aufbewahrt, legt Cloudflare fest.',
            ],
          ],
        },
        { heading: 'b) Teilnahme und Geräte-Cookie' },
        {
          facts: [
            [
              'Daten',
              'Cookie `__Host-fete` mit einer zufälligen Geräte-ID und seinem Ablaufzeitpunkt, signiert und für JavaScript nicht lesbar. In der Datenbank: Geräte-ID, Zeitpunkt des ersten und des letzten Beitritts und der Netz-Schlüssel (c).',
            ],
            [
              'Zweck',
              'Dein Gerät wiedererkennen, damit du abstimmen, deine Stimme ändern und deine Wünsche sehen kannst, und damit jedes Gerät pro Runde nur eine Stimme hat.',
            ],
            [
              'Rechtsgrundlage',
              'Speichern und Auslesen des Cookies: § 25 Abs. 2 Nr. 2 TDDDG, weil es für die von dir gewünschte Teilnahme unbedingt erforderlich ist. Übrige Verarbeitung: Art. 6 Abs. 1 lit. f DSGVO. Berechtigtes Interesse: eine faire Abstimmung mit einer Stimme pro Gerät.',
            ],
            [
              'Speicherdauer',
              `Das Cookie läuft spätestens ${r.cookieMaxHours} Stunden nach dem ersten Scan ab; ein erneuter Scan verlängert es nicht. Daten in der Datenbank: Abschnitt 7.`,
            ],
          ],
        },
        { heading: 'c) Pseudonymisierter Netz-Schlüssel' },
        {
          facts: [
            [
              'Daten',
              'Aus deiner IP-Adresse berechnet der Server mit einem geheimen Schlüssel (HMAC-SHA-256) einen Netz-Schlüssel: bei IPv4 aus der vollständigen Adresse, bei IPv6 aus dem /64- und dem /48-Präfix. Die IP-Adresse selbst speichern wir nicht. Der Netz-Schlüssel ist pseudonymisiert, nicht anonym: Mit dem geheimen Schlüssel ließe sich prüfen, ob er zu einer bestimmten IP-Adresse gehört. Er bleibt deshalb ein personenbezogenes Datum.',
            ],
            ['Zweck', 'Stimmen und Unterstützungen je Netz begrenzen und zu viele Anfragen in kurzer Zeit abwehren.'],
            [
              'Rechtsgrundlage',
              'Art. 6 Abs. 1 lit. f DSGVO. Berechtigtes Interesse: eine faire, schwer manipulierbare Abstimmung und Schutz vor Überlastung.',
            ],
            [
              'Empfänger',
              'Im Adminbereich sehen die Helfer bei auffälligen Netzen nur die ersten Zeichen des Netz-Schlüssels und die Zahl der Geräte sowie die aktuellen Anfrage-Zähler.',
            ],
          ],
        },
        { heading: 'd) Abstimmung' },
        {
          facts: [
            [
              'Daten',
              'Runde, gewählter Song, Geräte-ID, Netz-Schlüssel, Zeitpunkt der Stimme und der letzten Änderung, gegebenenfalls ein Ungültig-Vermerk.',
            ],
            [
              'Zweck',
              'Durchführung der Musikabstimmung. Stimmen aus einem auffälligen Netz kann die Moderation ungültig setzen. Angezeigt werden nur Stimmenzahlen je Song, nie wer wofür gestimmt hat.',
            ],
            [
              'Rechtsgrundlage',
              'Art. 6 Abs. 1 lit. f DSGVO. Berechtigtes Interesse: die Gäste über die Musik der Fete mitbestimmen lassen.',
            ],
          ],
        },
        { heading: 'e) Songwünsche und Unterstützung' },
        {
          facts: [
            [
              'Daten',
              'Gewünschter Song, Geräte-ID, Zeitpunkt und Status des Wunsches; bei einer Unterstützung (+1) Geräte-ID, Netz-Schlüssel und Zeitpunkt.',
            ],
            [
              'Zweck',
              'Wünsche entgegennehmen, prüfen lassen und ins Voting übernehmen, offene Wünsche je Gerät und Unterstützungen je Netz begrenzen und dir deine Wünsche anzeigen.',
            ],
            [
              'Rechtsgrundlage',
              'Art. 6 Abs. 1 lit. f DSGVO. Berechtigtes Interesse: Musikwünsche der Gäste fair berücksichtigen.',
            ],
            [
              'Empfänger',
              'Die Moderation sieht Wünsche ohne Geräte-ID. Freigegebene Wünsche erscheinen mit Titel und Interpret in der Wunschliste und auf dem Bildschirm.',
            ],
          ],
        },
        { heading: 'f) Songsuche' },
        {
          facts: [
            [
              'Daten',
              'Dein Suchtext. Unser Server schickt ihn ohne deine IP-Adresse und ohne Geräte-ID an die Spotify-Schnittstelle; wählst du einen Song, gegebenenfalls auch dessen Kennung. Suchtext und Ergebnisse speichern wir ohne Bezug zu deinem Gerät zwischen.',
            ],
            ['Zweck', 'Songs für Wünsche finden. Der Zwischenspeicher schont das Kontingent bei Spotify.'],
            ['Rechtsgrundlage', 'Art. 6 Abs. 1 lit. f DSGVO. Berechtigtes Interesse: Songwünsche ermöglichen.'],
            ['Empfänger', `${spotify}, Schweden.`],
          ],
        },
        'Bitte gib nur Song- oder Künstlernamen ein, keine persönlichen Angaben.',
        { heading: 'g) Cover-Bilder' },
        'Cover-Bilder ruft unser Server bei Spotify ab und liefert sie selbst an dein Gerät aus. Dein Gerät hat dabei keinen Kontakt zu Spotify, und unser Server gibt weder deine IP-Adresse noch Cookies oder andere Gerätedaten an Spotify weiter.',
        { heading: 'h) Links zu Spotify' },
        'Tippst du auf einen Link zu Spotify, öffnet dein Browser eine Seite von Spotify. Erst dann erhält Spotify Daten von deinem Gerät; dafür gilt die Datenschutzerklärung von Spotify.',
        { heading: 'i) Sprachwahl' },
        'Tippst du auf DE oder EN, speichert dein Browser die Wahl im Local Storage (`lang`). Der Eintrag bleibt auf deinem Gerät und wird nicht an uns gesendet. Rechtsgrundlage: § 25 Abs. 2 Nr. 2 TDDDG.',
        { heading: 'j) Automatische Schutzgrenzen' },
        'Feste Grenzen, etwa für Stimmen je Netz und Runde oder Anfragen pro Minute, können eine Stimme oder Anfrage ablehnen. Das ist keine automatisierte Entscheidung im Sinne von Art. 22 DSGVO, weil sie dich weder rechtlich noch in ähnlicher Weise erheblich beeinträchtigt.',
        { heading: 'k) Kontakt per E-Mail' },
        'Schreibst du uns eine E-Mail, verarbeiten wir deine Adresse und den Inhalt, um dein Anliegen zu bearbeiten (Art. 6 Abs. 1 lit. f DSGVO; berechtigtes Interesse: Anfragen beantworten). Das Postfach des Betreibers liegt bei Gmail (Google). Wir löschen die E-Mail, sobald dein Anliegen erledigt ist.',
      ],
    },
    {
      title: '4. Speicher auf deinem Gerät',
      blocks: [
        {
          table: [
            ['Name', 'Art', 'Zweck', 'Laufzeit'],
            [
              '`__Host-fete`',
              'Cookie',
              'Geräte-ID für Abstimmung und Wünsche',
              `höchstens ${r.cookieMaxHours} Stunden ab dem ersten Scan, keine Verlängerung`,
            ],
            [
              '`lang`',
              'Local Storage',
              'gewählte Sprache, nur nach Tippen auf DE oder EN',
              'bis du ihn im Browser löschst',
            ],
            [
              '`__Host-admin`',
              'Cookie, nur Adminbereich',
              'Anmeldung',
              `${k.adminHours} Stunden; die Anmeldung endet schon nach ${k.adminIdleHours} Stunden ohne Aktivität und beim Abmelden`,
            ],
            [
              '`__Host-oauth`',
              'Cookie, nur Adminbereich',
              'Absicherung der Spotify-Verbindung',
              `${k.oauthMinutes} Minuten, nach der Verbindung gelöscht`,
            ],
            [
              '`admin-invite-token`',
              'Session Storage, nur Adminbereich',
              'Einladung bleibt beim Neuladen erhalten',
              'bis die Einrichtung abgeschlossen oder der Tab geschlossen ist',
            ],
            [
              '`__Host-display`',
              'Cookie, nur gekoppelte Bildschirme',
              'Anmeldung von TV- und Bar-Bildschirmen',
              `${k.displayDays} Tage`,
            ],
            [
              '`CF_Authorization`',
              'Cookie von Cloudflare, nur falls Cloudflare Access eingerichtet ist',
              'Zugangsschutz für den Adminbereich',
              'legt Cloudflare Access fest',
            ],
          ],
        },
        'Die Cookies der App gelten nur für diese Domain, werden nur verschlüsselt (HTTPS) übertragen, sind für JavaScript nicht lesbar und enthalten nur Zufallswerte oder signierte Kennungen. Rechtsgrundlage für alle Einträge ist § 25 Abs. 2 Nr. 2 TDDDG, weil sie für die jeweils gewünschte Funktion unbedingt erforderlich sind.',
      ],
    },
    {
      title: '5. Empfänger',
      blocks: [
        {
          list: [
            `${cloudflare}: Hosting der App (Cloudflare Pages und Functions) und der Datenbank (Cloudflare D1) als Auftragsverarbeiter nach Art. 28 DSGVO.`,
            `${spotify}, Schweden: nur Suchtexte und Song-Kennungen, ohne Bezug zu deinem Gerät (Abschnitt 3 f).`,
            'Gmail (Google): nur wenn du uns eine E-Mail schreibst (Abschnitt 3 k).',
          ],
        },
        'Darüber hinaus geben wir keine Daten weiter.',
      ],
    },
    {
      title: '6. Übermittlung in Drittländer',
      blocks: [
        'Cloudflare betreibt ein weltweites Netz. Daten können deshalb auch in den USA oder anderen Ländern außerhalb der EU verarbeitet werden, auch die Datenbank kann dort liegen. Grundlage ist das EU-U.S. Data Privacy Framework (Angemessenheitsbeschluss der EU-Kommission, Durchführungsbeschluss (EU) 2023/1795), hilfsweise Standardvertragsklauseln der EU-Kommission (Durchführungsbeschluss (EU) 2021/914), wie im Auftragsverarbeitungsvertrag von Cloudflare vorgesehen.',
        'Spotify AB hat ihren Sitz in Schweden, also in der EU.',
      ],
    },
    {
      title: '7. Speicherdauer',
      blocks: [
        {
          table: [
            ['Daten', 'Frist'],
            ['Stimmen', `${r.guestDays} Tage nach der letzten Änderung gelöscht`],
            ['Geräteeintrag (Geräte-ID, Netz-Schlüssel)', `${r.guestDays} Tage nach dem letzten Beitritt gelöscht`],
            [
              'Wünsche und Unterstützungen',
              `nach ${r.guestDays} Tagen anonymisiert: Geräte-ID und Netz-Schlüssel werden entfernt, der Wunsch selbst bleibt ohne Personenbezug`,
            ],
            ['Suchtexte im Zwischenspeicher, Anfrage-Zähler', `${r.shortHours} Stunden`],
            ['Geräte-Cookie', `höchstens ${r.cookieMaxHours} Stunden`],
            ['Netz-Schlüssel im Audit-Log (Adminbereich)', `${r.guestDays} Tage`],
            ['Audit-Log', `${r.auditDays} Tage`],
            ['Abgelaufene Admin-Sitzungen', 'beim nächsten Löschlauf'],
            ['E-Mails', 'bis das Anliegen erledigt ist'],
          ],
        },
        `Gelöscht wird automatisch einmal täglich; die Löschung kann daher bis zu einen Tag nach Ablauf der Frist erfolgen. Gelöschte Daten bleiben anschließend noch bis zu ${r.restoreDays} Tage in der Wiederherstellungsfunktion der Datenbank (Cloudflare D1 Time Travel) und sind danach endgültig entfernt.`,
        `Mit „Meine Daten auf diesem Gerät löschen“ löschen wir sofort deine Stimmen, deinen Geräteeintrag und das Cookie und anonymisieren deine Wünsche. Anfrage-Zähler zu deinem Netz-Schlüssel werden nach ${r.shortHours} Stunden gelöscht.`,
      ],
    },
    {
      title: '8. Deine Rechte',
      blocks: [
        {
          list: [
            'Auskunft über deine Daten (Art. 15 DSGVO)',
            'Berichtigung unrichtiger Daten (Art. 16 DSGVO)',
            'Löschung (Art. 17 DSGVO)',
            'Einschränkung der Verarbeitung (Art. 18 DSGVO)',
            'Widerspruch gegen die Verarbeitung (Art. 21 DSGVO, Abschnitt 9)',
            'Beschwerde bei einer Aufsichtsbehörde (Art. 77 DSGVO, Abschnitt 10)',
          ],
        },
        'Ein Recht auf Datenübertragbarkeit (Art. 20 DSGVO) besteht nicht, weil wir Daten nur auf Grundlage berechtigter Interessen verarbeiten.',
        'Gäste kennen wir nur über die zufällige Geräte-ID im Cookie. Ohne zusätzliche Angaben können wir Anfragen deshalb keinem Gerät zuordnen (Art. 11 Abs. 2 DSGVO). Die Daten deines Geräts kannst du aber jederzeit selbst löschen (Abschnitt 9).',
        `Für alle Anliegen genügt eine E-Mail an ${c.email}.`,
      ],
    },
    {
      title: '9. Widerspruch',
      blocks: [
        {
          notice: 'Widerspruchsrecht nach Art. 21 DSGVO',
          text: [
            'Du kannst der Verarbeitung deiner Daten, die auf Art. 6 Abs. 1 lit. f DSGVO beruht, jederzeit aus Gründen widersprechen, die sich aus deiner besonderen Situation ergeben.',
            `Am schnellsten geht das in der App mit „Meine Daten auf diesem Gerät löschen“ unten auf der Seite: Dann löschen wir sofort deine Stimmen, deinen Geräteeintrag und das Cookie und anonymisieren deine Wünsche. Du kannst auch formlos per E-Mail an ${c.email} widersprechen.`,
          ],
        },
      ],
    },
    {
      title: '10. Beschwerde bei der Aufsichtsbehörde',
      blocks: [
        'Du kannst dich bei jeder Datenschutz-Aufsichtsbehörde beschweren, insbesondere in dem EU-Mitgliedstaat, in dem du lebst oder arbeitest oder in dem der mutmaßliche Verstoß stattfand (Art. 77 DSGVO). Für den Betreiber zuständig ist:',
        { lines: authority },
      ],
    },
    {
      id: 'admin',
      title: '11. Hinweise für Admins',
      blocks: [
        'Dieser Abschnitt gilt zusätzlich für alle, die im Adminbereich mithelfen.',
        {
          facts: [
            [
              'Konto',
              'Benutzername, Anzeigename, Rolle, Passwort nur als Hash (PBKDF2), Zwei-Faktor-Schlüssel verschlüsselt, Wiederherstellungscodes nur als Hash, Zeitpunkt der letzten Anmeldung und ob das Konto aktiv ist. Für Einladungen: Benutzername, Anzeigename, Rolle und Ablaufzeit.',
            ],
            [
              'Sitzungen',
              'Cookie `__Host-admin` mit einem Zufallswert. Gespeichert werden nur dessen Hash und Zeitstempel, weder IP-Adresse noch Browser.',
            ],
            [
              'Audit-Log',
              'Jede Änderung im Adminbereich mit Zeitpunkt, Konto, Aktion sowie Werten vorher und nachher; bei sicherheitsrelevanten Aktionen wie Anmeldung, Fehlversuch oder erneuter Bestätigung zusätzlich der Netz-Schlüssel.',
            ],
            [
              'Anmeldeschutz',
              'Anmeldeversuche zählen wir je Netz-Schlüssel und je Hash aus Benutzername und Netz-Schlüssel, Code-Eingaben je Konto. Den Benutzernamen speichern wir dabei nie im Klartext.',
            ],
            [
              'Spotify',
              'Wer das Spotify-Konto für die Musik verbindet, wird kurz zu Spotify weitergeleitet (Cookie `__Host-oauth`). Gespeichert werden der Anzeigename des verbundenen Kontos im Audit-Log, die Zugangsschlüssel verschlüsselt und die über das Konto abgespielten Titel mit Zeitpunkt.',
            ],
            [
              'Cloudflare Access',
              'Falls eingerichtet, meldest du dich vor dem Adminbereich zusätzlich bei Cloudflare an (Cookie `CF_Authorization`). Die App prüft nur das Anmelde-Token und speichert nichts daraus.',
            ],
            [
              'Weitere Einträge',
              'Buchungen, Wunsch-Entscheidungen, Einstellungen und gekoppelte Bildschirme speichern die interne Nummer des Kontos, das sie angelegt oder geändert hat.',
            ],
            [
              'Zweck',
              'Zugriffsschutz, IT-Sicherheit und Nachvollziehbarkeit von Änderungen. Eine Leistungs- oder Verhaltenskontrolle findet nicht statt.',
            ],
            [
              'Rechtsgrundlage',
              'Art. 6 Abs. 1 lit. f DSGVO. Berechtigtes Interesse: ein sicherer Adminbereich, in dem sich Änderungen nachvollziehen lassen. Widerspruch per E-Mail (Abschnitt 9).',
            ],
            [
              'Empfänger',
              'Cloudflare als Auftragsverarbeiter (Abschnitt 5), Spotify bei der Verbindung des Spotify-Kontos. Alle Admins sehen die Liste der Admins und das Audit-Log ohne Netz-Schlüssel.',
            ],
            [
              'Speicherdauer',
              `Aktive Konten bis zur Deaktivierung. Deaktivierte Konten werden ${r.adminDays} Tage nach der letzten Anmeldung automatisch gelöscht, Einladungen ${r.adminDays} Tage nach ihrem Ablauf. Sitzungen enden nach ${k.adminHours} Stunden oder ${k.adminIdleHours} Stunden ohne Aktivität und werden beim nächsten Löschlauf entfernt. Audit-Einträge ${r.auditDays} Tage, der Netz-Schlüssel darin ${r.guestDays} Tage, Anmelde-Zähler ${r.shortHours} Stunden. Spotify-Zugangsschlüssel bis zur Trennung der Verbindung. Buchungen, Einstellungen, Bildschirme und die Titelliste bleiben ohne feste Frist erhalten, weil sie für Abrechnung und Ablauf der Fete gebraucht werden; nach Löschung eines Kontos ist die gespeicherte Nummer keinem Konto mehr zugeordnet. Auf Anfrage löschen wir dein Konto jederzeit.`,
            ],
          ],
        },
      ],
    },
  ],
};

const privacyEn: LegalDocument = {
  title: 'Privacy policy',
  updated: updated('en-GB', 'Last updated:'),
  sections: [
    {
      title: '1. Controller',
      blocks: [
        'The controller responsible for processing data in this app is:',
        { lines: [...address, `Email: ${c.email}`] },
        `The app is a private, non-commercial project by ${c.name}. The ${eventName} is hosted by ${hosts}; the app is operated by ${c.name}. Anyone helping in the admin area acts on the operator’s instructions (Art. 29 GDPR).`,
        'There is no data protection officer, as none is required.',
      ],
    },
    {
      title: '2. Summary',
      blocks: [
        'To take part, scan the QR code on the screen. Your device then receives a cookie with a random device ID. To prevent multiple votes we also store a pseudonymised network key derived from your IP address. We do not ask for your name or contact details.',
        'Taking part is voluntary. You are under no legal or contractual obligation to provide data. Without the device cookie, however, you cannot vote or request songs.',
        'The app only loads content from this domain. It contains no advertising, no tracking and no third-party scripts, fonts or images.',
        `We automatically delete your device’s data no later than ${r.guestDays} days after your last activity (section 7). You can delete it immediately in the app with “Delete my data on this device”.`,
      ],
    },
    {
      title: '3. What we process and why',
      blocks: [
        'The legal basis is Art. 6(1)(f) GDPR (legitimate interests) in each case; for storage on your device additionally Section 25(2) no. 2 TDDDG. Section 7 explains how long we keep the data.',
        { heading: 'a) Accessing the app (hosting)' },
        {
          facts: [
            [
              'Data',
              'IP address, time, requested address, browser identifier (user agent) and other technical connection data for every request.',
            ],
            ['Purpose', 'Delivering the app and protecting it against attacks and overload.'],
            ['Legal basis', 'Art. 6(1)(f) GDPR. Legitimate interest: secure and reliable operation.'],
            [
              'Recipients',
              'Cloudflare as processor (section 5). Cloudflare additionally processes network and security data under its own responsibility, for example to fend off attacks: https://www.cloudflare.com/privacypolicy/',
            ],
            [
              'Retention',
              'The app itself keeps no access log and never stores IP addresses in plain text. How long Cloudflare keeps connection data is determined by Cloudflare.',
            ],
          ],
        },
        { heading: 'b) Taking part and device cookie' },
        {
          facts: [
            [
              'Data',
              'Cookie `__Host-fete` with a random device ID and its expiry time, signed and not readable by JavaScript. In the database: device ID, time of first and last joining, and the network key (c).',
            ],
            [
              'Purpose',
              'Recognising your device so that you can vote, change your vote and see your requests, and so that each device has only one vote per round.',
            ],
            [
              'Legal basis',
              'Storing and reading the cookie: Section 25(2) no. 2 TDDDG, as it is strictly necessary for taking part as you requested. Other processing: Art. 6(1)(f) GDPR. Legitimate interest: a fair vote with one vote per device.',
            ],
            [
              'Retention',
              `The cookie expires no later than ${r.cookieMaxHours} hours after the first scan; scanning again does not extend it. Data in the database: section 7.`,
            ],
          ],
        },
        { heading: 'c) Pseudonymised network key' },
        {
          facts: [
            [
              'Data',
              'The server derives a network key from your IP address using a secret key (HMAC-SHA-256): for IPv4 from the full address, for IPv6 from the /64 and /48 prefix. We do not store the IP address itself. The network key is pseudonymised, not anonymous: with the secret key it would be possible to check whether it belongs to a given IP address. It therefore remains personal data.',
            ],
            ['Purpose', 'Limiting votes and support per network and fending off too many requests in a short time.'],
            [
              'Legal basis',
              'Art. 6(1)(f) GDPR. Legitimate interest: a fair vote that is hard to manipulate, and protection against overload.',
            ],
            [
              'Recipients',
              'For conspicuous networks, helpers in the admin area only see the first characters of the network key and the number of devices, as well as current request counters.',
            ],
          ],
        },
        { heading: 'd) Voting' },
        {
          facts: [
            [
              'Data',
              'Round, chosen song, device ID, network key, time of the vote and of the last change, and an invalidation flag if applicable.',
            ],
            [
              'Purpose',
              'Running the music vote. Moderators can invalidate votes from a conspicuous network. Only vote counts per song are shown, never who voted for what.',
            ],
            [
              'Legal basis',
              'Art. 6(1)(f) GDPR. Legitimate interest: letting guests have a say in the music at the party.',
            ],
          ],
        },
        { heading: 'e) Song requests and support' },
        {
          facts: [
            [
              'Data',
              'Requested song, device ID, time and status of the request; for support (+1) device ID, network key and time.',
            ],
            [
              'Purpose',
              'Receiving requests, having them reviewed and adding them to the vote, limiting open requests per device and support per network, and showing you your requests.',
            ],
            [
              'Legal basis',
              'Art. 6(1)(f) GDPR. Legitimate interest: taking guests’ music requests into account fairly.',
            ],
            [
              'Recipients',
              'Moderators see requests without device IDs. Approved requests appear with title and artist in the request list and on the screen.',
            ],
          ],
        },
        { heading: 'f) Song search' },
        {
          facts: [
            [
              'Data',
              'Your search text. Our server sends it to the Spotify interface without your IP address and without the device ID; if you choose a song, possibly also its identifier. We cache search text and results without any link to your device.',
            ],
            ['Purpose', 'Finding songs for requests. The cache saves quota at Spotify.'],
            ['Legal basis', 'Art. 6(1)(f) GDPR. Legitimate interest: enabling song requests.'],
            ['Recipients', `${spotify}, Sweden.`],
          ],
        },
        'Please only enter song or artist names, no personal information.',
        { heading: 'g) Cover images' },
        'Our server fetches cover images from Spotify and delivers them to your device itself. Your device has no contact with Spotify, and our server passes on neither your IP address nor cookies or other device data to Spotify.',
        { heading: 'h) Links to Spotify' },
        'If you tap a link to Spotify, your browser opens a Spotify page. Only then does Spotify receive data from your device; Spotify’s privacy policy applies.',
        { heading: 'i) Language choice' },
        'If you tap DE or EN, your browser stores the choice in local storage (`lang`). The entry stays on your device and is not sent to us. Legal basis: Section 25(2) no. 2 TDDDG.',
        { heading: 'j) Automatic safeguards' },
        'Fixed limits, for example on votes per network and round or on requests per minute, can reject a vote or request. This is not an automated decision within the meaning of Art. 22 GDPR, as it does not affect you legally or in a similarly significant way.',
        { heading: 'k) Contact by email' },
        'If you email us, we process your address and the content to handle your request (Art. 6(1)(f) GDPR; legitimate interest: answering enquiries). The operator’s mailbox is hosted by Gmail (Google). We delete the email once your request has been dealt with.',
      ],
    },
    {
      title: '4. Storage on your device',
      blocks: [
        {
          table: [
            ['Name', 'Type', 'Purpose', 'Duration'],
            [
              '`__Host-fete`',
              'Cookie',
              'Device ID for voting and requests',
              `at most ${r.cookieMaxHours} hours from the first scan, never extended`,
            ],
            [
              '`lang`',
              'Local storage',
              'chosen language, only after tapping DE or EN',
              'until you delete it in your browser',
            ],
            [
              '`__Host-admin`',
              'Cookie, admin area only',
              'Login',
              `${k.adminHours} hours; the login ends after ${k.adminIdleHours} hours of inactivity and on logout`,
            ],
            [
              '`__Host-oauth`',
              'Cookie, admin area only',
              'Securing the Spotify connection',
              `${k.oauthMinutes} minutes, deleted after connecting`,
            ],
            [
              '`admin-invite-token`',
              'Session storage, admin area only',
              'Keeps the invitation when reloading',
              'until setup is complete or the tab is closed',
            ],
            ['`__Host-display`', 'Cookie, paired screens only', 'Login of TV and bar screens', `${k.displayDays} days`],
            [
              '`CF_Authorization`',
              'Cookie set by Cloudflare, only if Cloudflare Access is set up',
              'Access protection for the admin area',
              'set by Cloudflare Access',
            ],
          ],
        },
        'The app’s cookies are valid only for this domain, are only transmitted encrypted (HTTPS), are not readable by JavaScript and only contain random values or signed identifiers. The legal basis for all entries is Section 25(2) no. 2 TDDDG, as they are strictly necessary for the function you requested.',
      ],
    },
    {
      title: '5. Recipients',
      blocks: [
        {
          list: [
            `${cloudflare}: hosting of the app (Cloudflare Pages and Functions) and the database (Cloudflare D1) as processor under Art. 28 GDPR.`,
            `${spotify}, Sweden: only search texts and song identifiers, without any link to your device (section 3 f).`,
            'Gmail (Google): only if you email us (section 3 k).',
          ],
        },
        'We do not pass on data beyond this.',
      ],
    },
    {
      title: '6. Transfers to third countries',
      blocks: [
        'Cloudflare runs a global network. Data may therefore also be processed in the USA or other countries outside the EU, and the database may be located there too. The basis is the EU-U.S. Data Privacy Framework (adequacy decision of the European Commission, Implementing Decision (EU) 2023/1795), alternatively the European Commission’s standard contractual clauses (Implementing Decision (EU) 2021/914), as provided for in Cloudflare’s data processing agreement.',
        'Spotify AB is based in Sweden, i.e. in the EU.',
      ],
    },
    {
      title: '7. Retention',
      blocks: [
        {
          table: [
            ['Data', 'Period'],
            ['Votes', `deleted ${r.guestDays} days after the last change`],
            ['Device entry (device ID, network key)', `deleted ${r.guestDays} days after last joining`],
            [
              'Requests and support',
              `anonymised after ${r.guestDays} days: device ID and network key are removed, the request itself remains without personal reference`,
            ],
            ['Cached search texts, request counters', `${r.shortHours} hours`],
            ['Device cookie', `at most ${r.cookieMaxHours} hours`],
            ['Network key in the audit log (admin area)', `${r.guestDays} days`],
            ['Audit log', `${r.auditDays} days`],
            ['Expired admin sessions', 'at the next deletion run'],
            ['Emails', 'until the request has been dealt with'],
          ],
        },
        `Deletion runs automatically once a day, so it may take place up to one day after a period has expired. Deleted data then remains in the database’s restore function (Cloudflare D1 Time Travel) for up to ${r.restoreDays} days and is removed for good afterwards.`,
        `With “Delete my data on this device” we immediately delete your votes, your device entry and the cookie and anonymise your requests. Request counters for your network key are deleted after ${r.shortHours} hours.`,
      ],
    },
    {
      title: '8. Your rights',
      blocks: [
        {
          list: [
            'Access to your data (Art. 15 GDPR)',
            'Rectification of inaccurate data (Art. 16 GDPR)',
            'Erasure (Art. 17 GDPR)',
            'Restriction of processing (Art. 18 GDPR)',
            'Objection to processing (Art. 21 GDPR, section 9)',
            'Complaint to a supervisory authority (Art. 77 GDPR, section 10)',
          ],
        },
        'There is no right to data portability (Art. 20 GDPR), as we only process data on the basis of legitimate interests.',
        'We only know guests by the random device ID in the cookie. Without additional information we therefore cannot link requests to a device (Art. 11(2) GDPR). You can, however, delete your device’s data yourself at any time (section 9).',
        `For any request, an email to ${c.email} is sufficient.`,
      ],
    },
    {
      title: '9. Objection',
      blocks: [
        {
          notice: 'Right to object under Art. 21 GDPR',
          text: [
            'You may object at any time, on grounds relating to your particular situation, to the processing of your data based on Art. 6(1)(f) GDPR.',
            `The quickest way is “Delete my data on this device” at the bottom of the app: we then immediately delete your votes, your device entry and the cookie and anonymise your requests. You can also object informally by email to ${c.email}.`,
          ],
        },
      ],
    },
    {
      title: '10. Complaint to the supervisory authority',
      blocks: [
        'You can lodge a complaint with any data protection supervisory authority, in particular in the EU member state where you live or work or where the alleged infringement took place (Art. 77 GDPR). The authority responsible for the operator is:',
        { lines: authority },
      ],
    },
    {
      id: 'admin',
      title: '11. Information for admins',
      blocks: [
        'This section additionally applies to everyone helping in the admin area.',
        {
          facts: [
            [
              'Account',
              'User name, display name, role, password only as a hash (PBKDF2), two-factor key encrypted, recovery codes only as hashes, time of last login and whether the account is active. For invitations: user name, display name, role and expiry time.',
            ],
            [
              'Sessions',
              'Cookie `__Host-admin` with a random value. Only its hash and timestamps are stored, neither IP address nor browser.',
            ],
            [
              'Audit log',
              'Every change in the admin area with time, account, action and values before and after; for security-related actions such as login, failed attempts or re-confirmation also the network key.',
            ],
            [
              'Login protection',
              'We count login attempts per network key and per hash of user name and network key, and code entries per account. The user name is never stored in plain text.',
            ],
            [
              'Spotify',
              'Whoever connects the Spotify account for the music is briefly redirected to Spotify (cookie `__Host-oauth`). We store the display name of the connected account in the audit log, the access keys encrypted, and the tracks played via the account with their time.',
            ],
            [
              'Cloudflare Access',
              'If set up, you additionally sign in with Cloudflare before the admin area (cookie `CF_Authorization`). The app only verifies the sign-in token and stores nothing from it.',
            ],
            [
              'Other entries',
              'Bookings, request decisions, settings and paired screens store the internal number of the account that created or changed them.',
            ],
            [
              'Purpose',
              'Access protection, IT security and traceability of changes. There is no monitoring of performance or behaviour.',
            ],
            [
              'Legal basis',
              'Art. 6(1)(f) GDPR. Legitimate interest: a secure admin area in which changes can be traced. Objection by email (section 9).',
            ],
            [
              'Recipients',
              'Cloudflare as processor (section 5), Spotify when connecting the Spotify account. All admins see the list of admins and the audit log without network keys.',
            ],
            [
              'Retention',
              `Active accounts until deactivation. Deactivated accounts are deleted automatically ${r.adminDays} days after the last login, invitations ${r.adminDays} days after they expire. Sessions end after ${k.adminHours} hours or ${k.adminIdleHours} hours of inactivity and are removed at the next deletion run. Audit entries ${r.auditDays} days, the network key in them ${r.guestDays} days, login counters ${r.shortHours} hours. Spotify access keys until the connection is removed. Bookings, settings, screens and the track list are kept without a fixed period because they are needed for accounting and running the party; once an account is deleted, the stored number no longer refers to any account. On request we delete your account at any time.`,
            ],
          ],
        },
      ],
    },
  ],
};

const imprintDe: LegalDocument = {
  title: 'Impressum',
  sections: [
    { title: 'Angaben gemäß § 18 Abs. 1 MStV', blocks: [{ lines: address }] },
    { title: 'Kontakt', blocks: [`E-Mail: ${c.email}`] },
    { title: 'Hinweis', blocks: ['Diese App ist ein privates, nicht-kommerzielles Projekt.'] },
  ],
};

const imprintEn: LegalDocument = {
  title: 'Legal notice',
  sections: [
    { title: 'Information pursuant to Section 18(1) MStV', blocks: [{ lines: address }] },
    { title: 'Contact', blocks: [`Email: ${c.email}`] },
    { title: 'Note', blocks: ['This app is a private, non-commercial project.'] },
  ],
};

export const privacy = { de: privacyDe, en: privacyEn };
export const imprint = { de: imprintDe, en: imprintEn };

import { Fragment, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { LanguageSwitch } from '../../components/ui.tsx';
import { useI18n } from '../../lib/i18n.tsx';
import { theme } from '../../lib/theme.ts';
import { guestHome, pwaAppAt, pwaApps } from '../../../shared/pwa.ts';
import { imprint, privacy, type Block, type LegalDocument } from './texts.ts';

const INLINE = /(`[^`]+`|https:\/\/\S*[^\s.,;:)]|[\w.+-]+@[\w-]+(?:\.[\w-]+)+)/;

export function LegalLinks({ admin }: { admin?: boolean }) {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const base = pwaAppAt(pathname) === 'guest' ? pwaApps.guest.scope : '';
  const target = admin ? '_blank' : undefined;
  const linkClass = 'underline underline-offset-2 hover:text-fg';
  return (
    <nav className="flex justify-center gap-4 text-xs text-muted">
      <Link to={admin ? '/datenschutz#admin' : `${base}/datenschutz`} target={target} className={linkClass}>
        {t('legal.privacy')}
      </Link>
      <Link to={`${base}/impressum`} target={target} className={linkClass}>
        {t('legal.imprint')}
      </Link>
    </nav>
  );
}

function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split(INLINE).map((part, index) => {
        if (index % 2 === 0) return part;
        if (part.startsWith('`')) {
          return (
            <code key={index} className="font-mono text-[0.9em] text-accent">
              {part.slice(1, -1)}
            </code>
          );
        }
        const web = part.startsWith('https://');
        return (
          <a
            key={index}
            href={web ? part : `mailto:${part}`}
            target={web ? '_blank' : undefined}
            rel={web ? 'noopener noreferrer' : undefined}
            className="break-all text-accent underline underline-offset-2"
          >
            {part}
          </a>
        );
      })}
    </>
  );
}

function BlockView({ block }: { block: Block }) {
  if (typeof block === 'string') {
    return (
      <p>
        <Rich text={block} />
      </p>
    );
  }
  if ('heading' in block) return <h3 className="mt-3 font-semibold text-fg">{block.heading}</h3>;
  if ('lines' in block) {
    return (
      <p>
        {block.lines.map((line) => (
          <span key={line} className="block">
            <Rich text={line} />
          </span>
        ))}
      </p>
    );
  }
  if ('list' in block) {
    return (
      <ul className="list-disc space-y-1 pl-5">
        {block.list.map((item) => (
          <li key={item}>
            <Rich text={item} />
          </li>
        ))}
      </ul>
    );
  }
  if ('facts' in block) {
    return (
      <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[9rem_1fr] sm:gap-y-2">
        {block.facts.map(([label, text]) => (
          <Fragment key={label}>
            <dt className="font-semibold text-fg">{label}</dt>
            <dd className="mb-2 sm:mb-0">
              <Rich text={text} />
            </dd>
          </Fragment>
        ))}
      </dl>
    );
  }
  if ('table' in block) {
    const [head = [], ...rows] = block.table;
    return (
      <div className="overflow-x-auto rounded-xl ring-1 ring-line">
        <table className="w-full text-left text-xs">
          <thead className="bg-raised text-fg">
            <tr>
              {head.map((cell) => (
                <th key={cell} className="px-3 py-2 font-semibold">
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row[0]} className="border-t border-line/60 align-top">
                {row.map((cell, index) => (
                  <td key={index} className="px-3 py-2">
                    <Rich text={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <aside className="flex flex-col gap-2 rounded-xl bg-primary/10 p-4 ring-2 ring-primary/50">
      <h3 className="font-bold text-fg">{block.notice}</h3>
      {block.text.map((text) => (
        <p key={text}>
          <Rich text={text} />
        </p>
      ))}
    </aside>
  );
}

function LegalPage({ doc }: { doc: LegalDocument }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const target = location.hash ? document.getElementById(location.hash.slice(1)) : null;
    if (target) target.scrollIntoView();
    else window.scrollTo(0, 0);
  }, [location.hash]);

  return (
    <div className="bg-party min-h-dvh">
      <header className="sticky top-0 z-20 flex items-center justify-between gap-3 bg-bg/80 px-4 py-3 backdrop-blur">
        <button
          type="button"
          onClick={() =>
            location.key === 'default'
              ? window.location.assign(location.hash === '#admin' ? pwaApps.admin.startUrl : guestHome)
              : navigate(-1)
          }
          className="flex items-center gap-2 font-display font-bold"
        >
          <img src={theme.event.logo} alt="" className="h-8 w-8" />
          {t('legal.back')}
        </button>
        <LanguageSwitch />
      </header>
      <main className="mx-auto flex max-w-2xl flex-col gap-8 px-4 pt-6 pb-16 text-sm leading-relaxed">
        <div>
          <h1 className="text-3xl font-bold">{doc.title}</h1>
          {doc.updated ? <p className="mt-1 text-muted">{doc.updated}</p> : null}
        </div>
        {doc.sections.map((section) => (
          <section key={section.title} id={section.id} className="flex scroll-mt-20 flex-col gap-3">
            <h2 className="text-xl font-bold">{section.title}</h2>
            {section.blocks.map((block, index) => (
              <BlockView key={index} block={block} />
            ))}
          </section>
        ))}
        <LegalLinks />
      </main>
    </div>
  );
}

export function PrivacyPage() {
  const { lang } = useI18n();
  return <LegalPage doc={privacy[lang]} />;
}

export function ImprintPage() {
  const { lang } = useI18n();
  return <LegalPage doc={imprint[lang]} />;
}

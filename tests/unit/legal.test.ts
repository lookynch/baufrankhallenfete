import { describe, expect, it } from 'vitest';
import { imprint, privacy } from '../../src/client/pages/legal/texts.ts';
import { GUEST_COOKIE } from '../../src/server/security/guest.ts';
import { ADMIN_COOKIE } from '../../src/server/security/session.ts';
import { DISPLAY_COOKIE } from '../../src/server/services/displays.ts';
import { legal } from '../../src/shared/legal.ts';

const outline = (lang: 'de' | 'en') => privacy[lang].sections.map((s) => [s.id, s.blocks.length]);

describe('Rechtstexte', () => {
  it.each(['de', 'en'] as const)('%s: Stammdaten und Cookie-Namen stimmen mit dem Code überein', (lang) => {
    const text = JSON.stringify(privacy[lang]);
    for (const value of [
      legal.controller.name,
      legal.controller.street,
      legal.controller.email,
      legal.authority.name,
      legal.authority.web,
      GUEST_COOKIE,
      ADMIN_COOKIE,
      DISPLAY_COOKIE,
    ]) {
      expect(text).toContain(value);
    }
    expect(JSON.stringify(imprint[lang])).toContain(legal.controller.street);
  });

  it('DE und EN sind gleich gegliedert', () => {
    expect(outline('en')).toEqual(outline('de'));
    expect(imprint.en.sections).toHaveLength(imprint.de.sections.length);
  });
});

export const legal = {
  controller: {
    name: 'Jakob Kaiser',
    street: 'Altentrüdingen 48',
    city: '91717 Wassertrüdingen',
    country: 'Deutschland',
    email: 'kaisersjakob@gmail.com',
  },
  authority: {
    name: 'Bayerisches Landesamt für Datenschutzaufsicht (BayLDA)',
    street: 'Promenade 18',
    city: '91522 Ansbach',
    web: 'https://www.lda.bayern.de',
  },
  updatedAt: '2026-10-16',
  retention: { guestDays: 7, shortHours: 24, auditDays: 90, adminDays: 90, cookieMaxHours: 24 },
} as const;

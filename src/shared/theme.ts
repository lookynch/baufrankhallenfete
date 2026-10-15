export type Rgb = readonly [number, number, number];

export const theme = {
  event: {
    name: 'Baufrankhallen-Fete',
    hosts: 'IT Applications & Buchhaltung',
    logo: '/logo.svg',
  },
  colors: {
    background: [11, 11, 22],
    surface: [22, 22, 40],
    surfaceRaised: [34, 34, 60],
    border: [56, 56, 92],
    text: [244, 244, 250],
    muted: [160, 160, 190],
    primary: [255, 64, 129],
    primaryText: [20, 6, 14],
    accent: [0, 229, 255],
    accentText: [6, 16, 24],
    success: [52, 211, 153],
    warning: [251, 191, 36],
    danger: [248, 113, 113],
  },
  chart: [
    [255, 64, 129],
    [0, 229, 255],
    [251, 191, 36],
    [52, 211, 153],
    [167, 139, 250],
    [251, 146, 60],
  ],
  mood: {
    1: [96, 165, 250],
    2: [52, 211, 153],
    3: [250, 204, 21],
    4: [251, 146, 60],
    5: [255, 64, 129],
  },
  fonts: {
    display: '"Inter Tight", "Inter", system-ui, sans-serif',
    body: '"Inter", system-ui, sans-serif',
    mono: '"JetBrains Mono", ui-monospace, monospace',
  },
  radius: '1rem',
} as const satisfies {
  event: { name: string; hosts: string; logo: string };
  colors: Record<string, Rgb>;
  chart: readonly Rgb[];
  mood: Record<1 | 2 | 3 | 4 | 5, Rgb>;
  fonts: Record<'display' | 'body' | 'mono', string>;
  radius: string;
};

export type ColorToken = keyof typeof theme.colors;

export const contrastPairs: ReadonlyArray<readonly [ColorToken, ColorToken]> = [
  ['text', 'background'],
  ['text', 'surface'],
  ['text', 'surfaceRaised'],
  ['muted', 'background'],
  ['muted', 'surface'],
  ['primaryText', 'primary'],
  ['accentText', 'accent'],
];

export function rgb(color: Rgb, alpha = 1): string {
  return alpha === 1 ? `rgb(${color.join(' ')})` : `rgb(${color.join(' ')} / ${alpha})`;
}

export function cssVariables(): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [name, value] of Object.entries(theme.colors)) vars[`--t-${kebab(name)}`] = value.join(' ');
  for (const [level, value] of Object.entries(theme.mood)) vars[`--t-mood-${level}`] = value.join(' ');
  vars['--t-font-display'] = theme.fonts.display;
  vars['--t-font-body'] = theme.fonts.body;
  vars['--t-font-mono'] = theme.fonts.mono;
  vars['--t-radius'] = theme.radius;
  return vars;
}

function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

function luminance([r, g, b]: Rgb): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

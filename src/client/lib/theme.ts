import { cssVariables, rgb, theme } from '../../shared/theme.ts';

export function applyTheme(): void {
  const root = document.documentElement;
  for (const [name, value] of Object.entries(cssVariables())) root.style.setProperty(name, value);
  const meta =
    document.querySelector('meta[name="theme-color"]') ?? document.head.appendChild(document.createElement('meta'));
  meta.setAttribute('name', 'theme-color');
  meta.setAttribute('content', rgb(theme.colors.background));
  document.title = theme.event.name;
}

export function chartColor(index: number, alpha = 1): string {
  return rgb(theme.chart[index % theme.chart.length]!, alpha);
}

export function tokenColor(name: keyof typeof theme.colors, alpha = 1): string {
  return rgb(theme.colors[name], alpha);
}

export { theme };

import { useEffect, useRef } from 'react';
import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  DoughnutController,
  ArcElement,
  Filler,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
  type ChartConfiguration,
} from 'chart.js';
import { theme, tokenColor } from '../lib/theme.ts';

Chart.register(
  BarController,
  BarElement,
  CategoryScale,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  DoughnutController,
  ArcElement,
  Filler,
  Legend,
  Tooltip,
);
Chart.defaults.color = tokenColor('muted');
Chart.defaults.borderColor = tokenColor('border', 0.6);
Chart.defaults.font.family = theme.fonts.body;

export function ChartView({ config, className = '' }: { config: ChartConfiguration; className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const chart = useRef<Chart | null>(null);
  const initial = useRef(config);

  useEffect(() => {
    if (!canvas.current) return;
    chart.current = new Chart(canvas.current, {
      ...initial.current,
      options: { animation: { duration: 600 }, ...initial.current.options },
    });
    return () => {
      chart.current?.destroy();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    const instance = chart.current;
    if (!instance) return;
    instance.data = config.data;
    if (config.options) instance.options = { animation: { duration: 600 }, ...config.options };
    instance.update();
  }, [config]);

  return (
    <div className={`relative ${className}`}>
      <canvas ref={canvas} />
    </div>
  );
}

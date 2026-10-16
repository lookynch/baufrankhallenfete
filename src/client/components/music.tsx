import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { coverPath } from '../../shared/spotify.ts';
import { useI18n, type MessageKey } from '../lib/i18n.tsx';

export function Cover({
  src,
  size = 64,
  large,
  className = '',
}: {
  src: string | null | undefined;
  size?: number;
  large?: boolean;
  className?: string;
}) {
  const path = coverPath(src);
  const [failed, setFailed] = useState<string | null>(null);
  const shape = `shrink-0 ${large ? 'rounded-lg' : 'rounded'} ${className}`;
  if (!path || failed === path) {
    return (
      <div
        className={`grid place-items-center bg-gradient-to-br from-primary/40 to-accent/40 text-xl ${shape}`}
        style={{ width: size, height: size }}
      >
        ♪
      </div>
    );
  }
  return (
    <img
      src={path}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailed(path)}
      className={`object-cover ${shape}`}
      style={{ width: size, height: size }}
    />
  );
}

const moodClasses = ['', 'bg-mood-1', 'bg-mood-2', 'bg-mood-3', 'bg-mood-4', 'bg-mood-5'];

export function MoodBadge({ level, large }: { level: number | null | undefined; large?: boolean }) {
  const { t } = useI18n();
  if (!level) return null;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-bold text-bg ${moodClasses[level]} ${large ? 'px-4 py-1.5 text-lg' : 'px-2.5 py-0.5 text-xs'}`}
    >
      {'●'.repeat(level)}
      <span>{t(`mood.${level}` as MessageKey)}</span>
    </span>
  );
}

export function QrCode({ value, size = 320 }: { value: string; size?: number }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    let cancelled = false;
    void QRCode.toString(value, { type: 'svg', errorCorrectionLevel: 'M', margin: 1 }).then((markup) => {
      if (!cancelled) setSvg(markup);
    });
    return () => {
      cancelled = true;
    };
  }, [value]);
  return (
    <div
      className="rounded-3xl bg-white p-4 [&_svg]:h-full [&_svg]:w-full"
      style={{ width: size, height: size }}
      aria-label="QR-Code"
      data-qr-url={value}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

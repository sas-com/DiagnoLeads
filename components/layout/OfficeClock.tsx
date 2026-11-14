'use client';

import { RiMoonLine, RiSunLine } from '@remixicon/react';
import { useFormatter, useTimeZone, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { hourIn, isNightHour } from './office-clock';

/**
 * The time of day in the office, at the foot of the menu (#1120). It is drawn after the first
 * render in the browser, so the server and the browser never disagree about the minute.
 */
export default function OfficeClock() {
  const t = useTranslations('navigation');
  const format = useFormatter();
  const timeZone = useTimeZone() ?? 'Asia/Tokyo';
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  if (!now) return null;
  const night = isNightHour(hourIn(now, timeZone));
  const Icon = night ? RiMoonLine : RiSunLine;
  return (
    <p className="mt-auto flex items-center gap-2 border-t border-gray-700 px-1 py-4 text-sm text-gray-200">
      <Icon className="h-4 w-4 text-brand-400" aria-hidden="true" />
      <span className="font-bold tabular-nums text-gray-50">
        {format.dateTime(now, { hour: '2-digit', minute: '2-digit' })}
      </span>
      {night ? t('night') : t('day')}
    </p>
  );
}

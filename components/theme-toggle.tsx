'use client';

import * as React from 'react';
import { useTheme } from 'next-themes';
import { Sun, Moon, Monitor } from 'lucide-react';
import { Button } from '@/components/ui/button';

const ORDER = ['system', 'light', 'dark'] as const;
type Choice = (typeof ORDER)[number];

const ICONS: Record<Choice, React.ComponentType<{ className?: string }>> = {
  system: Monitor,
  light: Sun,
  dark: Moon,
};

const LABELS: Record<Choice, string> = {
  system: 'Theme: match system',
  light: 'Theme: paper (light)',
  dark: 'Theme: ink (dark)',
};

const emptySubscribe = () => () => {};

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  // `theme` is only known client-side, so render a stable placeholder until mount
  // rather than guessing and flipping the icon after hydration. useSyncExternalStore
  // gives us server=false / client=true without setting state in an effect, which
  // the React Compiler lint (react-hooks/set-state-in-effect) forbids.
  const mounted = React.useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );

  const current: Choice = ORDER.includes(theme as Choice) ? (theme as Choice) : 'system';
  const Icon = ICONS[current];

  if (!mounted) {
    return <Button variant='ghost' size='icon' aria-hidden className='opacity-0' />;
  }

  return (
    <Button
      variant='ghost'
      size='icon'
      aria-label={LABELS[current]}
      title={LABELS[current]}
      onClick={() => setTheme(ORDER[(ORDER.indexOf(current) + 1) % ORDER.length])}
    >
      <Icon className='size-4' />
    </Button>
  );
}

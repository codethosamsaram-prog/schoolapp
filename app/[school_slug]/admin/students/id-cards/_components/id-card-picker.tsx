'use client';

import * as React from 'react';
import { Download, Printer } from 'lucide-react';
import type { IdCardSchool } from '@/lib/id-cards';
import { Button } from '@/components/ui/button';
import { IdCardPreview, type PreviewCard } from './id-card-preview';

interface IdCardPickerProps {
  school: IdCardSchool;
  grade: string;
  section: string;
  cards: PreviewCard[];
}

/**
 * Chooses which cards go into the PDF. A plain GET form to /api/id-cards, so
 * the checked students travel as repeated `student` parameters.
 */
export function IdCardPicker({ school, grade, section, cards }: IdCardPickerProps) {
  const [selected, setSelected] = React.useState(() => new Set(cards.map((card) => card.id)));

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <form action="/api/id-cards" method="get" className="space-y-4">
      <input type="hidden" name="grade" value={grade} />
      <input type="hidden" name="section" value={section} />

      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-background/95 p-3 backdrop-blur">
        <p className="text-sm" aria-live="polite">
          <span className="font-semibold">{selected.size}</span> of {cards.length} cards selected
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => setSelected(new Set(cards.map((c) => c.id)))}>
            Select all
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
          <Button type="submit" variant="outline" size="sm" formTarget="_blank" disabled={selected.size === 0}>
            <Printer className="h-4 w-4" aria-hidden />
            Open to print
          </Button>
          <Button type="submit" size="sm" name="download" value="1" disabled={selected.size === 0}>
            <Download className="h-4 w-4" aria-hidden />
            Download PDF ({selected.size})
          </Button>
        </div>
      </div>

      <ul className="grid max-w-3xl gap-4">
        {cards.map((card) => (
          <li key={card.id} className="rounded-lg border bg-muted/30 p-3">
            <label className="mb-2 flex cursor-pointer items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                name="student"
                value={card.id}
                checked={selected.has(card.id)}
                onChange={() => toggle(card.id)}
                className="h-4 w-4"
              />
              {card.fullName}
              <span className="font-normal text-muted-foreground">· Roll {card.rollNumber}</span>
            </label>
            <IdCardPreview school={school} card={card} />
          </li>
        ))}
      </ul>
    </form>
  );
}

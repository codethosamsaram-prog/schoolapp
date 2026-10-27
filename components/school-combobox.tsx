'use client';

import * as React from 'react';
import { Check, ChevronsUpDown, School as SchoolIcon, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SchoolOption {
  id: string;
  name: string;
  slug: string;
  city: string | null;
  board: string | null;
}

interface SchoolComboboxProps {
  id?: string;
  schools: SchoolOption[];
  value: SchoolOption | null;
  onChange: (school: SchoolOption) => void;
  placeholder?: string;
  autoFocus?: boolean;
  /** Renders the list inline (for dialogs) instead of as a popover. */
  inline?: boolean;
  invalid?: boolean;
}

function matches(school: SchoolOption, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [school.name, school.city ?? '', school.slug, school.board ?? '']
    .some((field) => field.toLowerCase().includes(q));
}

/**
 * Accessible auto-completing school picker (WAI-ARIA combobox pattern): type
 * to filter, arrow keys to move, Enter to choose, Escape to close.
 */
export function SchoolCombobox({
  id = 'school',
  schools,
  value,
  onChange,
  placeholder = 'Search by school name or city',
  autoFocus,
  inline = false,
  invalid,
}: SchoolComboboxProps) {
  const [query, setQuery] = React.useState('');
  const [open, setOpen] = React.useState(inline);
  const [active, setActive] = React.useState(0);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const listId = `${id}-listbox`;

  const results = React.useMemo(
    () => schools.filter((school) => matches(school, query)).slice(0, 50),
    [schools, query],
  );

  React.useEffect(() => setActive(0), [query]);

  React.useEffect(() => {
    if (inline) return;
    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [inline]);

  function choose(school: SchoolOption) {
    onChange(school);
    setQuery('');
    if (!inline) setOpen(false);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActive((index) => Math.min(index + 1, results.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter') {
      if (open && results[active]) {
        event.preventDefault();
        choose(results[active]);
      }
    } else if (event.key === 'Escape' && !inline) {
      setOpen(false);
    }
  }

  const showList = inline || open;
  const inputValue = showList || !value ? query : value.name;

  return (
    <div ref={containerRef} className="relative">
      <div
        className={cn(
          'flex h-10 items-center gap-2 rounded-md border border-input bg-background px-3 ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2',
          invalid && 'border-destructive',
        )}
      >
        {showList ? (
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        ) : (
          <SchoolIcon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        )}
        <input
          id={id}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && results[active] ? `${id}-opt-${results[active].id}` : undefined}
          autoComplete="off"
          autoFocus={autoFocus}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          placeholder={value && !showList ? value.name : placeholder}
          value={inputValue}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        {!inline ? <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" aria-hidden /> : null}
      </div>

      {showList ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Schools"
          className={cn(
            'max-h-64 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground',
            inline ? 'mt-2' : 'absolute z-50 mt-1 w-full shadow-md',
          )}
        >
          {results.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-muted-foreground">
              No school matches &ldquo;{query}&rdquo;.
            </li>
          ) : (
            results.map((school, index) => {
              const selected = value?.id === school.id;
              return (
                <li
                  key={school.id}
                  id={`${id}-opt-${school.id}`}
                  role="option"
                  aria-selected={selected}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => choose(school)}
                  onMouseEnter={() => setActive(index)}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-sm px-3 py-2 text-sm',
                    index === active && 'bg-accent text-accent-foreground',
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{school.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[school.city, school.board].filter(Boolean).join(' · ') || school.slug}
                    </span>
                  </span>
                  {selected ? <Check className="h-4 w-4 text-primary" aria-hidden /> : null}
                </li>
              );
            })
          )}
        </ul>
      ) : null}
    </div>
  );
}

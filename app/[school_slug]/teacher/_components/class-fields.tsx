'use client';

import * as React from 'react';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';

interface ClassFieldsProps {
  idPrefix: string;
  grades: string[];
  sectionsByGrade: Record<string, string[]>;
  /** Offer "All sections" as the first section option. */
  allowAllSections?: boolean;
  gradeName?: string;
  sectionName?: string;
  errors?: Record<string, string[]>;
  defaultGrade?: string;
  onChange?: (grade: string, section: string) => void;
}

/** Linked class and section selects; the section list follows the class. */
export function ClassFields({
  idPrefix,
  grades,
  sectionsByGrade,
  allowAllSections = true,
  gradeName = 'classGrade',
  sectionName = 'section',
  errors,
  defaultGrade,
  onChange,
}: ClassFieldsProps) {
  const [grade, setGrade] = React.useState(defaultGrade ?? grades[0] ?? '');
  const [section, setSection] = React.useState(allowAllSections ? '' : sectionsByGrade[grade]?.[0] ?? '');
  const sections = sectionsByGrade[grade] ?? [];

  return (
    <>
      <div className="grid min-w-0 content-start gap-2">
        <Label htmlFor={`${idPrefix}-grade`}>Class</Label>
        <NativeSelect
          id={`${idPrefix}-grade`}
          name={gradeName}
          value={grade}
          onChange={(event) => {
            const next = event.target.value;
            const nextSection = allowAllSections ? '' : sectionsByGrade[next]?.[0] ?? '';
            setGrade(next);
            setSection(nextSection);
            onChange?.(next, nextSection);
          }}
          required
        >
          {grades.length === 0 ? <option value="">No classes yet</option> : null}
          {grades.map((value) => (
            <option key={value} value={value}>
              Class {value}
            </option>
          ))}
        </NativeSelect>
        {errors?.[gradeName]?.[0] ? <p className="text-xs text-destructive">{errors[gradeName][0]}</p> : null}
      </div>
      <div className="grid min-w-0 content-start gap-2">
        <Label htmlFor={`${idPrefix}-section`}>Section</Label>
        <NativeSelect
          id={`${idPrefix}-section`}
          name={sectionName}
          value={section}
          onChange={(event) => {
            setSection(event.target.value);
            onChange?.(grade, event.target.value);
          }}
        >
          {allowAllSections ? <option value="">All sections</option> : null}
          {sections.map((value) => (
            <option key={value} value={value}>
              Section {value}
            </option>
          ))}
        </NativeSelect>
        {errors?.[sectionName]?.[0] ? (
          <p className="text-xs text-destructive">{errors[sectionName][0]}</p>
        ) : null}
      </div>
    </>
  );
}

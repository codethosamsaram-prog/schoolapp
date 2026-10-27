import * as React from 'react';
import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';

/**
 * One examination's report card, rendered by /report-cards/[student_id].
 * Grades and GPA are computed by the route with lib/grading, the same rules
 * the portal shows on screen.
 */

export interface ReportCardRow {
  subject: string;
  marks: number;
  max: number;
  percent: number;
  grade: string;
  passed: boolean;
  remarks: string | null;
}

export interface ReportCardPDFProps {
  school: { name: string; addressLine: string | null; board: string | null };
  student: {
    fullName: string;
    usn: string | null;
    rollNumber: string;
    admissionNumber: string | null;
    classGrade: string;
    section: string;
  };
  examName: string;
  rows: ReportCardRow[];
  totals: { marks: number; max: number; percent: number; gpa: number | null; failed: number };
  issuedOn: string;
  accentColor?: string;
}

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 10, fontFamily: 'Helvetica', color: '#0f172a' },
  header: { borderBottomWidth: 2, paddingBottom: 10, marginBottom: 14, alignItems: 'center' },
  school: { fontSize: 16, fontFamily: 'Helvetica-Bold' },
  muted: { color: '#475569' },
  title: { fontSize: 13, fontFamily: 'Helvetica-Bold', textAlign: 'center', letterSpacing: 1.5 },
  subtitle: { textAlign: 'center', marginTop: 3, marginBottom: 14, color: '#475569' },
  details: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 16 },
  detail: { width: '50%', flexDirection: 'row', paddingVertical: 3 },
  label: { width: 90, color: '#475569' },
  value: { flex: 1, fontFamily: 'Helvetica-Bold' },
  table: { borderWidth: 0.5, borderColor: '#94a3b8' },
  headerRow: { flexDirection: 'row', backgroundColor: '#f1f5f9', borderBottomWidth: 0.5, borderColor: '#94a3b8' },
  row: { flexDirection: 'row', borderBottomWidth: 0.5, borderColor: '#e2e8f0' },
  totalRow: { flexDirection: 'row', backgroundColor: '#f8fafc' },
  cell: { paddingVertical: 5, paddingHorizontal: 6 },
  subject: { flex: 1 },
  number: { width: 70, textAlign: 'right' },
  grade: { width: 50, textAlign: 'center' },
  result: { width: 60, textAlign: 'center' },
  bold: { fontFamily: 'Helvetica-Bold' },
  remark: { color: '#64748b', fontSize: 8, marginTop: 1 },
  summary: { flexDirection: 'row', gap: 12, marginTop: 16 },
  summaryBox: { flex: 1, borderWidth: 0.5, borderColor: '#cbd5e1', padding: 8, alignItems: 'center' },
  summaryValue: { fontSize: 14, fontFamily: 'Helvetica-Bold', marginTop: 2 },
  signatures: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 70 },
  signature: { width: 150, borderTopWidth: 1, borderColor: '#0f172a', paddingTop: 4, textAlign: 'center' },
  footer: {
    position: 'absolute',
    bottom: 36,
    left: 36,
    right: 36,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 0.5,
    borderColor: '#cbd5e1',
    paddingTop: 8,
  },
});

export function ReportCardPDF({
  school,
  student,
  examName,
  rows,
  totals,
  issuedOn,
  accentColor = '#1d4ed8',
}: ReportCardPDFProps) {
  const details: [string, string][] = [
    ['Student', student.fullName],
    ['Class', `${student.classGrade} - ${student.section}`],
    ['Roll number', student.rollNumber],
    ['USN', student.usn ?? '-'],
    ['Admission no.', student.admissionNumber ?? '-'],
    ['Examination', examName],
  ];

  return (
    <Document title={`Report card - ${student.fullName} - ${examName}`} author={school.name}>
      <Page size="A4" style={styles.page}>
        <View style={[styles.header, { borderColor: accentColor }]}>
          <Text style={[styles.school, { color: accentColor }]}>{school.name}</Text>
          {school.addressLine ? <Text style={styles.muted}>{school.addressLine}</Text> : null}
          {school.board ? <Text style={styles.muted}>Affiliated to {school.board}</Text> : null}
        </View>

        <Text style={styles.title}>REPORT CARD</Text>
        <Text style={styles.subtitle}>{examName}</Text>

        <View style={styles.details}>
          {details.map(([label, value]) => (
            <View key={label} style={styles.detail}>
              <Text style={styles.label}>{label}</Text>
              <Text style={styles.value}>{value}</Text>
            </View>
          ))}
        </View>

        <View style={styles.table}>
          <View style={styles.headerRow}>
            <Text style={[styles.cell, styles.subject, styles.bold]}>Subject</Text>
            <Text style={[styles.cell, styles.number, styles.bold]}>Marks</Text>
            <Text style={[styles.cell, styles.number, styles.bold]}>Percent</Text>
            <Text style={[styles.cell, styles.grade, styles.bold]}>Grade</Text>
            <Text style={[styles.cell, styles.result, styles.bold]}>Result</Text>
          </View>
          {rows.map((row) => (
            <View key={row.subject} style={styles.row} wrap={false}>
              <View style={[styles.cell, styles.subject]}>
                <Text>{row.subject}</Text>
                {row.remarks ? <Text style={styles.remark}>{row.remarks}</Text> : null}
              </View>
              <Text style={[styles.cell, styles.number]}>
                {row.marks} / {row.max}
              </Text>
              <Text style={[styles.cell, styles.number]}>{row.percent}%</Text>
              <Text style={[styles.cell, styles.grade, styles.bold]}>{row.grade}</Text>
              <Text style={[styles.cell, styles.result, { color: row.passed ? '#047857' : '#be123c' }]}>
                {row.passed ? 'Pass' : 'Fail'}
              </Text>
            </View>
          ))}
          <View style={styles.totalRow}>
            <Text style={[styles.cell, styles.subject, styles.bold]}>Total</Text>
            <Text style={[styles.cell, styles.number, styles.bold]}>
              {totals.marks} / {totals.max}
            </Text>
            <Text style={[styles.cell, styles.number, styles.bold]}>{totals.percent}%</Text>
            <Text style={[styles.cell, styles.grade]} />
            <Text style={[styles.cell, styles.result]} />
          </View>
        </View>

        <View style={styles.summary}>
          <View style={styles.summaryBox}>
            <Text style={styles.muted}>Overall</Text>
            <Text style={styles.summaryValue}>{totals.percent}%</Text>
          </View>
          <View style={styles.summaryBox}>
            <Text style={styles.muted}>GPA (10-point)</Text>
            <Text style={styles.summaryValue}>{totals.gpa?.toFixed(1) ?? '-'}</Text>
          </View>
          <View style={styles.summaryBox}>
            <Text style={styles.muted}>Result</Text>
            <Text style={[styles.summaryValue, { color: totals.failed === 0 ? '#047857' : '#be123c' }]}>
              {totals.failed === 0 ? 'Passed' : `${totals.failed} below pass`}
            </Text>
          </View>
        </View>

        <View style={styles.signatures}>
          <Text style={styles.signature}>Class teacher</Text>
          <Text style={styles.signature}>Parent</Text>
          <Text style={styles.signature}>Principal</Text>
        </View>

        <View style={styles.footer} fixed>
          <Text style={styles.muted}>Issued {issuedOn}</Text>
          <Text style={styles.muted}>Computer-generated report card</Text>
        </View>
      </Page>
    </Document>
  );
}

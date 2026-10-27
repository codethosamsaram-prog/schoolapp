import * as React from 'react';
import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer';

/**
 * Examination hall ticket, rendered on the server by /hall-tickets/[id] when
 * the school has not uploaded its own PDF for that ticket.
 */

export interface HallTicketPDFProps {
  school: { name: string; addressLine: string | null; board: string | null };
  student: {
    fullName: string;
    usn: string | null;
    rollNumber: string;
    admissionNumber: string | null;
    classGrade: string;
    section: string;
    photo: Buffer | null;
  };
  ticket: { id: string; examName: string; term: string; issuedOn: string };
  holidays: { date: string; title: string }[];
  accentColor?: string;
}

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 10, fontFamily: 'Helvetica', color: '#0f172a' },
  header: { borderBottomWidth: 2, paddingBottom: 10, marginBottom: 16, alignItems: 'center' },
  school: { fontSize: 16, fontFamily: 'Helvetica-Bold' },
  muted: { color: '#475569' },
  title: {
    fontSize: 13,
    fontFamily: 'Helvetica-Bold',
    textAlign: 'center',
    marginBottom: 14,
    letterSpacing: 1.5,
  },
  body: { flexDirection: 'row', gap: 18 },
  details: { flex: 1 },
  row: { flexDirection: 'row', borderBottomWidth: 0.5, borderColor: '#cbd5e1', paddingVertical: 6 },
  label: { width: 110, color: '#475569' },
  value: { flex: 1, fontFamily: 'Helvetica-Bold' },
  photoBox: {
    width: 110,
    height: 130,
    borderWidth: 1,
    borderColor: '#94a3b8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photo: { width: 108, height: 128, objectFit: 'cover' },
  section: { marginTop: 22 },
  heading: { fontFamily: 'Helvetica-Bold', marginBottom: 6 },
  bullet: { marginBottom: 3, color: '#334155' },
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
  signature: { width: 160, borderTopWidth: 1, borderColor: '#0f172a', paddingTop: 4, textAlign: 'center' },
});

const INSTRUCTIONS = [
  'Bring this hall ticket to every examination. Entry is not allowed without it.',
  'Report to the examination hall 20 minutes before the start time.',
  'Mobile phones, smart watches and written material are not permitted in the hall.',
  'Use only blue or black ink. Write your USN or roll number on every answer booklet.',
];

export function HallTicketPDF({ school, student, ticket, holidays, accentColor = '#1d4ed8' }: HallTicketPDFProps) {
  const details: [string, string][] = [
    ['Student name', student.fullName],
    ['USN', student.usn ?? '-'],
    ['Roll number', student.rollNumber],
    ['Admission no.', student.admissionNumber ?? '-'],
    ['Class', `${student.classGrade} - ${student.section}`],
    ['Examination', ticket.examName],
    ['Term', ticket.term],
  ];

  return (
    <Document title={`Hall ticket - ${student.fullName} - ${ticket.examName}`} author={school.name}>
      <Page size="A4" style={styles.page}>
        <View style={[styles.header, { borderColor: accentColor }]}>
          <Text style={[styles.school, { color: accentColor }]}>{school.name}</Text>
          {school.addressLine ? <Text style={styles.muted}>{school.addressLine}</Text> : null}
          {school.board ? <Text style={styles.muted}>Affiliated to {school.board}</Text> : null}
        </View>

        <Text style={styles.title}>EXAMINATION HALL TICKET</Text>

        <View style={styles.body}>
          <View style={styles.details}>
            {details.map(([label, value]) => (
              <View key={label} style={styles.row}>
                <Text style={styles.label}>{label}</Text>
                <Text style={styles.value}>{value}</Text>
              </View>
            ))}
          </View>
          <View style={styles.photoBox}>
            {student.photo ? (
              // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt
              <Image src={student.photo} style={styles.photo} />
            ) : (
              <Text style={styles.muted}>Affix photo</Text>
            )}
          </View>
        </View>

        {holidays.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.heading}>Holidays during the examination period</Text>
            {holidays.map((holiday) => (
              <Text key={`${holiday.date}-${holiday.title}`} style={styles.bullet}>
                {holiday.date}: {holiday.title}
              </Text>
            ))}
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.heading}>Instructions</Text>
          {INSTRUCTIONS.map((line, index) => (
            <Text key={line} style={styles.bullet}>
              {index + 1}. {line}
            </Text>
          ))}
        </View>

        <View style={[styles.section, { flexDirection: 'row', justifyContent: 'space-between', marginTop: 60 }]}>
          <Text style={styles.signature}>Student&apos;s signature</Text>
          <Text style={styles.signature}>Principal</Text>
        </View>

        <View style={styles.footer} fixed>
          <Text style={styles.muted}>Issued {ticket.issuedOn}</Text>
          <Text style={styles.muted}>Ticket {ticket.id.slice(0, 8).toUpperCase()}</Text>
        </View>
      </Page>
    </Document>
  );
}

import * as React from 'react';
import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import type { IdCardSchool, IdCardStudent } from '@/lib/id-cards';

/**
 * Printable student ID cards: CR80 size (85.6 x 54 mm), front and back side
 * by side so each pair can be cut out, folded and laminated. Four students
 * to an A4 page, with dashed borders as cut guides.
 */

export interface IdCardsPDFProps {
  school: IdCardSchool;
  cards: (IdCardStudent & { photo: Buffer | null; qr: Buffer })[];
}

const MM = 72 / 25.4;
const CARD_W = 85.6 * MM;
const CARD_H = 54 * MM;
export const CARDS_PER_PAGE = 4;

const styles = StyleSheet.create({
  page: { paddingVertical: 34, paddingHorizontal: 40, fontFamily: 'Helvetica', color: '#0f172a' },
  row: { flexDirection: 'row', justifyContent: 'center', gap: 18, marginBottom: 22 },
  card: {
    width: CARD_W,
    height: CARD_H,
    borderWidth: 0.75,
    borderStyle: 'dashed',
    borderColor: '#94a3b8',
    borderRadius: 6,
    overflow: 'hidden',
  },
  band: { paddingVertical: 5, paddingHorizontal: 8 },
  bandName: { color: '#ffffff', fontSize: 8.5, fontFamily: 'Helvetica-Bold' },
  bandSub: { color: '#ffffff', fontSize: 6, opacity: 0.9 },
  body: { flexDirection: 'row', alignItems: 'center', padding: 9, gap: 8, flex: 1 },
  photo: { width: 52, height: 64, objectFit: 'cover', borderRadius: 3 },
  photoBox: {
    width: 52,
    height: 64,
    borderRadius: 3,
    backgroundColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: { fontSize: 16, fontFamily: 'Helvetica-Bold', color: '#475569' },
  info: { flex: 1, gap: 1.5 },
  name: { fontSize: 9, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  field: { fontSize: 6.5, color: '#334155' },
  label: { color: '#64748b' },
  blood: {
    marginTop: 3,
    alignSelf: 'flex-start',
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: '#be123c',
    borderWidth: 0.75,
    borderColor: '#be123c',
    borderRadius: 3,
    paddingHorizontal: 3,
    paddingVertical: 1,
  },
  qr: { width: 52, height: 52 },
  back: { padding: 9, flex: 1, justifyContent: 'space-between' },
  backTitle: { fontSize: 7, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  backText: { fontSize: 6.5, color: '#334155', lineHeight: 1.35 },
  emergency: { fontSize: 8, fontFamily: 'Helvetica-Bold', marginTop: 1 },
  footer: { fontSize: 5.5, color: '#64748b' },
});

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

function Front({ school, card }: { school: IdCardSchool; card: IdCardsPDFProps['cards'][number] }) {
  return (
    <View style={styles.card}>
      <View style={[styles.band, { backgroundColor: school.color }]}>
        <Text style={styles.bandName}>{school.name}</Text>
        <Text style={styles.bandSub}>STUDENT IDENTITY CARD · {school.academicYear}</Text>
      </View>
      <View style={styles.body}>
        {card.photo ? (
          // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt
          <Image src={card.photo} style={styles.photo} />
        ) : (
          <View style={styles.photoBox}>
            <Text style={styles.initials}>{initials(card.fullName)}</Text>
          </View>
        )}
        <View style={styles.info}>
          <Text style={styles.name}>{card.fullName}</Text>
          <Text style={styles.field}>
            <Text style={styles.label}>Class </Text>
            {card.classGrade} - {card.section} · <Text style={styles.label}>Roll </Text>
            {card.rollNumber}
          </Text>
          {card.usn ? (
            <Text style={styles.field}>
              <Text style={styles.label}>USN </Text>
              {card.usn}
            </Text>
          ) : null}
          {card.admissionNumber ? (
            <Text style={styles.field}>
              <Text style={styles.label}>Adm. no. </Text>
              {card.admissionNumber}
            </Text>
          ) : null}
          <Text style={styles.blood}>Blood group {card.bloodGroup ?? '-'}</Text>
        </View>
        {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt */}
        <Image src={card.qr} style={styles.qr} />
      </View>
    </View>
  );
}

function Back({ school, card }: { school: IdCardSchool; card: IdCardsPDFProps['cards'][number] }) {
  return (
    <View style={styles.card}>
      <View style={[styles.band, { backgroundColor: school.color, paddingVertical: 3 }]} />
      <View style={styles.back}>
        <View>
          <Text style={styles.backTitle}>In an emergency, call</Text>
          <Text style={styles.backText}>{card.parentName ?? 'Parent / guardian'}</Text>
          <Text style={styles.emergency}>+91 {card.parentPhone}</Text>
        </View>
        <View>
          <Text style={styles.backTitle}>If found, please return to</Text>
          <Text style={styles.backText}>{school.name}</Text>
          {school.addressLine ? <Text style={styles.backText}>{school.addressLine}</Text> : null}
          {school.phone ? <Text style={styles.backText}>Phone {school.phone}</Text> : null}
        </View>
        <Text style={styles.footer}>
          Valid for {school.academicYear} · property of the school · not transferable
        </Text>
      </View>
    </View>
  );
}

export function IdCardsPDF({ school, cards }: IdCardsPDFProps) {
  const pages: IdCardsPDFProps['cards'][] = [];
  for (let start = 0; start < cards.length; start += CARDS_PER_PAGE) {
    pages.push(cards.slice(start, start + CARDS_PER_PAGE));
  }

  return (
    <Document title={`Student ID cards - ${school.name}`} author={school.name}>
      {pages.map((group, index) => (
        <Page key={index} size="A4" style={styles.page}>
          {group.map((card) => (
            <View key={card.id} style={styles.row} wrap={false}>
              <Front school={school} card={card} />
              <Back school={school} card={card} />
            </View>
          ))}
        </Page>
      ))}
    </Document>
  );
}

import * as React from 'react';
import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import { formatIndianCurrency } from './FeeReceiptPDF';

/**
 * Fee invoice: what a student owes this year, with a UPI QR for the balance
 * so the family can pay the school directly from any UPI app (no gateway
 * charges). Rendered by /invoices/[student_id]; plain serialisable props, like
 * the receipt.
 */

export interface FeeInvoicePDFProps {
  school: { name: string; addressLine?: string | null; phone?: string | null };
  student: {
    fullName: string;
    rollNumber: string;
    admissionNumber?: string | null;
    classGrade: string;
    section: string;
    parentName?: string | null;
  };
  invoiceRef: string;
  academicYear: string;
  issuedOn: string;
  lines: { particulars: string; dueDate: string; amount: number }[];
  concession: number;
  paid: number;
  balance: number;
  /** PNG data URL of the UPI QR for the balance, absent when the school has no UPI ID or nothing is due. */
  upiQr?: { dataUrl: string; vpa: string } | null;
  accentColor?: string;
}

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 10, fontFamily: 'Helvetica', color: '#111827' },
  header: { borderBottomWidth: 2, paddingBottom: 10, marginBottom: 14 },
  school: { fontSize: 16, fontFamily: 'Helvetica-Bold' },
  muted: { color: '#6b7280' },
  title: { fontSize: 12, fontFamily: 'Helvetica-Bold', marginTop: 6 },
  meta: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 },
  metaBlock: { gap: 2 },
  label: { fontSize: 8, color: '#6b7280', textTransform: 'uppercase' },
  table: { borderWidth: 1, borderColor: '#e5e7eb' },
  row: { flexDirection: 'row', borderBottomWidth: 1, borderColor: '#e5e7eb' },
  headRow: { flexDirection: 'row', backgroundColor: '#f3f4f6', borderBottomWidth: 1, borderColor: '#e5e7eb' },
  cellMain: { flex: 1, padding: 6 },
  cellDate: { width: 90, padding: 6 },
  cellAmount: { width: 90, padding: 6, textAlign: 'right' },
  bold: { fontFamily: 'Helvetica-Bold' },
  totals: { marginTop: 10, alignSelf: 'flex-end', width: 220, gap: 3 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between' },
  payBox: { marginTop: 20, flexDirection: 'row', gap: 16, borderWidth: 1, borderColor: '#e5e7eb', padding: 12 },
  qr: { width: 120, height: 120 },
  payText: { flex: 1, gap: 4 },
  footer: { position: 'absolute', bottom: 24, left: 36, right: 36, fontSize: 8, color: '#9ca3af', textAlign: 'center' },
});

const inr = (value: number) => `Rs. ${formatIndianCurrency(value)}`;

export function FeeInvoicePDF(props: FeeInvoicePDFProps) {
  const accent = props.accentColor ?? '#1d4ed8';
  const assessed = props.lines.reduce((sum, line) => sum + line.amount, 0);

  return (
    <Document title={`Fee invoice ${props.invoiceRef}`} author={props.school.name}>
      <Page size="A4" style={styles.page}>
        <View style={[styles.header, { borderColor: accent }]}>
          <Text style={styles.school}>{props.school.name}</Text>
          {props.school.addressLine ? <Text style={styles.muted}>{props.school.addressLine}</Text> : null}
          {props.school.phone ? <Text style={styles.muted}>Phone {props.school.phone}</Text> : null}
          <Text style={[styles.title, { color: accent }]}>FEE INVOICE · {props.academicYear}</Text>
        </View>

        <View style={styles.meta}>
          <View style={styles.metaBlock}>
            <Text style={styles.label}>Billed to</Text>
            <Text style={styles.bold}>{props.student.fullName}</Text>
            <Text>
              Class {props.student.classGrade}-{props.student.section} · Roll {props.student.rollNumber}
              {props.student.admissionNumber ? ` · Adm. ${props.student.admissionNumber}` : ''}
            </Text>
            {props.student.parentName ? <Text>Parent: {props.student.parentName}</Text> : null}
          </View>
          <View style={[styles.metaBlock, { alignItems: 'flex-end' }]}>
            <Text style={styles.label}>Invoice</Text>
            <Text style={styles.bold}>{props.invoiceRef}</Text>
            <Text>Issued {props.issuedOn}</Text>
          </View>
        </View>

        <View style={styles.table}>
          <View style={styles.headRow}>
            <Text style={[styles.cellMain, styles.bold]}>Particulars</Text>
            <Text style={[styles.cellDate, styles.bold]}>Due</Text>
            <Text style={[styles.cellAmount, styles.bold]}>Amount</Text>
          </View>
          {props.lines.length === 0 ? (
            <View style={styles.row}>
              <Text style={styles.cellMain}>No fees published for this class yet.</Text>
            </View>
          ) : (
            props.lines.map((line, index) => (
              <View key={index} style={styles.row} wrap={false}>
                <Text style={styles.cellMain}>{line.particulars}</Text>
                <Text style={styles.cellDate}>{line.dueDate}</Text>
                <Text style={styles.cellAmount}>{formatIndianCurrency(line.amount)}</Text>
              </View>
            ))
          )}
        </View>

        <View style={styles.totals}>
          <View style={styles.totalRow}>
            <Text>Fees for the year</Text>
            <Text>{inr(assessed)}</Text>
          </View>
          {props.concession > 0 ? (
            <View style={styles.totalRow}>
              <Text>Concession</Text>
              <Text>- {inr(props.concession)}</Text>
            </View>
          ) : null}
          <View style={styles.totalRow}>
            <Text>Paid so far</Text>
            <Text>- {inr(props.paid)}</Text>
          </View>
          <View style={[styles.totalRow, { borderTopWidth: 1, borderColor: '#e5e7eb', paddingTop: 4 }]}>
            <Text style={styles.bold}>Balance due</Text>
            <Text style={styles.bold}>{inr(props.balance)}</Text>
          </View>
        </View>

        {props.upiQr ? (
          <View style={styles.payBox} wrap={false}>
            {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt */}
            <Image style={styles.qr} src={props.upiQr.dataUrl} />
            <View style={styles.payText}>
              <Text style={styles.bold}>Pay {inr(props.balance)} by UPI</Text>
              <Text>Scan with any UPI app (Google Pay, PhonePe, Paytm, BHIM) to pay the school directly.</Text>
              <Text>
                UPI ID: <Text style={styles.bold}>{props.upiQr.vpa}</Text>
              </Text>
              <Text>Note on the payment: {props.invoiceRef}</Text>
              <Text style={styles.muted}>
                After paying, report the 12-digit UTR from your UPI app under Pay by UPI in the parent portal.
                Your receipt follows once the school matches it with the bank statement.
              </Text>
            </View>
          </View>
        ) : null}

        <Text style={styles.footer} fixed>
          Computer-generated invoice. Fees paid are acknowledged by a separate numbered receipt.
        </Text>
      </Page>
    </Document>
  );
}

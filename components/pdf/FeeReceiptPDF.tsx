import * as React from 'react';
import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import type { PaymentStatus } from '@/types/database';

/**
 * Official fee receipt.
 *
 * Rendered on the server by /api/receipts/[payment_id] (renderToStream) and
 * reusable in the browser through PDFDownloadLink. It deliberately takes plain
 * serialisable props rather than database rows, so the same component can
 * render a preview before a payment exists.
 *
 * Currency is formatted by hand: @react-pdf/renderer runs outside the DOM and
 * Intl grouping for en-IN is not guaranteed in every Node build.
 */

export interface FeeReceiptSchool {
  name: string;
  logoUrl?: string | null;
  addressLine?: string | null;
  phone?: string | null;
  email?: string | null;
  board?: string | null;
}

export interface FeeReceiptStudent {
  fullName: string;
  rollNumber: string;
  admissionNumber?: string | null;
  classGrade: string;
  section: string;
  parentName?: string | null;
}

export interface FeeReceiptLineItem {
  particulars: string;
  amount: number;
}

export interface FeeReceiptPayment {
  receiptNumber: string;
  paidAt: string;
  amountPaid: number;
  paymentMethod: string;
  razorpayPaymentId?: string | null;
  razorpayOrderId?: string | null;
  status: PaymentStatus;
  /** Refunded through the gateway so far; omitted or 0 when none. */
  amountRefunded?: number;
}

export interface FeeReceiptPDFProps {
  school: FeeReceiptSchool;
  student: FeeReceiptStudent;
  payment: FeeReceiptPayment;
  lineItems: FeeReceiptLineItem[];
  totalFeeDue: number;
  balanceAfterPayment: number;
  accentColor?: string;
}

/** 102000 -> 1,02,000.00 */
export function formatIndianCurrency(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  const negative = safe < 0;
  const [whole, fraction] = Math.abs(safe).toFixed(2).split('.');
  const lastThree = whole.slice(-3);
  const rest = whole.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${lastThree}` : lastThree;
  return `${negative ? '-' : ''}${grouped}.${fraction}`;
}

const NUMBER_WORDS = [
  'Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen',
  'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigitsToWords(value: number): string {
  if (value < 20) return NUMBER_WORDS[value] ?? '';
  const tens = Math.floor(value / 10);
  const units = value % 10;
  return units ? `${TENS[tens]} ${NUMBER_WORDS[units]}` : `${TENS[tens]}`;
}

/** Amount in words, in the Indian system, as receipts are expected to carry. */
export function amountInWords(value: number): string {
  const rupees = Math.floor(Math.abs(value));
  if (rupees === 0) return 'Zero Rupees Only';

  const units: { divisor: number; label: string }[] = [
    { divisor: 1_00_00_000, label: 'Crore' },
    { divisor: 1_00_000, label: 'Lakh' },
    { divisor: 1_000, label: 'Thousand' },
    { divisor: 100, label: 'Hundred' },
  ];

  let remaining = rupees;
  const parts: string[] = [];

  for (const { divisor, label } of units) {
    const count = Math.floor(remaining / divisor);
    if (count > 0) {
      parts.push(`${twoDigitsToWords(count)} ${label}`);
      remaining %= divisor;
    }
  }

  if (remaining > 0) {
    parts.push(twoDigitsToWords(remaining));
  }

  return `${parts.join(' ')} Rupees Only`;
}

const styles = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingHorizontal: 40,
    paddingBottom: 56,
    fontSize: 10,
    fontFamily: 'Helvetica',
    color: '#0f172a',
    lineHeight: 1.45,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 2,
    borderBottomColor: '#1d4ed8',
    paddingBottom: 12,
    marginBottom: 16,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, maxWidth: '72%' },
  logo: { width: 46, height: 46, objectFit: 'contain' },
  logoFallback: {
    width: 46,
    height: 46,
    borderRadius: 4,
    backgroundColor: '#1d4ed8',
    color: '#ffffff',
    fontSize: 16,
    fontFamily: 'Helvetica-Bold',
    textAlign: 'center',
    paddingTop: 13,
  },
  schoolName: { fontSize: 15, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  schoolMeta: { fontSize: 8.5, color: '#475569' },
  receiptTag: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: '#1d4ed8',
    textAlign: 'right',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  receiptNumber: { fontSize: 11, fontFamily: 'Helvetica-Bold', textAlign: 'right', marginTop: 2 },
  receiptDate: { fontSize: 8.5, color: '#475569', textAlign: 'right' },
  sectionTitle: {
    fontSize: 8.5,
    fontFamily: 'Helvetica-Bold',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    color: '#64748b',
    marginBottom: 6,
  },
  panelRow: { flexDirection: 'row', gap: 16, marginBottom: 18 },
  panel: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 4,
    padding: 10,
  },
  field: { flexDirection: 'row', marginBottom: 3 },
  fieldLabel: { width: 78, color: '#64748b', fontSize: 9 },
  fieldValue: { flex: 1, fontSize: 9, fontFamily: 'Helvetica-Bold' },
  table: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 4, overflow: 'hidden' },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#f1f5f9',
    paddingVertical: 7,
    paddingHorizontal: 10,
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
  },
  colIndex: { width: 26, fontSize: 9 },
  colParticulars: { flex: 1, fontSize: 9 },
  colAmount: { width: 96, fontSize: 9, textAlign: 'right' },
  headerCell: { fontFamily: 'Helvetica-Bold', fontSize: 8.5, color: '#475569' },
  totalRow: {
    flexDirection: 'row',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderTopWidth: 1,
    borderTopColor: '#cbd5e1',
    backgroundColor: '#f8fafc',
  },
  words: { marginTop: 10, fontSize: 9, color: '#334155' },
  summary: { marginTop: 16, flexDirection: 'row', gap: 16 },
  summaryBox: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 4,
    padding: 10,
  },
  summaryLabel: { fontSize: 8.5, color: '#64748b', marginBottom: 3 },
  summaryValue: { fontSize: 12, fontFamily: 'Helvetica-Bold' },
  stampArea: {
    marginTop: 26,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  stamp: {
    width: 128,
    height: 74,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderStyle: 'dashed',
    borderRadius: 4,
    textAlign: 'center',
    paddingTop: 30,
    fontSize: 8,
    color: '#94a3b8',
  },
  signature: { width: 160, textAlign: 'center' },
  signatureLine: { borderTopWidth: 1, borderTopColor: '#94a3b8', marginBottom: 4 },
  footer: {
    position: 'absolute',
    bottom: 24,
    left: 40,
    right: 40,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    paddingTop: 8,
    fontSize: 7.5,
    color: '#94a3b8',
    textAlign: 'center',
  },
  watermark: {
    position: 'absolute',
    top: 300,
    left: 120,
    fontSize: 62,
    color: '#fee2e2',
    fontFamily: 'Helvetica-Bold',
    transform: 'rotate(-28deg)',
  },
});

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue}>{value}</Text>
    </View>
  );
}

export function FeeReceiptPDF({
  school,
  student,
  payment,
  lineItems,
  totalFeeDue,
  balanceAfterPayment,
  accentColor = '#1d4ed8',
}: FeeReceiptPDFProps) {
  const paidOn = new Date(payment.paidAt);
  const paidOnLabel = Number.isNaN(paidOn.getTime())
    ? '-'
    : `${String(paidOn.getDate()).padStart(2, '0')}/${String(paidOn.getMonth() + 1).padStart(2, '0')}/${paidOn.getFullYear()}`;

  const items = lineItems.length
    ? lineItems
    : [{ particulars: 'Fee payment', amount: payment.amountPaid }];
  const itemsTotal = items.reduce((sum, item) => sum + Number(item.amount), 0);

  return (
    <Document
      title={`Fee receipt ${payment.receiptNumber}`}
      author={school.name}
      subject={`Fee receipt for ${student.fullName}`}
      creator="ClassroomOS"
      producer="ClassroomOS"
    >
      <Page size="A4" style={styles.page} wrap>
        {payment.status !== 'SUCCESS' ? (
          <Text style={styles.watermark} fixed>
            {payment.status.replace(/_/g, ' ')}
          </Text>
        ) : null}

        <View style={[styles.header, { borderBottomColor: accentColor }]}>
          <View style={styles.headerLeft}>
            {school.logoUrl ? (
              // This is @react-pdf/renderer's Image, a PDF drawing primitive with no alt
              // attribute, not an HTML img.
              // eslint-disable-next-line jsx-a11y/alt-text
              <Image src={school.logoUrl} style={styles.logo} />
            ) : (
              <Text style={[styles.logoFallback, { backgroundColor: accentColor }]}>
                {school.name.slice(0, 2).toUpperCase()}
              </Text>
            )}
            <View>
              <Text style={styles.schoolName}>{school.name}</Text>
              {school.addressLine ? (
                <Text style={styles.schoolMeta}>{school.addressLine}</Text>
              ) : null}
              <Text style={styles.schoolMeta}>
                {[school.phone, school.email, school.board].filter(Boolean).join('  |  ')}
              </Text>
            </View>
          </View>

          <View>
            <Text style={[styles.receiptTag, { color: accentColor }]}>Fee Receipt</Text>
            <Text style={styles.receiptNumber}>{payment.receiptNumber}</Text>
            <Text style={styles.receiptDate}>Dated {paidOnLabel}</Text>
          </View>
        </View>

        <View style={styles.panelRow}>
          <View style={styles.panel}>
            <Text style={styles.sectionTitle}>Student details</Text>
            <Field label="Name" value={student.fullName} />
            <Field label="Class" value={`${student.classGrade} - ${student.section}`} />
            <Field label="Roll no." value={student.rollNumber} />
            {student.admissionNumber ? (
              <Field label="Admission" value={student.admissionNumber} />
            ) : null}
            {student.parentName ? <Field label="Parent" value={student.parentName} /> : null}
          </View>

          <View style={styles.panel}>
            <Text style={styles.sectionTitle}>Transaction details</Text>
            <Field label="Mode" value={payment.paymentMethod} />
            <Field label="Paid on" value={paidOnLabel} />
            {payment.razorpayPaymentId ? (
              <Field label="Txn ID" value={payment.razorpayPaymentId} />
            ) : null}
            {payment.razorpayOrderId ? (
              <Field label="Order ID" value={payment.razorpayOrderId} />
            ) : null}
            <Field label="Status" value={payment.status.replace(/_/g, ' ')} />
            {payment.amountRefunded ? (
              <Field
                label="Refunded"
                value={`INR ${formatIndianCurrency(payment.amountRefunded)}`}
              />
            ) : null}
          </View>
        </View>

        <Text style={styles.sectionTitle}>Breakdown of dues</Text>
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.colIndex, styles.headerCell]}>#</Text>
            <Text style={[styles.colParticulars, styles.headerCell]}>Particulars</Text>
            <Text style={[styles.colAmount, styles.headerCell]}>Amount (INR)</Text>
          </View>

          {items.map((item, index) => (
            <View key={`${item.particulars}-${index}`} style={styles.tableRow}>
              <Text style={styles.colIndex}>{index + 1}</Text>
              <Text style={styles.colParticulars}>{item.particulars}</Text>
              <Text style={styles.colAmount}>{formatIndianCurrency(Number(item.amount))}</Text>
            </View>
          ))}

          <View style={styles.totalRow}>
            <Text style={styles.colIndex} />
            <Text style={[styles.colParticulars, { fontFamily: 'Helvetica-Bold' }]}>
              Total received
            </Text>
            <Text style={[styles.colAmount, { fontFamily: 'Helvetica-Bold' }]}>
              {formatIndianCurrency(itemsTotal)}
            </Text>
          </View>
        </View>

        <Text style={styles.words}>
          Amount in words: {amountInWords(payment.amountPaid)}
        </Text>

        <View style={styles.summary}>
          <View style={styles.summaryBox}>
            <Text style={styles.summaryLabel}>Total fee assessed</Text>
            <Text style={styles.summaryValue}>INR {formatIndianCurrency(totalFeeDue)}</Text>
          </View>
          <View style={styles.summaryBox}>
            <Text style={styles.summaryLabel}>Paid in this transaction</Text>
            <Text style={[styles.summaryValue, { color: accentColor }]}>
              INR {formatIndianCurrency(payment.amountPaid)}
            </Text>
          </View>
          <View style={styles.summaryBox}>
            <Text style={styles.summaryLabel}>Balance outstanding</Text>
            <Text style={styles.summaryValue}>
              INR {formatIndianCurrency(Math.max(balanceAfterPayment, 0))}
            </Text>
          </View>
        </View>

        <View style={styles.stampArea}>
          <Text style={styles.stamp}>School seal</Text>
          <View style={styles.signature}>
            <View style={styles.signatureLine} />
            <Text style={{ fontSize: 8.5, color: '#475569' }}>Authorised signatory</Text>
            <Text style={{ fontSize: 7.5, color: '#94a3b8' }}>Accounts Department</Text>
          </View>
        </View>

        <Text style={styles.footer} fixed>
          This is a computer-generated receipt issued through ClassroomOS and is valid without a
          physical signature. For queries, contact the school accounts office quoting receipt
          number {payment.receiptNumber}.
        </Text>
      </Page>
    </Document>
  );
}

export default FeeReceiptPDF;

import * as React from 'react';
import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import type { PayLine } from '@/types/database';
import { amountInWords, formatIndianCurrency } from '@/components/pdf/FeeReceiptPDF';

/**
 * A monthly salary slip, rendered by /payslips/[id]. Every figure comes from
 * the stored payslip, whose totals the database computed.
 */

export interface PayslipPDFProps {
  school: { name: string; addressLine: string | null };
  staff: {
    fullName: string;
    employeeCode: string;
    role: string;
    departments: string[];
    dateOfJoining: string | null;
    bank: string | null;
  };
  slip: {
    slipNumber: string;
    periodLabel: string;
    basePay: number;
    additions: PayLine[];
    deductions: PayLine[];
    grossPay: number;
    totalDeductions: number;
    netPay: number;
    paymentMethod: string;
    paymentReference: string | null;
    paidOn: string;
  };
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
  label: { width: 95, color: '#475569' },
  value: { flex: 1, fontFamily: 'Helvetica-Bold' },
  columns: { flexDirection: 'row', gap: 12 },
  column: { flex: 1, borderWidth: 0.5, borderColor: '#94a3b8' },
  columnHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#f1f5f9',
    padding: 6,
    borderBottomWidth: 0.5,
    borderColor: '#94a3b8',
    fontFamily: 'Helvetica-Bold',
  },
  line: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 5,
    paddingHorizontal: 6,
    borderBottomWidth: 0.5,
    borderColor: '#e2e8f0',
  },
  total: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 6,
    fontFamily: 'Helvetica-Bold',
    backgroundColor: '#f8fafc',
  },
  net: {
    marginTop: 16,
    padding: 10,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  netValue: { fontSize: 15, fontFamily: 'Helvetica-Bold' },
  words: { marginTop: 6, color: '#334155' },
  payment: { marginTop: 14, color: '#334155' },
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

function Lines({ lines }: { lines: [string, number][] }) {
  return (
    <>
      {lines.map(([label, amount], index) => (
        <View key={`${label}-${index}`} style={styles.line}>
          <Text>{label}</Text>
          <Text>{formatIndianCurrency(amount)}</Text>
        </View>
      ))}
    </>
  );
}

export function PayslipPDF({ school, staff, slip, accentColor = '#1d4ed8' }: PayslipPDFProps) {
  const details: [string, string][] = [
    ['Employee', staff.fullName],
    ['Employee code', staff.employeeCode],
    ['Role', staff.role],
    ['Department', staff.departments.join(', ') || '-'],
    ['Date of joining', staff.dateOfJoining ?? '-'],
    ['Bank account', staff.bank ?? '-'],
  ];

  const earnings: [string, number][] = [
    ['Basic salary', slip.basePay],
    ...slip.additions.map((line): [string, number] => [line.label, line.amount]),
  ];
  const deductions: [string, number][] = slip.deductions.map((line) => [line.label, line.amount]);

  return (
    <Document title={`Payslip ${slip.slipNumber}`} author={school.name}>
      <Page size="A4" style={styles.page}>
        <View style={[styles.header, { borderColor: accentColor }]}>
          <Text style={[styles.school, { color: accentColor }]}>{school.name}</Text>
          {school.addressLine ? <Text style={styles.muted}>{school.addressLine}</Text> : null}
        </View>

        <Text style={styles.title}>SALARY SLIP</Text>
        <Text style={styles.subtitle}>
          {slip.periodLabel} · {slip.slipNumber}
        </Text>

        <View style={styles.details}>
          {details.map(([label, value]) => (
            <View key={label} style={styles.detail}>
              <Text style={styles.label}>{label}</Text>
              <Text style={styles.value}>{value}</Text>
            </View>
          ))}
        </View>

        <View style={styles.columns}>
          <View style={styles.column}>
            <View style={styles.columnHeader}>
              <Text>Earnings</Text>
              <Text>INR</Text>
            </View>
            <Lines lines={earnings} />
            <View style={styles.total}>
              <Text>Gross pay</Text>
              <Text>{formatIndianCurrency(slip.grossPay)}</Text>
            </View>
          </View>
          <View style={styles.column}>
            <View style={styles.columnHeader}>
              <Text>Deductions</Text>
              <Text>INR</Text>
            </View>
            {deductions.length ? (
              <Lines lines={deductions} />
            ) : (
              <View style={styles.line}>
                <Text style={styles.muted}>None</Text>
              </View>
            )}
            <View style={styles.total}>
              <Text>Total deductions</Text>
              <Text>{formatIndianCurrency(slip.totalDeductions)}</Text>
            </View>
          </View>
        </View>

        <View style={[styles.net, { borderColor: accentColor }]}>
          <Text style={styles.value}>Net pay</Text>
          <Text style={[styles.netValue, { color: accentColor }]}>
            INR {formatIndianCurrency(slip.netPay)}
          </Text>
        </View>
        <Text style={styles.words}>In words: {amountInWords(slip.netPay)}</Text>

        <Text style={styles.payment}>
          Paid by {slip.paymentMethod}
          {slip.paymentReference ? ` (ref. ${slip.paymentReference})` : ''} on {slip.paidOn}.
        </Text>

        <View style={styles.footer} fixed>
          <Text style={styles.muted}>Computer-generated payslip; no signature required.</Text>
          <Text style={styles.muted}>{slip.slipNumber}</Text>
        </View>
      </Page>
    </Document>
  );
}

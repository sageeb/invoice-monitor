import { google } from 'googleapis';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

interface Invoice {
  id: string;
  vendor: string;
  amount: number;
  currency: string;
  dueDate: string | null;
  status: string;
  emailSubject: string;
  emailDate: string;
  emailLink: string;
  processedAt: string;
}

function getAuth() {
  const credentials = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!credentials) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY env var not set');
  }

  const parsed = JSON.parse(credentials);
  return new google.auth.GoogleAuth({
    credentials: parsed,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

export async function GET(request: Request) {
  // Simple token auth
  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token') || request.headers.get('authorization')?.replace('Bearer ', '');

  if (token !== process.env.AUTH_TOKEN) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const auth = getAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Invoices!A2:J',
    });

    const rows = response.data.values || [];

    const invoices: Invoice[] = rows.map((row) => ({
      id: row[0] || '',
      vendor: row[1] || '',
      amount: parseFloat(row[2]) || 0,
      currency: row[3] || 'ILS',
      dueDate: row[4] || null,
      status: row[5] || 'pending',
      emailSubject: row[6] || '',
      emailDate: row[7] || '',
      emailLink: row[8] || '',
      processedAt: row[9] || '',
    }));

    // Sort by due date (earliest first), nulls last
    invoices.sort((a, b) => {
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate.localeCompare(b.dueDate);
    });

    return NextResponse.json({ invoices });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error fetching invoices:', message);
    return NextResponse.json({ error: 'Failed to fetch invoices' }, { status: 500 });
  }
}

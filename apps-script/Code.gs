/**
 * Invoice Monitor — Main Gmail Scanner
 * Searches Gmail for Hebrew invoices, extracts data via Claude API,
 * and writes structured results to the bound Google Sheet.
 *
 * SETUP:
 * 1. Create a Google Sheet with these columns in row 1:
 *    ID | Vendor | Amount | Currency | DueDate | Status | EmailSubject | EmailDate | EmailLink | ProcessedAt
 * 2. Add a second sheet tab named "Config" (used to track processed email IDs)
 * 3. Open Extensions > Apps Script and paste this code + Parser.gs
 * 4. Set script properties (Project Settings > Script Properties):
 *    - CLAUDE_API_KEY: Your Anthropic API key
 * 5. Run setupTrigger() once to enable automatic polling
 * 6. Run scanGmail() manually for the first run
 */

// ─── Configuration ───────────────────────────────────────────────────────────

const SEARCH_KEYWORDS = [
  'חשבונית',    // invoice
  'חשבונית מס', // tax invoice
  'תשלום',      // payment
  'חיוב',       // charge
  'קבלה',       // receipt
  'invoice',
  'payment due',
  'bill'
];

const EXCLUDE_KEYWORDS = [
  'ordered',
  'shipped',
  'delivered',
  'tracking',
  'הזמנה',       // order
  'נשלח',        // shipped
  'משלוח',       // shipment
  'אישור הזמנה', // order confirmation
  'כרטיס אשראי', // credit card
  'credit card',
  'חיוב בכרטיס', // card charge
  'פנגו',        // Pango parking
];

const SEARCH_QUERY_DAYS = 14;
const DATA_SHEET_NAME = 'Invoices';
const CONFIG_SHEET_NAME = 'Config';
const MAX_RUNTIME_MS = 5 * 60 * 1000; // 5 minutes (leave 1 min buffer before 6 min limit)

// ─── Main Entry Point ────────────────────────────────────────────────────────

/**
 * Main function: scan Gmail for invoices and write to Sheet.
 * Called by time-driven trigger or manually.
 */
function scanGmail() {
  const startTime = Date.now();
  const sheet = getOrCreateDataSheet();
  const processedIds = getProcessedIds();
  let newCount = 0;

  const query = buildSearchQuery();
  Logger.log('Searching Gmail with query: ' + query);

  const threads = GmailApp.search(query, 0, 50);
  Logger.log('Found ' + threads.length + ' threads');

  for (const thread of threads) {
    const messages = thread.getMessages();

    for (const message of messages) {
      // Check if we're running out of time
      if (Date.now() - startTime > MAX_RUNTIME_MS) {
        Logger.log('Approaching time limit. Stopping. Processed ' + newCount + ' new invoices. Will continue on next run.');
        return;
      }

      const messageId = message.getId();

      if (processedIds.has(messageId)) {
        continue;
      }

      Logger.log('Processing: ' + message.getSubject());

      const invoiceData = processMessage(message);

      if (invoiceData) {
        writeInvoiceToSheet(sheet, invoiceData, message);
        newCount++;
      }

      // Mark as processed regardless of whether we found invoice data
      markAsProcessed(messageId);
      processedIds.add(messageId);
    }
  }

  Logger.log('Done. Added ' + newCount + ' new invoices.');
}

// ─── Gmail Processing ────────────────────────────────────────────────────────

/**
 * Build the Gmail search query from keywords.
 */
function buildSearchQuery() {
  const keywordPart = SEARCH_KEYWORDS.map(k => '"' + k + '"').join(' OR ');
  const excludePart = EXCLUDE_KEYWORDS.map(k => '-"' + k + '"').join(' ');
  return '(' + keywordPart + ') ' + excludePart + ' newer_than:' + SEARCH_QUERY_DAYS + 'd';
}

/**
 * Process a single Gmail message: extract text from body, PDFs, and links,
 * then parse with Claude.
 * @param {GmailMessage} message
 * @returns {Object|null} Parsed invoice data or null.
 */
function processMessage(message) {
  const textParts = [];

  // 1. Email body text
  const body = message.getPlainBody() || '';
  if (body.trim()) {
    textParts.push('=== EMAIL BODY ===\n' + body.trim());
  }

  // 2. PDF attachments
  const attachments = message.getAttachments();
  for (const attachment of attachments) {
    const contentType = attachment.getContentType();
    if (contentType === 'application/pdf' || attachment.getName().toLowerCase().endsWith('.pdf')) {
      Logger.log('Extracting text from PDF: ' + attachment.getName());
      const pdfText = extractTextFromPdf(attachment.copyBlob());
      if (pdfText.trim()) {
        textParts.push('=== PDF: ' + attachment.getName() + ' ===\n' + pdfText.trim());
      }
    }
  }

  // 3. Links in email body (check HTML body for invoice links)
  const htmlBody = message.getBody() || '';
  const invoiceLinks = extractInvoiceLinks(htmlBody);
  for (const link of invoiceLinks.slice(0, 3)) { // Limit to 3 links
    Logger.log('Fetching link: ' + link);
    const linkText = fetchLinkContent(link);
    if (linkText.trim()) {
      textParts.push('=== LINKED PAGE ===\n' + linkText.trim().substring(0, 5000));
    }
  }

  if (textParts.length === 0) {
    Logger.log('No text content found in message');
    return null;
  }

  const combinedText = textParts.join('\n\n');
  return parseInvoiceWithClaude(combinedText);
}

/**
 * Extract URLs from HTML that likely point to invoices.
 * @param {string} html - Email HTML body.
 * @returns {string[]} Array of URLs.
 */
function extractInvoiceLinks(html) {
  const links = [];
  const urlRegex = /href=["'](https?:\/\/[^"']+)["']/gi;
  let match;

  const invoiceLinkKeywords = [
    'invoice', 'חשבונית', 'payment', 'תשלום', 'bill',
    'pay', 'receipt', 'קבלה', 'view', 'download', 'pdf',
    'צפה', 'צפייה', 'להצגה', 'לצפייה', 'הצג', 'לחץ כאן', 'פתח',
  ];

  while ((match = urlRegex.exec(html)) !== null) {
    const url = match[1];

    // Skip common non-invoice links
    if (url.includes('unsubscribe') || url.includes('mailto:') ||
        url.includes('facebook.com') || url.includes('twitter.com') ||
        url.includes('linkedin.com') || url.includes('google.com/maps')) {
      continue;
    }

    // Check if URL or surrounding text suggests an invoice
    const surroundingText = html.substring(
      Math.max(0, match.index - 100),
      Math.min(html.length, match.index + match[0].length + 100)
    ).toLowerCase();

    const isInvoiceLink = invoiceLinkKeywords.some(kw =>
      url.toLowerCase().includes(kw) || surroundingText.includes(kw)
    );

    if (isInvoiceLink) {
      links.push(url);
    }
  }

  return links;
}

// ─── Google Sheet Operations ─────────────────────────────────────────────────

/**
 * Get or create the data sheet with headers.
 */
function getOrCreateDataSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(DATA_SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(DATA_SHEET_NAME);
    sheet.appendRow([
      'ID', 'Vendor', 'Amount', 'Currency', 'DueDate',
      'Status', 'EmailSubject', 'EmailDate', 'EmailLink', 'ProcessedAt'
    ]);

    // Format header row
    const headerRange = sheet.getRange(1, 1, 1, 10);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#4285f4');
    headerRange.setFontColor('#ffffff');

    // Set column widths
    sheet.setColumnWidth(1, 80);   // ID
    sheet.setColumnWidth(2, 200);  // Vendor
    sheet.setColumnWidth(3, 100);  // Amount
    sheet.setColumnWidth(4, 80);   // Currency
    sheet.setColumnWidth(5, 120);  // DueDate
    sheet.setColumnWidth(6, 100);  // Status
    sheet.setColumnWidth(7, 250);  // EmailSubject
    sheet.setColumnWidth(8, 120);  // EmailDate
    sheet.setColumnWidth(9, 300);  // EmailLink
    sheet.setColumnWidth(10, 150); // ProcessedAt

    sheet.setFrozenRows(1);
  }

  return sheet;
}

/**
 * Write a parsed invoice to the sheet.
 * @param {Sheet} sheet
 * @param {Object} invoiceData - { vendor, amount, currency, dueDate }
 * @param {GmailMessage} message
 */
function writeInvoiceToSheet(sheet, invoiceData, message) {
  const id = Utilities.getUuid().substring(0, 8);
  const emailDate = message.getDate();
  const emailLink = 'https://mail.google.com/mail/u/0/#inbox/' + message.getId();

  sheet.appendRow([
    id,
    invoiceData.vendor,
    invoiceData.amount,
    invoiceData.currency,
    invoiceData.dueDate || '',
    'pending',
    message.getSubject(),
    Utilities.formatDate(emailDate, 'Asia/Jerusalem', 'yyyy-MM-dd HH:mm'),
    emailLink,
    Utilities.formatDate(new Date(), 'Asia/Jerusalem', 'yyyy-MM-dd HH:mm')
  ]);

  Logger.log('Added invoice: ' + invoiceData.vendor + ' — ' + invoiceData.amount + ' ' + invoiceData.currency);
}

// ─── Processed IDs Tracking ──────────────────────────────────────────────────

/**
 * Get the set of already-processed email message IDs.
 * @returns {Set<string>}
 */
function getProcessedIds() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let configSheet = ss.getSheetByName(CONFIG_SHEET_NAME);

  if (!configSheet) {
    configSheet = ss.insertSheet(CONFIG_SHEET_NAME);
    configSheet.appendRow(['ProcessedMessageIDs']);
    return new Set();
  }

  const lastRow = configSheet.getLastRow();
  if (lastRow <= 1) return new Set();

  const ids = configSheet.getRange(2, 1, lastRow - 1, 1).getValues()
    .map(row => row[0])
    .filter(id => id);

  return new Set(ids);
}

/**
 * Mark a message ID as processed.
 * @param {string} messageId
 */
function markAsProcessed(messageId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let configSheet = ss.getSheetByName(CONFIG_SHEET_NAME);

  if (!configSheet) {
    configSheet = ss.insertSheet(CONFIG_SHEET_NAME);
    configSheet.appendRow(['ProcessedMessageIDs']);
  }

  configSheet.appendRow([messageId]);
}

// ─── Trigger Management ─────────────────────────────────────────────────────

/**
 * Set up a time-driven trigger to run scanGmail every 4 hours.
 * Run this function ONCE manually.
 */
function setupTrigger() {
  // Remove any existing triggers for scanGmail
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === 'scanGmail') {
      ScriptApp.deleteTrigger(trigger);
    }
  }

  // Create a new trigger: every 4 hours
  ScriptApp.newTrigger('scanGmail')
    .timeBased()
    .everyHours(4)
    .create();

  Logger.log('Trigger set: scanGmail will run every 4 hours');
}

/**
 * Remove all triggers (for cleanup).
 */
function removeTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === 'scanGmail') {
      ScriptApp.deleteTrigger(trigger);
    }
  }
  Logger.log('All scanGmail triggers removed');
}

// ─── Manual Test Helper ──────────────────────────────────────────────────────

/**
 * Test the Claude parser with sample text.
 */
function testParser() {
  const sampleText = `
    חשבונית מס מספר 12345
    חברת חשמל לישראל
    סכום לתשלום: ₪450.00
    תאריך אחרון לתשלום: 15/04/2026
  `;

  const result = parseInvoiceWithClaude(sampleText);
  Logger.log('Test result: ' + JSON.stringify(result));
}

/**
 * Invoice Monitor — Claude API Parser
 * Sends extracted text to Claude API and returns structured invoice data.
 */

/**
 * Parse invoice text using Claude API.
 * @param {string} text - Raw text from email body, PDF, or fetched link.
 * @returns {Object|null} { vendor, amount, currency, dueDate } or null if parsing fails.
 */
function parseInvoiceWithClaude(text) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('CLAUDE_API_KEY');
  if (!apiKey) {
    Logger.log('ERROR: CLAUDE_API_KEY not set in script properties');
    return null;
  }

  // Truncate very long texts to stay within token limits
  const maxChars = 12000;
  const truncatedText = text.length > maxChars ? text.substring(0, maxChars) + '\n...[truncated]' : text;

  const prompt = `You are an invoice parser. Extract invoice details from the following Hebrew/English text.

Return ONLY a valid JSON object with these fields:
- "vendor": string (the company/business name issuing the invoice)
- "amount": number (the total amount to pay, as a plain number without currency symbols)
- "currency": string (the currency code, default "ILS" if in shekels or ₪)
- "dueDate": string (payment due date in YYYY-MM-DD format, or null if not found)

If you cannot extract meaningful invoice data, return: {"error": "not_an_invoice"}

Text to parse:
${truncatedText}`;

  const payload = {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    messages: [
      { role: 'user', content: prompt }
    ]
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', options);
    const status = response.getResponseCode();

    if (status !== 200) {
      Logger.log('Claude API error: ' + status + ' — ' + response.getContentText());
      return null;
    }

    const result = JSON.parse(response.getContentText());
    const content = result.content[0].text;

    // Extract JSON from the response (Claude may wrap it in markdown code blocks)
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      Logger.log('Could not find JSON in Claude response: ' + content);
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);

    if (parsed.error) {
      Logger.log('Claude determined this is not an invoice: ' + parsed.error);
      return null;
    }

    // Validate required fields
    if (!parsed.vendor || parsed.amount === undefined) {
      Logger.log('Missing required fields in parsed result: ' + JSON.stringify(parsed));
      return null;
    }

    return {
      vendor: parsed.vendor,
      amount: Number(parsed.amount),
      currency: parsed.currency || 'ILS',
      dueDate: parsed.dueDate || null
    };
  } catch (e) {
    Logger.log('Error calling Claude API: ' + e.message);
    return null;
  }
}

/**
 * Extract text from a PDF blob using Google Docs conversion.
 * @param {Blob} pdfBlob - The PDF file as a Blob.
 * @returns {string} Extracted text content.
 */
function extractTextFromPdf(pdfBlob) {
  try {
    var blob = pdfBlob.getAs('application/pdf');
    var token = ScriptApp.getOAuthToken();

    // Upload PDF to Drive as a Google Doc using REST API
    var metadata = {
      name: 'temp_invoice_' + Date.now(),
      mimeType: 'application/vnd.google-apps.document'
    };

    var boundary = '-----boundary' + Date.now();
    var requestBody =
      '--' + boundary + '\r\n' +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(metadata) + '\r\n' +
      '--' + boundary + '\r\n' +
      'Content-Type: application/pdf\r\n' +
      'Content-Transfer-Encoding: base64\r\n\r\n' +
      Utilities.base64Encode(blob.getBytes()) + '\r\n' +
      '--' + boundary + '--';

    var response = UrlFetchApp.fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
      {
        method: 'post',
        headers: {
          'Authorization': 'Bearer ' + token,
          'Content-Type': 'multipart/related; boundary=' + boundary
        },
        payload: requestBody,
        muteHttpExceptions: true
      }
    );

    if (response.getResponseCode() !== 200) {
      Logger.log('Drive upload failed: ' + response.getContentText());
      return '';
    }

    var file = JSON.parse(response.getContentText());

    // Open the converted doc and extract text
    var doc = DocumentApp.openById(file.id);
    var text = doc.getBody().getText();

    // Clean up — delete the temporary file
    DriveApp.getFileById(file.id).setTrashed(true);

    return text;
  } catch (e) {
    Logger.log('Error extracting PDF text: ' + e.message);
    return '';
  }
}

/**
 * Fetch text content from a URL.
 * @param {string} url - The URL to fetch.
 * @returns {string} The page text content.
 */
function fetchLinkContent(url) {
  try {
    const response = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      followRedirects: true,
      validateHttpsCertificates: false,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; InvoiceMonitor/1.0)'
      }
    });

    if (response.getResponseCode() !== 200) {
      return '';
    }

    const html = response.getContentText();

    // Strip HTML tags to get plain text
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim();

    // Limit length
    return text.substring(0, 10000);
  } catch (e) {
    Logger.log('Error fetching URL ' + url + ': ' + e.message);
    return '';
  }
}

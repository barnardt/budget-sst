import { APIGatewayProxyHandlerV2, Handler } from "aws-lambda";
import { DateTime } from "luxon";
import { parse } from "csv-parse/sync";

interface ValidationResponse {
  success: boolean;
}

interface Attachment {
  filename: string;
  content_id: string;
  content_type: string;
  url: string;
  size: number;
}

interface MailerooWebhookBody {
    validation_url: string;
    deletion_url: string;
    attachments: Attachment[];
}

const cutOffDate = DateTime.fromISO('2024-06-24');

interface TransactionBase {
    description: string;
    type: 'income' | 'expense';
    source: 'capitec' | 'discovery';
    category?: string;
}

interface Transaction extends TransactionBase {
    datetime: DateTime;
    amount: number;
}

interface TransactionFromSheet extends TransactionBase {
    datetime: string;
    amount: string;
}

interface CapitecRecord {
    'Description': string;
    'Money In'?: string;
    'Money Out'?: string;
    'Fee'?: string;
    'Posting Date': string;
    'Transaction Date': string;
}

interface DiscoveryRecord {
    'Value Date': string;
    'Value Time': string;
    'Type': string;
    'Description': string;
    'Beneficiary or CardHolder': string;
    'Amount': string;
}

const parseCapitecRecord = (record: CapitecRecord): Transaction => {
    const description = record['Description']?.replaceAll('(Pending)', '').trim() || '';

    const amount = record['Money In']
        ? parseAmount(record['Money In'], 'income')
        : record['Money Out']
            ? parseAmount(record['Money Out'], 'expense')
            : parseAmount(record['Fee']!, 'expense');

    const type = record['Money In'] ? 'income' : 'expense';

    const transactionDateTime = DateTime.fromISO(record['Transaction Date'].replace(' ', 'T'));

    return {
        datetime: transactionDateTime,
        description,
        amount,
        type,
        source: 'capitec'
    };
}

const parseAmount = (val: string, type: 'income' | 'expense'): number => {
    const parsedVal = val.replaceAll('R', '').replaceAll(',', '').replaceAll('.', '').replaceAll('-','').replaceAll(' ','');
    const amount = Number(parsedVal);
    return type === 'income' ? amount : -amount;
}

const parseDiscoveryRecord = (record: DiscoveryRecord): Transaction => {
    const type = record['Amount'].startsWith('-') ? 'expense' : 'income';

    const amount = parseAmount(record['Amount'], type);

    const dateTimeString = `${record['Value Date']}T${record['Value Time']}`;
    const transactionDateTime = DateTime.fromISO(dateTimeString);

    let description = record['Description']

    if (record['Type'] === "Prepaid Electricity") {
        description = record['Type'] + " " + record['Description'];
    }

    return {
        datetime: transactionDateTime,
        description,
        amount,
        type,
        source: 'discovery'
    };
}

const processCapitecContent = (content: string): Transaction[] => {
    const records = parse(content, {
        columns: true,
        skip_empty_lines: true
    });

    const transactions = (records as unknown as CapitecRecord[])
        .map(parseCapitecRecord)
        .filter(trx => trx.datetime.toMillis() > cutOffDate.toMillis());

    console.log('Processed Capitec file, found', transactions.length, 'transactions');

    return transactions;
}

const processDiscoveryContent = (content: string): Transaction[] => {
    const records = parse(content, {
        columns: true,
        skip_empty_lines: true,
        relax_quotes: true,
        skip_records_with_error: true
    });

    const transactions = (records as unknown as DiscoveryRecord[])
        .map(parseDiscoveryRecord)
        .filter(trx => trx.datetime.toMillis() > cutOffDate.toMillis());

    console.log('Processed Discovery file, found', transactions.length, 'transactions');

    return transactions;
}

const sortByDateDescending = (transactions: Transaction[]) => transactions.sort((a, b) =>  b.datetime.toMillis() - a.datetime.toMillis());

export const handler: APIGatewayProxyHandlerV2 = async (_event) => {

  const body = JSON.parse(_event.body || "{}") as MailerooWebhookBody;

  const validationResponse = await fetch(body.validation_url);
  const validationResponseBody = await validationResponse.json() as ValidationResponse;
  if (!validationResponseBody.success) {
    return {
      statusCode: 403,
      body: JSON.stringify({ error: "Not authorized" }),
    };
  }

  if (!body.attachments || body.attachments.length === 0) {
    console.error("No attachments found in the request body.");
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "No attachments found" }),
    };
  }

  const attachment = body.attachments[0];
  // Fetch attachment content from pre-signed URL and log first 100 characters

  const attachmentResponse = await fetch(attachment.url);
  if (!attachmentResponse.ok) {
    console.error(`Failed to fetch attachment: ${attachmentResponse.statusText}`);
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Failed to fetch attachment" }),
    };
  }

  const attachmentContent = await attachmentResponse.text();
  console.log(`Fetched attachment content: ${attachmentContent.slice(0, 100)}`);

  await fetch(body.deletion_url, { method: "DELETE" });
  console.log("Email deleted successfully");

  let transactions: Transaction[] = [];
  if (attachment.filename.startsWith("account_statement")) {
    transactions = processCapitecContent(attachmentContent);
  } else if (attachment.filename.startsWith("DiscoveryBank")) {
    transactions = processDiscoveryContent(attachmentContent);
  } else {
    console.error("Unsupported attachment type:", attachment.filename);
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Unsupported attachment type" }),
    };
  }

  console.log("Transactions processed:", transactions.length);

  return {
    statusCode: 200,
  };
};

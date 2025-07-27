import { APIGatewayProxyHandlerV2, Handler } from "aws-lambda";
import { Example } from "@budget-sst/core/example";

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
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to fetch attachment" }),
    };
  }

  const attachmentContent = await attachmentResponse.text();
  console.log(`Fetched attachment content: ${attachmentContent.slice(0, 100)}`);

  await fetch(body.deletion_url, { method: "DELETE" });
  console.log("Email deleted successfully");

  return {
    statusCode: 200,
  };
};

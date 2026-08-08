const path = require("path");
const localDocumentStorage = require("../../../../telegramBot/utils/localDocumentStorage");

const TelegramGetDocument = {
  name: "telegram-get-document",
  plugin: function () {
    return {
      name: "telegram-get-document",
      setup(aibitat) {
        aibitat.function({
          super: aibitat,
          name: "get-stored-telegram-document",
          description:
            "Retrieve a document that was previously uploaded to Telegram by the user. " +
            "Use this when the user asks to see a document they previously sent, or asks " +
            "'show me the file', 'send me that document', 'where is my file', or similar. " +
            "You can search by filename (partial match) or list all available documents. " +
            "The document will be sent back to the Telegram chat automatically after retrieval.",
          examples: [
            {
              prompt: "Where is the PDF I sent yesterday?",
              call: JSON.stringify({
                action: "search",
                query: "pdf",
              }),
            },
            {
              prompt: "Send me back that contract document",
              call: JSON.stringify({
                action: "search",
                query: "contract",
              }),
            },
            {
              prompt: "List all my documents",
              call: JSON.stringify({
                action: "list",
              }),
            },
          ],
          parameters: {
            $schema: "http://json-schema.org/draft-07/schema#",
            type: "object",
            properties: {
              action: {
                type: "string",
                enum: ["list", "search", "send"],
                description:
                  "'list' to show all available documents, 'search' to find by name, 'send' to send a specific document back to the chat.",
              },
              query: {
                type: "string",
                description:
                  "Required when action='search'. Partial filename to search for.",
              },
              storedName: {
                type: "string",
                description:
                  "Required when action='send'. The storedName of the document to retrieve and send.",
              },
            },
            required: ["action"],
            additionalProperties: false,
          },
          handler: async function ({ action, query, storedName }) {
            try {
              if (action === "list") {
                const documents = await localDocumentStorage.listDocuments();
                if (documents.length === 0) {
                  return "No documents have been uploaded yet.";
                }
                const lines = documents.map((d, i) => {
                  const date = new Date(d.date).toLocaleDateString();
                  const sizeKB = (d.size / 1024).toFixed(1);
                  return `${i + 1}. ${d.originalName} (${sizeKB}KB, ${date}) [${d.storedName}]`;
                });
                return `Available documents:\n${lines.join("\n")}\n\nUse the 'send' action with the storedName to retrieve a specific document.`;
              }

              if (action === "search") {
                if (!query) return "Please provide a search query.";
                const documents = await localDocumentStorage.searchDocuments(query);
                if (documents.length === 0) {
                  return `No documents found matching "${query}".`;
                }
                const lines = documents.map((d, i) => {
                  const date = new Date(d.date).toLocaleDateString();
                  const sizeKB = (d.size / 1024).toFixed(1);
                  return `${i + 1}. ${d.originalName} (${sizeKB}KB, ${date}) [${d.storedName}]`;
                });
                return `Documents matching "${query}":\n${lines.join("\n")}\n\nUse the 'send' action with the storedName to retrieve a specific document.`;
              }

              if (action === "send") {
                if (!storedName) return "Please provide a storedName of the document to retrieve.";
                const result = await localDocumentStorage.getDocument(storedName);
                if (!result) {
                  return `Document "${storedName}" not found. Use 'list' or 'search' to find available documents.`;
                }

                // Register the document as an output file so the Telegram bot sends it
                const { metadata } = result;
                if (aibitat) {
                  const createFilesLibPath = path.join(
                    __dirname,
                    "../create-files/lib"
                  );
                  const createFilesLib = require(createFilesLibPath);
                  createFilesLib.registerOutput(aibitat, "TelegramDocument", {
                    storedName: metadata.storedName,
                    filename: metadata.originalName,
                    mimeType: metadata.mimeType,
                    fileSize: metadata.size,
                  });
                }

                return `Found document: ${metadata.originalName} (${(metadata.size / 1024).toFixed(1)}KB). It will be sent to the chat.`;
              }

              return 'Unknown action. Use "list", "search", or "send".';
            } catch (error) {
              return `Error accessing document storage: ${error.message}`;
            }
          },
        });
      },
    };
  },
};

const telegramDocumentsAgent = {
  name: "telegram-documents-agent",
  startupConfig: {
    params: {},
  },
  plugin: [TelegramGetDocument],
};

module.exports = { telegramDocumentsAgent };
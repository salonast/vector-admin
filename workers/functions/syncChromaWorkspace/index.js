const { Queue } = require('../../../backend/models/queue');
const {
  Chroma,
} = require('../../../backend/utils/vectordatabases/providers/chroma');
const { InngestClient } = require('../../utils/inngest');
const { v4 } = require('uuid');
const path = require('path');
const {
  WorkspaceDocument,
} = require('../../../backend/models/workspaceDocument');
const { DocumentVectors } = require('../../../backend/models/documentVectors');
const { deleteVectorCacheFile } = require('../../../backend/utils/storage');

const syncChromaWorkspace = InngestClient.createFunction(
  { name: 'Sync Chroma Workspace' },
  { event: 'chroma/sync-workspace' },
  async ({ event, step: _step, logger }) => {
    var result = {};
    const { organization, workspace, connector, jobId } = event.data;
    try {
      const chromaClient = new Chroma(connector);
      const collection = await chromaClient.namespace(workspace.slug);

      if (!collection) {
        result = {
          message: `No collection ${workspace.slug} found - nothing to do.`,
        };
        await Queue.updateJob(jobId, Queue.status.complete, result);
        return { result };
      }

      if (collection.count === 0) {
        result = {
          message: `Chroma collection ${workspace.slug} has no data- nothing to do.`,
        };
        await Queue.updateJob(jobId, Queue.status.complete, result);
        return { result };
      }

      logger.info(
        `Working on ${collection.count} embeddings of ${collection.name}`
      );
      await paginateAndStore(chromaClient, collection, workspace, organization);

      result = {
        message:
          'Chroma instance vector data has been synced. Workspaces data synced.',
      };
      await Queue.updateJob(jobId, Queue.status.complete, result);
      return { result };
    } catch (e) {
      const result = {
        canRetry: true,
        message: `Job failed with error`,
        error: e.message,
        details: e,
      };
      await Queue.updateJob(jobId, Queue.status.failed, result);
    }
  }
);

async function paginateAndStore(
  chromaClient,
  collection,
  workspace,
  organization
) {
  const PAGE_SIZE = 10;
  var syncing = true;
  var offset = 0;
  const files = {};

  while (syncing) {
    const {
      ids = [],
      embeddings = [],
      metadatas = [],
      documents = [],
      error = null,
    } = await chromaClient.rawGet(collection.id, PAGE_SIZE, offset);

    if (error !== null) {
      syncing = false;
      throw error;
    }

    if (ids.length === 0) {
      syncing = false;
      continue;
    }

    for (let i = 0; i < ids.length; i++) {
      const documentName =
        metadatas[i]?.title ||
        metadatas[i]?.name ||
        `imported-document-${v4()}.txt`;
      if (!files.hasOwnProperty(documentName)) {
        files[documentName] = {
          currentLine: 0,
          name: documentName,
          documentId: v4(),
          cacheFilename: `${WorkspaceDocument.vectorFilenameRaw(
            documentName,
            workspace.id
          )}.json`,
          ids: [],
          embeddings: [],
          metadatas: [],
          fullText: '',
        };
      }
      const text = documents[i];
      const totalLines = (String(text).match(/\n/g) || '').length;
      files[documentName].ids.push(ids[i]);
      files[documentName].embeddings.push(embeddings[i]);
      files[documentName].metadatas.push({
        title: documentName,
        'loc.lines.from': files[documentName].currentLine + 1,
        'loc.lines.to': files[documentName].currentLine + 1 + totalLines,
        ...metadatas[i],
        text,
      });
      files[documentName].fullText += text;
      files[documentName].currentLine =
        files[documentName].currentLine + 1 + totalLines;
    }

    offset += PAGE_SIZE;
  }

  console.log('Removing existing Workspace Documents & Document Vectors');
  const documents = await WorkspaceDocument.where(
    `workspace_id = ${workspace.id}`
  );
  for (const document of documents) {
    const digestFilename = WorkspaceDocument.vectorFilename(document);
    await deleteVectorCacheFile(digestFilename);
  }
  await WorkspaceDocument.deleteWhere(`workspace_id = ${workspace.id}`);
  console.log(
    `Removed ${documents.length} existing Workspace Documents & Document Vectors`
  );

  console.log('Creating Workspace Documents & Document Vectors');
  await createDocuments(files, workspace, organization);
  await createDocumentVectors(files);

  for (const fileKey of Object.keys(files)) {
    console.log('Creating vector cache for ', fileKey);
    await saveVectorCache(files[fileKey]);
  }

  return;
}

async function createDocuments(files, workspace, organization) {
  const documents = [];
  Object.values(files).map((data) => {
    documents.push({
      documentId: data.documentId,
      name: data.name,
      workspaceId: workspace.id,
      organizationId: organization.id,
    });
  });

  await WorkspaceDocument.createMany(documents);
  return;
}

async function createDocumentVectors(files) {
  const docIds = Object.values(files).map((data) => data.documentId);
  const existingDocuments = await WorkspaceDocument.where(
    `docId IN (${docIds.map((id) => `'${id}'`).join(',')})`
  );
  const vectors = [];

  Object.values(files).map((data) => {
    const dbDocument = existingDocuments.find(
      (doc) => doc.docId === data.documentId
    );
    if (!dbDocument) {
      console.error(
        'Could not find a database workspace document for ',
        data.documentId
      );
      return;
    }

    data.ids.map((vectorId) => {
      vectors.push({
        documentId: dbDocument.id,
        docId: data.documentId,
        vectorId,
      });
    });
  });

  await DocumentVectors.createMany(vectors);
  return;
}

async function saveVectorCache(data) {
  const fs = require('fs');
  const folder = path.resolve(
    __dirname,
    '../../../backend/storage/vector-cache'
  );
  if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });

  const destination = path.resolve(
    __dirname,
    `../../../backend/storage/vector-cache/${data.cacheFilename}`
  );
  const toSave = [];
  for (let i = 0; i < data.ids.length; i++) {
    toSave.push({
      vectorDbId: data.ids[i],
      values: data.embeddings[i],
      metadata: data.metadatas[i],
    });
  }
  fs.writeFileSync(destination, JSON.stringify(toSave), 'utf8');
  return;
}

module.exports = {
  syncChromaWorkspace,
};

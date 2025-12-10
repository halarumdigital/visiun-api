import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import multipart from '@fastify/multipart';
import { storageService, StorageFolder } from '../services/storageService.js';
import { authMiddleware } from '../middleware/auth.js';
import { rbac } from '../middleware/rbac.js';
import { uploadRateLimit } from '../middleware/rateLimit.js';
import { auditService, AuditActions } from '../middleware/audit.js';
import { BadRequestError } from '../utils/errors.js';

// Swagger Schemas
const uploadResponseSchema = {
  type: 'object',
  properties: {
    url: { type: 'string', format: 'uri', description: 'URL pública do arquivo' },
    key: { type: 'string', description: 'Chave única do arquivo' },
    size: { type: 'number', description: 'Tamanho do arquivo em bytes' },
    contentType: { type: 'string', description: 'Tipo MIME do arquivo' },
  },
};

const presignedResponseSchema = {
  type: 'object',
  properties: {
    uploadUrl: { type: 'string', format: 'uri', description: 'URL para upload direto' },
    key: { type: 'string', description: 'Chave do arquivo' },
    publicUrl: { type: 'string', format: 'uri', description: 'URL pública após upload' },
    expiresIn: { type: 'number', description: 'Tempo de expiração em segundos' },
  },
};

const errorResponseSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean', enum: [false] },
    error: { type: 'string' },
    code: { type: 'string' },
  },
};

const VALID_FOLDERS: StorageFolder[] = [
  'vistorias',
  'documentos',
  'contratos',
  'contratos-assinados',
  'comprovantes-financeiro',
  'avatars',
  'cnh-documents',
  'residence-proofs',
  'motorcycle-documents',
  'manutencoes',
];

const uploadRoutes: FastifyPluginAsync = async (app) => {
  // Registrar plugin multipart
  await app.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024, // 10MB
      files: 5,
    },
  });

  /**
   * POST /api/upload
   * Upload de arquivo único
   */
  app.post('/', {
    preHandler: [authMiddleware, rbac(), uploadRateLimit],
    schema: {
      description: 'Upload de arquivo único para armazenamento',
      tags: ['Upload'],
      security: [{ bearerAuth: [] }],
      consumes: ['multipart/form-data'],
      querystring: {
        type: 'object',
        properties: {
          folder: {
            type: 'string',
            enum: VALID_FOLDERS,
            default: 'documentos',
            description: 'Pasta de destino'
          },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: uploadResponseSchema,
          },
        },
        400: errorResponseSchema,
        401: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const data = await request.file();

    if (!data) {
      throw new BadRequestError('Nenhum arquivo enviado');
    }

    // Obter folder do form field ou query
    const folder = (data.fields.folder as any)?.value ||
                   (request.query as { folder?: string }).folder ||
                   'documentos';

    if (!VALID_FOLDERS.includes(folder as StorageFolder)) {
      throw new BadRequestError(`Pasta inválida. Pastas válidas: ${VALID_FOLDERS.join(', ')}`);
    }

    // Converter stream para buffer
    const buffer = await data.toBuffer();

    const result = await storageService.upload(
      buffer,
      folder as StorageFolder,
      data.filename,
      data.mimetype
    );

    await auditService.logFromRequest(
      request,
      AuditActions.FILE_UPLOAD,
      'file',
      result.key,
      undefined,
      { folder, filename: data.filename, size: result.size }
    );

    return reply.status(201).send({
      success: true,
      data: result,
    });
  });

  /**
   * POST /api/upload/multiple
   * Upload de múltiplos arquivos
   */
  app.post('/multiple', {
    preHandler: [authMiddleware, rbac(), uploadRateLimit],
    schema: {
      description: 'Upload de múltiplos arquivos (até 5)',
      tags: ['Upload'],
      security: [{ bearerAuth: [] }],
      consumes: ['multipart/form-data'],
      querystring: {
        type: 'object',
        properties: {
          folder: {
            type: 'string',
            enum: VALID_FOLDERS,
            default: 'documentos',
            description: 'Pasta de destino'
          },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'array', items: uploadResponseSchema },
          },
        },
        400: errorResponseSchema,
        401: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const parts = request.files();
    const folder = (request.query as { folder?: string }).folder || 'documentos';

    if (!VALID_FOLDERS.includes(folder as StorageFolder)) {
      throw new BadRequestError(`Pasta inválida. Pastas válidas: ${VALID_FOLDERS.join(', ')}`);
    }

    const results = [];

    for await (const part of parts) {
      const buffer = await part.toBuffer();
      const result = await storageService.upload(
        buffer,
        folder as StorageFolder,
        part.filename,
        part.mimetype
      );
      results.push(result);

      await auditService.logFromRequest(
        request,
        AuditActions.FILE_UPLOAD,
        'file',
        result.key,
        undefined,
        { folder, filename: part.filename, size: result.size }
      );
    }

    if (results.length === 0) {
      throw new BadRequestError('Nenhum arquivo enviado');
    }

    return reply.status(201).send({
      success: true,
      data: results,
    });
  });

  /**
   * POST /api/upload/presigned
   * Obter URL presigned para upload direto
   */
  app.post('/presigned', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Obter URL presigned para upload direto ao storage',
      tags: ['Upload'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['folder', 'filename', 'contentType'],
        properties: {
          folder: { type: 'string', enum: VALID_FOLDERS, description: 'Pasta de destino' },
          filename: { type: 'string', minLength: 1, description: 'Nome do arquivo' },
          contentType: { type: 'string', minLength: 1, description: 'Tipo MIME do arquivo' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: presignedResponseSchema,
          },
        },
        400: errorResponseSchema,
        401: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const schema = z.object({
      folder: z.enum(VALID_FOLDERS as [string, ...string[]]),
      filename: z.string().min(1),
      contentType: z.string().min(1),
    });

    const body = schema.safeParse(request.body);
    if (!body.success) {
      throw new BadRequestError(body.error.errors[0].message);
    }

    const { folder, filename, contentType } = body.data;

    const result = await storageService.getSignedUploadUrl(
      folder as StorageFolder,
      filename,
      contentType
    );

    return reply.status(200).send({
      success: true,
      data: result,
    });
  });

  /**
   * GET /api/upload/download/:key
   * Obter URL assinada para download
   */
  app.get('/download/*', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Obter URL assinada para download de arquivo',
      tags: ['Upload'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          '*': { type: 'string', description: 'Chave do arquivo' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                url: { type: 'string', format: 'uri', description: 'URL assinada para download' },
                expiresIn: { type: 'number', description: 'Tempo de expiração em segundos' },
              },
            },
          },
        },
        400: errorResponseSchema,
        401: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const key = (request.params as { '*': string })['*'];

    if (!key) {
      throw new BadRequestError('Key do arquivo é obrigatória');
    }

    const url = await storageService.getSignedDownloadUrl(key);

    return reply.status(200).send({
      success: true,
      data: { url, expiresIn: 3600 },
    });
  });

  /**
   * DELETE /api/upload/*
   * Deletar arquivo
   */
  app.delete('/*', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Deletar arquivo do storage',
      tags: ['Upload'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          '*': { type: 'string', description: 'Chave do arquivo' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' },
          },
        },
        400: errorResponseSchema,
        401: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const key = (request.params as { '*': string })['*'];

    if (!key) {
      throw new BadRequestError('Key do arquivo é obrigatória');
    }

    await storageService.delete(key);

    await auditService.logFromRequest(
      request,
      AuditActions.FILE_DELETE,
      'file',
      key
    );

    return reply.status(200).send({
      success: true,
      message: 'Arquivo deletado com sucesso',
    });
  });
};

export default uploadRoutes;

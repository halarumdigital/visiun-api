import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { BadRequestError, NotFoundError } from '../utils/errors.js';
import { UploadResult } from '../types/index.js';
import { nanoid } from 'nanoid';

// Tipos de arquivo permitidos por bucket/contexto
const ALLOWED_MIME_TYPES: Record<string, string[]> = {
  images: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  documents: ['application/pdf', 'image/jpeg', 'image/png'],
  contracts: ['application/pdf'],
  all: [
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'application/pdf', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ],
};

// Tamanho máximo de arquivo (em bytes)
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// Pastas/prefixos disponíveis
export type StorageFolder =
  | 'vistorias'
  | 'documentos'
  | 'contratos'
  | 'contratos-assinados'
  | 'comprovantes-financeiro'
  | 'avatars'
  | 'cnh-documents'
  | 'residence-proofs'
  | 'motorcycle-documents'
  | 'manutencoes';

export class StorageService {
  private client: S3Client;
  private bucket: string;
  private publicUrl: string;

  constructor() {
    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      },
    });
    this.bucket = env.R2_BUCKET_NAME;
    this.publicUrl = env.R2_PUBLIC_URL;
  }

  /**
   * Upload de arquivo para o R2
   */
  async upload(
    file: Buffer,
    folder: StorageFolder,
    originalFilename: string,
    contentType: string,
    options: {
      allowedTypes?: string[];
      maxSize?: number;
      customKey?: string;
    } = {}
  ): Promise<UploadResult> {
    const {
      allowedTypes = ALLOWED_MIME_TYPES.all,
      maxSize = MAX_FILE_SIZE,
      customKey,
    } = options;

    // Validar tipo de arquivo
    if (!allowedTypes.includes(contentType)) {
      throw new BadRequestError(
        `Tipo de arquivo não permitido. Tipos aceitos: ${allowedTypes.join(', ')}`
      );
    }

    // Validar tamanho
    if (file.length > maxSize) {
      throw new BadRequestError(
        `Arquivo muito grande. Tamanho máximo: ${maxSize / 1024 / 1024}MB`
      );
    }

    // Gerar chave única
    const extension = originalFilename.split('.').pop() || 'bin';
    const key = customKey || `${folder}/${nanoid()}.${extension}`;

    try {
      // Sanitizar nome do arquivo para metadata (remover caracteres especiais)
      const sanitizedFilename = originalFilename
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // Remove acentos
        .replace(/[^\x00-\x7F]/g, ''); // Remove caracteres não-ASCII

      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: file,
          ContentType: contentType,
          // Metadata opcional
          Metadata: {
            'original-filename': sanitizedFilename,
            'uploaded-at': new Date().toISOString(),
          },
        })
      );

      const url = `${this.publicUrl}/${key}`;

      logger.info({ key, contentType, size: file.length }, 'File uploaded successfully');

      return {
        url,
        key,
        bucket: this.bucket,
        contentType,
        size: file.length,
      };
    } catch (error) {
      logger.error({ error, key }, 'Failed to upload file');
      throw new BadRequestError('Falha ao fazer upload do arquivo');
    }
  }

  /**
   * Upload de arquivo a partir de stream/multipart
   */
  async uploadFromStream(
    stream: NodeJS.ReadableStream,
    folder: StorageFolder,
    filename: string,
    contentType: string
  ): Promise<UploadResult> {
    // Converter stream para buffer
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    const buffer = Buffer.concat(chunks);

    return this.upload(buffer, folder, filename, contentType);
  }

  /**
   * Obter URL assinada para download (arquivos privados)
   */
  async getSignedDownloadUrl(key: string, expiresIn: number = 3600): Promise<string> {
    try {
      // Verificar se o arquivo existe
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
        })
      );

      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      return await getSignedUrl(this.client, command, { expiresIn });
    } catch (error: any) {
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        throw new NotFoundError('Arquivo não encontrado');
      }
      logger.error({ error, key }, 'Failed to generate signed URL');
      throw new BadRequestError('Falha ao gerar URL de download');
    }
  }

  /**
   * Obter URL assinada para upload direto (presigned PUT)
   */
  async getSignedUploadUrl(
    folder: StorageFolder,
    filename: string,
    contentType: string,
    expiresIn: number = 300
  ): Promise<{ uploadUrl: string; key: string; publicUrl: string }> {
    const extension = filename.split('.').pop() || 'bin';
    const key = `${folder}/${nanoid()}.${extension}`;

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });

    const uploadUrl = await getSignedUrl(this.client, command, { expiresIn });

    return {
      uploadUrl,
      key,
      publicUrl: `${this.publicUrl}/${key}`,
    };
  }

  /**
   * Deletar arquivo
   */
  async delete(key: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: key,
        })
      );

      logger.info({ key }, 'File deleted successfully');
    } catch (error) {
      logger.error({ error, key }, 'Failed to delete file');
      throw new BadRequestError('Falha ao deletar arquivo');
    }
  }

  /**
   * Deletar arquivo por URL completa
   */
  async deleteByUrl(url: string): Promise<void> {
    const key = this.extractKeyFromUrl(url);
    if (key) {
      await this.delete(key);
    }
  }

  /**
   * Verificar se arquivo existe
   */
  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
        })
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Listar arquivos em uma pasta
   */
  async listFiles(
    folder: StorageFolder,
    options: {
      maxKeys?: number;
      continuationToken?: string;
    } = {}
  ): Promise<{
    files: { key: string; size: number; lastModified: Date }[];
    nextToken?: string;
  }> {
    const { maxKeys = 100, continuationToken } = options;

    const response = await this.client.send(
      new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: `${folder}/`,
        MaxKeys: maxKeys,
        ContinuationToken: continuationToken,
      })
    );

    const files = (response.Contents || []).map((item) => ({
      key: item.Key!,
      size: item.Size!,
      lastModified: item.LastModified!,
    }));

    return {
      files,
      nextToken: response.NextContinuationToken,
    };
  }

  /**
   * Copiar arquivo para nova localização
   */
  async copy(sourceKey: string, destinationKey: string): Promise<string> {
    // R2 não suporta CopyObject diretamente, então fazemos download e upload
    const getCommand = new GetObjectCommand({
      Bucket: this.bucket,
      Key: sourceKey,
    });

    const response = await this.client.send(getCommand);
    const body = await response.Body?.transformToByteArray();

    if (!body) {
      throw new NotFoundError('Arquivo fonte não encontrado');
    }

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: destinationKey,
        Body: body,
        ContentType: response.ContentType,
      })
    );

    return `${this.publicUrl}/${destinationKey}`;
  }

  /**
   * Extrair key de uma URL completa
   */
  extractKeyFromUrl(url: string): string | null {
    if (!url.startsWith(this.publicUrl)) {
      return null;
    }
    return url.replace(`${this.publicUrl}/`, '');
  }

  /**
   * Gerar URL pública a partir da key
   */
  getPublicUrl(key: string): string {
    return `${this.publicUrl}/${key}`;
  }

  /**
   * Validar se URL pertence ao nosso storage
   */
  isOurUrl(url: string): boolean {
    return url.startsWith(this.publicUrl);
  }
}

export const storageService = new StorageService();

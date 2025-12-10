// Roles do sistema
export type UserRole = 'master_br' | 'admin' | 'regional' | 'franchisee';
export type RegionalType = 'admin' | 'simples';
export type MasterType = 'admin' | 'simples';

// Payload do JWT
export interface TokenPayload {
  userId: string;
  email: string;
  role: UserRole;
  regionalType?: RegionalType;
  masterType?: MasterType;
  cityId?: string | null;
  franchiseeId?: string | null;
}

// Contexto de autorização injetado nas requests
export interface AuthContext {
  userId: string;
  email: string;
  role: UserRole;
  regionalType?: RegionalType;
  masterType?: MasterType;
  cityId?: string | null;
  franchiseeId?: string | null;

  // Helpers
  isMasterOrAdmin: () => boolean;
  isRegional: () => boolean;
  isFranchisee: () => boolean;
  getCityFilter: () => { city_id?: string } | Record<string, never>;
  getFranchiseeFilter: () => { franchisee_id?: string; city_id?: string } | Record<string, never>;
}

// Extensão do Fastify Request
declare module 'fastify' {
  interface FastifyRequest {
    user?: TokenPayload;
    authContext?: AuthContext;
  }
}

// Tipos de resposta padronizados
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// Parâmetros comuns de paginação
export interface PaginationParams {
  page?: number;
  limit?: number;
  orderBy?: string;
  orderDir?: 'asc' | 'desc';
}

// Status das entidades
export type UserStatus = 'active' | 'blocked' | 'inactive' | 'pending';
export type MotorcycleStatus =
  | 'active'
  | 'alugada'
  | 'relocada'
  | 'manutencao'
  | 'recolhida'
  | 'indisponivel_rastreador'
  | 'indisponivel_emplacamento'
  | 'inadimplente'
  | 'renegociado'
  | 'furto_roubo';
export type RentalStatus = 'active' | 'completed' | 'cancelled' | 'paused';
export type ClientStatus = 'ativo' | 'inativo' | 'bloqueado';
export type ContractStatus = 'draft' | 'generated' | 'sent' | 'signed' | 'cancelled';
export type FinanceiroTipo = 'entrada' | 'saida';
export type VistoriaType = 'entrada' | 'saida' | 'periodica';
export type VistoriaStatus = 'pendente' | 'aprovada' | 'reprovada';
export type FrequenciaRecorrente = 'semanal' | 'quinzenal' | 'mensal';
export type LeadSource = 'instagram_proprio' | 'indicacao' | 'espontaneo' | 'google';

// Resultado de autenticação
export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    name: string | null;
    role: UserRole;
    regionalType?: RegionalType;
    masterType?: MasterType;
    cityId?: string | null;
    franchiseeId?: string | null;
    status: UserStatus;
  };
}

// Eventos de Realtime (Socket.io)
export interface RealtimeEvent<T = unknown> {
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  table?: string;
  data: T;
  oldData?: T;
  timestamp?: string;
}

// Upload
export interface UploadResult {
  url: string;
  key: string;
  bucket: string;
  contentType: string;
  size: number;
}

// Webhook de assinatura
export interface SignatureWebhookPayload {
  event: 'document.signed' | 'document.refused' | 'document.expired' | 'document.viewed';
  data: {
    document_key: string;
    signer_email?: string;
    signed_at?: string;
    reason?: string;
  };
}

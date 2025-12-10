import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { authService } from '../services/authService.js';
import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';
import { TokenPayload, RealtimeEvent } from '../types/index.js';

// Instância global do serviço de realtime
export let realtimeService: RealtimeService | null = null;

interface ConnectedUser {
  socket: Socket;
  user: TokenPayload;
  rooms: string[];
}

export class RealtimeService {
  private io: Server;
  private connectedUsers: Map<string, ConnectedUser> = new Map();

  constructor(httpServer: HttpServer) {
    this.io = new Server(httpServer, {
      cors: {
        origin: env.FRONTEND_URL,
        credentials: true,
      },
      // Configurações de performance
      pingTimeout: 60000,
      pingInterval: 25000,
    });

    this.setupMiddleware();
    this.setupEventHandlers();

    logger.info('WebSocket server initialized');
  }

  /**
   * Configurar middleware de autenticação
   */
  private setupMiddleware(): void {
    this.io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');

        if (!token) {
          return next(new Error('Token de autenticação não fornecido'));
        }

        const user = authService.verifyAccessToken(token);
        socket.data.user = user;
        next();
      } catch (error) {
        logger.warn({ error }, 'WebSocket authentication failed');
        next(new Error('Falha na autenticação'));
      }
    });
  }

  /**
   * Configurar handlers de eventos
   */
  private setupEventHandlers(): void {
    this.io.on('connection', (socket) => {
      const user = socket.data.user as TokenPayload;

      logger.info({ userId: user.userId, email: user.email }, 'User connected to WebSocket');

      // Registrar usuário conectado
      const rooms = this.getUserRooms(user);
      this.connectedUsers.set(socket.id, { socket, user, rooms });

      // Entrar nas rooms baseado no role/contexto
      rooms.forEach(room => {
        socket.join(room);
        logger.debug({ room, userId: user.userId }, 'User joined room');
      });

      // Handler de desconexão
      socket.on('disconnect', (reason) => {
        logger.info({ userId: user.userId, reason }, 'User disconnected from WebSocket');
        this.connectedUsers.delete(socket.id);
      });

      // Handler para subscrição em entidades específicas
      socket.on('subscribe', (data: { entity: string; id: string }) => {
        const room = `${data.entity}:${data.id}`;
        socket.join(room);
        logger.debug({ room, userId: user.userId }, 'User subscribed to entity');
      });

      // Handler para cancelar subscrição
      socket.on('unsubscribe', (data: { entity: string; id: string }) => {
        const room = `${data.entity}:${data.id}`;
        socket.leave(room);
        logger.debug({ room, userId: user.userId }, 'User unsubscribed from entity');
      });

      // Ping/pong para manter conexão viva
      socket.on('ping', () => {
        socket.emit('pong');
      });

      // Confirmar conexão
      socket.emit('connected', {
        userId: user.userId,
        rooms,
        timestamp: new Date().toISOString(),
      });
    });
  }

  /**
   * Determinar rooms que o usuário deve participar
   */
  private getUserRooms(user: TokenPayload): string[] {
    const rooms: string[] = [`user:${user.userId}`];

    // Admin room para master/admin
    if (['master_br', 'admin'].includes(user.role)) {
      rooms.push('admin');
      rooms.push('all'); // Recebe todos os eventos
    }

    // Room da cidade para regional
    if (user.cityId) {
      rooms.push(`city:${user.cityId}`);
    }

    // Room do franqueado para franchisee
    if (user.franchiseeId) {
      rooms.push(`franchisee:${user.franchiseeId}`);
    }

    return rooms;
  }

  /**
   * Emitir evento de mudança no financeiro
   */
  emitFinanceiroChange(franchiseeId: string, data: RealtimeEvent): void {
    this.io.to(`franchisee:${franchiseeId}`).emit('financeiro:change', data);
    this.io.to('admin').emit('financeiro:change', data);
    logger.debug({ franchiseeId, type: data.type }, 'Emitted financeiro change');
  }

  /**
   * Emitir evento de mudança em manutenção
   */
  emitMaintenanceChange(cityId: string | null, data: RealtimeEvent): void {
    if (cityId) {
      this.io.to(`city:${cityId}`).emit('maintenance:change', data);
    }
    this.io.to('admin').emit('maintenance:change', data);
    logger.debug({ cityId, type: data.type }, 'Emitted maintenance change');
  }

  /**
   * Emitir evento de mudança em locação
   */
  emitRentalChange(franchiseeId: string, cityId: string | null | undefined, data: RealtimeEvent): void {
    this.io.to(`franchisee:${franchiseeId}`).emit('rental:change', data);
    if (cityId) {
      this.io.to(`city:${cityId}`).emit('rental:change', data);
    }
    this.io.to('admin').emit('rental:change', data);
    logger.debug({ franchiseeId, cityId, type: data.type }, 'Emitted rental change');
  }

  /**
   * Emitir evento de mudança em rastreadores
   */
  emitRastreadoresChange(data: RealtimeEvent): void {
    this.io.to('admin').emit('rastreadores:change', data);
    logger.debug({ type: data.type }, 'Emitted rastreadores change');
  }

  /**
   * Emitir evento de mudança em motocicleta
   */
  emitMotorcycleChange(franchiseeId: string | null, cityId: string | null, data: RealtimeEvent): void {
    if (franchiseeId) {
      this.io.to(`franchisee:${franchiseeId}`).emit('motorcycle:change', data);
    }
    if (cityId) {
      this.io.to(`city:${cityId}`).emit('motorcycle:change', data);
    }
    this.io.to('admin').emit('motorcycle:change', data);
    logger.debug({ franchiseeId, cityId, type: data.type }, 'Emitted motorcycle change');
  }

  /**
   * Emitir evento de contrato
   */
  emitContractChange(franchiseeId: string, data: RealtimeEvent): void {
    this.io.to(`franchisee:${franchiseeId}`).emit('contract:change', data);
    this.io.to('admin').emit('contract:change', data);
    logger.debug({ franchiseeId, type: data.type }, 'Emitted contract change');
  }

  /**
   * Emitir notificação para usuário específico
   */
  emitNotification(userId: string, notification: {
    type: 'info' | 'success' | 'warning' | 'error';
    title: string;
    message: string;
    data?: unknown;
  }): void {
    this.io.to(`user:${userId}`).emit('notification', {
      ...notification,
      timestamp: new Date().toISOString(),
    });
    logger.debug({ userId, type: notification.type }, 'Emitted notification');
  }

  /**
   * Emitir notificação para todos os admins
   */
  emitAdminNotification(notification: {
    type: 'info' | 'success' | 'warning' | 'error';
    title: string;
    message: string;
    data?: unknown;
  }): void {
    this.io.to('admin').emit('notification', {
      ...notification,
      timestamp: new Date().toISOString(),
    });
    logger.debug({ type: notification.type }, 'Emitted admin notification');
  }

  /**
   * Broadcast para todos os conectados
   */
  broadcast(event: string, data: unknown): void {
    this.io.emit(event, data);
    logger.debug({ event }, 'Broadcast event');
  }

  /**
   * Obter contagem de usuários conectados
   */
  getConnectedUsersCount(): number {
    return this.connectedUsers.size;
  }

  /**
   * Obter lista de usuários conectados (para debug/admin)
   */
  getConnectedUsers(): { id: string; email: string; role: string; rooms: string[] }[] {
    return Array.from(this.connectedUsers.values()).map(({ user, rooms }) => ({
      id: user.userId,
      email: user.email,
      role: user.role,
      rooms,
    }));
  }

  /**
   * Verificar se usuário está conectado
   */
  isUserConnected(userId: string): boolean {
    return Array.from(this.connectedUsers.values()).some(
      ({ user }) => user.userId === userId
    );
  }

  /**
   * Desconectar usuário forçadamente
   */
  disconnectUser(userId: string, reason?: string): void {
    for (const [socketId, { socket, user }] of this.connectedUsers.entries()) {
      if (user.userId === userId) {
        socket.emit('force-disconnect', { reason: reason || 'Sessão encerrada' });
        socket.disconnect(true);
        this.connectedUsers.delete(socketId);
        logger.info({ userId, reason }, 'User forcefully disconnected');
      }
    }
  }

  /**
   * Obter instância do Socket.io
   */
  getIO(): Server {
    return this.io;
  }
}

/**
 * Inicializar serviço de realtime
 */
export function initializeRealtime(httpServer: HttpServer): RealtimeService {
  realtimeService = new RealtimeService(httpServer);
  return realtimeService;
}

/**
 * Obter instância do serviço de realtime
 */
export function getRealtime(): RealtimeService | null {
  return realtimeService;
}

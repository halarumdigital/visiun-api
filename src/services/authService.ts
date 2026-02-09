import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';
import {
  TokenPayload,
  AuthResult,
  UserRole,
  RegionalType,
  MasterType,
  UserStatus
} from '../types/index.js';
import {
  UnauthorizedError,
  BadRequestError,
  NotFoundError,
  ConflictError
} from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { nanoid } from 'nanoid';

const SALT_ROUNDS = 12;
const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_DURATION_MINUTES = 15;

export class AuthService {
  /**
   * Hash de senha usando bcrypt
   */
  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, SALT_ROUNDS);
  }

  /**
   * Verificar senha contra hash
   */
  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  /**
   * Gerar token de acesso JWT
   */
  generateAccessToken(payload: TokenPayload): string {
    return jwt.sign(payload as object, env.JWT_SECRET, {
      expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
    });
  }

  /**
   * Gerar token de refresh JWT
   */
  generateRefreshToken(payload: TokenPayload): string {
    return jwt.sign(payload as object, env.JWT_REFRESH_SECRET, {
      expiresIn: env.JWT_REFRESH_EXPIRES_IN as jwt.SignOptions['expiresIn'],
    });
  }

  /**
   * Verificar e decodificar token de acesso
   */
  verifyAccessToken(token: string): TokenPayload {
    try {
      return jwt.verify(token, env.JWT_SECRET) as TokenPayload;
    } catch (error) {
      throw new UnauthorizedError('Token inválido ou expirado');
    }
  }

  /**
   * Verificar e decodificar token de refresh
   */
  verifyRefreshToken(token: string): TokenPayload {
    try {
      return jwt.verify(token, env.JWT_REFRESH_SECRET) as TokenPayload;
    } catch (error) {
      throw new UnauthorizedError('Refresh token inválido ou expirado');
    }
  }

  /**
   * Login do usuário
   */
  async login(email: string, password: string): Promise<AuthResult> {
    const user = await prisma.appUser.findUnique({
      where: { email: email.toLowerCase() },
      include: {
        city: true,
        franchisee: true,
      },
    });

    if (!user) {
      logger.warn({ email }, 'Login attempt with non-existent email');
      throw new UnauthorizedError('Credenciais inválidas');
    }

    // Verificar se a conta está bloqueada
    if (user.locked_until && user.locked_until > new Date()) {
      const minutesLeft = Math.ceil(
        (user.locked_until.getTime() - Date.now()) / 1000 / 60
      );
      throw new UnauthorizedError(
        `Conta bloqueada. Tente novamente em ${minutesLeft} minutos.`
      );
    }

    // Verificar status do usuário
    if (user.status === 'blocked') {
      throw new UnauthorizedError('Conta bloqueada. Entre em contato com o administrador.');
    }

    if (user.status === 'inactive') {
      throw new UnauthorizedError('Conta inativa. Entre em contato com o administrador.');
    }

    if (user.status === 'pending') {
      throw new UnauthorizedError('Conta pendente de ativação. Verifique seu email.');
    }

    // Verificar se o usuário tem senha definida
    if (!user.password_hash) {
      throw new UnauthorizedError(
        'Senha não definida. Solicite um reset de senha ao administrador.'
      );
    }

    // Verificar senha
    const isValidPassword = await this.verifyPassword(password, user.password_hash);

    if (!isValidPassword) {
      await this.incrementFailedAttempts(user.id);
      logger.warn({ email, userId: user.id }, 'Invalid password attempt');
      throw new UnauthorizedError('Credenciais inválidas');
    }

    // Gerar tokens
    const tokenPayload: TokenPayload = {
      userId: user.id,
      email: user.email,
      role: user.role as UserRole,
      regionalType: user.regional_type as RegionalType | undefined,
      masterType: user.master_type as MasterType | undefined,
      cityId: user.city_id,
      franchiseeId: user.franchisee_id,
    };

    const accessToken = this.generateAccessToken(tokenPayload);
    const refreshToken = this.generateRefreshToken(tokenPayload);

    // Calcular expiração do refresh token
    const refreshExpiresAt = new Date();
    const days = parseInt(env.JWT_REFRESH_EXPIRES_IN.replace('d', '')) || 30;
    refreshExpiresAt.setDate(refreshExpiresAt.getDate() + days);

    // Atualizar usuário com refresh token e limpar tentativas falhas
    await prisma.appUser.update({
      where: { id: user.id },
      data: {
        refresh_token: refreshToken,
        refresh_token_expires_at: refreshExpiresAt,
        failed_login_attempts: 0,
        locked_until: null,
        last_login: new Date(),
      },
    });

    logger.info({ userId: user.id, email }, 'User logged in successfully');

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role as UserRole,
        regionalType: user.regional_type as RegionalType | undefined,
        masterType: user.master_type as MasterType | undefined,
        cityId: user.city_id,
        franchiseeId: user.franchisee_id,
        status: user.status as UserStatus,
      },
    };
  }

  /**
   * Refresh do token de acesso
   */
  async refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    // Verificar token
    const payload = this.verifyRefreshToken(refreshToken);

    // Buscar usuário e verificar se o refresh token corresponde
    const user = await prisma.appUser.findUnique({
      where: { id: payload.userId },
    });

    if (!user) {
      throw new UnauthorizedError('Usuário não encontrado');
    }

    if (user.refresh_token !== refreshToken) {
      throw new UnauthorizedError('Refresh token inválido');
    }

    if (user.refresh_token_expires_at && user.refresh_token_expires_at < new Date()) {
      throw new UnauthorizedError('Refresh token expirado');
    }

    // Gerar novos tokens
    const newTokenPayload: TokenPayload = {
      userId: user.id,
      email: user.email,
      role: user.role as UserRole,
      regionalType: user.regional_type as RegionalType | undefined,
      masterType: user.master_type as MasterType | undefined,
      cityId: user.city_id,
      franchiseeId: user.franchisee_id,
    };

    const newAccessToken = this.generateAccessToken(newTokenPayload);
    const newRefreshToken = this.generateRefreshToken(newTokenPayload);

    // Calcular expiração do novo refresh token
    const refreshExpiresAt = new Date();
    const days = parseInt(env.JWT_REFRESH_EXPIRES_IN.replace('d', '')) || 30;
    refreshExpiresAt.setDate(refreshExpiresAt.getDate() + days);

    // Atualizar refresh token no banco
    await prisma.appUser.update({
      where: { id: user.id },
      data: {
        refresh_token: newRefreshToken,
        refresh_token_expires_at: refreshExpiresAt,
      },
    });

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    };
  }

  /**
   * Logout do usuário
   */
  async logout(userId: string): Promise<void> {
    await prisma.appUser.update({
      where: { id: userId },
      data: {
        refresh_token: null,
        refresh_token_expires_at: null,
      },
    });

    logger.info({ userId }, 'User logged out');
  }

  /**
   * Obter dados do usuário atual
   */
  async getCurrentUser(userId: string) {
    const user = await prisma.appUser.findUnique({
      where: { id: userId },
      include: {
        city: {
          select: {
            id: true,
            name: true,
          },
        },
        franchisee: {
          select: {
            id: true,
            fantasy_name: true,
            company_name: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundError('Usuário não encontrado');
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      regionalType: user.regional_type,
      masterType: user.master_type,
      cityId: user.city_id,
      franchiseeId: user.franchisee_id,
      status: user.status,
      avatarUrl: user.avatar_url,
      city: user.city ? {
        id: user.city.id,
        name: user.city.name,
      } : null,
      franchisee: user.franchisee ? {
        id: user.franchisee.id,
        name: user.franchisee.fantasy_name || user.franchisee.company_name,
      } : null,
      createdAt: user.created_at,
      lastLogin: user.last_login,
    };
  }

  /**
   * Solicitar reset de senha
   */
  async requestPasswordReset(email: string): Promise<string> {
    const user = await prisma.appUser.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!user) {
      // Não revelar se o email existe ou não
      logger.warn({ email }, 'Password reset requested for non-existent email');
      return 'Se o email existir, você receberá instruções para redefinir sua senha.';
    }

    // Gerar token de reset
    const resetToken = nanoid(32);
    const resetExpires = new Date();
    resetExpires.setHours(resetExpires.getHours() + 2); // 2 horas de validade

    await prisma.appUser.update({
      where: { id: user.id },
      data: {
        password_reset_token: resetToken,
        password_reset_expires: resetExpires,
      },
    });

    logger.info({ userId: user.id, email }, 'Password reset token generated');

    // Aqui você integraria com serviço de email
    // Por enquanto, retornamos o token (em produção, enviar por email)
    return resetToken;
  }

  /**
   * Resetar senha com token
   */
  async resetPasswordWithToken(token: string, newPassword: string): Promise<void> {
    const user = await prisma.appUser.findFirst({
      where: {
        password_reset_token: token,
        password_reset_expires: {
          gt: new Date(),
        },
      },
    });

    if (!user) {
      throw new BadRequestError('Token de reset inválido ou expirado');
    }

    // Validar força da senha
    this.validatePasswordStrength(newPassword);

    // Hash da nova senha
    const passwordHash = await this.hashPassword(newPassword);

    await prisma.appUser.update({
      where: { id: user.id },
      data: {
        password_hash: passwordHash,
        password_reset_token: null,
        password_reset_expires: null,
        failed_login_attempts: 0,
        locked_until: null,
        status: 'active', // Ativar conta se estava pendente
      },
    });

    logger.info({ userId: user.id }, 'Password reset successfully');
  }

  /**
   * Alterar senha (usuário logado)
   */
  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await prisma.appUser.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundError('Usuário não encontrado');
    }

    if (!user.password_hash) {
      throw new BadRequestError('Senha atual não definida');
    }

    // Verificar senha atual
    const isValid = await this.verifyPassword(currentPassword, user.password_hash);
    if (!isValid) {
      throw new UnauthorizedError('Senha atual incorreta');
    }

    // Validar força da nova senha
    this.validatePasswordStrength(newPassword);

    // Hash da nova senha
    const passwordHash = await this.hashPassword(newPassword);

    await prisma.appUser.update({
      where: { id: userId },
      data: {
        password_hash: passwordHash,
      },
    });

    logger.info({ userId }, 'Password changed successfully');
  }

  /**
   * Reset de senha por admin
   */
  async adminResetPassword(adminUserId: string, targetUserId: string): Promise<string> {
    // Verificar se admin tem permissão
    const admin = await prisma.appUser.findUnique({
      where: { id: adminUserId },
    });

    if (!admin || !['master_br', 'admin'].includes(admin.role)) {
      throw new UnauthorizedError('Sem permissão para resetar senhas');
    }

    const targetUser = await prisma.appUser.findUnique({
      where: { id: targetUserId },
    });

    if (!targetUser) {
      throw new NotFoundError('Usuário não encontrado');
    }

    // Gerar senha temporária
    const tempPassword = this.generateTempPassword();
    const passwordHash = await this.hashPassword(tempPassword);

    await prisma.appUser.update({
      where: { id: targetUserId },
      data: {
        password_hash: passwordHash,
        status: 'pending', // Forçar troca de senha no próximo login
        failed_login_attempts: 0,
        locked_until: null,
      },
    });

    logger.info(
      { adminUserId, targetUserId },
      'Admin reset password for user'
    );

    return tempPassword;
  }

  /**
   * Incrementar tentativas de login falhas
   */
  private async incrementFailedAttempts(userId: string): Promise<void> {
    const user = await prisma.appUser.findUnique({
      where: { id: userId },
    });

    if (!user) return;

    const newAttempts = (user.failed_login_attempts || 0) + 1;
    const shouldLock = newAttempts >= MAX_LOGIN_ATTEMPTS;

    const lockUntil = shouldLock
      ? new Date(Date.now() + LOCK_DURATION_MINUTES * 60 * 1000)
      : null;

    await prisma.appUser.update({
      where: { id: userId },
      data: {
        failed_login_attempts: newAttempts,
        locked_until: lockUntil,
      },
    });

    if (shouldLock) {
      logger.warn({ userId }, 'Account locked due to too many failed attempts');
    }
  }

  /**
   * Validar força da senha
   */
  private validatePasswordStrength(password: string): void {
    if (password.length < 8) {
      throw new BadRequestError('A senha deve ter pelo menos 8 caracteres');
    }

    if (!/[A-Z]/.test(password)) {
      throw new BadRequestError('A senha deve conter pelo menos uma letra maiúscula');
    }

    if (!/[a-z]/.test(password)) {
      throw new BadRequestError('A senha deve conter pelo menos uma letra minúscula');
    }

    if (!/[0-9]/.test(password)) {
      throw new BadRequestError('A senha deve conter pelo menos um número');
    }
  }

  /**
   * Gerar senha temporária
   */
  private generateTempPassword(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let password = '';
    for (let i = 0; i < 12; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    // Garantir que tem maiúscula, minúscula e número
    return password.substring(0, 4).toUpperCase() +
           password.substring(4, 8).toLowerCase() +
           Math.floor(1000 + Math.random() * 9000);
  }

  /**
   * Registro de novo usuário (público - status pendente)
   */
  /**
   * Buscar franqueado por CNPJ (público - para login por CNPJ)
   */
  async findFranchiseeByCnpj(cnpj: string): Promise<any> {
    const cleanCnpj = cnpj.replace(/\D/g, '');

    const franchisee = await prisma.franchisee.findFirst({
      where: { cnpj: cleanCnpj },
      select: {
        id: true,
        cnpj: true,
        fantasy_name: true,
        company_name: true,
        email: true,
        city_id: true,
        user_id: true,
        status: true,
      },
    });

    if (!franchisee) {
      throw new NotFoundError('CNPJ não encontrado');
    }

    return franchisee;
  }

  /**
   * Setup de primeira senha para franqueado (criar usuário + vincular)
   */
  async franchiseeSetup(franchiseeId: string, email: string, password: string): Promise<AuthResult> {
    // Buscar franqueado
    const franchisee = await prisma.franchisee.findUnique({
      where: { id: franchiseeId },
    });

    if (!franchisee) {
      throw new NotFoundError('Franqueado não encontrado');
    }

    if (franchisee.user_id) {
      throw new ConflictError('Este franqueado já possui uma conta vinculada');
    }

    // Verificar se email já existe
    const existingUser = await prisma.appUser.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (existingUser) {
      throw new ConflictError('Este email já está cadastrado');
    }

    this.validatePasswordStrength(password);
    const passwordHash = await this.hashPassword(password);

    // Criar usuário e vincular ao franqueado em transação
    const user = await prisma.$transaction(async (tx) => {
      const newUser = await tx.appUser.create({
        data: {
          id: crypto.randomUUID(),
          email: email.toLowerCase(),
          password_hash: passwordHash,
          role: 'franchisee',
          status: 'active',
          city_id: franchisee.city_id,
          franchisee_id: franchisee.id,
        },
      });

      await tx.franchisee.update({
        where: { id: franchiseeId },
        data: {
          user_id: newUser.id,
          email: email.toLowerCase(),
        },
      });

      return newUser;
    });

    // Fazer login automático
    return this.login(email.toLowerCase(), password);
  }

  async register(email: string, password: string, name?: string): Promise<{ id: string; email: string }> {
    // Verificar se email já existe
    const existingUser = await prisma.appUser.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (existingUser) {
      throw new ConflictError('Este email já está cadastrado');
    }

    // Validar força da senha
    this.validatePasswordStrength(password);

    // Hash da senha
    const passwordHash = await this.hashPassword(password);

    // Criar usuário com status pendente (aguardando aprovação)
    const user = await prisma.appUser.create({
      data: {
        id: crypto.randomUUID(), // Gerar UUID manualmente
        email: email.toLowerCase(),
        name: name || null,
        password_hash: passwordHash,
        role: 'regional', // Role padrão - será definido pelo admin na aprovação
        status: 'pending', // Aguardando aprovação do admin
      },
    });

    logger.info({ userId: user.id, email }, 'New user registered (pending approval)');

    return {
      id: user.id,
      email: user.email,
    };
  }
}

export const authService = new AuthService();

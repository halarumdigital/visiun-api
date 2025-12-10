import { TokenPayload, AuthContext } from './index.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: TokenPayload;
    authContext?: AuthContext;
  }
}

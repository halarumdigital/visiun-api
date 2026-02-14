# CLAUDE.md

This file provides guidance to Claude Code when working with the Master Brasil API backend.

## Project Overview

**City Scope CRM API** - Backend para sistema de gestao de franquias Master Brasil (locacao de motos).
Controle de acesso multi-nivel (Master BR, Admin, Regional, Franqueado) com isolamento de dados por regiao.

## Technology Stack

- **Framework**: Fastify 4.28 + TypeScript
- **ORM**: Prisma 5.22 (PostgreSQL)
- **Auth**: JWT + bcrypt (5 rounds)
- **Realtime**: Socket.io 4.8
- **Storage**: Cloudflare R2 (S3-compatible)
- **Validation**: Zod
- **Monitoring**: Sentry
- **PDF**: PDFKit
- **Email**: Nodemailer

## Development Commands

```bash
npm run dev              # Start dev server with hot-reload (tsx watch)
npm run build            # Compile TypeScript
npm start                # Run compiled build
npm run lint             # ESLint
npm test                 # Vitest
npm run prisma:generate  # Generate Prisma Client
npm run prisma:migrate   # Run migrations
npm run prisma:push      # Push schema to DB
npm run prisma:studio    # Visual DB interface
npm run prisma:introspect # Pull schema from DB
```

## Key Architecture Patterns

### Authentication & Authorization
- JWT Bearer Token via `Authorization` header
- API Key required via `X-API-Key` header (all requests)
- Role hierarchy: `master_br` > `admin` > `regional` > `franchisee`

### Route Pattern
Every protected route MUST use both middlewares in preHandler:
```typescript
preHandler: [authMiddleware, rbac()]
```
- `authMiddleware` validates JWT and injects `request.user`
- `rbac()` validates role and creates `AuthContext` with helper methods
- Without `rbac()`, `getContext(request)` throws "AuthContext nao disponivel"

### Data Access Pattern
- `getContext(request)` returns the AuthContext with user info and city filtering
- RLS-like filtering: regional users see only their city's data, franchisees only their own data
- Master BR and Admin have system-wide access

### Response Format
```typescript
// Success
{ success: true, data: {...}, total?: number, page?: number, limit?: number }

// Error
{ success: false, error: "message", code: "ERROR_CODE" }
```

### Error Handling
- `AppError` - Operational errors (4xx) with `isOperational: true`
- `ValidationError` - Zod validation errors (422)
- Fastify validation errors return 400
- Unknown errors return 500 (with Sentry capture in production)

## File Structure

```
src/
├── app.ts                  # Fastify setup (plugins, routes, error handler)
├── index.ts                # Entry point (Sentry, DB, WebSocket, graceful shutdown)
├── config/
│   ├── database.ts         # Prisma Client & connection
│   └── env.ts              # Environment validation (Zod schema)
├── middleware/
│   ├── auth.ts             # JWT auth (authMiddleware, optionalAuthMiddleware)
│   ├── rbac.ts             # Role-Based Access Control
│   ├── apiKey.ts           # API Key validation (X-API-Key header)
│   ├── audit.ts            # Audit logging service
│   └── rateLimit.ts        # Rate limiting (login: 5 attempts, password reset)
├── routes/                 # 41 route files (see README.md for full endpoint list)
├── services/               # Business logic & external integrations
├── utils/
│   ├── errors.ts           # AppError, ValidationError classes
│   ├── logger.ts           # Pino logger
│   └── context.ts          # AuthContext helper (getContext)
├── types/                  # TypeScript types & interfaces
└── websocket/              # Socket.io realtime events
```

## Database (Prisma)

### Important Notes
- Schema fields MUST match DB nullability. If DB allows null, use `String?` not `String`. Otherwise Prisma throws P2032 error.
- Maintenance data is in `ordens_servico` table, NOT `manutencoes`. Prisma model: `OrdemServico` with `@@map("ordens_servico")`.
- Always run `npm run prisma:generate` after schema changes.

### Core Models
- `AppUser` - Users with roles and permissions
- `City` - Geographic regions
- `Franchisee` - Franchise partners (linked to cities)
- `Motorcycle` - Fleet vehicles (linked to franchisees)
- `MotorcycleModel` - Brand/model catalog
- `Client` - Customers
- `ClientDriver` - Additional drivers
- `Rental` - Rental contracts
- `RentalPlan` - Pricing plans
- `GeneratedContract` - Generated contracts from templates
- `ContractTemplate` - Contract templates with `{{variable}}` syntax
- `Distrato` - Rental terminations
- `Vistoria` - Inspection records (entrada/saida/periodica)
- `Financeiro` - Financial entries (entrada/saida)
- `LancamentoRecorrente` - Recurring transactions
- `Categoria` - Financial categories
- `OrdemServico` - Maintenance/service orders
- `Oficina` - Workshops
- `Profissional` - Service professionals
- `Peca` - Parts/inventory
- `Servico` - Services catalog
- `Rastreador` - GPS trackers
- `Venda` - Sales records

### Key Enums
- `UserRole`: master_br, admin, regional, franchisee
- `UserStatus`: active, blocked, inactive, pending
- `MotorcycleStatus`: active, alugada, relocada, manutencao, recolhida, indisponivel_rastreador, indisponivel_emplacamento, inadimplente, renegociado, furto_roubo
- `RentalStatus`: active, completed, cancelled, paused
- `ContractStatus`: draft, generated, sent, signed, cancelled
- `FinanceiroTipo`: entrada, saida
- `VistoriaType`: entrada, saida, periodica

## WebSocket Events

Rooms: `user:{id}`, `franchisee:{id}`, `city:{id}`, `admin`

Events: `financeiro:change`, `rental:change`, `motorcycle:change`, `maintenance:change`, `contract:change`, `notification`, `rastreadores:change`

## Common Pitfalls

1. **Missing rbac()**: Routes with only `authMiddleware` will crash on `getContext(request)`. Always add `rbac()`.
2. **Zod query validation**: `z.coerce.number().max(100)` silently rejects values > 100 as BadRequest.
3. **Prisma nullability**: P2032 errors mean a schema field doesn't match DB nullability.
4. **Date filtering**: `data_previsao` is `timestamp with time zone`. Use `T00:00:00.000Z` to `T23:59:59.999Z` for full-day range.
5. **Body limit**: Set to 15MB in Fastify config. Larger uploads will fail.

## External Integrations

- **PlugSign / BeSign**: Digital signature APIs (proxy via `/api/integrations`)
- **Beemon**: Traffic fine management (`/api/multas`)
- **ASAAS**: Payment gateway / boleto generation (`/api/asaas-payments`)
- **Evolution API**: WhatsApp integration for AI scheduling (`/api/ia-agendamento`)
- **Cloudflare R2**: File storage (S3-compatible)
- **Sentry**: Error tracking and monitoring

## Configuration

Server config is in `src/config/env.ts` with Zod validation. The server fails to start if required env vars are missing.

Key defaults:
- Port: 3000
- Host: 0.0.0.0
- JWT expiration: 7d (access), 30d (refresh)
- Rate limit: 100 req / 60s window
- Body limit: 15MB
- CORS: configurable multiple origins via `FRONTEND_URL` (comma-separated)

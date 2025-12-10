# Master Brasil API

Backend API para o sistema City Scope CRM - Master Brasil.

## Stack Tecnológico

- **Framework**: Fastify
- **ORM**: Prisma
- **Banco de Dados**: PostgreSQL
- **Autenticação**: JWT + bcrypt
- **Storage**: Cloudflare R2 (S3-compatible)
- **Realtime**: Socket.io
- **Linguagem**: TypeScript

## Pré-requisitos

- Node.js 18+
- PostgreSQL 15+
- Cloudflare R2 (para storage)

## Instalação

```bash
# Instalar dependências
npm install

# Gerar cliente Prisma
npm run prisma:generate

# Sincronizar schema com banco existente (opcional)
npm run prisma:introspect
```

## Configuração

Copie o arquivo `.env.example` para `.env` e configure as variáveis:

```bash
cp .env.example .env
```

### Variáveis Obrigatórias

```env
# Database
DATABASE_URL=postgresql://user:password@host:5432/database

# JWT (gere chaves seguras para produção!)
JWT_SECRET=sua-chave-secreta-de-256-bits
JWT_REFRESH_SECRET=outra-chave-secreta-de-256-bits

# Cloudflare R2
R2_ACCOUNT_ID=seu-account-id
R2_ACCESS_KEY_ID=sua-access-key
R2_SECRET_ACCESS_KEY=sua-secret-key
R2_BUCKET_NAME=seu-bucket
R2_PUBLIC_URL=https://seu-bucket.r2.dev
```

## Desenvolvimento

```bash
# Iniciar em modo desenvolvimento (com hot reload)
npm run dev

# Build para produção
npm run build

# Iniciar em produção
npm start
```

## Migração de Senhas

Para migrar usuários existentes (gerar senhas temporárias):

```bash
# Migrar todos os usuários sem senha
npm run migrate:passwords

# Resetar senha de um usuário específico
npm run migrate:passwords -- --user email@exemplo.com
```

O script gera um arquivo CSV em `scripts/output/` com as senhas temporárias.

## Estrutura do Projeto

```
src/
├── config/          # Configurações (database, env)
├── middleware/      # Middlewares (auth, rbac, rate-limit)
├── routes/          # Rotas da API
│   ├── auth.ts      # /api/auth/*
│   ├── users.ts     # /api/users/*
│   ├── rentals.ts   # /api/rentals/*
│   ├── motorcycles.ts # /api/motorcycles/*
│   ├── financeiro.ts  # /api/financeiro/*
│   ├── upload.ts    # /api/upload/*
│   ├── webhooks.ts  # /api/webhooks/*
│   └── integrations/ # /api/integrations/*
├── services/        # Serviços de negócio
├── utils/           # Utilitários
├── types/           # Tipos TypeScript
├── websocket/       # Configuração Socket.io
├── app.ts           # Configuração do Fastify
└── index.ts         # Entry point
```

## API Endpoints

### Autenticação (`/api/auth`)

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| POST | `/login` | Login |
| POST | `/logout` | Logout |
| POST | `/refresh` | Refresh token |
| GET | `/me` | Dados do usuário atual |
| POST | `/request-reset` | Solicitar reset de senha |
| POST | `/reset-password` | Resetar senha com token |
| POST | `/change-password` | Alterar senha |

### Usuários (`/api/users`)

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| GET | `/` | Listar usuários |
| GET | `/:id` | Obter usuário |
| POST | `/` | Criar usuário |
| PUT | `/:id` | Atualizar usuário |
| DELETE | `/:id` | Desativar usuário |
| POST | `/:id/reset-password` | Reset de senha por admin |
| PATCH | `/:id/status` | Alterar status |

### Locações (`/api/rentals`)

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| GET | `/` | Listar locações |
| GET | `/:id` | Obter locação |
| POST | `/` | Criar locação |
| PUT | `/:id` | Atualizar locação |
| POST | `/:id/complete` | Finalizar locação |
| POST | `/:id/cancel` | Cancelar locação |
| GET | `/stats` | Estatísticas |

### Motocicletas (`/api/motorcycles`)

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| GET | `/` | Listar motos |
| GET | `/:id` | Obter moto |
| POST | `/` | Criar moto |
| PUT | `/:id` | Atualizar moto |
| PATCH | `/:id/status` | Alterar status |
| GET | `/:id/movements` | Histórico de movimentações |
| GET | `/stats` | Estatísticas da frota |
| GET | `/available` | Motos disponíveis |

### Financeiro (`/api/financeiro`)

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| GET | `/` | Listar lançamentos |
| GET | `/:id` | Obter lançamento |
| POST | `/` | Criar lançamento |
| PUT | `/:id` | Atualizar lançamento |
| DELETE | `/:id` | Deletar lançamento |
| PATCH | `/:id/pago` | Marcar pago/não pago |
| GET | `/summary` | Resumo financeiro |
| GET | `/categorias` | Listar categorias |

### Upload (`/api/upload`)

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| POST | `/` | Upload arquivo |
| POST | `/multiple` | Upload múltiplos |
| POST | `/presigned` | Obter URL presigned |
| GET | `/download/*` | Download com URL assinada |
| DELETE | `/*` | Deletar arquivo |

### Webhooks (`/api/webhooks`)

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| POST | `/signature` | Webhook assinaturas |
| POST | `/evolution` | Webhook WhatsApp |

### Integrações (`/api/integrations`)

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| ALL | `/plugsign/*` | Proxy PlugSign |
| ALL | `/besign/*` | Proxy BeSign |
| GET | `/plugsign-download/:key` | Download documento assinado |
| GET | `/document-status/:key` | Status do documento |

## WebSocket (Socket.io)

### Eventos Emitidos pelo Servidor

- `financeiro:change` - Mudanças em lançamentos financeiros
- `rental:change` - Mudanças em locações
- `motorcycle:change` - Mudanças em motocicletas
- `maintenance:change` - Mudanças em manutenções
- `contract:change` - Mudanças em contratos
- `notification` - Notificações para usuário
- `rastreadores:change` - Mudanças em rastreadores

### Rooms

Usuários são automaticamente adicionados às rooms baseado em seu role:
- `user:{userId}` - Room pessoal
- `franchisee:{franchiseeId}` - Room do franqueado
- `city:{cityId}` - Room da cidade
- `admin` - Room de administradores

## Roles e Permissões

| Role | Descrição | Acesso |
|------|-----------|--------|
| `master_br` | Master Brasil | Total |
| `admin` | Administrador | Gerenciamento geral |
| `regional` | Regional | Dados da cidade |
| `franchisee` | Franqueado | Dados próprios |

## Documentação da API

A documentação Swagger/OpenAPI está disponível em `/docs` quando o servidor está rodando.

## Scripts Úteis

```bash
# Prisma
npm run prisma:generate  # Gerar cliente
npm run prisma:migrate   # Rodar migrations
npm run prisma:push      # Push schema para DB
npm run prisma:studio    # Abrir Prisma Studio
npm run prisma:introspect # Pull schema do DB

# Desenvolvimento
npm run dev              # Dev com hot reload
npm run build            # Build produção
npm run start            # Iniciar produção
npm run lint             # Linting

# Testes
npm run test             # Rodar testes
npm run test:coverage    # Cobertura de testes
```

## Segurança

- Todas as rotas (exceto login e webhooks) requerem autenticação JWT
- Rate limiting configurado por padrão
- CORS configurado para frontend específico
- Senhas hasheadas com bcrypt (12 rounds)
- Refresh tokens armazenados no banco
- Bloqueio de conta após 5 tentativas falhas

## Licença

Proprietary - Master Brasil

# City Scope CRM API - Master Brasil

API Backend para o sistema de gestao de franquias **Master Brasil**, construida com Fastify, Prisma e PostgreSQL.

## Stack Tecnologico

| Tecnologia | Versao | Funcao |
|---|---|---|
| Fastify | 4.28.1 | Framework HTTP |
| Prisma | 5.22.0 | ORM / Database |
| PostgreSQL | - | Banco de dados |
| Socket.io | 4.8.1 | WebSocket / Realtime |
| Zod | 3.23.8 | Validacao de schemas |
| JWT + bcrypt | - | Autenticacao |
| Cloudflare R2 | - | Armazenamento de arquivos (S3-compatible) |
| Sentry | 10.38.0 | Monitoramento de erros |
| PDFKit | 0.17.2 | Geracao de PDFs |
| Nodemailer | 8.0.1 | Envio de emails |
| Axios | 1.13.2 | HTTP client para integracoes |

## Pre-requisitos

- Node.js >= 18.0.0
- PostgreSQL 15+
- Cloudflare R2 (para storage)

## Instalacao

```bash
# Instalar dependencias
npm install

# Gerar client Prisma
npm run prisma:generate

# Copiar .env.example para .env e configurar
cp .env.example .env
```

## Comandos

```bash
# Desenvolvimento
npm run dev                    # Servidor com hot-reload (tsx watch)

# Build
npm run build                  # Compilar TypeScript
npm start                      # Iniciar build compilado

# Prisma
npm run prisma:generate        # Gerar Prisma Client
npm run prisma:migrate         # Executar migracoes
npm run prisma:push            # Push schema para DB
npm run prisma:studio          # Interface visual do banco
npm run prisma:introspect      # Introspeccao do banco

# Qualidade
npm run lint                   # ESLint
npm test                       # Vitest
npm run test:coverage          # Testes com cobertura

# Scripts de Migracao
npm run migrate:passwords      # Migrar senhas (gera CSV em scripts/output/)
npm run migrate:motorcycle-models  # Migrar modelos de motos
```

## Variaveis de Ambiente

### Obrigatorias

| Variavel | Descricao |
|---|---|
| `DATABASE_URL` | URL de conexao PostgreSQL |
| `JWT_SECRET` | Chave JWT (min 32 chars) |
| `JWT_REFRESH_SECRET` | Chave refresh token (min 32 chars) |
| `API_KEY` | Chave de acesso a API (min 32 chars, header `X-API-Key`) |
| `R2_ACCOUNT_ID` | Cloudflare R2 Account ID |
| `R2_ACCESS_KEY_ID` | Cloudflare R2 Access Key |
| `R2_SECRET_ACCESS_KEY` | Cloudflare R2 Secret Key |
| `R2_BUCKET_NAME` | Nome do bucket R2 |
| `R2_PUBLIC_URL` | URL publica do bucket R2 |

### Opcionais

| Variavel | Default | Descricao |
|---|---|---|
| `PORT` | `3000` | Porta do servidor |
| `HOST` | `0.0.0.0` | Host do servidor |
| `NODE_ENV` | `development` | Ambiente (development/production/test) |
| `FRONTEND_URL` | `http://localhost:5000` | URLs CORS (separadas por virgula) |
| `JWT_EXPIRES_IN` | `7d` | Expiracao do access token |
| `JWT_REFRESH_EXPIRES_IN` | `30d` | Expiracao do refresh token |
| `RATE_LIMIT_MAX` | `100` | Max requisicoes por janela |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Janela de rate limit (ms) |
| `BESIGN_API_URL` | - | URL da API BeSign |
| `BESIGN_API_KEY` | - | Chave da API BeSign |
| `PLUGSIGN_API_URL` | - | URL da API PlugSign |
| `PLUGSIGN_API_KEY` | - | Chave da API PlugSign |
| `WEBHOOK_SECRET` | - | Secret para webhooks |
| `BEEMON_API_URL` | - | URL da API Beemon (multas) |
| `BEEMON_USERNAME` | - | Usuario Beemon |
| `BEEMON_PASSWORD` | - | Senha Beemon |
| `ASAAS_API_URL` | - | URL da API Asaas (pagamentos) |
| `ASAAS_API_KEY` | - | Chave da API Asaas |
| `VITE_SYSTEM_BASE_URL` | - | URL base do sistema (para links em emails) |
| `SENTRY_DSN` | - | DSN do Sentry |

## Estrutura do Projeto

```
src/
├── app.ts                     # Configuracao Fastify (plugins, rotas, error handler)
├── index.ts                   # Entry point (Sentry, DB, WebSocket, graceful shutdown)
├── config/
│   ├── database.ts            # Prisma Client e conexao
│   └── env.ts                 # Validacao de variaveis de ambiente (Zod)
├── middleware/
│   ├── auth.ts                # Autenticacao JWT (authMiddleware, optionalAuth)
│   ├── rbac.ts                # Controle de acesso por role (rbac())
│   ├── apiKey.ts              # Validacao de API Key (header X-API-Key)
│   ├── audit.ts               # Auditoria de acoes
│   └── rateLimit.ts           # Rate limiting (login: 5 tentativas, password reset)
├── routes/                    # 41 arquivos de rotas (ver tabelas abaixo)
│   ├── auth.ts                # /api/auth/*
│   ├── users.ts               # /api/users/*
│   ├── rentals.ts             # /api/rentals/*
│   ├── rental-secondary-vehicles.ts  # /api/rentals/*/secondary-vehicles
│   ├── motorcycles.ts         # /api/motorcycles/*
│   ├── motorcycle-models.ts   # /api/motorcycle-models/*
│   ├── cities.ts              # /api/cities/*
│   ├── franchisees.ts         # /api/franchisees/*
│   ├── clients.ts             # /api/clients/*
│   ├── drivers.ts             # /api/drivers/*
│   ├── contracts.ts           # /api/contracts/*
│   ├── templates.ts           # /api/templates/*
│   ├── rental-plans.ts        # /api/rental-plans/*
│   ├── vistorias.ts           # /api/vistorias/*
│   ├── distratos.ts           # /api/distratos/*
│   ├── financeiro.ts          # /api/financeiro/*
│   ├── recorrentes.ts         # /api/financeiro/recorrentes/*
│   ├── manutencoes.ts         # /api/manutencoes/*
│   ├── oficinas.ts            # /api/oficinas/*
│   ├── servicos.ts            # /api/servicos/*
│   ├── pecas.ts               # /api/pecas/*
│   ├── profissionais.ts       # /api/profissionais/*
│   ├── estoque.ts             # /api/estoque/*
│   ├── rastreadores.ts        # /api/rastreadores/*
│   ├── vendas.ts              # /api/vendas/*
│   ├── satisfaction-surveys.ts # /api/satisfaction-surveys/*
│   ├── campaign-surveys.ts    # /api/campaign-surveys/*
│   ├── suggestions.ts         # /api/suggestions/*
│   ├── role-permissions.ts    # /api/role-permissions/*
│   ├── screens.ts             # /api/screens/*
│   ├── asaas-config.ts        # /api/asaas-config/*
│   ├── asaas-payments.ts      # /api/asaas-payments/*
│   ├── smtp-config.ts         # /api/smtp-config/*
│   ├── audit-logs.ts          # /api/audit-logs/*
│   ├── multas.ts              # /api/multas/*
│   ├── marketplace.ts         # /api/marketplace/*
│   ├── dashboard.ts           # /api/dashboard/*
│   ├── ia-agendamento.ts      # /api/ia-agendamento/*
│   ├── upload.ts              # /api/upload/*
│   ├── webhooks.ts            # /api/webhooks/*
│   └── integrations/index.ts  # /api/integrations/*
├── services/                  # Logica de negocio e integracoes
├── utils/
│   ├── errors.ts              # Classes de erro (AppError, ValidationError)
│   ├── logger.ts              # Logger Pino
│   └── context.ts             # Helper de contexto do usuario
├── types/                     # Types e interfaces TypeScript
└── websocket/                 # Socket.io realtime events
```

## Seguranca

### Autenticacao
- JWT Bearer Token no header `Authorization: Bearer <token>`
- API Key obrigatoria no header `X-API-Key` (todas as requisicoes)
- Rate limiting global + especifico para login (5 tentativas)
- Senhas hasheadas com bcrypt (5 rounds)
- Refresh tokens armazenados no banco

### Hierarquia de Roles
```
master_br > admin > regional > franchisee
```

### Middleware Pipeline
Toda rota protegida usa:
```typescript
preHandler: [authMiddleware, rbac()]
```
- `authMiddleware` - Valida JWT e injeta `request.user`
- `rbac()` - Valida role e cria `AuthContext` com helpers

## Documentacao Interativa

Com o servidor rodando, acesse:
- **Swagger UI**: `http://localhost:PORT/docs`
- **API Info**: `http://localhost:PORT/api`
- **Health Check**: `http://localhost:PORT/health`

---

## Endpoints da API

### Globais

| Metodo | Rota | Descricao |
|---|---|---|
| `GET` | `/health` | Health check (status, timestamp, environment) |
| `GET` | `/api` | Info da API (nome, versao, link docs) |

### Autenticacao (`/api/auth`)

| Metodo | Rota | Auth | Descricao |
|---|---|---|---|
| `POST` | `/register` | Nao | Registrar novo usuario (aguarda aprovacao) |
| `POST` | `/login` | Nao | Login (retorna access + refresh token) |
| `POST` | `/refresh` | Nao | Renovar access token |
| `POST` | `/logout` | Sim | Logout (invalida refresh token) |
| `GET` | `/me` | Sim | Dados do usuario autenticado |
| `POST` | `/request-reset` | Nao | Solicitar reset de senha |
| `POST` | `/reset-password` | Nao | Resetar senha com token |
| `POST` | `/login-cnpj` | Nao | Buscar franqueado por CNPJ |
| `POST` | `/franchisee-setup` | Nao | Criar conta de franqueado (primeiro acesso) |
| `POST` | `/change-password` | Sim | Alterar senha |

### Usuarios (`/api/users`)

| Metodo | Rota | Auth | Descricao |
|---|---|---|---|
| `GET` | `/` | Sim | Listar usuarios (paginado, com filtros) |
| `GET` | `/:id` | Sim | Buscar usuario por ID |
| `GET` | `/attendants` | Sim | Listar atendentes por cidade |
| `POST` | `/` | Sim | Criar usuario (admin+) |
| `PUT` | `/:id` | Sim | Atualizar usuario |
| `DELETE` | `/:id` | Sim | Excluir usuario |
| `POST` | `/:id/reset-password` | Sim | Reset de senha (admin) |
| `POST` | `/:id/set-password` | Sim | Definir senha especifica (admin) |
| `PATCH` | `/:id/status` | Sim | Alterar status do usuario |
| `GET` | `/:id/permissions` | Sim | Buscar permissoes de menu |
| `PUT` | `/:id/permissions` | Sim | Atualizar permissoes de menu |

### Locacoes (`/api/rentals`)

| Metodo | Rota | Auth | Descricao |
|---|---|---|---|
| `GET` | `/` | Sim | Listar locacoes (paginado, com filtros) |
| `GET` | `/all` | Sim | Listar todas (sem paginacao, para dashboard) |
| `GET` | `/stats` | Sim | Estatisticas de locacoes |
| `GET` | `/:id` | Sim | Buscar locacao por ID |
| `POST` | `/` | Sim | Criar locacao |
| `PUT` | `/:id` | Sim | Atualizar locacao |
| `DELETE` | `/:id` | Sim | Excluir locacao |
| `POST` | `/:id/complete` | Sim | Finalizar locacao |
| `POST` | `/:id/cancel` | Sim | Cancelar locacao (admin+) |

### Veiculos Secundarios (`/api/rentals/.../secondary-vehicles`)

| Metodo | Rota | Auth | Descricao |
|---|---|---|---|
| `GET` | `/with-active-addendum` | Sim | Locacoes com veiculos secundarios ativos |
| `GET` | `/:rentalId/secondary-vehicles` | Sim | Listar veiculos secundarios |
| `GET` | `/:rentalId/secondary-vehicles/available-motorcycles` | Sim | Motos disponiveis |
| `GET` | `/:rentalId/secondary-vehicles/:id` | Sim | Buscar veiculo secundario |
| `GET` | `/:rentalId/secondary-vehicles/:id/view-term` | Sim | Visualizar termo PDF |
| `GET` | `/:rentalId/secondary-vehicles/:id/download-signed` | Sim | Download documento assinado |
| `POST` | `/:rentalId/secondary-vehicles` | Sim | Criar veiculo secundario |
| `POST` | `/:rentalId/secondary-vehicles/:id/complete` | Sim | Finalizar |
| `POST` | `/:rentalId/secondary-vehicles/:id/cancel` | Sim | Cancelar |
| `POST` | `/:rentalId/secondary-vehicles/:id/generate-pdf` | Sim | Gerar PDF |
| `POST` | `/:rentalId/secondary-vehicles/:id/send-for-signature` | Sim | Enviar para assinatura |
| `PUT` | `/:rentalId/secondary-vehicles/:id/termo-url` | Sim | Atualizar URL do termo |
| `PUT` | `/:rentalId/secondary-vehicles/:id/signature-status` | Sim | Atualizar status assinatura |

### Motos (`/api/motorcycles`)

| Metodo | Rota | Auth | Descricao |
|---|---|---|---|
| `GET` | `/` | Sim | Listar motos (paginado) |
| `GET` | `/models` | Sim | Listar modelos distintos |
| `GET` | `/available` | Sim | Motos disponiveis para locacao |
| `GET` | `/all` | Sim | Listar todas (sem paginacao) |
| `GET` | `/consolidated` | Sim | Motos consolidadas (ultima por placa) |
| `GET` | `/stats` | Sim | Estatisticas da frota |
| `GET` | `/by-plate/:placa` | Sim | Buscar moto por placa |
| `GET` | `/:id` | Sim | Buscar moto por ID |
| `POST` | `/` | Sim | Criar moto |
| `POST` | `/batch` | Sim | Importacao em lote (CSV) |
| `PUT` | `/:id` | Sim | Atualizar moto |
| `PATCH` | `/:id/status` | Sim | Alterar status da moto |
| `DELETE` | `/:id` | Sim | Excluir moto |
| `DELETE` | `/batch` | Sim | Exclusao em lote |
| `DELETE` | `/by-period` | Sim | Excluir por periodo |

### Modelos de Motos (`/api/motorcycle-models`)

| Metodo | Rota | Auth | Descricao |
|---|---|---|---|
| `GET` | `/` | Sim | Listar modelos |
| `GET` | `/brands` | Sim | Listar marcas |
| `GET` | `/:id` | Sim | Buscar modelo por ID |
| `POST` | `/` | Sim | Criar modelo |
| `PUT` | `/:id` | Sim | Atualizar modelo |
| `DELETE` | `/:id` | Sim | Excluir modelo |

### Cidades (`/api/cities`)

| Metodo | Rota | Auth | Descricao |
|---|---|---|---|
| `GET` | `/` | Sim | Listar cidades |
| `GET` | `/plugsign-token` | Sim | Token PlugSign por contexto |
| `GET` | `/:id` | Sim | Buscar cidade por ID |
| `POST` | `/` | Sim | Criar cidade (admin+) |
| `PUT` | `/:id` | Sim | Atualizar cidade (admin+) |
| `DELETE` | `/:id` | Sim | Excluir cidade (admin+) |

### Franqueados (`/api/franchisees`)

| Metodo | Rota | Auth | Descricao |
|---|---|---|---|
| `GET` | `/` | Sim | Listar franqueados |
| `GET` | `/:id` | Sim | Buscar franqueado por ID |
| `GET` | `/:id/motorcycle-count` | Sim | Contagem de motos do franqueado |
| `POST` | `/` | Sim | Criar franqueado |
| `POST` | `/batch` | Sim | Criacao em lote |
| `PUT` | `/:id` | Sim | Atualizar franqueado |
| `DELETE` | `/:id` | Sim | Excluir franqueado |

### Clientes (`/api/clients`)

| Metodo | Rota | Auth | Descricao |
|---|---|---|---|
| `GET` | `/` | Sim | Listar clientes |
| `GET` | `/:id` | Sim | Buscar cliente por ID |
| `GET` | `/by-document/:document` | Sim | Buscar por CPF/CNPJ |
| `POST` | `/` | Sim | Criar cliente |
| `PUT` | `/:id` | Sim | Atualizar cliente |
| `DELETE` | `/:id` | Sim | Excluir cliente |

### Motoristas (`/api/drivers`)

| Metodo | Rota | Auth | Descricao |
|---|---|---|---|
| `GET` | `/` | Sim | Listar motoristas |
| `GET` | `/:id` | Sim | Buscar motorista por ID |
| `POST` | `/` | Sim | Criar motorista |
| `PUT` | `/:id` | Sim | Atualizar motorista |
| `DELETE` | `/:id` | Sim | Excluir motorista |

### Contratos (`/api/contracts`)

| Metodo | Rota | Auth | Descricao |
|---|---|---|---|
| `GET` | `/` | Sim | Listar contratos |
| `GET` | `/:id` | Sim | Buscar contrato por ID |
| `GET` | `/check-existing` | Sim | Verificar contrato existente |
| `GET` | `/by-rental/:rentalId` | Sim | Contratos da locacao |
| `POST` | `/generate` | Sim | Gerar contrato a partir de template |
| `PATCH` | `/:id` | Sim | Atualizar contrato |
| `DELETE` | `/:id` | Sim | Excluir contrato |

### Templates de Contrato (`/api/templates`)

| Metodo | Rota | Auth | Descricao |
|---|---|---|---|
| `GET` | `/types` | Sim | Listar tipos de contrato |
| `GET` | `/` | Sim | Listar templates |
| `GET` | `/:id` | Sim | Buscar template por ID |
| `GET` | `/by-name/:name` | Sim | Buscar por nome |
| `GET` | `/search/:query` | Sim | Pesquisar templates |
| `POST` | `/` | Sim | Criar template |
| `POST` | `/:id/clauses` | Sim | Adicionar clausulas |

### Planos de Locacao (`/api/rental-plans`)

| Metodo | Rota | Auth | Descricao |
|---|---|---|---|
| `GET` | `/` | Sim | Listar planos disponiveis |

### Vistorias (`/api/vistorias`)

Endpoints para vistorias de entrada, saida e periodicas nas motos.

### Distratos (`/api/distratos`)

| Metodo | Rota | Auth | Descricao |
|---|---|---|---|
| `GET` | `/` | Sim | Listar distratos |
| `GET` | `/:id` | Sim | Buscar distrato por ID |
| `GET` | `/:id/view` | Sim | Visualizar documento |
| `GET` | `/:id/download-signed` | Sim | Download documento assinado |
| `POST` | `/` | Sim | Criar distrato |
| `POST` | `/generate-term` | Sim | Gerar termo de distrato |
| `POST` | `/:id/generate-term` | Sim | Gerar termo especifico |
| `POST` | `/:id/send-for-signature` | Sim | Enviar para assinatura digital |
| `PUT` | `/:id` | Sim | Atualizar distrato |
| `DELETE` | `/:id` | Sim | Excluir distrato |

### Financeiro (`/api/financeiro`)

| Metodo | Rota | Auth | Descricao |
|---|---|---|---|
| `GET` | `/` | Sim | Listar lancamentos (paginado) |
| `GET` | `/all` | Sim | Listar todos (sem paginacao) |
| `GET` | `/summary` | Sim | Resumo financeiro |
| `GET` | `/expenses` | Sim | Listar despesas |
| `GET` | `/categorias` | Sim | Listar categorias |
| `GET` | `/:id` | Sim | Buscar lancamento por ID |
| `POST` | `/` | Sim | Criar lancamento |
| `POST` | `/expenses` | Sim | Criar despesa |
| `PUT` | `/:id` | Sim | Atualizar lancamento |
| `DELETE` | `/:id` | Sim | Excluir lancamento |
| `PATCH` | `/:id/pago` | Sim | Marcar como pago/nao pago |

### Lancamentos Recorrentes (`/api/financeiro/recorrentes`)

| Metodo | Rota | Auth | Descricao |
|---|---|---|---|
| `GET` | `/` | Sim | Listar recorrentes |
| `GET` | `/:id` | Sim | Buscar recorrente por ID |
| `POST` | `/` | Sim | Criar recorrente |
| `POST` | `/:id/gerar` | Sim | Gerar lancamento avulso |
| `POST` | `/gerar-todos` | Sim | Gerar todos pendentes |
| `PUT` | `/:id` | Sim | Atualizar recorrente |
| `DELETE` | `/:id` | Sim | Excluir recorrente |
| `PATCH` | `/:id/toggle` | Sim | Ativar/desativar |
| `DELETE` | `/:id/lancamentos` | Sim | Excluir lancamentos gerados |
| `DELETE` | `/:id/lancamentos-futuros` | Sim | Excluir lancamentos futuros |
| `PUT` | `/:id/lancamentos-futuros` | Sim | Atualizar lancamentos futuros |

### Manutencoes / Ordens de Servico (`/api/manutencoes`)

| Metodo | Rota | Auth | Descricao |
|---|---|---|---|
| `GET` | `/` | Sim | Listar ordens de servico |
| `GET` | `/:id` | Sim | Buscar OS por ID |
| `GET` | `/:id/servicos` | Sim | Servicos da OS |
| `GET` | `/:id/pecas` | Sim | Pecas da OS |
| `GET` | `/oficinas` | Sim | Listar oficinas |
| `GET` | `/servicos-catalogo` | Sim | Catalogo de servicos |
| `GET` | `/pecas-catalogo` | Sim | Catalogo de pecas |
| `GET` | `/sugestoes-pendentes` | Sim | Sugestoes pendentes (IA) |
| `GET` | `/sugestoes-pendentes/count` | Sim | Contagem de sugestoes pendentes |
| `POST` | `/` | Sim | Criar OS |
| `POST` | `/kpi/custo-pecas` | Sim | KPI custo de pecas |
| `POST` | `/:id/aceitar` | Sim | Aceitar sugestao da IA |
| `POST` | `/:id/recusar` | Sim | Recusar sugestao da IA |
| `POST` | `/converter-agendamento` | Sim | Converter agendamento em OS |
| `PUT` | `/:id` | Sim | Atualizar OS |
| `PUT` | `/agendamento/:id` | Sim | Atualizar agendamento |
| `DELETE` | `/:id` | Sim | Excluir OS |
| `DELETE` | `/agendamento/:id` | Sim | Excluir agendamento |

### Oficinas (`/api/oficinas`)

| Metodo | Rota | Auth | Descricao |
|---|---|---|---|
| `GET` | `/` | Sim | Listar oficinas |
| `GET` | `/mais-agendada` | Sim | Oficina mais agendada |
| `POST` | `/` | Sim | Criar oficina |
| `PUT` | `/:id` | Sim | Atualizar oficina |
| `DELETE` | `/:id` | Sim | Excluir oficina |

### Servicos (`/api/servicos`)

| Metodo | Rota | Auth | Descricao |
|---|---|---|---|
| `GET` | `/` | Sim | Listar servicos |
| `GET` | `/mais-agendado` | Sim | Servico mais agendado |
| `POST` | `/` | Sim | Criar servico |
| `PUT` | `/:id` | Sim | Atualizar servico |
| `DELETE` | `/:id` | Sim | Excluir servico |

### Pecas (`/api/pecas`)

| Metodo | Rota | Auth | Descricao |
|---|---|---|---|
| `GET` | `/` | Sim | Listar pecas |
| `GET` | `/fornecedores` | Sim | Listar fornecedores |
| `POST` | `/` | Sim | Criar peca |
| `POST` | `/fornecedores` | Sim | Criar fornecedor |
| `PUT` | `/:id` | Sim | Atualizar peca |
| `DELETE` | `/:id` | Sim | Excluir peca |

### Profissionais (`/api/profissionais`)

| Metodo | Rota | Auth | Descricao |
|---|---|---|---|
| `GET` | `/` | Sim | Listar profissionais |
| `GET` | `/mais-agendado` | Sim | Profissional mais agendado |
| `GET` | `/oficinas` | Sim | Oficinas do profissional |
| `POST` | `/` | Sim | Criar profissional |
| `PUT` | `/:id` | Sim | Atualizar profissional |
| `DELETE` | `/:id` | Sim | Excluir profissional |

### Estoque (`/api/estoque`)

| Metodo | Rota | Auth | Descricao |
|---|---|---|---|
| `GET` | `/consumo` | Sim | Analise de consumo |
| `GET` | `/giro` | Sim | Giro de estoque |
| `GET` | `/cobertura` | Sim | Analise de cobertura |
| `GET` | `/sugestao-compra` | Sim | Sugestoes de compra |
| `GET` | `/categorias` | Sim | Categorias de pecas |
| `GET` | `/fornecedores` | Sim | Fornecedores |
| `PUT` | `/pecas/:id/estoque-minimo` | Sim | Definir estoque minimo |

### Rastreadores (`/api/rastreadores`)

| Metodo | Rota | Auth | Descricao |
|---|---|---|---|
| `GET` | `/` | Sim | Listar rastreadores |
| `GET` | `/:id` | Sim | Buscar rastreador por ID |
| `POST` | `/` | Sim | Criar rastreador |
| `POST` | `/batch` | Sim | Criacao em lote |
| `PUT` | `/:id` | Sim | Atualizar rastreador |
| `DELETE` | `/:id` | Sim | Excluir rastreador |

### Vendas (`/api/vendas`)

Endpoints para gestao de vendas de motos.

### Pesquisas de Satisfacao (`/api/satisfaction-surveys`)

| Metodo | Rota | Auth | Descricao |
|---|---|---|---|
| `GET` | `/` | Sim | Listar pesquisas |
| `GET` | `/:id` | Sim | Buscar pesquisa por ID |
| `GET` | `/:id/results` | Sim | Resultados da pesquisa |
| `GET` | `/pending/franchisee` | Sim | Pesquisas pendentes do franqueado |
| `GET` | `/responses/:responseId` | Sim | Buscar resposta |
| `POST` | `/` | Sim | Criar pesquisa |
| `POST` | `/:id/activate` | Sim | Ativar pesquisa |
| `POST` | `/:id/close` | Sim | Fechar pesquisa |
| `POST` | `/responses/:responseId/submit` | Sim | Enviar resposta |
| `PUT` | `/:id` | Sim | Atualizar pesquisa |
| `DELETE` | `/:id` | Sim | Excluir pesquisa |

### Campanhas (`/api/campaign-surveys`)

| Metodo | Rota | Auth | Descricao |
|---|---|---|---|
| `GET` | `/` | Sim | Listar campanhas |
| `GET` | `/:id` | Sim | Buscar campanha por ID |
| `GET` | `/:id/results` | Sim | Resultados da campanha |
| `GET` | `/pending/franchisee` | Sim | Campanhas pendentes do franqueado |
| `GET` | `/responses/:responseId` | Sim | Buscar resposta |
| `POST` | `/` | Sim | Criar campanha |
| `POST` | `/:id/activate` | Sim | Ativar campanha |
| `POST` | `/:id/close` | Sim | Fechar campanha |
| `POST` | `/responses/:responseId/submit` | Sim | Enviar resposta |
| `POST` | `/sync` | Sim | Sincronizar campanhas |
| `PUT` | `/:id` | Sim | Atualizar campanha |
| `DELETE` | `/:id` | Sim | Excluir campanha |

### Sugestoes e Roadmap (`/api/suggestions`)

| Metodo | Rota | Auth | Descricao |
|---|---|---|---|
| `GET` | `/` | Sim | Listar sugestoes |
| `GET` | `/monthly` | Sim | Sugestoes mensais |
| `GET` | `/roadmap` | Sim | Itens do roadmap |
| `POST` | `/` | Sim | Criar sugestao |
| `POST` | `/:id/react` | Sim | Reagir a sugestao |
| `POST` | `/roadmap` | Sim | Criar item no roadmap |
| `PATCH` | `/:id/status` | Sim | Alterar status |
| `PUT` | `/roadmap/:id` | Sim | Atualizar item do roadmap |
| `DELETE` | `/:id` | Sim | Excluir sugestao |
| `DELETE` | `/roadmap/:id` | Sim | Excluir item do roadmap |

### Permissoes por Role (`/api/role-permissions`)

| Metodo | Rota | Auth | Descricao |
|---|---|---|---|
| `GET` | `/` | Sim | Listar todas as permissoes |
| `GET` | `/:role` | Sim | Permissoes de uma role |
| `GET` | `/user/:userId/computed` | Sim | Permissoes computadas do usuario |
| `GET` | `/my-permissions` | Sim | Minhas permissoes |
| `PUT` | `/:role` | Sim | Atualizar permissoes da role |
| `PUT` | `/user/:userId/overrides` | Sim | Definir overrides do usuario |
| `DELETE` | `/user/:userId/overrides` | Sim | Remover overrides |

### Telas (`/api/screens`)

| Metodo | Rota | Auth | Descricao |
|---|---|---|---|
| `GET` | `/` | Sim | Listar telas do sistema |
| `GET` | `/categories` | Sim | Categorias de telas |
| `GET` | `/grouped` | Sim | Telas agrupadas por categoria |

### Configuracao ASAAS (`/api/asaas-config`)

| Metodo | Rota | Auth | Descricao |
|---|---|---|---|
| `GET` | `/` | Sim | Buscar configuracao ASAAS |
| `PUT` | `/` | Sim | Atualizar configuracao |
| `PUT` | `/:key` | Sim | Atualizar chave especifica |

### Pagamentos ASAAS (`/api/asaas-payments`)

| Metodo | Rota | Auth | Descricao |
|---|---|---|---|
| `GET` | `/boletos` | Sim | Listar boletos |
| `GET` | `/rental/:rentalId` | Sim | Pagamentos da locacao |
| `GET` | `/pending` | Sim | Pagamentos pendentes |
| `POST` | `/` | Sim | Criar pagamento |
| `PATCH` | `/:id` | Sim | Atualizar pagamento |
| `PATCH` | `/by-asaas-id/:asaasPaymentId` | Sim | Atualizar por ASAAS ID |
| `DELETE` | `/rental/:rentalId` | Sim | Excluir pagamentos da locacao |
| `DELETE` | `/batch` | Sim | Exclusao em lote |

### Configuracao SMTP (`/api/smtp-config`)

| Metodo | Rota | Auth | Descricao |
|---|---|---|---|
| `GET` | `/` | Sim | Buscar configuracao SMTP |
| `PUT` | `/` | Sim | Atualizar configuracao |
| `PUT` | `/:key` | Sim | Atualizar chave especifica |

### Logs de Auditoria (`/api/audit-logs`)

| Metodo | Rota | Auth | Descricao |
|---|---|---|---|
| `GET` | `/` | Sim | Listar logs de auditoria |
| `GET` | `/:id` | Sim | Buscar log por ID |
| `POST` | `/` | Sim | Criar log |

### Multas (`/api/multas`)

| Metodo | Rota | Auth | Descricao |
|---|---|---|---|
| `GET` | `/subscriptions` | Sim | Listar assinaturas Beemon |
| `GET` | `/infractions` | Sim | Listar infracoes |
| `GET` | `/vehicles` | Sim | Listar veiculos |
| `GET` | `/vehicles/count` | Sim | Contagem de veiculos |
| `POST` | `/infractions/refresh` | Sim | Atualizar infracoes |
| `POST` | `/vehicles/check-sync` | Sim | Verificar sincronizacao |
| `POST` | `/vehicles/sync` | Sim | Sincronizar veiculos |

### Marketplace (`/api/marketplace`)

| Metodo | Rota | Auth | Descricao |
|---|---|---|---|
| `GET` | `/services` | Sim | Listar servicos do marketplace |
| `GET` | `/subscriptions` | Sim | Listar assinaturas |
| `GET` | `/public/services` | Nao | Servicos publicos |
| `POST` | `/services` | Sim | Criar servico |
| `POST` | `/subscriptions/:id/cancel` | Sim | Cancelar assinatura |
| `POST` | `/public/search-franchisee` | Nao | Buscar franqueado (publico) |
| `POST` | `/public/subscribe` | Nao | Assinar servico (publico) |
| `PUT` | `/services/:id` | Sim | Atualizar servico |
| `PATCH` | `/subscriptions/:id/fleet` | Sim | Atualizar frota da assinatura |
| `DELETE` | `/services/:id` | Sim | Excluir servico |

### IA Agendamento (`/api/ia-agendamento`)

| Metodo | Rota | Auth | Descricao |
|---|---|---|---|
| `GET` | `/config` | Sim | Buscar configuracao IA |
| `GET` | `/instances` | Sim | Listar instancias WhatsApp |
| `GET` | `/agents` | Sim | Listar agentes IA |
| `GET` | `/evolution-config` | Sim | Configuracao Evolution API |
| `POST` | `/instances` | Sim | Criar instancia |
| `POST` | `/agents` | Sim | Criar agente |
| `PUT` | `/config` | Sim | Atualizar configuracao |
| `PUT` | `/instances/:id/status` | Sim | Atualizar status instancia |
| `PUT` | `/agents/:id` | Sim | Atualizar agente |
| `DELETE` | `/instances/:id` | Sim | Excluir instancia |
| `DELETE` | `/agents/:id` | Sim | Excluir agente |

### Dashboard (`/api/dashboard`)

| Metodo | Rota | Auth | Descricao |
|---|---|---|---|
| `GET` | `/gestao-avista` | Sim | Dados consolidados do dashboard Gestao a Vista |

### Upload (`/api/upload`)

| Metodo | Rota | Auth | Descricao |
|---|---|---|---|
| `POST` | `/` | Sim | Upload de arquivos (Cloudflare R2) |

### Webhooks (`/api/webhooks`)

| Metodo | Rota | Auth | Descricao |
|---|---|---|---|
| `POST` | `/signature` | Secret | Webhook de assinatura digital (PlugSign/BeSign) |
| `POST` | `/evolution` | Secret | Webhook WhatsApp/Evolution |

### Integracoes (`/api/integrations`)

| Metodo | Rota | Auth | Descricao |
|---|---|---|---|
| `GET/POST` | `/plugsign/*` | Sim | Proxy para API PlugSign |
| `GET/POST` | `/besign/*` | Sim | Proxy para API BeSign |

---

## WebSocket (Socket.io)

### Salas (Rooms)
Usuarios sao automaticamente adicionados baseado no role:

| Room | Descricao |
|---|---|
| `user:{userId}` | Sala pessoal do usuario |
| `franchisee:{franchiseeId}` | Sala do franqueado |
| `city:{cityId}` | Sala da cidade |
| `admin` | Sala de administradores |

### Eventos Emitidos

| Evento | Descricao |
|---|---|
| `financeiro:change` | Alteracao em lancamentos financeiros |
| `rental:change` | Alteracao em locacoes |
| `motorcycle:change` | Alteracao em motos |
| `maintenance:change` | Alteracao em ordens de servico |
| `contract:change` | Alteracao em contratos |
| `notification` | Notificacoes para usuarios |
| `rastreadores:change` | Alteracao em rastreadores |

---

## Formato de Resposta Padrao

### Sucesso
```json
{
  "success": true,
  "data": { ... },
  "total": 100,
  "page": 1,
  "limit": 20
}
```

### Erro
```json
{
  "success": false,
  "error": "Mensagem de erro",
  "code": "ERROR_CODE"
}
```

### Codigos de Erro

| Codigo | HTTP | Descricao |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Erro de validacao nos dados |
| `UNAUTHORIZED` | 401 | Nao autenticado |
| `FORBIDDEN` | 403 | Sem permissao |
| `NOT_FOUND` | 404 | Recurso nao encontrado |
| `RATE_LIMIT_EXCEEDED` | 429 | Muitas requisicoes |
| `INTERNAL_ERROR` | 500 | Erro interno do servidor |

---

## Roles e Permissoes

| Role | Nivel | Acesso |
|---|---|---|
| `master_br` | 1 (mais alto) | Acesso total ao sistema |
| `admin` | 2 | Gestao completa |
| `regional` | 3 | Limitado a cidade/regiao |
| `franchisee` | 4 | Apenas dados proprios |

## Enums do Banco

**UserStatus**: `active`, `blocked`, `inactive`, `pending`

**MotorcycleStatus**: `active`, `alugada`, `relocada`, `manutencao`, `recolhida`, `indisponivel_rastreador`, `indisponivel_emplacamento`, `inadimplente`, `renegociado`, `furto_roubo`

**RentalStatus**: `active`, `completed`, `cancelled`, `paused`

**ClientStatus**: `ativo`, `inativo`, `bloqueado`

**ContractStatus**: `draft`, `generated`, `sent`, `signed`, `cancelled`

**FinanceiroTipo**: `entrada`, `saida`

**FrequenciaRecorrente**: `semanal`, `quinzenal`, `mensal`

**VistoriaType**: `entrada`, `saida`, `periodica`

**VistoriaStatus**: `pendente`, `aprovada`, `reprovada`

**DriverStatus**: `active`, `inactive`

**RegionalType**: `admin`, `simples`

**MasterType**: `admin`, `simples`

**LeadSource**: `instagram_proprio`, `indicacao`, `espontaneo`, `google`

## Licenca

Proprietario - Master Brasil

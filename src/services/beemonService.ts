/**
 * Beemon Service - Integração com API de gestão de multas (Backend)
 */

import { prisma } from '../config/database.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

const BEEMON_API_URL = env.BEEMON_API_URL;
const BEEMON_USERNAME = env.BEEMON_USERNAME;
const BEEMON_PASSWORD = env.BEEMON_PASSWORD;

// =============================================================================
// TIPOS
// =============================================================================

interface BeemonAuthResponse {
  access: string;
  refresh: string;
}

interface BeemonFleet {
  uuid: string;
  identifier: string;
  active: boolean;
  abbreviation: string | null;
}

interface BeemonVehicleData {
  uuid?: string;
  vehicle_plate: string;
  renavam: string;
  chassi_code: string;
  state: string;
  city?: string | null;
  brand?: string | null;
  model?: string | null;
  manufacture_year?: number | null;
  model_year?: number | null;
  kind?: string;
  active: boolean;
  security_code?: string | null;
  fleet: BeemonFleet;
  owner_uuid?: string | null;
  fipe_code?: string | null;
  classification?: string | null;
}

interface BeemonInfraction {
  uuid: string;
  vehicle: {
    uuid: string;
    fleet: BeemonFleet;
    owner: unknown | null;
    driver: unknown | null;
    vehicle_plate: string;
    renavam: string;
    chassi_code: string;
  };
  driver: unknown | null;
  ait: string;
  kind: 'NOTIFICACAO' | 'MULTA';
  local: string;
  amount: string;
  organ_description: string;
  framing_description: string;
  framing_code: string;
  identification_date: string;
  infraction_due_date: string;
  infraction_date: string;
  infraction_hour: string;
  paid: boolean;
  value_paid: string | null;
  value_refunded: string | null;
  date_paid: string | null;
  refund_installments: number | null;
  exported: boolean;
}

interface BeemonInfractionsResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: BeemonInfraction[];
}

interface InfractionFilters {
  modified_at__gt?: string;
  modified_at__lt?: string;
  kind?: string;
  infraction_due_date__gt?: string;
  infraction_due_date__lt?: string;
  paid?: boolean;
  plate?: string[];
  fleet?: string;
  page?: number;
}

// =============================================================================
// GERENCIAMENTO DE TOKEN
// =============================================================================

let cachedToken: { access: string; refresh: string; expiresAt: Date } | null = null;

async function getAuthToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > new Date()) {
    return cachedToken.access;
  }

  const storedToken = await prisma.beemonToken.findFirst({
    orderBy: { created_at: 'desc' },
  });

  if (storedToken && new Date(storedToken.expires_at) > new Date()) {
    cachedToken = {
      access: storedToken.access_token,
      refresh: storedToken.refresh_token,
      expiresAt: new Date(storedToken.expires_at),
    };
    return cachedToken.access;
  }

  if (storedToken?.refresh_token) {
    try {
      return await refreshAuthToken(storedToken.refresh_token);
    } catch {
      logger.warn('[Beemon] Refresh token expirado, obtendo novo token');
    }
  }

  return authenticateBeemon();
}

async function authenticateBeemon(): Promise<string> {
  if (!BEEMON_API_URL || !BEEMON_USERNAME || !BEEMON_PASSWORD) {
    throw new Error('Beemon API não configurada. Verifique as variáveis BEEMON_API_URL, BEEMON_USERNAME e BEEMON_PASSWORD.');
  }

  logger.info('[Beemon] Autenticando na API...');

  const response = await fetch(`${BEEMON_API_URL}/auth/token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ username: BEEMON_USERNAME, password: BEEMON_PASSWORD }),
  });

  if (!response.ok) {
    const error = await response.text();
    logger.error(`[Beemon] Erro na autenticação: ${error}`);
    throw new Error('Falha na autenticação com a API Beemon');
  }

  const data: BeemonAuthResponse = await response.json();

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 6);

  cachedToken = { access: data.access, refresh: data.refresh, expiresAt };

  await prisma.beemonToken.create({
    data: {
      access_token: data.access,
      refresh_token: data.refresh,
      expires_at: expiresAt,
    },
  });

  logger.info('[Beemon] Autenticação bem sucedida');
  return data.access;
}

async function refreshAuthToken(refreshToken: string): Promise<string> {
  if (!BEEMON_API_URL) throw new Error('Beemon API URL não configurada');

  const response = await fetch(`${BEEMON_API_URL}/auth/token/refresh/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ refresh: refreshToken }),
  });

  if (!response.ok) throw new Error('Falha ao renovar token');

  const data = await response.json();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 6);

  cachedToken = { access: data.access, refresh: refreshToken, expiresAt };

  await prisma.beemonToken.create({
    data: { access_token: data.access, refresh_token: refreshToken, expires_at: expiresAt },
  });

  return data.access;
}

// =============================================================================
// REQUISIÇÕES À API
// =============================================================================

async function beemonRequest<T>(
  endpoint: string,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' = 'GET',
  body?: unknown
): Promise<T> {
  const token = await getAuthToken();
  const url = `${BEEMON_API_URL}${endpoint}`;

  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error(`[Beemon] Erro ${response.status}: ${errorText}`);
    throw new Error(`Erro na API Beemon: ${response.status} - ${errorText}`);
  }

  return await response.json() as T;
}

// =============================================================================
// FROTAS
// =============================================================================

async function createFleet(identifier: string): Promise<BeemonFleet> {
  return beemonRequest<BeemonFleet>('/fleets/', 'POST', { identifier, active: true });
}

async function listFleets(): Promise<{ results: BeemonFleet[] }> {
  return beemonRequest<{ results: BeemonFleet[] }>('/fleets/');
}

async function getFleet(uuid: string): Promise<BeemonFleet> {
  return beemonRequest<BeemonFleet>(`/fleets/${uuid}/`);
}

async function updateFleet(uuid: string, data: Partial<BeemonFleet>): Promise<BeemonFleet> {
  return beemonRequest<BeemonFleet>(`/fleets/${uuid}/`, 'PUT', data);
}

// =============================================================================
// VEÍCULOS
// =============================================================================

async function createVehicle(vehicle: Omit<BeemonVehicleData, 'uuid'>): Promise<BeemonVehicleData> {
  return beemonRequest<BeemonVehicleData>('/vehicles/', 'POST', vehicle);
}

async function listVehicles(params?: { fleet?: string; active?: boolean }): Promise<{ results: BeemonVehicleData[] }> {
  let endpoint = '/vehicles/';
  const queryParams: string[] = [];
  if (params?.fleet) queryParams.push(`fleet=${params.fleet}`);
  if (params?.active !== undefined) queryParams.push(`active=${params.active}`);
  if (queryParams.length > 0) endpoint += `?${queryParams.join('&')}`;
  return beemonRequest<{ results: BeemonVehicleData[] }>(endpoint);
}

async function getVehicle(uuid: string): Promise<BeemonVehicleData> {
  return beemonRequest<BeemonVehicleData>(`/vehicles/${uuid}/`);
}

async function updateVehicle(uuid: string, data: Partial<BeemonVehicleData>): Promise<BeemonVehicleData> {
  return beemonRequest<BeemonVehicleData>(`/vehicles/${uuid}/`, 'PUT', data);
}

// =============================================================================
// INFRAÇÕES
// =============================================================================

async function listInfractions(filters?: InfractionFilters): Promise<BeemonInfractionsResponse> {
  let endpoint = '/infractions/';
  const queryParams: string[] = [];

  if (filters) {
    if (filters.modified_at__gt) queryParams.push(`modified_at__gt=${filters.modified_at__gt}`);
    if (filters.modified_at__lt) queryParams.push(`modified_at__lt=${filters.modified_at__lt}`);
    if (filters.kind) queryParams.push(`kind=${filters.kind}`);
    if (filters.infraction_due_date__gt) queryParams.push(`infraction_due_date__gt=${filters.infraction_due_date__gt}`);
    if (filters.infraction_due_date__lt) queryParams.push(`infraction_due_date__lt=${filters.infraction_due_date__lt}`);
    if (filters.paid !== undefined) queryParams.push(`paid=${filters.paid}`);
    if (filters.plate && filters.plate.length > 0) queryParams.push(`plate=${filters.plate.join(',')}`);
    if (filters.fleet) queryParams.push(`fleet=${filters.fleet}`);
    if (filters.page) queryParams.push(`page=${filters.page}`);
  }

  if (queryParams.length > 0) endpoint += `?${queryParams.join('&')}`;
  return beemonRequest<BeemonInfractionsResponse>(endpoint);
}

async function listAllInfractions(filters?: Omit<InfractionFilters, 'page'>): Promise<BeemonInfraction[]> {
  const allResults: BeemonInfraction[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const response = await listInfractions({ ...filters, page });
    allResults.push(...response.results);
    hasMore = response.next !== null;
    page++;
    if (page > 100) break;
  }

  return allResults;
}

// =============================================================================
// FUNÇÕES DE ALTO NÍVEL
// =============================================================================

/**
 * Buscar infrações da API Beemon e cachear localmente
 */
export async function fetchAndCacheInfractions(
  subscriptionId: string,
  fleetId: string
): Promise<{ total: number; newInfractions: number }> {
  const lastInfraction = await prisma.beemonInfractionCache.findFirst({
    where: { subscription_id: subscriptionId },
    orderBy: { updated_at: 'desc' },
    select: { updated_at: true },
  });

  const filters: InfractionFilters = { fleet: fleetId };
  if (lastInfraction?.updated_at) {
    const lastDate = new Date(lastInfraction.updated_at);
    lastDate.setDate(lastDate.getDate() - 1);
    filters.modified_at__gt = lastDate.toISOString().split('T')[0];
  }

  const infractions = await listAllInfractions(filters);
  let newInfractions = 0;

  for (const infraction of infractions) {
    try {
      await prisma.beemonInfractionCache.upsert({
        where: {
          subscription_id_beemon_infraction_uuid: {
            subscription_id: subscriptionId,
            beemon_infraction_uuid: infraction.uuid,
          },
        },
        update: {
          beemon_vehicle_uuid: infraction.vehicle?.uuid,
          vehicle_plate: infraction.vehicle?.vehicle_plate,
          ait: infraction.ait,
          kind: infraction.kind,
          local: infraction.local,
          amount: parseFloat(infraction.amount),
          organ_description: infraction.organ_description,
          framing_description: infraction.framing_description,
          framing_code: infraction.framing_code,
          identification_date: infraction.identification_date ? new Date(infraction.identification_date) : null,
          infraction_due_date: infraction.infraction_due_date ? new Date(infraction.infraction_due_date) : null,
          infraction_date: infraction.infraction_date ? new Date(infraction.infraction_date) : null,
          infraction_hour: infraction.infraction_hour || null,
          paid: infraction.paid,
          raw_data: infraction as any,
          updated_at: new Date(),
        },
        create: {
          subscription_id: subscriptionId,
          beemon_vehicle_uuid: infraction.vehicle?.uuid,
          vehicle_plate: infraction.vehicle?.vehicle_plate,
          beemon_infraction_uuid: infraction.uuid,
          ait: infraction.ait,
          kind: infraction.kind,
          local: infraction.local,
          amount: parseFloat(infraction.amount),
          organ_description: infraction.organ_description,
          framing_description: infraction.framing_description,
          framing_code: infraction.framing_code,
          identification_date: infraction.identification_date ? new Date(infraction.identification_date) : null,
          infraction_due_date: infraction.infraction_due_date ? new Date(infraction.infraction_due_date) : null,
          infraction_date: infraction.infraction_date ? new Date(infraction.infraction_date) : null,
          infraction_hour: infraction.infraction_hour || null,
          paid: infraction.paid,
          raw_data: infraction as any,
        },
      });
      newInfractions++;
    } catch (err) {
      logger.error(`[Beemon] Erro ao cachear infração ${infraction.uuid}: ${err}`);
    }
  }

  return { total: infractions.length, newInfractions };
}

function formatCnpj(cnpj: string): string {
  const cleaned = cnpj.replace(/\D/g, '');
  return cleaned.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

/**
 * Configurar frota para um franqueado
 */
export async function setupFleetForFranchisee(params: {
  franchiseeId: string;
  companyName: string;
  cnpj: string;
}): Promise<{ success: boolean; fleetId?: string; fleetIdentifier?: string; error?: string }> {
  try {
    const cnpjFormatted = formatCnpj(params.cnpj);
    const maxNameLength = 50 - 3 - cnpjFormatted.length;
    const companyNameTruncated = params.companyName.length > maxNameLength
      ? params.companyName.substring(0, maxNameLength).trim()
      : params.companyName;
    const identifier = `${companyNameTruncated} - ${cnpjFormatted}`;

    // Verificar se a frota já existe
    try {
      const existingFleets = await listFleets();
      const existingFleet = existingFleets.results?.find(
        f => f.identifier === identifier || f.identifier?.includes(params.cnpj.replace(/\D/g, ''))
      );

      if (existingFleet) {
        if (!existingFleet.active) {
          try { await updateFleet(existingFleet.uuid, { identifier: existingFleet.identifier, active: true }); } catch { /* ignore */ }
        }
        return { success: true, fleetId: existingFleet.uuid, fleetIdentifier: existingFleet.identifier };
      }
    } catch { /* continue to create */ }

    const fleet = await createFleet(identifier);
    return { success: true, fleetId: fleet.uuid, fleetIdentifier: fleet.identifier };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Se frota duplicada, tentar buscar
    if (errorMessage.includes('já existente') || errorMessage.includes('already exists')) {
      try {
        const existingFleets = await listFleets();
        const cnpjFmt = formatCnpj(params.cnpj);
        const maxLen = 50 - 3 - cnpjFmt.length;
        const nameTrunc = params.companyName.length > maxLen ? params.companyName.substring(0, maxLen).trim() : params.companyName;
        const ident = `${nameTrunc} - ${cnpjFmt}`;
        const existingFleet = existingFleets.results?.find(
          f => f.identifier === ident || f.identifier?.includes(params.cnpj.replace(/\D/g, ''))
        );
        if (existingFleet) {
          if (!existingFleet.active) {
            try { await updateFleet(existingFleet.uuid, { identifier: existingFleet.identifier, active: true }); } catch { /* ignore */ }
          }
          return { success: true, fleetId: existingFleet.uuid, fleetIdentifier: existingFleet.identifier };
        }
      } catch { /* ignore */ }
    }

    return { success: false, error: errorMessage };
  }
}

/**
 * Registrar veículo na Beemon
 */
export async function registerVehicle(params: {
  subscriptionId: string;
  motorcycleId: string;
  plate: string;
  renavam: string;
  chassi: string;
  state: string;
  fleetId: string;
  fleetIdentifier: string;
  brand?: string;
  model?: string;
  year?: number;
}): Promise<{ success: boolean; beemonVehicleId?: string; error?: string }> {
  const cleanPlate = params.plate.replace(/[^A-Z0-9]/gi, '').toUpperCase();

  try {
    const fleet = await getFleet(params.fleetId);

    const vehicle = await createVehicle({
      vehicle_plate: cleanPlate,
      renavam: params.renavam,
      chassi_code: params.chassi,
      state: params.state,
      active: true,
      kind: 'motocicleta',
      brand: params.brand || null,
      model: params.model || null,
      manufacture_year: params.year || null,
      model_year: params.year || null,
      fleet: { uuid: fleet.uuid, identifier: fleet.identifier, active: fleet.active, abbreviation: fleet.abbreviation },
    });

    await prisma.beemonVehicle.create({
      data: {
        subscription_id: params.subscriptionId,
        motorcycle_id: params.motorcycleId,
        beemon_vehicle_uuid: vehicle.uuid,
        vehicle_plate: params.plate,
        renavam: params.renavam,
        chassi_code: params.chassi,
        state: params.state,
        active: true,
      },
    });

    return { success: true, beemonVehicleId: vehicle.uuid };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Veículo duplicado
    if (errorMessage.includes('set único') || errorMessage.includes('already exists') || errorMessage.includes('unique')) {
      try {
        const { results: existingVehicles } = await listVehicles({ fleet: params.fleetId });
        const existingVehicle = existingVehicles?.find(
          v => v.vehicle_plate === cleanPlate || v.renavam === params.renavam
        );

        if (existingVehicle) {
          if (!existingVehicle.active) {
            try {
              await updateVehicle(existingVehicle.uuid!, {
                vehicle_plate: existingVehicle.vehicle_plate,
                renavam: existingVehicle.renavam,
                chassi_code: existingVehicle.chassi_code,
                state: existingVehicle.state,
                kind: existingVehicle.kind || 'motocicleta',
                active: true,
                fleet: existingVehicle.fleet,
              });
            } catch { /* ignore */ }
          }

          const localVehicle = await prisma.beemonVehicle.findFirst({
            where: { beemon_vehicle_uuid: existingVehicle.uuid },
          });

          if (!localVehicle) {
            await prisma.beemonVehicle.create({
              data: {
                subscription_id: params.subscriptionId,
                motorcycle_id: params.motorcycleId,
                beemon_vehicle_uuid: existingVehicle.uuid,
                vehicle_plate: params.plate,
                renavam: params.renavam,
                chassi_code: params.chassi,
                state: params.state,
                active: true,
              },
            });
          } else if (!localVehicle.active || localVehicle.subscription_id !== params.subscriptionId) {
            await prisma.beemonVehicle.update({
              where: { id: localVehicle.id },
              data: { active: true, subscription_id: params.subscriptionId },
            });
          }

          return { success: true, beemonVehicleId: existingVehicle.uuid };
        }
      } catch { /* ignore */ }
    }

    return { success: false, error: errorMessage };
  }
}

/**
 * Sincronizar veículos de um franqueado com a Beemon
 */
export async function syncFranchiseeVehicles(
  subscriptionId: string,
  franchiseeId: string,
  fleetId: string,
  fleetIdentifier: string,
  state: string
): Promise<{ success: number; failed: number; skipped: number; missingData: number; deactivated: number; errors: string[] }> {
  const result = { success: 0, failed: 0, skipped: 0, missingData: 0, deactivated: 0, errors: [] as string[] };

  const DEACTIVATION_STATUS = ['furto/roubo', 'apropriação indébita', 'vendida', 'a venda'];
  const ACTIVE_STATUS = ['disponivel', 'alugada', 'manutencao', 'reservada', 'relocada', 'active'];

  // Buscar todas as motos do franqueado
  const rawMotorcycles = await prisma.motorcycle.findMany({
    where: { franchisee_id: franchiseeId },
    select: { id: true, placa: true, chassi: true, renavam: true, modelo: true, marca: true, ano: true, cor: true, quilometragem: true, status: true, franchisee_id: true },
  });

  const motorcycles = rawMotorcycles.filter(m => m.franchisee_id === franchiseeId);

  // Identificar placas ativas
  const activePlates = new Set(
    motorcycles.filter(m => ACTIVE_STATUS.includes(m.status || '')).map(m => m.placa?.trim().toUpperCase()).filter(Boolean)
  );

  // ========== DESATIVAÇÃO ==========
  const motosToDeactivate = motorcycles.filter(m => DEACTIVATION_STATUS.includes(m.status || ''));
  if (motosToDeactivate.length > 0) {
    const motorcycleIdsToDeactivate = motosToDeactivate.map(m => m.id);
    const vehiclesToDeactivate = await prisma.beemonVehicle.findMany({
      where: { subscription_id: subscriptionId, active: true, motorcycle_id: { in: motorcycleIdsToDeactivate } },
    });

    for (const vehicle of vehiclesToDeactivate) {
      try {
        if (vehicle.beemon_vehicle_uuid) {
          await updateVehicle(vehicle.beemon_vehicle_uuid, { active: false });
        }
        await prisma.beemonVehicle.update({ where: { id: vehicle.id }, data: { active: false } });
        result.deactivated++;
      } catch {
        result.errors.push(`Erro ao desativar ${vehicle.vehicle_plate}`);
      }
    }
  }

  // ========== CADASTRO ==========
  if (activePlates.size === 0) {
    result.errors.push('Nenhuma moto com status ativo encontrada');
    return result;
  }

  const existingVehicles = await prisma.beemonVehicle.findMany({
    where: { subscription_id: subscriptionId, active: true },
    select: { vehicle_plate: true },
  });
  const existingPlates = new Set(existingVehicles.map(v => v.vehicle_plate?.trim().toUpperCase()).filter(Boolean));

  const isRenavamValid = (r: string | null | undefined) => !!r && r.trim().length >= 11;
  const isChassiValid = (c: string | null | undefined) => !!c && c.trim().length >= 17;

  const getScore = (m: typeof motorcycles[0]) => {
    let s = 0;
    if (isRenavamValid(m.renavam)) s += 10;
    if (isChassiValid(m.chassi)) s += 10;
    if (m.quilometragem) s++;
    if (m.cor) s++;
    if (m.ano) s++;
    if (m.marca) s++;
    return s;
  };

  // Deduplicar por placa
  const plateMap = new Map<string, typeof motorcycles[0]>();
  motorcycles.forEach(m => {
    const plate = m.placa?.trim().toUpperCase();
    if (!plate) return;
    const existing = plateMap.get(plate);
    if (!existing || getScore(m) > getScore(existing)) plateMap.set(plate, m);
  });

  const uniqueMotorcycles = Array.from(plateMap.values()).filter(m => activePlates.has(m.placa?.trim().toUpperCase()));

  // Buscar dados faltantes globalmente
  const platesWithoutData = uniqueMotorcycles
    .filter(m => !isRenavamValid(m.renavam) || !isChassiValid(m.chassi))
    .map(m => m.placa?.trim().toUpperCase())
    .filter(Boolean) as string[];

  if (platesWithoutData.length > 0) {
    const globalRecords = await prisma.motorcycle.findMany({
      where: { placa: { in: platesWithoutData } },
      select: { placa: true, chassi: true, renavam: true },
    });

    const globalDataMap = new Map<string, { renavam: string; chassi: string }>();
    globalRecords.forEach(r => {
      const plate = r.placa?.trim().toUpperCase();
      if (!plate) return;
      const existing = globalDataMap.get(plate);
      const cur = (isRenavamValid(r.renavam) ? 1 : 0) + (isChassiValid(r.chassi) ? 1 : 0);
      const prev = existing ? (isRenavamValid(existing.renavam) ? 1 : 0) + (isChassiValid(existing.chassi) ? 1 : 0) : 0;
      if (!existing || cur > prev) globalDataMap.set(plate, { renavam: r.renavam || '', chassi: r.chassi || '' });
    });

    uniqueMotorcycles.forEach(m => {
      const plate = m.placa?.trim().toUpperCase();
      if (!plate) return;
      const gd = globalDataMap.get(plate);
      if (gd) {
        if (!isRenavamValid(m.renavam) && isRenavamValid(gd.renavam)) m.renavam = gd.renavam;
        if (!isChassiValid(m.chassi) && isChassiValid(gd.chassi)) m.chassi = gd.chassi;
      }
    });
  }

  // Separar válidas vs inválidas
  for (const moto of uniqueMotorcycles) {
    const plateUpper = moto.placa?.trim().toUpperCase();
    if (plateUpper && existingPlates.has(plateUpper)) {
      result.skipped++;
      continue;
    }

    if (!isRenavamValid(moto.renavam)) {
      result.missingData++;
      result.errors.push(`${moto.placa}: renavam inválido "${moto.renavam || ''}" (${(moto.renavam || '').length} chars, mínimo 11)`);
      continue;
    }

    const registerResult = await registerVehicle({
      subscriptionId,
      motorcycleId: moto.id,
      plate: moto.placa,
      renavam: moto.renavam || '',
      chassi: moto.chassi || '',
      state,
      fleetId,
      fleetIdentifier,
      brand: moto.marca || undefined,
      model: moto.modelo || undefined,
      year: moto.ano || undefined,
    });

    if (registerResult.success) {
      result.success++;
    } else {
      result.failed++;
      result.errors.push(`${moto.placa}: ${registerResult.error}`);
    }
  }

  return result;
}

/**
 * Buscar preview de sincronização (quantas motos novas, valores etc.)
 */
export async function checkSyncPreview(
  subscriptionId: string,
  franchiseeId: string,
  unitPrice: number,
  currentTotalValue: number
): Promise<{
  newPlates: number;
  currentPlates: number;
  totalPlates: number;
  unitPrice: number;
  currentValue: number;
  newValue: number;
  missingData: number;
  needsFleetSetup: boolean;
}> {
  const ACTIVE_STATUS = ['disponivel', 'alugada', 'manutencao', 'reservada', 'relocada', 'active'];

  // Buscar motos do franqueado
  const allMotos = await prisma.motorcycle.findMany({
    where: { franchisee_id: franchiseeId },
    select: { id: true, placa: true, chassi: true, renavam: true, status: true },
  });

  // Buscar veículos já cadastrados
  const existingVehicles = await prisma.beemonVehicle.findMany({
    where: { subscription_id: subscriptionId, active: true },
    select: { vehicle_plate: true },
  });

  const existingPlatesSet = new Set(existingVehicles.map(v => v.vehicle_plate?.trim().toUpperCase()).filter(Boolean));

  // Placas ativas
  const activePlates = new Set(
    allMotos.filter(m => ACTIVE_STATUS.includes(m.status || '')).map(m => m.placa?.trim().toUpperCase()).filter(Boolean)
  );

  // Deduplicar
  const isRenavamValid = (r: string | null | undefined) => !!r && r.trim().length >= 11;
  const plateMap = new Map<string, typeof allMotos[0]>();
  allMotos.forEach(m => {
    const plate = m.placa?.trim().toUpperCase();
    if (!plate) return;
    const existing = plateMap.get(plate);
    if (!existing) plateMap.set(plate, m);
    else {
      const scoreCur = (isRenavamValid(m.renavam) ? 10 : 0) + ((m.chassi?.trim() || '').length >= 17 ? 10 : 0);
      const scoreExist = (isRenavamValid(existing.renavam) ? 10 : 0) + ((existing.chassi?.trim() || '').length >= 17 ? 10 : 0);
      if (scoreCur > scoreExist) plateMap.set(plate, m);
    }
  });

  const uniqueMotos = Array.from(plateMap.values()).filter(m => activePlates.has(m.placa?.trim().toUpperCase()));
  const newMotos = uniqueMotos.filter(m => !existingPlatesSet.has(m.placa?.trim().toUpperCase()));

  const currentPlates = existingPlatesSet.size;
  const newPlatesCount = newMotos.length;
  const totalPlates = currentPlates + newPlatesCount;
  const currentValue = currentTotalValue || currentPlates * unitPrice;
  const newValue = totalPlates * unitPrice;

  return {
    newPlates: newPlatesCount,
    currentPlates,
    totalPlates,
    unitPrice,
    currentValue,
    newValue,
    missingData: 0,
    needsFleetSetup: false,
  };
}

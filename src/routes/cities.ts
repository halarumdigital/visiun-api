import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../config/database.js';

const citiesRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /api/cities
   * Listar todas as cidades
   */
  app.get('/', {
    schema: {
      description: 'Listar todas as cidades',
      tags: ['Cidades'],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const cities = await prisma.city.findMany({
      select: {
        id: true,
        name: true,
      },
      orderBy: {
        name: 'asc',
      },
    });

    return reply.status(200).send({
      success: true,
      data: cities,
    });
  });

  /**
   * GET /api/cities/:id
   * Obter cidade por ID
   */
  app.get<{ Params: { id: string } }>('/:id', {
    schema: {
      description: 'Obter cidade por ID',
      tags: ['Cidades'],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string' },
        },
        required: ['id'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;

    const city = await prisma.city.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
      },
    });

    if (!city) {
      return reply.status(404).send({
        success: false,
        error: 'Cidade não encontrada',
      });
    }

    return reply.status(200).send({
      success: true,
      data: city,
    });
  });
};

export default citiesRoutes;

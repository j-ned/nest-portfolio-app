import { type INestApplication, NotFoundException } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { Application, Request, Response } from 'express';

/**
 * Depuis NestJS 12, le gestionnaire « route inconnue » de Nest n'est monté que sous le préfixe
 * global (`/api`) : hors préfixe, Express répondait par sa page 404 HTML par défaut (le
 * gestionnaire d'erreurs, lui, reste aussi monté à la racine). Ce repli, enregistré après
 * `app.init()` (donc derrière toutes les routes, Swagger compris), renvoie hors préfixe le même
 * 404 JSON qu'avant, produit par le même filtre.
 */
export function registerOutOfPrefixFallback(
  app: INestApplication,
  filter: ExceptionFilter,
): void {
  const adapter = app.get(HttpAdapterHost).httpAdapter;
  const express = adapter.getInstance<Application>();

  express.use((req: Request, res: Response) => {
    filter.catch(
      new NotFoundException(`Cannot ${req.method} ${req.originalUrl}`),
      httpHost(req, res),
    );
  });
}

function httpHost(req: Request, res: Response): ArgumentsHost {
  const args: [Request, Response] = [req, res];
  const http: ReturnType<ArgumentsHost['switchToHttp']> = {
    getRequest: <T>() => req as T,
    getResponse: <T>() => res as T,
    getNext: <T>() => undefined as T,
  };
  return {
    getArgs: <T extends unknown[]>() => args as unknown as T,
    getArgByIndex: <T>(index: number) => args[index] as T,
    switchToHttp: () => http,
    switchToRpc: () => {
      throw new Error('HTTP context only');
    },
    switchToWs: () => {
      throw new Error('HTTP context only');
    },
    getType: <T extends string>() => 'http' as T,
  };
}

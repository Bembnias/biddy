// ZAŚLEPKA: pełna wersja w torze „HTTP i rdzeń” (F-03).
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';

import { AppModule } from './app.module.js';

const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());
await app.listen(3001, '127.0.0.1');

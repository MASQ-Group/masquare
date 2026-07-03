import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import { StorageService } from './storage/storage.service';

async function bootstrap() {
  // Disable Nest's built-in body parser so we can raise the JSON size limit
  // (default is 100kb — too small for large bulk imports, e.g. thousands of rows).
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.use(json({ limit: '25mb' }));
  app.use(urlencoded({ extended: true, limit: '25mb' }));

  app.setGlobalPrefix('api');

  // Ensure the media bucket exists (no-op if storage is offline).
  await app.get(StorageService).ensureBucket();

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );

  const origins = (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({ origin: origins, credentials: true });

  const config = new DocumentBuilder()
    .setTitle('maSquare API')
    .setDescription('Foundation (Module 1) — companies, users, modules')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = Number(process.env.API_PORT ?? 3000);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`maSquare API listening on http://localhost:${port}/api`);
}

bootstrap();

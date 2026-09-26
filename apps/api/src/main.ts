import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json, urlencoded } from 'express';
import compression from 'compression';
import { AppModule } from './app.module';
import { StorageService } from './storage/storage.service';
import { McpOAuthService } from './mcp/oauth/mcp-oauth.service';

async function bootstrap() {
  // Disable Nest's built-in body parser so we can raise the JSON size limit
  // (default is 100kb — too small for large bulk imports, e.g. thousands of rows).
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  app.use(json({ limit: '25mb' }));
  app.use(urlencoded({ extended: true, limit: '25mb' }));

  // gzip/brotli every response — JSON API payloads and the SPA's JS/CSS bundles
  // are large text that compresses 70-90%, the biggest over-the-wire latency win
  // (Node serves everything directly; there is no CDN in front to do this).
  app.use(compression());

  app.setGlobalPrefix('api');

  // Railway puts one proxy in front of the API. Trusting that one hop gives the real client address
  // to the connector sign-in's rate limits, instead of counting everyone as the proxy.
  app.set('trust proxy', 1);

  // The connector's OAuth endpoints (/.well-known/…, /authorize, /token, /register, /revoke). OAuth
  // requires them at the site root, outside the /api prefix; mounted here, before Nest's own routes
  // and the web app's catch-all, so nothing else answers first. Absent while sign-in is off.
  const mcpOAuth = app.get(McpOAuthService).router();
  if (mcpOAuth) app.use(mcpOAuth);

  // Ensure the media bucket exists — fire-and-forget so a slow or offline storage
  // round-trip never delays the server from accepting requests at boot.
  void app.get(StorageService).ensureBucket().catch(() => undefined);

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

  // Honour Railway/host-injected PORT; fall back to API_PORT (local .env) then 3000.
  const port = Number(process.env.API_PORT ?? process.env.PORT ?? 3000);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`maSquare API listening on http://localhost:${port}/api`);
}

bootstrap();

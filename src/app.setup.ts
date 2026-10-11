import { join } from 'node:path';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { HttpExceptionFilter } from './core/http/http-exception.filter';

/** Shared by main.ts and integration tests so both run the same pipeline. */
export function configureApp(app: NestExpressApplication): NestExpressApplication {
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableShutdownHooks();
  // Static helpers for the Swagger UI (e.g. /js/swagger-autologin.js); served outside the guards.
  app.useStaticAssets(join(__dirname, '..', 'public'));

  app.enableVersioning({
    type: VersioningType.URI,
    prefix: 'api/',
    defaultVersion: 'v1',
  });

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Merchant Application API')
      .setDescription(
        'Merchant onboarding: application lifecycle, asynchronous risk/KYB review, role- and object-level authorization, audit trail. Every error uses the ErrorResponse shape.',
      )
      .setVersion('0.1.0')
      .addBearerAuth()
      .build(),
  );
  SwaggerModule.setup('docs', app, document, {
    customJs: '/js/swagger-autologin.js',
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      docExpansion: 'none',
      filter: true,
      showRequestHeaders: true,
      tryItOutEnabled: true,
    },
  });

  return app;
}

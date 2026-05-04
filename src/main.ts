import { Logger, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { Logger as PinoLogger } from "nestjs-pino";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(PinoLogger));

  app.setGlobalPrefix("api", { exclude: ["metrics"] });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle("Aggregate Service")
    .setDescription("BFF Aggregation Service — unified document viewer")
    .setVersion("1.0")
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup("api/docs", app, document);

  const port = Number(process.env.PORT) || 3000;
  await app.listen(port);
  const base = `http://localhost:${port}`;
  Logger.log(
    `Aggregate BFF listening at ${base}/api (Swagger: ${base}/api/docs)`,
    "Bootstrap",
  );
  Logger.log(`Documents search: GET ${base}/api/v1/documents`, "Bootstrap");
}

void bootstrap();

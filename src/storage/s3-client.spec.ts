import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { createS3Client, S3_TIMEOUTS } from './s3-client';

/** Serveur S3 qui accepte la requête et ne répond jamais (stockage bloqué). */
const aHangingServer = async (): Promise<Server> => {
  const server = createServer((req) => req.resume());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
};

const settings = (endpoint: string) => ({
  s3Endpoint: endpoint,
  s3Region: 'auto',
  s3AccessKey: 'test-access',
  s3SecretKey: 'test-secret',
});

describe('createS3Client', () => {
  let server: Server;

  beforeEach(async () => {
    server = await aHangingServer();
  });
  afterEach(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  it('Given the production timeouts, When read, Then the connection is bounded to 5 s and a request to 30 s', () => {
    expect(S3_TIMEOUTS).toEqual({
      connectionTimeout: 5_000,
      requestTimeout: 30_000,
    });
  });

  it('Given a storage that never answers, When an object is sent, Then the request fails with a TimeoutError instead of hanging', async () => {
    const { port } = server.address() as AddressInfo;
    const client = createS3Client(settings(`http://127.0.0.1:${port}`), {
      connectionTimeout: 200,
      requestTimeout: 200,
    });

    await expect(
      client.send(
        new PutObjectCommand({ Bucket: 'b', Key: 'k', Body: Buffer.from('x') }),
      ),
    ).rejects.toMatchObject({ name: 'TimeoutError' });

    const handler = client.config.requestHandler as unknown as {
      httpHandlerConfigs(): Record<string, unknown>;
    };
    expect(handler.httpHandlerConfigs()).toMatchObject({
      connectionTimeout: 200,
      requestTimeout: 200,
      throwOnRequestTimeout: true,
    });
    client.destroy();
  }, 10_000);
});

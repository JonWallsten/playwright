/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { Fixtures } from '@playwright/test';
import path from 'path';
import socks from 'socksv5';
import { TestServer } from '../../utils/testserver';
import { TestProxy } from './proxy';

export type ServerWorkerOptions = {
  loopback?: string;
  __servers: ServerFixtures & { socksServer: socks.SocksServer };
};

export type ServerFixtures = {
  server: TestServer;
  httpsServer: TestServer;
  socksPort: number;
  proxyServer: TestProxy;
  asset: (p: string) => string;
};

export const serverFixtures: Fixtures<ServerFixtures, ServerWorkerOptions> = {
  loopback: [undefined, { scope: 'worker', option: true }],
  __servers: [async ({ loopback }, run, workerInfo) => {
    const assetsPath = path.join(__dirname, '..', 'assets');
    const cachedPath = path.join(__dirname, '..', 'assets', 'cached');

    const port = 8907 + workerInfo.workerIndex * 4;
    const server = await TestServer.create(assetsPath, port, loopback);
    server.enableHTTPCache(cachedPath);

    const httpsPort = port + 1;
    const httpsServer = await TestServer.createHTTPS(assetsPath, httpsPort, loopback);
    httpsServer.enableHTTPCache(cachedPath);

    const socksServer = socks.createServer((info, accept, deny) => {
      const socket = accept(true);
      if (socket) {
        // Catch and ignore ECONNRESET errors.
        socket.on('error', () => {});
        const body = '<html><title>Served by the SOCKS proxy</title></html>';
        socket.end([
          'HTTP/1.1 200 OK',
          'Connection: close',
          'Content-Type: text/html',
          'Content-Length: ' + Buffer.byteLength(body),
          '',
          body
        ].join('\r\n'));
      }
    });
    const socksPort = port + 2;
    socksServer.listen(socksPort, 'localhost');
    socksServer.useAuth(socks.auth.None());

    const proxyPort = port + 3;
    const proxyServer = await TestProxy.create(proxyPort);

    await run({
      asset: (p: string) => path.join(__dirname, '..', 'assets', ...p.split('/')),
      server,
      httpsServer,
      socksPort,
      proxyServer,
      socksServer,
    });

    await Promise.all([
      server.stop(),
      httpsServer.stop(),
      socksServer.close(),
      proxyServer.stop(),
    ]);
  }, { scope: 'worker' }],

  server: async ({ __servers }, run) => {
    __servers.server.reset();
    await run(__servers.server);
  },

  httpsServer: async ({ __servers }, run) => {
    __servers.httpsServer.reset();
    await run(__servers.httpsServer);
  },

  socksPort: async ({ __servers }, run) => {
    await run(__servers.socksPort);
  },

  proxyServer: async ({ __servers }, run) => {
    __servers.proxyServer.reset();
    await run(__servers.proxyServer);
  },

  asset: async ({ __servers }, run) => {
    await run(__servers.asset);
  },
};


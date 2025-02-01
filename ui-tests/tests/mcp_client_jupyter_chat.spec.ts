import { expect, test } from '@jupyterlab/galata';

// Extend window interface to include our mock
declare global {
  interface Window {
    mockModelContextProtocolSDK: {
      Client: new () => {
        connect: () => Promise<void>;
        close: () => Promise<void>;
      };
      SSEClientTransport: new () => {
        close: () => Promise<void>;
      };
    };
    require: any; // Override require type for our test
  }
}

/**
 * Don't load JupyterLab webpage before running the tests.
 * This is required to ensure we capture all log messages.
 */
test.use({ autoGoto: false });

test('should emit an activation console message', async ({ page }) => {
  // Mock MCP Client
  await page.addInitScript(() => {
    window.addEventListener('load', () => {
      // Mock the Client class from @modelcontextprotocol/sdk
      const mockClient = {
        connect: () => Promise.resolve(),
        close: () => Promise.resolve()
      };

      // Mock the SSEClientTransport
      const mockTransport = {
        close: () => Promise.resolve()
      };

      // Override the constructors
      window.mockModelContextProtocolSDK = {
        Client: class {
          connect() {
            return Promise.resolve();
          }
          close() {
            return Promise.resolve();
          }
        },
        SSEClientTransport: class {
          close() {
            return Promise.resolve();
          }
        }
      };

      // Inject mocks into the module system
      const originalRequire = window.require;
      window.require = function (moduleName) {
        if (moduleName === '@modelcontextprotocol/sdk/client/index.js') {
          return { Client: window.mockModelContextProtocolSDK.Client };
        }
        if (moduleName === '@modelcontextprotocol/sdk/client/sse.js') {
          return {
            SSEClientTransport:
              window.mockModelContextProtocolSDK.SSEClientTransport
          };
        }
        return originalRequire(moduleName);
      };
    });
  });

  const logs: string[] = [];
  page.on('console', message => {
    logs.push(message.text());
  });

  await page.goto();

  // Check for activation message
  expect(
    logs.filter(
      s => s === 'JupyterLab extension mcp-client-jupyter-chat is activated!'
    )
  ).toHaveLength(1);
});
